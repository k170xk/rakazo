import { randomUUID } from "node:crypto";
import type { TableSchema } from "@rakazo/app-kit/schema";
import { checkSchema, isLargeTable } from "@rakazo/app-kit/schema";
import { changedFields } from "./app-history.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { Prisma } from "./generated/prisma/client.js";

/**
 * What open copies of an app need to stay current without reading everything again: the rows
 * changed and removed since the revision they hold (stamped by the app_rows triggers), who else
 * has the app open, comments on rows, and each row's own history.
 */

type Db = PrismaClient | Prisma.TransactionClient;
type Data = Record<string, unknown>;

/** Removal notes older than this many revisions are dropped; copies further behind read everything. */
export const DELTA_KEEP_REVISIONS = 1000;
/** Past this many changed rows a full read is cheaper than a delta. */
export const MAX_DELTA_ROWS = 2000;
/** How long someone counts as here after their last check. */
export const PRESENCE_WINDOW_MS = 25_000;
/** A check within this long of the last one, with the same focus, writes nothing. */
const PRESENCE_REFRESH_MS = 8_000;
export const MAX_COMMENT_LENGTH = 4000;
export const MAX_COMMENTS_PER_ROW = 500;

const asData = (value: unknown): Data =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Data) : {};

function schemaOf(value: unknown, name: string, label: string): TableSchema {
  const checked = checkSchema(value);
  return checked.ok ? checked.schema : { name, label, columns: [] };
}

export type DeltaTable = { id: string; name: string; schema: TableSchema; count?: number };
export type DeltaRow = {
  id: string;
  tableId: string;
  data: Data;
  updatedAt: Date;
  createdBy: string | null;
  workspaceId: string | null;
};

export type AppDeltaRead =
  | { revision: number; full: true }
  | {
      revision: number;
      full: false;
      tables: DeltaTable[];
      rows: DeltaRow[];
      removed: Array<{ tableId: string; rowId: string }>;
    };

/**
 * Everything that changed after `since`, read in one snapshot so the revision, rows and removals
 * agree. Rows of large tables are left out (apps query those); full means read everything.
 */
export async function readAppDelta(
  prisma: PrismaClient,
  pageId: string,
  since: number,
): Promise<AppDeltaRead> {
  return prisma.$transaction(
    async (tx) => {
      const page = await tx.page.findUnique({
        where: { id: pageId },
        select: { dataRevision: true },
      });
      const revision = page?.dataRevision ?? 0;
      if (!Number.isInteger(since) || since < 0 || since > revision)
        return { revision, full: true };
      if (since < revision - DELTA_KEEP_REVISIONS) return { revision, full: true };
      if (since === revision) return { revision, full: false, tables: [], rows: [], removed: [] };
      const stored = await tx.appTable.findMany({
        where: { pageId },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, label: true, schema: true },
      });
      const tables: DeltaTable[] = stored.map((table) => ({
        id: table.id,
        name: table.name,
        schema: schemaOf(table.schema, table.name, table.label),
      }));
      const large = tables.filter((table) => isLargeTable(table.schema));
      const counts = large.length
        ? await tx.appRow.groupBy({
            by: ["tableId"],
            where: { tableId: { in: large.map((table) => table.id) } },
            _count: { _all: true },
          })
        : [];
      for (const table of large)
        table.count = counts.find((entry) => entry.tableId === table.id)?._count._all ?? 0;
      const rows = await tx.appRow.findMany({
        where: {
          pageId,
          revision: { gt: since },
          ...(large.length ? { tableId: { notIn: large.map((table) => table.id) } } : {}),
        },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          tableId: true,
          data: true,
          updatedAt: true,
          createdBy: true,
          workspaceId: true,
        },
        take: MAX_DELTA_ROWS + 1,
      });
      if (rows.length > MAX_DELTA_ROWS) return { revision, full: true };
      const removed = await tx.appRowRemoval.findMany({
        where: { pageId, revision: { gt: since } },
        select: { tableId: true, rowId: true },
        take: MAX_DELTA_ROWS + 1,
      });
      if (removed.length > MAX_DELTA_ROWS) return { revision, full: true };
      return {
        revision,
        full: false,
        tables,
        rows: rows.map((row) => ({ ...row, data: asData(row.data) })),
        removed,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

/** Drops removal notes no open copy can still need. */
export async function pruneAppRemovals(db: Db, pageId: string, revision: number) {
  await db.appRowRemoval.deleteMany({
    where: { pageId, revision: { lt: revision - DELTA_KEEP_REVISIONS } },
  });
}

export type PresenceFocus = { table: string; rowId: string };

const FOCUS_PART = /^[A-Za-z0-9_-]{1,64}$/;

/** A focus worth keeping: a table name and row id, nothing else. */
export function presenceFocus(value: unknown): PresenceFocus | null {
  const focus = value as Partial<PresenceFocus> | null;
  if (!focus || typeof focus !== "object") return null;
  if (typeof focus.table !== "string" || typeof focus.rowId !== "string") return null;
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(focus.table) || !FOCUS_PART.test(focus.rowId)) return null;
  return { table: focus.table, rowId: focus.rowId };
}

/** Marks someone as here; repeated checks with the same focus write at most every few seconds. */
export async function touchAppPresence(
  db: Db,
  pageId: string,
  userId: string,
  focus: PresenceFocus | null,
  now = new Date(),
) {
  const stale = new Date(now.getTime() - PRESENCE_REFRESH_MS);
  const value = focus ? JSON.stringify(focus) : null;
  await db.$executeRaw`
    INSERT INTO "app_presence" ("id", "pageId", "userId", "focus", "seenAt")
    VALUES (${randomUUID()}, ${pageId}, ${userId}, ${value}::jsonb, ${now})
    ON CONFLICT ("pageId", "userId") DO UPDATE
      SET "focus" = EXCLUDED."focus", "seenAt" = EXCLUDED."seenAt"
      WHERE "app_presence"."seenAt" < ${stale}
         OR "app_presence"."focus" IS DISTINCT FROM EXCLUDED."focus"`;
}

/** Everyone seen in the last few seconds, most recent first. */
export async function readAppPresence(db: Db, pageId: string, now = new Date()) {
  const rows = await db.appPresence.findMany({
    where: { pageId, seenAt: { gt: new Date(now.getTime() - PRESENCE_WINDOW_MS) } },
    orderBy: { seenAt: "desc" },
    select: { userId: true, focus: true },
    take: 50,
  });
  return rows.map((row) => ({ userId: row.userId, focus: presenceFocus(row.focus) }));
}

/** Clears presence rows nobody has refreshed for a day. */
export async function pruneAppPresence(db: Db, pageId: string, now = new Date()) {
  await db.appPresence.deleteMany({
    where: { pageId, seenAt: { lt: new Date(now.getTime() - 24 * 60 * 60_000) } },
  });
}

export class AppCommentError extends Error {}

export async function listAppComments(db: Db, pageId: string, table: string, rowId: string) {
  return db.appComment.findMany({
    where: { pageId, table, rowId },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true, body: true, createdAt: true },
    take: MAX_COMMENTS_PER_ROW,
  });
}

/** How many comments each row of a table has. */
export async function countAppComments(db: Db, pageId: string, table: string) {
  const groups = await db.appComment.groupBy({
    by: ["rowId"],
    where: { pageId, table },
    _count: { _all: true },
  });
  return Object.fromEntries(groups.map((group) => [group.rowId, group._count._all]));
}

/** Adds a comment and moves the revision, so open copies show it within seconds. */
export async function addAppComment(
  prisma: PrismaClient,
  pageId: string,
  input: { table: string; rowId: string; userId: string; body: string },
) {
  const body = input.body.trim();
  if (!body) throw new AppCommentError("Write something first.");
  if (body.length > MAX_COMMENT_LENGTH)
    throw new AppCommentError(`Comments are at most ${MAX_COMMENT_LENGTH} characters.`);
  return prisma.$transaction(async (tx) => {
    const count = await tx.appComment.count({
      where: { pageId, table: input.table, rowId: input.rowId },
    });
    if (count >= MAX_COMMENTS_PER_ROW)
      throw new AppCommentError("This row has as many comments as it can keep.");
    const comment = await tx.appComment.create({
      data: { pageId, table: input.table, rowId: input.rowId, userId: input.userId, body },
      select: { id: true, userId: true, body: true, createdAt: true },
    });
    await tx.page.update({ where: { id: pageId }, data: { dataRevision: { increment: 1 } } });
    return comment;
  });
}

/** Removes a comment its writer, or the app's owner, no longer wants. */
export async function removeAppComment(
  prisma: PrismaClient,
  pageId: string,
  commentId: string,
  by: { userId: string; isOwner: boolean },
) {
  return prisma.$transaction(async (tx) => {
    const comment = await tx.appComment.findFirst({
      where: { id: commentId, pageId },
      select: { userId: true, table: true, rowId: true },
    });
    if (!comment) throw new AppCommentError("That comment is no longer there.");
    if (!by.isOwner && comment.userId !== by.userId)
      throw new AppCommentError("You can remove only your own comments.");
    await tx.appComment.delete({ where: { id: commentId } });
    await tx.page.update({ where: { id: pageId }, data: { dataRevision: { increment: 1 } } });
    return comment;
  });
}

/** One row's changes, newest first, with the columns each change touched. */
export async function listAppRowChanges(
  db: Db,
  pageId: string,
  table: string,
  rowId: string,
  limit = 50,
) {
  const [changes, stored] = await Promise.all([
    db.appDataChange.findMany({
      where: { pageId, table, rowId, action: { in: ["added", "changed", "removed"] } },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
      select: {
        id: true,
        action: true,
        summary: true,
        userId: true,
        via: true,
        createdAt: true,
        undoneAt: true,
        before: true,
        after: true,
      },
    }),
    db.appTable.findUnique({
      where: { pageId_name: { pageId, name: table } },
      select: { name: true, label: true, schema: true },
    }),
  ]);
  const schema = stored ? schemaOf(stored.schema, stored.name, stored.label) : null;
  return changes
    .filter((change) => !change.undoneAt)
    .map((change) => ({
      id: change.id,
      action: change.action as "added" | "changed" | "removed",
      summary: change.summary,
      userId: change.userId,
      via: change.via,
      at: change.createdAt.toISOString(),
      ...(change.action === "changed"
        ? { fields: changedFields(schema, asData(change.before), asData(change.after)) }
        : {}),
    }));
}
