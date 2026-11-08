import { useSyncExternalStore } from "react";

export const SIDEBAR_SORTS = ["recent", "name", "manual"] as const;
export type SidebarSort = (typeof SIDEBAR_SORTS)[number];

const STORAGE_PREFIX = "rakazo:sidebar-sort:";
const listeners = new Set<() => void>();
let storageKey: string | null = null;
let current: SidebarSort = "recent";

function readSaved(key: string | null): SidebarSort {
  if (!key) return "recent";
  try {
    const saved = window.localStorage.getItem(key);
    return (SIDEBAR_SORTS as readonly string[]).includes(saved ?? "")
      ? (saved as SidebarSort)
      : "recent";
  } catch {
    return "recent";
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const listener of listeners) listener();
}

/** Points the shared sort at the signed-in person's saved choice. */
function selectSidebarSortOwner(userId: string | null | undefined) {
  const key = userId ? `${STORAGE_PREFIX}${userId}` : null;
  if (key !== storageKey) {
    storageKey = key;
    current = readSaved(key);
  }
}

/** The signed-in person's sidebar order; the shell calls this once with their id. */
export function useSidebarSort(userId?: string | null): SidebarSort {
  if (userId !== undefined) selectSidebarSortOwner(userId);
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => "recent" as const,
  );
}

export function setSidebarSort(sort: SidebarSort) {
  current = sort;
  if (storageKey) {
    try {
      if (sort === "recent") window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, sort);
    } catch {
      // The choice still applies for this visit when storage is unavailable.
    }
  }
  emit();
}
