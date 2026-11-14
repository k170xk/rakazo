/**
 * Keyboard shortcuts as the ribbon shows and matches them. A shortcut is written like `Mod+B` or
 * `Mod+Shift+Z`, where `Mod` is ⌘ on Apple devices and Ctrl elsewhere.
 */
export type Shortcut = string;

export function isApple(platform: string = globalThis.navigator?.platform ?? ""): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

const APPLE_KEYS: Record<string, string> = { mod: "⌘", shift: "⇧", alt: "⌥", ctrl: "⌃" };
const OTHER_KEYS: Record<string, string> = {
  mod: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  ctrl: "Ctrl",
};

/** The keys of a shortcut to show, one label each, such as `["⌘", "B"]` or `["Ctrl", "B"]`. */
export function shortcutKeys(shortcut: Shortcut, apple = isApple()): string[] {
  const names = apple ? APPLE_KEYS : OTHER_KEYS;
  return shortcut.split("+").map((part) => {
    const key = part.trim();
    return names[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key);
  });
}

/** One readable string for a shortcut, as `⌘⇧Z` on Apple devices or `Ctrl+Shift+Z` elsewhere. */
export function shortcutLabel(shortcut: Shortcut, apple = isApple()): string {
  return shortcutKeys(shortcut, apple).join(apple ? "" : "+");
}

type KeyLike = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

/** Whether a key press is the shortcut. `Mod` takes ⌘ on Apple devices and Ctrl elsewhere. */
export function matchesShortcut(event: KeyLike, shortcut: Shortcut, apple = isApple()): boolean {
  const parts = shortcut.split("+").map((part) => part.trim().toLowerCase());
  const key = parts[parts.length - 1] ?? "";
  const wants = new Set(parts.slice(0, -1));
  const mod = apple ? event.metaKey : event.ctrlKey;
  if (wants.has("mod") !== mod) return false;
  if (wants.has("shift") !== event.shiftKey) return false;
  if (wants.has("alt") !== event.altKey) return false;
  // Ctrl on Apple devices is its own modifier; elsewhere it is Mod.
  if (apple && wants.has("ctrl") !== event.ctrlKey) return false;
  if (!apple && !wants.has("mod") && wants.has("ctrl") !== event.ctrlKey) return false;
  if (apple && !wants.has("mod") && event.metaKey) return false;
  const pressed = event.key.toLowerCase();
  return pressed === key || (key === "plus" && (pressed === "+" || pressed === "="));
}

/** Whether a key press landed in a field that takes typing of its own. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
