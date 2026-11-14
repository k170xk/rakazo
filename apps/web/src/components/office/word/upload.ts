import type { DocumentFormat } from "@rakazo/contracts";
import { DOCUMENT_MIME_TYPES, documentVersionsPath } from "@rakazo/contracts";
import { withSpaceHeaders } from "../../../lib/rpc";
import type { SaveResult } from "./save-queue";
import { readSaveResponse } from "./save-queue";

/** Saves `bytes` as the family's next version; throws only when the server could not be reached. */
export async function uploadDocumentVersion(input: {
  rootArtifactId: string;
  format: DocumentFormat;
  bytes: Uint8Array;
  baseVersion: number;
  clientNonce: string;
  spaceId: string | null;
}): Promise<SaveResult> {
  const mimeType = DOCUMENT_MIME_TYPES[input.format];
  const query = new URLSearchParams({
    format: input.format,
    baseVersion: String(input.baseVersion),
    clientNonce: input.clientNonce,
  });
  const response = await fetch(`${documentVersionsPath(input.rootArtifactId)}?${query}`, {
    method: "POST",
    credentials: "include",
    headers: withSpaceHeaders({ "content-type": mimeType }, input.spaceId),
    body: new Blob([new Uint8Array(input.bytes)], { type: mimeType }),
  });
  const body: unknown = await response.json().catch(() => null);
  return readSaveResponse(response.status, body);
}

/** The file behind a one-time download link from `documents.get` or `artifacts.downloadToken`. */
export async function fetchDownload(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { credentials: "include", signal });
  if (!response.ok) throw new Error(`Download returned ${response.status}`);
  return response.arrayBuffer();
}

export function downloadTokenUrl(token: string): string {
  return `/api/artifacts/download?token=${encodeURIComponent(token)}`;
}
