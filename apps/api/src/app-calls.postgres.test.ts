import type { AppLive } from "@rakazo/app-kit/protocol";
import type { PrismaClient } from "@rakazo/db";
import {
  appRevision,
  asSystem,
  createAppPage,
  createDb,
  insertAppRow,
  provisionMessagingIdentity,
  runAsSystem,
  runAsTenant,
} from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppCaller } from "./app-calls.js";
import { AppCallError, appCalls } from "./app-calls.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

const expenses = {
  name: "expenses",
  label: "Expenses",
  personal: true,
  large: true,
  columns: [
    { key: "item", label: "Item", type: "text" },
    { key: "amount", label: "Amount", type: "currency", currency: "EUR" },
  ],
};

describePostgres("app calls (PostgreSQL)", () => {
  const stamp = String(Date.now()).slice(-7);
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  let owner: { userId: string; spaceId: string };
  let colleague: { userId: string; spaceId: string };
  let appId: string;
  const signup = { signupsEnabled: undefined, signupAllowlist: undefined };
  const system = <T>(fn: () => Promise<T>) => runAsSystem("app calls test", fn);
  let calls: ReturnType<typeof appCalls>;
  const as = (who: "owner" | "colleague" | "visitor"): AppCaller => ({
    pageId: appId,
    ownerId: owner.userId,
    userId: who === "owner" ? owner.userId : who === "colleague" ? colleague.userId : null,
    via: who === "owner" ? "owner" : "shared",
  });

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    owner = await system(() =>
      provisionMessagingIdentity(
        prisma,
        { provider: "sendblue", address: `+1577${stamp}` },
        signup,
      ),
    );
    colleague = await system(() =>
      provisionMessagingIdentity(
        prisma,
        { provider: "sendblue", address: `+1578${stamp}` },
        signup,
      ),
    );
    const created = await runAsTenant(owner, () =>
      createAppPage(prisma, {
        ...owner,
        botId: null,
        groupId: null,
        title: "Expenses",
        files: { "App.tsx": "export default function App() { return null; }" },
        code: "<!doctype html><p>built</p>",
        tables: [{ schema: expenses as never, rows: [] }],
      }),
    );
    appId = created.pageId;
    for (const [userId, item, amount] of [
      [owner.userId, "Train to Cork", 64],
      [owner.userId, "Hotel Cork", 120],
      [colleague.userId, "Taxi Galway", 31],
    ] as const)
      await system(() => insertAppRow(prisma, appId, "expenses", { item, amount }, userId));
    calls = appCalls({
      prisma,
      services: { call: async (name) => ({ answered: name }) },
      evolve: null,
    });
  });

  afterAll(async () => {
    if (prisma) {
      const cleanup = asSystem(prisma, "test fixture cleanup");
      await cleanup.messagingIdentity.deleteMany({
        where: { provider: "sendblue", address: { in: [`+1577${stamp}`, `+1578${stamp}`] } },
      });
      const spaceIds = [owner?.spaceId, colleague?.spaceId].filter(Boolean) as string[];
      const userIds = [owner?.userId, colleague?.userId].filter(Boolean) as string[];
      await cleanup.organization.deleteMany({ where: { id: { in: spaceIds } } });
      await cleanup.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await close?.();
  });

  it("queries and sums a personal large table as each viewer may see it", async () => {
    const query = { op: "rows.query", table: "expenses", query: { sort: { column: "amount" } } };
    const mine = (await calls.handle(as("owner"), query)) as { rows: never[]; total: number };
    expect(mine.total).toBe(3);
    const theirs = (await calls.handle(as("colleague"), query)) as {
      rows: Array<{ item: string; _mine: boolean }>;
      total: number;
    };
    expect(theirs).toMatchObject({ total: 1, rows: [{ item: "Taxi Galway", _mine: true }] });
    expect(((await calls.handle(as("visitor"), query)) as { total: number }).total).toBe(0);
    const summed = await calls.handle(as("colleague"), {
      op: "rows.aggregate",
      table: "expenses",
      query: { metrics: [{ op: "sum", column: "amount", as: "total" }] },
    });
    expect(summed).toMatchObject({ total: 1, groups: [{ key: "all", values: { total: 31 } }] });
  });

  it("sends live changes and presence, hiding others' rows and private counts", async () => {
    const start = await system(() => appRevision(prisma, appId));
    await calls.handle(as("owner"), { op: "live", since: start });
    await system(() =>
      insertAppRow(prisma, appId, "expenses", { item: "Parking", amount: 9 }, owner.userId),
    );
    const live = (await calls.handle(as("colleague"), { op: "live", since: start })) as AppLive;
    expect(live.full).toBe(false);
    expect(live.delta?.tables.expenses).toEqual({ schema: expect.any(Object) });
    expect(live.delta?.rows).toEqual({});
    expect(live.presence.map((person) => Boolean(person.me)).sort()).toEqual([false, true]);
    const owners = (await calls.handle(as("owner"), { op: "live", since: start })) as AppLive;
    expect(owners.delta?.tables.expenses?.count).toBe(4);
    const visitors = (await calls.handle(as("visitor"), { op: "live", since: start })) as AppLive;
    expect(visitors.presence).toEqual([]);
  });

  it("keeps comments to people signed in who can see the row", async () => {
    const query = { op: "rows.query", table: "expenses", query: {} };
    const own = (await calls.handle(as("colleague"), query)) as { rows: Array<{ _id: string }> };
    const all = (await calls.handle(as("owner"), query)) as {
      rows: Array<{ _id: string; item: string }>;
    };
    const ownersRow = all.rows.find((row) => row.item === "Hotel Cork")!;
    const rowId = own.rows[0]!._id;
    const added = await calls.handle(as("colleague"), {
      op: "comments.add",
      table: "expenses",
      rowId,
      body: "Receipt attached",
    });
    expect(added).toMatchObject({ body: "Receipt attached", mine: true });
    expect(await calls.handle(as("owner"), { op: "comments.counts", table: "expenses" })).toEqual({
      [rowId]: 1,
    });
    await expect(
      calls.handle(as("colleague"), {
        op: "comments.add",
        table: "expenses",
        rowId: ownersRow._id,
        body: "Peeking",
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      calls.handle(as("visitor"), { op: "comments.list", table: "expenses", rowId }),
    ).rejects.toMatchObject({ status: 403 });
    const history = (await calls.handle(as("colleague"), {
      op: "rows.history",
      table: "expenses",
      rowId,
    })) as Array<{ action: string }>;
    expect(history.map((change) => change.action)).toEqual(["added"]);
  });

  it("refuses outside data to visitors, Evolve without a connection and unknown ops", async () => {
    expect(
      await calls.handle(as("colleague"), { op: "service", name: "weather", params: {} }),
    ).toEqual({ answered: "weather" });
    await expect(
      calls.handle(as("visitor"), { op: "service", name: "weather", params: {} }),
    ).rejects.toBeInstanceOf(AppCallError);
    await expect(
      calls.handle(as("owner"), { op: "evolve.read", tool: "list_projects", args: {} }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      calls.handle({ ...as("colleague"), via: "evolve" }, { op: "evolve.read", tool: "x" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(calls.handle(as("owner"), { op: "rows.insert" })).rejects.toBeInstanceOf(
      AppCallError,
    );
  });
});
