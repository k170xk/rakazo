import type { ArtifactStore } from "@rakazo/adapter-kit";
import { createAdapterContext } from "@rakazo/adapter-kit";
import type { Auth } from "@rakazo/auth";
import type { PrismaClient } from "@rakazo/db";
import type { Hono } from "hono";

/** Path the browser opens after `artifacts.downloadToken`; the token is the only credential. */
export const ARTIFACT_DOWNLOAD_PATH = "/api/artifacts/download";

/** RFC 5987 disposition so names with spaces and non-ASCII stay intact. */
export function artifactContentDisposition(name: string): string {
  const fallback = name.replace(/[\r\n"]/g, "_") || "download";
  const encoded = encodeURIComponent(name).replace(/['()]/g, escape).replace(/\*/g, "%2A");
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
    const row = await deps.prisma.artifact.findFirst({
      where: {
        id: grant.artifactId,
        spaceId: grant.spaceId,
        userId: grant.userId,
      },
    });
    if (!row) {
      return c.text("File not found", 404, { "cache-control": "no-store" });
    }
    const actor = { spaceId: grant.spaceId, userId: grant.userId };
    const contextBotId = row.botId ?? row.groupId ?? row.id;
    const bytes = await deps.artifacts.get(
      row.storageKey,
      createAdapterContext(actor, contextBotId, `artifact-download:${row.id}`),
    );
    return new Response(Uint8Array.from(bytes), {
      headers: {
        "content-type": row.mimeType || "application/octet-stream",
        "content-length": String(bytes.byteLength),
        "content-disposition": artifactContentDisposition(row.name),
        "cache-control": "no-store",
      },
    });
  });
}
