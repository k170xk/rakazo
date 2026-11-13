import type { AggregateQuery, RowQuery } from "./query.js";
import type { Row, TableSchema } from "./schema.js";

/**
 * How an app talks to whatever shows it. The app runs in a sandboxed frame with no network, so
 * every read, write, picture and AI answer is a request the host checks and answers. The same
 * messages work in OCSC Intelligence, a shared link and Evolve, which is what lets one bundle
 * run everywhere.
 */
export const APP_REQUEST = "ocsc-app:request";
export const APP_RESPONSE = "ocsc-app:response";
export const APP_EVENT = "ocsc-app:event";

export type AppViewer = {
  name: string | null;
  /** May add, change and remove rows. */
  canEdit: boolean;
  /** Changes and removes only the rows they added (rows marked _mine); adding is open. */
  ownRowsOnly?: boolean;
  /** Who is looking: the owner, someone at OCSC, or a visitor with the password. */
  role: "owner" | "member" | "visitor" | "preview";
};

export type AppInit = {
  /** icon: the asset id of the app's generated OCSC icon, shown in its AppShell. */
  app: { id: string; title: string; version: number; icon?: string };
  viewer: AppViewer;
  theme: "light" | "dark";
  tables: Record<string, { schema: TableSchema; rows: Row[]; count?: number }>;
  state: Record<string, unknown>;
  revision: number;
  /**
   * Features the host offers: ai, export, assets, uploads, maps, and with a server behind it
   * live (presence), query (large tables), comments, history, evolve and services.
   */
  features: string[];
};

/** The row someone has open, so others see who is looking at what. */
export type AppFocus = { table: string; rowId: string };

/** Someone signed in who has the app open now; me marks the viewer themselves. */
export type AppPresence = { id: string; name: string; focus: AppFocus | null; me?: boolean };

export type AppComment = {
  id: string;
  body: string;
  /** Who wrote it; null once their account is gone. */
  by: string | null;
  /** The viewer wrote it, so they may remove it (the app's owner may remove any). */
  mine: boolean;
  createdAt: string;
};

/** One change to a row, newest first, with each column as it was and as it became. */
export type AppRowChange = {
  id: string;
  action: "added" | "changed" | "removed";
  summary: string;
  by: string | null;
  via: string | null;
  at: string;
  fields?: Array<{ key: string; label: string; before: unknown; after: unknown }>;
};

/**
 * What changed since a revision: every table's schema (large ones with their row count), the rows
 * added or changed, and the ids removed. Large tables send no rows; apps read them again.
 */
export type AppDelta = {
  revision: number;
  tables: Record<string, { schema: TableSchema; count?: number }>;
  rows: Record<string, Row[]>;
  removed: Record<string, string[]>;
};

/** The answer to a live check: the revision, who is here, and the changes or a full reload. */
export type AppLive = {
  revision: number;
  presence: AppPresence[];
  delta: AppDelta | null;
  /** Too much changed (or too long ago) for a delta; read everything again. */
  full: boolean;
};

/** Free public data an app may ask the server for, with no keys and no charge. */
export const APP_SERVICES = ["weather", "rates", "holidays"] as const;
export type AppService = (typeof APP_SERVICES)[number];

export type AppRequest =
  /** accepts lists the events this app understands beyond the first ones (delta, presence). */
  | { op: "init"; accepts?: string[] }
  | { op: "rows.insert"; table: string; row: Record<string, unknown> }
  | { op: "rows.update"; table: string; id: string; patch: Record<string, unknown> }
  | { op: "rows.remove"; table: string; id: string }
  | { op: "state.set"; key: string; value: unknown }
  | { op: "asset"; id: string }
  /** A photo the person picked, already shrunk by the app; answers with its picture id. */
  | { op: "upload"; name: string; mime: string; base64: string }
  | { op: "ai.ask"; prompt: string; json?: boolean }
  | { op: "export"; table: string; format: "xlsx" | "csv" }
  | { op: "download"; filename: string; mime: string; text: string }
  | { op: "open"; url: string }
  /** One square of a map: style is a MAP_STYLES id; answers as an asset ({mime, base64}). */
  | { op: "map.tile"; style: string; z: number; x: number; y: number }
  /** Places matching an address or name, best first: [{label, lat, lon}]. */
  | { op: "map.find"; query: string }
  /** Answers AppLive: changes since a revision and who is here (the host asks it on a timer). */
  | { op: "live"; since: number; focus?: AppFocus | null }
  /** What this viewer has open, for others' presence; the host sends it with its next check. */
  | { op: "presence.set"; focus: AppFocus | null }
  /** A page of a table's rows: {rows, total}. */
  | { op: "rows.query"; table: string; query: RowQuery }
  /** Counts and sums: {groups, total}. */
  | { op: "rows.aggregate"; table: string; query: AggregateQuery }
  /** AppRowChange[] for one row. */
  | { op: "rows.history"; table: string; rowId: string }
  | { op: "comments.list"; table: string; rowId: string }
  | { op: "comments.add"; table: string; rowId: string; body: string }
  | { op: "comments.remove"; commentId: string }
  /** How many comments each row of a table has: {rowId: count}. */
  | { op: "comments.counts"; table: string }
  /** An Evolve tool that only reads, run as the viewer: what they could see in Evolve. */
  | { op: "evolve.read"; tool: string; args?: Record<string, unknown> }
  | { op: "service"; name: AppService; params?: Record<string, unknown> };

/**
 * id names the message, so a request's own id (a row or picture) travels as ref; frames built
 * before ref existed sent that id in place of the message id, which hosts still accept.
 */
export type AppRequestMessage = { type: typeof APP_REQUEST; id: string; ref?: string } & AppRequest;

/** The row or picture a request names, from ref or, for older frames, id. */
export function requestRef(message: AppRequestMessage): string {
  return String(typeof message.ref === "string" ? message.ref : message.id);
}

/** A request as a frame posts it: its own id moves to ref so the message id is kept. */
export function requestMessage(id: string, request: AppRequest): AppRequestMessage {
  return {
    ...request,
    type: APP_REQUEST,
    id,
    ...("id" in request ? { ref: request.id } : {}),
  } as AppRequestMessage;
}

export type AppResponseMessage = {
  type: typeof APP_RESPONSE;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type AppEventMessage =
  | { type: typeof APP_EVENT; event: "theme"; theme: "light" | "dark" }
  | {
      type: typeof APP_EVENT;
      event: "tables";
      revision: number;
      /** The app's icon asset, when it has one. */
      icon?: string;
      tables: Record<string, { schema: TableSchema; rows: Row[]; count?: number }>;
    }
  | { type: typeof APP_EVENT; event: "select"; enabled: boolean }
  /**
   * A visual edit shown at once, before it is saved: every element written at loc swaps the
   * listed classes and words. The saved version replaces it when it loads.
   */
  | {
      type: typeof APP_EVENT;
      event: "patch";
      loc: string;
      remove: string[];
      add: string[];
      texts: Array<{ from: string; to: string }>;
    }
  /** Outlines the element being edited, or clears the outline when loc is null. */
  | { type: typeof APP_EVENT; event: "selected"; loc: string | null }
  /** Rows others changed, for an app whose init accepted delta. */
  | { type: typeof APP_EVENT; event: "delta"; delta: AppDelta }
  | { type: typeof APP_EVENT; event: "presence"; people: AppPresence[] };

export const APP_OPS = new Set<AppRequest["op"]>([
  "init",
  "rows.insert",
  "rows.update",
  "rows.remove",
  "state.set",
  "asset",
  "upload",
  "ai.ask",
  "export",
  "download",
  "open",
  "map.tile",
  "map.find",
  "live",
  "presence.set",
  "rows.query",
  "rows.aggregate",
  "rows.history",
  "comments.list",
  "comments.add",
  "comments.remove",
  "comments.counts",
  "evolve.read",
  "service",
]);

/** Ops the server answers through one call route, as the person looking. */
export const APP_CALL_OPS = new Set<AppRequest["op"]>([
  "live",
  "rows.query",
  "rows.aggregate",
  "rows.history",
  "comments.list",
  "comments.add",
  "comments.remove",
  "comments.counts",
  "evolve.read",
  "service",
]);

/** Ops that write as the viewer without needing edit rights: anyone signed in may comment. */
export const APP_COMMENT_OPS = new Set<AppRequest["op"]>(["comments.add", "comments.remove"]);

/** Ops that change something or leave the frame; the host gates them by the viewer. */
export const APP_WRITE_OPS = new Set<AppRequest["op"]>([
  "rows.insert",
  "rows.update",
  "rows.remove",
  "state.set",
  "upload",
]);

/** Photos people add from an app: kinds, the largest one after shrinking, and the base64 cap. */
export const UPLOAD_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_BASE64 = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;
/** Ops that need a click or key in the frame first (downloads and links). */
export const APP_GESTURE_OPS = new Set<AppRequest["op"]>(["download", "open", "export"]);

/** A request from a frame, or null when it is not one this protocol knows. */
export function readAppRequest(data: unknown): AppRequestMessage | null {
  if (!data || typeof data !== "object") return null;
  const message = data as Partial<AppRequestMessage>;
  if (message.type !== APP_REQUEST || typeof message.id !== "string" || message.id.length > 64)
    return null;
  if (!APP_OPS.has(message.op as AppRequest["op"])) return null;
  return message as AppRequestMessage;
}

/** Messages the element picker in the Studio sends up: which source line was clicked. */
export const APP_PICK = "ocsc-app:pick";
export type AppPickMessage = { type: typeof APP_PICK; loc: string; tag: string; text: string };

/**
 * Map backgrounds an app can show, from the free tile services the site inspections use
 * (OpenStreetMap, Esri, OpenTopoMap): no keys and no charge. Tiles are fetched by the server,
 * never by the app.
 */
export const MAP_STYLES = {
  streets: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — World Imagery",
    maxZoom: 19,
  },
  // CARTO's light and dark basemaps now answer every keyless request with an "API key required"
  // picture, so the quiet backgrounds come from Esri's canvas maps, the satellite layer's service.
  light: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors",
    maxZoom: 16,
  },
  dark: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors",
    maxZoom: 16,
  },
  terrain: {
    url: "https://tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)",
    maxZoom: 17,
  },
} as const;
export type MapStyle = keyof typeof MAP_STYLES;

/** The tile's address at its service, or null when the request is not a real tile. */
export function mapTileUrl(style: string, z: number, x: number, y: number): string | null {
  const entry = Object.hasOwn(MAP_STYLES, style) ? MAP_STYLES[style as MapStyle] : null;
  if (!entry || !Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (z < 0 || z > entry.maxZoom) return null;
  const size = 2 ** z;
  if (x < 0 || y < 0 || x >= size || y >= size) return null;
  return entry.url.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

export type MapPlace = { label: string; lat: number; lon: number };

/** Where hosts fetch tiles (/tile/:style/:z/:x/:y) and places (/find?q=) for signed-in staff. */
export const APP_MAPS_PATH = "/api/app-maps";

/**
 * Where the owner's copy posts APP_CALL_OPS (/:pageId); a shared link posts them to app/call under
 * its own path. Both answer {result} or {error}.
 */
export const APP_CALLS_PATH = "/api/app-calls";
export const SHARED_APP_CALL_PATH = "app/call";
