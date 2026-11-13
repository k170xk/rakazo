import type { EvolvePluginsConnection } from "@rakazo/adapters";
import { callEvolveComputerMcp, EvolvePluginsError } from "@rakazo/adapters";
import type {
  AppComment,
  AppDelta,
  AppLive,
  AppPresence,
  AppRowChange,
} from "@rakazo/app-kit/protocol";
import { APP_CALL_OPS, APP_CALLS_PATH } from "@rakazo/app-kit/protocol";
import type { AggregateQuery, RowQuery } from "@rakazo/app-kit/query";
import { QueryError, runAggregate, runQuery } from "@rakazo/app-kit/query";
import type { Row, TableSchema } from "@rakazo/app-kit/schema";
import { checkSchema, isPersonalTable, withFormulas } from "@rakazo/app-kit/schema";
import { provenEmail } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import {
  AppCommentError,
  addAppComment,
  appRevision,
  countAppComments,
  listAppComments,
  listAppRowChanges,
  presenceFocus,
  pruneAppPresence,
  pruneAppRemovals,
  readAppDelta,
  readAppPresence,
  removeAppComment,
  runAsSystem,
  touchAppPresence,
} from "@rakazo/db";
import type { Hono } from "hono";
import type { AppServices } from "./app-services.js";
import { AppServiceError } from "./app-services.js";
import { requestBodyLimit } from "./request-body-limit.js";
import { windowCounter } from "./window-counter.js";

/**
 * The server side of an app's richer requests: live changes and presence, queries over large
 * tables, comments, row history, Evolve reads and free public data. Every route that admits a
 * person (the owner's session, a shared link, Evolve's signed call) hands them here as a caller,
 * and each op checks what that caller may see: personal tables keep others' rows hidden, and
 * visitors with only the password get no names, comments, Evolve data or services.
 */

export type AppCaller = {
  pageId: string;
  ownerId: string;
  /** The signed-in person; null for a visitor who opened the link with its password. */
  userId: string | null;
  via: "owner" | "shared" | "evolve";
};

export class AppCallError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 413 | 429 | 502 = 400,
  ) {
    super(message);
  }
}

export type AppCallDeps = {
  prisma: PrismaClient;
  services?: AppServices | null;
  /** Evolve's tools: the connection, and the names of the tools that only read (and are on). */
  evolve?: { connection: EvolvePluginsConnection; readTools: () => string[] } | null;
  now?: () => number;
};

const MINUTE_MS = 60_000;
const TABLE = /^[a-z][a-z0-9_]{0,39}$/;
const ROW_ID = /^[A-Za-z0-9_-]{1,64}$/;
const TOOL = /^[A-Za-z0-9_-]{1,64}$/;
/** Rows kept in memory across every cached table, for queries over large tables. */
const MAX_CACHED_ROWS = 200_000;
const MAX_EVOLVE_RESULT = 1_000_000;
const EVOLVE_CACHE_MS = 60_000;

type CachedTable = {
  revision: number;
  schema: TableSchema;
  rows: Row[];
  creators: Map<string, string | null>;
};

const objectOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function addTo<T>(lists: Record<string, T[]>, key: string, value: T) {
  const list = lists[key] ?? [];
  list.push(value);
  lists[key] = list;
}

function tableName(value: unknown): string {
  if (typeof value !== "string" || !TABLE.test(value)) throw new AppCallError("Name a table.");
  return value;
}

function rowId(value: unknown): string {
  if (typeof value !== "string" || !ROW_ID.test(value)) throw new AppCallError("Name a row.");
  return value;
}

function schemaOf(value: unknown, name: string, label: string): TableSchema {
  const checked = checkSchema(value);
  return checked.ok ? checked.schema : { name, label, columns: [] };
}

export function appCalls(deps: AppCallDeps) {
  const { prisma } = deps;
  const now = deps.now ?? Date.now;
  const tables = new Map<string, CachedTable>();
  const limits = {
    live: windowCounter(MINUTE_MS, now),
    query: windowCounter(MINUTE_MS, now),
    comments: windowCounter(MINUTE_MS, now),
    evolve: windowCounter(MINUTE_MS, now),
    services: windowCounter(MINUTE_MS, now),
  };
  const evolveCache = new Map<string, { at: number; value: unknown }>();

  const system = <T>(reason: string, fn: () => Promise<T>) => runAsSystem(reason, fn);

  function throttle(kind: keyof typeof limits, caller: AppCaller, max: number) {
    if (limits[kind](`${caller.userId ?? "visitor"}:${caller.pageId}`) > max)
      throw new AppCallError("Too many requests. Wait a moment.", 429);
  }

  function signedIn(caller: AppCaller, what: string): string {
    if (!caller.userId) throw new AppCallError(`Sign in to ${what}.`, 403);
    return caller.userId;
  }

  async function namesOf(ids: Iterable<string | null | undefined>) {
    const unique = [...new Set([...ids].filter((id): id is string => Boolean(id)))];
    if (!unique.length) return new Map<string, string | null>();
    const users = await system("app people's names", () =>
      prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }),
    );
    return new Map(users.map((user) => [user.id, user.name]));
  }

  /** Rows as this caller sees them: _mine on their own and, when signed in, _by with who added it. */
  async function marked(caller: AppCaller, rows: Row[], creators: Map<string, string | null>) {
    const names = caller.userId ? await namesOf(rows.map((row) => creators.get(row._id))) : null;
    return rows.map((row) => {
      const creator = creators.get(row._id);
      if (!creator) return row;
      return {
        ...row,
        _mine: creator === caller.userId,
        ...(names ? { _by: names.get(creator) ?? null } : {}),
      };
    });
  }

  /** Whether the caller sees a row of this table: everyone does, except others' personal rows. */
  function seesRow(caller: AppCaller, schema: TableSchema, creator: string | null | undefined) {
    if (!isPersonalTable(schema) || caller.userId === caller.ownerId) return true;
    return caller.userId !== null && creator === caller.userId;
  }

  async function loadTable(pageId: string, name: string): Promise<CachedTable> {
    const key = `${pageId}\0${name}`;
    const revision = await system("app revision for a query", () => appRevision(prisma, pageId));
    const known = tables.get(key);
    if (known && known.revision === revision) {
      tables.delete(key);
      tables.set(key, known);
      return known;
    }
    const loaded = await system("app table for a query", async () => {
      const table = await prisma.appTable.findUnique({
        where: { pageId_name: { pageId, name } },
        select: { id: true, name: true, label: true, schema: true },
      });
      if (!table) return null;
      const schema = schemaOf(table.schema, table.name, table.label);
      const rows = await prisma.appRow.findMany({
        where: { tableId: table.id },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { id: true, data: true, updatedAt: true, createdBy: true },
      });
      return {
        revision,
        schema,
        rows: rows.map((row) =>
          withFormulas(schema, {
            ...objectOf(row.data),
            _id: row.id,
            _updatedAt: row.updatedAt.toISOString(),
          } as Row),
        ),
        creators: new Map(rows.map((row) => [row.id, row.createdBy])),
      };
    });
    if (!loaded) throw new AppCallError(`This app has no table called ${name}.`, 404);
    tables.set(key, loaded);
    let total = [...tables.values()].reduce((sum, table) => sum + table.rows.length, 0);
    for (const [oldest, table] of tables) {
      if (total <= MAX_CACHED_ROWS || oldest === key) break;
      tables.delete(oldest);
      total -= table.rows.length;
    }
    return loaded;
  }

  async function visibleRows(caller: AppCaller, name: string) {
    const table = await loadTable(caller.pageId, name);
    const rows = isPersonalTable(table.schema)
      ? table.rows.filter((row) => seesRow(caller, table.schema, table.creators.get(row._id)))
      : table.rows;
    return { table, rows };
  }

  /** The table's schema, after checking the caller may see this row of it. */
  async function rowAccess(caller: AppCaller, name: string, id: string, mustExist: boolean) {
    const found = await system("app row access", async () => {
      const table = await prisma.appTable.findUnique({
        where: { pageId_name: { pageId: caller.pageId, name } },
        select: { id: true, name: true, label: true, schema: true },
      });
      if (!table) return null;
      const row = await prisma.appRow.findFirst({
        where: { id, tableId: table.id },
        select: { createdBy: true },
      });
      return { schema: schemaOf(table.schema, table.name, table.label), row };
    });
    if (!found) throw new AppCallError(`This app has no table called ${name}.`, 404);
    if ((mustExist || isPersonalTable(found.schema)) && !found.row)
      throw new AppCallError("That row is no longer there.", 404);
    if (!seesRow(caller, found.schema, found.row?.createdBy))
      throw new AppCallError("That row is no longer there.", 404);
    return found.schema;
  }

  async function live(caller: AppCaller, request: Record<string, unknown>): Promise<AppLive> {
    throttle("live", caller, 120);
    const since = typeof request.since === "number" ? Math.floor(request.since) : -1;
    if (caller.userId) {
      const userId = caller.userId;
      await system("app presence", () =>
        touchAppPresence(prisma, caller.pageId, userId, presenceFocus(request.focus)),
      );
    }
    const read = await system("app changes since a revision", () =>
      readAppDelta(prisma, caller.pageId, since),
    );
    const people = caller.userId
      ? await system("app presence", () => readAppPresence(prisma, caller.pageId))
      : [];
    const names = await namesOf(people.map((person) => person.userId));
    const presence: AppPresence[] = people.map((person) => ({
      id: person.userId,
      name: names.get(person.userId) ?? "Someone",
      focus: person.focus,
      ...(person.userId === caller.userId ? { me: true } : {}),
    }));
    if (Math.random() < 0.02) {
      void system("prune app live notes", async () => {
        await pruneAppRemovals(prisma, caller.pageId, read.revision);
        await pruneAppPresence(prisma, caller.pageId);
      }).catch(() => {});
    }
    if (read.full) return { revision: read.revision, presence, delta: null, full: true };
    const byId = new Map(read.tables.map((table) => [table.id, table]));
    const delta: AppDelta = { revision: read.revision, tables: {}, rows: {}, removed: {} };
    for (const table of read.tables) {
      const hidden = isPersonalTable(table.schema) && caller.userId !== caller.ownerId;
      delta.tables[table.name] = {
        schema: table.schema,
        ...(table.count !== undefined && !hidden ? { count: table.count } : {}),
      };
    }
    const creators = new Map(read.rows.map((row) => [row.id, row.createdBy]));
    const changed: Array<{ table: string; row: Row }> = [];
    for (const row of read.rows) {
      const table = byId.get(row.tableId);
      if (!table || !seesRow(caller, table.schema, row.createdBy)) continue;
      changed.push({
        table: table.name,
        row: withFormulas(table.schema, {
          ...row.data,
          _id: row.id,
          _updatedAt: row.updatedAt.toISOString(),
        } as Row),
      });
    }
    const shown = await marked(
      caller,
      changed.map((entry) => entry.row),
      creators,
    );
    changed.forEach((entry, index) => {
      addTo(delta.rows, entry.table, shown[index]!);
    });
    for (const gone of read.removed) {
      const table = byId.get(gone.tableId);
      if (table) addTo(delta.removed, table.name, gone.rowId);
    }
    return { revision: read.revision, presence, delta, full: false };
  }

  async function query(caller: AppCaller, request: Record<string, unknown>) {
    throttle("query", caller, 240);
    const { table, rows } = await visibleRows(caller, tableName(request.table));
    const result = runQuery(table.schema, rows, objectOf(request.query) as RowQuery);
    return { rows: await marked(caller, result.rows, table.creators), total: result.total };
  }

  async function aggregate(caller: AppCaller, request: Record<string, unknown>) {
    throttle("query", caller, 240);
    const { table, rows } = await visibleRows(caller, tableName(request.table));
    return runAggregate(table.schema, rows, objectOf(request.query) as AggregateQuery);
  }

  async function history(caller: AppCaller, request: Record<string, unknown>) {
    signedIn(caller, "see a row's history");
    throttle("query", caller, 240);
    const name = tableName(request.table);
    const id = rowId(request.rowId);
    await rowAccess(caller, name, id, false);
    const changes = await system("app row history", () =>
      listAppRowChanges(prisma, caller.pageId, name, id),
    );
    const names = await namesOf(changes.map((change) => change.userId));
    return changes.map(
      ({ userId, ...change }): AppRowChange => ({
        ...change,
        by: userId ? (names.get(userId) ?? null) : null,
      }),
    );
  }

  async function comments(caller: AppCaller, op: string, request: Record<string, unknown>) {
    const userId = signedIn(caller, "see and add comments");
    const isOwner = userId === caller.ownerId;
    const shape = async (
      list: Array<{ id: string; userId: string | null; body: string; createdAt: Date }>,
    ) => {
      const names = await namesOf(list.map((comment) => comment.userId));
      return list.map(
        (comment): AppComment => ({
          id: comment.id,
          body: comment.body,
          by: comment.userId ? (names.get(comment.userId) ?? null) : null,
          mine: comment.userId === userId,
          createdAt: comment.createdAt.toISOString(),
        }),
      );
    };
    try {
      if (op === "comments.counts") {
        throttle("query", caller, 240);
        const { table, rows } = await visibleRows(caller, tableName(request.table));
        const counts = await system("app comment counts", () =>
          countAppComments(prisma, caller.pageId, table.schema.name),
        );
        if (!isPersonalTable(table.schema) || isOwner) return counts;
        const own = new Set(rows.map((row) => row._id));
        return Object.fromEntries(Object.entries(counts).filter(([id]) => own.has(id)));
      }
      if (op === "comments.remove") {
        throttle("comments", caller, 30);
        const id = typeof request.commentId === "string" ? request.commentId.slice(0, 64) : "";
        if (!id) throw new AppCallError("Name a comment.");
        await system("remove an app comment", () =>
          removeAppComment(prisma, caller.pageId, id, { userId, isOwner }),
        );
        return null;
      }
      const name = tableName(request.table);
      const id = rowId(request.rowId);
      if (op === "comments.add") {
        throttle("comments", caller, 30);
        await rowAccess(caller, name, id, true);
        const body = typeof request.body === "string" ? request.body : "";
        const comment = await system("add an app comment", () =>
          addAppComment(prisma, caller.pageId, { table: name, rowId: id, userId, body }),
        );
        return (await shape([comment]))[0];
      }
      throttle("query", caller, 240);
      await rowAccess(caller, name, id, false);
      return shape(
        await system("app comments", () => listAppComments(prisma, caller.pageId, name, id)),
      );
    } catch (error) {
      if (error instanceof AppCommentError) throw new AppCallError(error.message);
      throw error;
    }
  }

  async function evolveRead(caller: AppCaller, request: Record<string, unknown>) {
    const userId = signedIn(caller, "see Evolve data");
    if (caller.via === "evolve" && userId !== caller.ownerId)
      throw new AppCallError("Evolve data is shown in this app in OCSC Intelligence.", 403);
    if (!deps.evolve) throw new AppCallError("Evolve is not connected here.", 404);
    const tool = typeof request.tool === "string" && TOOL.test(request.tool) ? request.tool : "";
    if (!tool || !deps.evolve.readTools().includes(tool))
      throw new AppCallError(`${tool || "That"} is not an Evolve tool apps can read with.`, 404);
    throttle("evolve", caller, 30);
    const user = await system("read an app viewer's email for Evolve", () =>
      prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, emailVerified: true },
      }),
    );
    const email = provenEmail(user);
    if (!email) throw new AppCallError("Evolve data needs an account with a verified email.", 403);
    const args = objectOf(request.args);
    const key = `${email}\0${tool}\0${JSON.stringify(args)}`;
    const known = evolveCache.get(key);
    if (known && now() - known.at < EVOLVE_CACHE_MS) return known.value;
    let reply: { result?: unknown; error?: { message?: unknown } };
    try {
      reply = await callEvolveComputerMcp(
        deps.evolve.connection,
        email,
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } },
        { timeoutMs: 60_000 },
      );
    } catch (error) {
      throw new AppCallError(
        error instanceof EvolvePluginsError
          ? `Evolve answered ${error.status}.`
          : "Evolve could not be reached.",
        502,
      );
    }
    if (reply.error)
      throw new AppCallError(
        typeof reply.error.message === "string" ? reply.error.message : "Evolve refused that.",
      );
    const value = evolveValue(reply.result);
    if (JSON.stringify(value ?? null).length > MAX_EVOLVE_RESULT)
      throw new AppCallError("Evolve sent more than an app can show; ask for less.", 413);
    evolveCache.set(key, { at: now(), value });
    if (evolveCache.size > 500) evolveCache.delete(evolveCache.keys().next().value!);
    return value;
  }

  async function service(caller: AppCaller, request: Record<string, unknown>) {
    signedIn(caller, "use outside data");
    if (!deps.services) throw new AppCallError("Outside data is not available here.", 404);
    throttle("services", caller, 60);
    try {
      return await deps.services.call(request.name, request.params);
    } catch (error) {
      if (error instanceof AppServiceError) throw new AppCallError(error.message, 502);
      throw error;
    }
  }

  return {
    /** Answers one request for a caller a route already admitted. */
    async handle(caller: AppCaller, body: unknown): Promise<unknown> {
      const request = objectOf(body);
      const op = typeof request.op === "string" ? request.op : "";
      if (!APP_CALL_OPS.has(op as never))
        throw new AppCallError("That is not something apps can ask.");
      try {
        switch (op) {
          case "live":
            return await live(caller, request);
          case "rows.query":
            return await query(caller, request);
          case "rows.aggregate":
            return await aggregate(caller, request);
          case "rows.history":
            return await history(caller, request);
          case "evolve.read":
            return await evolveRead(caller, request);
          case "service":
            return await service(caller, request);
          default:
            return await comments(caller, op, request);
        }
      } catch (error) {
        if (error instanceof QueryError) throw new AppCallError(error.message);
        throw error;
      }
    },
  };
}

export type AppCalls = ReturnType<typeof appCalls>;

/** An MCP tool result as plain data: its structured content, its text read as JSON, or the text. */
export function evolveValue(result: unknown): unknown {
  const data = objectOf(result);
  const content = Array.isArray(data.content) ? data.content : [];
  const text = content
    .map((part) => objectOf(part))
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
  if (data.isError === true) throw new AppCallError(text.slice(0, 300) || "Evolve refused that.");
  if (data.structuredContent !== undefined) return data.structuredContent;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The answer to send for a failed call, keeping internal errors out of the app. */
export function appCallFailure(error: unknown): { status: AppCallError["status"]; error: string } {
  if (error instanceof AppCallError) return { status: error.status, error: error.message };
  throw error;
}

/** The owner's own route: their session admits them to their own app. */
export function mountAppCalls(
  app: Hono,
  prisma: PrismaClient,
  signedInUser: (request: Request) => Promise<string | null>,
  calls: AppCalls,
) {
  const headers = { "cache-control": "no-store" };
  app.post(`${APP_CALLS_PATH}/:pageId`, requestBodyLimit(64_000), async (c) => {
    const userId = await signedInUser(c.req.raw);
    if (!userId) return c.json({ error: "Sign in" }, 401, headers);
    const pageId = (c.req.param("pageId") ?? "").slice(0, 64);
    const page = await runAsSystem("app owner call", () =>
      prisma.page.findUnique({ where: { id: pageId }, select: { userId: true, kind: true } }),
    );
    if (page?.kind !== "app" || page.userId !== userId)
      return c.json({ error: "Not found" }, 404, headers);
    try {
      const result = await calls.handle(
        { pageId, ownerId: userId, userId, via: "owner" },
        await c.req.json().catch(() => null),
      );
      return c.json({ result: result ?? null }, 200, headers);
    } catch (error) {
      const failure = appCallFailure(error);
      return c.json({ error: failure.error }, failure.status, headers);
    }
  });
}
