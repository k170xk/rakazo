import { buildApp } from "@rakazo/app-kit/build";
import { APP_KIT_GUIDE } from "@rakazo/app-kit/guide";
import { importWorkbook, MAX_WORKBOOK_BYTES, scaffoldApp } from "@rakazo/app-kit/import";
import type { MessageBlock } from "@rakazo/contracts";
import { PAGE_TITLE_MAX_LENGTH, PageTitleSchema } from "@rakazo/contracts";
import { containsSecret, redactSecrets } from "@rakazo/core";
import {
  AppVersionConflictError,
  addAppAsset,
  appendAppVersion,
  appFilesFrom,
  createAppPage,
  defineAppTable,
  dropAppTable,
  insertAppRow,
  isAppDataError,
  listAppAssets,
  mergeImportedTables,
  readAppTables,
  removeAppRow,
  updateAppRow,
} from "@rakazo/db";
import type { RunContext } from "./run-context.js";
import { isUniqueViolation, publishMessage } from "./run-messages.js";
import type { ToolCall, ToolHandlers } from "./run-tool-gate.js";
import { runFilePath, runFiles } from "./run-tools-files.js";
import { argumentGiven } from "./update-bot-patch.js";

/**
 * The bot's side of the App Studio. An app is a page of kind "app": its files are versioned like a
 * page's source, and its tables live beside it. A bot reaches the apps it or its group made, as
 * with pages; another bot's app answers as if it did not exist.
 */

const MAX_EDITS = 80;
const MAX_TABLES_PER_SAVE = 30;
const FILE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,60}\.(tsx|ts|css|json)$/;
const READ_SAMPLE_ROWS = 5;
const QUERY_LIMIT = 500;
const MAX_PICTURE_BYTES = 6 * 1024 * 1024;
const INFOGRAPHIC_PATH =
  /^\/storage\/v1\/object\/public\/slide-assets\/infographics\/[A-Za-z0-9-]+\.png$/;
const PICTURE_MIMES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

type App = {
  id: string;
  title: string;
  currentVersion: number;
  dataAccess: string;
  files: Record<string, string>;
};

class NotAnApp extends Error {}

async function findApp(ctx: RunContext, appId: string): Promise<App | null> {
  const { deps, run, bot, thread } = ctx;
  const reachable = thread.groupId
    ? [{ botId: bot.id }, { groupId: thread.groupId }]
    : [{ botId: bot.id }];
  const page = await deps.prisma.page.findFirst({
    where: { id: appId, spaceId: run.spaceId, userId: run.userId, OR: reachable },
    select: {
      id: true,
      title: true,
      kind: true,
      currentVersion: true,
      dataAccess: true,
      versions: { orderBy: { version: "desc" }, take: 1, select: { source: true } },
    },
  });
  if (!page) return null;
  if (page.kind !== "app") throw new NotAnApp();
  return {
    id: page.id,
    title: page.title,
    currentVersion: page.currentVersion,
    dataAccess: page.dataAccess,
    files: appFilesFrom(page.versions[0]?.source ?? "{}"),
  };
}

const notFound = { error: "No app with that appId belongs to this bot or chat." };
const notAnApp = {
  error: "That id is a page, not an app; change it with save_page.",
};

function parseFiles(value: unknown): Record<string, string> | string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return 'files must be an object of file names to source, e.g. {"App.tsx": "..."}.';
  }
  const out: Record<string, string> = {};
  for (const [name, source] of Object.entries(value)) {
    if (!FILE_NAME.test(name)) return `${name}: use a name like App.tsx, Board.tsx or theme.css.`;
    if (typeof source !== "string") return `${name}: source must be a string.`;
    out[name] = source;
  }
  return out;
}

type FileEdit = { file: string; find: string; replace: string };

function applyEdits(
  files: Record<string, string>,
  value: unknown,
): { ok: true; files: Record<string, string> } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0)
    return { ok: false, error: "edits must be a non-empty list." };
  if (value.length > MAX_EDITS) return { ok: false, error: `Send at most ${MAX_EDITS} edits.` };
  const next = { ...files };
  for (const [index, item] of value.entries()) {
    const edit = item as Partial<FileEdit> | null;
    const label = `Edit ${index + 1}`;
    const file = typeof edit?.file === "string" && edit.file ? edit.file : "App.tsx";
    if (typeof edit?.find !== "string" || typeof edit.replace !== "string")
      return { ok: false, error: `${label}: needs find and replace strings.` };
    if (!edit.find) return { ok: false, error: `${label}: find is empty.` };
    const source = next[file];
    if (source === undefined) return { ok: false, error: `${label}: the app has no ${file}.` };
    const at = source.indexOf(edit.find);
    if (at === -1) return { ok: false, error: `${label}: find text was not found in ${file}.` };
    if (source.indexOf(edit.find, at + 1) !== -1)
      return {
        ok: false,
        error: `${label}: find text occurs more than once in ${file}; include more surrounding text.`,
      };
    next[file] = source.slice(0, at) + edit.replace + source.slice(at + edit.find.length);
  }
  return { ok: true, files: next };
}

type TableInput = { schema: unknown; rows?: unknown[]; mode?: "replace" | "append" | "upsert" };

function parseTables(value: unknown): TableInput[] | string {
  if (!Array.isArray(value)) return "tables must be a list of {schema, rows?, mode?}.";
  if (value.length > MAX_TABLES_PER_SAVE) return `Send at most ${MAX_TABLES_PER_SAVE} tables.`;
  const out: TableInput[] = [];
  for (const [index, item] of value.entries()) {
    const table = item as Partial<TableInput> | null;
    if (!table?.schema || typeof table.schema !== "object")
      return `Table ${index + 1}: needs a schema.`;
    if (table.rows !== undefined && table.rows !== null && !Array.isArray(table.rows))
      return `Table ${index + 1}: rows must be a list of objects.`;
    const mode =
      table.mode === "append" || table.mode === "upsert" || table.mode === "replace"
        ? table.mode
        : undefined;
    out.push({ schema: table.schema, rows: table.rows ?? undefined, mode });
  }
  return out;
}

function tableSummary(tables: Awaited<ReturnType<typeof readAppTables>>) {
  return Object.fromEntries(
    Object.entries(tables).map(([name, table]) => [
      name,
      {
        schema: table.schema,
        rowCount: table.rows.length,
        sample: table.rows.slice(0, READ_SAMPLE_ROWS),
      },
    ]),
  );
}

async function postCard(
  ctx: RunContext,
  saved: { pageId: string; version: number; title: string },
  created: boolean,
) {
  const block: MessageBlock = { kind: "page", ...saved };
  const linkText = saved.title.replace(/[\\[\]]/g, "\\$&");
  try {
    if (created || ctx.run.trigger !== "routine")
      await publishMessage(ctx.deps, ctx.run, "bot", [block]);
  } catch (error) {
    return `The app was saved, but its card could not be posted in the chat (${
      error instanceof Error ? error.message : "unknown error"
    }). Link it in your reply as [${linkText}](page:${saved.pageId}).`;
  }
  return null;
}

/** A file the run can reach: in its workspace, or attached in this conversation. */
async function readRunFile(
  ctx: RunContext,
  call: ToolCall,
  ref: { path?: unknown; artifactId?: unknown },
  maxBytes: number,
): Promise<{ bytes: Uint8Array; name: string; mime: string | null } | { error: string }> {
  const { deps, context } = ctx;
  if (argumentGiven(ref.path)) {
    const path = String(ref.path);
    try {
      const { files, computer } = runFiles(ctx, call);
      const bytes = await files.readFile(await computer(), runFilePath(ctx, path), context, {
        maxBytes,
      });
      return { bytes, name: path.split("/").pop() ?? path, mime: null };
    } catch {
      return { error: `That file was not found, or is larger than ${maxBytes >> 20} MB.` };
    }
  }
  if (argumentGiven(ref.artifactId)) {
    if (!deps.artifacts) return { error: "File storage is unavailable." };
    const row = await deps.prisma.artifact.findFirst({
      where: { id: String(ref.artifactId), spaceId: context.spaceId, userId: context.userId },
      select: { storageKey: true, size: true, mimeType: true, name: true },
    });
    if (!row) return { error: "That attachment is no longer available." };
    if (row.size > maxBytes) return { error: `That file is larger than ${maxBytes >> 20} MB.` };
    return {
      bytes: await deps.artifacts.get(row.storageKey, context),
      name: row.name,
      mime: row.mimeType,
    };
  }
  return { error: "Send path or artifactId." };
}

/**
 * A spreadsheet made into an app, deterministically: every sheet becomes a table with typed
 * columns, and the app gets an overview, a screen per table, a board and a calendar where the
 * columns allow. Given an appId, the workbook updates that app's rows by key instead.
 */
async function importIntoApp(ctx: RunContext, call: ToolCall, app: App | null, title?: string) {
  const { deps, run, bot, thread } = ctx;
  const workbook = call.args.workbook as { path?: unknown; artifactId?: unknown } | null;
  if (!workbook || typeof workbook !== "object") {
    return { error: "workbook is {path} or {artifactId} of an .xlsx, .xls or .csv file." };
  }
  const file = await readRunFile(ctx, call, workbook, MAX_WORKBOOK_BYTES);
  if ("error" in file) return file;
  let imported: ReturnType<typeof importWorkbook>;
  try {
    imported = importWorkbook(file.bytes);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "That workbook could not be read." };
  }
  if (!imported.tables.length) return { error: "No sheet in that workbook has a table of data." };
  if (containsSecret([JSON.stringify(imported.tables.map((table) => table.rows))], ctx.secrets)) {
    return { error: "The workbook contains a secret value; nothing was saved.", unchanged: true };
  }
  if (app) {
    const report = await mergeImportedTables(deps.prisma, app.id, imported.tables, run.userId);
    return { appId: app.id, report: [...imported.report, ...report] };
  }
  const name =
    title ??
    (file.name
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .trim()
      .slice(0, PAGE_TITLE_MAX_LENGTH) ||
      "Imported app");
  const files = scaffoldApp(
    name,
    imported.tables.map((table) => table.schema),
    file.name,
  );
  const built = await buildApp(files, { title: name });
  if (!built.ok)
    return { error: "The app could not be built.", problems: built.errors.slice(0, 5) };
  const saved = await createAppPage(deps.prisma, {
    spaceId: run.spaceId,
    userId: run.userId,
    botId: bot.id,
    groupId: thread.groupId,
    title: name,
    files,
    code: built.html,
    tables: imported.tables,
  });
  const cardError = await postCard(ctx, saved, true);
  const linkText = saved.title.replace(/[\\[\]]/g, "\\$&");
  return {
    appId: saved.pageId,
    version: saved.version,
    title: saved.title,
    report: imported.report,
    tables: imported.tables.map((table) => ({
      name: table.schema.name,
      sheet: table.sheet,
      rows: table.rows.length,
      columns: table.schema.columns.map((column) => `${column.key}:${column.type}`),
    })),
    next: "The app is built from the sheet's structure. Read it with {appId} and improve its screens for how this person works.",
    ...(cardError
      ? { error: cardError }
      : { mention: `Mention it in your reply as [${linkText}](page:${saved.pageId})` }),
  };
}

async function saveApp(ctx: RunContext, call: ToolCall) {
  const { deps, run, bot, thread } = ctx;
  const { args } = call;
  if (args.help === true) return { guide: APP_KIT_GUIDE };
  const appId = argumentGiven(args.appId) ? String(args.appId) : undefined;
  const hasFiles =
    args.files !== null &&
    typeof args.files === "object" &&
    !Array.isArray(args.files) &&
    Object.keys(args.files).length > 0;
  const hasEdits = Array.isArray(args.edits) ? args.edits.length > 0 : argumentGiven(args.edits);
  const deletes = Array.isArray(args.deleteFiles)
    ? args.deleteFiles.filter((name): name is string => typeof name === "string")
    : [];
  const hasTables = Array.isArray(args.tables) && args.tables.length > 0;
  let title: string | undefined;
  if (argumentGiven(args.title)) {
    const parsed = PageTitleSchema.safeParse(args.title);
    if (!parsed.success) return { error: "title must be 1 to 200 characters." };
    title = redactSecrets(parsed.data, ctx.secrets).slice(0, PAGE_TITLE_MAX_LENGTH);
  }

  let app: App | null = null;
  if (appId) {
    try {
      app = await findApp(ctx, appId);
    } catch (error) {
      if (error instanceof NotAnApp) return notAnApp;
      throw error;
    }
    if (!app) return notFound;
  }

  if (argumentGiven(args.workbook)) return importIntoApp(ctx, call, app, title);

  if (app && !hasFiles && !hasEdits && !deletes.length && !hasTables && !title) {
    // Rows can be written by colleagues through a shared link, so reading them taints the run.
    ctx.state.tainted = true;
    const [tables, assets] = await Promise.all([
      readAppTables(deps.prisma, app.id),
      listAppAssets(deps.prisma, app.id),
    ]);
    return {
      appId: app.id,
      version: app.currentVersion,
      title: app.title,
      dataAccess: app.dataAccess,
      files: app.files,
      tables: tableSummary(tables),
      assets: assets.map((asset) => ({ id: asset.id, name: asset.name, mime: asset.mime })),
    };
  }
  if (!app && hasEdits) return { error: "edits need the appId of the app to change." };
  if (!app && !hasFiles) return { error: 'A new app needs files with "App.tsx".' };
  if (!app && !title) return { error: "A new app needs a title." };

  let files = { ...(app?.files ?? {}) };
  if (hasFiles) {
    const given = parseFiles(args.files);
    if (typeof given === "string") return { error: given, unchanged: true };
    files = { ...files, ...given };
  }
  if (hasEdits) {
    const applied = applyEdits(files, args.edits);
    if (!applied.ok) return { error: applied.error, unchanged: true };
    files = applied.files;
  }
  for (const name of deletes) {
    if (name === "App.tsx") return { error: "App.tsx can't be deleted.", unchanged: true };
    delete files[name];
  }
  const tables = hasTables ? parseTables(args.tables) : [];
  if (typeof tables === "string") return { error: tables, unchanged: true };

  const codeChanged = !app || hasFiles || hasEdits || deletes.length > 0;
  let code: string | null = null;
  let warnings: unknown[] = [];
  if (codeChanged) {
    const built = await buildApp(files, { title: title ?? app?.title ?? "App" });
    if (!built.ok) {
      return {
        error: "The app has problems; nothing was saved.",
        problems: built.errors.slice(0, 20),
        unchanged: true,
      };
    }
    code = built.html;
    warnings = built.warnings;
  }
  // An app can be shared by link, so it never stores a value this run keeps secret.
  if (
    containsSecret(
      [...Object.values(files), ...tables.map((table) => JSON.stringify(table))],
      ctx.secrets,
    )
  ) {
    return {
      error: "The app contains a secret value; nothing was saved. Remove it and save again.",
      unchanged: true,
    };
  }

  let saved: { pageId: string; version: number; title: string };
  const tableResults: Array<Record<string, unknown>> = [];
  try {
    if (!app) {
      saved = await createAppPage(deps.prisma, {
        spaceId: run.spaceId,
        userId: run.userId,
        botId: bot.id,
        groupId: thread.groupId,
        title: title!,
        files,
        code: code!,
      });
    } else if (codeChanged) {
      const next = await appendAppVersion(deps.prisma, {
        pageId: app.id,
        baseVersion: app.currentVersion,
        files,
        code: code!,
        title,
      });
      saved = { pageId: app.id, ...next };
    } else {
      if (title) await deps.prisma.page.update({ where: { id: app.id }, data: { title } });
      saved = { pageId: app.id, version: app.currentVersion, title: title ?? app.title };
    }
    for (const table of tables) {
      const result = await defineAppTable(deps.prisma, saved.pageId, {
        schema: table.schema,
        rows: table.rows,
        mode: table.mode,
        userId: run.userId,
      });
      tableResults.push({
        table: result.table,
        rows: result.rows,
        inserted: result.inserted,
        updated: result.updated,
        removed: result.removed,
        ...(result.skipped.length ? { skipped: result.skipped.slice(0, 10) } : {}),
      });
    }
  } catch (error) {
    if (error instanceof AppVersionConflictError || isUniqueViolation(error)) {
      return { error: "The app changed while saving; read it again and retry.", unchanged: true };
    }
    if (isAppDataError(error)) {
      return {
        error: `The code was saved but a table was refused: ${error.message}`,
        tables: tableResults,
      };
    }
    throw error;
  }
  const cardError = codeChanged ? await postCard(ctx, saved, !app) : null;
  const linkText = saved.title.replace(/[\\[\]]/g, "\\$&");
  return {
    appId: saved.pageId,
    version: saved.version,
    title: saved.title,
    ...(tableResults.length ? { tables: tableResults } : {}),
    ...(warnings.length ? { warnings } : {}),
    ...(cardError
      ? { error: cardError }
      : { mention: `Mention it in your reply as [${linkText}](page:${saved.pageId})` }),
  };
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>, search: string[]) {
  for (const [key, value] of Object.entries(where)) {
    if (String(row[key] ?? "") !== String(value ?? "")) return false;
  }
  if (search.length) {
    const text = Object.values(row).join(" ").toLowerCase();
    return search.every((word) => text.includes(word));
  }
  return true;
}

async function appData(ctx: RunContext, call: ToolCall) {
  const { deps, run } = ctx;
  const { args } = call;
  const appId = String(args.appId ?? "");
  let app: App | null;
  try {
    app = appId ? await findApp(ctx, appId) : null;
  } catch (error) {
    if (error instanceof NotAnApp) return notAnApp;
    throw error;
  }
  if (!app) return notFound;
  const table = typeof args.table === "string" ? args.table : "";
  const action = typeof args.action === "string" ? args.action : "query";
  const rows = Array.isArray(args.rows) ? args.rows : undefined;
  if (rows && containsSecret([JSON.stringify(rows)], ctx.secrets)) {
    return { error: "The rows contain a secret value; nothing was saved.", unchanged: true };
  }
  if (args.patch && containsSecret([JSON.stringify(args.patch)], ctx.secrets)) {
    return { error: "The change contains a secret value; nothing was saved.", unchanged: true };
  }
  try {
    switch (action) {
      case "query": {
        ctx.state.tainted = true;
        const tables = await readAppTables(deps.prisma, app.id);
        if (!table) return { tables: tableSummary(tables) };
        const found = tables[table];
        if (!found) return { error: `This app has no table called ${table}.` };
        const where =
          args.where && typeof args.where === "object" && !Array.isArray(args.where)
            ? (args.where as Record<string, unknown>)
            : {};
        const search =
          typeof args.search === "string"
            ? args.search.toLowerCase().split(/\s+/).filter(Boolean)
            : [];
        const hits = found.rows.filter((row) => matches(row, where, search));
        const limit = Math.min(Math.max(Number(args.limit) || 50, 1), QUERY_LIMIT);
        const offset = Math.max(Number(args.offset) || 0, 0);
        return {
          table,
          schema: found.schema,
          total: hits.length,
          rows: hits.slice(offset, offset + limit),
        };
      }
      case "insert": {
        const row = (rows?.[0] ?? args.row) as Record<string, unknown> | undefined;
        if (!row || typeof row !== "object") return { error: "insert needs row." };
        const saved = await insertAppRow(deps.prisma, app.id, table, row, run.userId);
        return { row: saved.row, revision: saved.revision };
      }
      case "update": {
        const id = String(args.id ?? "");
        const patch = args.patch as Record<string, unknown> | undefined;
        if (!id || !patch || typeof patch !== "object")
          return { error: "update needs id and patch." };
        const saved = await updateAppRow(deps.prisma, app.id, table, id, patch, run.userId);
        return { row: saved.row, revision: saved.revision };
      }
      case "remove": {
        const id = String(args.id ?? "");
        if (!id) return { error: "remove needs id." };
        return await removeAppRow(deps.prisma, app.id, table, id);
      }
      case "replace":
      case "append":
      case "upsert": {
        if (!rows) return { error: `${action} needs rows.` };
        const result = await defineAppTable(deps.prisma, app.id, {
          table,
          rows,
          mode: action,
          userId: run.userId,
        });
        return {
          table: result.table,
          rows: result.rows,
          inserted: result.inserted,
          updated: result.updated,
          removed: result.removed,
          revision: result.revision,
          ...(result.skipped.length ? { skipped: result.skipped.slice(0, 10) } : {}),
        };
      }
      case "drop":
        return await dropAppTable(deps.prisma, app.id, table);
      default:
        return {
          error: "action is one of query, insert, update, remove, replace, append, upsert, drop.",
        };
    }
  } catch (error) {
    if (isAppDataError(error))
      return { error: error instanceof Error ? error.message : "Refused", unchanged: true };
    throw error;
  }
}

async function appAsset(ctx: RunContext, call: ToolCall) {
  const { deps } = ctx;
  const { args } = call;
  const appId = String(args.appId ?? "");
  let app: App | null;
  try {
    app = appId ? await findApp(ctx, appId) : null;
  } catch (error) {
    if (error instanceof NotAnApp) return notAnApp;
    throw error;
  }
  if (!app) return notFound;
  const given = [args.path, args.artifactId, args.url].filter(argumentGiven);
  if (given.length !== 1) return { error: "Send exactly one of path, artifactId or url." };

  let bytes: Uint8Array;
  let mime: string;
  let name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : "";
  let source: string;
  if (argumentGiven(args.path) || argumentGiven(args.artifactId)) {
    const file = await readRunFile(ctx, call, args, MAX_PICTURE_BYTES);
    if ("error" in file) return file;
    bytes = file.bytes;
    mime = file.mime ?? PICTURE_MIMES[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
    name ||= file.name;
    source = argumentGiven(args.path) ? "file" : "attachment";
  } else {
    // Only pictures Evolve rendered (its infographics) are fetched; no other host is reached.
    const evolve = deps.evolvePlugins?.url;
    let url: URL;
    try {
      url = new URL(String(args.url));
    } catch {
      return { error: "url is not a web address." };
    }
    if (
      !evolve ||
      url.protocol !== "https:" ||
      url.host !== new URL(evolve).host ||
      !INFOGRAPHIC_PATH.test(url.pathname)
    ) {
      return {
        error:
          "Only pictures from OCSC Vision Intelligence (evolve_infographics) can be added by url.",
      };
    }
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    if (!response?.ok) return { error: "That picture could not be downloaded." };
    if (Number(response.headers.get("content-length") ?? 0) > MAX_PICTURE_BYTES) {
      await response.body?.cancel();
      return { error: "That picture is larger than 6 MB." };
    }
    mime = (response.headers.get("content-type") ?? "").split(";")[0]!.trim();
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > MAX_PICTURE_BYTES)
      return { error: "That picture is larger than 6 MB." };
    bytes = buffer;
    name ||= "Infographic";
    source = "infographic";
  }
  try {
    const asset = await addAppAsset(deps.prisma, app.id, {
      name: name.slice(0, 200),
      mime,
      bytes,
      source,
    });
    return {
      assetId: asset.id,
      name: asset.name,
      use: `Show it with <AssetImage asset="${asset.id}" /> or useAsset("${asset.id}").`,
    };
  } catch (error) {
    if (isAppDataError(error)) return { error: error instanceof Error ? error.message : "Refused" };
    throw error;
  }
}

export const appTools: ToolHandlers = {
  async save_app(ctx, call) {
    return call.finish(await saveApp(ctx, call));
  },
  async app_data(ctx, call) {
    return call.finish(await appData(ctx, call));
  },
  async app_asset(ctx, call) {
    return call.finish(await appAsset(ctx, call));
  },
};
