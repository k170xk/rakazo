import { describe, expect, it, vi } from "vitest";
import type * as OcscToolModule from "./ocsc-tool.js";
import { computerTools } from "./run-tools-computer.js";
import { fileTools } from "./run-tools-files.js";
import { TOOL_RUNNER_COMPUTER } from "./tool-runner.js";

vi.mock("./ocsc-tool.js", async (importOriginal) => ({
  ...(await importOriginal<typeof OcscToolModule>()),
  ocscBeforeRun: async () => undefined,
  ocscAfterRun: async () => undefined,
}));

const workspace = { base: "/data/tool-work", mount: "tool-work/conversations/t1", cwd: "" };

function harness(options: { folder?: string; runner?: boolean }) {
  const run = vi.fn(async () => ({ stdout: '{"ok":true}', stderr: "", code: 0 }));
  const prepare = vi.fn(async () => {});
  const computerGet = vi.fn(async () => {
    throw new Error("the owner's computer must not start");
  });
  const files = {
    listFiles: vi.fn(async () => []),
    readFile: vi.fn(async () => new TextEncoder().encode("hello")),
    writeFile: vi.fn(async () => {}),
  };
  const ctx = {
    deps: {
      toolRunner: { run },
      sandbox: files,
      events: { append: async () => undefined },
    },
    run: { spaceId: "space", userId: "owner" },
    runId: "r1",
    bot: { id: "b1" },
    thread: { id: "t1" },
    context: { signal: new AbortController().signal },
    secrets: [] as string[],
    computer: {
      mode: "team",
      folder: options.folder,
      get: computerGet,
      checkpoint: { markDirty: () => {} },
      runner: options.runner ? { workspace, files, prepare } : undefined,
    },
  };
  const call = (args: Record<string, unknown>, name = "ocsc") => ({
    name,
    args,
    executionId: "e1",
    finish: async (result: unknown) => result,
  });
  return { ctx: ctx as never, call, run, prepare, computerGet, files };
}

describe("ocsc on a tool runner", () => {
  it("runs a colleague's document command on a runner in the conversation folder", async () => {
    const h = harness({ folder: "conversations/t1", runner: true });
    const result = await computerTools.ocsc!(
      h.ctx,
      h.call({ program: "word", args: ["new", "--spec", "work/a.json"] }) as never,
    );
    expect(result).toEqual({ stdout: '{"ok":true}', stderr: "", code: 0 });
    expect(h.prepare).toHaveBeenCalled();
    expect(h.run).toHaveBeenCalledWith(
      expect.objectContaining({ workspace, program: "word", owner: "owner" }),
    );
    expect(h.computerGet).not.toHaveBeenCalled();
  });

  it("refuses video in a shared chat instead of using the owner's computer", async () => {
    const h = harness({ folder: "conversations/t1", runner: true });
    const result = (await computerTools.ocsc!(
      h.ctx,
      h.call({ program: "video", args: ["render"] }) as never,
    )) as { error?: string };
    expect(result.error).toMatch(/not available in a shared chat/);
    expect(h.run).not.toHaveBeenCalled();
    expect(h.computerGet).not.toHaveBeenCalled();
  });

  it("still refuses a shared chat's commands when no runner is configured", async () => {
    const h = harness({ folder: "conversations/t1", runner: false });
    const result = (await computerTools.ocsc!(
      h.ctx,
      h.call({ program: "word", args: ["templates"] }) as never,
    )) as { error?: string };
    expect(result.error).toMatch(/not available in a shared chat/);
    expect(h.computerGet).not.toHaveBeenCalled();
  });
});

describe("file tools on a tool runner", () => {
  it("read and write the runner folder without starting a computer", async () => {
    const h = harness({ folder: "conversations/t1", runner: true });
    await fileTools.write_file!(
      h.ctx,
      h.call({ path: "work/a.json", content: "{}" }, "write_file") as never,
    );
    expect(h.files.writeFile).toHaveBeenCalledWith(
      TOOL_RUNNER_COMPUTER,
      expect.objectContaining({ path: "conversations/t1/work/a.json" }),
      expect.anything(),
    );
    const read = await fileTools.read_file!(
      h.ctx,
      h.call({ path: "work/a.json" }, "read_file") as never,
    );
    expect(read).toEqual({ path: "work/a.json", content: "hello" });
    expect(h.prepare).toHaveBeenCalled();
    expect(h.computerGet).not.toHaveBeenCalled();
  });
});
