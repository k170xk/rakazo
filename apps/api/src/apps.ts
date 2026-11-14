import { createHash } from "node:crypto";
import type { EvolvePluginsConnection } from "@rakazo/adapters";
import { callEvolvePlugins, drawAppIconLater, EvolvePluginsError } from "@rakazo/adapters";
import type { BuildProblem } from "@rakazo/app-kit/build";
import { buildApp, pluginBundle } from "@rakazo/app-kit/build";
import { exportTable, importWorkbook, scaffoldApp } from "@rakazo/app-kit/import";
import { MAX_UPLOAD_BASE64 } from "@rakazo/app-kit/protocol";
import type { TableSchema } from "@rakazo/app-kit/schema";
import { checkSchema, isPersonalTable } from "@rakazo/app-kit/schema";
import { findTemplate } from "@rakazo/app-kit/templates";
import type { Looker } from "@rakazo/app-kit/workspace";
import { addsRow, editsRow, inWorkspaces, narrowsRows, seesRow } from "@rakazo/app-kit/workspace";
import type { Actor, AppData, AppDataAccess, AppWorkspaceSettingsInput } from "@rakazo/contracts";
import type { PrismaClient, RowFacts } from "@rakazo/db";
import {
  AppDataError,
  AppVersionConflictError,
  addAppAsset,
  addAppUpload,
  appendAppVersion,
  appFilesFrom,
  appRevision,
  createAppPage,
  defineAppTable,
  dropAppTable,
  IsolationError,
  insertAppRow,
  listAppAssets,
  listAppChanges,
  mergeImportedTables,
  readAppAsset,
  readAppRowFacts,
  readAppTables,
  recordAuditEvent,
  removeAppRow,
  runAsSystem,
  undoAppChange,
  updateAppRow,
} from "@rakazo/db";
import { askForApp } from "./app-ask.js";
import { writeDossier } from "./app-dossier.js";
import {
  readAppWorkspaceSettings,
  resolveLooker,
  setAppWorkspaces,
  workspaceSummary,
} from "./app-workspaces.js";
import { readStateRows } from "./pages.js";

/**
 * The owner's side of apps: their data, files, versions and pictures. Every call checks the app
 * is the caller's own in this Space (row security checks it again); colleagues and link readers
 * come in through the shared routes instead.
 */

async function requireApp(prisma: PrismaClient, actor: Actor, pageId: string) {
  const row = await prisma.page.findFirst({
    where: { id: pageId, spaceId: actor.spaceId, userId: actor.userId, kind: "app" },
    select: { id: true, title: true, currentVersion: true, dataAccess: true, iconAssetId: true },
  });
  if (!row) throw new IsolationError();
  return row;
}

/** Apps and whiteboards both store uploaded pictures, infographics and project photos as assets. */
async function requireAssetPage(prisma: PrismaClient, actor: Actor, pageId: string) {
  const row = await prisma.page.findFirst({
    where: {
      id: pageId,
      spaceId: actor.spaceId,
      userId: actor.userId,
      kind: { in: ["app", "whiteboard"] },
    },
    select: { id: true },
  });
  if (!row) throw new IsolationError();
  return row;
}

const access = (value: string): AppDataAccess =>
  value === "company" || value === "contribute" ? value : "owner";

type Tables = Awaited<ReturnType<typeof readAppTables>>;
type RowOut = Tables[string]["rows"][number];
/** Who is looking at rows: their user id (null for a visitor) and whether they see who added them. */
export type RowViewer = { userId: string | null; names: boolean };

async function creatorNames(prisma: PrismaClient, ids: Iterable<string>) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<string, string | null>();
  const users = await runAsSystem("app row creator names", () =>
    prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }),
  );
  return new Map(users.map((user) => [user.id, user.name]));
}

function marked(
  row: RowOut,
  creator: string | undefined,
  viewer: RowViewer,
  names: Map<string, string | null>,
): RowOut {
  if (!creator) return row;
  return {
    ...row,
    _mine: creator === viewer.userId,
    ...(viewer.names ? { _by: names.get(creator) ?? null } : {}),
  };
}

/**
 * Tables as one viewer sees them, by the rules in @rakazo/app-kit/workspace: others' rows of a
 * personal table and rows of workspaces they have not opened are left out. Rows carry _mine for
 * the viewer's own and, for people signed in, _by with who added them; the owner looking at every
 * workspace also gets _workspace, the name of each row's workspace.
 */
export async function tablesForViewer(
  prisma: PrismaClient,
  pageId: string,
  tables: Tables,
  viewer: RowViewer,
  looker: Looker,
): Promise<Tables> {
  const facts = await runAsSystem("app row facts", () => readAppRowFacts(prisma, pageId));
  const narrowed = (schema: TableSchema) => narrowsRows(looker, schema);
  const filters = Object.values(tables).some((table) => narrowed(table.schema));
  const tagsWorkspace = looker.isOwner && looker.view !== null && looker.view.current === null;
  if (!facts.size && !filters) return tables;
  const none: RowFacts = { createdBy: null, workspaceId: null };
  const factsOf = (row: RowOut) => facts.get(row._id) ?? none;
  const shown = Object.entries(tables).map(
    ([name, table]) =>
      [
        name,
        table,
        narrowed(table.schema)
          ? table.rows.filter((row) => seesRow(looker, table.schema, factsOf(row)))
          : table.rows,
      ] as const,
  );
  const names = viewer.names
    ? await creatorNames(
        prisma,
        shown.flatMap(([, , rows]) => rows.flatMap((row) => factsOf(row).createdBy ?? [])),
      )
    : new Map();
  const spaces = tagsWorkspace ? await workspaceNames(prisma, pageId) : null;
  return Object.fromEntries(
    shown.map(([name, table, rows]) => [
      name,
      {
        ...table,
        rows: rows.map((row) => {
          const { createdBy, workspaceId } = factsOf(row);
          const out = marked(row, createdBy ?? undefined, viewer, names);
          return spaces && inWorkspaces(looker.view, table.schema)
            ? { ...out, _workspace: workspaceId ? (spaces.get(workspaceId) ?? null) : null }
            : out;
        }),
        // A large table's count would reveal how many rows others (or other workspaces) hold.
        ...(narrowed(table.schema) ? { count: undefined } : {}),
      },
    ]),
  );
}

async function workspaceNames(prisma: PrismaClient, pageId: string) {
  const spaces = await runAsSystem("app workspace names", () =>
    prisma.appWorkspace.findMany({ where: { pageId }, select: { id: true, name: true } }),
  );
  return new Map(spaces.map((space) => [space.id, space.name]));
}

/** One row just written, marked the same way for the person who wrote it. */
async function rowForViewer(prisma: PrismaClient, row: RowOut, viewer: RowViewer): Promise<RowOut> {
  const found = await runAsSystem("app row creator", () =>
    prisma.appRow.findUnique({ where: { id: row._id }, select: { createdBy: true } }),
  );
  const creator = found?.createdBy ?? undefined;
  const names = viewer.names && creator ? await creatorNames(prisma, [creator]) : new Map();
  return marked(row, creator, viewer, names);
}

export async function getAppData(
  prisma: PrismaClient,
  actor: Actor,
  pageId: string,
): Promise<AppData> {
  const app = await requireApp(prisma, actor, pageId);
  const [tables, state, revision, looker] = await Promise.all([
    readAppTables(prisma, pageId, { skipLarge: true }),
    readStateRows(prisma, pageId),
    appRevision(prisma, pageId),
    resolveLooker(prisma, { pageId, userId: actor.userId }),
  ]);
  return {
    tables: await tablesForViewer(
      prisma,
      pageId,
      tables,
      { userId: actor.userId, names: true },
      looker,
    ),
    state,
    revision,
    dataAccess: access(app.dataAccess),
    icon: app.iconAssetId,
    workspace: workspaceSummary(looker),
  };
}

/** Draws the owner's app icon again now; null when Evolve is not linked or the drawing failed. */
export async function redrawAppIcon(
  prisma: PrismaClient,
  actor: Actor,
  connection: EvolvePluginsConnection | null,
  input: { pageId: string; subject?: string },
): Promise<string | null> {
  const app = await requireApp(prisma, actor, input.pageId);
  return drawAppIconLater(
    { prisma, connection },
    { pageId: app.id, userId: actor.userId, title: app.title, subject: input.subject ?? null },
  );
}

export async function getAppRevision(prisma: PrismaClient, actor: Actor, pageId: string) {
  const app = await requireApp(prisma, actor, pageId);
  return { revision: await appRevision(prisma, pageId), version: app.currentVersion };
}

export async function ownerInsertRow(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; table: string; row: Record<string, unknown> },
) {
  await requireApp(prisma, actor, input.pageId);
  const looker = await resolveLooker(prisma, { pageId: input.pageId, userId: actor.userId });
  const workspaceId = await rowWorkspace(
    prisma,
    input.pageId,
    input.table,
    input.row,
    looker,
    "company",
  );
  const saved = await insertAppRow(prisma, input.pageId, input.table, input.row, actor.userId, {
    via: "studio",
    workspaceId,
  });
  return {
    ...saved,
    row: await rowForViewer(prisma, saved.row, { userId: actor.userId, names: true }),
  };
}

export async function ownerUpdateRow(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; table: string; id: string; patch: Record<string, unknown> },
) {
  await requireApp(prisma, actor, input.pageId);
  const saved = await updateAppRow(
    prisma,
    input.pageId,
    input.table,
    input.id,
    input.patch,
    actor.userId,
    {},
    { via: "studio" },
  );
  return {
    ...saved,
    row: await rowForViewer(prisma, saved.row, { userId: actor.userId, names: true }),
  };
}

export async function ownerRemoveRow(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; table: string; id: string },
) {
  await requireApp(prisma, actor, input.pageId);
  return removeAppRow(
    prisma,
    input.pageId,
    input.table,
    input.id,
    {},
    { userId: actor.userId, via: "studio" },
  );
}

export async function ownerDefineTable(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; schema: unknown; rows?: Array<Record<string, unknown>> },
) {
  await requireApp(prisma, actor, input.pageId);
  const result = await defineAppTable(prisma, input.pageId, {
    schema: input.schema,
    rows: input.rows,
    mode: "replace",
    userId: actor.userId,
    via: "studio",
  });
  return { table: result.table, rows: result.rows, revision: result.revision };
}

export async function ownerDropTable(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; table: string },
) {
  await requireApp(prisma, actor, input.pageId);
  return dropAppTable(prisma, input.pageId, input.table, { userId: actor.userId, via: "studio" });
}

export async function getAppFiles(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; version?: number },
) {
  const app = await requireApp(prisma, actor, input.pageId);
  const version = input.version ?? app.currentVersion;
  const stored = await prisma.pageVersion.findUnique({
    where: { pageId_version: { pageId: app.id, version } },
    select: { source: true },
  });
  if (!stored) throw new IsolationError();
  return { files: appFilesFrom(stored.source), version };
}

export async function saveAppFiles(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; files: Record<string, string>; baseVersion: number },
): Promise<{ version: number | null; problems: BuildProblem[] }> {
  const app = await requireApp(prisma, actor, input.pageId);
  const built = await buildApp(input.files, { title: app.title });
  if (!built.ok) return { version: null, problems: built.errors };
  const saved = await appendAppVersion(prisma, {
    pageId: app.id,
    baseVersion: input.baseVersion,
    files: input.files,
    code: built.html,
    authorId: actor.userId,
    via: "studio",
  });
  return { version: saved.version, problems: [] };
}

const previews = new Map<string, { html: string | null; problems: BuildProblem[] }>();
const MAX_PREVIEWS = 24;

/** The Studio's build: elements carry their source line, so a click can point at the code. */
export async function previewApp(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; files?: Record<string, string>; version?: number },
) {
  const app = await requireApp(prisma, actor, input.pageId);
  const files =
    input.files ??
    (await getAppFiles(prisma, actor, { pageId: app.id, version: input.version })).files;
  const key = createHash("sha256")
    .update(app.title)
    .update(JSON.stringify(files))
    .digest("base64url");
  const cached = previews.get(key);
  if (cached) return cached;
  const built = await buildApp(files, { title: app.title, mode: "preview" });
  const result = built.ok
    ? { html: built.html, problems: [] }
    : { html: null, problems: built.errors };
  previews.set(key, result);
  if (previews.size > MAX_PREVIEWS) previews.delete(previews.keys().next().value!);
  return result;
}

export async function listAppVersions(prisma: PrismaClient, actor: Actor, pageId: string) {
  await requireApp(prisma, actor, pageId);
  const rows = await prisma.pageVersion.findMany({
    where: { pageId },
    orderBy: { version: "desc" },
    take: 100,
    select: {
      version: true,
      title: true,
      createdAt: true,
      via: true,
      authorId: true,
      restoredFrom: true,
    },
  });
  const names = await creatorNames(
    prisma,
    rows.flatMap((row) => (row.authorId ? [row.authorId] : [])),
  );
  return rows.map(({ authorId, ...row }) => ({
    ...row,
    author: authorId ? (names.get(authorId) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** The app's recent data changes, with who made each. */
export async function listOwnerAppChanges(prisma: PrismaClient, actor: Actor, pageId: string) {
  await requireApp(prisma, actor, pageId);
  const changes = await listAppChanges(prisma, pageId);
  const names = await creatorNames(
    prisma,
    changes.flatMap((change) => (change.userId ? [change.userId] : [])),
  );
  return changes.map(({ userId, ...change }) => ({
    ...change,
    author: userId ? (names.get(userId) ?? null) : null,
  }));
}

export async function undoOwnerAppChange(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; changeId: string; redo?: boolean },
) {
  await requireApp(prisma, actor, input.pageId);
  return undoAppChange(prisma, input.pageId, input.changeId, {
    redo: input.redo,
    userId: actor.userId,
  });
}

export async function restoreAppVersion(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; version: number },
) {
  const app = await requireApp(prisma, actor, input.pageId);
  const stored = await prisma.pageVersion.findUnique({
    where: { pageId_version: { pageId: app.id, version: input.version } },
    select: { source: true, code: true },
  });
  if (!stored) throw new IsolationError();
  const files = appFilesFrom(stored.source);
  let code = stored.code;
  // An imported app's older versions arrive unbuilt.
  if (!code) {
    const built = await buildApp(files, { title: app.title });
    if (!built.ok)
      throw new WorkbookImportError(
        `That version could not be built: ${built.errors[0]?.message ?? "unknown problem"}`,
      );
    code = built.html;
  }
  const saved = await appendAppVersion(prisma, {
    pageId: app.id,
    baseVersion: app.currentVersion,
    files,
    code,
    authorId: actor.userId,
    via: "restore",
    restoredFrom: input.version,
  });
  return { version: saved.version };
}

export async function setAppDataAccess(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; access: AppDataAccess },
) {
  await requireApp(prisma, actor, input.pageId);
  await prisma.page.update({ where: { id: input.pageId }, data: { dataAccess: input.access } });
  return { access: input.access };
}

export async function getAppWorkspaces(prisma: PrismaClient, actor: Actor, pageId: string) {
  await requireApp(prisma, actor, pageId);
  return readAppWorkspaceSettings(prisma, pageId);
}

/** Turns workspaces on or off; fileInto puts rows that belong to none into a workspace by name. */
export async function setAppWorkspaceSettings(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string } & AppWorkspaceSettingsInput,
) {
  await requireApp(prisma, actor, input.pageId);
  return setAppWorkspaces(prisma, input.pageId, input);
}

export async function getAppAssets(prisma: PrismaClient, actor: Actor, pageId: string) {
  await requireAssetPage(prisma, actor, pageId);
  const rows = await listAppAssets(prisma, pageId);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function getAppAsset(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; assetId: string },
) {
  await requireAssetPage(prisma, actor, input.pageId);
  const asset = await readAppAsset(prisma, input.pageId, input.assetId);
  if (!asset) throw new IsolationError();
  return { mime: asset.mime, base64: Buffer.from(asset.bytes).toString("base64") };
}

export async function uploadAppAsset(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; name: string; mime: string; base64: string },
) {
  await requireAssetPage(prisma, actor, input.pageId);
  const asset = await addAppAsset(prisma, input.pageId, {
    name: input.name,
    mime: input.mime,
    bytes: Buffer.from(input.base64, "base64"),
    source: "upload",
  });
  return { ...asset, source: "upload", createdAt: new Date().toISOString() };
}

export async function deleteAppAsset(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; assetId: string },
) {
  await requireAssetPage(prisma, actor, input.pageId);
  await prisma.appAsset.deleteMany({ where: { id: input.assetId, pageId: input.pageId } });
  return { ok: true as const };
}

function tableFile(tables: Tables, table: string, format: "xlsx" | "csv", workspaceLabel?: string) {
  const found = tables[table];
  if (!found) throw new IsolationError();
  // The owner's file of every workspace says which one each row belongs to.
  const tagged = Boolean(workspaceLabel) && found.rows.some((row) => "_workspace" in row);
  const schema: TableSchema = tagged
    ? {
        ...found.schema,
        columns: [
          { key: "_workspace", label: workspaceLabel!, type: "text" },
          ...found.schema.columns,
        ],
      }
    : found.schema;
  const bytes = exportTable(schema, found.rows, format);
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    filename: `${found.schema.label.replace(/[^\w -]+/g, "").trim() || table} ${stamp}.${format}`,
    mime:
      format === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/csv",
    base64: Buffer.from(bytes).toString("base64"),
  };
}

export async function ownerExportTable(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; table: string; format: "xlsx" | "csv" },
) {
  await requireApp(prisma, actor, input.pageId);
  const looker = await resolveLooker(prisma, { pageId: input.pageId, userId: actor.userId });
  const tables = await tablesForViewer(
    prisma,
    input.pageId,
    await readAppTables(prisma, input.pageId),
    { userId: actor.userId, names: true },
    looker,
  );
  return tableFile(tables, input.table, input.format, looker.view?.label);
}

export async function ownerAsk(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; prompt: string; json?: boolean },
) {
  await requireApp(prisma, actor, input.pageId);
  return {
    answer: await askForApp({
      userId: actor.userId,
      prompt: input.prompt,
      json: input.json === true,
    }),
  };
}

export class WorkbookImportError extends Error {}

/** The app is listed with the bot or group it was made from, when that is the caller's own. */
async function ownHome(
  prisma: PrismaClient,
  actor: Actor,
  input: { botId?: string; groupId?: string },
) {
  const bot = input.botId
    ? await prisma.bot.findFirst({
        where: { id: input.botId, spaceId: actor.spaceId, userId: actor.userId },
        select: { id: true },
      })
    : null;
  const group = input.groupId
    ? await prisma.chatGroup.findFirst({
        where: { id: input.groupId, spaceId: actor.spaceId, userId: actor.userId },
        select: { id: true },
      })
    : null;
  return { bot, group };
}

/** A new app from one of the App Studio's starters, with its tables empty and its access. */
export async function createTemplateApp(
  prisma: PrismaClient,
  actor: Actor,
  input: { templateId: string; title?: string; botId?: string; groupId?: string },
  drawIcon?: (app: { pageId: string; title: string; subject?: string }) => void,
) {
  const template = findTemplate(input.templateId);
  if (!template) throw new WorkbookImportError("That starter app doesn't exist.");
  const { bot, group } = await ownHome(prisma, actor, input);
  const title = (input.title?.trim() || template.title).slice(0, 200);
  const built = await buildApp(template.files, { title });
  if (!built.ok)
    throw new WorkbookImportError(
      `The app could not be built: ${built.errors[0]?.message ?? "unknown problem"}`,
    );
  const created = await createAppPage(prisma, {
    spaceId: actor.spaceId,
    userId: actor.userId,
    botId: bot?.id ?? null,
    groupId: group?.id ?? null,
    title,
    files: template.files,
    code: built.html,
    tables: template.tables.map((schema) => ({ schema, rows: [] })),
    dataAccess: template.access,
    via: "template",
  });
  drawIcon?.({ pageId: created.pageId, title, subject: template.icon });
  return { pageId: created.pageId };
}

/** A new app from a workbook the person uploaded: the importer's tables and its scaffold. */
export async function importWorkbookApp(
  prisma: PrismaClient,
  actor: Actor,
  input: { title?: string; fileName: string; base64: string; botId?: string; groupId?: string },
  drawIcon?: (app: { pageId: string; title: string }) => void,
) {
  const { bot, group } = await ownHome(prisma, actor, input);
  let imported: ReturnType<typeof importWorkbook>;
  try {
    imported = importWorkbook(new Uint8Array(Buffer.from(input.base64, "base64")));
  } catch (error) {
    throw new WorkbookImportError(
      error instanceof Error ? error.message : "That workbook could not be read.",
    );
  }
  const title =
    input.title?.trim() ||
    input.fileName
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .trim() ||
    "Imported app";
  const files = scaffoldApp(
    title,
    imported.tables.map((table) => table.schema),
    input.fileName,
  );
  const built = await buildApp(files, { title });
  if (!built.ok)
    throw new WorkbookImportError(
      `The app could not be built: ${built.errors[0]?.message ?? "unknown problem"}`,
    );
  const created = await createAppPage(prisma, {
    spaceId: actor.spaceId,
    userId: actor.userId,
    botId: bot?.id ?? null,
    groupId: group?.id ?? null,
    title: title.slice(0, 200),
    files,
    code: built.html,
    tables: imported.tables,
    via: "import",
  });
  drawIcon?.({ pageId: created.pageId, title: title.slice(0, 200) });
  return { pageId: created.pageId, report: imported.report };
}

/**
 * Reads a newer copy of a workbook into an existing app: sheets matching a table update rows by
 * the table's key (or append when it has none), keep the app's own columns and add new ones; new
 * sheets become new tables. The app's code and the rows it alone holds are untouched.
 */
export async function reimportWorkbookApp(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; fileName: string; base64: string },
) {
  await requireApp(prisma, actor, input.pageId);
  let imported: ReturnType<typeof importWorkbook>;
  try {
    imported = importWorkbook(new Uint8Array(Buffer.from(input.base64, "base64")));
  } catch (error) {
    throw new WorkbookImportError(
      error instanceof Error ? error.message : "That workbook could not be read.",
    );
  }
  const report = [
    ...imported.report,
    ...(await mergeImportedTables(prisma, input.pageId, imported.tables, actor.userId)),
  ];
  return { report, revision: await appRevision(prisma, input.pageId) };
}

/** Shared-link reads, for a reader the link, password or sign-in already admitted. */
export async function readSharedAppData(
  prisma: PrismaClient,
  pageId: string,
  viewer: RowViewer,
  looker: Looker,
) {
  const data = await runAsSystem("app share data", async () => ({
    tables: await readAppTables(prisma, pageId, { skipLarge: true }),
    state: await readStateRows(prisma, pageId),
    revision: await appRevision(prisma, pageId),
    page: await prisma.page.findUnique({ where: { id: pageId }, select: { iconAssetId: true } }),
  }));
  const { page, ...rest } = data;
  return {
    ...rest,
    icon: page?.iconAssetId ?? null,
    tables: await tablesForViewer(prisma, pageId, data.tables, viewer, looker),
  };
}

export function readSharedAppRevision(prisma: PrismaClient, pageId: string) {
  return runAsSystem("app share revision", () => appRevision(prisma, pageId));
}

/** Columns that can hold a picture id: photo columns, and text a board or markup keeps. */
const HOLDS_PICTURES = new Set(["image", "text", "longtext"]);

/**
 * A picture for someone a shared route admitted. Pictures the app itself carries show to anyone
 * who can open it. A photo someone added in the app shows to them and the owner, and to others
 * only while a row they can see holds it, when the app has personal tables or workspaces.
 */
export async function readSharedAppAsset(
  prisma: PrismaClient,
  pageId: string,
  assetId: string,
  looker: Looker,
) {
  return runAsSystem("app share asset", async () => {
    const asset = await prisma.appAsset.findFirst({
      where: { id: assetId, pageId },
      select: { mime: true, bytes: true, name: true, source: true },
    });
    if (!asset) return null;
    const { source, ...shown } = asset;
    const uploader = source.startsWith("app:") ? source.slice(4) : null;
    if (!uploader || uploader === looker.userId || looker.isOwner) return shown;
    const tables = await prisma.appTable.findMany({
      where: { pageId },
      select: { id: true, name: true, label: true, schema: true },
    });
    const schemas = tables.map((table) => ({
      id: table.id,
      schema: checkSchema(table.schema).ok
        ? (table.schema as TableSchema)
        : { name: table.name, label: table.label, columns: [] },
    }));
    const narrows = (schema: TableSchema) =>
      isPersonalTable(schema) || inWorkspaces(looker.view, schema);
    if (!schemas.some((table) => narrows(table.schema))) return shown;
    for (const { id, schema } of schemas) {
      for (const column of schema.columns ?? []) {
        if (!HOLDS_PICTURES.has(column.type)) continue;
        const holders = await prisma.appRow.findMany({
          where: { pageId, tableId: id, data: { path: [column.key], string_contains: assetId } },
          select: { createdBy: true, workspaceId: true },
          take: 50,
        });
        if (holders.some((row) => seesRow(looker, schema, row))) return shown;
      }
    }
    return null;
  });
}

/** One table's rows as a file, holding only the rows this viewer may see. */
export async function exportSharedAppTable(
  prisma: PrismaClient,
  pageId: string,
  table: string,
  format: "xlsx" | "csv",
  looker: Looker,
) {
  const tables = await runAsSystem("app share export", () => readAppTables(prisma, pageId));
  const visible = await tablesForViewer(
    prisma,
    pageId,
    tables,
    { userId: looker.userId, names: false },
    looker,
  );
  return tableFile(visible, table, format, looker.view?.label);
}

export type SharedRowWrite =
  | { op: "insert"; table: string; row: Record<string, unknown> }
  | { op: "update"; table: string; id: string; patch: Record<string, unknown> }
  | { op: "remove"; table: string; id: string };

async function tableSchema(prisma: PrismaClient, pageId: string, name: string) {
  const table = await runAsSystem("app table schema", () =>
    prisma.appTable.findUnique({
      where: { pageId_name: { pageId, name } },
      select: { name: true, label: true, schema: true },
    }),
  );
  if (!table) throw new AppDataError(`This app has no table called ${name}.`);
  const checked = checkSchema(table.schema);
  return checked.ok ? checked.schema : { name: table.name, label: table.label, columns: [] };
}

/**
 * The workspace a new row joins, after checking the person may add to this table. A row from a
 * copy still showing another workspace (switched in a second window) is refused, not misfiled.
 */
export async function rowWorkspace(
  prisma: PrismaClient,
  pageId: string,
  table: string,
  row: Record<string, unknown>,
  looker: Looker,
  access: string,
): Promise<string | null> {
  const schema = await tableSchema(prisma, pageId, table);
  const allowed = addsRow(looker, schema, access);
  if (allowed !== true) throw new AppDataError(allowed);
  if (!inWorkspaces(looker.view, schema)) return null;
  const open = looker.view.current!;
  const meant = row._workspace;
  if (typeof meant === "string" && meant !== open.id)
    throw new AppDataError(
      `You opened another ${looker.view.label.toLowerCase()} in a different window. Reload to carry on.`,
    );
  return open.id;
}

/**
 * A change from someone a shared route admitted. What they may change follows the rules in
 * @rakazo/app-kit/workspace, checked against the stored row inside the change itself.
 */
export async function writeSharedAppRow(
  prisma: PrismaClient,
  pageId: string,
  write: SharedRowWrite,
  looker: Looker & { userId: string },
  dataAccess: string,
  via: "shared" | "evolve" = "shared",
): Promise<{ row: RowOut; revision: number } | { revision: number }> {
  const userId = looker.userId;
  const workspaceId =
    write.op === "insert"
      ? await rowWorkspace(prisma, pageId, write.table, write.row, looker, dataAccess)
      : null;
  const schema = write.op === "insert" ? null : await tableSchema(prisma, pageId, write.table);
  const verb = write.op === "remove" ? "remove" : "change";
  const scope = {
    check: (row: RowFacts) => {
      if (!schema || editsRow(looker, schema, row, dataAccess)) return null;
      if (!seesRow(looker, schema, row)) return "That row is no longer there.";
      return editsRow(looker, schema, { ...row, createdBy: userId }, dataAccess)
        ? `You can ${verb} only the rows you added.`
        : `You can't ${verb} that row.`;
    },
  };
  const saved: { row: RowOut; revision: number } | { revision: number } = await runAsSystem(
    "app share write",
    (): Promise<{ row: RowOut; revision: number } | { revision: number }> => {
      if (write.op === "insert")
        return insertAppRow(prisma, pageId, write.table, write.row, userId, { via, workspaceId });
      if (write.op === "update")
        return updateAppRow(prisma, pageId, write.table, write.id, write.patch, userId, scope, {
          via,
        });
      return removeAppRow(prisma, pageId, write.table, write.id, scope, { userId, via });
    },
  );
  if (!("row" in saved)) return saved;
  return { ...saved, row: await rowForViewer(prisma, saved.row, { userId, names: true }) };
}

/** Whether someone signed in, who is not the owner, may change an app's rows (theirs or all). */
export const colleaguesMayWrite = (dataAccess: string) =>
  dataAccess === "company" || dataAccess === "contribute";

/** A photo added by someone the shared link or Evolve already admitted and allowed to edit. */
export function addSharedAppUpload(
  prisma: PrismaClient,
  pageId: string,
  input: { name: string; base64: string },
  userId: string,
) {
  return runAsSystem("app share upload", () =>
    addAppUpload(prisma, pageId, {
      name: input.name,
      bytes: new Uint8Array(Buffer.from(input.base64, "base64")),
      userId,
    }),
  );
}

/** The body of an upload request, or null when it is not a reasonable photo. */
export function readUploadBody(body: unknown): { name: string; base64: string } | null {
  if (!body || typeof body !== "object") return null;
  const { name, base64 } = body as { name?: unknown; base64?: unknown };
  if (typeof base64 !== "string" || !base64 || base64.length > MAX_UPLOAD_BASE64) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  return { name: typeof name === "string" ? name.slice(0, 200) : "photo", base64 };
}

export { AppVersionConflictError };

export class AppPublishError extends Error {}

/** Evolve's limit on a plugin's built files. */
const MAX_PLUGIN_BUNDLE_BYTES = 2 * 1024 * 1024;

/** Shown to Evolve's reviewers with the app's files: how the plugin reaches its data. */
const HOST_NOTE = `// Built by the OCSC App Studio. Inside Evolve the app kit sends every read and change
// through the plugin bridge as evolve.call('app.data', request), and Evolve's plugin-api forwards
// it to OCSC Intelligence, which answers for the app published under this plugin's slug only.
// Everyone who can open the plugin may read the app's data, except rows of personal tables,
// which only the person who added them and the app's owner see; changes follow the app's setting.
`;

export async function getEvolvePublication(
  prisma: PrismaClient,
  actor: Actor,
  connection: EvolvePluginsConnection | null,
  pageId: string,
) {
  await requireApp(prisma, actor, pageId);
  const page = await prisma.page.findUniqueOrThrow({
    where: { id: pageId },
    select: {
      evolvePluginSlug: true,
      evolvePluginRelease: true,
      brief: true,
      dossier: true,
      dossierVersion: true,
      currentVersion: true,
    },
  });
  return {
    available: connection !== null,
    slug: page.evolvePluginSlug,
    release: page.evolvePluginRelease,
    brief: page.brief,
    dossier: page.dossier,
    dossierVersion: page.dossierVersion,
    currentVersion: page.currentVersion,
  };
}

export async function saveAppBrief(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; brief: string },
) {
  const app = await requireApp(prisma, actor, input.pageId);
  const brief = input.brief.trim() || null;
  await prisma.page.update({ where: { id: app.id }, data: { brief } });
  return { brief };
}

/** Writes the AI review of the app's current version and keeps it with the app. */
export async function writeAppDossier(prisma: PrismaClient, actor: Actor, pageId: string) {
  const app = await requireApp(prisma, actor, pageId);
  const page = await prisma.page.findUniqueOrThrow({
    where: { id: app.id },
    select: {
      brief: true,
      visibility: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
      bot: { select: { name: true } },
      versions: { where: { version: app.currentVersion }, select: { source: true } },
      _count: { select: { versions: true, appAssets: true } },
    },
  });
  const tables = await readAppTables(prisma, app.id);
  const dossier = await writeDossier({
    title: app.title,
    brief: page.brief,
    version: app.currentVersion,
    versions: page._count.versions,
    createdAt: page.createdAt,
    creator: { name: page.user.name, email: page.user.email },
    builtBy: page.bot?.name ?? null,
    dataAccess: app.dataAccess,
    visibility: page.visibility,
    files: appFilesFrom(page.versions[0]?.source ?? "{}"),
    tables: Object.values(tables).map((table) => ({
      schema: table.schema,
      rows: table.rows.length,
    })),
    assets: page._count.appAssets,
  });
  await prisma.page.update({
    where: { id: app.id },
    data: { dossier, dossierVersion: app.currentVersion },
  });
  return { dossier, dossierVersion: app.currentVersion };
}

export async function publishAppToEvolve(
  prisma: PrismaClient,
  actor: Actor,
  connection: EvolvePluginsConnection | null,
  email: string | null,
  input: { pageId: string; slug: string; submitForReview: boolean; purpose?: string },
) {
  if (!connection || !email) throw new AppPublishError("Evolve is not connected here.");
  const app = await requireApp(prisma, actor, input.pageId);
  const page = await prisma.page.findUniqueOrThrow({
    where: { id: app.id },
    select: {
      evolvePluginRelease: true,
      frozenAt: true,
      brief: true,
      dossier: true,
      dossierVersion: true,
      versions: { where: { version: app.currentVersion }, select: { source: true } },
    },
  });
  const taken = await runAsSystem("Evolve plugin slug check", () =>
    prisma.page.findFirst({
      where: { evolvePluginSlug: input.slug, id: { not: app.id } },
      select: { id: true },
    }),
  );
  if (taken) throw new AppPublishError("Another app already uses that plugin name.");
  if (page.frozenAt)
    throw new AppPublishError("A company admin has frozen this app, so it can't be published.");
  const purpose = input.purpose?.trim() || page.brief || undefined;
  if (input.submitForReview && !purpose)
    throw new AppPublishError("Say what the app is for and who uses it, for Evolve's reviewers.");

  const files = appFilesFrom(page.versions[0]?.source ?? "{}");
  const built = await buildApp(files, { title: app.title });
  if (!built.ok)
    throw new AppPublishError(
      `The app could not be built: ${built.errors[0]?.message ?? "unknown problem"}`,
    );
  const bundle = pluginBundle(built, app.title);
  if (Buffer.byteLength(JSON.stringify(bundle)) > MAX_PLUGIN_BUNDLE_BYTES)
    throw new AppPublishError("The app is larger than Evolve allows for a plugin (2 MB).");
  const dossier =
    page.dossier && page.dossierVersion === app.currentVersion
      ? page.dossier
      : (await writeAppDossier(prisma, actor, app.id)).dossier;
  const release = page.evolvePluginRelease + 1;
  let result: {
    slug: string;
    version: string;
    status: string;
    checks?: Array<{ label: string; ok: boolean; detail?: string }>;
    previewUrl?: string;
    myPluginsUrl?: string;
    peerReviewers?: number;
  };
  try {
    result = await callEvolvePlugins(connection, email, {
      action: "submit",
      manifest: {
        slug: input.slug,
        name: app.title.slice(0, 80),
        description: (
          page.brief?.split(/(?<=[.!?])\s/)[0] ?? `${app.title}, an OCSC App Studio app.`
        ).slice(0, 280),
        version: `1.0.${release}`,
        icon: "LayoutDashboard",
        scopes: ["app.data"],
      },
      bundle,
      source: { ...files, "ocsc-app-host.ts": HOST_NOTE },
      engine: "ocsc-intelligence",
      submitForReview: input.submitForReview,
      purpose,
      brief: page.brief ?? undefined,
      dossier,
    });
  } catch (error) {
    if (error instanceof EvolvePluginsError) throw new AppPublishError(error.message);
    throw error;
  }
  await prisma.page.update({
    where: { id: app.id },
    data: { evolvePluginSlug: input.slug, evolvePluginRelease: release },
  });
  await recordAuditEvent({
    action: "app.published_to_evolve",
    actor: { type: "user", id: actor.userId },
    spaceId: actor.spaceId,
    target: { type: "app", id: app.id, label: app.title },
    metadata: { slug: input.slug, release, submitForReview: input.submitForReview },
  });
  return {
    slug: result.slug,
    version: result.version,
    status: result.status,
    checks: result.checks?.map((check) => ({
      label: String(check.label),
      ok: check.ok === true,
      ...(check.detail ? { detail: String(check.detail) } : {}),
    })),
    previewUrl: typeof result.previewUrl === "string" ? result.previewUrl : undefined,
    myPluginsUrl: typeof result.myPluginsUrl === "string" ? result.myPluginsUrl : undefined,
    peerReviewers: typeof result.peerReviewers === "number" ? result.peerReviewers : undefined,
  };
}
