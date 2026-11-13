import { createHmac } from "node:crypto";
import type { PrismaClient } from "@rakazo/db";
import {
  asSystem,
  createAppPage,
  createDb,
  listAppChanges,
  provisionMessagingIdentity,
  readAppTables,
  runAsSystem,
  runAsTenant,
} from "@rakazo/db";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTemplateApp } from "./apps.js";
import { EVOLVE_APP_DATA_PATH, mountEvolveAppData } from "./evolve-app-data.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

const SECRET = "e".repeat(40);

function token(email: string, slug: string, secret = SECRET) {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      iss: "evolve",
      aud: "ocsc-intelligence-app-data",
      sub: email,
      slug,
      iat: now,
      exp: now + 60,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${signature}`;
}

describePostgres("Evolve app data (PostgreSQL)", () => {
  const stamp = String(Date.now()).slice(-7);
  const slug = `jobs-${stamp}`;
  const signup = { signupsEnabled: undefined, signupAllowlist: undefined };
  const addresses = [`+1561${stamp}`, `+1562${stamp}`];
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  let owner: { userId: string; spaceId: string; email: string };
  let colleague: { userId: string; spaceId: string; email: string };
  let appId: string;
  const app = new Hono();

  const call = (email: string, body: Record<string, unknown>, bearer = token(email, slug)) =>
    app.request(EVOLVE_APP_DATA_PATH, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    const system = asSystem(prisma);
    const provision = (address: string) =>
      runAsSystem("test fixture", () =>
        provisionMessagingIdentity(prisma, { provider: "sendblue", address }, signup),
      );
    const first = await provision(addresses[0]!);
    const second = await provision(addresses[1]!);
    const email = async (userId: string) =>
      (await system.user.findUniqueOrThrow({ where: { id: userId } })).email;
    owner = { ...first!, email: await email(first!.userId) };
    colleague = { ...second!, email: await email(second!.userId) };
    const created = await runAsTenant(owner, () =>
      createAppPage(prisma, {
        spaceId: owner.spaceId,
        userId: owner.userId,
        botId: null,
        groupId: null,
        title: "Jobs",
        files: { "App.tsx": "export default () => null;" },
        code: "<!doctype html>",
        tables: [
          {
            schema: {
              name: "jobs",
              label: "Jobs",
              columns: [{ key: "name", label: "Name", type: "text" }],
            },
            rows: [{ name: "Quay bridge" }],
          },
        ],
      }),
    );
    appId = created.pageId;
    await system.page.update({ where: { id: appId }, data: { evolvePluginSlug: slug } });
    mountEvolveAppData(app, prisma, {
      url: "https://evolve.example.co/functions/v1/plugin",
      secret: SECRET,
    });
  });

  afterAll(async () => {
    if (prisma) {
      const system = asSystem(prisma, "test fixture cleanup");
      await system.messagingIdentity.deleteMany({
        where: { provider: "sendblue", address: { in: addresses } },
      });
      const spaceIds = [owner?.spaceId, colleague?.spaceId].filter(Boolean) as string[];
      const userIds = [owner?.userId, colleague?.userId].filter(Boolean) as string[];
      await system.organization.deleteMany({ where: { id: { in: spaceIds } } });
      await system.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await close?.();
  });

  it("opens the app published under the plugin's slug for anyone Evolve admits", async () => {
    const opened = await call(colleague.email, { op: "init" });
    expect(opened.status).toBe(200);
    const init = (await opened.json()) as Record<string, any>;
    expect(init.app).toMatchObject({ id: appId, title: "Jobs" });
    expect(init.viewer).toMatchObject({ canEdit: false, role: "member" });
    expect(init.tables.jobs.rows.map((row: { name: string }) => row.name)).toEqual(["Quay bridge"]);
    expect(init.features).toEqual(["assets"]);
    const outsider = await call("someone@elsewhere.example", { op: "data" });
    expect(outsider.status).toBe(200);
  });

  it("lets the owner change rows, and colleagues only when the app allows it", async () => {
    const added = await call(owner.email, {
      op: "rows.insert",
      table: "jobs",
      row: { name: "Depot" },
    });
    expect(added.status).toBe(200);
    expect(((await added.json()) as { name: string }).name).toBe("Depot");

    const refused = await call(colleague.email, {
      op: "rows.insert",
      table: "jobs",
      row: { name: "Library" },
    });
    expect(refused.status).toBe(403);
    await asSystem(prisma).page.update({ where: { id: appId }, data: { dataAccess: "company" } });
    const allowed = await call(colleague.email, {
      op: "rows.insert",
      table: "jobs",
      row: { name: "Library" },
    });
    expect(allowed.status).toBe(200);
    // Someone with no account here only reads, whatever the app allows.
    const stranger = await call("someone@elsewhere.example", {
      op: "rows.insert",
      table: "jobs",
      row: { name: "Nope" },
    });
    expect(stranger.status).toBe(403);
    const revision = (await (await call(owner.email, { op: "revision" })).json()) as {
      revision: number;
    };
    expect(revision.revision).toBeGreaterThanOrEqual(2);
  });

  it("keeps photos from people who may edit, checked by their bytes", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(60).fill(7)]).toString("base64");
    const init = (await (await call(owner.email, { op: "init" })).json()) as { features: string[] };
    expect(init.features).toEqual(["assets", "uploads"]);
    const added = await call(owner.email, { op: "upload", name: "crack.jpg", base64: jpeg });
    expect(added.status).toBe(200);
    const { id } = (await added.json()) as { id: string };
    const stored = await asSystem(prisma).appAsset.findUniqueOrThrow({ where: { id } });
    expect(stored).toMatchObject({
      pageId: appId,
      mime: "image/jpeg",
      source: `app:${owner.userId}`,
    });
    const read = (await (await call(colleague.email, { op: "asset", id })).json()) as {
      base64: string;
    };
    expect(read.base64).toBe(jpeg);

    const script = Buffer.from("<svg onload=alert(1)>").toString("base64");
    expect((await call(owner.email, { op: "upload", name: "x.jpg", base64: script })).status).toBe(
      400,
    );
    expect(
      (await call(owner.email, { op: "upload", name: "x", base64: "not base64!" })).status,
    ).toBe(400);
    const stranger = await call("someone@elsewhere.example", {
      op: "upload",
      name: "x.jpg",
      base64: jpeg,
    });
    expect(stranger.status).toBe(403);
  });

  it("lets colleagues contribute rows and change only their own", async () => {
    await asSystem(prisma).page.update({
      where: { id: appId },
      data: { dataAccess: "contribute" },
    });
    const init = (await (await call(colleague.email, { op: "init" })).json()) as Record<
      string,
      any
    >;
    expect(init.viewer).toMatchObject({ canEdit: true, ownRowsOnly: true });
    const ownerRow = init.tables.jobs.rows.find((row: { name: string }) => row.name === "Depot");
    expect(ownerRow).toMatchObject({ _mine: false });

    const added = await call(colleague.email, {
      op: "rows.insert",
      table: "jobs",
      row: { name: "Timesheet week 46" },
    });
    expect(added.status).toBe(200);
    const mine = (await added.json()) as { _id: string; _mine: boolean };
    expect(mine._mine).toBe(true);
    expect(
      (
        await call(colleague.email, {
          op: "rows.update",
          table: "jobs",
          id: mine._id,
          patch: { name: "Week 46" },
        })
      ).status,
    ).toBe(200);
    const theirs = await call(colleague.email, {
      op: "rows.update",
      table: "jobs",
      id: ownerRow._id,
      patch: { name: "Changed" },
    });
    expect(theirs.status).toBe(400);
    expect(((await theirs.json()) as { error: string }).error).toMatch(/only the rows you added/);
    expect(
      (await call(colleague.email, { op: "rows.remove", table: "jobs", id: ownerRow._id })).status,
    ).toBe(400);
    expect(
      (await call(colleague.email, { op: "state.set", key: "view", value: "board" })).status,
    ).toBe(403);

    const seen = (await (await call(owner.email, { op: "data" })).json()) as Record<string, any>;
    const contributed = seen.tables.jobs.rows.find((row: { _id: string }) => row._id === mine._id);
    expect(contributed).toMatchObject({ name: "Week 46", _mine: false });
    expect(Object.hasOwn(contributed, "_by")).toBe(true);
    expect(
      (
        await call(owner.email, {
          op: "rows.update",
          table: "jobs",
          id: mine._id,
          patch: { name: "Wk 46" },
        })
      ).status,
    ).toBe(200);
    expect(
      (await call(colleague.email, { op: "rows.remove", table: "jobs", id: mine._id })).status,
    ).toBe(200);
  });

  it("keeps who changed rows from Evolve in the app's history", async () => {
    const changes = await runAsTenant(owner, () => listAppChanges(prisma, appId, 50));
    const fromEvolve = changes.filter((change) => change.via === "evolve");
    expect(fromEvolve.length).toBeGreaterThan(0);
    expect(fromEvolve.some((change) => change.userId === colleague.userId)).toBe(true);
  });

  it("starts an app from a starter with its empty tables and colleagues' access", async () => {
    const { pageId } = await runAsTenant(owner, () =>
      createTemplateApp(
        prisma,
        { ...owner, isDeploymentOwner: false },
        { templateId: "timesheet" },
      ),
    );
    const page = await runAsTenant(owner, () =>
      prisma.page.findUniqueOrThrow({ where: { id: pageId } }),
    );
    expect(page).toMatchObject({ kind: "app", title: "Timesheets", dataAccess: "contribute" });
    const tables = await runAsTenant(owner, () => readAppTables(prisma, pageId));
    expect(tables.entries?.rows).toEqual([]);
    await expect(
      runAsTenant(owner, () =>
        createTemplateApp(prisma, { ...owner, isDeploymentOwner: false }, { templateId: "nope" }),
      ),
    ).rejects.toThrow("doesn't exist");
  });

  it("refuses bad tokens, other slugs, and the Studio's own operations", async () => {
    expect(
      (await call(owner.email, { op: "init" }, token(owner.email, slug, "x".repeat(40)))).status,
    ).toBe(401);
    expect((await call(owner.email, { op: "init" }, "")).status).toBe(401);
    expect((await call(owner.email, { op: "init" }, token(owner.email, "other-app"))).status).toBe(
      404,
    );
    for (const op of ["export", "download", "open", "ai.ask", "defineTable"]) {
      expect((await call(owner.email, { op })).status).toBe(400);
    }
  });

  it("closes an app a company admin froze, and opens it again when unfrozen", async () => {
    const system = asSystem(prisma, "test fixture");
    await system.page.update({ where: { id: appId }, data: { frozenAt: new Date() } });
    try {
      expect((await call(owner.email, { op: "init" })).status).toBe(404);
      expect((await call(colleague.email, { op: "data" })).status).toBe(404);
    } finally {
      await system.page.update({ where: { id: appId }, data: { frozenAt: null } });
    }
    expect((await call(colleague.email, { op: "init" })).status).toBe(200);
  });
});
