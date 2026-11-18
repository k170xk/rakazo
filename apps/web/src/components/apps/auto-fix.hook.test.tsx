// @vitest-environment jsdom
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AUTO_FIX_DELAY_MS, useAutoFix } from "./auto-fix";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = Parameters<typeof useAutoFix>[0];
let root: Root;
let latest: ReturnType<typeof useAutoFix>;

function Probe(props: Props) {
  latest = useAutoFix(props);
  return null;
}

function show(props: Props) {
  act(() => root.render(<Probe {...props} />));
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

const base = (send: (text: string) => void): Props => ({
  pageId: "p1",
  version: 3,
  latest: true,
  problem: "Cannot read properties of undefined (reading 'map')",
  busy: false,
  send,
});

it("sends a crash that is still showing after the delay, once", () => {
  const send = vi.fn();
  show(base(send));
  expect(latest.status).toBe("waiting");
  act(() => vi.advanceTimersByTime(AUTO_FIX_DELAY_MS - 1));
  expect(send).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]![0]).toContain("version 3");
  expect(latest.status).toBe("sent");
  show({ ...base(send), busy: true });
  show(base(send));
  act(() => vi.advanceTimersByTime(AUTO_FIX_DELAY_MS * 2));
  expect(send).toHaveBeenCalledTimes(1);
});

it("sends nothing for an error that clears before the delay", () => {
  const send = vi.fn();
  show(base(send));
  show({ ...base(send), problem: null });
  act(() => vi.advanceTimersByTime(AUTO_FIX_DELAY_MS * 2));
  expect(send).not.toHaveBeenCalled();
  expect(latest.status).toBe("off");
});

it("waits while the bot replies and sends when it finishes", () => {
  const send = vi.fn();
  show({ ...base(send), busy: true });
  act(() => vi.advanceTimersByTime(AUTO_FIX_DELAY_MS * 2));
  expect(send).not.toHaveBeenCalled();
  expect(latest.status).toBe("waiting");
  show(base(send));
  act(() => vi.advanceTimersByTime(AUTO_FIX_DELAY_MS));
  expect(send).toHaveBeenCalledTimes(1);
});

it("pauses after two automatic fixes and leaves the third to the person", () => {
  const send = vi.fn();
  for (const version of [3, 4]) {
    show({ ...base(send), version, problem: `crash on ${version}` });
    act(() => vi.advanceTimersByTime(AUTO_FIX_DELAY_MS));
  }
  expect(send).toHaveBeenCalledTimes(2);
  show({ ...base(send), version: 5, problem: "crash on 5" });
  act(() => vi.advanceTimersByTime(AUTO_FIX_DELAY_MS * 2));
  expect(send).toHaveBeenCalledTimes(2);
  expect(latest.status).toBe("paused");
});

it("stays off once the person turns it off, across reloads", () => {
  const send = vi.fn();
  show(base(send));
  act(() => latest.setEnabled(false));
  act(() => vi.advanceTimersByTime(AUTO_FIX_DELAY_MS * 2));
  expect(send).not.toHaveBeenCalled();
  act(() => root.unmount());
  root = createRoot(document.createElement("div"));
  show(base(send));
  expect(latest.enabled).toBe(false);
  act(() => vi.advanceTimersByTime(AUTO_FIX_DELAY_MS * 2));
  expect(send).not.toHaveBeenCalled();
});

it("never sends from an older version or without a way to send", () => {
  const send = vi.fn();
  show({ ...base(send), latest: false });
  act(() => vi.advanceTimersByTime(AUTO_FIX_DELAY_MS * 2));
  expect(send).not.toHaveBeenCalled();
  show({ ...base(send), send: undefined });
  expect(latest.available).toBe(false);
  expect(latest.status).toBe("off");
});
