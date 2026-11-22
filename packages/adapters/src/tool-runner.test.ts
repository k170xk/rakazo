import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { documentHomePath } from "./file-retention.js";
import type { ToolRunnerStatus } from "./tool-runner.js";
import {
  conversationFolderRefusal,
  ensureToolRunnerFolder,
  folderFiles,
  largestInputBytes,
  listFolderFiles,
  overflowRunnerQuiet,
  TOOL_RUNNER_COMPUTER,
  ToolRunnerClient,
  toolRunnerFromEnv,
  toolRunnerWorkspace,
} from "./tool-runner.js";

const context = {
  spaceId: "s",
  userId: "u",
  operationId: "o",
  traceId: "t",
  signal: new AbortController().signal,
};
let data: string;

beforeEach(async () => {
  data = await mkdtemp(path.join(tmpdir(), "tool-runner-"));
});

afterEach(async () => {
  await rm(data, { recursive: true, force: true });
});

describe("tool runner workspace", () => {
  it("puts a colleague's turn in tool-work, outside every home", () => {
    const workspace = toolRunnerWorkspace({
      dataDir: data,
      homePath: path.join(data, "homes/team-a"),
      mode: "team",
      botId: "b1",
      folder: "conversations/t1",
    });
    expect(workspace).toEqual({
      base: path.join(data, "tool-work"),
      mount: "tool-work/conversations/t1",
      cwd: "",
      root: path.join(data, "tool-work/conversations/t1"),
      conversation: path.join(data, "tool-work/conversations/t1"),
    });
  });

  it("gives a Tools-only owner their own agent folder in their home", () => {
    expect(
      toolRunnerWorkspace({
        dataDir: data,
        homePath: path.join(data, "homes/team-a"),
        mode: "team",
        botId: "b1",
        folder: undefined,
      }),
    ).toEqual({
      base: path.join(data, "homes/team-a"),
      mount: "homes/team-a",
      cwd: "bots/b1",
      root: path.join(data, "homes/team-a"),
    });
  });

  it("gives the owner of a computer that keeps its own home a document home in tool-work", () => {
    expect(documentHomePath(data, "team-a")).toBe(path.join(data, "tool-work/documents/team-a"));
    expect(documentHomePath(data, "../homes")).toBeNull();
    expect(
      toolRunnerWorkspace({
        dataDir: data,
        homePath: documentHomePath(data, "team-a"),
        mode: "team",
        botId: "b1",
        folder: undefined,
      }),
    ).toEqual({
      base: path.join(data, "tool-work/documents/team-a"),
      mount: "tool-work/documents/team-a",
      cwd: "bots/b1",
      root: path.join(data, "tool-work/documents/team-a"),
    });
    expect(
      toolRunnerWorkspace({
        dataDir: data,
        homePath: path.join(data, "tool-work/conversations/t1"),
        mode: "team",
        botId: "b1",
        folder: undefined,
      }),
    ).toBeUndefined();
  });

  it("makes the agent folder for someone whose computer never started", async () => {
    const workspace = toolRunnerWorkspace({
      dataDir: data,
      homePath: path.join(data, "homes/team-new"),
      mode: "team",
      botId: "b1",
      folder: undefined,
    })!;
    await ensureToolRunnerFolder(workspace);
    expect((await stat(path.join(data, "homes/team-new/bots/b1"))).isDirectory()).toBe(true);
    await ensureToolRunnerFolder(workspace);
  });

  it("has none for a home kept elsewhere", () => {
    const outside = { dataDir: data, mode: "team" as const, botId: "b1", folder: undefined };
    expect(toolRunnerWorkspace({ ...outside, homePath: null })).toBeUndefined();
    expect(toolRunnerWorkspace({ ...outside, homePath: "/elsewhere/home" })).toBeUndefined();
  });
});

describe("files in a runner folder", () => {
  it("writes, lists and reads inside the folder", async () => {
    const files = folderFiles(path.join(data, "tool-work"));
    const content = new TextEncoder().encode("hello");
    await files.writeFile(
      TOOL_RUNNER_COMPUTER,
      { path: "conversations/t1/work/a.txt", content },
      context,
    );
    expect(await files.listFiles(TOOL_RUNNER_COMPUTER, "conversations/t1/work", context)).toEqual([
      { path: "conversations/t1/work/a.txt", kind: "file", size: 5 },
    ]);
    const read = await files.readFile(TOOL_RUNNER_COMPUTER, "conversations/t1/work/a.txt", context);
    expect(new TextDecoder().decode(read)).toBe("hello");
    await expect(
      files.readFile(TOOL_RUNNER_COMPUTER, "conversations/t1/work/a.txt", context, { maxBytes: 2 }),
    ).rejects.toThrow(/exceeds 2 bytes/);
  });

  it("never follows a link out of the folder", async () => {
    const secret = path.join(data, "homes/team-b/secret.txt");
    await mkdir(path.dirname(secret), { recursive: true });
    await writeFile(secret, "someone else's");
    const base = path.join(data, "tool-work");
    await mkdir(path.join(base, "conversations/t1"), { recursive: true });
    await symlink(secret, path.join(base, "conversations/t1/file.txt"));
    await symlink(path.dirname(secret), path.join(base, "conversations/t1/dir"));
    const files = folderFiles(base);
    await expect(
      files.readFile(TOOL_RUNNER_COMPUTER, "conversations/t1/file.txt", context),
    ).rejects.toThrow();
    await expect(
      files.readFile(TOOL_RUNNER_COMPUTER, "conversations/t1/dir/secret.txt", context),
    ).rejects.toThrow();
    await expect(
      files.writeFile(
        TOOL_RUNNER_COMPUTER,
        { path: "conversations/t1/dir/new.txt", content: new Uint8Array() },
        context,
      ),
    ).rejects.toThrow();
    expect(await files.listFiles(TOOL_RUNNER_COMPUTER, "conversations/t1", context)).toEqual([]);
    expect(await files.listFiles(TOOL_RUNNER_COMPUTER, "conversations/t1/dir", context)).toEqual(
      [],
    );
    await expect(
      files.readFile(TOOL_RUNNER_COMPUTER, "conversations/../../homes/team-b/secret.txt", context),
    ).rejects.toThrow();
  });

  it("stops a conversation folder taking more work once it is full", async () => {
    const workspace = toolRunnerWorkspace({
      dataDir: data,
      homePath: null,
      mode: "team",
      botId: "b1",
      folder: "conversations/t1",
    })!;
    expect(await conversationFolderRefusal(workspace)).toBeUndefined();
  });
});

describe("runners on another server", () => {
  let server: Server;
  let url: string;
  const remote = new Map<string, { content: Buffer; mtimeMs: number }>();
  const calls: string[] = [];

  beforeEach(async () => {
    remote.clear();
    calls.length = 0;
    server = createServer(async (req, res) => {
      const target = new URL(req.url ?? "", "http://runner");
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);
      const json = (value: unknown) => res.end(JSON.stringify(value));
      calls.push(
        `${req.method} ${target.pathname} ${target.searchParams.get("path") ?? ""}`.trim(),
      );
      if (target.pathname === "/tool-runs/files/list") {
        json({
          files: [...remote].map(([name, file]) => ({
            path: name,
            size: file.content.length,
            mtimeMs: file.mtimeMs,
          })),
        });
      } else if (target.pathname === "/tool-runs/files" && req.method === "PUT") {
        remote.set(target.searchParams.get("path")!, {
          content: body,
          mtimeMs: Number(target.searchParams.get("mtimeMs")),
        });
        json({ size: body.length });
      } else if (target.pathname === "/tool-runs/files") {
        const file = remote.get(target.searchParams.get("path")!);
        if (!file) return void res.writeHead(404).end();
        res.writeHead(200, { "x-rakazo-mtime-ms": String(file.mtimeMs) }).end(file.content);
      } else if (target.pathname === "/tool-runs/files/delete") {
        for (const name of JSON.parse(body.toString()).paths) remote.delete(name);
        json({});
      } else if (target.pathname === "/tool-runs/run") {
        expect(JSON.parse(body.toString()).synced).toBe(true);
        remote.set("out/report.docx", { content: Buffer.from("made"), mtimeMs: 1_700_000_000_000 });
        res.end(`${JSON.stringify({ type: "exit", code: 0 })}\n`);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("sends changed files, drops removed ones, and brings back what the run made", async () => {
    const workspace = toolRunnerWorkspace({
      dataDir: data,
      homePath: null,
      mode: "team",
      botId: "b1",
      folder: "conversations/t1",
    })!;
    await mkdir(path.join(workspace.root, "in"), { recursive: true });
    await writeFile(path.join(workspace.root, "in/brief.txt"), "brief");
    await symlink("/etc/passwd", path.join(workspace.root, "in/link"));
    const unchanged = (await listFolderFiles(workspace.root, ""))[0]!;
    remote.set("in/brief.txt", { content: Buffer.from("brief"), mtimeMs: unchanged.mtimeMs });
    remote.set("old.txt", { content: Buffer.from("gone"), mtimeMs: 1 });
    await writeFile(path.join(workspace.root, "in/new.txt"), "new");

    const client = toolRunnerFromEnv(
      { RAKAZO_TOOL_RUNNER_URL: url, RAKAZO_TOOL_RUNNER_TOKEN: "t" },
      "docker",
      { url: "", token: undefined },
    )!;
    const result = await client.run({
      workspace,
      program: "word",
      args: [],
      owner: "u1",
      timeoutMs: 1000,
      signal: new AbortController().signal,
    });

    expect(result.code).toBe(0);
    expect(calls.filter((call) => call.startsWith("PUT"))).toEqual([
      "PUT /tool-runs/files in/new.txt",
    ]);
    expect(remote.has("old.txt")).toBe(false);
    expect(remote.has("in/link")).toBe(false);
    expect(calls.filter((call) => call.startsWith("GET"))).toEqual([
      "GET /tool-runs/files out/report.docx",
    ]);
    const copied = path.join(workspace.root, "out/report.docx");
    expect(await readFile(copied, "utf8")).toBe("made");
    expect(Math.round((await stat(copied)).mtimeMs)).toBe(1_700_000_000_000);
  });
});

describe("tool runner configuration", () => {
  const supervisor = { url: "http://supervisor:7091", token: "token" };

  it("uses the supervisor on a Docker install unless switched off", () => {
    expect(toolRunnerFromEnv({}, "docker", supervisor)).toBeDefined();
    expect(toolRunnerFromEnv({ RAKAZO_TOOL_RUNNER: "off" }, "docker", supervisor)).toBeUndefined();
    expect(toolRunnerFromEnv({}, "e2b", supervisor)).toBeUndefined();
  });

  it("can point at a runner on another server", () => {
    expect(
      toolRunnerFromEnv(
        { RAKAZO_TOOL_RUNNER_URL: "https://runners.example", RAKAZO_TOOL_RUNNER_TOKEN: "t" },
        "e2b",
        { url: "", token: undefined },
      ),
    ).toBeDefined();
  });

  it("shares the folder with the stack's own supervisor when computers run elsewhere", () => {
    const synced = (env: NodeJS.ProcessEnv) =>
      (
        toolRunnerFromEnv(env, "incus", { url: supervisor.url, token: undefined }) as unknown as {
          options: { synced?: boolean };
        }
      ).options.synced;
    expect(synced({ RAKAZO_TOOL_RUNNER_URL: supervisor.url, RAKAZO_TOOL_RUNNER_TOKEN: "t" })).toBe(
      false,
    );
    expect(
      synced({ RAKAZO_TOOL_RUNNER_URL: "https://runners.example", RAKAZO_TOOL_RUNNER_TOKEN: "t" }),
    ).toBe(true);
  });
});

describe("overflow runners", () => {
  type Fake = {
    url: string;
    calls: string[];
    bodies: Record<string, unknown>[];
    status: ToolRunnerStatus | "down";
    runDelayMs?: number;
    close(): Promise<void>;
  };
  const quietHost = { load1: 0.4, cpus: 8, memAvailableBytes: 28 * 1024 ** 3 };
  const fakes: Fake[] = [];

  async function fakeRunner(status: ToolRunnerStatus | "down", events: object[] = []) {
    const fake = { calls: [] as string[], bodies: [], status } as unknown as Fake;
    const server = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      const route = new URL(req.url ?? "", "http://runner").pathname;
      fake.calls.push(route);
      if (route === "/tool-runs/status") {
        if (fake.status === "down") return void res.writeHead(503).end();
        return void res.end(JSON.stringify(fake.status));
      }
      if (route === "/tool-runs/files/list") return void res.end(JSON.stringify({ files: [] }));
      if (route === "/tool-runs/run") {
        fake.bodies.push(JSON.parse(body));
        if (fake.runDelayMs) await new Promise((resolve) => setTimeout(resolve, fake.runDelayMs));
        res.end(
          [...events, { type: "exit", code: 0 }]
            .map((event) => `${JSON.stringify(event)}\n`)
            .join(""),
        );
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    fake.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
    fakes.push(fake);
    return fake;
  }

  afterEach(async () => {
    await Promise.all(fakes.splice(0).map((fake) => fake.close()));
  });

  const full = { slots: 2, running: 2, queued: 3 };
  const free = { slots: 2, running: 1, queued: 0 };

  const clientFor = (primary: Fake, overflow: Fake[]) =>
    toolRunnerFromEnv(
      {
        RAKAZO_TOOL_RUNNER_URL: primary.url,
        RAKAZO_TOOL_RUNNER_TOKEN: "t",
        RAKAZO_TOOL_RUNNER_OVERFLOW_URLS: overflow.map((fake) => fake.url).join(", "),
      },
      "incus",
      { url: primary.url, token: undefined },
    )!;

  async function runOn(
    primary: Fake,
    overflow: Fake[],
    onStarted?: () => void,
    client = clientFor(primary, overflow),
    extra: Partial<Parameters<ToolRunnerClient["run"]>[0]> = {},
  ) {
    const workspace = toolRunnerWorkspace({
      dataDir: data,
      homePath: null,
      mode: "team",
      botId: "b1",
      folder: "conversations/t1",
    })!;
    await ensureToolRunnerFolder(workspace);
    return client.run({
      workspace,
      program: "word",
      args: [],
      owner: "u1",
      timeoutMs: 1000,
      signal: new AbortController().signal,
      onStarted,
      ...extra,
    });
  }

  const ran = (fake: Fake) => fake.calls.includes("/tool-runs/run");

  it("spreads a burst that arrives at once instead of sending it all to the same free slots", async () => {
    const primary = await fakeRunner({ slots: 2, running: 0, queued: 0 });
    const spare = await fakeRunner({ slots: 2, running: 0, queued: 0, host: quietHost });
    primary.runDelayMs = 200;
    spare.runDelayMs = 200;
    const client = clientFor(primary, [spare]);
    await Promise.all(Array.from({ length: 5 }, () => runOn(primary, [spare], undefined, client)));
    const runs = (fake: Fake) => fake.calls.filter((call) => call === "/tool-runs/run").length;
    expect(runs(primary)).toBe(3);
    expect(runs(spare)).toBe(2);
  });

  it("sends a person at their cap to a quiet overflow runner, and others stay here", async () => {
    const capped = { slots: 16, running: 12, queued: 5, perOwner: 8, ownerRunning: 8 };
    const primary = await fakeRunner(capped);
    const spare = await fakeRunner({
      slots: 8,
      running: 0,
      queued: 0,
      perOwner: 4,
      ownerRunning: 0,
      host: quietHost,
    });
    await runOn(primary, [spare]);
    expect([ran(primary), ran(spare)]).toEqual([false, true]);
    const otherPrimary = await fakeRunner({ ...capped, ownerRunning: 0 });
    const otherSpare = await fakeRunner({ slots: 8, running: 0, queued: 0, host: quietHost });
    await runOn(otherPrimary, [otherSpare]);
    expect([ran(otherPrimary), ran(otherSpare)]).toEqual([true, false]);
  });

  it("never asks for status when no overflow runner is set", async () => {
    const primary = await fakeRunner(full);
    await runOn(primary, []);
    expect(primary.calls).toEqual(["/tool-runs/run"]);
  });

  it("stays on the main runner while it has a free slot", async () => {
    const primary = await fakeRunner(free);
    const spare = await fakeRunner({ ...free, host: quietHost });
    await runOn(primary, [spare]);
    expect(ran(primary)).toBe(true);
    expect(spare.calls).toEqual([]);
  });

  it("overflows to a quiet runner when the main one is full, sending it the folder", async () => {
    const primary = await fakeRunner(full);
    const spare = await fakeRunner({ ...free, host: quietHost });
    await runOn(primary, [spare]);
    expect(ran(primary)).toBe(false);
    expect(spare.calls).toEqual([
      "/tool-runs/status",
      "/tool-runs/files/list",
      "/tool-runs/run",
      "/tool-runs/files/list",
    ]);
  });

  it("waits on the main runner when the overflow server is busy, full, old or down", async () => {
    const busyHost = { ...quietHost, load1: 6 };
    const lowMemory = { ...quietHost, memAvailableBytes: 2 * 1024 ** 3 };
    for (const status of [
      { ...free, host: busyHost },
      { ...free, host: lowMemory },
      { ...full, host: quietHost },
      free,
      "down",
    ] as const) {
      const primary = await fakeRunner(full);
      const spare = await fakeRunner(status);
      await runOn(primary, [spare]);
      expect(ran(primary)).toBe(true);
      expect(ran(spare)).toBe(false);
    }
  });

  it("uses a quiet overflow runner when the main one cannot report, and waits there otherwise", async () => {
    const primary = await fakeRunner("down");
    const spare = await fakeRunner({ ...free, host: quietHost });
    await runOn(primary, [spare]);
    expect([ran(primary), ran(spare)]).toEqual([false, true]);
    const lonePrimary = await fakeRunner("down");
    const busySpare = await fakeRunner({ ...full, host: quietHost });
    await runOn(lonePrimary, [busySpare]);
    expect([ran(lonePrimary), ran(busySpare)]).toEqual([true, false]);
  });

  it("leaves an overflow runner that did not answer alone for a while", async () => {
    const primary = await fakeRunner(full);
    const spare = await fakeRunner("down");
    const client = clientFor(primary, [spare]);
    await runOn(primary, [spare], undefined, client);
    await runOn(primary, [spare], undefined, client);
    expect(spare.calls).toEqual(["/tool-runs/status"]);
  });

  it("sends a large file to a free large-document slot, here first, then elsewhere", async () => {
    const largeFree = { slots: 1, running: 0, queued: 0 };
    const largeBusy = { slots: 1, running: 1, queued: 0 };
    const primary = await fakeRunner({ ...full, large: largeFree });
    const spare = await fakeRunner({ ...free, host: quietHost, large: largeFree });
    await runOn(primary, [spare], undefined, undefined, { large: true });
    expect([ran(primary), ran(spare)]).toEqual([true, false]);
    expect(primary.bodies[0]?.large).toBe(true);
    const busyPrimary = await fakeRunner({ ...free, large: largeBusy });
    const otherSpare = await fakeRunner({ ...free, host: quietHost, large: largeFree });
    await runOn(busyPrimary, [otherSpare], undefined, undefined, { large: true });
    expect([ran(busyPrimary), ran(otherSpare)]).toEqual([false, true]);
  });

  it("keeps a large file here when no runner elsewhere has the large-document lane", async () => {
    const primary = await fakeRunner({ ...free, large: { slots: 1, running: 1, queued: 0 } });
    const oldSpare = await fakeRunner({ ...free, host: quietHost });
    await runOn(primary, [oldSpare], undefined, undefined, { large: true });
    expect([ran(primary), ran(oldSpare)]).toEqual([true, false]);
  });

  it("starts the output again when the runner retries with more memory", async () => {
    const primary = await fakeRunner(free, [
      { type: "stdout", data: "half" },
      { type: "retrying", reason: "memory" },
      { type: "stdout", data: "whole" },
    ]);
    let retried = 0;
    const result = await runOn(primary, [], undefined, undefined, {
      onRetry: () => {
        retried += 1;
      },
    });
    expect(result.stdout).toBe("whole");
    expect(retried).toBe(1);
    expect(primary.bodies[0]?.large).toBeUndefined();
  });

  it("tells the caller when a queued command gets its runner", async () => {
    const primary = await fakeRunner(free, [{ type: "queued", ahead: 2 }, { type: "started" }]);
    let started = 0;
    await runOn(primary, [], () => {
      started += 1;
    });
    expect(started).toBe(1);
  });

  it("spreads commands across dedicated peer runners before spilling to overflow", async () => {
    const peer1 = await fakeRunner({ slots: 8, running: 4, queued: 0, host: quietHost });
    const peer2 = await fakeRunner({ slots: 8, running: 1, queued: 0, host: quietHost });
    const peer3 = await fakeRunner({ slots: 8, running: 3, queued: 0, host: quietHost });
    const overflow = await fakeRunner({ slots: 8, running: 0, queued: 0, host: quietHost });
    const client = toolRunnerFromEnv(
      {
        RAKAZO_TOOL_RUNNER_URL: [peer1.url, peer2.url, peer3.url].join(","),
        RAKAZO_TOOL_RUNNER_TOKEN: "t",
        RAKAZO_TOOL_RUNNER_OVERFLOW_URLS: overflow.url,
      },
      "incus",
      { url: "http://supervisor:7091", token: undefined },
    )!;
    await runOn(peer1, [overflow], undefined, client);
    expect([ran(peer1), ran(peer2), ran(peer3), ran(overflow)]).toEqual([
      false,
      true,
      false,
      false,
    ]);

    // When every dedicated peer is full, spill to the quiet routine overflow runner.
    peer1.status = { slots: 8, running: 8, queued: 1, host: quietHost };
    peer2.status = { slots: 8, running: 8, queued: 1, host: quietHost };
    peer3.status = { slots: 8, running: 8, queued: 1, host: quietHost };
    await runOn(peer1, [overflow], undefined, client);
    expect(ran(overflow)).toBe(true);
  });

  it("needs a free video slot too before overflowing a video", () => {
    const status = { ...free, host: quietHost, video: { slots: 1, running: 1, queued: 0 } };
    expect(overflowRunnerQuiet(status, "word")).toBe(true);
    expect(overflowRunnerQuiet(status, "video")).toBe(false);
  });
});

describe("a runner that stalls", () => {
  const servers: Server[] = [];

  /** A runner that writes these events and then leaves the response open, or ends it. */
  async function stalledRunner(events: object[], end = false, pingMs = 0) {
    const server = createServer(async (req, res) => {
      for await (const _ of req);
      res.write(events.map((event) => `${JSON.stringify(event)}\n`).join(""));
      if (end) res.end();
      if (pingMs > 0) {
        const ping = setInterval(() => res.write(`${JSON.stringify({ type: "ping" })}\n`), pingMs);
        res.on("close", () => clearInterval(ping));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  async function runOn(url: string, signal = new AbortController().signal) {
    const workspace = toolRunnerWorkspace({
      dataDir: data,
      homePath: null,
      mode: "team",
      botId: "b1",
      folder: "conversations/t1",
    })!;
    await ensureToolRunnerFolder(workspace);
    const client = new ToolRunnerClient(url, "t", { limits: { silenceMs: 300, queueMs: 400 } });
    return client.run({
      workspace,
      program: "word",
      args: [],
      owner: "u1",
      timeoutMs: 1000,
      signal,
    });
  }

  it("gives up on a runner that goes silent", async () => {
    await expect(runOn(await stalledRunner([]))).rejects.toThrow(/lost contact/);
  });

  it("gives up on a queue that does not move, even while the runner pings", async () => {
    const url = await stalledRunner([{ type: "queued", ahead: 4 }], false, 100);
    await expect(runOn(url)).rejects.toThrow(/stayed busy/);
  });

  it("reports a runner that stops before the command exits", async () => {
    await expect(
      runOn(await stalledRunner([{ type: "stdout", data: "half" }], true)),
    ).rejects.toThrow(/stopped before the command finished/);
  });

  it("says plainly when the runner cannot be reached", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await expect(runOn(url)).rejects.toThrow(/could not reach the document runner/);
  });

  it("leaves a person's own stop as a plain abort", async () => {
    const stop = new AbortController();
    const url = await stalledRunner([{ type: "queued", ahead: 1 }]);
    setTimeout(() => stop.abort(), 50);
    await expect(runOn(url, stop.signal)).rejects.not.toThrow(/stayed busy|lost contact/);
  });
});

describe("largestInputBytes", () => {
  it("measures the files a command reads, and nothing outside its folder", async () => {
    const workspace = toolRunnerWorkspace({
      dataDir: data,
      homePath: null,
      mode: "team",
      botId: "b1",
      folder: "conversations/sizes",
    })!;
    await ensureToolRunnerFolder(workspace);
    await mkdir(path.join(workspace.root, "uploads"), { recursive: true });
    await writeFile(path.join(workspace.root, "uploads", "Big.pptx"), Buffer.alloc(3000));
    await writeFile(path.join(workspace.root, "Old.docx"), Buffer.alloc(500));
    await writeFile(path.join(data, "outside.pptx"), Buffer.alloc(9000));
    expect(await largestInputBytes(workspace, ["read", "--in", "uploads/Big.pptx"])).toBe(3000);
    expect(await largestInputBytes(workspace, ["compare", "--old=Old.docx", "--new", "gone"])).toBe(
      500,
    );
    expect(await largestInputBytes(workspace, ["read", "--in", "../../outside.pptx"])).toBe(0);
    expect(await largestInputBytes(workspace, ["edit", "--out", "uploads/Big.pptx"])).toBe(0);
  });
});
