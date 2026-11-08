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

function harness(options: {
  folder?: string;
  runner?: boolean;
  documents?: boolean;
  computerOff?: boolean;
  wordDocuments?: { name: string; path: string }[];
}) {
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
      prisma: {
        user: {
          findUnique: vi.fn(async () => ({ name: "Keith Knox", email: "keith@ocsc.ie" })),
        },
      },
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
      documents: options.documents ? { workspace, files, prepare } : undefined,
      computerOff: options.computerOff,
      wordDocuments: options.wordDocuments,
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

describe("Word documents on a tool runner", () => {
  it("writes the person's name as the author of tracked changes", async () => {
    const h = harness({ documents: true });
    await computerTools.ocsc!(
      h.ctx,
      h.call({
        program: "word",
        args: ["edit", "--in", "outputs/a.docx", "--spec", "e.json"],
      }) as never,
    );
    expect(h.run).toHaveBeenCalledWith(
      expect.objectContaining({ program: "word", author: "Keith Knox" }),
    );
  });

  it("edits a document already in the conversation instead of making it again", async () => {
    const h = harness({
      documents: true,
      wordDocuments: [{ name: "Report.docx", path: "attachments/a1.docx" }],
    });
    const refused = await computerTools.ocsc!(
      h.ctx,
      h.call({ program: "word", args: ["new", "--spec", "s.json", "--out", "x.docx"] }) as never,
    );
    expect(refused).toEqual({ error: expect.stringContaining("ocsc word edit --in") });
    expect(h.run).not.toHaveBeenCalled();

    await computerTools.ocsc!(
      h.ctx,
      h.call({
        program: "word",
        args: ["edit", "--in", "attachments/a1.docx", "--spec", "e.json"],
      }) as never,
    );
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it("makes a brand-new document when the person asked for one, without passing the flag on", async () => {
    const h = harness({
      documents: true,
      wordDocuments: [{ name: "Report.docx", path: "attachments/a1.docx" }],
    });
    await computerTools.ocsc!(
      h.ctx,
      h.call({
        program: "word",
        args: ["new", "--spec", "s.json", "--out", "y.docx", "--new-document"],
      }) as never,
    );
    expect(h.run).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["new", "--spec", "s.json", "--out", "y.docx"] }),
    );
  });
});

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

  it("renders a shared chat's video on a runner instead of the owner's computer", async () => {
    const h = harness({ folder: "conversations/t1", runner: true });
    await computerTools.ocsc!(
      h.ctx,
      h.call({ program: "video", args: ["render", "--spec", "outputs/a.video.json"] }) as never,
    );
    expect(h.run).toHaveBeenCalledWith(
      expect.objectContaining({ program: "video", timeoutMs: 45 * 60_000 }),
    );
    expect(h.computerGet).not.toHaveBeenCalled();
  });

  it("runs a full-computer person's documents on a runner, not their computer", async () => {
    const h = harness({ documents: true });
    await computerTools.ocsc!(
      h.ctx,
      h.call({ program: "pptx", args: ["new", "--spec", "work/deck.json"] }) as never,
    );
    expect(h.run).toHaveBeenCalledWith(expect.objectContaining({ program: "pptx" }));
    expect(h.computerGet).not.toHaveBeenCalled();
  });

  it("renders video on a runner when the person has no computer", async () => {
    const h = harness({ runner: true, documents: true, computerOff: true });
    await computerTools.ocsc!(
      h.ctx,
      h.call({ program: "video", args: ["render", "--spec", "outputs/a.video.json"] }) as never,
    );
    expect(h.run).toHaveBeenCalledWith(expect.objectContaining({ program: "video" }));
    expect(h.computerGet).not.toHaveBeenCalled();
  });

  it("refuses without starting a computer when the person has none and no runner is set up", async () => {
    const h = harness({ computerOff: true });
    const result = (await computerTools.ocsc!(
      h.ctx,
      h.call({ program: "video", args: ["render"] }) as never,
    )) as { error?: string };
    expect(result.error).toMatch(/needs a computer/);
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

  it("tells the model an attachment is too large instead of unreadable", async () => {
    const h = harness({ runner: true });
    Object.assign((h.ctx as { deps: object }).deps, { artifacts: {} });
    h.files.readFile.mockRejectedValueOnce(new Error("file exceeds 10485760 bytes"));
    const tooLarge = (await fileTools.attach_file!(
      h.ctx,
      h.call({ path: "outputs/deck.pptx" }, "attach_file") as never,
    )) as { error?: string };
    expect(tooLarge.error).toMatch(/larger than the 10 MiB attachment limit/);
    h.files.readFile.mockRejectedValueOnce(new Error("file not found"));
    const missing = (await fileTools.attach_file!(
      h.ctx,
      h.call({ path: "outputs/missing.pptx" }, "attach_file") as never,
    )) as { error?: string };
    expect(missing.error).toBe("file not found");
    expect(h.computerGet).not.toHaveBeenCalled();
  });
});
