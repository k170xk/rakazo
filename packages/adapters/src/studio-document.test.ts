import { openStudioNote, studioNoteDocument } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import {
  studioAttachTarget,
  studioDocumentFiles,
  studioDocumentForTurn,
} from "./document-versions.js";
import { fileTools } from "./run-tools-files.js";
import { attachWorkspaceFileToThread } from "./thread-artifacts.js";

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const owner = { spaceId: "space-1", userId: "user-1" };

type Row = {
  id: string;
  spaceId: string;
  userId: string;
  botId: string | null;
  groupId: string | null;
  name: string;
  mimeType: string;
  size: number;
  storageKey: string;
  source: string | null;
  rootArtifactId: string | null;
  version: number;
  createdAt: Date;
};

let clock = 0;
function row(id: string, extra: Partial<Row> = {}): Row {
  clock += 1;
  return {
    id,
    ...owner,
    botId: "general-bot",
    groupId: null,
    name: "BIM: The Basics",
    mimeType: PPTX,
    size: 100,
    storageKey: `key-${id}`,
    source: null,
    rootArtifactId: null,
    version: 1,
    createdAt: new Date(clock * 1000),
    ...extra,
  };
}

type Where = Record<string, unknown> & { OR?: Where[] };

function matches(candidate: Row, where: Where): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key === "OR") {
      if (!(value as Where[]).some((or) => matches(candidate, or))) return false;
      continue;
    }
    const actual = candidate[key as keyof Row];
    if (value && typeof value === "object" && "in" in value) {
      if (!(value as { in: unknown[] }).in.includes(actual)) return false;
    } else if (value && typeof value === "object" && "equals" in value) {
      const { equals } = value as { equals: string };
      if (String(actual).toLowerCase() !== equals.toLowerCase()) return false;
    } else if (actual !== value) return false;
  }
  return true;
}

function artifactTable(rows: Row[]) {
  const newestFirst = (list: Row[]) =>
    [...list].sort(
      (a, b) => b.version - a.version || b.createdAt.getTime() - a.createdAt.getTime(),
    );
  const artifact = {
    findFirst: vi.fn(
      async ({ where }: { where: Where }) =>
        newestFirst(rows.filter((r) => matches(r, where)))[0] ?? null,
    ),
    findMany: vi.fn(async ({ where }: { where: Where }) => rows.filter((r) => matches(r, where))),
    count: vi.fn(
      async ({ where }: { where: Where }) => rows.filter((r) => matches(r, where)).length,
    ),
    create: vi.fn(async ({ data }: { data: Partial<Row> }) => {
      const created = row(`new-${rows.length + 1}`, { ...data, createdAt: new Date() } as Row);
      rows.push(created);
      return created;
    }),
  };
  const prisma = {
    artifact,
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ artifact, $queryRaw: async () => [] }),
  };
  return prisma as unknown as PrismaClient;
}

/** "BIM: The Basics" made by another agent: version 1, then the person's studio save. */
function deck() {
  return [
    row("root"),
    row("v2", { rootArtifactId: "root", version: 2, source: "studio" }),
    row("other-doc", { name: "Other deck" }),
    row("someone-else", { userId: "user-2", name: "Their deck" }),
  ];
}

function noteFor(documentId: string, artifactId: string) {
  return [
    {
      kind: "text" as const,
      text: `update this\n\n${openStudioNote({
        kind: "slides",
        title: "BIM: The Basics",
        documentId,
        artifactId,
        version: 2,
        selection: "slide 6",
      })}`,
    },
  ];
}

describe("studioNoteDocument", () => {
  it("reads the document a studio note names", () => {
    expect(studioNoteDocument(noteFor("root", "v2")[0]!.text)).toEqual({
      documentId: "root",
      artifactId: "v2",
    });
  });

  it("finds nothing without a document note", () => {
    expect(studioNoteDocument("update this")).toBeNull();
    expect(
      studioNoteDocument(openStudioNote({ kind: "whiteboard", title: "Plan", id: "wb1" })),
    ).toBeNull();
  });

  it("tells the assistant the file is reachable, so it never asks for an export", () => {
    const text = noteFor("root", "v2")[0]!.text;
    expect(text).toContain("call fetch_file with attachments/v2.pptx");
    expect(text).toContain("never ask them to attach or export it");
  });
});

describe("studioDocumentForTurn", () => {
  it("lets the owner reach the noted family when another agent made it", async () => {
    const prisma = artifactTable(deck());
    const document = await studioDocumentForTurn(prisma, owner, noteFor("root", "v2"));
    expect(document).toMatchObject({
      rootId: "root",
      botId: "general-bot",
      groupId: null,
      name: "BIM: The Basics",
    });
    expect(studioDocumentFiles(document)).toEqual([
      {
        artifactId: "v2",
        name: "BIM: The Basics",
        mimeType: PPTX,
        size: 100,
        path: "attachments/v2.pptx",
      },
    ]);
  });

  it("reaches the newest version when the note named an older one", async () => {
    const prisma = artifactTable(deck());
    const document = await studioDocumentForTurn(prisma, owner, noteFor("root", "root"));
    expect(studioDocumentFiles(document).map((file) => file.path)).toEqual([
      "attachments/v2.pptx",
      "attachments/root.pptx",
    ]);
  });

  it("finds nothing for someone else's document", async () => {
    const prisma = artifactTable(deck());
    expect(
      await studioDocumentForTurn(prisma, owner, noteFor("someone-else", "someone-else")),
    ).toBeUndefined();
    expect(
      await studioDocumentForTurn(prisma, { ...owner, userId: "user-2" }, noteFor("root", "v2")),
    ).toBeUndefined();
    expect(
      await studioDocumentForTurn(prisma, { ...owner, spaceId: "space-2" }, noteFor("root", "v2")),
    ).toBeUndefined();
  });

  it("finds nothing when the note's file is not in the family it names", async () => {
    const prisma = artifactTable(deck());
    expect(
      await studioDocumentForTurn(prisma, owner, noteFor("root", "other-doc")),
    ).toBeUndefined();
  });

  it("finds nothing without a studio note", async () => {
    const prisma = artifactTable(deck());
    expect(
      await studioDocumentForTurn(prisma, owner, [{ kind: "text", text: "update this" }]),
    ).toBeUndefined();
  });
});

describe("fetch_file for the studio document", () => {
  async function harness() {
    const rows = deck();
    const prisma = artifactTable(rows);
    const studioDocument = await studioDocumentForTurn(prisma, owner, noteFor("root", "v2"));
    const written: string[] = [];
    const runner = {
      listFiles: async () => [],
      readFile: async () => new Uint8Array(),
      writeFile: async (_ref: unknown, file: { path: string }) => {
        written.push(file.path);
      },
    };
    const ctx = {
      deps: {
        prisma,
        artifacts: { get: async () => new Uint8Array(100) },
        sandbox: runner,
        events: { append: async () => {} },
      },
      run: { ...owner, trigger: "user" },
      runId: "r1",
      bot: { id: "tender-bot" },
      thread: { id: "t1", spaceId: owner.spaceId },
      context: { ...owner, signal: new AbortController().signal },
      secrets: [] as string[],
      computer: {
        mode: "private",
        folder: undefined,
        access: "tools",
        get: vi.fn(),
        checkpoint: { markDirty: () => {} },
        runner: { workspace: {}, files: runner, prepare: async () => {} },
        conversationFiles: new Map(studioDocumentFiles(studioDocument).map((f) => [f.path, f])),
        studioDocument,
      },
    };
    const call = (path: string) =>
      ({
        name: "fetch_file",
        args: { path },
        executionId: "e1",
        finish: async (r: unknown) => r,
      }) as never;
    return { ctx: ctx as never, call, written };
  }

  it("puts the newest version on the computer in a chat with another agent", async () => {
    const h = await harness();
    const result = await fileTools.fetch_file!(h.ctx, h.call("attachments/v2.pptx"));
    expect(result).toEqual({ ok: true, path: "attachments/v2.pptx", bytes: 100 });
    expect(h.written).toEqual(["attachments/v2.pptx"]);
  });

  it("does not reach a family the note does not name", async () => {
    const h = await harness();
    const result = await fileTools.fetch_file!(h.ctx, h.call("attachments/other-doc.pptx"));
    expect(result).toMatchObject({ error: expect.stringContaining("exact attachments/ path") });
    expect(h.written).toEqual([]);
  });
});

describe("studioAttachTarget", () => {
  const document = {
    rootId: "root",
    versions: [],
    botId: "general-bot",
    groupId: null,
    name: "BIM: The Basics",
    mimeType: PPTX,
  };

  it("keeps a file under the document's name in the document's family", () => {
    const target = { botId: "general-bot", groupId: undefined, name: "BIM: The Basics" };
    expect(studioAttachTarget(document, { name: "BIM: The Basics", mimeType: PPTX })).toEqual(
      target,
    );
    expect(studioAttachTarget(document, { name: "bim: the basics.pptx", mimeType: PPTX })).toEqual(
      target,
    );
    expect(studioAttachTarget(document, { mimeType: PPTX, studioEdited: true })).toEqual(target);
  });

  it("leaves other files in the chat's own scope", () => {
    expect(studioAttachTarget(document, { name: "Another deck", mimeType: PPTX })).toBeUndefined();
    expect(studioAttachTarget(document, { mimeType: PPTX })).toBeUndefined();
    expect(
      studioAttachTarget(document, { name: "BIM: The Basics", mimeType: "application/pdf" }),
    ).toBeUndefined();
    expect(
      studioAttachTarget(undefined, { name: "BIM: The Basics", mimeType: PPTX }),
    ).toBeUndefined();
    expect(
      studioAttachTarget({ ...document, botId: null }, { name: "BIM: The Basics", mimeType: PPTX }),
    ).toBeUndefined();
  });

  it("lands the edited deck as the family's next version, not a new document", async () => {
    const rows = deck();
    const prisma = artifactTable(rows);
    const studioDocument = await studioDocumentForTurn(prisma, owner, noteFor("root", "v2"));
    const target = studioAttachTarget(studioDocument, { name: "BIM: The Basics", mimeType: PPTX });
    const store = {
      put: vi.fn(async () => ({ id: "stored-1" })),
      remove: vi.fn(async () => {}),
    };
    const attached = await attachWorkspaceFileToThread(
      { prisma, artifacts: store as never },
      {
        ...owner,
        botId: target?.botId ?? "tender-bot",
        groupId: target?.groupId,
        runId: "r1",
        filePath: "outputs/bim.pptx",
        bytes: new Uint8Array(10),
        operationId: "op-1",
        name: target?.name ?? "BIM: The Basics",
      },
    );
    const saved = rows.find((r) => r.id === attached.artifactId);
    expect(saved).toMatchObject({
      rootArtifactId: "root",
      version: 3,
      botId: "general-bot",
      name: "BIM: The Basics",
    });
  });

  it("starts a new family in the chat's scope when the file is another document", async () => {
    const rows = deck();
    const prisma = artifactTable(rows);
    const attached = await attachWorkspaceFileToThread(
      { prisma, artifacts: { put: async () => ({ id: "s" }), remove: async () => {} } as never },
      {
        ...owner,
        botId: "tender-bot",
        runId: "r1",
        filePath: "outputs/bim.pptx",
        bytes: new Uint8Array(10),
        operationId: "op-2",
        name: "BIM: The Basics",
      },
    );
    expect(rows.find((r) => r.id === attached.artifactId)).toMatchObject({
      rootArtifactId: null,
      version: 1,
      botId: "tender-bot",
    });
  });
});
