import type { MessageBlock } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";
import { fileTools } from "./run-tools-files.js";
import {
  artifactIdFromAttachmentPath,
  cleanFileNote,
  earlierThreadFilesInstruction,
  FILE_NOTE_MAX_LENGTH,
  listEarlierThreadFiles,
  recentThreadFilesInstruction,
  saveThreadFileNote,
  withFileNotes,
} from "./thread-artifacts.js";
import { TOOL_RUNNER_COMPUTER } from "./tool-runner.js";

const SPEC = "attachments/spec1.docx";
const OTHER = "attachments/other9.pdf";

function folder(initial: Record<string, string> = {}) {
  const stored = new Map<string, Uint8Array>(
    Object.entries(initial).map(([k, v]) => [k, new TextEncoder().encode(v)]),
  );
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

function notesTable() {
  const rows: Array<{
    id: string;
    spaceId: string;
    threadId: string;
    artifactId: string;
    note: string;
  }> = [];
  return {
    rows,
    findUnique: vi.fn(
      async ({
        where,
      }: {
        where: { threadId_artifactId: { threadId: string; artifactId: string } };
      }) =>
        rows.find(
          (row) =>
            row.threadId === where.threadId_artifactId.threadId &&
            row.artifactId === where.threadId_artifactId.artifactId,
        ) ?? null,
    ),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { note: string } }) => {
      const row = rows.find((candidate) => candidate.id === where.id)!;
      row.note = data.note;
      return row;
    }),
    create: vi.fn(async ({ data }: { data: Omit<(typeof rows)[number], "id"> }) => {
      const row = { id: `n${rows.length + 1}`, ...data };
      rows.push(row);
      return row;
    }),
  };
}

function harness() {
  const runner = folder();
  const prepare = vi.fn(async () => {});
  const threadFileNote = notesTable();
  const artifactRows = new Map([
    ["spec1", { storageKey: "key-spec", size: 10, spaceId: "space", userId: "owner" }],
  ]);
  const findFirst = vi.fn(
    async ({ where }: { where: { id: string; spaceId: string; userId: string } }) => {
      const row = artifactRows.get(where.id);
      return row && row.spaceId === where.spaceId && row.userId === where.userId ? row : null;
    },
  );
  const artifacts = { get: vi.fn(async () => new TextEncoder().encode("spec bytes")) };
  const ctx = {
    deps: {
      prisma: { artifact: { findFirst }, threadFileNote },
      artifacts,
      sandbox: folder(),
      events: { append: async () => {} },
    },
    run: { spaceId: "space", userId: "owner", trigger: "user" },
    runId: "r1",
    bot: { id: "b1" },
    thread: { id: "t1", spaceId: "space" },
    context: { spaceId: "space", userId: "owner", signal: new AbortController().signal },
    secrets: [] as string[],
    computer: {
      mode: "private",
      folder: undefined,
      access: "tools",
      get: vi.fn(),
      checkpoint: { markDirty: () => {} },
      runner: { workspace: {}, files: runner, prepare },
      conversationFiles: new Map([
        [SPEC, "spec1"],
        [OTHER, "other9"],
      ]),
    },
  };
  const call = (name: string, args: Record<string, unknown>) => ({
    name,
    args,
    executionId: "e1",
    finish: async (result: unknown) => result,
  });
  return { ctx: ctx as never, call, runner, prepare, artifacts, findFirst, threadFileNote };
}

describe("fetch_file", () => {
  it("puts an earlier attachment back at its listed path in the run's folder", async () => {
    const h = harness();
    const result = await fileTools.fetch_file!(
      h.ctx,
      h.call("fetch_file", { path: SPEC }) as never,
    );
    expect(result).toEqual({ ok: true, path: SPEC, bytes: 10 });
    expect(h.prepare).toHaveBeenCalled();
    expect(h.runner.writeFile).toHaveBeenCalledWith(
      TOOL_RUNNER_COMPUTER,
      expect.objectContaining({ path: SPEC }),
      expect.anything(),
    );
    expect(h.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "spec1", spaceId: "space", userId: "owner" } }),
    );
  });

  it("leaves a file that is already there untouched", async () => {
    const h = harness();
    h.runner.stored.set(SPEC, new TextEncoder().encode("edited by the bot"));
    const result = await fileTools.fetch_file!(
      h.ctx,
      h.call("fetch_file", { path: SPEC }) as never,
    );
    expect(result).toEqual({ ok: true, path: SPEC, alreadyThere: true });
    expect(h.artifacts.get).not.toHaveBeenCalled();
    expect(new TextDecoder().decode(h.runner.stored.get(SPEC))).toBe("edited by the bot");
  });

  it("refuses any path that is not one of this conversation's listed files", async () => {
    const h = harness();
    for (const path of ["attachments/someone-else.docx", "../spec1.docx", "outputs/Report.docx"]) {
      const result = await fileTools.fetch_file!(h.ctx, h.call("fetch_file", { path }) as never);
      expect(result).toEqual({ error: expect.stringContaining("listed for this conversation") });
    }
    expect(h.findFirst).not.toHaveBeenCalled();
    expect(h.runner.writeFile).not.toHaveBeenCalled();
  });

  it("refuses a listed file that does not belong to the person in this space", async () => {
    const h = harness();
    const result = await fileTools.fetch_file!(
      h.ctx,
      h.call("fetch_file", { path: OTHER }) as never,
    );
    expect(result).toEqual({ error: "That file is no longer available." });
    expect(h.runner.writeFile).not.toHaveBeenCalled();
  });
});

describe("note_file", () => {
  it("saves one cleaned line per file in this conversation and replaces it later", async () => {
    const h = harness();
    await fileTools.note_file!(
      h.ctx,
      h.call("note_file", {
        path: SPEC,
        note: "Drainage spec\nfor HEL18:\tsoakaways only",
      }) as never,
    );
    expect(h.threadFileNote.rows).toEqual([
      expect.objectContaining({
        spaceId: "space",
        threadId: "t1",
        artifactId: "spec1",
        note: "Drainage spec for HEL18: soakaways only",
      }),
    ]);
    await fileTools.note_file!(
      h.ctx,
      h.call("note_file", { path: SPEC, note: "Revised" }) as never,
    );
    expect(h.threadFileNote.rows).toHaveLength(1);
    expect(h.threadFileNote.rows[0]?.note).toBe("Revised");
  });

  it("refuses an unlisted path or an empty note", async () => {
    const h = harness();
    expect(
      await fileTools.note_file!(
        h.ctx,
        h.call("note_file", { path: "attachments/x.docx", note: "x" }) as never,
      ),
    ).toEqual({ error: expect.any(String) });
    expect(
      await fileTools.note_file!(h.ctx, h.call("note_file", { path: SPEC, note: " \n " }) as never),
    ).toEqual({ error: expect.any(String) });
    expect(h.threadFileNote.create).not.toHaveBeenCalled();
  });

  it("updates the note another turn created at the same moment", async () => {
    const table = notesTable();
    table.create.mockImplementationOnce(async ({ data }) => {
      table.rows.push({ id: "n1", ...data, note: "first" });
      throw Object.assign(new Error("duplicate"), { code: "P2002" });
    });
    await saveThreadFileNote({ threadFileNote: table } as never, {
      spaceId: "space",
      threadId: "t1",
      artifactId: "spec1",
      note: "second",
    });
    expect(table.rows).toEqual([expect.objectContaining({ id: "n1", note: "second" })]);
  });
});

describe("conversation file listing", () => {
  const block = (artifactId: string, name: string): MessageBlock =>
    ({ kind: "file", artifactId, name, mimeType: "application/pdf", size: 1 }) as MessageBlock;

  function listing(count: number) {
    const history = Array.from({ length: count }, (_, index) => ({
      id: `m${index}`,
      role: "user",
    }));
    const messages = history.map((entry, index) => ({
      id: entry.id,
      blocks: [block(`a${index}`, `File ${index}.pdf`)],
    }));
    const prisma = {
      artifact: {
        findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; userId: string } }) =>
          where.id.in
            .filter((id) => id !== "a3")
            .map((id) => ({
              id,
              name: `File ${id.slice(1)}.pdf`,
              mimeType: "application/pdf",
              size: 1,
              userId: where.userId,
            })),
        ),
      },
    };
    return { history, messages, prisma };
  }

  it("lists earlier files newest first, skipping the listed, the current turn and others' files", async () => {
    const { history, messages, prisma } = listing(6);
    const files = await listEarlierThreadFiles({ prisma } as never, history, messages, {
      context: { spaceId: "space", userId: "owner" } as never,
      skipMessageId: "m5",
      listed: new Set(["attachments/a4.pdf"]),
    });
    expect(files.map((file) => file.artifactId)).toEqual(["a2", "a1", "a0"]);
    expect(files[0]).toMatchObject({ path: "attachments/a2.pdf", name: "File 2.pdf" });
    expect(prisma.artifact.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ spaceId: "space", userId: "owner" }),
    });
  });

  it("caps how many earlier files are listed", async () => {
    const { history, messages, prisma } = listing(60);
    const files = await listEarlierThreadFiles({ prisma } as never, history, messages, {
      context: { spaceId: "space", userId: "owner" } as never,
      listed: new Set(),
    });
    expect(files).toHaveLength(15);
    expect(files[0]?.artifactId).toBe("a59");
  });

  it("keeps the earlier-files instruction small however long the notes are", () => {
    const files = Array.from({ length: 15 }, (_, index) => ({
      name: `${"Long name ".repeat(30)}${index}`,
      mimeType: "application/pdf",
      size: 1,
      path: `attachments/a${index}.pdf`,
      note: "n".repeat(FILE_NOTE_MAX_LENGTH),
    }));
    const text = earlierThreadFilesInstruction(files);
    expect(text).toContain("fetch_file");
    expect(text.length).toBeLessThan(4500);
    expect(earlierThreadFilesInstruction([])).toBe("");
  });

  it("shows a saved note beside its file", () => {
    const files = withFileNotes(
      [{ name: "Spec.docx", mimeType: "application/msword", size: 5, path: SPEC }],
      new Map([["spec1", "Drainage spec"]]),
    );
    expect(recentThreadFilesInstruction(files)).toContain('your note: "Drainage spec"');
  });

  it("reads artifact ids only from attachment paths and cleans notes", () => {
    expect(artifactIdFromAttachmentPath("attachments/abc123.docx")).toBe("abc123");
    expect(artifactIdFromAttachmentPath("attachments/../x.docx")).toBeUndefined();
    expect(artifactIdFromAttachmentPath("outputs/abc.docx")).toBeUndefined();
    expect(cleanFileNote(`a\u0000b${"x".repeat(500)}`)).toHaveLength(FILE_NOTE_MAX_LENGTH);
    expect(cleanFileNote(42)).toBe("");
  });
});

describe("offering fetch_file and note_file", () => {
  const base = {
    graphicalToolsAllowed: true,
    groupId: null,
    trigger: "user",
    semanticMemoryEnabled: false,
    messagingChannelRun: false,
  };
  const names = (options: Partial<Parameters<typeof selectBuiltinToolsForRun>[0]>) =>
    selectBuiltinToolsForRun({ ...base, ...options }).map((tool) => tool.name);

  it("offers them only when the run lists conversation files", () => {
    expect(names({ conversationFiles: true })).toEqual(
      expect.arrayContaining(["fetch_file", "note_file"]),
    );
    expect(names({ conversationFiles: false })).not.toContain("fetch_file");
    expect(names({ conversationFiles: false })).not.toContain("note_file");
    expect(names({ conversationFiles: true, computerAccess: "tools" })).toContain("fetch_file");
    expect(names({ conversationFiles: true, computerAccess: "none" })).not.toContain("fetch_file");
  });
});
