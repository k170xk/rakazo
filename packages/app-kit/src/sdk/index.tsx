import { MotionConfig } from "motion/react";
import type { ComponentType, ReactNode } from "react";
import { Component, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type {
  AppEventMessage,
  AppInit,
  AppRequest,
  AppResponseMessage,
  AppViewer,
} from "../protocol.js";
import { APP_EVENT, APP_PICK, APP_REQUEST, APP_RESPONSE, MAX_UPLOAD_BYTES } from "../protocol.js";
import type { Row, TableSchema } from "../schema.js";
import { withFormulas } from "../schema.js";

export { formatValue } from "../schema.js";
export type { AppViewer, Row, TableSchema };

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
    window.parent.postMessage({ type: APP_REQUEST, id, ...request }, "*");
  });
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
    store.init = { ...store.init, tables: data.tables, revision: data.revision };
    changed();
  } else if (data.event === "select") {
    setPicking(data.enabled);
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
      const init = await send<AppInit>({ op: "init" });
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
      setInterval(() => {
        if (checking || document.visibilityState !== "visible") return;
        checking = true;
        send<{ revision: number }>({ op: "revision" })
          .then(async ({ revision }) => {
            if (revision <= store.init.revision) return;
            const data = await send<Pick<AppInit, "tables" | "revision">>({ op: "data" });
            if (data.revision < store.init.revision) return;
            store.init = { ...store.init, tables: data.tables, revision: data.revision };
            changed();
          })
          .catch(() => {})
          .finally(() => {
            checking = false;
          });
      }, EVOLVE_POLL_MS);
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
  send<AppInit>({ op: "init" }, 8000).then(
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

function replaceRows(table: string, update: (rows: Row[]) => Row[]) {
  const current = store.init.tables[table];
  if (!current) return;
  store.init = {
    ...store.init,
    tables: { ...store.init.tables, [table]: { ...current, rows: update(current.rows) } },
  };
  changed();
}

export type TableApi<T extends Record<string, unknown> = Record<string, unknown>> = {
  /** Rows with formula columns filled in; empty while loading. */
  rows: Array<Row & T>;
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
        replaceRows(name, (list) =>
          list.map((item) => (item._id === optimistic._id ? saved : item)),
        );
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
    rows,
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

function pickTarget(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? (target.closest("[data-loc]") as HTMLElement | null) : null;
}

function installPicker() {
  const style = document.createElement("style");
  style.textContent =
    "[data-ocsc-picking] *{cursor:crosshair!important}[data-ocsc-hover]{outline:2px solid hsl(95 49% 51%)!important;outline-offset:2px;border-radius:6px}";
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
          loc: element.getAttribute("data-loc") ?? "",
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
