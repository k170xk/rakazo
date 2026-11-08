import { describe, expect, it, vi } from "vitest";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";
import { fileTools } from "./run-tools-files.js";
import { TOOL_RUNNER_COMPUTER } from "./tool-runner.js";

const COMPUTER = { id: "computer-1" };

function side(initial: Record<string, string>) {
  const stored = new Map<string, Uint8Array>(Object.entries(initial).map(([k, v]) => [k, new TextEncoder().encode(v)]));
  return {
    stored,
    listFiles: vi.fn(async (_ref: unknown, dir: string) =>
      [...stored.keys()]
        .filter((key) => key.split("/").slice(0, -1).join("/") === dir)
        .map((path) => ({ path, kind: "file" as const, size: stored.get(path)?.byteLength ?? 0 })),
    ),
    readFile: vi.fn(async (_ref: unknown, path: string) => {
      const bytes = stored.get(path);
      if (!bytes) throw new Error("file not found");
      return bytes;
    }),
    writeFile: vi.fn(async (_ref: unknown, file: { path: string; content: Uint8Array }) => {
      stored.set(file.path, file.content);
    }),
  };
}

function harness(options: { access?: string; documentsApart?: boolean } = {}) {
  const computer = side({ "Downloads/plan.pdf": "pdf bytes" });
  const documents = side({ "outputs/Report.docx": "docx bytes" });
  const prepare = vi.fn(async () => {});
  const get = vi.fn(async () => COMPUTER);
  const recorded: unknown[] = [];
  const ctx = {
    deps: {
      sandbox: computer,
      events: { append: async (event: unknown) => recorded.push(event) },
    },
    run: { spaceId: "space", userId: "owner", trigger: "user" },
    runId: "r1",
    bot: { id: "b1" },
    thread: { id: "t1" },
    context: { signal: new AbortController().signal },
    secrets: [] as string[],
    computer: {
      mode: "private",
      folder: undefined,
      access: options.access ?? "full",
      get,
      checkpoint: { markDirty: () => {} },
      documents: { workspace: {}, files: documents, prepare },
      documentsApart: options.documentsApart ?? true,
    },
  };
  const call = (args: Record<string, unknown>) => ({
    name: "copy_file",
    args,
    executionId: "e1",
    finish: async (result: unknown) => result,
  });
  return { ctx: ctx as never, call, computer, documents, prepare, get };
}

describe("copy_file between the computer and the document folder", () => {
  it("brings a download from the computer into the document folder", async () => {
    const h = harness();
    const result = await fileTools.copy_file!(
      h.ctx,
      h.call({ from: "computer", path: "Downloads/plan.pdf", to: "uploads/plan.pdf" }) as never,
    );
    expect(result).toMatchObject({ ok: true, path: "uploads/plan.pdf", bytes: 9 });
    expect(h.computer.readFile).toHaveBeenCalledWith(
      COMPUTER,
      "Downloads/plan.pdf",
      expect.anything(),
      expect.anything(),
    );
    expect(h.documents.writeFile).toHaveBeenCalledWith(
      TOOL_RUNNER_COMPUTER,
      expect.objectContaining({ path: "uploads/plan.pdf" }),
      expect.anything(),
    );
    expect(h.prepare).toHaveBeenCalled();
  });

  it("takes a made document onto the computer under the same path", async () => {
    const h = harness();
    const result = await fileTools.copy_file!(
      h.ctx,
      h.call({ from: "documents", path: "outputs/Report.docx" }) as never,
    );
    expect(result).toMatchObject({ ok: true, path: "outputs/Report.docx" });
    expect(new TextDecoder().decode(h.computer.stored.get("outputs/Report.docx"))).toBe(
      "docx bytes",
    );
  });

  it("never replaces an existing file unless asked", async () => {
    const h = harness();
    h.documents.stored.set("Downloads/plan.pdf", new TextEncoder().encode("the person's copy"));
    const refused = await fileTools.copy_file!(
      h.ctx,
      h.call({ from: "computer", path: "Downloads/plan.pdf" }) as never,
    );
    expect(refused).toEqual({ error: expect.stringContaining("already exists") });
    expect(h.documents.writeFile).not.toHaveBeenCalled();

    await fileTools.copy_file!(
      h.ctx,
      h.call({ from: "computer", path: "Downloads/plan.pdf", overwrite: true }) as never,
    );
    expect(new TextDecoder().decode(h.documents.stored.get("Downloads/plan.pdf"))).toBe(
      "pdf bytes",
    );
  });

  it("reports a missing file without writing anything", async () => {
    const h = harness();
    const result = await fileTools.copy_file!(
      h.ctx,
      h.call({ from: "documents", path: "outputs/missing.docx" }) as never,
    );
    expect(result).toEqual({ error: expect.stringContaining("was not found") });
    expect(h.computer.writeFile).not.toHaveBeenCalled();
  });

  it("does nothing when the two are the same place or the computer is not fully on", async () => {
    for (const h of [harness({ documentsApart: false }), harness({ access: "tools" })]) {
      const result = await fileTools.copy_file!(
        h.ctx,
        h.call({ from: "computer", path: "Downloads/plan.pdf" }) as never,
      );
      expect(result).toEqual({ error: expect.any(String) });
      expect(h.get).not.toHaveBeenCalled();
      expect(h.documents.writeFile).not.toHaveBeenCalled();
    }
  });
});

describe("offering copy_file", () => {
  const base = {
    graphicalToolsAllowed: true,
    groupId: null,
    trigger: "user",
    semanticMemoryEnabled: false,
    messagingChannelRun: false,
  };
  const offered = (options: Partial<Parameters<typeof selectBuiltinToolsForRun>[0]>) =>
    selectBuiltinToolsForRun({ ...base, ...options })
      .map((tool) => tool.name)
      .includes("copy_file");

  it("is offered only to a person with the computer on whose documents are kept apart", () => {
    expect(offered({ computerAccess: "full", documentsApart: true })).toBe(true);
    expect(offered({ computerAccess: "full", documentsApart: false })).toBe(false);
    expect(offered({ computerAccess: "tools", documentsApart: true })).toBe(false);
    expect(offered({ computerAccess: "none", documentsApart: true })).toBe(false);
    expect(offered({ computersEnabled: false, documentsApart: true })).toBe(false);
  });
});
