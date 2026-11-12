import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./run-messages.js", async (importActual) => ({
  ...(await importActual<typeof import("./run-messages.js")>()),
  publishMessage: vi.fn(),
}));

const db = vi.hoisted(() => ({
  createAppPage: vi.fn(),
  appendAppVersion: vi.fn(),
  readAppTables: vi.fn(),
  listAppAssets: vi.fn(),
  readAppAsset: vi.fn(),
}));
vi.mock("@rakazo/db", async (importActual) => ({
  ...(await importActual<typeof import("@rakazo/db")>()),
  ...db,
}));

const { lookAtApp, lookProblems } = await import("./app-look.js");
const { appTools } = await import("./run-tools-apps.js");

const APP = `import { AppShell } from "@ocsc/ui";
export default function App() {
  return <AppShell title="Jobs" pages={[{ id: "overview", label: "Overview", render: () => <p>Hi</p> }]} />;
}
`;
const CLEAN = {
  pages: [{ id: "overview", label: "Overview" }],
  errors: [],
  crashed: null,
  blank: [],
  overflow: [],
  blocked: [],
  shots: [],
};

let dataDir: string;
type Run = { workspace: { root: string; mount: string }; program: string; args: string[] };
let runs: Run[];
let html: string;

/** A runner that reads the app it was given and answers with `report` and one screenshot per shot. */
function runner(report: Record<string, unknown>) {
  return {
    run: vi.fn(async (input: Run) => {
      runs.push(input);
      html = await readFile(path.join(input.workspace.root, "app.html"), "utf8");
      const out = path.join(input.workspace.root, "out");
      await mkdir(out, { recursive: true });
      for (const shot of (report.shots as Array<{ file: string }>) ?? [])
        await writeFile(path.join(out, shot.file), Buffer.from("jpeg"));
      await writeFile(path.join(out, "report.json"), JSON.stringify(report));
      return { stdout: "", stderr: "", code: 0 };
    }),
  };
}

function context(toolRunner: unknown, acceptsImages = true) {
  return {
    deps: {
      prisma: {
        page: {
          findFirst: vi.fn(async () => ({
            id: "app-1",
            title: "Jobs",
            kind: "app",
            currentVersion: 3,
            dataAccess: "owner",
            versions: [{ source: JSON.stringify({ "App.tsx": APP }) }],
          })),
          update: vi.fn(),
        },
      },
      toolRunner,
      dataDir,
      evolvePlugins: null,
    },
    run: { id: "run-1", spaceId: "space-1", userId: "user-1", threadId: "t-1", botId: "bot-1" },
    bot: { id: "bot-1" },
    thread: { groupId: null },
    secrets: [],
    state: { tainted: false },
    computer: { acceptsImages },
    context: { spaceId: "space-1", userId: "user-1", signal: new AbortController().signal },
  } as never;
}

const call = (args: Record<string, unknown>) =>
  ({ args, finish: (result: unknown) => result }) as never;
type Result = Record<string, unknown>;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "app-look-"));
  runs = [];
  html = "";
  for (const fn of Object.values(db)) fn.mockReset();
  db.createAppPage.mockResolvedValue({ pageId: "app-1", version: 1, title: "Jobs" });
  db.appendAppVersion.mockResolvedValue({ version: 4, title: "Jobs" });
  db.readAppTables.mockResolvedValue({
    jobs: {
      schema: { name: "jobs", label: "Jobs", columns: [] },
      rows: [{ _id: "r1", name: "Quay" }],
    },
  });
  db.listAppAssets.mockResolvedValue([{ id: "pic-1", size: 4, mime: "image/png" }]);
  db.readAppAsset.mockResolvedValue({ mime: "image/png", bytes: new Uint8Array([1, 2, 3, 4]) });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("lookAtApp", () => {
  it("opens the app with its rows and pictures inlined in a folder of its own, then removes it", async () => {
    const look = await lookAtApp(
      (context(runner(CLEAN)) as { deps: never }).deps,
      {
        pageId: "app-1",
        title: "Jobs",
        files: { "App.tsx": APP },
        owner: "user-1",
        viewerName: null,
        signal: new AbortController().signal,
      },
      { check: true },
    );
    expect(look?.report.pages).toEqual([{ id: "overview", label: "Overview" }]);
    const [run] = runs;
    expect(run!.program).toBe("app-shot");
    expect(run!.args).toEqual(["app.html", "out", "--check"]);
    expect(run!.workspace.mount).toMatch(/^tool-work\/documents\/app-shot-[0-9a-f-]{36}$/);
    expect(html).toContain("__OCSC_APP_FIXTURE__");
    expect(html).toContain("Quay");
    expect(html).toContain("data:image/png;base64,AQIDBA==");
    expect(await readdir(path.join(dataDir, "tool-work", "documents"))).toEqual([]);
  });

  it("is unavailable without runners", async () => {
    const ctx = context(undefined) as { deps: unknown };
    const look = await lookAtApp(ctx.deps as never, {
      pageId: "app-1",
      title: "Jobs",
      files: { "App.tsx": APP },
      owner: "user-1",
      viewerName: null,
      signal: new AbortController().signal,
    });
    expect(look).toBeNull();
  });

  it("explains every kind of problem in a sentence", () => {
    expect(
      lookProblems({
        ...CLEAN,
        crashed: { page: "Board", message: "x is null" },
        errors: [
          { page: "Board", message: "TypeError: x is null" },
          { page: "Jobs", message: "Warning: keys" },
        ],
        blank: ["Settings"],
        overflow: [{ page: "Jobs", width: 720 }],
        blocked: ["https://example.com/api"],
      }),
    ).toEqual([
      "The Board page crashed: x is null",
      "Error on Jobs: Warning: keys",
      "The Settings page shows nothing.",
      "On a phone the Jobs page is 720px wide and scrolls sideways; let it wrap or stack.",
      "The app tried the network (https://example.com/api); apps have none, so read data through @ocsc/app.",
    ]);
  });
});

describe("save_app run check", () => {
  it("reports a clean run with the page ids", async () => {
    const result = (await appTools.save_app!(
      context(runner(CLEAN)),
      call({ title: "Jobs", brief: "Tracks jobs.", files: { "App.tsx": APP } }),
    )) as Result;
    expect(result.runCheck).toBe("ran cleanly on 1 page(s), desktop and phone");
    expect(result.pages).toEqual([{ id: "overview", label: "Overview" }]);
  });

  it("returns what broke while keeping the save", async () => {
    const result = (await appTools.save_app!(
      context(runner({ ...CLEAN, crashed: { page: "Overview", message: "boom" } })),
      call({ appId: "app-1", edits: [{ find: "Hi", replace: "Hello" }] }),
    )) as Result;
    expect(result).toMatchObject({ appId: "app-1", version: 4, runCheck: "problems" });
    expect(result.problems).toEqual(["The Overview page crashed: boom"]);
  });

  it("skips the check when asked, and when only tables change", async () => {
    const tool = runner(CLEAN);
    await appTools.save_app!(
      context(tool),
      call({ appId: "app-1", edits: [{ find: "Hi", replace: "Hey" }], check: false }),
    );
    expect(tool.run).not.toHaveBeenCalled();
  });

  it("still saves when the runner fails", async () => {
    const failing = { run: vi.fn(async () => ({ stdout: "", stderr: "no browser\n", code: 2 })) };
    const result = (await appTools.save_app!(
      context(failing),
      call({ title: "Jobs", brief: "Tracks jobs.", files: { "App.tsx": APP } }),
    )) as Result;
    expect(result.appId).toBe("app-1");
    expect(result.runCheck).toBe("not run (no browser)");
  });
});

describe("app_look", () => {
  const shots = {
    ...CLEAN,
    shots: [
      {
        file: "desktop-1.jpg",
        page: "Overview",
        viewport: "desktop",
        width: 1440,
        height: 900,
        cut: false,
      },
      {
        file: "phone-1.jpg",
        page: "Overview",
        viewport: "phone",
        width: 390,
        height: 1600,
        cut: true,
      },
    ],
  };

  it("returns screenshots to a model that sees images, and taints the run", async () => {
    const ctx = context(runner(shots));
    const result = (await appTools.app_look!(
      ctx,
      call({ appId: "app-1", pages: ["overview", "../x"], phone: true }),
    )) as { kind: string; content: Array<{ type: string; mimeType?: string }> };
    expect(result.kind).toBe("agent_tool_result");
    expect(result.content.map((part) => part.type)).toEqual(["text", "image", "image"]);
    expect(result.content[1]!.mimeType).toBe("image/jpeg");
    expect(runs[0]!.args).toEqual(["app.html", "out", "--phone", "--pages", "overview"]);
    expect((ctx as { state: { tainted: boolean } }).state.tainted).toBe(true);
  });

  it("describes the pages to a model without vision", async () => {
    const result = (await appTools.app_look!(
      context(runner(shots), false),
      call({ appId: "app-1" }),
    )) as Result;
    expect(result.note).toMatch(/cannot see images/);
    expect(result.shots).toHaveLength(2);
  });

  it("says so where there are no runners", async () => {
    const result = (await appTools.app_look!(
      context(undefined),
      call({ appId: "app-1" }),
    )) as Result;
    expect(String(result.error)).toMatch(/cannot open apps/);
  });
});
