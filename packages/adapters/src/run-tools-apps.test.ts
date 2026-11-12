import { beforeEach, describe, expect, it, vi } from "vitest";

const publishMessage = vi.fn();
vi.mock("./run-messages.js", async (importActual) => ({
  ...(await importActual<typeof import("./run-messages.js")>()),
  publishMessage: (...args: unknown[]) => publishMessage(...args),
}));

const db = vi.hoisted(() => ({
  createAppPage: vi.fn(),
  appendAppVersion: vi.fn(),
  defineAppTable: vi.fn(),
  readAppTables: vi.fn(),
  listAppAssets: vi.fn(),
  insertAppRow: vi.fn(),
  addAppAsset: vi.fn(),
}));
vi.mock("@rakazo/db", async (importActual) => ({
  ...(await importActual<typeof import("@rakazo/db")>()),
  ...db,
}));

const { appTools } = await import("./run-tools-apps.js");

const APP = `import { Card, CardBody, CardHeader } from "@ocsc/ui";
export default function App() {
  return <Card><CardHeader title="Jobs" /><CardBody>Hi</CardBody></Card>;
}
`;

function context(
  page?: { kind?: string; currentVersion?: number; files?: Record<string, string> },
  extra: { secrets?: string[]; evolveUrl?: string; groupId?: string | null } = {},
) {
  const findFirst = vi.fn(async (_query: unknown) =>
    page
      ? {
          id: "app-1",
          title: "Jobs",
          kind: page.kind ?? "app",
          currentVersion: page.currentVersion ?? 1,
          dataAccess: "owner",
          versions: [{ source: JSON.stringify(page.files ?? { "App.tsx": APP }) }],
        }
      : null,
  );
  return {
    ctx: {
      deps: {
        prisma: { page: { findFirst, update: vi.fn() } },
        evolvePlugins: extra.evolveUrl ? { url: extra.evolveUrl } : null,
      },
      run: { id: "run-1", spaceId: "space-1", userId: "user-1", threadId: "t-1", botId: "bot-1" },
      bot: { id: "bot-1" },
      thread: { groupId: extra.groupId ?? null },
      secrets: extra.secrets ?? [],
      state: { tainted: false },
      context: { spaceId: "space-1", userId: "user-1" },
    } as never,
    findFirst,
  };
}

const call = (args: Record<string, unknown>) =>
  ({ args, finish: (result: unknown) => result }) as never;
type Result = Record<string, unknown>;

describe("save_app", () => {
  beforeEach(() => {
    publishMessage.mockReset();
    for (const fn of Object.values(db)) fn.mockReset();
    db.createAppPage.mockResolvedValue({ pageId: "app-1", version: 1, title: "Jobs" });
    db.appendAppVersion.mockResolvedValue({ version: 2, title: "Jobs" });
    db.readAppTables.mockResolvedValue({});
    db.listAppAssets.mockResolvedValue([]);
  });

  it("returns the app guide on request", async () => {
    const result = (await appTools.save_app!(context().ctx, call({ help: true }))) as Result;
    expect(String(result.guide)).toContain("@ocsc/ui");
  });

  it("builds and saves a new app, posting its card", async () => {
    const result = (await appTools.save_app!(
      context().ctx,
      call({ title: "Jobs", files: { "App.tsx": APP } }),
    )) as Result;
    expect(result).toMatchObject({ appId: "app-1", version: 1 });
    expect(db.createAppPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        botId: "bot-1",
        title: "Jobs",
        code: expect.stringMatching(/^<!doctype html>/i),
      }),
    );
    expect(publishMessage).toHaveBeenCalledTimes(1);
  });

  it("starts an app from a template with its tables and access", async () => {
    db.defineAppTable.mockResolvedValue({
      table: "inspections",
      rows: 0,
      inserted: 0,
      updated: 0,
      removed: 0,
      skipped: [],
    });
    const result = (await appTools.save_app!(
      context().ctx,
      call({ template: "site-inspection" }),
    )) as Result;
    expect(result).toMatchObject({ appId: "app-1", access: expect.stringContaining("their own") });
    expect(db.createAppPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: "Site inspections", dataAccess: "contribute" }),
    );
    expect(db.defineAppTable).toHaveBeenCalledWith(
      expect.anything(),
      "app-1",
      expect.objectContaining({ schema: expect.objectContaining({ name: "inspections" }) }),
    );
  });

  it("refuses an unknown template and a template on an existing app", async () => {
    const unknown = (await appTools.save_app!(context().ctx, call({ template: "nope" }))) as Result;
    expect(String(unknown.error)).toContain("project-tracker");
    const existing = (await appTools.save_app!(
      context({}).ctx,
      call({ appId: "app-1", template: "timesheet" }),
    )) as Result;
    expect(String(existing.error)).toContain("new app");
    expect(db.createAppPage).not.toHaveBeenCalled();
  });

  it("lists every template in the tool schema", async () => {
    const { APP_TEMPLATES } = await import("@rakazo/app-kit/templates");
    const { builtinAgentTools } = await import("./builtin-tools.js");
    const tool = builtinAgentTools.find((entry) => entry.name === "save_app") as unknown as {
      inputSchema: { properties: { template: { enum: string[] } } };
    };
    expect(tool.inputSchema.properties.template.enum).toEqual(APP_TEMPLATES.map((t) => t.id));
  });

  it("saves nothing when the code does not build", async () => {
    const result = (await appTools.save_app!(
      context().ctx,
      call({ title: "Jobs", files: { "App.tsx": "export default function App( {" } }),
    )) as Result;
    expect(result.unchanged).toBe(true);
    expect(result.problems).toBeTruthy();
    expect(db.createAppPage).not.toHaveBeenCalled();
  });

  it("refuses imports outside the allowed app packages", async () => {
    const result = (await appTools.save_app!(
      context().ctx,
      call({
        title: "Jobs",
        files: { "App.tsx": `import fs from "node:fs";\nexport default () => String(fs);` },
      }),
    )) as Result;
    expect(result.unchanged).toBe(true);
    expect(db.createAppPage).not.toHaveBeenCalled();
  });

  it("never stores a value the run keeps secret", async () => {
    const secret = "sk-live-abcdefghijklmnop";
    const result = (await appTools.save_app!(
      context(undefined, { secrets: [secret] }).ctx,
      call({ title: "Jobs", files: { "App.tsx": APP.replace("Hi", secret) } }),
    )) as Result;
    expect(result.error).toMatch(/secret/);
    expect(db.createAppPage).not.toHaveBeenCalled();
  });

  it("applies find-and-replace edits on the version it read", async () => {
    const result = (await appTools.save_app!(
      context({ currentVersion: 3 }).ctx,
      call({ appId: "app-1", edits: [{ find: ">Hi<", replace: ">Hello there<" }] }),
    )) as Result;
    expect(result).toMatchObject({ appId: "app-1", version: 2 });
    expect(db.appendAppVersion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        baseVersion: 3,
        files: { "App.tsx": expect.stringContaining("Hello there") },
      }),
    );
  });

  it("refuses an edit whose find text is missing or ambiguous", async () => {
    const missing = (await appTools.save_app!(
      context({}).ctx,
      call({ appId: "app-1", edits: [{ find: "nowhere", replace: "x" }] }),
    )) as Result;
    expect(missing.error).toMatch(/not found/);
    const twice = (await appTools.save_app!(
      context({}).ctx,
      call({ appId: "app-1", edits: [{ find: "Card", replace: "x" }] }),
    )) as Result;
    expect(twice.error).toMatch(/more than once/);
    expect(db.appendAppVersion).not.toHaveBeenCalled();
  });

  it("taints the run when it reads an app, whose rows colleagues may have written", async () => {
    const { ctx } = context({});
    const result = (await appTools.save_app!(ctx, call({ appId: "app-1" }))) as Result;
    expect(result.files).toEqual({ "App.tsx": APP });
    expect((ctx as { state: { tainted: boolean } }).state.tainted).toBe(true);
  });

  it("reaches only this bot's or its group's apps, and rebuilds older pages as apps", async () => {
    const { ctx, findFirst } = context(undefined, { groupId: "group-1" });
    expect(await appTools.save_app!(ctx, call({ appId: "app-9" }))).toMatchObject({
      error: expect.stringMatching(/No app/),
    });
    expect(findFirst.mock.calls[0]![0]).toMatchObject({
      where: {
        id: "app-9",
        spaceId: "space-1",
        userId: "user-1",
        OR: [{ botId: "bot-1" }, { groupId: "group-1" }],
      },
    });
    const page = (await appTools.save_app!(
      context({ kind: "page" }).ctx,
      call({ appId: "app-1" }),
    )) as Result;
    expect(page.error).toMatch(/save_app/);
  });
});

describe("app_data", () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
  });

  it("queries rows by value and words, tainting the run", async () => {
    db.readAppTables.mockResolvedValue({
      jobs: {
        schema: { name: "jobs", label: "Jobs", columns: [] },
        rows: [
          { _id: "1", name: "Quay bridge", stage: "Live" },
          { _id: "2", name: "Depot", stage: "Live" },
          { _id: "3", name: "Quay wall", stage: "Design" },
        ],
      },
    });
    const { ctx } = context({});
    const result = (await appTools.app_data!(
      ctx,
      call({ appId: "app-1", table: "jobs", where: { stage: "Live" }, search: "quay" }),
    )) as Result;
    expect(result).toMatchObject({ total: 1, rows: [{ _id: "1" }] });
    expect((ctx as { state: { tainted: boolean } }).state.tainted).toBe(true);
  });

  it("refuses rows that hold a secret", async () => {
    const result = (await appTools.app_data!(
      context({}, { secrets: ["sk-live-abcdefghijklmnop"] }).ctx,
      call({
        appId: "app-1",
        table: "jobs",
        action: "insert",
        rows: [{ name: "sk-live-abcdefghijklmnop" }],
      }),
    )) as Result;
    expect(result.error).toMatch(/secret/);
    expect(db.insertAppRow).not.toHaveBeenCalled();
  });
});

describe("app_asset", () => {
  const evolveUrl = "https://evolve.example.co/functions/v1/plugin";
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    vi.unstubAllGlobals();
  });

  it("fetches only Evolve's infographic pictures", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "content-type": "image/png" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    db.addAppAsset.mockResolvedValue({ id: "asset-1", name: "Infographic" });
    for (const url of [
      "https://elsewhere.example.com/storage/v1/object/public/slide-assets/infographics/a.png",
      "https://evolve.example.co/functions/v1/plugin?x=1",
      "https://evolve.example.co/storage/v1/object/public/other/a.png",
      "http://evolve.example.co/storage/v1/object/public/slide-assets/infographics/a.png",
    ]) {
      const refused = (await appTools.app_asset!(
        context({}, { evolveUrl }).ctx,
        call({ appId: "app-1", url }),
      )) as Result;
      expect(refused.error).toMatch(/Only pictures/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    const added = (await appTools.app_asset!(
      context({}, { evolveUrl }).ctx,
      call({
        appId: "app-1",
        url: "https://evolve.example.co/storage/v1/object/public/slide-assets/infographics/0b9e-41.png",
      }),
    )) as Result;
    expect(added).toMatchObject({ assetId: "asset-1" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: "error" }),
    );
  });
});
