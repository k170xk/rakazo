import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AppVersionConflictError,
  addAppAsset,
  appendAppVersion,
  appRevision,
  createAppPage,
  defineAppTable,
  insertAppRow,
  mergeImportedTables,
  readAppAsset,
  readAppTables,
  removeAppRow,
  updateAppRow,
} from "./app-data.js";
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
  key: "job_no",
  title: "name",
  columns: [
    { key: "job_no", label: "Job", type: "text" },
    { key: "name", label: "Name", type: "text", required: true },
    {
      key: "stage",
      label: "Stage",
      type: "enum",
      options: [{ value: "Design" }, { value: "Live" }],
    },
    { key: "fee", label: "Fee", type: "currency", currency: "EUR" },
    { key: "hours", label: "Hours", type: "number" },
    { key: "rate", label: "Rate", type: "number", formula: "fee / hours" },
  ],
};

describePostgres("app data (PostgreSQL)", () => {
  const stamp = String(Date.now()).slice(-7);
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  let owner: { userId: string; spaceId: string };
  let stranger: { userId: string; spaceId: string };
  let appId: string;
  const signup = { signupsEnabled: undefined, signupAllowlist: undefined };

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    owner = await runAsSystem("test fixture", () =>
      provisionMessagingIdentity(
        prisma,
        { provider: "sendblue", address: `+1557${stamp}` },
        signup,
      ),
    );
    stranger = await runAsSystem("test fixture", () =>
      provisionMessagingIdentity(
        prisma,
        { provider: "sendblue", address: `+1558${stamp}` },
        signup,
      ),
    );
    const created = await runAsTenant(owner, () =>
      createAppPage(prisma, {
        ...owner,
        botId: null,
        groupId: null,
        title: "Job tracker",
        files: { "App.tsx": "export default function App() { return null; }" },
        code: "<!doctype html><p>built</p>",
        tables: [
          {
            schema: jobs as never,
            rows: [
              { job_no: "J-1", name: "Quay bridge", stage: "Design", fee: 1000, hours: 10 },
              { job_no: "J-2", name: "Depot", stage: "Live", fee: "€2,500", hours: "25" },
            ],
          },
        ],
      }),
    );
    appId = created.pageId;
  });

  afterAll(async () => {
    if (prisma) {
      const system = asSystem(prisma, "test fixture cleanup");
      await system.messagingIdentity.deleteMany({
        where: { provider: "sendblue", address: { in: [`+1557${stamp}`, `+1558${stamp}`] } },
      });
      const spaceIds = [owner?.spaceId, stranger?.spaceId].filter(Boolean) as string[];
      const userIds = [owner?.userId, stranger?.userId].filter(Boolean) as string[];
      await system.organization.deleteMany({ where: { id: { in: spaceIds } } });
      await system.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await close?.();
  });

  it("keeps an app's tables, typed rows and formulas, and bumps the revision on every write", async () => {
    await runAsTenant(owner, async () => {
      const page = await prisma.page.findUniqueOrThrow({ where: { id: appId } });
      expect(page.kind).toBe("app");
      const tables = await readAppTables(prisma, appId);
      expect(tables.jobs?.rows.map((row) => [row.job_no, row.fee, row.hours, row.rate])).toEqual([
        ["J-1", 1000, 10, 100],
        ["J-2", 2500, 25, 100],
      ]);
      const before = await appRevision(prisma, appId);
      const added = await insertAppRow(
        prisma,
        appId,
        "jobs",
        { name: "Library", fee: 900 },
        owner.userId,
      );
      expect(added.revision).toBe(before + 1);
      const changed = await updateAppRow(
        prisma,
        appId,
        "jobs",
        added.row._id,
        { stage: "Live" },
        owner.userId,
      );
      expect(changed.row.stage).toBe("Live");
      const recased = await updateAppRow(
        prisma,
        appId,
        "jobs",
        added.row._id,
        { stage: "design" },
        owner.userId,
      );
      expect(recased.row.stage).toBe("Design");
      await expect(insertAppRow(prisma, appId, "jobs", { fee: 1 }, owner.userId)).rejects.toThrow();
      await removeAppRow(prisma, appId, "jobs", added.row._id);
      expect(await appRevision(prisma, appId)).toBe(before + 4);
    });
  });

  it("upserts rows by the table key and merges a re-imported sheet without losing columns", async () => {
    await runAsTenant(owner, async () => {
      const result = await defineAppTable(prisma, appId, {
        table: "jobs",
        rows: [
          { job_no: "J-1", name: "Quay bridge", fee: 1200 },
          { job_no: "J-3", name: "School", fee: 4000 },
        ],
        mode: "upsert",
        userId: owner.userId,
      });
      expect([result.updated, result.inserted]).toEqual([1, 1]);
      const report = await mergeImportedTables(
        prisma,
        appId,
        [
          {
            schema: {
              name: "jobs",
              label: "Jobs",
              columns: [
                { key: "job_no", label: "Job", type: "text" },
                { key: "name", label: "Name", type: "text" },
                { key: "client", label: "Client", type: "text" },
              ],
            },
            rows: [{ job_no: "J-2", name: "Depot", client: "OPW" }],
          },
        ],
        owner.userId,
      );
      expect(report[0]).toContain("1 updated, 0 added, new columns Client");
      const tables = await readAppTables(prisma, appId);
      expect(tables.jobs?.schema.columns.map((column) => column.key)).toContain("stage");
      const depot = tables.jobs?.rows.find((row) => row.job_no === "J-2");
      expect([depot?.client, depot?.stage, depot?.fee]).toEqual(["OPW", "Live", 2500]);
    });
  });

  it("saves a version only from the version it was built on", async () => {
    await runAsTenant(owner, async () => {
      const files = { "App.tsx": "export default function App() { return 1; }" };
      const next = await appendAppVersion(prisma, {
        pageId: appId,
        baseVersion: 1,
        files,
        code: "<p>2</p>",
      });
      expect(next.version).toBe(2);
      await expect(
        appendAppVersion(prisma, { pageId: appId, baseVersion: 1, files, code: "<p>x</p>" }),
      ).rejects.toBeInstanceOf(AppVersionConflictError);
    });
  });

  it("keeps pictures within the type and size allowance", async () => {
    await runAsTenant(owner, async () => {
      const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      const asset = await addAppAsset(prisma, appId, {
        name: "logo.png",
        mime: "image/png",
        bytes: png,
        source: "upload",
      });
      expect((await readAppAsset(prisma, appId, asset.id))?.mime).toBe("image/png");
      await expect(
        addAppAsset(prisma, appId, {
          name: "x.html",
          mime: "text/html",
          bytes: png,
          source: "upload",
        }),
      ).rejects.toThrow(/PNG/);
    });
  });

  it("hides one person's app tables, rows and pictures from everyone else", async () => {
    await runAsTenant(stranger, async () => {
      expect(await prisma.appTable.count({ where: { pageId: appId } })).toBe(0);
      expect(await prisma.appRow.count({ where: { pageId: appId } })).toBe(0);
      expect(await prisma.appAsset.count({ where: { pageId: appId } })).toBe(0);
      await expect(
        prisma.appRow.create({
          data: { pageId: appId, tableId: "x", data: {}, position: 1 },
        }),
      ).rejects.toThrow();
    });
  });
});
