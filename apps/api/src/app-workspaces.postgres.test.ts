import type { AppLive } from "@rakazo/app-kit/protocol";
import type { PrismaClient } from "@rakazo/db";
import {
  asSystem,
  createAppPage,
  createDb,
  defineAppTable,
  insertAppRow,
  provisionMessagingIdentity,
  runAsSystem,
  runAsTenant,
} from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppCaller } from "./app-calls.js";
import { appCalls } from "./app-calls.js";
import type { ResolvedLooker } from "./app-workspaces.js";
import { resolveLooker, setAppWorkspaces, workspaceOp } from "./app-workspaces.js";
import {
  addSharedAppUpload,
  readSharedAppAsset,
  readSharedAppData,
  writeSharedAppRow,
} from "./apps.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

const inspections = {
  name: "inspections",
  label: "Inspections",
  title: "element",
  columns: [
    { key: "element", label: "Element", type: "text" },
    { key: "photos", label: "Photos", type: "image" },
  ],
};
const defects = {
  name: "defects",
  label: "Defects",
  personal: true,
  columns: [{ key: "note", label: "Note", type: "text" }],
};
const checklist = {
  name: "checklist",
  label: "Checklist",
  shared: true,
  columns: [{ key: "item", label: "Item", type: "text" }],
};
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type Who = "owner" | "alice" | "bob" | "cara" | "dan";

describePostgres("app workspaces (PostgreSQL)", () => {
  const stamp = String(Date.now()).slice(-7);
  const domain = `ws${stamp}.example`;
  const people = {} as Record<Who, { userId: string; spaceId: string; email: string }>;
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  let appId: string;
  const signup = { signupsEnabled: undefined, signupAllowlist: undefined };
  const system = <T>(fn: () => Promise<T>) => runAsSystem("app workspaces test", fn);
  const looker = (who: Who) => resolveLooker(prisma, { pageId: appId, userId: people[who].userId });
  const op = (who: Who, name: string, input: Record<string, unknown> = {}) =>
    workspaceOp(prisma, { pageId: appId, userId: people[who].userId }, name, input);
  const read = async (who: Who) => {
    const seen = await looker(who);
    return readSharedAppData(prisma, appId, { userId: seen.userId, names: true }, seen);
  };
  const names = (rows: Array<Record<string, unknown>>, key: string) =>
    rows.map((row) => row[key]).sort();
  const write = async (who: Who, change: Parameters<typeof writeSharedAppRow>[2]) => {
    const seen = await looker(who);
    return writeSharedAppRow(
      prisma,
      appId,
      change,
      { ...seen, userId: people[who].userId },
      "owner",
    );
  };
  let ballinasloe: string;
  let athlone: string;
  let aliceRow: string;

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    const all: Who[] = ["owner", "alice", "bob", "cara", "dan"];
    for (const [index, who] of all.entries()) {
      const made = await system(() =>
        provisionMessagingIdentity(
          prisma,
          { provider: "sendblue", address: `+15${index}9${stamp}` },
          signup,
        ),
      );
      const email = `${who}@${domain}`;
      await system(() =>
        prisma.user.update({ where: { id: made.userId }, data: { email, emailVerified: true } }),
      );
      people[who] = { ...made, email };
    }
    const created = await runAsTenant(people.owner, () =>
      createAppPage(prisma, {
        userId: people.owner.userId,
        spaceId: people.owner.spaceId,
        botId: null,
        groupId: null,
        title: "Bridge inspections",
        files: { "App.tsx": "export default function App() { return null; }" },
        code: "<!doctype html><p>built</p>",
        tables: [
          { schema: inspections as never, rows: [] },
          { schema: defects as never, rows: [] },
          { schema: checklist as never, rows: [{ item: "Bearings" }, { item: "Deck joints" }] },
        ],
      }),
    );
    appId = created.pageId;
    await system(() =>
      insertAppRow(prisma, appId, "inspections", { element: "Old survey" }, people.owner.userId),
    );
  });

  afterAll(async () => {
    if (prisma) {
      const cleanup = asSystem(prisma, "test fixture cleanup");
      const ids = Object.values(people);
      await cleanup.page.deleteMany({ where: { id: appId } });
      await cleanup.messagingIdentity.deleteMany({
        where: { provider: "sendblue", address: { contains: stamp } },
      });
      await cleanup.organization.deleteMany({
        where: { id: { in: ids.map((person) => person.spaceId) } },
      });
      await cleanup.user.deleteMany({ where: { id: { in: ids.map((person) => person.userId) } } });
    }
    await close?.();
  });

  it("keeps one shared dataset until workspaces are turned on", async () => {
    const before = await looker("dan");
    expect(before.view).toBeNull();
    expect(names((await read("dan")).tables.inspections!.rows, "element")).toEqual(["Old survey"]);
    const set = await system(() =>
      setAppWorkspaces(prisma, appId, { label: "Bridge", create: "anyone" }),
    );
    expect(set).toMatchObject({ label: "Bridge", unfiled: 1, filed: 0 });
  });

  it("lets a colleague start a workspace they lead, and add colleagues by email", async () => {
    const summary = (await op("alice", "workspaces.save", { name: "Ballinasloe" })) as {
      current: { id: string; role: string };
    };
    expect(summary.current.role).toBe("lead");
    ballinasloe = summary.current.id;
    await op("alice", "workspaces.member", {
      workspace: ballinasloe,
      email: people.bob.email.toUpperCase(),
      role: "member",
    });
    const members = (await op("alice", "workspaces.member", {
      workspace: ballinasloe,
      email: people.cara.email,
      role: "viewer",
    })) as Array<{ email: string; role: string }>;
    expect(members.map((member) => [member.email, member.role])).toEqual([
      [people.alice.email, "lead"],
      [people.bob.email, "member"],
      [people.cara.email, "viewer"],
    ]);
    await expect(
      op("alice", "workspaces.member", {
        workspace: ballinasloe,
        email: "someone@elsewhere.example",
        role: "member",
      }),
    ).rejects.toThrow(/colleagues/);
    await expect(
      op("bob", "workspaces.member", {
        workspace: ballinasloe,
        email: people.dan.email,
        role: "member",
      }),
    ).rejects.toThrow(/leads/);
  });

  it("files new rows in the open workspace and shows them only to its members", async () => {
    const saved = await write("alice", {
      op: "insert",
      table: "inspections",
      row: { element: "Pier 2" },
    });
    aliceRow = "row" in saved ? saved.row._id : "";
    await write("bob", { op: "insert", table: "inspections", row: { element: "Abutment A" } });
    await write("bob", {
      op: "update",
      table: "inspections",
      id: aliceRow,
      patch: { element: "Pier 2 (east)" },
    });

    const bobSees = await read("bob");
    expect(names(bobSees.tables.inspections!.rows, "element")).toEqual([
      "Abutment A",
      "Pier 2 (east)",
    ]);
    expect(names(bobSees.tables.checklist!.rows, "item")).toEqual(["Bearings", "Deck joints"]);

    expect(names((await read("cara")).tables.inspections!.rows, "element")).toHaveLength(2);
    await expect(
      write("cara", { op: "insert", table: "inspections", row: { element: "Nope" } }),
    ).rejects.toThrow(/view this bridge/);
    await expect(
      write("cara", { op: "update", table: "inspections", id: aliceRow, patch: { element: "x" } }),
    ).rejects.toThrow(/can't change/);

    const danSees = await read("dan");
    expect(danSees.tables.inspections!.rows).toEqual([]);
    expect(names(danSees.tables.checklist!.rows, "item")).toEqual(["Bearings", "Deck joints"]);
    await expect(
      write("dan", { op: "update", table: "inspections", id: aliceRow, patch: { element: "x" } }),
    ).rejects.toThrow(/no longer there/);
    await expect(
      write("dan", { op: "insert", table: "inspections", row: { element: "x" } }),
    ).rejects.toThrow(/Open a bridge/);
    // Shared lists still follow the app's own setting (only the owner changes them here).
    await expect(
      write("bob", { op: "insert", table: "checklist", row: { item: "Parapets" } }),
    ).rejects.toThrow(/owner/);
  });

  it("keeps a workspace's personal rows to whoever added them and its leads", async () => {
    await write("bob", { op: "insert", table: "defects", row: { note: "Spalling" } });
    expect((await read("bob")).tables.defects!.rows).toHaveLength(1);
    expect((await read("alice")).tables.defects!.rows).toHaveLength(1);
    expect((await read("cara")).tables.defects!.rows).toHaveLength(0);
  });

  it("refuses a row from a copy still showing another workspace", async () => {
    const summary = (await op("dan", "workspaces.save", { name: "Athlone" })) as {
      current: { id: string };
    };
    athlone = summary.current.id;
    await write("dan", { op: "insert", table: "inspections", row: { element: "Span 1" } });
    await expect(
      write("dan", {
        op: "insert",
        table: "inspections",
        row: { element: "Span 2", _workspace: ballinasloe },
      }),
    ).rejects.toThrow(/another bridge/);
    expect(names((await read("alice")).tables.inspections!.rows, "element")).not.toContain(
      "Span 1",
    );
  });

  it("shows the owner every workspace with names, or one they open", async () => {
    const all = await read("owner");
    expect(all.tables.inspections!.rows.map((row) => [row.element, row._workspace]).sort()).toEqual(
      [
        ["Abutment A", "Ballinasloe"],
        ["Old survey", null],
        ["Pier 2 (east)", "Ballinasloe"],
        ["Span 1", "Athlone"],
      ],
    );
    await op("owner", "workspaces.open", { workspace: athlone });
    expect(names((await read("owner")).tables.inspections!.rows, "element")).toEqual(["Span 1"]);
    await op("owner", "workspaces.open", { workspace: null });
    await expect(op("dan", "workspaces.open", { workspace: ballinasloe })).rejects.toThrow(
      /not one of yours/,
    );
  });

  it("answers live changes, queries, comments and presence for the open workspace only", async () => {
    const calls = appCalls({ prisma, services: null, evolve: null });
    const as = (who: Who): AppCaller => ({
      pageId: appId,
      ownerId: people.owner.userId,
      userId: people[who].userId,
      via: who === "owner" ? "owner" : "shared",
    });
    await calls.handle(as("bob"), { op: "live", since: -1 });
    const live = (await calls.handle(as("dan"), { op: "live", since: 0 })) as AppLive;
    expect(live.workspace).toBe(athlone);
    expect(live.delta?.rows.inspections?.map((row) => row.element)).toEqual(["Span 1"]);
    expect(live.delta?.removed.inspections).toEqual(expect.arrayContaining([aliceRow]));
    expect(live.presence.map((person) => person.id)).not.toContain(people.bob.userId);
    const query = (await calls.handle(as("dan"), {
      op: "rows.query",
      table: "inspections",
      query: {},
    })) as { total: number };
    expect(query.total).toBe(1);
    await expect(
      calls.handle(as("dan"), {
        op: "comments.add",
        table: "inspections",
        rowId: aliceRow,
        body: "hi",
      }),
    ).rejects.toThrow(/no longer there/);
    await calls.handle(as("cara"), {
      op: "comments.add",
      table: "inspections",
      rowId: aliceRow,
      body: "Looks fine",
    });
    const aliceLive = (await calls.handle(as("alice"), { op: "live", since: -1 })) as AppLive;
    expect(aliceLive.presence.map((person) => person.id)).toContain(people.bob.userId);
  });

  it("shows a photo only to people who can see a row holding it", async () => {
    const photo = await addSharedAppUpload(
      prisma,
      appId,
      { name: "pier.png", base64: PNG },
      people.bob.userId,
    );
    await write("bob", {
      op: "update",
      table: "inspections",
      id: aliceRow,
      patch: { photos: photo.id },
    });
    const see = async (who: Who) =>
      readSharedAppAsset(prisma, appId, photo.id, (await looker(who)) as ResolvedLooker);
    expect(await see("cara")).not.toBeNull();
    expect(await see("owner")).not.toBeNull();
    expect(await see("dan")).toBeNull();
  });

  it("never lets a table refresh wipe rows people entered in workspaces", async () => {
    await expect(
      system(() =>
        defineAppTable(prisma, appId, { table: "inspections", rows: [{ element: "Fresh" }] }),
      ),
    ).rejects.toThrow(/holds rows from the app's workspaces/);
    const loaded = await system(() =>
      defineAppTable(prisma, appId, {
        table: "inspections",
        rows: [{ element: "Span 1 (resurveyed)" }],
        workspaceId: athlone,
      }),
    );
    expect(loaded).toMatchObject({ removed: 1, inserted: 1 });
    expect(names((await read("bob")).tables.inspections!.rows, "element")).toEqual([
      "Abutment A",
      "Pier 2 (east)",
    ]);
  });

  it("keeps a lead from leaving a workspace with nobody to manage it", async () => {
    const members = (await op("alice", "workspaces.members", { workspace: ballinasloe })) as Array<{
      id: string;
      email: string;
    }>;
    const alice = members.find((member) => member.email === people.alice.email)!;
    await expect(
      op("alice", "workspaces.member", {
        workspace: ballinasloe,
        memberId: alice.id,
        role: "member",
      }),
    ).rejects.toThrow(/someone else a lead/);
    const bobsView = (await op("bob", "workspaces.members", { workspace: ballinasloe })) as Array<
      Record<string, unknown>
    >;
    expect(bobsView.every((member) => !("email" in member))).toBe(true);
  });

  it("files rows from before workspaces into one when the owner asks", async () => {
    const set = await system(() =>
      setAppWorkspaces(prisma, appId, { label: "Bridge", create: "owner", fileInto: "Archive" }),
    );
    expect(set).toMatchObject({ filed: 1, unfiled: 0 });
    await expect(op("bob", "workspaces.save", { name: "Mine" })).rejects.toThrow(/owner starts/);
  });
});
