import { DEFAULT_COMPANY_FEATURES } from "@rakazo/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenAIFileSearch } from "./chat-file-search.js";
import {
  chatFileIndexingFor,
  chatFileSearchKey,
  indexChatFiles,
  indexUploadedChatFile,
  openAIFileSearch,
  resetChatFileSweep,
  searchChatFiles,
  setIndexWait,
  startChatFileIndexing,
  sweepChatFileSearch,
  unsearchableReason,
  waitForChatFileIndex,
} from "./chat-file-search.js";
import { setCompanyPolicy } from "./company-policy.js";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";
import type { EarlierThreadFile } from "./thread-artifacts.js";

type Entry = {
  id: string;
  spaceId: string;
  threadId: string;
  artifactId: string;
  openaiFileId: string | null;
  status: string;
  error: string | null;
  claimedAt: Date;
  updatedAt: Date;
};
type Index = { spaceId: string; threadId: string; vectorStoreId: string; usedAt: Date };

function matches(row: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") {
      return (condition as Array<Record<string, unknown>>).some((branch) => matches(row, branch));
    }
    const value = row[key];
    if (condition && typeof condition === "object" && !(condition instanceof Date)) {
      const c = condition as { in?: unknown[]; not?: unknown; lt?: Date };
      if (c.in) return c.in.includes(value);
      if ("not" in c) return value !== c.not;
      if (c.lt) return value instanceof Date && value < c.lt;
    }
    return value === condition;
  });
}

function fakePrisma(artifacts: Record<string, string> = {}) {
  const entries: Entry[] = [];
  const indexes: Index[] = [];
  let next = 0;
  const prisma = {
    artifact: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        artifacts[where.id] ? { storageKey: artifacts[where.id] } : null,
    },
    chatFileIndexEntry: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        entries.filter((entry) => matches(entry, where)),
      count: async ({ where }: { where: Record<string, unknown> }) =>
        entries.filter((entry) => matches(entry, where)).length,
      createMany: async ({ data }: { data: Array<Partial<Entry>> }) => {
        let count = 0;
        for (const row of data) {
          if (entries.some((e) => e.threadId === row.threadId && e.artifactId === row.artifactId))
            continue;
          entries.push({
            id: `entry-${++next}`,
            openaiFileId: null,
            claimedAt: new Date(),
            updatedAt: new Date(),
            ...row,
          } as Entry);
          count += 1;
        }
        return { count };
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: object }) => {
        const hit = entries.filter((e) => matches(e, where));
        for (const entry of hit) Object.assign(entry, data);
        return { count: hit.length };
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const hit = entries.filter((e) => matches(e, where));
        for (const entry of hit) entries.splice(entries.indexOf(entry), 1);
        return { count: hit.length };
      },
    },
    thread: {
      findFirst: vi.fn(async () => ({ id: "thread" }) as { id: string } | null),
    },
    chatFileIndex: {
      findUnique: async ({ where }: { where: { threadId: string } }) =>
        indexes.find((index) => index.threadId === where.threadId) ?? null,
      createMany: async ({ data }: { data: Array<Omit<Index, "usedAt">> }) => {
        for (const row of data) {
          if (!indexes.some((index) => index.threadId === row.threadId))
            indexes.push({ ...row, usedAt: new Date() });
        }
        return { count: 1 };
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: object }) => {
        for (const index of indexes.filter((i) => matches(i, where))) Object.assign(index, data);
        return { count: 0 };
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        for (const index of indexes.filter((i) => matches(i, where)))
          indexes.splice(indexes.indexOf(index), 1);
        return { count: 0 };
      },
    },
    $queryRaw: vi.fn(async () => [] as unknown[]),
    $executeRaw: vi.fn(async () => 0),
  };
  return { prisma, entries, indexes };
}

function fakeClient(overrides: Partial<OpenAIFileSearch> = {}) {
  let uploads = 0;
  const client = {
    createStore: vi.fn(async () => "vs_1"),
    uploadFile: vi.fn(async () => `file_${++uploads}`),
    attachFile: vi.fn(async () => undefined),
    storeFileStatus: vi.fn(async () => ({ status: "completed" })),
    search: vi.fn(async () => []),
    deleteFile: vi.fn(async () => undefined),
    deleteStore: vi.fn(async () => undefined),
    ...overrides,
  };
  return client as typeof client & OpenAIFileSearch;
}

const file = (artifactId: string, name: string, size = 1_000): EarlierThreadFile => ({
  artifactId,
  name,
  mimeType: "application/octet-stream",
  size,
  path: `attachments/${artifactId}-${name}`,
});

const openAICompany = () =>
  setCompanyPolicy({
    features: DEFAULT_COMPANY_FEATURES,
    model: { provider: "openai", model: "gpt-6", key: "sk-test" },
  });

const input = {
  spaceId: "space",
  userId: "user",
  threadId: "thread",
  context: { operationId: "op", traceId: "trace", spaceId: "space", userId: "user" },
};

beforeEach(() => {
  setIndexWait(0);
  resetChatFileSweep();
});
afterEach(() => setCompanyPolicy({ features: null, model: null }));

describe("chat file search key", () => {
  it("is the company OpenAI key only while the switch is on", () => {
    expect(chatFileSearchKey()).toBeNull();
    openAICompany();
    expect(chatFileSearchKey()).toBe("sk-test");
    setCompanyPolicy({ features: { ...DEFAULT_COMPANY_FEATURES, chatFileSearch: false } });
    expect(chatFileSearchKey()).toBeNull();
    setCompanyPolicy({
      features: DEFAULT_COMPANY_FEATURES,
      model: { provider: "anthropic", model: "claude", key: "sk-ant" },
    });
    expect(chatFileSearchKey()).toBeNull();
  });
});

describe("searchable files", () => {
  it("indexes documents and leaves spreadsheets, images and huge files to the other tools", () => {
    expect(unsearchableReason({ name: "Spec.PDF", size: 10 })).toBeUndefined();
    expect(unsearchableReason({ name: "notes.docx", size: 10 })).toBeUndefined();
    expect(unsearchableReason({ name: "costs.xlsx", size: 10 })).toMatch(/type/);
    expect(unsearchableReason({ name: "photo.png", size: 10 })).toMatch(/type/);
    expect(unsearchableReason({ name: "empty.txt", size: 0 })).toMatch(/empty/);
    expect(unsearchableReason({ name: "big.pdf", size: 200 * 1024 * 1024 })).toMatch(/large/);
  });
});

describe("OpenAI client", () => {
  it("maps search hits and their artifact ids", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        data: [
          {
            file_id: "file_1",
            filename: "a.pdf",
            score: 0.81234,
            attributes: { artifact_id: "art-1" },
            content: [
              { type: "text", text: "First" },
              { type: "text", text: "Second" },
            ],
          },
        ],
      }),
    );
    const hits = await openAIFileSearch("sk", fetchImpl as never).search("vs_1", "q", 5);
    expect(hits).toEqual([
      {
        fileId: "file_1",
        filename: "a.pdf",
        score: 0.81234,
        artifactId: "art-1",
        text: "First\nSecond",
      },
    ]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/vector_stores/vs_1/search");
    expect(JSON.parse(String(init.body))).toMatchObject({ query: "q", max_num_results: 5 });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk");
  });

  it("takes a file out of its store before deleting it, so its passages stop matching", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ deleted: true }));
    await openAIFileSearch("sk", fetchImpl as never).deleteFile("file_1", "vs_1");
    const calls = fetchImpl.mock.calls.map((call) => {
      const [url, init] = call as unknown as [string, RequestInit];
      return `${init.method} ${url}`;
    });
    expect(calls).toEqual([
      "DELETE https://api.openai.com/v1/vector_stores/vs_1/files/file_1",
      "DELETE https://api.openai.com/v1/files/file_1",
    ]);
  });

  it("treats deleting something OpenAI no longer has as done and reports other errors", async () => {
    const gone = vi.fn(async () =>
      Response.json({ error: { message: "No such file" } }, { status: 404 }),
    );
    await expect(
      openAIFileSearch("sk", gone as never).deleteFile("file_1"),
    ).resolves.toBeUndefined();
    const broken = vi.fn(async () =>
      Response.json({ error: { message: "Bad key" } }, { status: 401 }),
    );
    await expect(openAIFileSearch("sk", broken as never).deleteStore("vs_1")).rejects.toThrow(
      "Bad key",
    );
  });
});

describe("indexing", () => {
  it("indexes each supported file once and records the rest as skipped", async () => {
    openAICompany();
    const { prisma, entries, indexes } = fakePrisma({ a: "key-a", b: "key-b" });
    const client = fakeClient();
    const artifacts = { get: vi.fn(async () => new Uint8Array([1, 2, 3])) };
    const files = [file("a", "spec.pdf"), file("b", "costs.xlsx")];
    await indexChatFiles({ prisma: prisma as never, artifacts, client }, { ...input, files });

    expect(indexes).toEqual([
      expect.objectContaining({ threadId: "thread", vectorStoreId: "vs_1" }),
    ]);
    expect(client.uploadFile).toHaveBeenCalledTimes(1);
    expect(client.attachFile).toHaveBeenCalledWith("vs_1", "file_1", "a");
    expect(entries.find((e) => e.artifactId === "a")).toMatchObject({
      status: "ready",
      openaiFileId: "file_1",
    });
    expect(entries.find((e) => e.artifactId === "b")?.status).toBe("skipped");

    await indexChatFiles({ prisma: prisma as never, artifacts, client }, { ...input, files });
    expect(client.uploadFile).toHaveBeenCalledTimes(1);
    expect(client.createStore).toHaveBeenCalledTimes(1);
  });

  it("marks a file OpenAI could not read, or that failed to upload, as failed", async () => {
    openAICompany();
    const { prisma, entries } = fakePrisma({ a: "key-a", b: "key-b" });
    const client = fakeClient({
      storeFileStatus: vi.fn(async () => ({ status: "failed", error: "Unreadable" })),
      uploadFile: vi
        .fn()
        .mockResolvedValueOnce("file_1")
        .mockRejectedValueOnce(new Error("upload broke")),
    });
    const artifacts = { get: vi.fn(async () => new Uint8Array([1])) };
    await indexChatFiles(
      { prisma: prisma as never, artifacts, client },
      { ...input, files: [file("a", "a.pdf"), file("b", "b.pdf")] },
    );
    expect(entries.map((e) => [e.artifactId, e.status, e.error]).sort()).toEqual([
      ["a", "failed", "Unreadable"],
      ["b", "failed", "upload broke"],
    ]);
  });

  it("indexes files arriving together side by side, once each, into one store", async () => {
    openAICompany();
    const { prisma, entries } = fakePrisma({ a: "key-a", b: "key-b" });
    const client = fakeClient();
    const artifacts = { get: vi.fn(async () => new Uint8Array([1])) };
    const deps = { prisma: prisma as never, artifacts, client };
    startChatFileIndexing(deps, { ...input, files: [file("a", "a.pdf")] });
    startChatFileIndexing(deps, { ...input, files: [file("a", "a.pdf"), file("b", "b.pdf")] });
    await chatFileIndexingFor("thread");
    expect(client.createStore).toHaveBeenCalledTimes(1);
    expect(client.uploadFile).toHaveBeenCalledTimes(2);
    expect(entries.map((e) => [e.artifactId, e.status])).toEqual([
      ["a", "ready"],
      ["b", "ready"],
    ]);
    expect(chatFileIndexingFor("thread")).toBeUndefined();
  });

  it("starts indexing a file as soon as it is uploaded to an existing chat", async () => {
    openAICompany();
    const { prisma, entries } = fakePrisma({ a: "key-a" });
    const client = fakeClient();
    const artifacts = { get: vi.fn(async () => new Uint8Array([1])) };
    indexUploadedChatFile(
      { prisma: prisma as never, artifacts, client },
      {
        spaceId: "space",
        userId: "user",
        target: { botId: "bot", groupId: undefined },
        file: { artifactId: "a", name: "spec.pdf", size: 10 },
      },
    );
    await vi.waitFor(() => expect(entries[0]?.status).toBe("ready"));
    expect(prisma.thread.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { botId: "bot", spaceId: "space" } }),
    );

    prisma.thread.findFirst.mockClear();
    indexUploadedChatFile(
      { prisma: prisma as never, artifacts, client },
      {
        spaceId: "space",
        userId: "user",
        target: { botId: "bot" },
        file: { artifactId: "p", name: "photo.png", size: 10 },
      },
    );
    expect(prisma.thread.findFirst).not.toHaveBeenCalled();
  });

  it("deletes its OpenAI copy when the chat is cleared during the upload", async () => {
    openAICompany();
    const { prisma, entries } = fakePrisma({ a: "key-a" });
    const client = fakeClient({
      uploadFile: vi.fn(async () => {
        for (const entry of entries) entry.threadId = "thread:cleared:1";
        return "file_late";
      }),
    });
    const artifacts = { get: vi.fn(async () => new Uint8Array([1])) };
    await indexChatFiles(
      { prisma: prisma as never, artifacts, client },
      { ...input, files: [file("a", "a.pdf")] },
    );
    expect(client.deleteFile).toHaveBeenCalledWith("file_late");
    expect(client.attachFile).not.toHaveBeenCalled();
  });

  it("releases its claims when the chat's store cannot be created", async () => {
    openAICompany();
    const { prisma, entries } = fakePrisma({ a: "key-a" });
    const client = fakeClient({
      createStore: vi.fn(async () => {
        throw new Error("OpenAI down");
      }),
    });
    const artifacts = { get: vi.fn(async () => new Uint8Array([1])) };
    await expect(
      indexChatFiles(
        { prisma: prisma as never, artifacts, client },
        { ...input, files: [file("a", "a.pdf"), file("x", "x.xlsx")] },
      ),
    ).rejects.toThrow("OpenAI down");
    expect(entries.map((e) => [e.artifactId, e.status])).toEqual([["x", "skipped"]]);
  });
});

describe("waiting for the first turn's files", () => {
  const entry = (artifactId: string, status: string) => ({
    id: artifactId,
    spaceId: "space",
    threadId: "thread",
    artifactId,
    openaiFileId: null,
    status,
    error: null,
    claimedAt: new Date(),
    updatedAt: new Date(),
  });

  it("returns once every file is indexed or turned away", async () => {
    const { prisma, entries } = fakePrisma();
    entries.push(entry("a", "ready"), entry("b", "indexing"));
    setTimeout(() => {
      entries[1]!.status = "failed";
    }, 15);
    const started = Date.now();
    await waitForChatFileIndex(prisma as never, "thread", ["a", "b"], {
      timeoutMs: 5_000,
      pollMs: 5,
    });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("gives up at the time limit or when the run is stopped", async () => {
    const { prisma, entries } = fakePrisma();
    entries.push(entry("a", "indexing"));
    const started = Date.now();
    await waitForChatFileIndex(prisma as never, "thread", ["a", "missing"], {
      timeoutMs: 30,
      pollMs: 5,
    });
    expect(Date.now() - started).toBeLessThan(1_000);
    const stopped = new AbortController();
    stopped.abort();
    await waitForChatFileIndex(prisma as never, "thread", ["a"], {
      timeoutMs: 60_000,
      signal: stopped.signal,
    });
  });
});

describe("searching", () => {
  it("keeps passages from files this run can see and lists the files it cannot search", async () => {
    openAICompany();
    const { prisma, entries, indexes } = fakePrisma();
    indexes.push({
      spaceId: "space",
      threadId: "thread",
      vectorStoreId: "vs_1",
      usedAt: new Date(0),
    });
    for (const [artifactId, status] of [
      ["a", "ready"],
      ["b", "indexing"],
      ["c", "skipped"],
      ["hidden", "ready"],
    ] as const) {
      entries.push({
        id: artifactId,
        spaceId: "space",
        threadId: "thread",
        artifactId,
        openaiFileId: null,
        status,
        error: status === "skipped" ? "File search does not read this type of file." : null,
        claimedAt: new Date(),
        updatedAt: new Date(),
      });
    }
    const client = fakeClient({
      search: vi.fn(async () => [
        { fileId: "f-hidden", filename: "x.pdf", score: 0.9, artifactId: "hidden", text: "secret" },
        {
          fileId: "f-a",
          filename: "spec.pdf",
          score: 0.8,
          artifactId: "a",
          text: "Fire rating 60 min",
        },
      ]),
    });
    const visible = [file("a", "spec.pdf"), file("b", "late.pdf"), file("c", "costs.xlsx")];
    const result = await searchChatFiles(
      { prisma: prisma as never, client },
      {
        threadId: "thread",
        query: "fire rating",
        files: new Map(visible.map((f) => [f.path, f])),
      },
    );
    expect(result).toEqual({
      results: [
        { path: visible[0]!.path, name: "spec.pdf", score: 0.8, text: "Fire rating 60 min" },
      ],
      notSearchable: [
        { path: visible[1]!.path, name: "late.pdf", reason: "Still being indexed." },
        {
          path: visible[2]!.path,
          name: "costs.xlsx",
          reason: "File search does not read this type of file.",
        },
      ],
    });
    expect(indexes[0]!.usedAt.getTime()).toBeGreaterThan(0);
  });

  it("forgets a store OpenAI expired so the next run rebuilds it", async () => {
    openAICompany();
    const { prisma, entries, indexes } = fakePrisma();
    indexes.push({
      spaceId: "space",
      threadId: "thread",
      vectorStoreId: "vs_old",
      usedAt: new Date(),
    });
    const { OpenAIFileSearchError } = await import("./chat-file-search.js");
    const client = fakeClient({
      search: vi.fn(async () => {
        throw new OpenAIFileSearchError("gone", 404);
      }),
    });
    const visible = file("a", "spec.pdf");
    entries.push({
      id: "e",
      spaceId: "space",
      threadId: "thread",
      artifactId: "a",
      openaiFileId: "f",
      status: "ready",
      error: null,
      claimedAt: new Date(),
      updatedAt: new Date(),
    });
    const result = await searchChatFiles(
      { prisma: prisma as never, client },
      { threadId: "thread", query: "x", files: new Map([[visible.path, visible]]) },
    );
    expect(result).toMatchObject({ error: expect.stringContaining("expired") });
    expect(indexes).toHaveLength(0);
    expect(entries).toHaveLength(0);
  });

  it("refuses while the company switch is off", async () => {
    const { prisma } = fakePrisma();
    const result = await searchChatFiles(
      { prisma: prisma as never, client: fakeClient() },
      { threadId: "thread", query: "x", files: new Map() },
    );
    expect(result).toEqual({ error: "Searching chat files is turned off." });
  });
});

describe("sweeping", () => {
  it("removes the OpenAI copies of deleted or idle chats", async () => {
    openAICompany();
    const { prisma, entries, indexes } = fakePrisma();
    indexes.push({
      spaceId: "space",
      threadId: "gone",
      vectorStoreId: "vs_gone",
      usedAt: new Date(),
    });
    entries.push({
      id: "e",
      spaceId: "space",
      threadId: "gone",
      artifactId: "a",
      openaiFileId: "file_gone",
      status: "ready",
      error: null,
      claimedAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.$queryRaw
      .mockResolvedValueOnce([{ threadId: "gone", vectorStoreId: "vs_gone" }])
      .mockResolvedValueOnce([]);
    const client = fakeClient();
    await sweepChatFileSearch(prisma as never, { client });
    expect(client.deleteFile).toHaveBeenCalledWith("file_gone");
    expect(client.deleteStore).toHaveBeenCalledWith("vs_gone");
    expect(indexes).toHaveLength(0);
    expect(entries).toHaveLength(0);
  });

  it("takes a removed file out of its chat's store", async () => {
    openAICompany();
    const { prisma } = fakePrisma();
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "e", threadId: "thread", openaiFileId: "file_removed", vectorStoreId: "vs_1" },
      ]);
    const client = fakeClient();
    await sweepChatFileSearch(prisma as never, { client });
    expect(client.deleteFile).toHaveBeenCalledWith("file_removed", "vs_1");
  });

  it("settles an abandoned claim from OpenAI's status, or releases it for another try", async () => {
    openAICompany();
    const { prisma, entries, indexes } = fakePrisma();
    indexes.push({
      spaceId: "space",
      threadId: "thread",
      vectorStoreId: "vs_1",
      usedAt: new Date(),
    });
    const old = new Date(Date.now() - 60 * 60 * 1000);
    for (const [artifactId, fileId] of [
      ["done", "file_done"],
      ["lost", "file_lost"],
    ] as const) {
      entries.push({
        id: artifactId,
        spaceId: "space",
        threadId: "thread",
        artifactId,
        openaiFileId: fileId,
        status: "indexing",
        error: null,
        claimedAt: old,
        updatedAt: old,
      });
    }
    const client = fakeClient({
      storeFileStatus: vi.fn(async (_store: string, fileId: string) => ({
        status: fileId === "file_done" ? "completed" : "failed",
      })),
    });
    await sweepChatFileSearch(prisma as never, { client });
    expect(entries.map((e) => [e.artifactId, e.status])).toEqual([["done", "ready"]]);
    expect(client.deleteFile).toHaveBeenCalledWith("file_lost", "vs_1");
  });

  it("does nothing without the company OpenAI key and runs at most every minute", async () => {
    const { prisma } = fakePrisma();
    const client = fakeClient();
    const t0 = new Date("2026-11-09T10:00:00Z");
    await sweepChatFileSearch(prisma as never, { client, now: t0 });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    openAICompany();
    await sweepChatFileSearch(prisma as never, { client, now: new Date(t0.getTime() + 30_000) });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    await sweepChatFileSearch(prisma as never, { client, now: new Date(t0.getTime() + 60_000) });
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it("settles files a restart left behind within minutes but retries failed ones every ten", async () => {
    openAICompany();
    const { prisma, entries, indexes } = fakePrisma();
    indexes.push({
      spaceId: "space",
      threadId: "thread",
      vectorStoreId: "vs_1",
      usedAt: new Date(),
    });
    const t0 = new Date();
    const client = fakeClient();
    await sweepChatFileSearch(prisma as never, { client, now: t0 });
    const row = (artifactId: string, status: string, openaiFileId: string | null, at: Date) => ({
      id: artifactId,
      spaceId: "space",
      threadId: "thread",
      artifactId,
      openaiFileId,
      status,
      error: null,
      claimedAt: at,
      updatedAt: at,
    });
    const threeMinutesAgo = new Date(t0.getTime() - 3 * 60_000);
    entries.push(
      // Handed to OpenAI before the restart: OpenAI finished it.
      row("handed", "indexing", "file_handed", threeMinutesAgo),
      // Still uploading three minutes ago: the upload may yet finish, so it is left alone.
      row("uploading", "indexing", null, threeMinutesAgo),
      row("failed", "failed", "file_failed", new Date(t0.getTime() - 2 * 24 * 60 * 60_000)),
    );
    await sweepChatFileSearch(prisma as never, { client, now: new Date(t0.getTime() + 61_000) });
    expect(entries.map((e) => [e.artifactId, e.status])).toEqual([
      ["handed", "ready"],
      ["uploading", "indexing"],
      ["failed", "failed"],
    ]);
    await sweepChatFileSearch(prisma as never, {
      client,
      now: new Date(t0.getTime() + 10 * 60_000),
    });
    expect(entries.map((e) => [e.artifactId, e.status])).toEqual([["handed", "ready"]]);
    expect(client.deleteFile).toHaveBeenCalledWith("file_failed", "vs_1");
  });
});

describe("tool selection", () => {
  const names = (options: { conversationFiles?: boolean; conversationFileSearch?: boolean }) =>
    selectBuiltinToolsForRun({
      graphicalToolsAllowed: false,
      groupId: null,
      trigger: "user",
      semanticMemoryEnabled: false,
      messagingChannelRun: false,
      ...options,
    }).map((tool) => tool.name);

  it("offers file search only once a conversation file is indexed", () => {
    expect(names({ conversationFiles: true })).not.toContain("search_conversation_files");
    expect(names({ conversationFileSearch: true })).not.toContain("search_conversation_files");
    expect(names({ conversationFiles: true, conversationFileSearch: true })).toContain(
      "search_conversation_files",
    );
  });
});
