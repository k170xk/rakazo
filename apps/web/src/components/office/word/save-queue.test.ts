import { describe, expect, it, vi } from "vitest";
import type { SaveResult } from "./save-queue";
import { createSaveQueue, readSaveResponse } from "./save-queue";

function manualTimers() {
  const pending = new Map<number, { run: () => void; ms: number }>();
  let next = 0;
  return {
    timers: {
      set: (run: () => void, ms: number) => {
        next += 1;
        pending.set(next, { run, ms });
        return next;
      },
      clear: (handle: unknown) => {
        pending.delete(handle as number);
      },
    },
    pending: () => [...pending.values()].map((entry) => entry.ms),
    /** Runs every timer due now and waits for the saves they start. */
    async fire() {
      const due = [...pending.entries()];
      pending.clear();
      for (const [, entry] of due) entry.run();
      await settle();
    },
  };
}

async function settle() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function setup(results: Array<SaveResult | Error> = [], check?: () => Promise<string | null>) {
  const clock = manualTimers();
  let nonce = 0;
  const uploads: Array<{ baseVersion: number; clientNonce: string; bytes: Uint8Array }> = [];
  const serialize = vi.fn(async () => new Uint8Array([uploads.length + 1]));
  const onSaved = vi.fn();
  const onConflict = vi.fn();
  let version = 3;
  const queue = createSaveQueue({
    baseVersion: 3,
    serialize,
    check,
    timers: clock.timers,
    newNonce: () => `nonce-${++nonce}`,
    upload: async (input) => {
      uploads.push(input);
      const result = results.shift();
      if (result instanceof Error) throw result;
      if (result) return result;
      version += 1;
      return { kind: "saved", artifactId: `a${version}`, version };
    },
    onSaved,
    onConflict,
  });
  return { queue, clock, uploads, serialize, onSaved, onConflict };
}

describe("readSaveResponse", () => {
  it("reads a saved version", () => {
    expect(readSaveResponse(200, { artifactId: "a2", version: 2 })).toEqual({
      kind: "saved",
      artifactId: "a2",
      version: 2,
    });
  });

  it("reads a conflict with the newest version", () => {
    expect(
      readSaveResponse(409, { code: "CONFLICT", latestVersion: 7, artifactId: "a7", error: "x" }),
    ).toEqual({ kind: "conflict", latestVersion: 7, artifactId: "a7" });
  });

  it("treats every other answer as a refusal with its code", () => {
    expect(readSaveResponse(507, { code: "STORAGE_FULL", error: "No room" })).toEqual({
      kind: "refused",
      status: 507,
      code: "STORAGE_FULL",
      message: "No room",
    });
    expect(readSaveResponse(413, null)).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(readSaveResponse(409, { code: "CONFLICT" })).toMatchObject({ kind: "refused" });
    expect(readSaveResponse(200, { version: 2 })).toMatchObject({ kind: "refused" });
  });
});

describe("createSaveQueue", () => {
  it("never writes when nothing was edited", async () => {
    const { queue, uploads, serialize } = setup();
    expect((await queue.flush()).dirty).toBe(false);
    expect(serialize).not.toHaveBeenCalled();
    expect(uploads).toHaveLength(0);
  });

  it("saves once, after the pause, on top of the loaded version", async () => {
    const { queue, clock, uploads, onSaved } = setup();
    queue.edit();
    queue.edit();
    queue.edit();
    expect(clock.pending()).toEqual([2000]);
    expect(queue.state()).toMatchObject({ status: "waiting", dirty: true });
    await clock.fire();
    expect(uploads).toEqual([expect.objectContaining({ baseVersion: 3, clientNonce: "nonce-1" })]);
    expect(onSaved).toHaveBeenCalledWith({ artifactId: "a4", version: 4 });
    expect(queue.state()).toMatchObject({ status: "saved", dirty: false, baseVersion: 4 });
  });

  it("flushes without waiting and builds each save on the last one", async () => {
    const { queue, uploads } = setup();
    queue.edit();
    await queue.flush();
    queue.edit();
    await queue.flush();
    expect(uploads.map((u) => u.baseVersion)).toEqual([3, 4]);
    expect(uploads.map((u) => u.clientNonce)).toEqual(["nonce-1", "nonce-2"]);
  });

  it("saves again when edits arrive during a save", async () => {
    const { queue, uploads } = setup();
    queue.edit();
    const first = queue.flush();
    queue.edit();
    await first;
    await queue.flush();
    expect(uploads.map((u) => u.baseVersion)).toEqual([3, 4]);
    expect(queue.state().dirty).toBe(false);
  });

  it("stops on a conflict until the newest version is loaded", async () => {
    const { queue, clock, uploads, onConflict } = setup([
      { kind: "conflict", latestVersion: 9, artifactId: "a9" },
    ]);
    queue.edit();
    await queue.flush();
    expect(onConflict).toHaveBeenCalledWith({ latestVersion: 9, artifactId: "a9" });
    expect(queue.state().status).toBe("conflict");
    queue.edit();
    await queue.flush();
    expect(uploads).toHaveLength(1);
    expect(clock.pending()).toEqual([]);

    queue.rebase(9);
    expect(queue.state()).toMatchObject({ status: "idle", dirty: false, baseVersion: 9 });
    queue.edit();
    await queue.flush();
    expect(uploads.at(-1)?.baseVersion).toBe(9);
  });

  it("retries a save the server never answered with the same nonce", async () => {
    const { queue, clock, uploads } = setup([new Error("offline")]);
    queue.edit();
    await queue.flush();
    expect(queue.state()).toMatchObject({ status: "failed", dirty: true });
    expect(clock.pending()).toEqual([5000]);
    await clock.fire();
    expect(uploads.map((u) => u.clientNonce)).toEqual(["nonce-1", "nonce-1"]);
    expect(queue.state()).toMatchObject({ status: "saved", dirty: false });
  });

  it("uses a new nonce once the document changed after a failed save", async () => {
    const { queue, uploads } = setup([new Error("offline")]);
    queue.edit();
    await queue.flush();
    queue.edit();
    await queue.flush();
    expect(uploads.map((u) => u.clientNonce)).toEqual(["nonce-1", "nonce-2"]);
  });

  it("does not upload a file that fails its check, and tries again after the next edit", async () => {
    const check = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce("Broken relationship")
      .mockResolvedValue(null);
    const { queue, uploads } = setup([], check);
    queue.edit();
    await queue.flush();
    expect(queue.state()).toMatchObject({ status: "invalid", detail: "Broken relationship" });
    expect(uploads).toHaveLength(0);
    await queue.flush();
    expect(uploads).toHaveLength(0);
    queue.edit();
    await queue.flush();
    expect(uploads).toHaveLength(1);
  });

  it("waits for the next edit after a refusal", async () => {
    const { queue, clock, uploads } = setup([
      { kind: "refused", status: 507, code: "STORAGE_FULL", message: "No room" },
    ]);
    queue.edit();
    await queue.flush();
    expect(queue.state()).toMatchObject({ status: "refused", detail: "No room", dirty: true });
    expect(clock.pending()).toEqual([]);
    await queue.flush();
    expect(uploads).toHaveLength(1);
    queue.edit();
    await queue.flush();
    expect(uploads).toHaveLength(2);
  });

  it("ignores a save that finishes after the file was reloaded", async () => {
    let finish: (result: SaveResult) => void = () => {};
    const onSaved = vi.fn();
    const queue = createSaveQueue({
      baseVersion: 1,
      serialize: async () => new Uint8Array([1]),
      upload: () => new Promise((resolve) => (finish = resolve)),
      onSaved,
      timers: manualTimers().timers,
    });
    queue.edit();
    const flushing = queue.flush();
    await settle();
    queue.rebase(5);
    finish({ kind: "saved", artifactId: "a2", version: 2 });
    await flushing;
    expect(onSaved).not.toHaveBeenCalled();
    expect(queue.state()).toMatchObject({ baseVersion: 5, dirty: false, status: "idle" });
  });
});
