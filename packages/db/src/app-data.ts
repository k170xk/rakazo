import type { Row, TableSchema } from "@rakazo/app-kit/schema";
import {
  checkSchema,
  coerceRow,
  MAX_ROWS_PER_TABLE,
  MAX_TABLES,
  withFormulas,
} from "@rakazo/app-kit/schema";
import type { ChangeMeta } from "./app-history.js";
import { recordChange, rowName, snapshotTable } from "./app-history.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { Prisma } from "./generated/prisma/client.js";

/**
 * An app's data: named tables of rows, each checked against its table's schema on every write,
 * whoever writes (the owner, a colleague, the agent, a routine or an import). Every change moves
 * the page's dataRevision in the same transaction, so an open copy knows to fetch again.
 */

export class AppDataError extends Error {}

type Db = PrismaClient | Prisma.TransactionClient;

export type AppTables = Record<string, { schema: TableSchema; rows: Row[] }>;

const MAX_ROWS_READ = 50_000;

function asRow(row: { id: string; data: unknown; updatedAt: Date }): Row {
  const data =
    row.data && typeof row.data === "object" && !Array.isArray(row.data)
      ? (row.data as Record<string, unknown>)
      : {};
  return { ...data, _id: row.id, _updatedAt: row.updatedAt.toISOString() };
}

function storedSchema(value: unknown, name: string, label: string): TableSchema {
  const checked = checkSchema(value);
  return checked.ok ? checked.schema : { name, label, columns: [] };
}

export async function readAppTables(db: Db, pageId: string): Promise<AppTables> {
  const tables = await db.appTable.findMany({
    where: { pageId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, label: true, schema: true },
  });
  const rows = await db.appRow.findMany({
    where: { pageId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, tableId: true, data: true, updatedAt: true },
    take: MAX_ROWS_READ,
  });
  const byTable = new Map<string, Row[]>();
  for (const row of rows) {
    const list = byTable.get(row.tableId);
    if (list) list.push(asRow(row));
    else byTable.set(row.tableId, [asRow(row)]);
  }
  return Object.fromEntries(
    tables.map((table) => {
      const schema = storedSchema(table.schema, table.name, table.label);
      return [
        table.name,
        { schema, rows: (byTable.get(table.id) ?? []).map((row) => withFormulas(schema, row)) },
      ];
    }),
  );
}

/** Who added each row of an app (rows from the agent, imports and older rows have no one). */
export async function readAppRowCreators(db: Db, pageId: string): Promise<Map<string, string>> {
  const rows = await db.appRow.findMany({
    where: { pageId, createdBy: { not: null } },
    select: { id: true, createdBy: true },
    take: MAX_ROWS_READ,
  });
  return new Map(rows.map((row) => [row.id, row.createdBy!]));
}

/** Changes limited to the rows one person added, for apps where colleagues contribute. */
export type RowScope = { onlyCreatedBy?: string };

export async function appRevision(db: Db, pageId: string): Promise<number> {
  const page = await db.page.findUnique({ where: { id: pageId }, select: { dataRevision: true } });
  return page?.dataRevision ?? 0;
}

async function bump(tx: Prisma.TransactionClient, pageId: string) {
  const page = await tx.page.update({
    where: { id: pageId },
    data: { dataRevision: { increment: 1 } },
    select: { dataRevision: true },
  });
  return page.dataRevision;
}

async function tableFor(tx: Prisma.TransactionClient, pageId: string, name: string) {
  const table = await tx.appTable.findUnique({
    where: { pageId_name: { pageId, name } },
    select: { id: true, name: true, label: true, schema: true },
  });
  if (!table) throw new AppDataError(`This app has no table called ${name}.`);
  return {
    id: table.id,
    name: table.name,
    label: table.label,
    schema: storedSchema(table.schema, table.name, table.label),
  };
}

const json = (value: Record<string, unknown>) => value as Prisma.InputJsonObject;

export async function insertAppRow(
  prisma: PrismaClient,
  pageId: string,
  tableName: string,
  input: Record<string, unknown>,
  userId: string | null,
  meta: ChangeMeta = {},
): Promise<{ row: Row; revision: number }> {
  return prisma.$transaction(async (tx) => {
    const table = await tableFor(tx, pageId, tableName);
    const checked = coerceRow(table.schema, input);
    if (!checked.ok) throw new AppDataError(checked.error);
    const count = await tx.appRow.count({ where: { tableId: table.id } });
    if (count >= MAX_ROWS_PER_TABLE)
      throw new AppDataError(`${table.schema.label} already has as many rows as it can.`);
    const last = await tx.appRow.findFirst({
      where: { tableId: table.id },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const created = await tx.appRow.create({
      data: {
        pageId,
        tableId: table.id,
        data: json(checked.row),
        position: (last?.position ?? 0) + 1,
        updatedBy: userId,
        createdBy: userId,
      },
      select: { id: true, data: true, updatedAt: true, position: true },
    });
    await recordChange(
      tx,
      pageId,
      {
        table: table.name,
        label: table.label,
        action: "added",
        rowId: created.id,
        after: {
          data: checked.row,
          position: created.position,
          createdBy: userId,
          updatedBy: userId,
        },
        summary: `Added ${rowName(table.schema, checked.row)} to ${table.label}`,
      },
      { userId, ...meta },
    );
    return { row: asRow(created), revision: await bump(tx, pageId) };
  });
}

export async function updateAppRow(
  prisma: PrismaClient,
  pageId: string,
  tableName: string,
  rowId: string,
  patch: Record<string, unknown>,
  userId: string | null,
  scope: RowScope = {},
  meta: ChangeMeta = {},
): Promise<{ row: Row; revision: number }> {
  return prisma.$transaction(async (tx) => {
    const table = await tableFor(tx, pageId, tableName);
    const existing = await tx.appRow.findFirst({
      where: { id: rowId, tableId: table.id },
      select: { data: true, createdBy: true },
    });
    if (!existing) throw new AppDataError("That row is no longer there.");
    if (scope.onlyCreatedBy && existing.createdBy !== scope.onlyCreatedBy)
      throw new AppDataError("You can change only the rows you added.");
    const checked = coerceRow(table.schema, patch, { partial: true });
    if (!checked.ok) throw new AppDataError(checked.error);
    const before =
      existing.data && typeof existing.data === "object"
        ? (existing.data as Record<string, unknown>)
        : {};
    const next = { ...before, ...checked.row };
    const updated = await tx.appRow.update({
      where: { id: rowId },
      data: { data: json(next), updatedBy: userId },
      select: { id: true, data: true, updatedAt: true },
    });
    const columns = new Map(table.schema.columns.map((column) => [column.key, column.label]));
    const touched = Object.keys(checked.row)
      .filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(next[key] ?? null))
      .map((key) => columns.get(key) ?? key);
    if (touched.length) {
      await recordChange(
        tx,
        pageId,
        {
          table: table.name,
          label: table.label,
          action: "changed",
          rowId,
          before,
          after: next,
          summary: `Changed ${touched.slice(0, 4).join(", ")}${touched.length > 4 ? "…" : ""} on ${rowName(table.schema, next)}`,
        },
        { userId, ...meta },
      );
    }
    return { row: asRow(updated), revision: await bump(tx, pageId) };
  });
}

export async function removeAppRow(
  prisma: PrismaClient,
  pageId: string,
  tableName: string,
  rowId: string,
  scope: RowScope = {},
  meta: ChangeMeta = {},
) {
  return prisma.$transaction(async (tx) => {
    const table = await tableFor(tx, pageId, tableName);
    const existing = await tx.appRow.findFirst({
      where: { id: rowId, tableId: table.id },
      select: { data: true, position: true, createdBy: true, updatedBy: true },
    });
    if (scope.onlyCreatedBy && existing && existing.createdBy !== scope.onlyCreatedBy)
      throw new AppDataError("You can remove only the rows you added.");
    const removed = await tx.appRow.deleteMany({
      where: {
        id: rowId,
        tableId: table.id,
        ...(scope.onlyCreatedBy ? { createdBy: scope.onlyCreatedBy } : {}),
      },
    });
    if (removed.count === 0 || !existing) throw new AppDataError("That row is no longer there.");
    const data = (existing.data ?? {}) as Record<string, unknown>;
    await recordChange(
      tx,
      pageId,
      {
        table: table.name,
        label: table.label,
        action: "removed",
        rowId,
        before: { ...existing, data },
        summary: `Removed ${rowName(table.schema, data)} from ${table.label}`,
      },
      meta,
    );
    return { revision: await bump(tx, pageId) };
  });
}

export type RowsMode = "replace" | "append" | "upsert";

export type DefineTableResult = {
  table: string;
  rows: number;
  inserted: number;
  updated: number;
  removed: number;
  skipped: Array<{ index: number; error: string }>;
  revision: number;
};

/**
 * Creates a table or changes its schema, and optionally loads rows: replace swaps every row,
 * append adds, upsert matches rows on the table's key column (adding the rest). Rows that fail
 * their column checks are skipped and reported; the others still load.
 */
export async function defineAppTable(
  prisma: PrismaClient,
  pageId: string,
  input: {
    schema?: unknown;
    table?: string;
    rows?: unknown[];
    mode?: RowsMode;
    userId?: string | null;
    via?: ChangeMeta["via"];
  },
): Promise<DefineTableResult> {
  return prisma.$transaction(
    async (tx) => {
      let tableId: string;
      let schema: TableSchema;
      const name =
        input.schema !== undefined
          ? (checkSchema(input.schema) as { schema?: TableSchema }).schema?.name
          : input.table;
      const snapshot = name
        ? await snapshotTable(tx, pageId, name, input.rows !== undefined)
        : ({ existed: false } as const);
      if (input.schema !== undefined) {
        const checked = checkSchema(input.schema);
        if (!checked.ok) throw new AppDataError(checked.error);
        schema = checked.schema;
        const existing = await tx.appTable.findUnique({
          where: { pageId_name: { pageId, name: schema.name } },
          select: { id: true },
        });
        if (existing) {
          await tx.appTable.update({
            where: { id: existing.id },
            data: { label: schema.label, schema: schema as unknown as Prisma.InputJsonObject },
          });
          tableId = existing.id;
        } else {
          const count = await tx.appTable.count({ where: { pageId } });
          if (count >= MAX_TABLES)
            throw new AppDataError(`An app can have at most ${MAX_TABLES} tables.`);
          const created = await tx.appTable.create({
            data: {
              pageId,
              name: schema.name,
              label: schema.label,
              schema: schema as unknown as Prisma.InputJsonObject,
              position: count,
            },
            select: { id: true },
          });
          tableId = created.id;
        }
      } else {
        if (!input.table) throw new AppDataError("Name the table, or send its schema.");
        const found = await tableFor(tx, pageId, input.table);
        tableId = found.id;
        schema = found.schema;
      }
      let inserted = 0;
      let updated = 0;
      let removed = 0;
      const skipped: Array<{ index: number; error: string }> = [];
      if (input.rows) {
        const mode = input.mode ?? "replace";
        if (input.rows.length > MAX_ROWS_PER_TABLE)
          throw new AppDataError(`Send at most ${MAX_ROWS_PER_TABLE} rows.`);
        const clean: Array<Record<string, unknown>> = [];
        const given: Array<Set<string>> = [];
        input.rows.forEach((raw, index) => {
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            skipped.push({ index, error: "Each row must be an object of column values." });
            return;
          }
          const checked = coerceRow(schema, raw as Record<string, unknown>);
          if (checked.ok) {
            clean.push(checked.row);
            given.push(new Set(Object.keys(raw)));
          } else skipped.push({ index, error: checked.error });
        });
        if (mode === "replace") {
          removed = (await tx.appRow.deleteMany({ where: { tableId } })).count;
          await tx.appRow.createMany({
            data: clean.map((data, index) => ({
              pageId,
              tableId,
              data: json(data),
              position: index + 1,
              updatedBy: input.userId ?? null,
            })),
          });
          inserted = clean.length;
        } else {
          const existingRows = await tx.appRow.findMany({
            where: { tableId },
            select: { id: true, data: true, position: true },
          });
          let position = Math.max(0, ...existingRows.map((row) => row.position));
          const keyed = new Map<string, { id: string; data: Record<string, unknown> }>();
          if (mode === "upsert") {
            if (!schema.key)
              throw new AppDataError(
                `upsert needs the table to have a key column; set "key" in ${schema.name}'s schema.`,
              );
            for (const row of existingRows) {
              const data = (row.data ?? {}) as Record<string, unknown>;
              const key = data[schema.key];
              if (key !== null && key !== undefined && key !== "")
                keyed.set(String(key), { id: row.id, data });
            }
          }
          const fresh: Array<Record<string, unknown>> = [];
          for (const [index, data] of clean.entries()) {
            const match =
              mode === "upsert" ? keyed.get(String(data[schema.key!] ?? "")) : undefined;
            if (match) {
              const patch = Object.fromEntries(
                Object.entries(data).filter(([key]) => given[index]!.has(key)),
              );
              await tx.appRow.update({
                where: { id: match.id },
                data: { data: json({ ...match.data, ...patch }), updatedBy: input.userId ?? null },
              });
              updated++;
            } else fresh.push(data);
          }
          if (existingRows.length + fresh.length > MAX_ROWS_PER_TABLE) {
            throw new AppDataError(
              `${schema.label} would have more than ${MAX_ROWS_PER_TABLE} rows.`,
            );
          }
          await tx.appRow.createMany({
            data: fresh.map((data) => ({
              pageId,
              tableId,
              data: json(data),
              position: ++position,
              updatedBy: input.userId ?? null,
            })),
          });
          inserted = fresh.length;
        }
      }
      const rows = await tx.appRow.count({ where: { tableId } });
      const summary = !snapshot.existed
        ? `Created ${schema.label}${inserted ? ` with ${inserted} rows` : ""}`
        : input.rows === undefined
          ? `Changed the columns of ${schema.label}`
          : (input.mode ?? "replace") === "replace"
            ? `Replaced every row of ${schema.label} (${removed} → ${inserted})`
            : `Loaded rows into ${schema.label} (${updated} updated, ${inserted} added)`;
      await recordChange(
        tx,
        pageId,
        { table: schema.name, label: schema.label, action: "table", before: snapshot, summary },
        { userId: input.userId ?? null, via: input.via },
      );
      return {
        table: schema.name,
        rows,
        inserted,
        updated,
        removed,
        skipped: skipped.slice(0, 20),
        revision: await bump(tx, pageId),
      };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

export async function dropAppTable(
  prisma: PrismaClient,
  pageId: string,
  name: string,
  meta: ChangeMeta = {},
) {
  return prisma.$transaction(
    async (tx) => {
      const snapshot = await snapshotTable(tx, pageId, name, true);
      const removed = await tx.appTable.deleteMany({ where: { pageId, name } });
      if (removed.count === 0 || !snapshot.existed)
        throw new AppDataError(`This app has no table called ${name}.`);
      await recordChange(
        tx,
        pageId,
        {
          table: name,
          label: snapshot.label,
          action: "table",
          before: snapshot,
          summary: `Removed the table ${snapshot.label} (${snapshot.rows?.length ?? 0} rows)`,
        },
        meta,
      );
      return { revision: await bump(tx, pageId) };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

export const MAX_ASSET_BYTES = 6 * 1024 * 1024;
export const MAX_APP_ASSET_BYTES = 60 * 1024 * 1024;
export const ASSET_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

export async function addAppAsset(
  prisma: PrismaClient,
  pageId: string,
  input: { name: string; mime: string; bytes: Uint8Array; source: string },
): Promise<{ id: string; name: string; mime: string; size: number }> {
  if (!ASSET_MIMES.has(input.mime))
    throw new AppDataError("Apps keep PNG, JPEG, WebP, GIF or SVG pictures.");
  if (input.bytes.byteLength > MAX_ASSET_BYTES)
    throw new AppDataError("That picture is larger than 6 MB.");
  const used = await prisma.appAsset.aggregate({ where: { pageId }, _sum: { size: true } });
  if ((used._sum.size ?? 0) + input.bytes.byteLength > MAX_APP_ASSET_BYTES) {
    throw new AppDataError("This app keeps as many pictures as it can; remove some first.");
  }
  return prisma.appAsset.create({
    data: {
      pageId,
      name: input.name.slice(0, 200),
      mime: input.mime,
      size: input.bytes.byteLength,
      bytes: Buffer.from(input.bytes),
      source: input.source,
    },
    select: { id: true, name: true, mime: true, size: true },
  });
}

/** Keeps a PNG as the app's icon, replacing any icon it had; returns the new asset's id. */
export async function setAppIcon(
  prisma: PrismaClient,
  pageId: string,
  png: Uint8Array,
): Promise<string> {
  if (png.byteLength > MAX_ASSET_BYTES) throw new AppDataError("That icon is too large.");
  return prisma.$transaction(async (tx) => {
    await tx.appAsset.deleteMany({ where: { pageId, source: "icon" } });
    const asset = await tx.appAsset.create({
      data: {
        pageId,
        name: "App icon",
        mime: "image/png",
        size: png.byteLength,
        bytes: Buffer.from(png),
        source: "icon",
      },
      select: { id: true },
    });
    // The revision moves so open copies read the app again and show the new icon.
    await tx.page.update({
      where: { id: pageId },
      data: { iconAssetId: asset.id, dataRevision: { increment: 1 } },
    });
    return asset.id;
  });
}

const UPLOAD_KINDS: Array<{ mime: string; matches: (bytes: Uint8Array) => boolean }> = [
  { mime: "image/jpeg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: "image/png",
    matches: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: "image/webp",
    matches: (b) =>
      String.fromCharCode(...b.subarray(0, 4)) === "RIFF" &&
      String.fromCharCode(...b.subarray(8, 12)) === "WEBP",
  },
];

/** The kind of picture these bytes really are (JPEG, PNG or WebP), whatever they claim. */
export function sniffUploadMime(bytes: Uint8Array): string | null {
  return UPLOAD_KINDS.find((kind) => kind.matches(bytes))?.mime ?? null;
}

export const MAX_APP_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * A photo someone added while using the app (not the owner's Studio pictures): JPEG, PNG or WebP
 * only, checked by its bytes, within the app's picture budget, and remembered as theirs.
 */
export async function addAppUpload(
  prisma: PrismaClient,
  pageId: string,
  input: { name: string; bytes: Uint8Array; userId: string | null },
): Promise<{ id: string }> {
  const mime = sniffUploadMime(input.bytes);
  if (!mime) throw new AppDataError("Photos must be JPEG, PNG or WebP pictures.");
  if (input.bytes.byteLength > MAX_APP_UPLOAD_BYTES)
    throw new AppDataError("That photo is larger than 4 MB.");
  const name =
    input.name
      .replace(/[^\w .()-]+/g, "")
      .trim()
      .slice(0, 120) || "photo";
  const asset = await addAppAsset(prisma, pageId, {
    name,
    mime,
    bytes: input.bytes,
    source: input.userId ? `app:${input.userId}` : "app",
  });
  return { id: asset.id };
}

export async function listAppAssets(db: Db, pageId: string) {
  return db.appAsset.findMany({
    where: { pageId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, mime: true, size: true, source: true, createdAt: true },
  });
}

export async function readAppAsset(db: Db, pageId: string, assetId: string) {
  return db.appAsset.findFirst({
    where: { id: assetId, pageId },
    select: { mime: true, bytes: true, name: true },
  });
}

/** An app version's files, from the JSON its source column keeps. */
export function appFilesFrom(source: string): Record<string, string> {
  try {
    const parsed = JSON.parse(source) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    }
  } catch {}
  return {};
}

export class AppVersionConflictError extends Error {
  constructor() {
    super("The app changed while saving; open it again and retry.");
  }
}

/** A new app page with its first version and, optionally, its tables already loaded. */
export async function createAppPage(
  prisma: PrismaClient,
  input: {
    spaceId: string;
    userId: string;
    botId: string | null;
    groupId: string | null;
    title: string;
    files: Record<string, string>;
    code: string;
    tables?: Array<{ schema: TableSchema; rows: Array<Record<string, unknown>> }>;
    dataAccess?: "owner" | "contribute";
    via?: "assistant" | "studio" | "import" | "template";
  },
): Promise<{ pageId: string; version: number; title: string }> {
  const created = await prisma.page.create({
    data: {
      spaceId: input.spaceId,
      userId: input.userId,
      botId: input.botId,
      groupId: input.groupId,
      title: input.title,
      kind: "app",
      ...(input.dataAccess ? { dataAccess: input.dataAccess } : {}),
      versions: {
        create: {
          version: 1,
          title: input.title,
          source: JSON.stringify(input.files),
          code: input.code,
          authorId: input.userId,
          via: input.via ?? null,
        },
      },
    },
    select: { id: true, title: true },
  });
  try {
    for (const table of input.tables ?? []) {
      await defineAppTable(prisma, created.id, {
        schema: table.schema,
        rows: table.rows,
        mode: "replace",
        via: input.via,
      });
    }
  } catch (error) {
    await prisma.page.delete({ where: { id: created.id } }).catch(() => {});
    throw error;
  }
  return { pageId: created.id, version: 1, title: created.title };
}

/** Saves files as the app's next version, only if nobody saved since baseVersion. */
export async function appendAppVersion(
  prisma: PrismaClient,
  input: {
    pageId: string;
    baseVersion: number;
    files: Record<string, string>;
    code: string;
    title?: string;
    authorId?: string | null;
    via?: "assistant" | "studio" | "restore" | "import";
    restoredFrom?: number;
  },
): Promise<{ version: number; title: string }> {
  return prisma.$transaction(async (tx) => {
    const version = input.baseVersion + 1;
    const moved = await tx.page.updateMany({
      where: { id: input.pageId, currentVersion: input.baseVersion, kind: "app" },
      data: {
        currentVersion: version,
        updatedAt: new Date(),
        ...(input.title ? { title: input.title } : {}),
      },
    });
    if (moved.count === 0) throw new AppVersionConflictError();
    const { title } = await tx.page.findUniqueOrThrow({
      where: { id: input.pageId },
      select: { title: true },
    });
    await tx.pageVersion.create({
      data: {
        pageId: input.pageId,
        version,
        title,
        source: JSON.stringify(input.files),
        code: input.code,
        authorId: input.authorId ?? null,
        via: input.via ?? null,
        restoredFrom: input.restoredFrom ?? null,
      },
    });
    return { version, title };
  });
}

export function isAppDataError(error: unknown): error is AppDataError {
  return (
    error instanceof AppDataError ||
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025")
  );
}

/**
 * A newer copy of a workbook read into an app: sheets matching a table update rows by the table's
 * key (or append without one), keep the app's own columns and add new ones; new sheets become new
 * tables. Returns a line per table for the person.
 */
export async function mergeImportedTables(
  prisma: PrismaClient,
  pageId: string,
  imported: Array<{ schema: TableSchema; rows: Array<Record<string, unknown>> }>,
  userId: string | null,
): Promise<string[]> {
  const existing = await readAppTables(prisma, pageId);
  const report: string[] = [];
  for (const table of imported) {
    const current = existing[table.schema.name]?.schema;
    if (!current) {
      const result = await defineAppTable(prisma, pageId, {
        schema: table.schema,
        rows: table.rows,
        mode: "replace",
        userId,
        via: "import",
      });
      report.push(`New table ${table.schema.label}: ${result.inserted} rows.`);
      continue;
    }
    const known = new Set(current.columns.map((column) => column.key));
    const added = table.schema.columns.filter((column) => !known.has(column.key));
    const result = await defineAppTable(prisma, pageId, {
      schema: { ...current, columns: [...current.columns, ...added] },
      rows: table.rows,
      mode: current.key ? "upsert" : "append",
      userId,
      via: "import",
    });
    report.push(
      `${current.label}: ${result.updated} updated, ${result.inserted} added` +
        (added.length ? `, new columns ${added.map((column) => column.label).join(", ")}` : "") +
        (result.skipped.length ? `, ${result.skipped.length} rows skipped` : "") +
        ".",
    );
  }
  return report;
}
