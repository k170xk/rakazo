import { combineSignals } from "./connector-safety.js";

const GRAPH = "https://graph.microsoft.com/v1.0";
const REQUEST_TIMEOUT_MS = 30_000;
const CHILD_LIMIT = 250;

/** Outlook refused or could not be reached; the message is safe to show the person. */
export class OutlookFilingError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OutlookFilingError";
  }
}

/**
 * Writes to the person's mailbox for their own press of File or Undo on a filing card. Only the
 * API route builds one, with that person's Mail.ReadWrite token; runs never reach it.
 */
export interface FilingGraph {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

function refusal(status: number, text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    if (parsed.error?.message) return `Outlook refused it: ${parsed.error.message}`;
  } catch {}
  if (status === 401 || status === 403)
    return "Outlook refused this for your account. Reconnect Outlook in Connectors and try again.";
  if (status === 404) return "Outlook could not find it any more.";
  return `Outlook refused it (HTTP ${status}).`;
}

function segment(id: string): string {
  if (!id || id.length > 512 || /[\s'"\\]/.test(id) || id === "." || id === "..") {
    throw new OutlookFilingError("That is not an Outlook id.");
  }
  return encodeURIComponent(id);
}

export function createFilingGraph(
  token: string,
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): FilingGraph {
  const http = options.fetch ?? globalThis.fetch;
  const call = async <T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> => {
    if (!path.startsWith("/me/")) throw new OutlookFilingError("Only your own mailbox is filed.");
    let response: Response;
    try {
      response = await http(`${GRAPH}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: combineSignals(options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)),
      });
    } catch {
      throw new OutlookFilingError("Outlook could not be reached. Try again.");
    }
    const text = await response.text().catch(() => "");
    if (!response.ok) throw new OutlookFilingError(refusal(response.status, text), response.status);
    return (text ? JSON.parse(text) : {}) as T;
  };
  return {
    get: (path) => call("GET", path),
    post: (path, body) => call("POST", path, body),
  };
}

export interface OutlookMessageState {
  id: string;
  parentFolderId: string | null;
  webLink: string | null;
}

/** Where the email is now, or null once it is deleted or no longer in this mailbox. */
export async function readMessageState(
  graph: FilingGraph,
  messageId: string,
): Promise<OutlookMessageState | null> {
  try {
    const message = await graph.get<{ id: string; parentFolderId?: string; webLink?: string }>(
      `/me/messages/${segment(messageId)}?$select=id,parentFolderId,webLink`,
    );
    return {
      id: message.id,
      parentFolderId: message.parentFolderId ?? null,
      webLink: message.webLink ?? null,
    };
  } catch (error) {
    if (error instanceof OutlookFilingError && error.status === 404) return null;
    throw error;
  }
}

/** Moves one email; Outlook gives the moved copy a new id, which Undo needs. */
export async function moveOutlookMessage(
  graph: FilingGraph,
  messageId: string,
  destinationId: string,
): Promise<OutlookMessageState> {
  const moved = await graph.post<{ id: string; parentFolderId?: string; webLink?: string }>(
    `/me/messages/${segment(messageId)}/move`,
    { destinationId },
  );
  return {
    id: moved.id,
    parentFolderId: moved.parentFolderId ?? destinationId,
    webLink: moved.webLink ?? null,
  };
}

export interface ChildFolder {
  id: string;
  displayName: string;
}

export async function listChildFolders(
  graph: FilingGraph,
  parentId: string,
): Promise<ChildFolder[]> {
  const listed = await graph.get<{ value?: Array<{ id: string; displayName?: string }> }>(
    `/me/mailFolders/${segment(parentId)}/childFolders?$top=${CHILD_LIMIT}&$select=id,displayName`,
  );
  return (listed.value ?? []).map((folder) => ({
    id: folder.id,
    displayName: folder.displayName ?? "",
  }));
}

/**
 * The child folder that `matches` picks, created with `name` only when none does. Outlook refuses a
 * second folder of the same name, so a race with another filing reuses the one that won.
 */
export async function ensureChildFolder(
  graph: FilingGraph,
  parentId: string,
  name: string,
  matches: (folder: ChildFolder) => boolean,
): Promise<{ folder: ChildFolder; created: boolean }> {
  const existing = (await listChildFolders(graph, parentId)).find(matches);
  if (existing) return { folder: existing, created: false };
  try {
    const created = await graph.post<{ id: string; displayName?: string }>(
      `/me/mailFolders/${segment(parentId)}/childFolders`,
      { displayName: name, isHidden: false },
    );
    return { folder: { id: created.id, displayName: created.displayName ?? name }, created: true };
  } catch (error) {
    if (error instanceof OutlookFilingError && error.status === 409) {
      const winner = (await listChildFolders(graph, parentId)).find(matches);
      if (winner) return { folder: winner, created: false };
    }
    throw error;
  }
}
