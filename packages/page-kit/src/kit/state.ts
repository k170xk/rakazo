import { useCallback, useSyncExternalStore } from "react";

/**
 * What a page saves for itself: ticks, entries, choices. The app keeps one value per key for the
 * page, shared by everyone who opens it; a page shown where the app keeps nothing (a preview, or
 * a link opened with its password) still works, but forgets on reload.
 */
const READ_MESSAGE = "rakazo-page:state-read";
const VALUES_MESSAGE = "rakazo-page:state";
const WRITE_MESSAGE = "rakazo-page:state-write";
const SAVED_MESSAGE = "rakazo-page:state-saved";
/** Larger values are kept for this visit only. */
export const PAGE_STATE_MAX_BYTES = 64_000;
const KEY = /^[A-Za-z0-9_.:-]{1,64}$/;
const SAVE_DELAY_MS = 400;
const READ_TIMEOUT_MS = 2500;

export type PageStateStatus = {
  /** The saved values have arrived, or the app keeps none here. */
  ready: boolean;
  /** Changes are kept for the next visit and for everyone else who opens the page. */
  canSave: boolean;
  /** A change is waiting to be kept. */
  saving: boolean;
  /** The last save was refused, so the change lasts only for this visit. */
  failed: boolean;
};

type Store = {
  values: Record<string, unknown>;
  status: PageStateStatus;
  version: number;
};

const store: Store = {
  values: {},
  status: { ready: false, canSave: false, saving: false, failed: false },
  version: 0,
};
const listeners = new Set<() => void>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();
/** Keys changed before the app said whether it keeps them. */
const early = new Set<string>();
let requested = false;

function changed() {
  store.version += 1;
  for (const listener of listeners) listener();
}

function setStatus(next: Partial<PageStateStatus>) {
  store.status = { ...store.status, ...next };
  changed();
}

function post(message: object) {
  window.parent?.postMessage(message, "*");
}

function receive(event: MessageEvent) {
  const data = event.data as {
    type?: unknown;
    values?: unknown;
    writable?: unknown;
    key?: unknown;
    ok?: unknown;
  } | null;
  if (data?.type === VALUES_MESSAGE) {
    if (store.status.ready) return;
    const values = data.values && typeof data.values === "object" ? data.values : {};
    // Anything changed before the values arrived wins over what was saved.
    store.values = { ...(values as Record<string, unknown>), ...store.values };
    setStatus({ ready: true, canSave: data.writable === true });
    for (const key of early) save(key);
    early.clear();
  } else if (data?.type === SAVED_MESSAGE) {
    setStatus({ saving: pending.size > 0, failed: data.ok !== true });
  }
}

function request() {
  if (requested || typeof window === "undefined") return;
  requested = true;
  window.addEventListener("message", receive);
  post({ type: READ_MESSAGE });
  setTimeout(() => {
    if (!store.status.ready) setStatus({ ready: true, canSave: false });
  }, READ_TIMEOUT_MS);
}

function subscribe(listener: () => void) {
  request();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function fits(value: unknown): boolean {
  try {
    const json = JSON.stringify(value ?? null);
    return json !== undefined && json.length <= PAGE_STATE_MAX_BYTES;
  } catch {
    return false;
  }
}

function save(key: string) {
  const timer = pending.get(key);
  if (timer) clearTimeout(timer);
  if (!store.status.ready) {
    early.add(key);
    return;
  }
  if (!store.status.canSave) return;
  const value = store.values[key];
  if (!fits(value)) {
    setStatus({ failed: true });
    return;
  }
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key);
      post({ type: WRITE_MESSAGE, key, value: store.values[key] ?? null });
    }, SAVE_DELAY_MS),
  );
  setStatus({ saving: true });
}

/**
 * Like useState, but the value is kept with the page: [value, setValue, status]. Every component
 * using the same key sees the same value. Keep values plain JSON (text, numbers, true/false,
 * lists and objects of them).
 */
export function usePageState<T>(
  key: string,
  initial: T,
): [T, (next: T | ((current: T) => T)) => void, PageStateStatus] {
  if (!KEY.test(key)) {
    throw new Error(
      `usePageState("${key}"): keys are 1 to 64 letters, digits or the marks _ . : -`,
    );
  }
  useSyncExternalStore(
    subscribe,
    () => store.version,
    () => 0,
  );
  const value = (Object.hasOwn(store.values, key) ? store.values[key] : initial) as T;
  const setValue = useCallback(
    (next: T | ((current: T) => T)) => {
      const current = (Object.hasOwn(store.values, key) ? store.values[key] : initial) as T;
      const resolved =
        typeof next === "function" ? (next as (current: T) => T)(current) : (next as T);
      store.values = { ...store.values, [key]: resolved };
      changed();
      save(key);
    },
    [key, initial],
  );
  return [value, setValue, store.status];
}
