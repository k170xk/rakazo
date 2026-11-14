import type { ArtifactStore } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import type { DocumentDraftDeps } from "./document-drafts.js";
import { saveDocumentDraft } from "./document-drafts.js";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const context = {
  operationId: "op",
  traceId: "op",
  spaceId: "space-1",
  userId: "user-1",
  botId: "bot-1",
  signal: new AbortController().signal,
};

type Row = { id: string; rootArtifactId: string | null; version: number };

function setup(rows: Row[], previous?: { storageKey: string }) {
  const findFirst = vi.fn(async ({ where }: { where: { id?: string } }) => {
    const found = where.id
      ? rows.filter((row) => row.id === where.id)
      : [...rows].sort((a, b) => b.version - a.version);
    const row = found[0];
    return row ? { ...row, name: "Report", mimeType: DOCX, source: null } : null;
  });
  const upsert = vi.fn(async () => ({}));
  const findUnique = vi.fn(async () => previous ?? null);
  const put = vi.fn(async () => ({ id: "blob-new", hash: "h" }));
  const remove = vi.fn(async () => undefined);
  const deps: DocumentDraftDeps = {
    prisma: {
      artifact: { findFirst },
      documentDraft: { findUnique, upsert },
    } as unknown as Pick<PrismaClient, "artifact" | "documentDraft">,
    artifacts: { put, remove, get: vi.fn() } as unknown as ArtifactStore,
  };
  return { deps, upsert, put, remove };
}

const family = [
  { id: "v1", rootArtifactId: null, version: 1 },
  { id: "v2", rootArtifactId: "v1", version: 2 },
];
const ok = { stdout: JSON.stringify({ ok: true, path: "outputs/Report-v3.docx" }), code: 0 };
const edit = ["edit", "--in", "attachments/v2.docx", "--spec", "e.json", "--out", "out/r.docx"];
const bytes = new Uint8Array([1, 2, 3]);

describe("saveDocumentDraft", () => {
  it("keeps a successful edit of a family file as that family's draft", async () => {
    const { deps, upsert, put, remove } = setup(family, { storageKey: "blob-old" });
    const read = vi.fn(async () => bytes);
    const outcome = await saveDocumentDraft(deps, {
      context,
      program: "word",
      args: edit,
      result: ok,
      read,
    });
    expect(outcome).toBe("saved");
    expect(read).toHaveBeenCalledWith("out/r.docx", expect.any(Number));
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ mimeType: DOCX, bytes }), context);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          spaceId_userId_rootArtifactId: {
            spaceId: "space-1",
            userId: "user-1",
            rootArtifactId: "v1",
          },
        },
        update: { botId: "bot-1", storageKey: "blob-new", size: 3, baseVersion: 2 },
      }),
    );
    expect(remove).toHaveBeenCalledWith("blob-old", context);
  });

  it("skips new files, reads, failed commands and stale bases", async () => {
    const cases: Array<{ program: string; args: string[]; result: unknown }> = [
      { program: "word", args: ["new", "--spec", "s.json", "--out", "a.docx"], result: ok },
      { program: "word", args: ["read", "--in", "attachments/v2.docx"], result: ok },
      { program: "pdf", args: edit, result: ok },
      { program: "word", args: edit, result: { stdout: '{"ok":false}', code: 1 } },
      { program: "word", args: ["edit", "--in", "attachments/v1.docx", "--out", "x"], result: ok },
    ];
    for (const input of cases) {
      const { deps, upsert, put } = setup(family);
      const read = vi.fn(async () => bytes);
      expect(await saveDocumentDraft(deps, { context, ...input, read })).toBe("skipped");
      expect(read).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
    }
  });

  it("never throws when the file cannot be read or stored", async () => {
    const unreadable = setup(family);
    expect(
      await saveDocumentDraft(unreadable.deps, {
        context,
        program: "pptx",
        args: ["edit", "--in", "attachments/v2.pptx", "--out", "big.pptx"],
        result: ok,
        read: async () => {
          throw new Error("file exceeds 26214400 bytes");
        },
      }),
    ).toBe("failed");
    expect(unreadable.upsert).not.toHaveBeenCalled();

    const broken = setup(family);
    broken.put.mockRejectedValueOnce(new Error("storage down"));
    expect(
      await saveDocumentDraft(broken.deps, {
        context,
        program: "xlsx",
        args: ["edit", "--in", "attachments/v2.xlsx", "--out", "b.xlsx"],
        result: ok,
        read: async () => bytes,
      }),
    ).toBe("failed");
  });
});
