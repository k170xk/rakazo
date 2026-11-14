import { describe, expect, it, vi } from "vitest";
import { parseFontSize, stepFontSize } from "./FontSizeInput";
import { createHistory } from "./history";
import { matchesShortcut, shortcutKeys, shortcutLabel } from "./shortcuts";
import { normalizeHex } from "./swatches";

describe("normalizeHex", () => {
  it("accepts six-digit colours with or without #, and drops alpha from eight digits", () => {
    expect(normalizeHex("76bf43")).toBe("#76BF43");
    expect(normalizeHex(" #c00000 ")).toBe("#C00000");
    expect(normalizeHex("FF76BF43")).toBe("#76BF43");
    expect(normalizeHex("#fff")).toBeNull();
    expect(normalizeHex("auto")).toBeNull();
    expect(normalizeHex(undefined)).toBeNull();
  });
});

describe("font sizes", () => {
  it("reads typed sizes to the nearest half point and refuses nonsense", () => {
    expect(parseFontSize("11")).toBe(11);
    expect(parseFontSize("10,5")).toBe(10.5);
    expect(parseFontSize("12.3")).toBe(12.5);
    expect(parseFontSize("0")).toBeNull();
    expect(parseFontSize("500")).toBeNull();
    expect(parseFontSize("big")).toBeNull();
  });

  it("grows and shrinks through the size list, then by steps past its ends", () => {
    expect(stepFontSize(11, 1)).toBe(12);
    expect(stepFontSize(13, 1)).toBe(14);
    expect(stepFontSize(11, -1)).toBe(10.5);
    expect(stepFontSize(96, 1)).toBe(110);
    expect(stepFontSize(8, -1)).toBe(7);
    expect(stepFontSize(1, -1)).toBe(1);
  });
});

const press = (
  key: string,
  mods: Partial<Record<"meta" | "ctrl" | "shift" | "alt", boolean>> = {},
) => ({
  key,
  metaKey: mods.meta ?? false,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
});

describe("shortcuts", () => {
  it("shows Mod as ⌘ on Apple devices and Ctrl elsewhere", () => {
    expect(shortcutKeys("Mod+B", true)).toEqual(["⌘", "B"]);
    expect(shortcutKeys("Mod+Shift+z", false)).toEqual(["Ctrl", "Shift", "Z"]);
    expect(shortcutLabel("Mod+Shift+Z", true)).toBe("⌘⇧Z");
    expect(shortcutLabel("Mod+Shift+Z", false)).toBe("Ctrl+Shift+Z");
    expect(shortcutLabel("F5", false)).toBe("F5");
  });

  it("matches presses with exactly the modifiers asked for", () => {
    expect(matchesShortcut(press("b", { meta: true }), "Mod+B", true)).toBe(true);
    expect(matchesShortcut(press("b", { ctrl: true }), "Mod+B", true)).toBe(false);
    expect(matchesShortcut(press("b", { ctrl: true }), "Mod+B", false)).toBe(true);
    expect(matchesShortcut(press("Z", { ctrl: true, shift: true }), "Mod+Shift+Z", false)).toBe(
      true,
    );
    expect(matchesShortcut(press("z", { ctrl: true, shift: true }), "Mod+Z", false)).toBe(false);
    expect(matchesShortcut(press("b"), "Mod+B", false)).toBe(false);
    expect(matchesShortcut(press("F5"), "F5", false)).toBe(true);
    expect(matchesShortcut(press("=", { ctrl: true }), "Mod+Plus", false)).toBe(true);
  });
});

describe("createHistory", () => {
  it("undoes and redoes in order", () => {
    const history = createHistory<number>();
    expect(history.canUndo()).toBe(false);
    history.record(1);
    history.record(2);
    expect(history.undo(3)).toBe(2);
    expect(history.undo(2)).toBe(1);
    expect(history.undo(1)).toBeNull();
    expect(history.canRedo()).toBe(true);
    expect(history.redo(1)).toBe(2);
    expect(history.redo(2)).toBe(3);
    expect(history.redo(3)).toBeNull();
  });

  it("forgets what could be redone once a new edit is made", () => {
    const history = createHistory<string>();
    history.record("a");
    expect(history.undo("b")).toBe("a");
    history.record("a");
    expect(history.canRedo()).toBe(false);
  });

  it("keeps at most the limit and tells listeners", () => {
    const history = createHistory<number>(2);
    const listener = vi.fn();
    const stop = history.subscribe(listener);
    history.record(1);
    history.record(2);
    history.record(3);
    expect(history.undo(4)).toBe(3);
    expect(history.undo(3)).toBe(2);
    expect(history.undo(2)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(5);
    stop();
    history.clear();
    expect(listener).toHaveBeenCalledTimes(5);
    expect(history.canRedo()).toBe(false);
  });
});
