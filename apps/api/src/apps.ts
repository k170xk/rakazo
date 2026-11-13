import { createHash } from "node:crypto";
import type { EvolvePluginsConnection } from "@rakazo/adapters";
import { callEvolvePlugins, drawAppIconLater, EvolvePluginsError } from "@rakazo/adapters";
import type { BuildProblem } from "@rakazo/app-kit/build";
import { buildApp, pluginBundle } from "@rakazo/app-kit/build";
import { exportTable, importWorkbook, scaffoldApp } from "@rakazo/app-kit/import";
import { MAX_UPLOAD_BASE64 } from "@rakazo/app-kit/protocol";
import type { TableSchema } from "@rakazo/app-kit/schema";
import { isPersonalTable } from "@rakazo/app-kit/schema";
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
  recordAuditEvent,
  removeAppRow,
  runAsSystem,
  undoAppChange,
  updateAppRow,
} from "@rakazo/db";
import { askForApp } from "./app-ask.js";
import { writeDossier } from "./app-dossier.js";
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
 * only those) and, for people signed in, _by with the name of whoever added each row. In a
 * personal table anyone but the owner sees only the rows they added; a visitor sees none.
 */
export async function tablesForViewer(
  prisma: PrismaClient,
  pageId: string,
  tables: Tables,
  viewer: RowViewer,
  ownerId: string | null,
): Promise<Tables> {
  const isOwner = ownerId !== null && viewer.userId === ownerId;
  const hidesRows =
    !isOwner && Object.values(tables).some((table) => isPersonalTable(table.schema));
  const creators = await runAsSystem("app row creators", () => readAppRowCreators(prisma, pageId));
  if (!creators.size && !hidesRows) return tables;
  const ownRow = (row: RowOut) => viewer.userId !== null && creators.get(row._id) === viewer.userId;
  const visible = (table: Tables[string]) =>
    hidesRows && isPersonalTable(table.schema) ? table.rows.filter(ownRow) : table.rows;
  const shown = Object.entries(tables).map(
    ([name, table]) => [name, table, visible(table)] as const,
  );
  const names = viewer.names
    ? await creatorNames(
        prisma,
        shown.flatMap(([, , rows]) => rows.flatMap((row) => creators.get(row._id) ?? [])),
      )
    : new Map();
  return Object.fromEntries(
    shown.map(([name, table, rows]) => [
      name,
      {
        ...table,
        rows: rows.map((row) => marked(row, creators.get(row._id), viewer, names)),
        // A large personal table's count would reveal how many rows others added.
        ...(hidesRows && isPersonalTable(table.schema) ? { count: undefined } : {}),
      },
    ]),
  );
}

async function appOwnerId(prisma: PrismaClient, pageId: string): Promise<string | null> {
  const page = await runAsSystem("app owner", () =>
    prisma.page.findUnique({ where: { id: pageId }, select: { userId: true } }),
  );
  return page?.userId ?? null;
}

/** Whether someone other than the owner is changing a row of a personal table. */
async function othersPersonalTable(
  prisma: PrismaClient,
  pageId: string,
  table: string,
  userId: string,
): Promise<boolean> {
  const [ownerId, found] = await Promise.all([
    appOwnerId(prisma, pageId),
    runAsSystem("app table personal", () =>
      prisma.appTable.findUnique({
        where: { pageId_name: { pageId, name: table } },
        select: { schema: true },
      }),
    ),
  ]);
  return ownerId !== userId && isPersonalTable(found?.schema as TableSchema | null);
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
    readAppTables(prisma, pageId, { skipLarge: true }),
    readStateRows(prisma, pageId),
    appRevision(prisma, pageId),
  ]);
  return {
    tables: await tablesForViewer(
      prisma,
      pageId,
      tables,
      { userId: actor.userId, names: true },
      actor.userId,
    ),
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
  return tableFile(await readAppTables(prisma, pageId), table, format);
}

function tableFile(tables: Tables, table: string, format: "xlsx" | "csv") {
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
    tables: await readAppTables(prisma, pageId, { skipLarge: true }),
    state: await readStateRows(prisma, pageId),
    revision: await appRevision(prisma, pageId),
    page: await prisma.page.findUnique({
      where: { id: pageId },
      select: { iconAssetId: true, userId: true },
    }),
  }));
  const { page, ...rest } = data;
  return {
    ...rest,
    icon: page?.iconAssetId ?? null,
    tables: await tablesForViewer(prisma, pageId, data.tables, viewer, page?.userId ?? null),
  };
}

export function readSharedAppRevision(prisma: PrismaClient, pageId: string) {
  return runAsSystem("app share revision", () => appRevision(prisma, pageId));
}

/**
 * A picture for someone a shared route admitted. When the app has personal tables, a photo a
 * colleague added is shown to others only while a row they can see holds it.
 */
export async function readSharedAppAsset(
  prisma: PrismaClient,
  pageId: string,
  assetId: string,
  viewerId: string | null,
) {
  return runAsSystem("app share asset", async () => {
    const asset = await prisma.appAsset.findFirst({
      where: { id: assetId, pageId },
      select: { mime: true, bytes: true, name: true, source: true },
    });
    if (!asset) return null;
    const { source, ...shown } = asset;
    const uploader = source.startsWith("app:") ? source.slice(4) : null;
    if (!uploader || uploader === viewerId) return shown;
    const ownerId = await appOwnerId(prisma, pageId);
    if (uploader === ownerId || (ownerId !== null && viewerId === ownerId)) return shown;
    const tables = await prisma.appTable.findMany({
      where: { pageId },
      select: { id: true, schema: true },
    });
    const schemas = tables.map((table) => ({ id: table.id, schema: table.schema as TableSchema }));
    if (!schemas.some((table) => isPersonalTable(table.schema))) return shown;
    for (const { id, schema } of schemas) {
      const personal = isPersonalTable(schema);
      if (personal && !viewerId) continue;
      for (const column of schema.columns ?? []) {
        if (column.type !== "image") continue;
        const holder = await prisma.appRow.findFirst({
          where: {
            pageId,
            tableId: id,
            data: { path: [column.key], string_contains: assetId },
            ...(personal ? { createdBy: viewerId } : {}),
          },
          select: { id: true },
        });
        if (holder) return shown;
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
  viewerId: string | null,
) {
  const [tables, ownerId] = await Promise.all([
    runAsSystem("app share export", () => readAppTables(prisma, pageId)),
    appOwnerId(prisma, pageId),
  ]);
  const visible = await tablesForViewer(
    prisma,
    pageId,
    tables,
    { userId: viewerId, names: false },
    ownerId,
  );
  return tableFile(visible, table, format);
}

export type SharedRowWrite =
  | { op: "insert"; table: string; row: Record<string, unknown> }
  | { op: "update"; table: string; id: string; patch: Record<string, unknown> }
  | { op: "remove"; table: string; id: string };

/**
 * A change from someone a shared route admitted and allowed to edit. In a contribute app, and in
 * any personal table, they change and remove only the rows they added; otherwise any row.
 */
export async function writeSharedAppRow(
  prisma: PrismaClient,
  pageId: string,
  write: SharedRowWrite,
  userId: string,
  dataAccess: string,
  via: "shared" | "evolve" = "shared",
): Promise<{ row: RowOut; revision: number } | { revision: number }> {
  const anyRow =
    dataAccess === "company" &&
    (write.op === "insert" || !(await othersPersonalTable(prisma, pageId, write.table, userId)));
  const scope = anyRow ? {} : { onlyCreatedBy: userId };
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
