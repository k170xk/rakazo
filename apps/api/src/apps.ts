import { createHash } from "node:crypto";
import type { EvolvePluginsConnection } from "@rakazo/adapters";
import { callEvolvePlugins, EvolvePluginsError } from "@rakazo/adapters";
import type { BuildProblem } from "@rakazo/app-kit/build";
import { buildApp, pluginBundle } from "@rakazo/app-kit/build";
import { exportTable, importWorkbook, scaffoldApp } from "@rakazo/app-kit/import";
import type { Actor, AppData, AppDataAccess } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import {
  AppVersionConflictError,
  addAppAsset,
  appendAppVersion,
  appFilesFrom,
  appRevision,
  createAppPage,
  defineAppTable,
  dropAppTable,
  IsolationError,
  insertAppRow,
  listAppAssets,
  mergeImportedTables,
  readAppAsset,
  readAppTables,
  removeAppRow,
  runAsSystem,
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
    select: { id: true, title: true, currentVersion: true, dataAccess: true },
  });
  if (!row) throw new IsolationError();
  return row;
}

const access = (value: string): AppDataAccess => (value === "company" ? "company" : "owner");

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
  return { tables, state, revision, dataAccess: access(app.dataAccess) };
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
  return insertAppRow(prisma, input.pageId, input.table, input.row, actor.userId);
}

export async function ownerUpdateRow(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; table: string; id: string; patch: Record<string, unknown> },
) {
  await requireApp(prisma, actor, input.pageId);
  return updateAppRow(prisma, input.pageId, input.table, input.id, input.patch, actor.userId);
}

export async function ownerRemoveRow(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; table: string; id: string },
) {
  await requireApp(prisma, actor, input.pageId);
  return removeAppRow(prisma, input.pageId, input.table, input.id);
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
  });
  return { table: result.table, rows: result.rows, revision: result.revision };
}

export async function ownerDropTable(
  prisma: PrismaClient,
  actor: Actor,
  input: { pageId: string; table: string },
) {
  await requireApp(prisma, actor, input.pageId);
  return dropAppTable(prisma, input.pageId, input.table);
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
    select: { version: true, title: true, createdAt: true },
  });
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
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

/** A new app from a workbook the person uploaded: the importer's tables and its scaffold. */
export async function importWorkbookApp(
  prisma: PrismaClient,
  actor: Actor,
  input: { title?: string; fileName: string; base64: string; botId?: string; groupId?: string },
) {
  // The app is listed with the bot or group it was made from, when that is the caller's own.
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
  });
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
export function readSharedAppData(prisma: PrismaClient, pageId: string) {
  return runAsSystem("app share data", async () => ({
    tables: await readAppTables(prisma, pageId),
    state: await readStateRows(prisma, pageId),
    revision: await appRevision(prisma, pageId),
  }));
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
export function writeSharedAppRow(
  prisma: PrismaClient,
  pageId: string,
  write: SharedRowWrite,
  userId: string,
) {
  return runAsSystem("app share write", () => {
    if (write.op === "insert") return insertAppRow(prisma, pageId, write.table, write.row, userId);
    if (write.op === "update")
      return updateAppRow(prisma, pageId, write.table, write.id, write.patch, userId);
    return removeAppRow(prisma, pageId, write.table, write.id);
  });
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
