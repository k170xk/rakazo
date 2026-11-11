import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DICTATION_SHORTCUT,
  dictationShortcutFromEvent,
  formatDictationShortcut,
  getDictationShortcut,
  matchesDictationShortcut,
  normalizeDictationShortcut,
  resetDictationShortcut,
  setDictationShortcut,
} from "./dictation-shortcut-pref.js";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

afterEach(() => {
  resetDictationShortcut(memoryStorage());
});

describe("normalizeDictationShortcut", () => {
  it("defaults when the value is missing or invalid", () => {
    expect(normalizeDictationShortcut(null)).toEqual(DEFAULT_DICTATION_SHORTCUT);
    expect(normalizeDictationShortcut({ key: "meta", mod: true })).toEqual(
      DEFAULT_DICTATION_SHORTCUT,
    );
  });

  it("keeps a valid chord", () => {
    expect(normalizeDictationShortcut({ key: " ", mod: true, shift: true, alt: false })).toEqual({
      key: " ",
      mod: true,
      shift: true,
      alt: false,
    });
  });
});

describe("get/setDictationShortcut", () => {
  it("persists and resets", () => {
    const storage = memoryStorage();
    expect(getDictationShortcut(storage)).toEqual(DEFAULT_DICTATION_SHORTCUT);
    setDictationShortcut({ key: "m", mod: true, shift: false, alt: false }, storage);
    expect(getDictationShortcut(storage).key).toBe("m");
    resetDictationShortcut(storage);
    expect(getDictationShortcut(storage)).toEqual(DEFAULT_DICTATION_SHORTCUT);
  });
});

describe("matchesDictationShortcut", () => {
  it("matches the platform modifier", () => {
    const shortcut = { key: "d", mod: true, shift: false, alt: false };
    expect(
      matchesDictationShortcut(
        { key: "d", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false },
        shortcut,
        true,
      ),
    ).toBe(true);
    expect(
      matchesDictationShortcut(
        { key: "d", metaKey: false, ctrlKey: true, shiftKey: false, altKey: false },
        shortcut,
        false,
      ),
    ).toBe(true);
    expect(
      matchesDictationShortcut(
        { key: "d", metaKey: false, ctrlKey: true, shiftKey: false, altKey: false },
        shortcut,
        true,
      ),
    ).toBe(false);
  });
});

describe("formatDictationShortcut", () => {
  it("labels Space and modifiers", () => {
    expect(
      formatDictationShortcut({ key: " ", mod: true, shift: true, alt: false }, true),
    ).toEqual(["⌘", "⇧", "Space"]);
  });
});

describe("dictationShortcutFromEvent", () => {
  it("requires a modifier and rejects Escape", () => {
    expect(
      dictationShortcutFromEvent({
        key: "d",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeNull();
    expect(
      dictationShortcutFromEvent({
        key: "Escape",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeNull();
    expect(
      dictationShortcutFromEvent({
        key: "m",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toEqual({ key: "m", mod: true, shift: false, alt: false });
  });
});
