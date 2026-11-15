/** Bytes received while a studio file downloads. */
export type DownloadProgress = {
  received: number;
  /** From Content-Length when the server sends it; null on chunked replies. */
  total: number | null;
};

/** What the Word / PowerPoint / Excel studio shows while a file opens. */
export type DocumentLoadState =
  | { status: "idle" }
  | {
      status: "loading";
      phase: "fetching" | "opening";
      received: number;
      total: number | null;
      attempt: number;
      attempts: number;
    }
  | {
      status: "error";
      reason: DocumentLoadErrorReason;
      attempt: number;
      attempts: number;
    };

export type DocumentLoadErrorReason =
  | "network"
  | "stalled"
  | "truncated"
  | "aborted"
  | "open"
  | "unknown";

/** How many times a slow or failed download is retried with a fresh token. */
export const DOCUMENT_LOAD_ATTEMPTS = 3;

/**
 * Abort a download that has received no new bytes for this long. Large Office files on a weak
 * mobile link still make progress; a true stall does not.
 */
export const DOCUMENT_DOWNLOAD_STALL_MS = 45_000;

/** A short pause between retries so a flaky radio can recover. */
export const DOCUMENT_LOAD_RETRY_PAUSE_MS = 800;

export function documentLoadErrorReason(error: unknown): DocumentLoadErrorReason {
  if (error instanceof DOMException && error.name === "AbortError") return "aborted";
  const message = error instanceof Error ? error.message : String(error);
  if (/truncated/i.test(message)) return "truncated";
  if (/stall/i.test(message)) return "stalled";
  if (/Download returned|Failed to fetch|NetworkError|Load failed|ECONN|ETIMEDOUT/i.test(message)) {
    return "network";
  }
  return "unknown";
}

/** Compact size for the loading pill (e.g. 1.2 MB). */
export function formatLoadBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function loadPercent(received: number, total: number | null): number | null {
  if (total === null || total <= 0) return null;
  return Math.min(100, Math.round((received / total) * 100));
}
