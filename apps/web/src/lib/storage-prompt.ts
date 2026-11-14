import type { MyStorageItem, MyStorageState } from "@rakazo/contracts";

const DAY_MS = 86_400_000;
export const NEARLY_FULL_SHARE = 0.8;
export const EXPIRING_WITHIN_DAYS = 7;

export type StorageTab = "all" | "expiring" | "largest";
export type StoragePromptReason = "full" | "nearly-full" | "expiring";

const OPEN_EVENT = "rakazo:open-storage";

/** Opens Manage storage from anywhere in the shell, optionally on one tab. */
export function openStorageDialog(tab: StorageTab = "all") {
  window.dispatchEvent(new CustomEvent<StorageTab>(OPEN_EVENT, { detail: tab }));
}

export function onOpenStorageDialog(listener: (tab: StorageTab) => void) {
  const handle = (event: Event) => listener((event as CustomEvent<StorageTab>).detail ?? "all");
  window.addEventListener(OPEN_EVENT, handle);
  return () => window.removeEventListener(OPEN_EVENT, handle);
}

export function isExpiringSoon(item: MyStorageItem, now: number) {
  if (!item.deletesAt) return false;
  return new Date(item.deletesAt).getTime() - now <= EXPIRING_WITHIN_DAYS * DAY_MS;
}

/** Why the pop-up should open by itself, most urgent first; null when there is nothing to say. */
export function storagePromptReason(
  state: MyStorageState,
  now: number,
): StoragePromptReason | null {
  if (state.limitBytes > 0 && state.usedBytes >= state.limitBytes) return "full";
  if (state.limitBytes > 0 && state.usedBytes >= state.limitBytes * NEARLY_FULL_SHARE)
    return "nearly-full";
  if (state.items.some((item) => isExpiringSoon(item, now))) return "expiring";
  return null;
}

const promptKey = (userId: string) => `rakazo:storage-prompt:v1:${userId}`;

function localDay(now: number) {
  const date = new Date(now);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** Each reason opens the pop-up at most once a day, so it never nags on every page load. */
export function shouldPromptStorage(userId: string, reason: StoragePromptReason, now: number) {
  try {
    const seen = globalThis.localStorage?.getItem(promptKey(userId));
    return seen !== `${reason}:${localDay(now)}`;
  } catch {
    return true;
  }
}

export function markStoragePromptSeen(userId: string, reason: StoragePromptReason, now: number) {
  try {
    globalThis.localStorage?.setItem(promptKey(userId), `${reason}:${localDay(now)}`);
  } catch {
    // Storage blocked: the pop-up may open again on the next visit, which is harmless.
  }
}

/** The items a tab shows: newest first, soonest deleted first, or largest first. */
export function itemsForTab(items: readonly MyStorageItem[], tab: StorageTab, now: number) {
  if (tab === "largest") return [...items].sort((a, b) => b.size - a.size);
  if (tab === "expiring") {
    return items
      .filter((item) => isExpiringSoon(item, now))
      .sort((a, b) => Date.parse(a.deletesAt!) - Date.parse(b.deletesAt!));
  }
  return [...items].sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
}

export function storageItemKey(item: Pick<MyStorageItem, "ref">) {
  return item.ref.kind === "computer"
    ? `computer:${item.ref.source ?? "documents"}:${item.ref.botId}:${item.ref.path}`
    : `chat:${item.ref.artifactId}`;
}
