import { openStudioNote } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { replaySteps, withInPath } from "./document-rebase.js";
import { studioDocumentFiles, studioDocumentForTurn } from "./document-versions.js";
import type * as OcscToolModule from "./ocsc-tool.js";
import type * as RunMessagesModule from "./run-messages.js";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";
import { computerTools, publishOpenStudioDraft } from "./run-tools-computer.js";
import { fileTools } from "./run-tools-files.js";

vi.mock("./ocsc-tool.js", async (importOriginal) => ({
  ...(await importOriginal<typeof OcscToolModule>()),
  ocscBeforeRun: async () => undefined,
  ocscAfterRun: async () => undefined,
}));
const published = vi.hoisted(() => [] as unknown[]);
vi.mock("./run-messages.js", async (importOriginal) => ({
  ...(await importOriginal<typeof RunMessagesModule>()),
  publishMessage: async (_deps: unknown, _run: unknown, _role: unknown, blocks: unknown[]) => {
    published.push(...blocks);
  },
}));

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const owner = { spaceId: "space-1", userId: "user-1" };
const NAME = "BIM: The Basics";

type Row = {
  id: string;
  spaceId: string;
  userId: string;
  botId: string | null;
  groupId: string | null;
  runId: string | null;
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
    runId: "earlier-run",
    name: NAME,
    mimeType: PPTX,
    size: 10,
    storageKey: `key-${id}`,
    source: "assistant",
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
    if (key === "AND") {
      if (!(value as Where[]).every((and) => matches(candidate, and))) return false;
      continue;
    }
    const actual = candidate[key as keyof Row];
    if (value && typeof value === "object" && "contains" in value) {
      const { contains } = value as { contains: string };
      if (!String(actual).toLowerCase().includes(contains.toLowerCase())) return false;
    } else if (value && typeof value === "object" && "in" in value) {
      if (!(value as { in: unknown[] }).in.includes(actual)) return false;
    } else if (value && typeof value === "object" && "equals" in value) {
      const { equals } = value as { equals: string };
      if (String(actual).toLowerCase() !== equals.toLowerCase()) return false;
    } else if (actual !== value) return false;
  }
  return true;
}

function database(rows: Row[]) {
  const newestFirst = (list: Row[]) =>
    [...list].sort(
      (a, b) => b.version - a.version || b.createdAt.getTime() - a.createdAt.getTime(),
    );
  const artifact = {
    findFirst: vi.fn(
      async ({ where }: { where: Where }) =>
        newestFirst(rows.filter((r) => matches(r, where)))[0] ?? null,
    ),
    findMany: vi.fn(async ({ where }: { where: Where }) =>
      rows
        .filter((r) => matches(r, where))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    ),
    count: vi.fn(
      async ({ where }: { where: Where }) => rows.filter((r) => matches(r, where)).length,
    ),
    create: vi.fn(async ({ data }: { data: Partial<Row> }) => {
      const given = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
      const created = row(`new-${rows.length + 1}`, { ...given, createdAt: new Date() } as Row);
      rows.push(created);
      return created;
    }),
  };
  const prisma = {
    artifact,
    user: { findUnique: async () => ({ name: "Keith Knox", email: "keith@ocsc.ie" }) },
    documentDraft: {
      findUnique: async () => null,
      findFirst: async () => null,
      upsert: async () => ({}),
    },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ artifact, $queryRaw: async () => [] }),
  };
  return prisma as unknown as PrismaClient;
}

/** The run's document folder, as a map of stored path to file text. */
function folder() {
  const stored = new Map<string, string>();
  const files = {
    listFiles: vi.fn(async (_ref: unknown, dir: string) =>
      [...stored.keys()]
        .filter((path) => path.split("/").slice(0, -1).join("/") === dir)
        .map((path) => ({ path })),
    ),
    readFile: vi.fn(async (_ref: unknown, path: string) => {
      const text = stored.get(path);
      if (text === undefined) throw new Error("file not found");
      return new TextEncoder().encode(text);
    }),
    writeFile: vi.fn(
      async (_ref: unknown, file: { path: string; content: Uint8Array | string }) => {
        stored.set(
          file.path,
          typeof file.content === "string" ? file.content : new TextDecoder().decode(file.content),
        );
      },
    ),
  };
  return { stored, files };
}

function noteFor(documentId: string, artifactId: string) {
  return [
    {
      kind: "text" as const,
      text: `add a site photo\n\n${openStudioNote({
        kind: "slides",
        title: NAME,
        documentId,
        artifactId,
        version: 2,
        selection: "slide 3",
      })}`,
    },
  ];
}

const flag = (args: readonly string[], name: string) => args[args.indexOf(name) + 1] ?? "";

async function harness(options: {
  rows: Row[];
  note?: { documentId: string; artifactId: string };
  chatFiles?: string[];
  groupId?: string;
}) {
  const rows = options.rows;
  const prisma = database(rows);
  const { stored, files } = folder();
  // Each saved version's text is its id, so a file shows which version an edit started from.
  const contents = (key: string) => key.replace(/^key-/, "");
  const run = vi.fn(async ({ args }: { args: string[] }) => {
    const input = stored.get(args.includes("--in") ? flag(args, "--in") : (args[1] ?? ""));
    if (input !== undefined && args[0] === "read") {
      return { stdout: JSON.stringify({ ok: true, text: input }), stderr: "", code: 0 };
    }
    if (input === undefined) {
      return {
        stdout: JSON.stringify({ ok: false, error: "path does not exist" }),
        stderr: "",
        code: 1,
      };
    }
    const out = flag(args, "--out");
    stored.set(out, `${input}+${flag(args, "--spec")}`);
    return { stdout: JSON.stringify({ ok: true, path: out }), stderr: "", code: 0 };
  });
  const studioDocument = options.note
    ? await studioDocumentForTurn(
        prisma,
        owner,
        noteFor(options.note.documentId, options.note.artifactId),
      )
    : undefined;
  const conversationFiles = new Map(
    [
      ...studioDocumentFiles(studioDocument),
      ...(options.chatFiles ?? []).map((id) => ({
        artifactId: id,
        name: NAME,
        mimeType: PPTX,
        size: 10,
        path: `attachments/${id}.pptx`,
      })),
    ].map((file) => [file.path, file]),
  );
  const ctx = {
    deps: {
      prisma,
      artifacts: {
        get: async (key: string) => new TextEncoder().encode(contents(key)),
        put: async () => ({ id: `stored-${rows.length}` }),
        remove: async () => {},
      },
      toolRunner: { run },
      sandbox: files,
      events: { append: async () => undefined },
    },
    run: { ...owner, id: "r1", trigger: "user" },
    runId: "r1",
    bot: { id: "tender-bot", userId: owner.userId },
    thread: { id: "t2", spaceId: owner.spaceId, groupId: options.groupId ?? null },
    context: { ...owner, operationId: "op", traceId: "op", signal: new AbortController().signal },
    secrets: [] as string[],
    computer: {
      mode: "private",
      folder: undefined,
      access: "full",
      // The computer shares the document home, so attach_file reads what ocsc wrote there.
      get: vi.fn(async () => ({ id: "computer" })),
      checkpoint: { markDirty: () => {} },
      documents: {
        workspace: { base: "/data/tool-work", mount: "tool-work/home", cwd: "" },
        files,
        prepare: async () => {},
      },
      conversationFiles,
      studioDocument,
    },
    state: { documents: { made: [] as string[], attached: false } },
  };
  const call = (name: string, args: Record<string, unknown>) =>
    ({ name, args, executionId: `e-${name}`, finish: async (r: unknown) => r }) as never;
  const edit = (input: string, spec = "photo.json") =>
    computerTools.ocsc!(
      ctx as never,
      call("ocsc", {
        program: "pptx",
        args: ["edit", "--in", input, "--spec", spec, "--out", "outputs/deck.pptx"],
      }),
    ) as Promise<Record<string, unknown>>;
  const attach = (path = "outputs/deck.pptx", name: string | undefined = NAME) =>
    fileTools.attach_file!(ctx as never, call("attach_file", { path, name })) as Promise<
      Record<string, unknown>
    >;
  const ocsc = (program: string, args: string[]) =>
    computerTools.ocsc!(ctx as never, call("ocsc", { program, args })) as Promise<
      Record<string, unknown>
    >;
  const find = (query: string, type?: string) =>
    fileTools.find_my_documents!(
      ctx as never,
      call("find_my_documents", { query, type }),
    ) as Promise<{
      documents: { documentId: string; name: string; path: string; version: number }[];
      next: string;
      error?: string;
    }>;
  return { ctx, rows, stored, run, edit, attach, ocsc, find };
}

/** The deck: version 1 and 2 from a chat, then whatever the test adds. */
function deck(...later: Row[]) {
  return [row("v1"), row("v2", { rootArtifactId: "v1", version: 2 }), ...later];
}

const studioSave = (id: string, version: number) =>
  row(id, { rootArtifactId: "v1", version, source: "studio", runId: null });

describe("an edit that names an older version", () => {
  it("runs on the person's newer studio save instead of refusing", async () => {
    const h = await harness({
      rows: deck(studioSave("v3", 3)),
      note: { documentId: "v1", artifactId: "v2" },
    });
    const result = await h.edit("attachments/v2.pptx");
    expect(h.run).toHaveBeenCalledWith(
      expect.objectContaining({ args: expect.arrayContaining(["--in", "attachments/v3.pptx"]) }),
    );
    expect(h.stored.get("outputs/deck.pptx")).toBe("v3+photo.json");
    expect(result.rebased).toContain("version 3");
    expect(result.rebased).toContain("Do not ask the person to reopen");
    expect(result).not.toHaveProperty("error");
  });

  it("runs on a version another chat made, with the studio closed", async () => {
    const h = await harness({
      rows: deck(row("v3", { rootArtifactId: "v1", version: 3, runId: "other-chat" })),
      chatFiles: ["v2"],
    });
    const result = await h.edit("attachments/v2.pptx");
    expect(h.stored.get("outputs/deck.pptx")).toBe("v3+photo.json");
    expect(result.rebased).toContain("another chat saved it");
  });

  it("puts the named version in place, so no fetch is needed first", async () => {
    const h = await harness({ rows: deck(), chatFiles: ["v2"] });
    const result = await h.edit("attachments/v2.pptx");
    expect(h.stored.get("attachments/v2.pptx")).toBe("v2");
    expect(h.stored.get("outputs/deck.pptx")).toBe("v2+photo.json");
    expect(result).not.toHaveProperty("rebased");
  });

  it("leaves a document this chat cannot reach alone", async () => {
    const h = await harness({ rows: deck(studioSave("v3", 3)) });
    const result = await h.edit("attachments/v2.pptx");
    expect(result.error).toContain("fetch_file");
    expect(h.run).not.toHaveBeenCalled();
    expect(h.stored.size).toBe(0);
  });
});

describe("attaching after someone else saved a version", () => {
  it("makes the edits again on that version, so both are kept", async () => {
    const h = await harness({ rows: deck(), note: { documentId: "v1", artifactId: "v2" } });
    await h.edit("attachments/v2.pptx");
    h.rows.push(studioSave("v3", 3));
    const result = await h.attach();
    expect(result).toMatchObject({ ok: true, rebased: expect.stringContaining("Version 3") });
    expect(h.stored.get("outputs/deck.pptx")).toBe("v3+photo.json");
    expect(h.rows.at(-1)).toMatchObject({ version: 4, rootArtifactId: "v1", name: NAME });
  });

  it("replays every step of a chain of edits", async () => {
    const h = await harness({ rows: deck(), note: { documentId: "v1", artifactId: "v2" } });
    await h.edit("attachments/v2.pptx", "photo.json");
    await computerTools.ocsc!(
      h.ctx as never,
      {
        name: "ocsc",
        args: {
          program: "pptx",
          args: [
            "edit",
            "--in",
            "outputs/deck.pptx",
            "--spec",
            "caption.json",
            "--out",
            "outputs/final.pptx",
          ],
        },
        executionId: "e2",
        finish: async (r: unknown) => r,
      } as never,
    );
    h.rows.push(row("v3", { rootArtifactId: "v1", version: 3, runId: "other-chat" }));
    const result = await h.attach("outputs/final.pptx");
    expect(result).toMatchObject({ ok: true, rebased: expect.stringContaining("2 edits") });
    expect(h.stored.get("outputs/final.pptx")).toBe("v3+photo.json+caption.json");
  });

  it("says what no longer fits instead of overwriting the newer version", async () => {
    const h = await harness({ rows: deck(), note: { documentId: "v1", artifactId: "v2" } });
    await h.edit("attachments/v2.pptx");
    h.rows.push(studioSave("v3", 3));
    h.run.mockResolvedValueOnce({
      stdout: JSON.stringify({ ok: false, error: "slide 3 no longer exists" }),
      stderr: "",
      code: 1,
    });
    const before = h.rows.length;
    const result = await h.attach();
    expect(result.error).toContain("slide 3 no longer exists");
    expect(result.error).toContain("--in attachments/v3.pptx --out outputs/deck.pptx");
    expect(h.rows).toHaveLength(before);
  });

  it("does not make the edits twice when the same file is attached again", async () => {
    const h = await harness({ rows: deck(), note: { documentId: "v1", artifactId: "v2" } });
    await h.edit("attachments/v2.pptx");
    await h.attach();
    await h.attach();
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.rows.map((r) => r.version)).toEqual([1, 2, 3, 4]);
  });

  it("keeps the agent's later edits on top of its own attached version", async () => {
    const h = await harness({ rows: deck(), note: { documentId: "v1", artifactId: "v2" } });
    await h.edit("attachments/v2.pptx", "photo.json");
    await h.attach();
    await computerTools.ocsc!(
      h.ctx as never,
      {
        name: "ocsc",
        args: {
          program: "pptx",
          args: [
            "edit",
            "--in",
            "outputs/deck.pptx",
            "--spec",
            "caption.json",
            "--out",
            "outputs/two.pptx",
          ],
        },
        executionId: "e3",
        finish: async (r: unknown) => r,
      } as never,
    );
    h.rows.push(studioSave("v4", 4));
    const result = await h.attach("outputs/two.pptx");
    expect(result).toMatchObject({ ok: true, rebased: expect.stringContaining("your edit was") });
    expect(h.stored.get("outputs/two.pptx")).toBe("v4+caption.json");
  });
});

describe("the open studio edit kept at the end of a run", () => {
  it("lands on top of a studio save made during the run", async () => {
    published.length = 0;
    const h = await harness({ rows: deck(), note: { documentId: "v1", artifactId: "v2" } });
    await h.edit("attachments/v2.pptx");
    h.rows.push(studioSave("v3", 3));
    await publishOpenStudioDraft(h.ctx as never);
    expect(h.stored.get("outputs/deck.pptx")).toBe("v3+photo.json");
    expect(h.rows.at(-1)).toMatchObject({ version: 4, rootArtifactId: "v1", runId: "r1" });
    expect(published).toHaveLength(1);
    expect(h.ctx.state.documents.attached).toBe(true);
  });
});

describe("reading a document", () => {
  it("reads the person's newest studio save, not the copy the chat saw", async () => {
    const h = await harness({ rows: deck(studioSave("v3", 3)), chatFiles: ["v2"] });
    const result = await h.ocsc("pptx", ["read", "--in", "attachments/v2.pptx"]);
    expect(h.run).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["read", "--in", "attachments/v3.pptx"] }),
    );
    expect(result.rebased).toContain("shows version 3");
    expect(h.ctx.state.documents).not.toHaveProperty("studioEdited", true);
    expect((h.ctx.state.documents as { lineage?: Map<string, unknown> }).lineage).toBeUndefined();
  });

  it("follows a path given without --in", async () => {
    const h = await harness({ rows: deck(studioSave("v3", 3)), chatFiles: ["v2"] });
    await h.ocsc("pptx", ["read", "attachments/v2.pptx"]);
    expect(h.run).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["read", "attachments/v3.pptx"] }),
    );
  });

  it("keeps both versions a comparison names", async () => {
    const h = await harness({ rows: deck(studioSave("v3", 3)), chatFiles: ["v2"] });
    await h.ocsc("pptx", ["diff", "attachments/v2.pptx", "attachments/v3.pptx"]);
    expect(h.run).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["diff", "attachments/v2.pptx", "attachments/v3.pptx"] }),
    );
  });
});

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Last night's three files, made by another agent in other chats, plus someone else's deck. */
function stressFiles() {
  return [
    row("w1", { name: "STRESS_20261117_Word.docx", mimeType: DOCX, botId: "general-bot" }),
    row("s1", { name: "STRESS_20261117_Sheet.xlsx", mimeType: XLSX, botId: "general-bot" }),
    row("d1", { name: "STRESS_20261117_Deck", botId: "general-bot" }),
    row("d2", { name: "STRESS_20261117_Deck", rootArtifactId: "d1", version: 2 }),
    row("d3", {
      name: "STRESS_20261117_Deck",
      rootArtifactId: "d1",
      version: 3,
      source: "studio",
      runId: null,
    }),
    row("theirs", { name: "STRESS_20261117_Deck", userId: "user-2" }),
  ];
}

describe("finding the person's documents from a new chat", () => {
  it("finds the deck by name at its newest version and edits it there", async () => {
    const h = await harness({ rows: stressFiles() });
    const found = await h.find("stress deck");
    expect(found.documents).toEqual([
      expect.objectContaining({ documentId: "d1", version: 3, path: "attachments/d3.pptx" }),
    ]);
    expect(found.next).toContain("attach the result");
    await h.ocsc("pptx", ["read", "--in", "attachments/d3.pptx"]);
    await h.edit("attachments/d3.pptx");
    expect(h.stored.get("outputs/deck.pptx")).toBe("d3+photo.json");
    const attached = await h.attach("outputs/deck.pptx", "STRESS_20261117_Deck.pptx");
    expect(attached).toMatchObject({ ok: true });
    expect(h.rows.at(-1)).toMatchObject({
      rootArtifactId: "d1",
      version: 4,
      botId: "general-bot",
      name: "STRESS_20261117_Deck",
    });
  });

  it("lists every match, so the agent asks which one is meant", async () => {
    const h = await harness({ rows: stressFiles() });
    const found = await h.find("STRESS_20261117");
    expect(found.documents.map((d) => d.name).sort()).toEqual([
      "STRESS_20261117_Deck",
      "STRESS_20261117_Sheet.xlsx",
      "STRESS_20261117_Word.docx",
    ]);
    expect(found.next).toContain("ask them which");
    expect((await h.find("STRESS_20261117", "excel")).documents).toHaveLength(1);
  });

  it("never finds someone else's document or edits one it did not find", async () => {
    const h = await harness({ rows: stressFiles() });
    expect((await h.find("nothing like this")).documents).toEqual([]);
    const theirs = await h.edit("attachments/theirs.pptx");
    expect(JSON.stringify(theirs)).toMatch(/does not exist/);
    const unfound = await h.edit("attachments/d3.pptx");
    expect(JSON.stringify(unfound)).toMatch(/does not exist/);
    expect([...h.stored.keys()].filter((path) => path.startsWith("attachments/"))).toEqual([]);
  });

  it("keeps a shared chat to its own group's documents", async () => {
    const rows = [...stressFiles(), row("g1", { name: "STRESS group deck", groupId: "group-1" })];
    const h = await harness({ rows, groupId: "group-1" });
    expect((await h.find("stress deck")).documents.map((d) => d.documentId)).toEqual(["g1"]);
  });
});

describe("attaching an edit of a document from another chat", () => {
  it("lands as that document's next version even without a name", async () => {
    const h = await harness({ rows: deck(), chatFiles: ["v2"] });
    await h.edit("attachments/v2.pptx");
    await h.attach("outputs/deck.pptx", undefined);
    expect(h.rows.at(-1)).toMatchObject({ rootArtifactId: "v1", version: 3, botId: "general-bot" });
  });

  it("starts a separate document when given another name", async () => {
    const h = await harness({ rows: deck(), chatFiles: ["v2"] });
    await h.edit("attachments/v2.pptx");
    await h.attach("outputs/deck.pptx", "Client copy");
    expect(h.rows.at(-1)).toMatchObject({
      rootArtifactId: null,
      version: 1,
      botId: "tender-bot",
      name: "Client copy",
    });
  });
});

describe("who can find documents by name", () => {
  const names = (extra: Partial<Parameters<typeof selectBuiltinToolsForRun>[0]>) =>
    selectBuiltinToolsForRun({
      graphicalToolsAllowed: false,
      groupId: null,
      trigger: "user",
      semanticMemoryEnabled: false,
      messagingChannelRun: false,
      myDocuments: true,
      ...extra,
    }).map((tool) => tool.name);

  it("is the person's own turn only", () => {
    expect(names({})).toContain("find_my_documents");
    expect(names({ messagingChannelRun: true })).not.toContain("find_my_documents");
    expect(names({ myDocuments: false })).not.toContain("find_my_documents");
  });
});

describe("replaySteps", () => {
  it("starts only the first step from the newer version", () => {
    const steps = replaySteps(
      {
        rootId: "v1",
        baseId: "v2",
        baseVersion: 2,
        name: NAME,
        mimeType: PPTX,
        steps: [
          { program: "pptx", args: ["edit", "--in", "attachments/v2.pptx", "--out", "a.pptx"] },
          { program: "pptx", args: ["edit", "--in", "a.pptx", "--out", "b.pptx"] },
        ],
      },
      "attachments/v5.pptx",
    );
    expect(steps.map((step) => flag(step.args, "--in"))).toEqual(["attachments/v5.pptx", "a.pptx"]);
    expect(withInPath(["read"], "x")).toEqual(["read"]);
  });
});
