import { IsolationError } from "@rakazo/db";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

vi.mock("@rakazo/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@rakazo/db")>();
  return {
    ...actual,
    runAsTenant: async <T>(_tenant: unknown, fn: () => T | PromiseLike<T>) => fn(),
  };
});

import { DRAFT_DOWNLOAD_PREFIX, mountArtifactDownloadRoute } from "./artifact-download.js";
import { documentRevisionWithDraft } from "./documents.js";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const owner = { spaceId: "space-1", userId: "user-1" };
const stranger = { spaceId: "space-1", userId: "user-2" };

type ArtifactRow = { id: string; rootArtifactId: string | null; version: number; userId: string };
type DraftRow = {
  id: string;
  spaceId: string;
  userId: string;
  rootArtifactId: string;
  storageKey: string;
  baseVersion: number;
  botId: string | null;
  updatedAt: Date;
};

type Where = Record<string, unknown> & { OR?: Array<Record<string, unknown>> };

function fits(row: Record<string, unknown>, where: Where): boolean {
  const { OR, ...rest } = where;
  if (OR && !OR.some((or) => fits(row, or))) return false;
  return Object.entries(rest).every(([key, value]) => key === "spaceId" || row[key] === value);
}

function setup(artifacts: ArtifactRow[], drafts: DraftRow[]) {
  const remove = vi.fn(async () => undefined);
  const issueArtifactDownloadToken = vi.fn(async () => "token-1");
  const prisma = {
    artifact: {
      findFirst: async ({ where }: { where: Where }) =>
        artifacts.filter((row) => fits(row, where)).sort((a, b) => b.version - a.version)[0] ??
        null,
    },
    documentDraft: {
      findFirst: async ({ where }: { where: Where }) => {
        const draft = drafts.find((row) => fits(row, where));
        return draft ? { ...draft, rootArtifact: { name: "Report.docx", mimeType: DOCX } } : null;
      },
      deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
        const at = drafts.findIndex((row) => row.id === where.id);
        if (at >= 0) drafts.splice(at, 1);
        return { count: at >= 0 ? 1 : 0 };
      }),
    },
  };
  const deps = {
    prisma: prisma as never,
    artifacts: { remove, get: vi.fn(async () => new Uint8Array([7, 7])) } as never,
    auth: { issueArtifactDownloadToken },
  };
  return { deps, prisma, remove, issueArtifactDownloadToken };
}

const family: ArtifactRow[] = [
  { id: "v1", rootArtifactId: null, version: 1, userId: "user-1" },
  { id: "v2", rootArtifactId: "v1", version: 2, userId: "user-1" },
];
const at = new Date("2026-11-14T12:00:00.000Z");
const draft = (extra: Partial<DraftRow> = {}): DraftRow => ({
  id: "d1",
  ...owner,
  rootArtifactId: "v1",
  storageKey: "blob-1",
  baseVersion: 2,
  botId: "bot-1",
  updatedAt: at,
  ...extra,
});

describe("documentRevisionWithDraft", () => {
  it("gives the owner a token for a draft newer than every version", async () => {
    const { deps, issueArtifactDownloadToken } = setup(family, [draft()]);
    expect(await documentRevisionWithDraft(deps, owner, { rootArtifactId: "v2" })).toEqual({
      artifactId: "v2",
      version: 2,
      draft: { updatedAt: at.toISOString(), baseVersion: 2, downloadToken: "token-1" },
    });
    expect(issueArtifactDownloadToken).toHaveBeenCalledWith({
      ...owner,
      artifactId: `${DRAFT_DOWNLOAD_PREFIX}d1`,
    });
  });

  it("leaves the token out for a draft the studio already loaded", async () => {
    const { deps, issueArtifactDownloadToken } = setup(family, [draft()]);
    const revision = await documentRevisionWithDraft(deps, owner, {
      rootArtifactId: "v1",
      draftSeen: at.toISOString(),
    });
    expect(revision.draft).toEqual({ updatedAt: at.toISOString(), baseVersion: 2 });
    expect(issueArtifactDownloadToken).not.toHaveBeenCalled();
  });

  it("hides and clears a draft once a newer version exists", async () => {
    const drafts = [draft({ baseVersion: 1 })];
    const { deps, remove } = setup(family, drafts);
    const revision = await documentRevisionWithDraft(deps, owner, { rootArtifactId: "v1" });
    expect(revision).toEqual({ artifactId: "v2", version: 2 });
    expect(drafts).toHaveLength(0);
    expect(remove).toHaveBeenCalledWith("blob-1", expect.objectContaining(owner));
  });

  it("shows nobody else the owner's file or draft", async () => {
    const { deps, issueArtifactDownloadToken } = setup(family, [draft()]);
    await expect(
      documentRevisionWithDraft(deps, stranger, { rootArtifactId: "v1" }),
    ).rejects.toBeInstanceOf(IsolationError);
    const theirs = setup(
      [...family, { id: "w1", rootArtifactId: null, version: 1, userId: "user-2" }],
      [draft({ rootArtifactId: "w1" })],
    );
    expect(
      (await documentRevisionWithDraft(theirs.deps, stranger, { rootArtifactId: "w1" })).draft,
    ).toBeUndefined();
    expect(issueArtifactDownloadToken).not.toHaveBeenCalled();
  });
});

describe("GET /api/artifacts/download with a draft grant", () => {
  function app(grant: { spaceId: string; userId: string; artifactId: string }) {
    const { prisma, deps } = setup(family, [draft()]);
    const hono = new Hono();
    mountArtifactDownloadRoute(hono, {
      prisma: prisma as never,
      artifacts: deps.artifacts,
      auth: { consumeArtifactDownloadToken: async () => grant },
    });
    return hono;
  }

  it("serves the draft to its owner under the file's name", async () => {
    const response = await app({ ...owner, artifactId: "draft:d1" }).request(
      "/api/artifacts/download?token=t",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(DOCX);
    expect(response.headers.get("content-disposition")).toContain("Report.docx");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([7, 7]));
  });

  it("finds no draft for anyone else", async () => {
    const response = await app({ ...stranger, artifactId: "draft:d1" }).request(
      "/api/artifacts/download?token=t",
    );
    expect(response.status).toBe(404);
  });
});
