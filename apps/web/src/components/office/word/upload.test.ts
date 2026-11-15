import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDownload, fetchLatestDocumentBytes } from "./upload";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function streamOf(chunks: Uint8Array[], headers?: HeadersInit): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers });
}

describe("fetchDownload", () => {
  it("reports progress while streaming and refuses a truncated body", async () => {
    const progress: Array<{ received: number; total: number | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamOf([new Uint8Array([1, 2, 3])], { "content-length": "10" }),
      ),
    );
    await expect(
      fetchDownload("/api/artifacts/download?token=t", {
        onProgress: (p) => progress.push({ ...p }),
      }),
    ).rejects.toThrow(/truncated/);
    expect(progress.some((p) => p.received === 3 && p.total === 10)).toBe(true);
  });

  it("aborts when no bytes arrive before the stall timeout", async () => {
    vi.useFakeTimers();
    const stream = new ReadableStream<Uint8Array>({
      start() {
        // Never enqueue — simulates a hung mobile link.
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream, { status: 200, headers: { "content-length": "100" } })),
    );
    const pending = fetchDownload("/api/artifacts/download?token=t", { stallMs: 1_000 });
    const expectation = expect(pending).rejects.toThrow(/stalled/);
    await vi.advanceTimersByTimeAsync(1_050);
    await expectation;
  });
});

describe("fetchLatestDocumentBytes", () => {
  it("retries with a fresh token when the first download fails", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ latest: { downloadToken: "t1" } })
      .mockResolvedValueOnce({ latest: { downloadToken: "t2" } });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("gone", { status: 410 }))
        .mockResolvedValueOnce(
          streamOf([new Uint8Array([9, 9])], { "content-length": "2" }),
        ),
    );
    const { detail, bytes } = await fetchLatestDocumentBytes(get, {
      attempts: 2,
      pauseMs: 0,
    });
    expect(detail.latest.downloadToken).toBe("t2");
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([9, 9]));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("stops when the caller aborts between retries", async () => {
    const controller = new AbortController();
    const get = vi.fn().mockResolvedValue({ latest: { downloadToken: "t1" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("gone", { status: 410 })));
    const pending = fetchLatestDocumentBytes(get, {
      signal: controller.signal,
      attempts: 3,
      pauseMs: 50,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
