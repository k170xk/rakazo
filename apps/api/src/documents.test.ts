import type { Actor } from "@rakazo/contracts";
import { DOCUMENT_MIME_TYPES } from "@rakazo/contracts";
import { strToU8, zipSync } from "fflate";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

vi.mock("@rakazo/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@rakazo/db")>();
  return {
    ...actual,
    runAsTenant: async <T>(_tenant: unknown, fn: () => T | PromiseLike<T>) => fn(),
    withResolvedArtifactVersion: async <T>(
      prisma: { artifact: { findFirst: (args: unknown) => Promise<Row | null> } },
      params: { name: string },
      attempt: (db: unknown, next: { rootArtifactId: string | null; version: number }) => T,
    ) => {
      const newest = await prisma.artifact.findFirst({ where: { name: params.name } });
      const next = newest
        ? { rootArtifactId: newest.rootArtifactId ?? newest.id, version: newest.version + 1 }
        : { rootArtifactId: null, version: 1 };
      return attempt(prisma, next);
    },
  };
});

import type { DocumentDeps } from "./documents.js";
import { mountDocumentVersionsRoute, officeFormatOf } from "./documents.js";

const DOCX = DOCUMENT_MIME_TYPES.docx;
const actor = { spaceId: "space-1", userId: "user-1" } as Actor;

function office(mainPart: string) {
  return zipSync({
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0"?><Types><Override PartName="/main.xml" ContentType="${mainPart}"/></Types>`,
    ),
    "main.xml": strToU8("<doc/>"),
  });
}

const docx = office(
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
);
const pptx = office(
  "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
);
const xlsx = office("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml");

describe("officeFormatOf", () => {
  it("reads the format from the zip's content types", () => {
    expect(officeFormatOf(docx)).toBe("docx");
    expect(officeFormatOf(pptx)).toBe("pptx");
    expect(officeFormatOf(xlsx)).toBe("xlsx");
  });

  it("refuses macro files, other zips and non-zips", () => {
    expect(officeFormatOf(office("application/vnd.ms-word.document.macroEnabled.main+xml"))).toBe(
      null,
    );
    expect(officeFormatOf(zipSync({ "a.txt": strToU8("hello") }))).toBe(null);
    expect(officeFormatOf(strToU8("not a zip"))).toBe(null);
  });
});

type Row = {
  id: string;
  spaceId: string;
  userId: string;
  rootArtifactId: string | null;
  botId: string | null;
  groupId: string | null;
  name: string;
  mimeType: string;
  size: number;
  version: number;
  createdAt: Date;
  source: string | null;
  storageKey?: string;
  clientNonce?: string | null;
};

type Where = {
  id?: string;
  spaceId?: string;
  userId?: string;
  name?: string;
  clientNonce?: string;
  OR?: Array<{ id?: string; rootArtifactId?: string }>;
};

function matches(row: Row, where: Where) {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.spaceId !== undefined && row.spaceId !== where.spaceId) return false;
  if (where.userId !== undefined && row.userId !== where.userId) return false;
  if (where.name !== undefined && row.name !== where.name) return false;
  if (where.clientNonce !== undefined && row.clientNonce !== where.clientNonce) return false;
  return (
    !where.OR ||
    where.OR.some(
      (or) =>
        (or.id !== undefined && row.id === or.id) ||
        (or.rootArtifactId !== undefined && row.rootArtifactId === or.rootArtifactId),
    )
  );
}

function setup(options: { maxUploadSizeBytes?: number; botId?: string | null } = {}) {
  const rows: Row[] = [
    {
      id: "v1",
      ...actor,
      rootArtifactId: null,
      botId: options.botId === undefined ? "bot-1" : options.botId,
      groupId: null,
      name: "Report.docx",
      mimeType: DOCX,
      size: 10,
      version: 1,
      createdAt: new Date(1000),
      source: "assistant",
    },
  ];
  const newestFirst = (where: Where) =>
    rows.filter((row) => matches(row, where)).sort((a, b) => b.version - a.version);
  const prisma = {
    artifact: {
      findFirst: async ({ where }: { where: Where }) => newestFirst(where)[0] ?? null,
      findMany: async ({ where }: { where: Where }) => newestFirst(where),
      create: async ({ data }: { data: Omit<Row, "id" | "createdAt"> }) => {
        const row = { ...data, id: `v${rows.length + 1}`, createdAt: new Date() } as Row;
        rows.push(row);
        return { id: row.id, version: row.version };
      },
    },
    bot: { findFirst: vi.fn(async () => ({ id: "bot-1", computer: null })) },
  };
  const artifacts = {
    put: vi.fn(async () => ({ id: "blob-1" })),
    remove: vi.fn(async () => undefined),
  };
  const deps = {
    prisma,
    artifacts,
    home: {},
    dataDir: undefined,
    sandbox: { describe: () => ({ capabilities: {} }) },
    maxUploadSizeBytes: options.maxUploadSizeBytes,
  } as unknown as DocumentDeps;
  const app = new Hono();
  mountDocumentVersionsRoute(app, deps, async (request) =>
    request.headers.get("authorization") ? actor : null,
  );
  const post = (
    query: string,
    body: Uint8Array = docx,
    headers: Record<string, string> = { authorization: "yes", "content-type": DOCX },
    rootId = "v1",
  ) =>
    app.request(`/api/v1/documents/${rootId}/versions?${query}`, {
      method: "POST",
      headers,
      body: new Blob([body as Uint8Array<ArrayBuffer>]),
    });
  const upload = (
    query: string,
    body: Uint8Array = docx,
    headers: Record<string, string> = { authorization: "yes", "content-type": DOCX },
  ) =>
    app.request(`/api/v1/documents?${query}`, {
      method: "POST",
      headers,
      body: new Blob([body as Uint8Array<ArrayBuffer>]),
    });
  return { rows, artifacts, post, upload, prisma };
}

describe("POST /api/v1/documents", () => {
  it("starts a new document from the file, taking the next free name", async () => {
    const { rows, upload } = setup();
    const response = await upload("format=docx&name=Report.docx");
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ rootArtifactId: "v2", artifactId: "v2", version: 1 });
    expect(rows[1]).toMatchObject({
      name: "Report (2).docx",
      botId: "bot-1",
      version: 1,
      source: "studio",
      storageKey: "blob-1",
    });
  });

  it("strips folders and control characters from the name", async () => {
    const { rows, upload } = setup();
    const response = await upload(
      `format=docx&name=${encodeURIComponent("C:\\fake\\Plan\u0007 v2.DOCX")}`,
    );
    expect(response.status).toBe(201);
    expect(rows[1]?.name).toBe("Plan v2.docx");
  });

  it("joins the agent asked for", async () => {
    const { upload, prisma } = setup();
    await upload("format=docx&name=A.docx&botId=bot-9");
    expect(prisma.bot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "bot-9" }) }),
    );
  });

  it("keeps the asked-for agent when it has a folder, else looks for the first agent with one", async () => {
    const { upload, prisma } = setup();
    const computer = { id: "c1", scope: "bot", homeKey: "h", homeBytesAt: null };
    prisma.bot.findFirst.mockImplementation((async ({ where }: { where: { id?: string } }) =>
      where.id === "bot-9" ? { id: "bot-9", computer } : { id: "bot-1", computer: null }) as never);
    const looked = () => (prisma.bot.findFirst.mock.calls as unknown[][]).map(([query]) => query);
    await Promise.resolve(upload("format=docx&name=A.docx&botId=bot-9")).catch(() => undefined);
    expect(looked()).toEqual([
      expect.objectContaining({ where: expect.objectContaining({ id: "bot-9" }) }),
    ]);
    prisma.bot.findFirst.mockClear();
    await upload("format=docx&name=B.docx&botId=bot-bare");
    expect(looked()).toEqual([
      expect.objectContaining({ where: expect.objectContaining({ id: "bot-bare" }) }),
      expect.objectContaining({
        where: expect.objectContaining({ computerId: { not: null } }),
      }),
    ]);
  });

  it("refuses sign-in, query, type, size and format problems", async () => {
    const largest = Math.max(docx.byteLength, pptx.byteLength, xlsx.byteLength);
    const { upload, rows } = setup({ maxUploadSizeBytes: largest + 200 });
    expect((await upload("format=docx&name=a", docx, { "content-type": DOCX })).status).toBe(401);
    expect((await upload("name=a")).status).toBe(400);
    expect(
      (
        await upload("format=docx&name=a", docx, {
          authorization: "yes",
          "content-type": "text/plain",
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await upload("format=docx&name=a", strToU8("not a zip"), {
          authorization: "yes",
          "content-type": DOCX,
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await upload("format=xlsx&name=a", pptx, {
          authorization: "yes",
          "content-type": DOCUMENT_MIME_TYPES.xlsx,
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await upload(
          "format=docx&name=a",
          office("application/vnd.ms-word.document.macroEnabled.main+xml"),
        )
      ).status,
    ).toBe(415);
    expect((await upload("format=docx&name=a", new Uint8Array(largest + 500))).status).toBe(413);
    expect(rows).toHaveLength(1);
  });

  it("takes a deck with pictures up to the upload limit and names the limit when over it", async () => {
    const PPTX = DOCUMENT_MIME_TYPES.pptx;
    const deck = zipSync(
      {
        "[Content_Types].xml": strToU8(
          `<?xml version="1.0"?><Types><Override PartName="/main.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`,
        ),
        "main.xml": strToU8("<doc/>"),
        "media/image1.png": new Uint8Array(20 * 1024 * 1024).fill(7),
      },
      { level: 0 },
    );
    const headers = { authorization: "yes", "content-type": PPTX };

    const roomy = setup({ maxUploadSizeBytes: 50 * 1024 * 1024 });
    expect((await roomy.upload("format=pptx&name=deck.pptx", deck, headers)).status).toBe(201);

    const tight = setup();
    const refused = await tight.upload("format=pptx&name=deck.pptx", deck, headers);
    expect(refused.status).toBe(413);
    expect(await refused.json()).toEqual({
      error: "This file is too large. Upload limit: 10 MiB per file.",
      code: "PAYLOAD_TOO_LARGE",
      maxBytes: 10 * 1024 * 1024,
    });
  });
});

describe("POST /api/v1/documents/:rootId/versions", () => {
  it("saves the edit as the next version under the same name, made in the studio", async () => {
    const { rows, post } = setup();
    const response = await post("format=docx&baseVersion=1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ artifactId: "v2", version: 2 });
    expect(rows[1]).toMatchObject({
      name: "Report.docx",
      rootArtifactId: "v1",
      botId: "bot-1",
      version: 2,
      source: "studio",
      storageKey: "blob-1",
    });
  });

  it("refuses a save made from an older version, naming the newest", async () => {
    const { post, artifacts } = setup();
    expect((await post("format=docx&baseVersion=1")).status).toBe(200);
    const stale = await post("format=docx&baseVersion=1");
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: "CONFLICT",
      latestVersion: 2,
      artifactId: "v2",
    });
    expect(artifacts.put).toHaveBeenCalledTimes(1);
  });

  it("returns the same version when a save is retried with its nonce", async () => {
    const { rows, post } = setup();
    const first = await post("format=docx&baseVersion=1&clientNonce=n1");
    const again = await post("format=docx&baseVersion=1&clientNonce=n1");
    expect(await again.json()).toEqual(await first.json());
    expect(rows).toHaveLength(2);
  });

  it("refuses a missing sign-in, bad query, wrong type, oversize and unknown file", async () => {
    const { post } = setup({ maxUploadSizeBytes: docx.byteLength - 1 });
    expect((await post("format=docx&baseVersion=1", docx, { "content-type": DOCX })).status).toBe(
      401,
    );
    expect((await post("format=docx")).status).toBe(400);
    expect((await post("format=pdf&baseVersion=1")).status).toBe(400);
    expect(
      (
        await post("format=docx&baseVersion=1", docx, {
          authorization: "yes",
          "content-type": "application/x-www-form-urlencoded",
        })
      ).status,
    ).toBe(415);
    expect((await post("format=docx&baseVersion=1")).status).toBe(413);
  });

  it("refuses bytes that are not the document's format and files it cannot find", async () => {
    const { post } = setup();
    expect(
      (
        await post("format=docx&baseVersion=1", strToU8("hello"), {
          authorization: "yes",
          "content-type": DOCX,
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await post("format=pptx&baseVersion=1", pptx, {
          authorization: "yes",
          "content-type": DOCUMENT_MIME_TYPES.pptx,
        })
      ).status,
    ).toBe(415);
    const missing = await post("format=docx&baseVersion=1", docx, undefined, "someone-elses");
    expect(missing.status).toBe(404);
  });

  it("refuses a file whose agent was deleted", async () => {
    const { post } = setup({ botId: null });
    const response = await post("format=docx&baseVersion=1");
    expect(response.status).toBe(410);
  });
});
