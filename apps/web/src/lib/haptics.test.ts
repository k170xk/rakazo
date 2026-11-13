// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatEventHaptic,
  eventHaptic,
  haptic,
  installSelectionHaptics,
  resetHapticsForTest,
  STEP_GAP_MS,
} from "./haptics";

const calls: Array<[string, object | undefined]> = [];

function withBridge() {
  (globalThis as { Capacitor?: unknown }).Capacitor = {
    isPluginAvailable: (name: string) => name === "Haptics",
    nativePromise: vi.fn((_plugin: string, method: string, options?: object) => {
      calls.push([method, options]);
      return Promise.resolve();
    }),
  };
}

describe("haptics", () => {
  beforeEach(() => {
    calls.length = 0;
    resetHapticsForTest();
  });
  afterEach(() => {
    delete (globalThis as { Capacitor?: unknown }).Capacitor;
  });

  it("does nothing in a browser", () => {
    expect(haptic("success", 1_000)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("maps each kind onto the native plugin", () => {
    withBridge();
    haptic("tap", 1_000);
    haptic("success", 2_000);
    haptic("error", 3_000);
    expect(calls).toEqual([
      ["impact", { style: "LIGHT" }],
      ["notification", { type: "SUCCESS" }],
      ["notification", { type: "ERROR" }],
    ]);
  });

  it("starts a selection once before the first tick", () => {
    withBridge();
    haptic("select", 1_000);
    haptic("select", 2_000);
    expect(calls.map(([method]) => method)).toEqual([
      "selectionStart",
      "selectionChanged",
      "selectionChanged",
    ]);
  });

  it("keeps bursts of thinking steps to one tick", () => {
    withBridge();
    expect(haptic("step", 10_000)).toBe(true);
    expect(haptic("step", 10_000 + STEP_GAP_MS - 1)).toBe(false);
    expect(haptic("step", 10_000 + STEP_GAP_MS)).toBe(true);
    expect(haptic("success", 10_000 + STEP_GAP_MS + 10)).toBe(false);
  });

  it("only reacts to live events that matter", () => {
    expect(eventHaptic("run.completed")).toBe("success");
    expect(eventHaptic("run.waiting_input")).toBe("warning");
    expect(eventHaptic("thread.message.updated")).toBeUndefined();
    withBridge();
    chatEventHaptic({ type: "run.completed", seq: 4 }, 5);
    expect(calls).toEqual([]);
    chatEventHaptic({ type: "run.completed", seq: 6 }, 5);
    expect(calls).toEqual([["notification", { type: "SUCCESS" }]]);
  });

  it("ticks for switches but not plain buttons", () => {
    withBridge();
    const stop = installSelectionHaptics(document);
    document.body.innerHTML =
      '<button id="plain"></button><button role="switch" id="toggle"><span></span></button>';
    document.getElementById("plain")!.click();
    expect(calls).toEqual([]);
    document.querySelector<HTMLElement>("#toggle span")!.click();
    expect(calls.map(([method]) => method)).toEqual(["selectionStart", "selectionChanged"]);
    stop();
  });
});
