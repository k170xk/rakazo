/** Device preference for the composer dictate keyboard shortcut. */

export const DICTATION_SHORTCUT_STORAGE_KEY = "rakazo.dictationShortcut";

export type DictationShortcut = {
  /** Lowercase KeyboardEvent.key, e.g. "d" or " ". */
  key: string;
  /** ⌘ on Apple, Ctrl elsewhere — stored as the platform-neutral "mod". */
  mod: boolean;
  shift: boolean;
  alt: boolean;
};

export const DEFAULT_DICTATION_SHORTCUT: DictationShortcut = {
  key: "d",
  mod: true,
  shift: false,
  alt: false,
};

type ShortcutStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const listeners = new Set<() => void>();
let memoryPreference: DictationShortcut | null = null;

function getLocalStorage(): ShortcutStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function normalizeDictationShortcut(
  raw: unknown,
  fallback: DictationShortcut = DEFAULT_DICTATION_SHORTCUT,
): DictationShortcut {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...fallback };
  const value = raw as Record<string, unknown>;
  const rawKey = typeof value.key === "string" ? value.key.toLowerCase() : "";
  // Space is a valid chord key; trim would turn it into "".
  const key = rawKey === " " ? " " : rawKey.trim();
  if (!key || key === "meta" || key === "control" || key === "alt" || key === "shift") {
    return { ...fallback };
  }
  return {
    key,
    mod: value.mod !== false,
    shift: value.shift === true,
    alt: value.alt === true,
  };
}

function readStored(
  storage: ShortcutStorage | null,
): DictationShortcut {
  if (!storage) return { ...DEFAULT_DICTATION_SHORTCUT };
  try {
    const raw = storage.getItem(DICTATION_SHORTCUT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DICTATION_SHORTCUT };
    return normalizeDictationShortcut(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_DICTATION_SHORTCUT };
  }
}

export function getDictationShortcut(
  storage: ShortcutStorage | null = getLocalStorage(),
): DictationShortcut {
  if (memoryPreference) return memoryPreference;
  memoryPreference = readStored(storage);
  return memoryPreference;
}

export function setDictationShortcut(
  shortcut: DictationShortcut,
  storage: ShortcutStorage | null = getLocalStorage(),
): DictationShortcut {
  memoryPreference = normalizeDictationShortcut(shortcut);
  if (storage) {
    try {
      storage.setItem(DICTATION_SHORTCUT_STORAGE_KEY, JSON.stringify(memoryPreference));
    } catch {
      // Private browsing: keep the in-memory value.
    }
  }
  for (const listener of listeners) listener();
  return memoryPreference;
}

export function resetDictationShortcut(
  storage: ShortcutStorage | null = getLocalStorage(),
): DictationShortcut {
  memoryPreference = { ...DEFAULT_DICTATION_SHORTCUT };
  if (storage) {
    try {
      storage.removeItem(DICTATION_SHORTCUT_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  for (const listener of listeners) listener();
  return memoryPreference;
}

export function subscribeDictationShortcut(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether a keydown matches the stored dictate chord. */
export function matchesDictationShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  shortcut: DictationShortcut,
  apple: boolean,
): boolean {
  if (event.key?.toLowerCase() !== shortcut.key) return false;
  if (Boolean(event.shiftKey) !== shortcut.shift) return false;
  if (Boolean(event.altKey) !== shortcut.alt) return false;
  if (!shortcut.mod) {
    return !event.metaKey && !event.ctrlKey;
  }
  return apple ? Boolean(event.metaKey) && !event.ctrlKey : Boolean(event.ctrlKey) && !event.metaKey;
}

/** Labels for the shortcuts dialog / settings row. */
export function formatDictationShortcut(
  shortcut: DictationShortcut,
  apple: boolean,
): string[] {
  const parts: string[] = [];
  if (shortcut.mod) parts.push(apple ? "⌘" : "Ctrl");
  if (shortcut.alt) parts.push(apple ? "⌥" : "Alt");
  if (shortcut.shift) parts.push(apple ? "⇧" : "Shift");
  parts.push(shortcut.key === " " ? "Space" : shortcut.key.toUpperCase());
  return parts;
}

export function dictationShortcutFromEvent(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
): DictationShortcut | null {
  const key = event.key?.trim().toLowerCase() ?? "";
  if (!key || key === "meta" || key === "control" || key === "alt" || key === "shift" || key === "escape") {
    return null;
  }
  if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    // Require at least one modifier so ordinary typing is not captured.
    return null;
  }
  return {
    key,
    mod: Boolean(event.metaKey || event.ctrlKey),
    shift: Boolean(event.shiftKey),
    alt: Boolean(event.altKey),
  };
}
