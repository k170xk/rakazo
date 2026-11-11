import type { AppViewer } from "@rakazo/app-kit/protocol";
import type { AppData } from "@rakazo/contracts";
import { SHARED_PAGE_PASSWORD_HEADER, SHARED_PAGE_PATH_PREFIX } from "@rakazo/contracts";
import type { SpaceQueries } from "./query";

type Row = Record<string, unknown>;
type Tables = AppData["tables"];

/**
 * Where an open app reads and keeps its data. The frame never reaches the network itself: every
 * request goes through one of these, which answers as the person looking (the owner through their
 * session, anyone else through the shared link, which the server checks again on every call).
 */
export type AppSource = {
  load: () => Promise<{
    tables: Tables;
    state: Record<string, unknown>;
    revision: number;
    viewer: AppViewer;
  }>;
  revision: () => Promise<number>;
  insert: (table: string, row: Row) => Promise<Row>;
  update: (table: string, id: string, patch: Row) => Promise<Row>;
  remove: (table: string, id: string) => Promise<void>;
  setState: (key: string, value: unknown) => Promise<boolean>;
  asset: (id: string) => Promise<{ mime: string; base64: string }>;
  exportTable: (
    table: string,
    format: "xlsx" | "csv",
  ) => Promise<{ filename: string; mime: string; base64: string }>;
  ask?: (prompt: string, json: boolean) => Promise<unknown>;
};

const STATE_KEY = /^[A-Za-z0-9_.:-]{1,64}$/;

export function ownerAppSource(
  queries: SpaceQueries,
  pageId: string,
  name: string | null,
): AppSource {
  return {
    load: async () => {
      const data = await queries.apps.data.call({ pageId });
      return {
        tables: data.tables,
        state: data.state,
        revision: data.revision,
        viewer: { name, canEdit: true, role: "owner" },
      };
    },
    revision: async () => (await queries.apps.revision.call({ pageId })).revision,
    insert: async (table, row) => (await queries.apps.insertRow.call({ pageId, table, row })).row,
    update: async (table, id, patch) =>
      (await queries.apps.updateRow.call({ pageId, table, id, patch })).row,
    remove: async (table, id) => {
      await queries.apps.removeRow.call({ pageId, table, id });
    },
    setState: (key, value) =>
      STATE_KEY.test(key)
        ? queries.pages.saveState.call({ pageId, key, value }).then(
            () => true,
            () => false,
          )
        : Promise.resolve(false),
    asset: (assetId) => queries.apps.asset.call({ pageId, assetId }),
    exportTable: (table, format) => queries.apps.export.call({ pageId, table, format }),
    ask: async (prompt, json) => (await queries.apps.ask.call({ pageId, prompt, json })).answer,
  };
}

/** Text answers carry the server's reason, so the app can show why a change was refused. */
async function refused(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return new Error(typeof body?.error === "string" ? body.error : `Refused (${response.status})`);
}

async function toBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  for (let at = 0; at < buffer.length; at += 0x8000) {
    text += String.fromCharCode(...buffer.subarray(at, at + 0x8000));
  }
  return btoa(text);
}

/** Someone holding the link: signed in to the company, or a visitor with the password. */
export function sharedAppSource(
  token: string,
  password: string | null,
  signedIn: boolean,
): AppSource {
  const base = `${SHARED_PAGE_PATH_PREFIX}${token}`;
  const headers: Record<string, string> = password
    ? { [SHARED_PAGE_PASSWORD_HEADER]: password }
    : {};
  const get = (path: string) =>
    fetch(`${base}/${path}`, {
      credentials: "same-origin",
      referrerPolicy: "no-referrer",
      headers,
    });
  const write = async (body: object) => {
    const response = await fetch(`${base}/app/rows`, {
      method: "POST",
      credentials: "same-origin",
      referrerPolicy: "no-referrer",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await refused(response);
    return (await response.json()) as { row?: Row; revision: number };
  };
  return {
    load: async () => {
      const response = await get("app/data");
      if (!response.ok) throw await refused(response);
      const data = (await response.json()) as AppData & { canEdit?: boolean };
      return {
        tables: data.tables,
        state: data.state,
        revision: data.revision,
        viewer: {
          name: null,
          canEdit: data.canEdit === true,
          role: signedIn ? "member" : "visitor",
        },
      };
    },
    revision: async () => {
      const response = await get("app/revision");
      if (!response.ok) throw await refused(response);
      return ((await response.json()) as { revision: number }).revision;
    },
    insert: async (table, row) => (await write({ op: "insert", table, row })).row ?? {},
    update: async (table, id, patch) => (await write({ op: "update", table, id, patch })).row ?? {},
    remove: async (table, id) => {
      await write({ op: "remove", table, id });
    },
    setState: async (key, value) => {
      if (!STATE_KEY.test(key)) return false;
      const response = await fetch(`${base}/state`, {
        method: "PUT",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ key, value: value ?? null }),
      }).catch(() => null);
      return response?.ok === true;
    },
    asset: async (id) => {
      const response = await get(`app/assets/${encodeURIComponent(id)}`);
      if (!response.ok) throw await refused(response);
      const blob = await response.blob();
      return { mime: blob.type || "application/octet-stream", base64: await toBase64(blob) };
    },
    exportTable: async (table, format) => {
      const response = await get(
        `app/export?table=${encodeURIComponent(table)}&format=${encodeURIComponent(format)}`,
      );
      if (!response.ok) throw await refused(response);
      return (await response.json()) as { filename: string; mime: string; base64: string };
    },
    ...(signedIn
      ? {
          ask: async (prompt: string, json: boolean) => {
            const response = await fetch(`${base}/app/ask`, {
              method: "POST",
              credentials: "same-origin",
              referrerPolicy: "no-referrer",
              headers: { ...headers, "content-type": "application/json" },
              body: JSON.stringify({ prompt, json }),
            });
            if (!response.ok) throw await refused(response);
            return ((await response.json()) as { answer: unknown }).answer;
          },
        }
      : {}),
  };
}

/** Saves a file the app produced, from the host page (the sandboxed frame cannot download). */
export function saveFile(filename: string, mime: string, data: string, base64: boolean) {
  const bytes = base64 ? Uint8Array.from(atob(data), (char) => char.charCodeAt(0)) : data;
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120) || "download";
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // Safari needs the URL a moment after the click.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
