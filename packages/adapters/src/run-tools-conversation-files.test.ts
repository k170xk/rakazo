import { describe, expect, it, vi } from "vitest";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";
import { fileTools } from "./run-tools-files.js";
import {
  artifactIdFromAttachmentPath,
  cleanFileNote,
  earlierThreadFilesInstruction,
  FILE_NOTE_MAX_LENGTH,
  listConversationFiles,
  recentThreadFilesInstruction,
  saveThreadFileNote,
  selectEarlierThreadFiles,
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

function conversationFile(artifactId: string, name: string, path: string) {
  return { artifactId, name, path, mimeType: "application/pdf", size: 10 };
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
        [SPEC, conversationFile("spec1", "Spec.docx", SPEC)],
        [OTHER, conversationFile("other9", "Other.pdf", OTHER)],
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
    h.runner.stored.set(SPEC, new TextEncoder().encode("edited by the agent"));
    const result = await fileTools.fetch_file!(
      h.ctx,
      h.call("fetch_file", { path: SPEC }) as never,
    );
    expect(result).toEqual({ ok: true, path: SPEC, alreadyThere: true });
    expect(h.artifacts.get).not.toHaveBeenCalled();
    expect(new TextDecoder().decode(h.runner.stored.get(SPEC))).toBe("edited by the agent");
  });

  it("refuses any path that is not one of this conversation's listed files", async () => {
    const h = harness();
    for (const path of ["attachments/someone-else.docx", "../spec1.docx", "outputs/Report.docx"]) {
      const result = await fileTools.fetch_file!(h.ctx, h.call("fetch_file", { path }) as never);
      expect(result).toEqual({ error: expect.stringContaining("in this conversation") });
    }
    expect(h.artifacts.get).not.toHaveBeenCalled();
    expect(h.runner.writeFile).not.toHaveBeenCalled();
  });

  it("fetches a newer version of a listed file, such as one saved in a studio", async () => {
    const h = harness();
    const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const family = [
      { id: "spec1", rootArtifactId: null, version: 1 },
      { id: "spec2", rootArtifactId: "spec1", version: 2 },
      { id: "spec3", rootArtifactId: "spec1", version: 3 },
    ].map((row) => ({
      ...row,
      name: "Spec.docx",
      mimeType: DOCX,
      source: "studio",
      storageKey: `key-${row.id}`,
      size: 10,
      spaceId: "space",
      userId: "owner",
    }));
    type Where = {
      id?: string | { in: string[] };
      OR?: Array<{ id?: string; rootArtifactId?: string }>;
    };
    const inFamily = (where: Where) =>
      family
        .filter((row) =>
          typeof where.id === "string"
            ? row.id === where.id
            : !where.id || where.id.in.includes(row.id),
        )
        .filter(
          (row) =>
            !where.OR ||
            where.OR.some((or) => row.id === or.id || row.rootArtifactId === or.rootArtifactId),
        )
        .sort((a, b) => b.version - a.version);
    (h.ctx as { deps: { prisma: { artifact: unknown } } }).deps.prisma.artifact = {
      findFirst: async ({ where }: { where: Where }) => inFamily(where)[0] ?? null,
      count: async ({ where }: { where: Where }) => inFamily(where).length,
    };

    const newest = "attachments/spec3.docx";
    expect(
      await fileTools.fetch_file!(h.ctx, h.call("fetch_file", { path: newest }) as never),
    ).toEqual({ ok: true, path: newest, bytes: 10 });
    const older = "attachments/spec2.docx";
    expect(
      await fileTools.fetch_file!(h.ctx, h.call("fetch_file", { path: older }) as never),
    ).toEqual({ error: expect.stringContaining("in this conversation") });
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
  function database(found: string[]) {
    const prisma = {
      $queryRaw: vi.fn(async () => found.map((artifactId) => ({ artifactId }))),
      artifact: {
        findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in
            .filter((id) => id !== "theirs")
            .map((id) => ({
              id,
              name: `${id}.pdf`,
              mimeType: "application/pdf",
              size: id === "huge" ? 10_000 : 1,
            })),
        ),
      },
    };
    return prisma;
  }
  const context = { spaceId: "space", userId: "owner" } as never;

  it("finds the person's files across the whole conversation, newest first", async () => {
    const prisma = database(["a9", "theirs", "a5", "huge", "a1"]);
    const files = await listConversationFiles({ prisma, maxUploadSizeBytes: 100 } as never, {
      threadId: "t1",
      context,
    });
    expect(files.map((file) => file.artifactId)).toEqual(["a9", "a5", "a1"]);
    expect(files[0]).toMatchObject({ path: "attachments/a9.pdf", name: "a9.pdf" });
    expect(prisma.artifact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ spaceId: "space", userId: "owner" }),
      }),
    );
    const query = (prisma.$queryRaw.mock.calls[0] as unknown[]).slice(1);
    expect(query).toContain("t1");
    expect(JSON.stringify(query)).not.toContain("channel_message");
  });

  it("keeps a channel run to its channel's messages", async () => {
    const prisma = database(["a1"]);
    await listConversationFiles({ prisma } as never, { threadId: "t1", channelId: "c7", context });
    expect(JSON.stringify(prisma.$queryRaw.mock.calls[0])).toContain(
      JSON.stringify(JSON.stringify([{ kind: "channel_message", channelId: "c7" }])).slice(1, -1),
    );
  });

  it("lists nothing and skips the artifact lookup when no files were attached", async () => {
    const prisma = database([]);
    expect(await listConversationFiles({ prisma } as never, { threadId: "t1", context })).toEqual(
      [],
    );
    expect(prisma.artifact.findMany).not.toHaveBeenCalled();
  });

  it("shows the newest earlier files and counts the rest", () => {
    const files = Array.from({ length: 40 }, (_, index) => ({
      ...conversationFile(`a${index}`, `File ${index}.pdf`, `attachments/a${index}.pdf`),
    }));
    const earlier = selectEarlierThreadFiles(files, new Set(["attachments/a0.pdf"]));
    expect(earlier.shown).toHaveLength(15);
    expect(earlier.shown[0]?.artifactId).toBe("a1");
    expect(earlier.total).toBe(39);
    const text = earlierThreadFilesInstruction(earlier.shown, earlier.total, { canList: true });
    expect(text).toContain("24 older files are not shown");
    expect(text).toContain("list_conversation_files");
    expect(earlierThreadFilesInstruction(earlier.shown, earlier.total)).not.toContain(
      "list_conversation_files",
    );
    expect(
      earlierThreadFilesInstruction(earlier.shown.slice(0, 3), 3, { canList: true }),
    ).not.toContain("not shown");
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

describe("list_conversation_files", () => {
  function many(count: number) {
    const h = harness();
    const files = new Map(
      Array.from({ length: count }, (_, index) => {
        const path = `attachments/f${index}.pdf`;
        return [path, conversationFile(`f${index}`, `Report ${index}.pdf`, path)] as const;
      }),
    );
    (h.ctx as { computer: { conversationFiles: unknown } }).computer.conversationFiles = files;
    h.threadFileNote.rows.push({
      id: "n1",
      spaceId: "space",
      threadId: "t1",
      artifactId: "f42",
      note: "Drainage budget for HEL18",
    });
    const findMany = vi.fn(async ({ where }: { where: { artifactId: { in: string[] } } }) =>
      h.threadFileNote.rows.filter((row) => where.artifactId.in.includes(row.artifactId)),
    );
    Object.assign(h.threadFileNote, { findMany });
    return h;
  }
  const list = (h: ReturnType<typeof many>, args: Record<string, unknown>) =>
    fileTools.list_conversation_files!(
      h.ctx,
      h.call("list_conversation_files", args) as never,
    ) as Promise<{
      page: number;
      pages: number;
      matching: number;
      total: number;
      withoutNote: number;
      files: Array<{ name: string; path: string; note?: string }>;
    }>;

  it("pages through every file in the conversation, newest first", async () => {
    const h = many(45);
    const first = await list(h, {});
    expect(first).toMatchObject({ page: 1, pages: 3, matching: 45, total: 45, withoutNote: 44 });
    expect(first.files).toHaveLength(20);
    expect(first.files[0]?.path).toBe("attachments/f0.pdf");
    const last = await list(h, { page: 9 });
    expect(last.page).toBe(3);
    expect(last.files.map((file) => file.path)).toEqual([
      "attachments/f40.pdf",
      "attachments/f41.pdf",
      "attachments/f42.pdf",
      "attachments/f43.pdf",
      "attachments/f44.pdf",
    ]);
    expect(last.files[2]?.note).toBe("Drainage budget for HEL18");
  });

  it("finds files by every word of the query in their name or note", async () => {
    const h = many(45);
    const byNote = await list(h, { query: "hel18 DRAINAGE" });
    expect(byNote.files.map((file) => file.path)).toEqual(["attachments/f42.pdf"]);
    const byName = await list(h, { query: "report 7" });
    expect(byName.files.map((file) => file.name)).toEqual([
      "Report 7.pdf",
      "Report 17.pdf",
      "Report 27.pdf",
      "Report 37.pdf",
    ]);
    expect((await list(h, { query: "nothing like this" })).files).toEqual([]);
  });

  it("returns an empty page when the conversation has no files", async () => {
    const h = many(0);
    expect(await list(h, {})).toMatchObject({ page: 1, pages: 1, total: 0, files: [] });
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
      expect.arrayContaining(["fetch_file", "note_file", "list_conversation_files"]),
    );
    expect(names({ conversationFiles: false })).not.toContain("list_conversation_files");
    expect(names({ conversationFiles: false })).not.toContain("fetch_file");
    expect(names({ conversationFiles: false })).not.toContain("note_file");
    expect(names({ conversationFiles: true, computerAccess: "tools" })).toContain("fetch_file");
    expect(names({ conversationFiles: true, computerAccess: "none" })).not.toContain("fetch_file");
  });
});
