import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appRevision,
  createAppPage,
  defineAppTable,
  insertAppRow,
  readAppTables,
  removeAppRow,
  updateAppRow,
} from "./app-data.js";
import {
  AppCommentError,
  addAppComment,
  countAppComments,
  listAppComments,
  listAppRowChanges,
  readAppDelta,
  readAppPresence,
  removeAppComment,
  touchAppPresence,
} from "./app-live.js";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { provisionMessagingIdentity } from "./messaging.js";
import { asSystem, runAsSystem, runAsTenant } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

const jobs = {
  name: "jobs",
  label: "Jobs",
  title: "name",
  columns: [
    { key: "name", label: "Name", type: "text", required: true },
    {
      key: "stage",
      label: "Stage",
      type: "enum",
      options: [{ value: "Design" }, { value: "Live" }],
    },
  ],
};
const log = {
  name: "log",
  label: "Log",
  large: true,
  columns: [{ key: "note", label: "Note", type: "text" }],
};

describePostgres("app live changes, presence and comments (PostgreSQL)", () => {
  const stamp = String(Date.now()).slice(-7);
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  let owner: { userId: string; spaceId: string };
  let colleague: { userId: string; spaceId: string };
  let appId: string;
  const signup = { signupsEnabled: undefined, signupAllowlist: undefined };
  const system = <T>(fn: () => Promise<T>) => runAsSystem("app live test", fn);

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
        { provider: "sendblue", address: `+1567${stamp}` },
        signup,
      ),
    );
    colleague = await system(() =>
      provisionMessagingIdentity(
        prisma,
        { provider: "sendblue", address: `+1568${stamp}` },
        signup,
      ),
    );
    const created = await runAsTenant(owner, () =>
      createAppPage(prisma, {
        ...owner,
        botId: null,
        groupId: null,
        title: "Live tracker",
        files: { "App.tsx": "export default function App() { return null; }" },
        code: "<!doctype html><p>built</p>",
        tables: [
          {
            schema: jobs as never,
            rows: [
              { name: "Quay bridge", stage: "Design" },
              { name: "Depot", stage: "Live" },
            ],
          },
          { schema: log as never, rows: [{ note: "one" }, { note: "two" }, { note: "three" }] },
        ],
      }),
    );
    appId = created.pageId;
  });

  afterAll(async () => {
    if (prisma) {
      const cleanup = asSystem(prisma, "test fixture cleanup");
      await cleanup.messagingIdentity.deleteMany({
        where: { provider: "sendblue", address: { in: [`+1567${stamp}`, `+1568${stamp}`] } },
      });
      const spaceIds = [owner?.spaceId, colleague?.spaceId].filter(Boolean) as string[];
      const userIds = [owner?.userId, colleague?.userId].filter(Boolean) as string[];
      await cleanup.organization.deleteMany({ where: { id: { in: spaceIds } } });
      await cleanup.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await close?.();
  });

  it("sends only what changed since a revision, with removals, and large tables as counts", async () => {
    const start = await system(() => appRevision(prisma, appId));
    const quiet = await system(() => readAppDelta(prisma, appId, start));
    expect(quiet).toEqual({ revision: start, full: false, tables: [], rows: [], removed: [] });

    const before = await system(() => readAppTables(prisma, appId));
    const [quay, depot] = before.jobs!.rows;
    const added = await system(() =>
      insertAppRow(prisma, appId, "jobs", { name: "Library" }, owner.userId),
    );
    await system(() =>
      updateAppRow(
        prisma,
        appId,
        "jobs",
        quay!._id,
        { stage: "Live" },
        colleague.userId,
        {},
        {
          userId: colleague.userId,
        },
      ),
    );
    await system(() =>
      removeAppRow(prisma, appId, "jobs", depot!._id, {}, { userId: owner.userId }),
    );
    await system(() => insertAppRow(prisma, appId, "log", { note: "four" }, owner.userId));

    const delta = await system(() => readAppDelta(prisma, appId, start));
    expect(delta.full).toBe(false);
    if (delta.full) return;
    expect(delta.revision).toBe(start + 4);
    expect(delta.tables.map((table) => [table.name, table.count])).toEqual([
      ["jobs", undefined],
      ["log", 4],
    ]);
    expect(delta.rows.map((row) => row.data.name).sort()).toEqual(["Library", "Quay bridge"]);
    expect(delta.rows.find((row) => row.id === quay!._id)?.data.stage).toBe("Live");
    expect(delta.removed.map((gone) => gone.rowId)).toEqual([depot!._id]);

    const later = await system(() => readAppDelta(prisma, appId, start + 2));
    if (later.full) throw new Error("expected a delta");
    expect(later.rows).toEqual([]);
    expect(later.removed.map((gone) => gone.rowId)).toEqual([depot!._id]);
    expect(added.row._id).toBeTruthy();

    expect((await system(() => readAppDelta(prisma, appId, -1))).full).toBe(true);
    expect((await system(() => readAppDelta(prisma, appId, start + 99))).full).toBe(true);

    const skipped = await system(() => readAppTables(prisma, appId, { skipLarge: true }));
    expect(skipped.log).toMatchObject({ rows: [], count: 4 });
    expect(skipped.jobs!.rows).toHaveLength(2);
  });

  it("falls back to a full read after a whole-table replace removes many rows", async () => {
    const start = await system(() => appRevision(prisma, appId));
    const many = Array.from({ length: 2100 }, (_, index) => ({ note: `n${index}` }));
    await system(() => defineAppTable(prisma, appId, { table: "log", rows: many }));
    await system(() => defineAppTable(prisma, appId, { table: "log", rows: [{ note: "fresh" }] }));
    const delta = await system(() => readAppDelta(prisma, appId, start + 1));
    expect(delta.full).toBe(true);
  });

  it("keeps who is here and which row they have open, for a short while", async () => {
    const now = new Date();
    const jobsTable = await system(() => readAppTables(prisma, appId));
    const rowId = jobsTable.jobs!.rows[0]!._id;
    await system(() => touchAppPresence(prisma, appId, owner.userId, null, now));
    await system(() =>
      touchAppPresence(prisma, appId, colleague.userId, { table: "jobs", rowId }, now),
    );
    const here = await system(() => readAppPresence(prisma, appId, now));
    expect(here.map((person) => person.userId).sort()).toEqual(
      [owner.userId, colleague.userId].sort(),
    );
    expect(here.find((person) => person.userId === colleague.userId)?.focus).toEqual({
      table: "jobs",
      rowId,
    });
    const gone = await system(() =>
      readAppPresence(prisma, appId, new Date(now.getTime() + 60_000)),
    );
    expect(gone).toEqual([]);
  });

  it("keeps comments per row, bumps the revision, and lets only the writer or owner remove one", async () => {
    const tables = await system(() => readAppTables(prisma, appId));
    const rowId = tables.jobs!.rows[0]!._id;
    const before = await system(() => appRevision(prisma, appId));
    const comment = await system(() =>
      addAppComment(prisma, appId, { table: "jobs", rowId, userId: owner.userId, body: " Fee? " }),
    );
    expect(comment.body).toBe("Fee?");
    expect(await system(() => appRevision(prisma, appId))).toBe(before + 1);
    await system(() =>
      addAppComment(prisma, appId, { table: "jobs", rowId, userId: colleague.userId, body: "€9k" }),
    );
    const listed = await system(() => listAppComments(prisma, appId, "jobs", rowId));
    expect(listed.map((item) => item.body)).toEqual(["Fee?", "€9k"]);
    expect(await system(() => countAppComments(prisma, appId, "jobs"))).toEqual({ [rowId]: 2 });

    await expect(
      system(() =>
        addAppComment(prisma, appId, { table: "jobs", rowId, userId: owner.userId, body: "  " }),
      ),
    ).rejects.toBeInstanceOf(AppCommentError);
    await expect(
      system(() =>
        removeAppComment(prisma, appId, comment.id, { userId: colleague.userId, isOwner: false }),
      ),
    ).rejects.toBeInstanceOf(AppCommentError);
    await system(() =>
      removeAppComment(prisma, appId, comment.id, { userId: owner.userId, isOwner: true }),
    );
    expect(
      (await system(() => listAppComments(prisma, appId, "jobs", rowId))).map((item) => item.body),
    ).toEqual(["€9k"]);
  });

  it("lists a row's history with the columns each change touched", async () => {
    const tables = await system(() => readAppTables(prisma, appId));
    const quay = tables.jobs!.rows.find((row) => row.name === "Quay bridge")!;
    const changes = await system(() => listAppRowChanges(prisma, appId, "jobs", quay._id));
    const changed = changes.find((change) => change.action === "changed");
    expect(changed?.userId).toBe(colleague.userId);
    expect(changed?.fields).toEqual([
      { key: "stage", label: "Stage", before: "Design", after: "Live" },
    ]);
  });
});
