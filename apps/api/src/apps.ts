import { createHash } from "node:crypto";
import type { EvolvePluginsConnection } from "@rakazo/adapters";
import { callEvolvePlugins, drawAppIconLater, EvolvePluginsError } from "@rakazo/adapters";
import type { BuildProblem } from "@rakazo/app-kit/build";
import { buildApp, pluginBundle } from "@rakazo/app-kit/build";
import { exportTable, importWorkbook, scaffoldApp } from "@rakazo/app-kit/import";
import { MAX_UPLOAD_BASE64 } from "@rakazo/app-kit/protocol";
import { findTemplate } from "@rakazo/app-kit/templates";
import type { Actor, AppData, AppDataAccess } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import {
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
  readAppRowCreators,
  readAppTables,
  removeAppRow,
  runAsSystem,
  undoAppChange,
  updateAppRow,
} from "@rakazo/db";
import { askForApp } from "./app-ask.js";
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
 * Tables as one viewer sees them: _mine on the rows they added (contribute apps let them change
 * only those) and, for people signed in, _by with the name of whoever added each row.
 */
export async function tablesForViewer(
  prisma: PrismaClient,
  pageId: string,
  tables: Tables,
  viewer: RowViewer,
): Promise<Tables> {
  const creators = await runAsSystem("app row creators", () => readAppRowCreators(prisma, pageId));
  if (!creators.size) return tables;
  const names = viewer.names ? await creatorNames(prisma, creators.values()) : new Map();
  return Object.fromEntries(
    Object.entries(tables).map(([name, table]) => [
      name,
      {
        ...table,
        rows: table.rows.map((row) => marked(row, creators.get(row._id), viewer, names)),
      },
    ]),
  );
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
  const [tables, state, revision] = await Promise.all([
    readAppTables(prisma, pageId),
    readStateRows(prisma, pageId),
    appRevision(prisma, pageId),
  ]);
  return {
    tables: await tablesForViewer(prisma, pageId, tables, { userId: actor.userId, names: true }),
    state,
    revision,
    dataAccess: access(app.dataAccess),
    icon: app.iconAssetId,
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
  const saved = await insertAppRow(prisma, input.pageId, input.table, input.row, actor.userId, {
    via: "studio",
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

export async function getAppAssets(prisma: PrismaClient, actor: Actor, pageId: string) {
  await requireApp(prisma, actor, pageId);
  const rows = await listAppAssets(prisma, pageId);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function getAppAsset(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; assetId: string },
) {
  await requireApp(prisma, actor, input.pageId);
  const asset = await readAppAsset(prisma, input.pageId, input.assetId);
  if (!asset) throw new IsolationError();
  return { mime: asset.mime, base64: Buffer.from(asset.bytes).toString("base64") };
}

export async function uploadAppAsset(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; name: string; mime: string; base64: string },
) {
  await requireApp(prisma, actor, input.pageId);
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
  await requireApp(prisma, actor, input.pageId);
  await prisma.appAsset.deleteMany({ where: { id: input.assetId, pageId: input.pageId } });
  return { ok: true as const };
}

/** One table as a file, for the owner or a link reader the shared route already admitted. */
export async function exportAppTable(
  prisma: PrismaClient,
  pageId: string,
  table: string,
  format: "xlsx" | "csv",
) {
  const tables = await readAppTables(prisma, pageId);
  const found = tables[table];
  if (!found) throw new IsolationError();
  const bytes = exportTable(found.schema, found.rows, format);
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
  return exportAppTable(prisma, input.pageId, input.table, input.format);
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
export async function readSharedAppData(prisma: PrismaClient, pageId: string, viewer: RowViewer) {
  const data = await runAsSystem("app share data", async () => ({
    tables: await readAppTables(prisma, pageId),
    state: await readStateRows(prisma, pageId),
    revision: await appRevision(prisma, pageId),
    icon:
      (await prisma.page.findUnique({ where: { id: pageId }, select: { iconAssetId: true } }))
        ?.iconAssetId ?? null,
  }));
  return { ...data, tables: await tablesForViewer(prisma, pageId, data.tables, viewer) };
}

export function readSharedAppRevision(prisma: PrismaClient, pageId: string) {
  return runAsSystem("app share revision", () => appRevision(prisma, pageId));
}

export function readSharedAppAsset(prisma: PrismaClient, pageId: string, assetId: string) {
  return runAsSystem("app share asset", () => readAppAsset(prisma, pageId, assetId));
}

export function exportSharedAppTable(
  prisma: PrismaClient,
  pageId: string,
  table: string,
  format: "xlsx" | "csv",
) {
  return runAsSystem("app share export", () => exportAppTable(prisma, pageId, table, format));
}

export type SharedRowWrite =
  | { op: "insert"; table: string; row: Record<string, unknown> }
  | { op: "update"; table: string; id: string; patch: Record<string, unknown> }
  | { op: "remove"; table: string; id: string };

/** Only for a signed-in colleague, and only while the owner lets colleagues change the data. */
/**
 * A change from someone a shared route admitted and allowed to edit. In a contribute app they
 * change and remove only the rows they added; in a company app, any row.
 */
export async function writeSharedAppRow(
  prisma: PrismaClient,
  pageId: string,
  write: SharedRowWrite,
  userId: string,
  dataAccess: string,
  via: "shared" | "evolve" = "shared",
): Promise<{ row: RowOut; revision: number } | { revision: number }> {
  const scope = dataAccess === "company" ? {} : { onlyCreatedBy: userId };
  const saved: { row: RowOut; revision: number } | { revision: number } = await runAsSystem(
    "app share write",
    (): Promise<{ row: RowOut; revision: number } | { revision: number }> => {
      if (write.op === "insert")
        return insertAppRow(prisma, pageId, write.table, write.row, userId, { via });
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
// Everyone who can open the plugin may read the app's data; changes follow the app's own setting.
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
    select: { evolvePluginSlug: true, evolvePluginRelease: true },
  });
  return {
    available: connection !== null,
    slug: page.evolvePluginSlug,
    release: page.evolvePluginRelease,
  };
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
  if (input.submitForReview && !input.purpose)
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
  const release = page.evolvePluginRelease + 1;
  let result: {
    slug: string;
    version: string;
    status: string;
    checks?: Array<{ label: string; ok: boolean; detail?: string }>;
    previewUrl?: string;
    myPluginsUrl?: string;
  };
  try {
    result = await callEvolvePlugins(connection, email, {
      action: "submit",
      manifest: {
        slug: input.slug,
        name: app.title.slice(0, 80),
        description: `${app.title}, an OCSC App Studio app.`,
        version: `1.0.${release}`,
        icon: "LayoutDashboard",
        scopes: ["app.data"],
      },
      bundle,
      source: { ...files, "ocsc-app-host.ts": HOST_NOTE },
      engine: "ocsc-intelligence",
      submitForReview: input.submitForReview,
      purpose: input.purpose,
    });
  } catch (error) {
    if (error instanceof EvolvePluginsError) throw new AppPublishError(error.message);
    throw error;
  }
  await prisma.page.update({
    where: { id: app.id },
    data: { evolvePluginSlug: input.slug, evolvePluginRelease: release },
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
  };
}
