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
  /** Who is looking: the owner, someone at OCSC, or a visitor with the password. */
  role: "owner" | "member" | "visitor" | "preview";
};

export type AppInit = {
  app: { id: string; title: string; version: number };
  viewer: AppViewer;
  theme: "light" | "dark";
  tables: Record<string, { schema: TableSchema; rows: Row[] }>;
  state: Record<string, unknown>;
  revision: number;
  /** Features the host offers: ai, export, assets. */
  features: string[];
};

export type AppRequest =
  | { op: "init" }
  | { op: "rows.insert"; table: string; row: Record<string, unknown> }
  | { op: "rows.update"; table: string; id: string; patch: Record<string, unknown> }
  | { op: "rows.remove"; table: string; id: string }
  | { op: "state.set"; key: string; value: unknown }
  | { op: "asset"; id: string }
  | { op: "ai.ask"; prompt: string; json?: boolean }
  | { op: "export"; table: string; format: "xlsx" | "csv" }
  | { op: "download"; filename: string; mime: string; text: string }
  | { op: "open"; url: string };

export type AppRequestMessage = { type: typeof APP_REQUEST; id: string } & AppRequest;

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
      tables: Record<string, { schema: TableSchema; rows: Row[] }>;
    }
  | { type: typeof APP_EVENT; event: "select"; enabled: boolean };

export const APP_OPS = new Set<AppRequest["op"]>([
  "init",
  "rows.insert",
  "rows.update",
  "rows.remove",
  "state.set",
  "asset",
  "ai.ask",
  "export",
  "download",
  "open",
]);

/** Ops that change something or leave the frame; the host gates them by the viewer. */
export const APP_WRITE_OPS = new Set<AppRequest["op"]>([
  "rows.insert",
  "rows.update",
  "rows.remove",
  "state.set",
]);
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
