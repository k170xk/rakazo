import type { TableSchema } from "@rakazo/app-kit/schema";
import { checkSchema } from "@rakazo/app-kit/schema";
import type { PrismaClient } from "./generated/prisma/client.js";
import { Prisma } from "./generated/prisma/client.js";

/**
 * The record of what changed in an app's data, kept so its owner can see each change and undo it.
 * Row writes record the row before and after; bulk loads, imports and drops record the whole table
 * as it was. Undo and redo work like a stack for each row and table: a change can be undone only
 * while nothing later has changed the same row or table, so an undo never loses newer work.
 */

export type ChangeVia = "assistant" | "studio" | "shared" | "evolve" | "import" | "template";
export type ChangeMeta = { userId?: string | null; via?: ChangeVia; runId?: string | null };
export type ChangeAction = "added" | "changed" | "removed" | "table";

type Tx = Prisma.TransactionClient;
type Data = Record<string, unknown>;

/** How many changes an app keeps, and how many of them may hold a whole table. */
export const MAX_APP_CHANGES = 500;
export const MAX_TABLE_SNAPSHOTS = 20;
/**
 * Changes younger than this stay past those limits, up to the hard caps, so a burst of removes or
 * table replaces cannot push earlier changes out before anyone notices; the history list still
 * shows the newest MAX_APP_CHANGES, and older recent ones stay recoverable by an admin.
 */
export const APP_CHANGE_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export const HARD_MAX_APP_CHANGES = 5000;
export const HARD_MAX_TABLE_SNAPSHOTS = 60;

export class AppHistoryError extends Error {}

type StoredRow = {
  id: string;
  data: Data;
  position: number;
  createdBy: string | null;
  updatedBy: string | null;
  /** Absent in changes recorded before apps had workspaces. */
  workspaceId?: string | null;
};

/** A table as it was: absent, its schema only, or its schema and every row. */
export type TableSnapshot =
  | { existed: false }
  | {
      existed: true;
      label: string;
      schema: unknown;
      position: number;
      rows: StoredRow[] | null;
    };

const asData = (value: unknown): Data =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Data) : {};

const jsonValue = (value: unknown) => value as Prisma.InputJsonValue;

function schemaOf(value: unknown): TableSchema | null {
  const checked = checkSchema(value);
  return checked.ok ? checked.schema : null;
}

/** The words a person knows a row by: its title column, else its first filled column. */
export function rowName(schema: TableSchema | null, data: Data): string {
  const key = schema?.title ?? schema?.columns[0]?.key;
  const value = key ? data[key] : undefined;
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text ? `“${text.slice(0, 60)}”` : "a row";
}

export async function snapshotTable(tx: Tx, pageId: string, name: string, withRows: boolean) {
  const table = await tx.appTable.findUnique({
    where: { pageId_name: { pageId, name } },
    select: { id: true, label: true, schema: true, position: true },
  });
  if (!table) return { existed: false } as TableSnapshot;
  const rows = withRows
    ? (
        await tx.appRow.findMany({
          where: { tableId: table.id },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            data: true,
            position: true,
            createdBy: true,
            updatedBy: true,
            workspaceId: true,
          },
        })
      ).map((row) => ({ ...row, data: asData(row.data) }))
    : null;
  return {
    existed: true,
    label: table.label,
    schema: table.schema,
    position: table.position,
    rows,
  } as TableSnapshot;
}

export async function recordChange(
  tx: Tx,
  pageId: string,
  entry: {
    table: string;
    label: string;
    action: ChangeAction;
    rowId?: string | null;
    before?: unknown;
    after?: unknown;
    summary: string;
  },
  meta: ChangeMeta = {},
) {
  await tx.appDataChange.create({
    data: {
      pageId,
      table: entry.table,
      label: entry.label,
      action: entry.action,
      rowId: entry.rowId ?? null,
      before: entry.before === undefined ? Prisma.JsonNull : jsonValue(entry.before),
      after: entry.after === undefined ? Prisma.JsonNull : jsonValue(entry.after),
      summary: entry.summary.slice(0, 300),
      userId: meta.userId ?? null,
      via: meta.via ?? null,
      runId: meta.runId ?? null,
    },
  });
  const old = { lt: new Date(Date.now() - APP_CHANGE_KEEP_MS) };
  const beyond = (where: Prisma.AppDataChangeWhereInput, skip: number, take: number) =>
    tx.appDataChange.findMany({
      where: { pageId, ...where },
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: { id: true },
    });
  const stale = [
    ...(await beyond({ createdAt: old }, MAX_APP_CHANGES, 200)),
    ...(await beyond({}, HARD_MAX_APP_CHANGES, 200)),
  ];
  if (entry.action === "table") {
    stale.push(
      ...(await beyond({ action: "table", createdAt: old }, MAX_TABLE_SNAPSHOTS, 50)),
      ...(await beyond({ action: "table" }, HARD_MAX_TABLE_SNAPSHOTS, 50)),
    );
  }
  const ids = [...new Set(stale.map((change) => change.id))];
  if (ids.length) await tx.appDataChange.deleteMany({ where: { id: { in: ids } } });
}

export type AppChangeEntry = {
  id: string;
  table: string;
  label: string;
  action: ChangeAction;
  summary: string;
  userId: string | null;
  via: string | null;
  createdAt: string;
  undone: boolean;
  /** Whether undo (or, once undone, redo) would be accepted now. */
  canUndo: boolean;
  canRedo: boolean;
  /** For a changed row: each column that changed, as it was and as it became. */
  fields?: Array<{ key: string; label: string; before: unknown; after: unknown }>;
};

/** The columns that differ between two versions of a row, labelled from its schema. */
export function changedFields(schema: TableSchema | null, before: Data, after: Data) {
  const labels = new Map(schema?.columns.map((column) => [column.key, column.label]) ?? []);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => !key.startsWith("_") && !sameValue(before[key], after[key]))
    .slice(0, 30)
    .map((key) => ({
      key,
      label: labels.get(key) ?? key,
      before: before[key] ?? null,
      after: after[key] ?? null,
    }));
}

/** Newest first, with the columns each row change touched. */
export async function listAppChanges(
  db: PrismaClient | Tx,
  pageId: string,
  limit = 100,
): Promise<AppChangeEntry[]> {
  const [all, tables] = await Promise.all([
    db.appDataChange.findMany({
      where: { pageId },
      orderBy: { createdAt: "desc" },
      take: MAX_APP_CHANGES,
      select: {
        id: true,
        table: true,
        label: true,
        action: true,
        rowId: true,
        summary: true,
        userId: true,
        via: true,
        createdAt: true,
        undoneAt: true,
      },
    }),
    db.appTable.findMany({ where: { pageId }, select: { name: true, schema: true } }),
  ]);
  const changes = all.slice(0, Math.min(Math.max(limit, 1), MAX_APP_CHANGES));
  const touches = (a: (typeof all)[number], b: (typeof all)[number]) =>
    a.table === b.table &&
    (a.action === "table" || b.action === "table" || (a.rowId !== null && a.rowId === b.rowId));
  const allowed = (change: (typeof all)[number]) => {
    const related = all.filter((other) => other.id !== change.id && touches(change, other));
    const laterStands = related.some((o) => o.createdAt > change.createdAt && !o.undoneAt);
    if (laterStands) return { canUndo: false, canRedo: false };
    if (!change.undoneAt) return { canUndo: true, canRedo: false };
    const blocked = related.some(
      (o) => o.undoneAt && o.createdAt < change.createdAt && o.undoneAt > change.createdAt,
    );
    return { canUndo: false, canRedo: !blocked };
  };
  const schemas = new Map(tables.map((table) => [table.name, schemaOf(table.schema)]));
  const updates = changes.filter((change) => change.action === "changed").map((c) => c.id);
  const bodies = updates.length
    ? await db.appDataChange.findMany({
        where: { id: { in: updates } },
        select: { id: true, before: true, after: true },
      })
    : [];
  const byId = new Map(bodies.map((body) => [body.id, body]));
  return changes.map((change) => {
    const body = byId.get(change.id);
    return {
      id: change.id,
      table: change.table,
      label: change.label,
      action: change.action as ChangeAction,
      summary: change.summary,
      userId: change.userId,
      via: change.via,
      createdAt: change.createdAt.toISOString(),
      undone: change.undoneAt !== null,
      ...allowed(change),
      ...(body
        ? {
            fields: changedFields(
              schemas.get(change.table) ?? null,
              asData(body.before),
              asData(body.after),
            ),
          }
        : {}),
    };
  });
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a as Data);
  const keysB = Object.keys(b as Data);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => sameValue((a as Data)[key], (b as Data)[key]));
}

async function restoreTable(tx: Tx, pageId: string, name: string, snapshot: TableSnapshot) {
  if (!snapshot.existed) {
    await tx.appTable.deleteMany({ where: { pageId, name } });
    return;
  }
  const schema = jsonValue(snapshot.schema);
  const table = await tx.appTable.upsert({
    where: { pageId_name: { pageId, name } },
    update: { label: snapshot.label, schema },
    create: { pageId, name, label: snapshot.label, schema, position: snapshot.position },
    select: { id: true },
  });
  if (!snapshot.rows) return;
  await tx.appRow.deleteMany({ where: { tableId: table.id } });
  await tx.appRow.createMany({
    data: snapshot.rows.map((row) => ({
      id: row.id,
      pageId,
      tableId: table.id,
      data: jsonValue(row.data),
      position: row.position,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      workspaceId: row.workspaceId ?? null,
    })),
  });
}

async function rowTable(tx: Tx, pageId: string, name: string) {
  const table = await tx.appTable.findUnique({
    where: { pageId_name: { pageId, name } },
    select: { id: true },
  });
  if (!table) throw new AppHistoryError("That table is no longer there; undo its removal first.");
  return table.id;
}

/**
 * Undoes a change (or, with redo, applies an undone one again), refusing when a later change to
 * the same row or table still stands, or an earlier one is still undone, so the order is kept.
 */
export async function undoAppChange(
  prisma: PrismaClient,
  pageId: string,
  changeId: string,
  options: { redo?: boolean; userId?: string | null } = {},
): Promise<{ revision: number }> {
  const redo = options.redo === true;
  return prisma.$transaction(
    async (tx) => {
      const change = await tx.appDataChange.findFirst({ where: { id: changeId, pageId } });
      if (!change) throw new AppHistoryError("That change is no longer in the history.");
      if (redo !== (change.undoneAt !== null)) {
        throw new AppHistoryError(
          redo ? "That change is already in place." : "That change was already undone.",
        );
      }
      const sameTarget = {
        pageId,
        table: change.table,
        ...(change.action === "table"
          ? {}
          : { OR: [{ rowId: change.rowId }, { action: "table" }] }),
      };
      const later = await tx.appDataChange.findFirst({
        where: { ...sameTarget, createdAt: { gt: change.createdAt }, undoneAt: null },
        select: { summary: true },
      });
      if (later) {
        throw new AppHistoryError(
          `A later change still stands (${later.summary}). Undo that first so it isn't lost.`,
        );
      }
      if (redo) {
        // An earlier change undone before this one was made was left behind by it; one undone
        // after it must come back first.
        const earlier = await tx.appDataChange.findFirst({
          where: {
            ...sameTarget,
            createdAt: { lt: change.createdAt },
            undoneAt: { gt: change.createdAt },
          },
          select: { summary: true },
        });
        if (earlier)
          throw new AppHistoryError(`Redo the earlier change first (${earlier.summary}).`);
      }

      const before = change.before as unknown;
      const after = change.after as unknown;
      switch (change.action) {
        case "added":
        case "removed": {
          const restoreRow = (change.action === "added") === redo;
          if (restoreRow) {
            const row = (change.action === "added" ? after : before) as StoredRow;
            const tableId = await rowTable(tx, pageId, change.table);
            const exists = await tx.appRow.findUnique({ where: { id: change.rowId! } });
            if (!exists) {
              await tx.appRow.create({
                data: {
                  id: change.rowId!,
                  pageId,
                  tableId,
                  data: jsonValue(row.data),
                  position: row.position,
                  createdBy: row.createdBy,
                  updatedBy: options.userId ?? row.updatedBy,
                  workspaceId: row.workspaceId ?? null,
                },
              });
            }
          } else {
            await tx.appRow.deleteMany({ where: { id: change.rowId!, pageId } });
          }
          break;
        }
        case "changed": {
          const target = asData(redo ? after : before);
          const updated = await tx.appRow.updateMany({
            where: { id: change.rowId!, pageId },
            data: { data: jsonValue(target), updatedBy: options.userId ?? null },
          });
          if (updated.count === 0) throw new AppHistoryError("That row is no longer there.");
          break;
        }
        case "table": {
          if (redo) {
            if (!after) throw new AppHistoryError("That change can't be applied again.");
            await restoreTable(tx, pageId, change.table, after as TableSnapshot);
          } else {
            const wasRows =
              (before as TableSnapshot).existed && (before as { rows: unknown }).rows !== null;
            const current = await snapshotTable(tx, pageId, change.table, wasRows);
            await tx.appDataChange.update({
              where: { id: change.id },
              data: { after: jsonValue(current) },
            });
            await restoreTable(tx, pageId, change.table, before as TableSnapshot);
          }
          break;
        }
        default:
          throw new AppHistoryError("That change can't be undone.");
      }
      await tx.appDataChange.update({
        where: { id: change.id },
        data: { undoneAt: redo ? null : new Date() },
      });
      const page = await tx.page.update({
        where: { id: pageId },
        data: { dataRevision: { increment: 1 } },
        select: { dataRevision: true },
      });
      return { revision: page.dataRevision };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
