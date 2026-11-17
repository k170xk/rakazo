// @vitest-environment jsdom
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApplyNewerVersion } from "./use-apply-newer-version";
import type { SaveQueue, SaveQueueState } from "./word/save-queue";

let root: Root;
let container: HTMLDivElement;
let loadNewer: ReturnType<typeof vi.fn<() => Promise<void>>>;
let queueState: SaveQueueState;
let latest: { current: { version: number } | null };
let queue: { current: SaveQueue | null };
let resetOpenFailures: (() => void) | undefined;

function Harness(props: {
  newest: number | undefined;
  saveStatus: string;
  openFailureTick?: number;
  maxOpenFailures?: number;
}) {
  const api = useApplyNewerVersion({
    newest: props.newest,
    saveStatus: props.saveStatus,
    queue,
    latest,
    loadNewer,
    openFailureTick: props.openFailureTick,
    maxOpenFailures: props.maxOpenFailures,
  });
  resetOpenFailures = api.resetOpenFailures;
  return null;
}

async function render(props: {
  newest: number | undefined;
  saveStatus: string;
  openFailureTick?: number;
  maxOpenFailures?: number;
}) {
  await act(async () => {
    root.render(<Harness {...props} />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  root = createRoot(container);
  loadNewer = vi.fn(async () => {
    if (latest.current) latest.current = { version: latest.current.version + 1 };
  });
  queueState = { status: "idle", dirty: false, baseVersion: 1, detail: null };
  latest = { current: { version: 1 } };
  queue = {
    current: {
      state: () => queueState,
      flush: vi.fn(async () => queueState),
      edit: () => {},
      rebase: () => {},
      dispose: () => {},
    },
  };
});

afterEach(() => {
  act(() => root.unmount());
});

it("loads once when the revision moves ahead", async () => {
  await render({ newest: 2, saveStatus: "idle" });
  expect(loadNewer).toHaveBeenCalledTimes(1);
  expect(latest.current?.version).toBe(2);
});

it("does not start a second load while one is in flight", async () => {
  let finish: () => void = () => {};
  loadNewer.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = () => {
          if (latest.current) latest.current = { version: 2 };
          resolve();
        };
      }),
  );
  await render({ newest: 2, saveStatus: "idle" });
  expect(loadNewer).toHaveBeenCalledTimes(1);
  // Save-status flicker must not cancel or stack another load.
  await render({ newest: 2, saveStatus: "saved" });
  await render({ newest: 2, saveStatus: "idle" });
  expect(loadNewer).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(latest.current?.version).toBe(2);
});

it("flushes dirty edits before loading the assistant's version", async () => {
  queueState = { status: "idle", dirty: true, baseVersion: 1, detail: null };
  await render({ newest: 2, saveStatus: "idle" });
  expect(queue.current?.flush).toHaveBeenCalled();
  expect(loadNewer).not.toHaveBeenCalled();
});

it("waits while a save is in progress", async () => {
  queueState = { status: "saving", dirty: true, baseVersion: 1, detail: null };
  await render({ newest: 2, saveStatus: "saving" });
  expect(loadNewer).not.toHaveBeenCalled();
  queueState = { status: "saved", dirty: false, baseVersion: 1, detail: null };
  await render({ newest: 2, saveStatus: "saved" });
  expect(loadNewer).toHaveBeenCalledTimes(1);
});

it("counts only finished open failures toward the Excel/PowerPoint cap", async () => {
  loadNewer.mockImplementation(async () => {
    // Leave the version pointer where it was — open/parse failed.
  });
  await render({ newest: 2, saveStatus: "idle", maxOpenFailures: 2, openFailureTick: 0 });
  expect(loadNewer).toHaveBeenCalledTimes(1);
  await render({ newest: 2, saveStatus: "idle", maxOpenFailures: 2, openFailureTick: 1 });
  expect(loadNewer).toHaveBeenCalledTimes(2);
  await render({ newest: 2, saveStatus: "idle", maxOpenFailures: 2, openFailureTick: 2 });
  // Cap reached after two finished failures.
  expect(loadNewer).toHaveBeenCalledTimes(2);
  resetOpenFailures?.();
  await render({ newest: 2, saveStatus: "idle", maxOpenFailures: 2, openFailureTick: 3 });
  expect(loadNewer).toHaveBeenCalledTimes(3);
});

it("runs again when a newer aim arrives during an in-flight load", async () => {
  const finishes: Array<() => void> = [];
  loadNewer.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishes.push(() => {
          if (latest.current) latest.current = { version: latest.current.version + 1 };
          resolve();
        });
      }),
  );
  await render({ newest: 2, saveStatus: "idle" });
  expect(loadNewer).toHaveBeenCalledTimes(1);
  await render({ newest: 3, saveStatus: "idle" });
  expect(loadNewer).toHaveBeenCalledTimes(1);
  await act(async () => {
    finishes[0]?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // First load landed v2; a second pass should start for v3.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(loadNewer).toHaveBeenCalledTimes(2);
  await act(async () => {
    finishes[1]?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(latest.current?.version).toBe(3);
});
