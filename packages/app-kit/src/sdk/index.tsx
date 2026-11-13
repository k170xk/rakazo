import { MotionConfig } from "motion/react";
import type { ComponentType, ReactNode } from "react";
import { Component, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { LOC_CLASS_PREFIX, locFromClass } from "../loc.js";
import type {
  AppComment,
  AppDelta,
  AppEventMessage,
  AppFocus,
  AppInit,
  AppLive,
  AppPresence,
  AppRequest,
  AppResponseMessage,
  AppRowChange,
  AppViewer,
  MapPlace,
  MapStyle,
} from "../protocol.js";
import {
  APP_EVENT,
  APP_PICK,
  APP_RESPONSE,
  MAX_UPLOAD_BYTES,
  requestMessage,
} from "../protocol.js";
import type {
  AggregateQuery,
  AggregateResult,
  QueryResult,
  RowFilter,
  RowQuery,
  RowSort,
} from "../query.js";
import { runAggregate, runQuery } from "../query.js";
import type { Row, TableSchema } from "../schema.js";
import { isLargeTable, withFormulas } from "../schema.js";
import { mergeDelta } from "./delta.js";

export { formatValue } from "../schema.js";
export type {
  AggregateQuery,
  AggregateResult,
  AppComment,
  AppPresence,
  AppRowChange,
  AppViewer,
  MapPlace,
  MapStyle,
  QueryResult,
  Row,
  RowFilter,
  RowQuery,
  RowSort,
  TableSchema,
};

/** The bridge Evolve gives every staff plugin, when the app runs as one. */
type EvolveBridge = {
  ready(): Promise<{ theme?: { mode?: string } } | null>;
  call(scope: string, params: Record<string, unknown>): Promise<unknown>;
  onTheme(listener: (theme: { mode: string }) => void): () => void;
};

declare global {
  interface Window {
    /** Sample data the builder puts in previews and screenshots, so nothing needs a host. */
    __OCSC_APP_FIXTURE__?: Partial<AppInit>;
    evolve?: EvolveBridge;
  }
}

/** Requests only Evolve's side answers: it has no events, so open copies ask for changes. */
type EvolveRequest = AppRequest | { op: "revision" } | { op: "data" };

const EVOLVE_POLL_MS = 5000;
const EVOLVE_LIVE_POLL_MS = 3000;

function evolveBridge(): EvolveBridge | null {
  const bridge = typeof window === "undefined" ? undefined : window.evolve;
  return bridge && typeof bridge.call === "function" ? bridge : null;
}

type Store = {
  status: "loading" | "ready";
  /** True when no host answered: changes stay in this page. */
  local: boolean;
  init: AppInit;
  version: number;
};

const EMPTY: AppInit = {
  app: { id: "local", title: "", version: 0 },
  viewer: { name: null, canEdit: true, role: "preview" },
  theme: "light",
  tables: {},
  state: {},
  revision: 0,
  features: [],
};

const store: Store = { status: "loading", local: false, init: EMPTY, version: 0 };
/** Everyone signed in who has the app open, from the host's live checks. */
let presence: AppPresence[] = [];
/** The row this viewer has open, for others' presence. */
let focus: AppFocus | null = null;
/** The events this kit understands beyond the first ones, told to the host in init. */
const ACCEPTS = ["delta", "presence"];
const listeners = new Set<() => void>();
const pending = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
let counter = 0;
let started = false;

function changed() {
  store.version += 1;
  for (const listener of listeners) listener();
}

function applyTheme(theme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

const hosted = () => typeof window !== "undefined" && window.parent !== window;

function send<T = unknown>(request: EvolveRequest, timeoutMs = 20_000): Promise<T> {
  if (store.local || !hosted()) return Promise.reject(new Error("No host"));
  const bridge = evolveBridge();
  if (bridge) {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("The app did not get an answer in time.")),
        timeoutMs,
      );
      bridge.call("app.data", request as Record<string, unknown>).then(
        (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error("That did not work."));
        },
      );
    });
  }
  counter += 1;
  const id = `r${counter}`;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("The app did not get an answer in time."));
    }, timeoutMs);
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    window.parent.postMessage(requestMessage(id, request as AppRequest), "*");
  });
}

/** The app's init with newer tables, and its icon once one has been drawn. */
function withData(data: Pick<AppInit, "tables" | "revision"> & { icon?: string | null }): AppInit {
  return {
    ...store.init,
    app: data.icon ? { ...store.init.app, icon: data.icon } : store.init.app,
    tables: data.tables,
    revision: data.revision,
  };
}

/** Merges rows others changed into the tables this copy holds. */
function applyDelta(delta: AppDelta) {
  if (delta.revision <= store.init.revision) return;
  store.init = {
    ...store.init,
    tables: mergeDelta(store.init.tables, delta),
    revision: delta.revision,
  };
  changed();
}

function setPresence(people: AppPresence[]) {
  presence = Array.isArray(people) ? people : [];
  changed();
}

function receive(event: MessageEvent) {
  const data = event.data as AppResponseMessage | AppEventMessage | null;
  if (!data || typeof data !== "object") return;
  if (data.type === APP_RESPONSE) {
    const waiting = pending.get(data.id);
    if (!waiting) return;
    pending.delete(data.id);
    clearTimeout(waiting.timer);
    if (data.ok) waiting.resolve(data.result);
    else waiting.reject(new Error(data.error || "That did not work."));
    return;
  }
  if (data.type !== APP_EVENT) return;
  if (data.event === "theme") {
    store.init = { ...store.init, theme: data.theme };
    applyTheme(data.theme);
    changed();
  } else if (data.event === "tables") {
    if (data.revision < store.init.revision) return;
    store.init = withData(data);
    changed();
  } else if (data.event === "select") {
    setPicking(data.enabled);
  } else if (data.event === "patch") {
    patchElements(data);
  } else if (data.event === "selected") {
    markSelected(data.loc);
  } else if (data.event === "delta") {
    applyDelta(data.delta);
  } else if (data.event === "presence") {
    setPresence(data.people);
  }
}

function goLocal(fixture?: Partial<AppInit>) {
  store.local = true;
  store.init = { ...EMPTY, ...fixture, viewer: { ...EMPTY.viewer, ...fixture?.viewer } };
  store.status = "ready";
  applyTheme(store.init.theme);
  changed();
}

function startInEvolve(bridge: EvolveBridge) {
  const themeOf = (mode: unknown): "light" | "dark" => (mode === "dark" ? "dark" : "light");
  bridge
    .ready()
    .then(async (context) => {
      const init = await send<AppInit>({ op: "init", accepts: ACCEPTS });
      store.init = { ...init, theme: themeOf(context?.theme?.mode) };
      store.status = "ready";
      applyTheme(store.init.theme);
      changed();
      bridge.onTheme((theme) => {
        store.init = { ...store.init, theme: themeOf(theme.mode) };
        applyTheme(store.init.theme);
        changed();
      });
      let checking = false;
      const readAll = async () => {
        const data = await send<Pick<AppInit, "tables" | "revision"> & { icon?: string }>({
          op: "data",
        });
        if (data.revision < store.init.revision) return;
        store.init = withData(data);
        changed();
      };
      const live = store.init.features.includes("live");
      setInterval(
        () => {
          if (checking || document.visibilityState !== "visible") return;
          checking = true;
          const check = live
            ? send<AppLive>({ op: "live", since: store.init.revision, focus }).then(
                async (answer) => {
                  setPresence(answer.presence);
                  if (answer.revision <= store.init.revision) return;
                  if (answer.full || !answer.delta) await readAll();
                  else applyDelta(answer.delta);
                },
              )
            : send<{ revision: number }>({ op: "revision" }).then(async ({ revision }) => {
                if (revision > store.init.revision) await readAll();
              });
          check
            .catch(() => {})
            .finally(() => {
              checking = false;
            });
        },
        live ? EVOLVE_LIVE_POLL_MS : EVOLVE_POLL_MS,
      );
    })
    .catch(() => goLocal());
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("message", receive);
  const fixture = window.__OCSC_APP_FIXTURE__;
  if (fixture || !hosted()) {
    goLocal(fixture);
    return;
  }
  const bridge = evolveBridge();
  if (bridge) {
    startInEvolve(bridge);
    return;
  }
  send<AppInit>({ op: "init", accepts: ACCEPTS }, 8000).then(
    (init) => {
      store.init = init;
      store.status = "ready";
      applyTheme(init.theme);
      changed();
    },
    () => goLocal(),
  );
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useStore(): Store {
  useSyncExternalStore(
    subscribe,
    () => store.version,
    () => 0,
  );
  return store;
}

/** The app, who is viewing it and the host's theme. ready turns true once data has arrived. */
export function useApp() {
  const current = useStore();
  return {
    ready: current.status === "ready",
    app: current.init.app,
    viewer: current.init.viewer,
    theme: current.init.theme,
    features: current.init.features,
    /** Changes are kept only in this page (a preview or an offline copy). */
    local: current.local,
  };
}

function newId() {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return `r_${Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 14)}`;
}

/** Saves this copy made, so server-read pages (useRows) read again at once. */
let writes = 0;

function replaceRows(table: string, update: (rows: Row[]) => Row[]) {
  const current = store.init.tables[table];
  // A large table's rows live on the server; useRows reads them again after the write.
  if (!current || (!store.local && isLargeTable(current.schema))) return;
  store.init = {
    ...store.init,
    tables: { ...store.init.tables, [table]: { ...current, rows: update(current.rows) } },
  };
  changed();
}

function wrote(table: string) {
  const current = store.init.tables[table];
  if (current && isLargeTable(current.schema)) {
    writes += 1;
    changed();
  }
}

export type TableApi<T extends Record<string, unknown> = Record<string, unknown>> = {
  /** The table's name, for comments, history and presence. */
  name: string;
  /** Rows with formula columns filled in; empty while loading, and always for a large table. */
  rows: Array<Row & T>;
  /** A large table: read it with useRows and useAggregate, not rows. */
  large: boolean;
  /** How many rows it has (for a large table, from the server). */
  count: number;
  schema: TableSchema | null;
  loading: boolean;
  /** False for visitors and read-only viewers: hide add, edit and delete controls. */
  canEdit: boolean;
  /**
   * Whether this viewer may change or remove this row: every row when they can edit, or only the
   * ones they added (row._mine) in apps where colleagues contribute. Rows carry _by, who added them.
   */
  canEditRow: (row: Row) => boolean;
  insert: (row: Partial<T>) => Promise<Row & T>;
  update: (id: string, patch: Partial<T>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Downloads the table as a spreadsheet (needs a click first). */
  exportFile: (format?: "xlsx" | "csv") => Promise<void>;
  /** False where the host cannot download files (inside Evolve): hide export buttons. */
  canExport: boolean;
};

/**
 * A table of the app's data, live: other people's changes and routine refreshes arrive on
 * their own. Writes show at once and are rolled back if the host refuses them.
 */
export function useTable<T extends Record<string, unknown> = Record<string, unknown>>(
  name: string,
): TableApi<T> {
  const current = useStore();
  const table = current.init.tables[name];
  const schema = table?.schema ?? null;
  const rows = useMemo(
    () =>
      (table && schema ? table.rows.map((row) => withFormulas(schema, row)) : []) as Array<Row & T>,
    [table, schema],
  );
  const insert = useCallback(
    async (row: Partial<T>) => {
      const optimistic = {
        ...row,
        _id: newId(),
        _updatedAt: new Date().toISOString(),
        _mine: true,
        _by: store.init.viewer.name,
      } as unknown as Row & T;
      replaceRows(name, (list) => [...list, optimistic]);
      if (store.local) return optimistic;
      try {
        const saved = await send<Row & T>({
          op: "rows.insert",
          table: name,
          row: row as Record<string, unknown>,
        });
        // A live check may have brought the saved row in already.
        replaceRows(name, (list) =>
          list
            .filter((item) => item._id !== saved._id)
            .map((item) => (item._id === optimistic._id ? saved : item)),
        );
        wrote(name);
        return saved;
      } catch (error) {
        replaceRows(name, (list) => list.filter((item) => item._id !== optimistic._id));
        throw error;
      }
    },
    [name],
  );
  const update = useCallback(
    async (id: string, patch: Partial<T>) => {
      const before = store.init.tables[name]?.rows.find((row) => row._id === id);
      replaceRows(name, (list) =>
        list.map((item) => (item._id === id ? { ...item, ...patch } : item)),
      );
      if (store.local) return;
      try {
        const saved = await send<Row>({
          op: "rows.update",
          table: name,
          id,
          patch: patch as Record<string, unknown>,
        });
        replaceRows(name, (list) => list.map((item) => (item._id === id ? saved : item)));
        wrote(name);
      } catch (error) {
        if (before)
          replaceRows(name, (list) => list.map((item) => (item._id === id ? before : item)));
        throw error;
      }
    },
    [name],
  );
  const remove = useCallback(
    async (id: string) => {
      const before = store.init.tables[name]?.rows;
      replaceRows(name, (list) => list.filter((item) => item._id !== id));
      if (store.local) return;
      try {
        await send({ op: "rows.remove", table: name, id });
        wrote(name);
      } catch (error) {
        if (before) replaceRows(name, () => before);
        throw error;
      }
    },
    [name],
  );
  const exportFile = useCallback(
    async (format: "xlsx" | "csv" = "xlsx") => {
      if (store.local) {
        const list = store.init.tables[name];
        if (!list) return;
        downloadLocally(`${name}.csv`, "text/csv", toCsv(list.schema, list.rows));
        return;
      }
      await send({ op: "export", table: name, format });
    },
    [name],
  );
  const { canEdit, ownRowsOnly } = current.init.viewer;
  const canEditRow = useCallback(
    (row: Row) => canEdit && (!ownRowsOnly || row._mine === true),
    [canEdit, ownRowsOnly],
  );
  return {
    name,
    rows,
    large: isLargeTable(schema),
    count: table?.count ?? rows.length,
    schema,
    loading: current.status !== "ready",
    canEdit,
    canEditRow,
    insert,
    update,
    remove,
    exportFile,
    canExport: current.local || current.init.features.includes("export"),
  };
}

/** Every table the app has, for pages that list or search across them. */
export function useTables(): Record<string, { schema: TableSchema; rows: Row[] }> {
  return useStore().init.tables;
}

/**
 * Like useState, but kept with the app for everyone who opens it (filters worth remembering,
 * a chosen view, notes). Values are plain JSON under 64 KB.
 */
export function useAppState<T>(
  key: string,
  initial: T,
): [T, (next: T | ((current: T) => T)) => void] {
  const current = useStore();
  const value = (Object.hasOwn(current.init.state, key) ? current.init.state[key] : initial) as T;
  const setValue = useCallback(
    (next: T | ((current: T) => T)) => {
      const before = (Object.hasOwn(store.init.state, key) ? store.init.state[key] : initial) as T;
      const resolved = typeof next === "function" ? (next as (current: T) => T)(before) : next;
      store.init = { ...store.init, state: { ...store.init.state, [key]: resolved } };
      changed();
      if (!store.local && store.init.viewer.canEdit)
        void send({ op: "state.set", key, value: resolved }).catch(() => {});
    },
    [key, initial],
  );
  return [value, setValue];
}

const assetUrls = new Map<string, Promise<string>>();

/**
 * A picture the app keeps (an infographic, photo or upload) as a URL an img can show; null
 * until it has loaded. Ids come from the agent (app_asset) or the Studio.
 */
export function useAsset(id: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    const fixture = window.__OCSC_APP_FIXTURE__ as { assets?: Record<string, string> } | undefined;
    const known = fixture?.assets?.[id];
    if (known) {
      setUrl(known);
      return;
    }
    let cancelled = false;
    let promise = assetUrls.get(id);
    if (!promise) {
      // A data URL: the frame's policy shows embedded pictures and nothing fetched.
      promise = send<{ mime: string; base64: string }>({ op: "asset", id }).then(
        (asset) => `data:${asset.mime};base64,${asset.base64}`,
      );
      assetUrls.set(id, promise);
      promise.catch(() => assetUrls.delete(id));
    }
    promise.then(
      (value) => {
        if (!cancelled) setUrl(value);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [id]);
  return url;
}

const LONGEST_EDGE = 1600;

async function shrinkImage(file: Blob, longest: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot prepare photos.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.55]) {
      const blob = await new Promise<Blob | null>((done) =>
        canvas.toBlob(done, "image/jpeg", quality),
      );
      if (blob && blob.size <= MAX_UPLOAD_BYTES) return blob;
    }
  } finally {
    bitmap.close();
  }
  throw new Error("That photo is too large to add.");
}

async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(text);
}

/**
 * Adds a photo the person picked (a file input or the camera) to the app and returns its picture
 * id, for an image column or useAsset. Photos are shrunk to 1600 px JPEG first, so a phone photo
 * sends in a moment. Previews keep it in the page only.
 */
export async function uploadImage(file: Blob, options: { longest?: number } = {}): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a photo or picture.");
  if (!store.init.viewer.canEdit) throw new Error("You can view this app but not add photos.");
  const blob = await shrinkImage(file, Math.min(options.longest ?? LONGEST_EDGE, 2400));
  const base64 = await blobBase64(blob);
  const name = (file instanceof File ? file.name : "photo").replace(/\.[^.]+$/, "").slice(0, 80);
  if (store.local || !hosted()) {
    const id = `local_${newId().slice(2)}`;
    assetUrls.set(id, Promise.resolve(`data:image/jpeg;base64,${base64}`));
    return id;
  }
  const saved = await send<{ id: string }>(
    { op: "upload", name: `${name || "photo"}.jpg`, mime: "image/jpeg", base64 },
    60_000,
  );
  assetUrls.set(saved.id, Promise.resolve(`data:image/jpeg;base64,${base64}`));
  return saved.id;
}

/** True where the viewer can add photos (they may edit, and the host keeps uploads). */
export function useCanUpload(): boolean {
  const current = useStore();
  return (
    current.init.viewer.canEdit && (current.local || current.init.features.includes("uploads"))
  );
}

export const ai = {
  /** True when the host can answer AI requests for this viewer. */
  available: () => store.init.features.includes("ai") && !store.local,
  /** A short answer from OCSC Intelligence; with json the reply is parsed. No tools, no data access. */
  async ask<T = string>(prompt: string, options: { json?: boolean } = {}): Promise<T> {
    return send<T>({ op: "ai.ask", prompt: prompt.slice(0, 8000), json: options.json }, 90_000);
  },
};

const MAX_TILES = 400;
const tiles = new Map<string, Promise<string | null>>();

export const maps = {
  /** True when the host can draw map backgrounds and look up places for this app. */
  available: () => store.init.features.includes("maps") && !store.local,
  /** One map square as a picture URL, or null when it can't be had; kept while the app is open. */
  tile(style: MapStyle, z: number, x: number, y: number): Promise<string | null> {
    if (!maps.available()) return Promise.resolve(null);
    const key = `${style}/${z}/${x}/${y}`;
    const known = tiles.get(key);
    if (known) {
      tiles.delete(key);
      tiles.set(key, known);
      return known;
    }
    const promise = send<{ mime: string; base64: string }>(
      { op: "map.tile", style, z, x, y },
      15_000,
    ).then(
      (tile) => `data:${tile.mime};base64,${tile.base64}`,
      () => {
        tiles.delete(key);
        return null;
      },
    );
    tiles.set(key, promise);
    if (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value!);
    return promise;
  },
  /** Places matching an address, Eircode, postcode or name, best first (up to five). */
  async find(query: string): Promise<MapPlace[]> {
    const text = query.trim().slice(0, 200);
    if (!text || !maps.available()) return [];
    return send<MapPlace[]>({ op: "map.find", query: text }, 15_000);
  },
};

const has = (feature: string) => !store.local && store.init.features.includes(feature);

/** Waits a moment before asking, so typing a search sends one request, not one per key. */
function useServerAnswer<T>(
  ask: (() => Promise<T>) | null,
  local: () => T,
  deps: unknown[],
  empty: T,
  delayMs = 200,
): { data: T; loading: boolean; error: string | null } {
  const current = useStore();
  const [state, setState] = useState<{ data: T; loading: boolean; error: string | null }>({
    data: empty,
    loading: true,
    error: null,
  });
  const ready = current.status === "ready";
  const revision = current.init.revision;
  const saved = writes;
  useEffect(() => {
    if (!ready) return;
    if (!ask) {
      setState({ data: local(), loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((before) => ({ ...before, loading: true }));
    const timer = setTimeout(() => {
      ask().then(
        (data) => {
          if (!cancelled) setState({ data, loading: false, error: null });
        },
        (error: unknown) => {
          if (!cancelled)
            setState((before) => ({
              ...before,
              loading: false,
              error: error instanceof Error ? error.message : "That did not load.",
            }));
        },
      );
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, revision, saved, ...deps]);
  return state;
}

export type RowsApi<T extends Record<string, unknown> = Record<string, unknown>> = {
  rows: Array<Row & T>;
  /** How many rows match, across every page. */
  total: number;
  pages: number;
  loading: boolean;
  error: string | null;
  schema: TableSchema | null;
};

/**
 * One page of a table's rows, searched, filtered and sorted by the server: the way to show a
 * large table (and fine for any). It reads again when anyone changes the data, so it stays live.
 * Search needs every word somewhere in the row; filters compare one column each.
 */
export function useRows<T extends Record<string, unknown> = Record<string, unknown>>(
  table: string,
  query: RowQuery = {},
  options: { skip?: boolean } = {},
): RowsApi<T> {
  const current = useStore();
  const schema = current.init.tables[table]?.schema ?? null;
  const key = JSON.stringify(query);
  const skip = Boolean(options.skip);
  const { data, loading, error } = useServerAnswer<QueryResult>(
    has("query") && !skip ? () => send<QueryResult>({ op: "rows.query", table, query }) : null,
    () => {
      const held = store.init.tables[table];
      return held && !skip ? runQuery(held.schema, held.rows, query) : { rows: [], total: 0 };
    },
    [table, key, skip],
    { rows: [], total: 0 },
  );
  const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);
  const rows = useMemo(
    () =>
      (schema ? data.rows.map((row) => withFormulas(schema, row)) : data.rows) as Array<Row & T>,
    [data.rows, schema],
  );
  return {
    rows,
    total: data.total,
    pages: Math.max(1, Math.ceil(data.total / pageSize)),
    loading,
    error,
    schema,
  };
}

/**
 * Counts, sums, averages, minimums and maximums over a table (or the rows matching filters),
 * optionally one group per value of a column or per day, week, month or year of a date column.
 * Worked out by the server, so it suits large tables and dashboards; it stays live.
 */
export function useAggregate(
  table: string,
  query: AggregateQuery = {},
  options: { skip?: boolean } = {},
): AggregateResult & { loading: boolean; error: string | null } {
  const key = JSON.stringify(query);
  const skip = Boolean(options.skip);
  const { data, loading, error } = useServerAnswer<AggregateResult>(
    has("query") && !skip
      ? () => send<AggregateResult>({ op: "rows.aggregate", table, query })
      : null,
    () => {
      const held = store.init.tables[table];
      return held && !skip ? runAggregate(held.schema, held.rows, query) : { groups: [], total: 0 };
    },
    [table, key, skip],
    { groups: [], total: 0 },
    0,
  );
  return { ...data, loading, error };
}

/**
 * Who else has the app open right now (people signed in), and what each has open. Pair it with
 * useFocus so others see which row you are on.
 */
export function usePresence(): { others: AppPresence[]; me: AppPresence | null } {
  useStore();
  return {
    others: presence.filter((person) => !person.me),
    me: presence.find((person) => person.me) ?? null,
  };
}

/** Tells others which row this viewer has open while the component is shown. */
export function useFocus(table: string | null | undefined, rowId: string | null | undefined) {
  useEffect(() => {
    const next = table && rowId ? { table, rowId } : null;
    focus = next;
    if (!store.local && hosted() && !evolveBridge())
      void send({ op: "presence.set", focus: next }).catch(() => {});
    return () => {
      if (focus?.table !== next?.table || focus?.rowId !== next?.rowId) return;
      focus = null;
      if (!store.local && hosted() && !evolveBridge())
        void send({ op: "presence.set", focus: null }).catch(() => {});
    };
  }, [table, rowId]);
}

const localComments = new Map<string, AppComment[]>();

/**
 * The conversation on one row: comments oldest first, adding (needs a click, like saving) and
 * removing your own. available is false for visitors with only the password, and in previews
 * comments stay in the page.
 */
export function useComments(table: string, rowId: string | null | undefined) {
  const current = useStore();
  const available = has("comments");
  const localKey = `${table}:${rowId}`;
  const [, redraw] = useState(0);
  const { data, loading, error } = useServerAnswer<AppComment[]>(
    available && rowId ? () => send<AppComment[]>({ op: "comments.list", table, rowId }) : null,
    () => (rowId ? (localComments.get(localKey) ?? []) : []),
    [table, rowId, available],
    [],
    0,
  );
  const [added, setAdded] = useState<AppComment[]>([]);
  useEffect(() => setAdded([]), [data]);
  const comments = useMemo(() => {
    const known = new Set(data.map((comment) => comment.id));
    return [...data, ...added.filter((comment) => !known.has(comment.id))];
  }, [data, added]);
  const add = useCallback(
    async (body: string) => {
      const text = body.trim();
      if (!text || !rowId) return;
      if (!available) {
        const comment: AppComment = {
          id: newId(),
          body: text,
          by: current.init.viewer.name ?? "You",
          mine: true,
          createdAt: new Date().toISOString(),
        };
        localComments.set(localKey, [...(localComments.get(localKey) ?? []), comment]);
        redraw((value) => value + 1);
        return;
      }
      const saved = await send<AppComment>({ op: "comments.add", table, rowId, body: text });
      setAdded((list) => [...list, saved]);
    },
    [available, table, rowId, localKey, current.init.viewer.name],
  );
  const remove = useCallback(
    async (commentId: string) => {
      if (!available) {
        localComments.set(
          localKey,
          (localComments.get(localKey) ?? []).filter((comment) => comment.id !== commentId),
        );
        redraw((value) => value + 1);
        return;
      }
      await send({ op: "comments.remove", commentId });
      setAdded((list) => list.filter((comment) => comment.id !== commentId));
    },
    [available, localKey],
  );
  return {
    comments: available ? comments : rowId ? (localComments.get(localKey) ?? []) : [],
    loading: available && loading,
    error,
    /** Comments are kept on the server for everyone (false for visitors and previews). */
    available,
    /** Whether this viewer may write one: anyone signed in, or anyone in a preview. */
    canComment: available || current.local,
    /** The owner may remove anyone's comment; others only their own (comment.mine). */
    canRemoveAny: current.init.viewer.role === "owner",
    add,
    remove,
  };
}

/** How many comments each row of a table has, for badges in lists. */
export function useCommentCounts(table: string): Record<string, number> {
  const { data } = useServerAnswer<Record<string, number>>(
    has("comments") ? () => send<Record<string, number>>({ op: "comments.counts", table }) : null,
    () => {
      const counts: Record<string, number> = {};
      for (const [key, list] of localComments) {
        const [name, rowId] = key.split(":");
        if (name === table && rowId && list.length) counts[rowId] = list.length;
      }
      return counts;
    },
    [table],
    {},
    0,
  );
  return data;
}

/** What happened to one row, newest first: who added and changed it, and each change's columns. */
export function useRowHistory(table: string, rowId: string | null | undefined) {
  const available = has("history");
  const { data, loading, error } = useServerAnswer<AppRowChange[]>(
    available && rowId ? () => send<AppRowChange[]>({ op: "rows.history", table, rowId }) : null,
    () => [],
    [table, rowId, available],
    [],
    0,
  );
  return { changes: data, loading: available && loading, error, available };
}

/**
 * Evolve's records, read as the person viewing: only tools that read, and only what they could
 * see in Evolve themselves. When someone else's app shows them Evolve data, that copy then stops
 * saving, commenting and opening links until reopened, so their data stays with them.
 */
export const evolve = {
  available: () => has("evolve"),
  async read<T = unknown>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    return send<T>({ op: "evolve.read", tool, args }, 70_000);
  },
};

/** An Evolve read that loads with the component and again when asked (refresh). */
export function useEvolve<T = unknown>(tool: string, args: Record<string, unknown> = {}) {
  const [nonce, setNonce] = useState(0);
  const key = JSON.stringify(args);
  const available = has("evolve");
  const { data, loading, error } = useServerAnswer<T | null>(
    available ? () => evolve.read<T>(tool, args) : null,
    () => null,
    [tool, key, nonce, available],
    null,
    0,
  );
  return {
    data,
    loading: available && loading,
    error: available ? error : "Evolve data shows when the app is opened in OCSC Intelligence.",
    available,
    refresh: () => setNonce((value) => value + 1),
  };
}

export type WeatherDay = {
  date: string;
  max: number | null;
  min: number | null;
  rain: number | null;
  rainChance: number | null;
  wind: number | null;
  code: number | null;
  summary: string | null;
};
export type Weather = {
  timezone: string | null;
  current: {
    temperature: number | null;
    wind: number | null;
    code: number | null;
    summary: string | null;
  } | null;
  days: WeatherDay[];
  units: { temperature: string; rain: string; wind: string };
  source: string;
};
export type Rates = {
  base: string;
  date: string | null;
  rates: Record<string, number>;
  source: string;
};
export type Holiday = {
  date: string;
  name: string;
  localName: string | null;
  /** Regions it applies to (GB-ENG, GB-SCT…), or null for the whole country. */
  regions: string[] | null;
};

/** Free public data fetched by the server: no keys, no charge, cached. */
export const services = {
  available: () => has("services"),
  /** Today and the next days (1–16) at a place: temperatures °C, rain mm and chance %, wind km/h. */
  weather: (lat: number, lon: number, days = 7) =>
    send<Weather>({ op: "service", name: "weather", params: { lat, lon, days } }, 20_000),
  /** The European Central Bank's reference rates from a base currency (EUR by default). */
  rates: (base = "EUR", to?: string[]) =>
    send<Rates>({ op: "service", name: "rates", params: { base, to } }, 20_000),
  /** Public holidays for a country (IE, GB…) and year. */
  holidays: (country = "IE", year?: number) =>
    send<Holiday[]>({ op: "service", name: "holidays", params: { country, year } }, 20_000),
};

/** A service answer that loads with the component; null until it arrives or where unavailable. */
export function useService<T>(ask: () => Promise<T>, deps: unknown[]) {
  const available = has("services");
  const { data, loading, error } = useServerAnswer<T | null>(
    available ? ask : null,
    () => null,
    [available, ...deps],
    null,
    0,
  );
  return { data, loading: available && loading, error, available };
}

/** Saves text as a file for the reader (call from a click). */
export async function download(filename: string, text: string, mime = "text/plain") {
  if (store.local) {
    downloadLocally(filename, mime, text);
    return;
  }
  await send({ op: "download", filename: filename.slice(0, 120), mime, text });
}

/** Opens a web or mail link through the host (call from a click). */
export async function openLink(url: string) {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  if (store.local) {
    window.open(url, "_blank", "noopener");
    return;
  }
  await send({ op: "open", url });
}

function downloadLocally(filename: string, mime: string, text: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: mime }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

function toCsv(schema: TableSchema, rows: Row[]) {
  const quote = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const columns = schema.columns;
  return [
    columns.map((column) => quote(column.label)).join(","),
    ...rows.map((row) => columns.map((column) => quote(row[column.key])).join(",")),
  ].join("\n");
}

let picking = false;
let hovered: HTMLElement | null = null;

function setPicking(enabled: boolean) {
  picking = enabled;
  document.documentElement.toggleAttribute("data-ocsc-picking", enabled);
  if (!enabled && hovered) {
    hovered.removeAttribute("data-ocsc-hover");
    hovered = null;
  }
}

const LOC_SELECTOR = `[data-loc],[class*="${LOC_CLASS_PREFIX}"]`;

function pickTarget(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? (target.closest(LOC_SELECTOR) as HTMLElement | null) : null;
}

/** Where an element was written: its data-loc, or the place class a kit component passed on. */
function locOf(element: Element): string {
  const attribute = element.getAttribute("data-loc");
  if (attribute) return attribute;
  for (const name of element.classList) {
    const loc = locFromClass(name);
    if (loc) return loc;
  }
  return "";
}

function elementsAt(loc: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(LOC_SELECTOR)].filter(
    (element) => locOf(element) === loc,
  );
}

function patchElements(patch: Extract<AppEventMessage, { event: "patch" }>) {
  for (const element of elementsAt(patch.loc)) {
    element.classList.remove(...patch.remove);
    element.classList.add(...patch.add);
    for (const { from, to } of patch.texts) {
      if (!from || from === to) continue;
      for (const attribute of ["placeholder", "title", "alt", "aria-label"]) {
        if (element.getAttribute(attribute) === from) element.setAttribute(attribute, to);
      }
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const value = node.nodeValue ?? "";
        if (value.replace(/\s+/g, " ").trim() === from) {
          node.nodeValue = value.replace(value.trim(), to);
          break;
        }
      }
    }
  }
}

function markSelected(loc: string | null) {
  for (const element of document.querySelectorAll("[data-ocsc-selected]"))
    element.removeAttribute("data-ocsc-selected");
  if (loc) for (const element of elementsAt(loc)) element.setAttribute("data-ocsc-selected", "");
}

function installPicker() {
  const style = document.createElement("style");
  style.textContent =
    "[data-ocsc-picking] *{cursor:crosshair!important}[data-ocsc-hover],[data-ocsc-selected]{outline:2px solid hsl(95 49% 51%)!important;outline-offset:2px}[data-ocsc-selected]{outline-style:dashed!important}";
  document.head.append(style);
  document.addEventListener(
    "mouseover",
    (event) => {
      if (!picking) return;
      const element = pickTarget(event.target);
      if (hovered && hovered !== element) hovered.removeAttribute("data-ocsc-hover");
      hovered = element;
      element?.setAttribute("data-ocsc-hover", "");
    },
    true,
  );
  document.addEventListener(
    "click",
    (event) => {
      if (!picking) return;
      event.preventDefault();
      event.stopPropagation();
      const element = pickTarget(event.target);
      if (!element) return;
      window.parent.postMessage(
        {
          type: APP_PICK,
          loc: locOf(element),
          tag: element.tagName.toLowerCase(),
          text: (element.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160),
        },
        "*",
      );
    },
    true,
  );
}

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error) {
    console.error(`[app error] ${error.message}`);
    if (hosted())
      window.parent.postMessage(
        { type: "ocsc-app:error", message: error.message.slice(0, 500) },
        "*",
      );
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 32, fontFamily: "inherit" }}>
        <p style={{ fontWeight: 600, fontSize: 16, margin: 0 }}>This app hit a problem</p>
        <p style={{ opacity: 0.7, fontSize: 14 }}>{this.state.error.message}</p>
      </div>
    );
  }
}

/** Renders the app's top component; the builder calls this for App.tsx's default export. */
export function mount(App: ComponentType) {
  start();
  installPicker();
  window.addEventListener("error", (event) => {
    if (hosted())
      window.parent.postMessage(
        { type: "ocsc-app:error", message: String(event.message).slice(0, 500) },
        "*",
      );
  });
  const element =
    document.getElementById("root") ?? document.body.appendChild(document.createElement("div"));
  createRoot(element).render(
    <MotionConfig reducedMotion="user">
      <Boundary>
        <App />
      </Boundary>
    </MotionConfig>,
  );
}
