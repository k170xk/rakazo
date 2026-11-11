import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  ARTIFACT_DOWNLOAD_PATH,
  artifactContentDisposition,
  mountArtifactDownloadRoute,
} from "./artifact-download.js";

describe("artifactContentDisposition", () => {
  it("keeps a plain PowerPoint name and encodes non-ASCII", () => {
    expect(artifactContentDisposition("deck.pptx")).toBe(
      `attachment; filename="deck.pptx"; filename*=UTF-8''deck.pptx`,
    );
    expect(artifactContentDisposition('BIM "Q1".pptx')).toContain('filename="BIM _Q1_.pptx"');
    expect(artifactContentDisposition("Présentation.pptx")).toContain(
      "filename*=UTF-8''Pr%C3%A9sentation.pptx",
    );
  });
});

describe("GET /api/artifacts/download", () => {
  function mount(options: {
    grant?: { spaceId: string; userId: string; artifactId: string } | null;
    row?: {
      id: string;
      spaceId: string;
      userId: string;
      botId: string | null;
      groupId: string | null;
      storageKey: string;
      name: string;
      mimeType: string;
    } | null;
    bytes?: Uint8Array;
  }) {
    const consumeArtifactDownloadToken = vi.fn(async () => options.grant ?? null);
    const findFirst = vi.fn(async () => options.row ?? null);
    const get = vi.fn(async () => options.bytes ?? new Uint8Array([1, 2, 3]));
    const app = new Hono();
    mountArtifactDownloadRoute(app, {
      auth: { consumeArtifactDownloadToken },
      prisma: { artifact: { findFirst } } as never,
      artifacts: { get } as never,
    });
    return { app, consumeArtifactDownloadToken, findFirst, get };
  }

  it("streams the file bytes with a download disposition", async () => {
    const bytes = new Uint8Array([80, 75, 3, 4]);
    const { app, get } = mount({
      grant: { spaceId: "space-1", userId: "user-1", artifactId: "art-1" },
      row: {
        id: "art-1",
        spaceId: "space-1",
        userId: "user-1",
        botId: "bot-1",
        groupId: null,
        storageKey: "key-1",
        name: "OCSC BIM.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      },
      bytes,
    });
    const response = await app.request(`${ARTIFACT_DOWNLOAD_PATH}?token=fresh`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("presentationml.presentation");
    expect(response.headers.get("content-disposition")).toContain("OCSC%20BIM.pptx");
    expect(response.headers.get("content-length")).toBe("4");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(get).toHaveBeenCalledOnce();
  });

  it("refuses a spent or missing token without reading storage", async () => {
    const { app, findFirst, get } = mount({ grant: null });
    const response = await app.request(`${ARTIFACT_DOWNLOAD_PATH}?token=used`);
    expect(response.status).toBe(410);
    expect(findFirst).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});
