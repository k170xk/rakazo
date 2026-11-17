import { mkdir, mkdtemp, readdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PYTHON_FIXTURE_URL, PYTHON_RUNTIME } from "@rakazo/app-kit/python/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const publishMessage = vi.hoisted(() => vi.fn());
vi.mock("./run-messages.js", async (importActual) => ({
  ...(await importActual<typeof import("./run-messages.js")>()),
  publishMessage: (...args: unknown[]) => publishMessage(...args),
}));

const db = vi.hoisted(() => ({
  createAppPage: vi.fn(),
  appendAppVersion: vi.fn(),
  markAppVersionGood: vi.fn(),
  readAppTables: vi.fn(),
  listAppAssets: vi.fn(),
  readAppAsset: vi.fn(),
}));
vi.mock("@rakazo/db", async (importActual) => ({
  ...(await importActual<typeof import("@rakazo/db")>()),
  ...db,
}));

const { brokenAppLook, findPythonRuntime, lookAtApp, lookProblems, pythonFilesOf } = await import(
  "./app-look.js"
);
const { appTools } = await import("./run-tools-apps.js");

const APP = `import { AppShell, Theme } from "@ocsc/ui";
export default function App() {
  return (
    <Theme preset="evolve">
      <AppShell title="Jobs" pages={[{ id: "overview", label: "Overview", render: () => <p>Hi</p> }]} />
    </Theme>
  );
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
          findUnique: vi.fn(async () => ({ goodVersion: 3, currentVersion: 4 })),
        },
        pageVersion: { count: vi.fn(async () => 1), findUnique: vi.fn() },
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
  publishMessage.mockReset();
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
    const problems = lookProblems({
      ...CLEAN,
      crashed: { page: "Board", message: "x is null" },
      errors: [
        { page: "Board", message: "TypeError: x is null" },
        { page: "Jobs", message: "Warning: keys" },
      ],
      blank: ["Settings"],
      overflow: [{ page: "Jobs", width: 720 }],
      blocked: ["https://example.com/api"],
    });
    expect(problems).toEqual([
      "The Board page crashed: x is null",
      "Error on Jobs: Warning: keys",
      "The Settings page shows nothing.",
      "On a phone the Jobs page is 720px wide and scrolls sideways; let it wrap or stack.",
      "The app tried the network (https://example.com/api); apps have none, so read data through @ocsc/app.",
    ]);
    expect(brokenAppLook(problems)).toBe(true);
    expect(brokenAppLook(["On a phone the Jobs page is 720px wide and scrolls sideways"])).toBe(
      false,
    );
  });

  it("names what breaks a page on a phone", () => {
    const problems = lookProblems({
      ...CLEAN,
      overflow: [{ page: "Jobs", width: 660, culprits: ['div "Fixed panel" 640px wide'] }],
      phone: [
        { page: "Jobs", kind: "zoom", items: ['input "Raw field"'] },
        { page: "Jobs", kind: "tap", items: ['button "Remove" 24x24'] },
        { page: "Jobs", kind: "tiny", items: ['"Fine print" 9px'] },
      ],
    });
    expect(problems[0]).toContain('(div "Fixed panel" 640px wide)');
    expect(problems[1]).toMatch(/zooms the page.*input "Raw field".*text-base/);
    expect(problems[2]).toMatch(/smaller than a fingertip.*button "Remove" 24x24/);
    expect(problems[3]).toMatch(/too small to read.*"Fine print" 9px/);
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
    expect(publishMessage).toHaveBeenCalled();
    expect(result.card).toBeUndefined();
  });

  it("returns what broke while keeping the save", async () => {
    const result = (await appTools.save_app!(
      context(runner({ ...CLEAN, crashed: { page: "Overview", message: "boom" } })),
      call({ appId: "app-1", edits: [{ find: "Hi", replace: "Hello" }] }),
    )) as Result;
    expect(result).toMatchObject({ appId: "app-1", version: 4, runCheck: "problems" });
    expect(result.problems).toEqual(["The Overview page crashed: boom"]);
    expect(String(result.next)).toMatch(/save_app again/);
    expect(String(result.card)).toMatch(/skipped/);
    expect(publishMessage).not.toHaveBeenCalled();
  });

  it("shows people the last good version until a save passes", async () => {
    await appTools.save_app!(
      context(runner(CLEAN)),
      call({ appId: "app-1", edits: [{ find: "Hi", replace: "Hello" }] }),
    );
    expect(db.markAppVersionGood).toHaveBeenCalledWith(expect.anything(), "app-1", 4);
    db.markAppVersionGood.mockClear();
    const result = (await appTools.save_app!(
      context(runner({ ...CLEAN, crashed: { page: "Overview", message: "boom" } })),
      call({ appId: "app-1", edits: [{ find: "Hi", replace: "Hello" }] }),
    )) as Result;
    expect(db.markAppVersionGood).not.toHaveBeenCalled();
    expect(String(result.shown)).toMatch(/still see version 3/);
    expect(result.restored).toBeUndefined();
  });

  it("puts the last good version back after three crashing saves in one run", async () => {
    const ctx = context(runner({ ...CLEAN, crashed: { page: "Overview", message: "boom" } }));
    const prisma = (
      ctx as { deps: { prisma: Record<string, Record<string, ReturnType<typeof vi.fn>>> } }
    ).deps.prisma;
    prisma.pageVersion!.count!.mockResolvedValueOnce(3).mockResolvedValueOnce(0);
    prisma.pageVersion!.findUnique!.mockResolvedValueOnce({
      source: JSON.stringify({ "App.tsx": APP }),
      code: "<html>good</html>",
    });
    db.appendAppVersion
      .mockResolvedValueOnce({ version: 4, title: "Jobs" })
      .mockResolvedValueOnce({ version: 5, title: "Jobs" });
    const result = (await appTools.save_app!(
      ctx,
      call({ appId: "app-1", edits: [{ find: "Hi", replace: "Hello" }] }),
    )) as Result;
    expect(db.appendAppVersion).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ via: "restore", restoredFrom: 3, code: "<html>good</html>" }),
    );
    expect(result.restored).toEqual({ version: 5, from: 3 });
    expect(String(result.next)).toMatch(/put back to the last version that worked/);
    expect(String(result.next)).toMatch(/keeping every existing page/);
    expect(publishMessage).not.toHaveBeenCalled();
  });

  it("skips the chat card when runCheck finds a blank window", async () => {
    const result = (await appTools.save_app!(
      context(runner({ ...CLEAN, blank: ["overview"] })),
      call({ title: "Jobs", brief: "Tracks jobs.", files: { "App.tsx": APP } }),
    )) as Result;
    expect(result).toMatchObject({ appId: "app-1", version: 1, runCheck: "problems" });
    expect(result.problems).toEqual(["The overview page shows nothing."]);
    expect(String(result.next)).toMatch(/Do not present a blank/);
    expect(publishMessage).not.toHaveBeenCalled();
  });

  it("skips the check when asked, and when only tables change", async () => {
    const tool = runner(CLEAN);
    await appTools.save_app!(
      context(tool),
      call({ appId: "app-1", edits: [{ find: "Hi", replace: "Hey" }], check: false }),
    );
    expect(tool.run).not.toHaveBeenCalled();
  });

  it("still saves when the runner fails, but skips the card and forces iterate", async () => {
    const failing = { run: vi.fn(async () => ({ stdout: "", stderr: "no browser\n", code: 2 })) };
    const result = (await appTools.save_app!(
      context(failing),
      call({ title: "Jobs", brief: "Tracks jobs.", files: { "App.tsx": APP } }),
    )) as Result;
    expect(result.appId).toBe("app-1");
    expect(result.runCheck).toBe("not run (no browser)");
    expect((result.problems as string[] | undefined)?.[0]).toMatch(/could not be opened to check/);
    expect(String(result.next)).toMatch(/save_app again/);
    expect(String(result.card)).toMatch(/skipped/);
    expect(publishMessage).not.toHaveBeenCalled();
  });
});

describe("apps with Python", () => {
  const PY = "import numpy as np\nfrom scipy import optimize\n\ndef calc(inputs):\n    return {}\n";
  const PY_APP = `import { AppShell, Theme } from "@ocsc/ui";
import { usePython } from "@ocsc/python";
import pipePy from "./pipe.py";
export default function App() {
  const pipe = usePython(pipePy, { flow: 1 });
  return (
    <Theme preset="evolve">
      <AppShell title="Pipe">{pipe.status}</AppShell>
    </Theme>
  );
}
`;
  const files = { "App.tsx": PY_APP, "pipe.py": PY };
  const core = [
    "pyodide.mjs",
    "pyodide.asm.mjs",
    "pyodide.asm.wasm",
    "python_stdlib.zip",
    "pyodide-lock.json",
  ];
  const scipyWheels = PYTHON_RUNTIME.packages.scipy;

  /** An installed runtime folder whose files have the pinned sizes (sparse, so nothing is written). */
  async function installed(names: string[]) {
    const dir = path.join(dataDir, "installed");
    await mkdir(path.join(dir, PYTHON_RUNTIME.version), { recursive: true });
    for (const name of names) {
      const file = path.join(dir, PYTHON_RUNTIME.version, name);
      await writeFile(file, "");
      await truncate(file, PYTHON_RUNTIME.files[name]!.bytes);
    }
    return dir;
  }

  /** A runner that also lists what the look's folder holds under python/. */
  function pythonRunner(staged: string[]) {
    const inner = runner(CLEAN);
    return {
      run: vi.fn(async (input: Run) => {
        const folder = path.join(input.workspace.root, "python", PYTHON_RUNTIME.version);
        staged.push(...(await readdir(folder).catch(() => [])));
        return inner.run(input);
      }),
    };
  }

  const look = (toolRunner: unknown, options = {}) =>
    lookAtApp(
      (context(toolRunner) as { deps: never }).deps,
      {
        pageId: "app-1",
        title: "Pipe",
        files,
        owner: "user-1",
        viewerName: null,
        signal: new AbortController().signal,
      },
      options,
    );

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("asks app-shot for runtime files at the address the app fetches, under the viewer's policy", async () => {
    const shot = await readFile(
      new URL(
        "../../../infra/sandboxes/computer/ocsc/ocsc-app-shot/ocsc-app-shot.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    expect(shot).toContain(`const PYTHON_URL = "${PYTHON_FIXTURE_URL}";`);
    expect(shot).toContain(
      "script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:; worker-src blob:;",
    );
    expect(shot).toContain("data-python-busy");
  });

  it("knows which runtime files an app's calculations load", () => {
    expect(pythonFilesOf({ "App.tsx": APP })).toBeNull();
    expect(pythonFilesOf(files)).toEqual([...core, ...scipyWheels]);
    expect(pythonFilesOf({ "App.tsx": 'import { runPython } from "@ocsc/python";' })).toEqual(core);
  });

  it("only counts an install that holds every file at its pinned size", async () => {
    const dir = await installed([...core, scipyWheels[0]!]);
    expect(await findPythonRuntime([...core, ...scipyWheels], [dir])).toBeNull();
    expect(await findPythonRuntime(core, [path.join(dataDir, "nowhere"), dir])).toBe(
      path.join(dir, PYTHON_RUNTIME.version),
    );
    await truncate(path.join(dir, PYTHON_RUNTIME.version, "pyodide.mjs"), 1);
    expect(await findPythonRuntime(core, [dir])).toBeNull();
  });

  it("copies just the files the app needs into the look and lets its calculations run there", async () => {
    vi.stubEnv("RAKAZO_PYTHON_RUNTIME_DIR", await installed(Object.keys(PYTHON_RUNTIME.files)));
    const staged: string[] = [];
    const tool = pythonRunner(staged);
    const result = await look(tool, { check: true });
    expect(result?.python).toBe("ran");
    expect(staged.sort()).toEqual([...core, ...scipyWheels].sort());
    expect(runs[0]!.args).toEqual(["app.html", "out", "--check", "--python", "python"]);
    expect(html).toMatch(/"features":\["assets","python"\]/);
    const timeout = (tool.run.mock.calls[0]![0] as unknown as { timeoutMs: number }).timeoutMs;
    expect(timeout).toBeGreaterThan(60_000);
    expect(await readdir(path.join(dataDir, "tool-work", "documents"))).toEqual([]);
  });

  it("shows the calculations as unavailable, and says why, where no runtime is installed", async () => {
    vi.stubEnv("RAKAZO_PYTHON_RUNTIME_DIR", path.join(dataDir, "nowhere"));
    const staged: string[] = [];
    const result = await look(pythonRunner(staged));
    expect(result?.python).toBe("unavailable");
    expect(staged).toEqual([]);
    expect(runs[0]!.args).not.toContain("--python");
    expect(html).toMatch(/"features":\["assets"\]/);

    const ctx = context(runner(CLEAN), false);
    const page = (ctx as { deps: { prisma: { page: { findFirst: ReturnType<typeof vi.fn> } } } })
      .deps.prisma.page.findFirst;
    page.mockResolvedValueOnce({
      id: "app-1",
      title: "Pipe",
      kind: "app",
      currentVersion: 1,
      dataAccess: "owner",
      versions: [{ source: JSON.stringify(files) }],
    });
    const answer = (await appTools.app_look!(ctx, call({ appId: "app-1" }))) as Result;
    expect(String(answer.python)).toMatch(/no Python runtime installed/);
  });

  it("lets the assistant save .py files, refusing any that would not give the same answer twice", async () => {
    vi.stubEnv("RAKAZO_PYTHON_RUNTIME_DIR", path.join(dataDir, "nowhere"));
    const saved = (await appTools.save_app!(
      context(runner(CLEAN)),
      call({ title: "Pipe", brief: "Checks pipe losses.", files }),
    )) as Result;
    expect(saved.appId).toBe("app-1");
    const refused = (await appTools.save_app!(
      context(runner(CLEAN)),
      call({
        title: "Pipe",
        brief: "Checks pipe losses.",
        files: { ...files, "pipe.py": "import time\nstarted = time.time()\n" },
      }),
    )) as Result;
    expect(refused.appId).toBeUndefined();
    expect(JSON.stringify(refused)).toContain("pipe.py line 2 reads the clock");
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
