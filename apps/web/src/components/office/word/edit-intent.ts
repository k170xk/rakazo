/** How long after typing, pasting or pressing a tool a document change still counts as an edit. */
export const EDIT_INTENT_MS = 4000;

const EDITING_KEYS = new Set(["Enter", "Backspace", "Delete", "Tab"]);
const EDITING_SHORTCUTS = new Set(["z", "y", "x", "v", "b", "i", "u", "e", "l", "r", "j"]);

/**
 * Whether a key press can change a document: printable keys, editing keys and formatting or
 * clipboard shortcuts. Arrows, modifiers alone, Escape and copy cannot.
 */
export function isEditingKey(event: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}): boolean {
  if (event.metaKey || event.ctrlKey) return EDITING_SHORTCUTS.has(event.key.toLowerCase());
  if (EDITING_KEYS.has(event.key)) return true;
  return event.key.length === 1;
}

/**
 * A document change is the person's edit only when they did something that edits shortly before.
 * Changes from loading, layout or fonts arriving have no such action, so opening never saves.
 */
export function isPersonEdit(lastIntentAt: number | null, now: number): boolean {
  return lastIntentAt !== null && now - lastIntentAt >= 0 && now - lastIntentAt <= EDIT_INTENT_MS;
}
