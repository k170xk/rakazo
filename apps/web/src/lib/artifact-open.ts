import { artifactDownloadFileName } from "@rakazo/core";
import { rpc, rpcForSpace } from "./rpc";

/** `spaceId` is set when the group lives in another person's Space that you were added to. */
export type ArtifactTarget = { botId: string } | { groupId: string; spaceId?: string };

/** The client that reads a target's artifacts, in the Space it belongs to. */
export function artifactClient(target: ArtifactTarget) {
  return "spaceId" in target && target.spaceId ? rpcForSpace(target.spaceId) : rpc;
}

function artifactInput(target: ArtifactTarget) {
  return "botId" in target ? { botId: target.botId } : { groupId: target.groupId };
}

export function decodeArtifactBase64(contentBase64: string): Uint8Array {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function fetchArtifactBytes(
  target: ArtifactTarget,
  artifactId: string,
): Promise<Uint8Array> {
  const artifact = await artifactClient(target).artifacts.get({
    ...artifactInput(target),
    artifactId,
  });
  return decodeArtifactBase64(artifact.contentBase64);
}

export function downloadArtifactBytes(name: string, mimeType: string, bytes: Uint8Array): void {
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifactDownloadFileName(name, mimeType);
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Ask the server for a one-time download link, then let the browser save the file natively.
 * Large PowerPoints and videos never pass through base64 on the UI thread.
 */
export async function downloadArtifact(
  target: ArtifactTarget,
  artifactId: string,
  name?: string,
  mimeType?: string,
): Promise<void> {
  const { url } = await artifactClient(target).artifacts.downloadToken({
    ...artifactInput(target),
    artifactId,
  });
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  // Same-origin downloads honour this; Content-Disposition on the GET is the source of truth.
  if (name && mimeType) anchor.download = artifactDownloadFileName(name, mimeType);
  anchor.click();
}

/** Same native download when the page only has an artifact id (Artifacts library). */
export async function downloadArtifactById(artifactId: string): Promise<void> {
  const { url } = await rpc.artifacts.downloadToken({ artifactId });
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  anchor.click();
}
