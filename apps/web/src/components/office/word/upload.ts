import type { DocumentFormat } from "@rakazo/contracts";
import { DOCUMENT_MIME_TYPES, documentVersionsPath } from "@rakazo/contracts";
import { withSpaceHeaders } from "../../../lib/rpc";
import {
  DOCUMENT_DOWNLOAD_STALL_MS,
  DOCUMENT_LOAD_ATTEMPTS,
  DOCUMENT_LOAD_RETRY_PAUSE_MS,
  type DownloadProgress,
  documentLoadErrorReason,
} from "../document-load";
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

export type FetchDownloadOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
  /** Abort when no new bytes arrive for this long. */
  stallMs?: number;
};

/**
 * The file behind a one-time download link. Streams the body so slow mobile links report progress
 * and a stalled transfer can be aborted and retried instead of hanging forever.
 */
export async function fetchDownload(
  url: string,
  options: FetchDownloadOptions = {},
): Promise<ArrayBuffer> {
  const response = await fetch(url, { credentials: "include", signal: options.signal });
  if (!response.ok) throw new Error(`Download returned ${response.status}`);
  const totalHeader = Number(response.headers.get("content-length") ?? NaN);
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null;
  const stallMs = options.stallMs ?? DOCUMENT_DOWNLOAD_STALL_MS;

  if (!response.body) {
    const bytes = await response.arrayBuffer();
    options.onProgress?.({ received: bytes.byteLength, total });
    if (total !== null && bytes.byteLength !== total) {
      throw new Error(`Download truncated (${bytes.byteLength} of ${total} bytes)`);
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastProgressAt = Date.now();
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  options.onProgress?.({ received: 0, total });

  const armStall = () =>
    new Promise<"stall">((resolve) => {
      clearTimeout(stallTimer);
      const wait = Math.max(0, stallMs - (Date.now() - lastProgressAt));
      stallTimer = setTimeout(() => resolve("stall"), wait);
    });

  try {
    for (;;) {
      if (options.signal?.aborted) {
        throw new DOMException("The download was aborted.", "AbortError");
      }
      const result = await Promise.race([reader.read(), armStall()]);
      if (result === "stall") {
        throw new Error(`Download stalled after ${received} bytes`);
      }
      const { done, value } = result;
      if (done) break;
      if (value && value.byteLength > 0) {
        chunks.push(value);
        received += value.byteLength;
        lastProgressAt = Date.now();
        options.onProgress?.({ received, total });
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(stallTimer);
  }

  const bytes = concatChunks(chunks, received);
  if (total !== null && bytes.byteLength !== total) {
    throw new Error(`Download truncated (${bytes.byteLength} of ${total} bytes)`);
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function downloadTokenUrl(token: string): string {
  return `/api/artifacts/download?token=${encodeURIComponent(token)}`;
}

export type FetchLatestDocumentOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress & { attempt: number; attempts: number }) => void;
  attempts?: number;
  stallMs?: number;
  pauseMs?: number;
};

/**
 * Loads the newest bytes for a family. Issues a fresh download token on every attempt so a slow
 * mobile link can recover after a stall, truncated body, or expired one-time token.
 */
export async function fetchLatestDocumentBytes<T extends { latest: { downloadToken: string } }>(
  get: () => Promise<T>,
  options: FetchLatestDocumentOptions = {},
): Promise<{ detail: T; bytes: ArrayBuffer }> {
  const attempts = options.attempts ?? DOCUMENT_LOAD_ATTEMPTS;
  const pauseMs = options.pauseMs ?? DOCUMENT_LOAD_RETRY_PAUSE_MS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.signal?.aborted) throw new DOMException("The download was aborted.", "AbortError");
    try {
      const detail = await get();
      const bytes = await fetchDownload(downloadTokenUrl(detail.latest.downloadToken), {
        signal: options.signal,
        stallMs: options.stallMs,
        onProgress: (progress) => options.onProgress?.({ ...progress, attempt, attempts }),
      });
      return { detail, bytes };
    } catch (error) {
      lastError = error;
      const reason = documentLoadErrorReason(error);
      if (reason === "aborted" || attempt >= attempts) throw error;
      await wait(pauseMs * attempt, options.signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Download failed");
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The download was aborted.", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("The download was aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
