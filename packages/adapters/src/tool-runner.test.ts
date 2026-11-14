import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { documentHomePath } from "./file-retention.js";
import {
  conversationFolderRefusal,
  ensureToolRunnerFolder,
  folderFiles,
  listFolderFiles,
  TOOL_RUNNER_COMPUTER,
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
