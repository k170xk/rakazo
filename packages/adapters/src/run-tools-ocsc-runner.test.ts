import { describe, expect, it, vi } from "vitest";
import { damagedDocx, soundDocx } from "./docx.test-support.js";
import { DAMAGED_WORD_INPUT, DAMAGED_WORD_OUTPUT } from "./docx-integrity.js";
import type * as OcscToolModule from "./ocsc-tool.js";
import type * as RunMessagesModule from "./run-messages.js";
import { computerTools } from "./run-tools-computer.js";
import { fileTools } from "./run-tools-files.js";
import type * as ThreadArtifactsModule from "./thread-artifacts.js";
import { TOOL_RUNNER_COMPUTER } from "./tool-runner.js";

vi.mock("./ocsc-tool.js", async (importOriginal) => ({
  ...(await importOriginal<typeof OcscToolModule>()),
  ocscBeforeRun: async () => undefined,
  ocscAfterRun: async () => undefined,
}));
vi.mock("./thread-artifacts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof ThreadArtifactsModule>()),
  attachWorkspaceFileToThread: async () => ({ artifactId: "a1", block: { kind: "file" } }),
}));
vi.mock("./run-messages.js", async (importOriginal) => ({
  ...(await importOriginal<typeof RunMessagesModule>()),
  publishMessage: async () => undefined,
}));

const workspace = { base: "/data/tool-work", mount: "tool-work/conversations/t1", cwd: "" };

function harness(options: {
  folder?: string;
  runner?: boolean;
  documents?: boolean;
  computerOff?: boolean;
  officeDocuments?: { name: string; path: string; program: "word" | "pptx" | "xlsx" }[];
}) {
  const run = vi.fn(async () => ({
    stdout: JSON.stringify({ ok: true, path: "outputs/doc.docx" }),
    stderr: "",
    code: 0,
  }));
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
      officeDocuments: options.officeDocuments,
    },
    state: { documents: { made: [] as string[], attached: false } },
  };
  const call = (args: Record<string, unknown>, name = "ocsc") => ({
    name,
    args,
    executionId: "e1",
    finish: async (result: unknown) => result,
  });
  return { ctx: ctx as never, call, run, prepare, computerGet, files, state: ctx.state };
}

describe("documents a run has not sent yet", () => {
  const printed = (json: Record<string, unknown>) => ({
    stdout: JSON.stringify(json),
    stderr: "",
    code: 0,
  });

  it("records each document a command writes, latest last, until one is attached", async () => {
    const h = harness({ runner: true });
    const ocsc = (args: string[], json: Record<string, unknown>) => {
      h.run.mockResolvedValueOnce(printed(json));
      return computerTools.ocsc!(h.ctx, h.call({ program: "word", args }) as never);
    };
    await ocsc(["edit", "--in", "outputs/a.docx"], { ok: true, path: "outputs/a.docx" });
    await ocsc(["new", "--out", "outputs/b.docx"], { ok: true, path: "outputs/b.docx" });
    await ocsc(["edit", "--in", "outputs/a.docx"], { ok: true, path: "outputs/a.docx" });
    expect(h.state.documents.made).toEqual(["outputs/b.docx", "outputs/a.docx"]);

    Object.assign((h.ctx as { deps: object }).deps, { artifacts: {} });
    h.files.readFile.mockRejectedValueOnce(new Error("file not found"));
    await fileTools.attach_file!(h.ctx, h.call({ path: "outputs/c.docx" }, "attach_file") as never);
    expect(h.state.documents.attached).toBe(false);

    const sent = await fileTools.attach_file!(
      h.ctx,
      h.call({ path: "outputs/a.docx" }, "attach_file") as never,
    );
    expect(sent).toMatchObject({ ok: true });
    expect(h.state.documents.attached).toBe(true);
  });

  it("ignores commands that only read a document, and failed ones", async () => {
    const h = harness({ documents: true });
    h.run
      .mockResolvedValueOnce(printed({ ok: true, path: "attachments/a1.docx" }))
      .mockResolvedValueOnce(printed({ ok: false, path: "outputs/x.docx", error: "bad spec" }));
    await computerTools.ocsc!(
      h.ctx,
      h.call({ program: "word", args: ["read", "attachments/a1.docx"] }) as never,
    );
    await computerTools.ocsc!(
      h.ctx,
      h.call({ program: "word", args: ["edit", "--in", "outputs/x.docx"] }) as never,
    );
    expect(h.state.documents.made).toEqual([]);
  });

  it("tells the agent to fix and retry when an Excel write fails", async () => {
    const h = harness({ documents: true });
    h.run.mockResolvedValueOnce(
      printed({ ok: false, error: "Excel refuses the file and may offer to repair it." }),
    );
    const result = await computerTools.ocsc!(
      h.ctx,
      h.call({
        program: "xlsx",
        args: ["edit", "--in", "outputs/a.xlsx", "--spec", "e.json"],
      }) as never,
    );
    expect(result).toMatchObject({
      ok: false,
      documentCheck: "problems",
      next: expect.stringContaining("before telling the person the document is ready"),
    });
    expect(h.state.documents.made).toEqual([]);
  });
});

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
      officeDocuments: [{ name: "Report.docx", path: "attachments/a1.docx", program: "word" }],
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
      officeDocuments: [{ name: "Report.docx", path: "attachments/a1.docx", program: "word" }],
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

describe("a Word command that saves a damaged file", () => {
  const edit = (h: ReturnType<typeof harness>) =>
    computerTools.ocsc!(
      h.ctx,
      h.call({
        program: "word",
        args: [
          "edit",
          "--in",
          "attachments/a1.docx",
          "--spec",
          "e.json",
          "--out",
          "outputs/doc.docx",
        ],
      }) as never,
    );
  const filesAre = (h: ReturnType<typeof harness>, input: Uint8Array, output: Uint8Array) =>
    h.files.readFile.mockImplementation((async (...args: unknown[]) =>
      String(args[1]).includes("outputs/") ? output : input) as never);

  it("is refused with nothing kept, and the agent is told to edit the same file again", async () => {
    const h = harness({ documents: true });
    filesAre(h, soundDocx(), damagedDocx());
    const result = await edit(h);
    expect(result).toMatchObject({
      ok: false,
      documentCheck: "problems",
      problems: [DAMAGED_WORD_OUTPUT],
    });
    expect(h.state.documents.made).toEqual([]);
  });

  it("says so when the file it started from was already damaged", async () => {
    const h = harness({ documents: true });
    filesAre(h, damagedDocx(), damagedDocx());
    const result = await edit(h);
    expect(result).toMatchObject({ documentCheck: "problems", problems: [DAMAGED_WORD_INPUT] });
    expect(h.state.documents.made).toEqual([]);
  });

  it("passes as before when the saved file reads correctly or cannot be read", async () => {
    const h = harness({ documents: true });
    filesAre(h, soundDocx(), soundDocx());
    expect(await edit(h)).not.toHaveProperty("documentCheck");
    expect(h.state.documents.made).toEqual(["outputs/doc.docx"]);

    h.files.readFile.mockRejectedValue(new Error("file not found"));
    expect(await edit(h)).not.toHaveProperty("documentCheck");
  });
});

describe("ocsc on a tool runner", () => {
  it("runs a colleague's document command on a runner in the conversation folder", async () => {
    const h = harness({ folder: "conversations/t1", runner: true });
    const result = await computerTools.ocsc!(
      h.ctx,
      h.call({ program: "word", args: ["new", "--spec", "work/a.json"] }) as never,
    );
    expect(result).toEqual({
      stdout: JSON.stringify({ ok: true, path: "outputs/doc.docx" }),
      stderr: "",
      code: 0,
    });
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

describe("a spec passed with the ocsc call", () => {
  const written = (h: ReturnType<typeof harness>) =>
    h.files.writeFile.mock.calls.map((args) => {
      const file = (args as unknown[])[1] as { path: string; content: Uint8Array };
      return { path: file.path, text: new TextDecoder().decode(file.content) };
    });

  it("is saved where --spec names before the edit runs, in one call", async () => {
    const h = harness({ documents: true });
    h.run.mockImplementationOnce(async () => {
      expect(written(h)).toHaveLength(1);
      return { stdout: JSON.stringify({ ok: true }), stderr: "", code: 0 };
    });
    await computerTools.ocsc!(
      h.ctx,
      h.call({
        program: "pptx",
        args: [
          "edit",
          "--in",
          "outputs/d.pptx",
          "--spec",
          "work/e.json",
          "--out",
          "outputs/d2.pptx",
        ],
        spec: '{"operations":[{"op":"title","slide":1,"text":"Hi"}]}',
      }) as never,
    );
    expect(written(h)).toEqual([
      {
        path: expect.stringMatching(/work\/e\.json$/),
        text: '{"operations":[{"op":"title","slide":1,"text":"Hi"}]}',
      },
    ]);
    expect(h.run).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          "edit",
          "--in",
          "outputs/d.pptx",
          "--spec",
          "work/e.json",
          "--out",
          "outputs/d2.pptx",
        ],
      }),
    );
  });

  it("gets a --spec path when the call names none, the same one when it is resumed", async () => {
    const h = harness({ documents: true });
    const send = () =>
      computerTools.ocsc!(
        h.ctx,
        h.call({
          program: "xlsx",
          args: ["edit", "--in", "outputs/c.xlsx"],
          spec: { edits: [{ cell: "A1", value: 1 }] },
        }) as never,
      );
    await send();
    await send();
    const [first, second] = written(h);
    expect(first?.path).toMatch(/work\/spec-[0-9a-f]{12}\.json$/);
    expect(second?.path).toBe(first?.path);
    expect(JSON.parse(first?.text ?? "")).toEqual({ edits: [{ cell: "A1", value: 1 }] });
    const ran = (h.run.mock.calls[0] as unknown[])[0] as { args: string[] };
    expect(ran.args.slice(0, 4)).toEqual(["edit", "--in", "outputs/c.xlsx", "--spec"]);
    expect(first?.path.endsWith(ran.args[4] ?? "-")).toBe(true);
  });

  it("refuses JSON that does not parse, and a step that takes no spec, without writing", async () => {
    const h = harness({ documents: true });
    const bad = await computerTools.ocsc!(
      h.ctx,
      h.call({ program: "word", args: ["edit", "--in", "a.docx"], spec: "{oops" }) as never,
    );
    expect(bad).toEqual({ error: expect.stringContaining("valid JSON") });
    const read = await computerTools.ocsc!(
      h.ctx,
      h.call({ program: "word", args: ["read", "--in", "a.docx"], spec: "{}" }) as never,
    );
    expect(read).toEqual({ error: expect.stringContaining("takes no spec") });
    expect(h.files.writeFile).not.toHaveBeenCalled();
    expect(h.run).not.toHaveBeenCalled();
  });

  it("is not written when the command is refused, and nothing is written without one", async () => {
    const h = harness({
      documents: true,
      officeDocuments: [{ name: "Report.docx", path: "attachments/a1.docx", program: "word" }],
    });
    const refused = await computerTools.ocsc!(
      h.ctx,
      h.call({ program: "word", args: ["new", "--out", "x.docx"], spec: "{}" }) as never,
    );
    expect(refused).toEqual({ error: expect.stringContaining("ocsc word edit --in") });
    await computerTools.ocsc!(
      h.ctx,
      h.call({
        program: "word",
        args: ["edit", "--in", "attachments/a1.docx", "--spec", "e.json"],
      }) as never,
    );
    expect(h.files.writeFile).not.toHaveBeenCalled();
    expect(h.run).toHaveBeenCalledTimes(1);
  });
});
