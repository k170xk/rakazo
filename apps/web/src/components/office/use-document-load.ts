import { useCallback, useEffect, useRef, useState } from "react";
import {
  DOCUMENT_LOAD_ATTEMPTS,
  type DocumentLoadState,
  documentLoadErrorReason,
} from "./document-load";
import { fetchLatestDocumentBytes } from "./word/upload";

/**
 * Shared open path for Word, PowerPoint and Excel: cancel in-flight downloads when switching,
 * report progress on slow links, and retry with a fresh token after stalls or drops.
 */
export function useDocumentLoad<T extends { latest: { downloadToken: string }; format: string }>(
  expectedFormat: string,
  get: () => Promise<T>,
) {
  const [loadState, setLoadState] = useState<DocumentLoadState>({ status: "idle" });
  const seq = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const getRef = useRef(get);
  getRef.current = get;

  const cancel = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
  }, []);

  useEffect(() => () => cancel(), [cancel]);

  const loadBytes = useCallback(async (): Promise<{
    detail: T;
    bytes: ArrayBuffer;
    turn: number;
  } | null> => {
    const turn = ++seq.current;
    cancel();
    const controller = new AbortController();
    abort.current = controller;
    setLoadState({
      status: "loading",
      phase: "fetching",
      received: 0,
      total: null,
      attempt: 1,
      attempts: DOCUMENT_LOAD_ATTEMPTS,
    });
    try {
      const result = await fetchLatestDocumentBytes(() => getRef.current(), {
        signal: controller.signal,
        onProgress: (progress) => {
          if (turn !== seq.current) return;
          setLoadState({
            status: "loading",
            phase: "fetching",
            received: progress.received,
            total: progress.total,
            attempt: progress.attempt,
            attempts: progress.attempts,
          });
        },
      });
      if (turn !== seq.current) return null;
      if (result.detail.format !== expectedFormat) {
        setLoadState({ status: "idle" });
        return null;
      }
      setLoadState((prev) =>
        prev.status === "loading"
          ? { ...prev, phase: "opening" }
          : {
              status: "loading",
              phase: "opening",
              received: result.bytes.byteLength,
              total: result.bytes.byteLength,
              attempt: 1,
              attempts: DOCUMENT_LOAD_ATTEMPTS,
            },
      );
      return { ...result, turn };
    } catch (error) {
      if (turn !== seq.current) return null;
      const reason = documentLoadErrorReason(error);
      if (reason === "aborted") {
        setLoadState({ status: "idle" });
        return null;
      }
      setLoadState({
        status: "error",
        reason,
        attempt: DOCUMENT_LOAD_ATTEMPTS,
        attempts: DOCUMENT_LOAD_ATTEMPTS,
      });
      return null;
    }
  }, [cancel, expectedFormat]);

  const stillCurrent = useCallback((turn: number) => turn === seq.current, []);

  const markReady = useCallback((turn: number) => {
    if (turn !== seq.current) return;
    setLoadState({ status: "idle" });
  }, []);

  const markOpenFailed = useCallback((turn: number) => {
    if (turn !== seq.current) return;
    setLoadState({
      status: "error",
      reason: "open",
      attempt: DOCUMENT_LOAD_ATTEMPTS,
      attempts: DOCUMENT_LOAD_ATTEMPTS,
    });
  }, []);

  return {
    loadState,
    loadBytes,
    stillCurrent,
    markReady,
    markOpenFailed,
    cancel,
  };
}
