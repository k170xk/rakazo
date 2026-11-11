import type { ArtifactStore } from "@rakazo/adapter-kit";
import { createAdapterContext } from "@rakazo/adapter-kit";
import type { Auth } from "@rakazo/auth";
import { artifactDownloadFileName } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { runAsTenant } from "@rakazo/db";
import type { Hono } from "hono";

/** Path the browser opens after `artifacts.downloadToken`; the token is the only credential. */
export const ARTIFACT_DOWNLOAD_PATH = "/api/artifacts/download";

/**
 * RFC 5987 disposition so names with spaces and non-ASCII stay intact.
 * `filename=` must be ASCII (HTTP header ByteString); `filename*` carries the real UTF-8 name.
 */
export function artifactContentDisposition(name: string): string {
  const cleaned = name.replace(/[\r\n"]/g, "_").trim() || "download";
  const fallback = cleaned.replace(/[^\x20-\x7E]/g, "_") || "download";
  const encoded = encodeURIComponent(cleaned).replace(/['()]/g, escape).replace(/\*/g, "%2A");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * `GET /api/artifacts/download?token=`: a plain navigation, so the browser or Electron saves the
 * file itself as a PowerPoint (or whatever it is), without putting base64 through the chat UI.
 */
export function mountArtifactDownloadRoute(
  app: Hono,
  deps: {
    prisma: PrismaClient;
    artifacts: ArtifactStore;
    auth: Pick<Auth, "consumeArtifactDownloadToken">;
  },
): void {
  app.get(ARTIFACT_DOWNLOAD_PATH, async (c) => {
    const grant = await deps.auth.consumeArtifactDownloadToken(c.req.query("token") ?? "");
    if (!grant) {
      return c.text("Download link expired", 410, { "cache-control": "no-store" });
    }
    const tenant = { spaceId: grant.spaceId, userId: grant.userId };
    // The token is the credential; read as that person so row-level security allows the file.
    const payload = await runAsTenant(tenant, async () => {
      const row = await deps.prisma.artifact.findFirst({
        where: {
          id: grant.artifactId,
          spaceId: grant.spaceId,
          userId: grant.userId,
        },
      });
      if (!row) return null;
      const contextBotId = row.botId ?? row.groupId ?? row.id;
      const bytes = await deps.artifacts.get(
        row.storageKey,
        createAdapterContext(tenant, contextBotId, `artifact-download:${row.id}`),
      );
      return { row, bytes };
    });
    if (!payload) {
      return c.text("File not found", 404, { "cache-control": "no-store" });
    }
    const fileName = artifactDownloadFileName(
      payload.row.name,
      payload.row.mimeType || "application/octet-stream",
    );
    return new Response(Uint8Array.from(payload.bytes), {
      headers: {
        "content-type": payload.row.mimeType || "application/octet-stream",
        "content-length": String(payload.bytes.byteLength),
        "content-disposition": artifactContentDisposition(fileName),
        "cache-control": "no-store",
      },
    });
  });
}
