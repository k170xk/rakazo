import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  conversationFolderRefusal,
  folderFiles,
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
      conversation: path.join(data, "tool-work/conversations/t1"),
    });
  });

  it("gives a Tools-only owner their own bot folder in their home", () => {
    expect(
      toolRunnerWorkspace({
        dataDir: data,
        homePath: path.join(data, "homes/team-a"),
        mode: "team",
        botId: "b1",
        folder: undefined,
      }),
    ).toEqual({ base: path.join(data, "homes/team-a"), mount: "homes/team-a", cwd: "bots/b1" });
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
});
