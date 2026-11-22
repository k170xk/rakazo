import type { DocumentFormat } from "@rakazo/contracts";
import { DocumentFormatSchema } from "@rakazo/contracts";

const SETTINGS_SECTIONS = [
  "general",
  "organization",
  "space",
  "models",
  "memory",
  "voice",
  "confirmations",
  "vault",
  "email",
  "messaging",
  "wallet",
  "usage",
  "computer",
  "billing",
  "updates",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Set once for the whole company in the admin panel, so they are not in anyone's Settings. */
const COMPANY_SETTINGS_SECTIONS = ["models", "voice", "computer"] as const;
export type CompanySettingsSection = (typeof COMPANY_SETTINGS_SECTIONS)[number];

export function isCompanySettingsSection(section: string): section is CompanySettingsSection {
  return (COMPANY_SETTINGS_SECTIONS as readonly string[]).includes(section);
}

/** The shell overlay a URL opens; the URL is its only source of truth so links and reloads keep it. */
export type ShellOverlay =
  | { kind: "settings"; section: SettingsSection; spaceId: string | null }
  | { kind: "integrations" }
  | { kind: "skills" }
  | { kind: "mcp"; serverId?: string }
  | { kind: "tour" }
  | { kind: "todos" }
  | { kind: "whiteboards" }
  | { kind: "apps" }
  /** A Word, PowerPoint or Excel studio: `?doc=<rootArtifactId>[&kind=docx]`; no id opens the newest. */
  | { kind: "doc"; id: string | null; format: DocumentFormat | null }
  | null;

const OVERLAY_KEYS = [
  "doc",
  "kind",
  "settings",
  "space",
  "integrations",
  "skills",
  "mcp",
  "messaging",
  "tour",
  "todos",
  "whiteboards",
  "apps",
] as const;

function isSettingsSection(value: string): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

export function readShellOverlay(params: URLSearchParams): ShellOverlay {
  const section = params.get("settings");
  if (section !== null) {
    return {
      kind: "settings",
      section: isSettingsSection(section) && section !== "general" ? section : "organization",
      spaceId: params.get("space") || null,
    };
  }
  if (params.has("integrations")) return { kind: "integrations" };
  if (params.has("skills")) return { kind: "skills" };
  if (params.has("tour")) return { kind: "tour" };
  if (params.has("todos")) return { kind: "todos" };
  if (params.has("whiteboards")) return { kind: "whiteboards" };
  if (params.has("apps")) return { kind: "apps" };
  if (params.has("doc")) {
    const format = DocumentFormatSchema.safeParse(params.get("kind"));
    return {
      kind: "doc",
      id: params.get("doc") || null,
      format: format.success ? format.data : null,
    };
  }
  if (params.has("mcp")) {
    const serverId = params.get("mcp");
    return serverId ? { kind: "mcp", serverId } : { kind: "mcp" };
  }
  // Links from before Messaging moved into settings.
  if (params.has("messaging")) return { kind: "settings", section: "messaging", spaceId: null };
  return null;
}

/** `params` with only `overlay` open; every other param is kept. */
export function withShellOverlay(params: URLSearchParams, overlay: ShellOverlay): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of OVERLAY_KEYS) next.delete(key);
  if (overlay?.kind === "settings") {
    next.set("settings", overlay.section);
    if (overlay.spaceId) next.set("space", overlay.spaceId);
  } else if (overlay?.kind === "mcp") {
    next.set("mcp", overlay.serverId ?? "");
  } else if (overlay?.kind === "doc") {
    next.set("doc", overlay.id ?? "");
    if (overlay.format) next.set("kind", overlay.format);
  } else if (overlay) {
    next.set(overlay.kind, "");
  }
  return next;
}

/** A `?search` string that writes flag params bare (`?integrations`, not `?integrations=`). */
export function searchString(params: URLSearchParams): string {
  const query = params.toString().replace(/=(?=&|$)/g, "");
  return query ? `?${query}` : "";
}

/** Only the overlay params, for redirects that change the route but should keep the overlay open. */
export function shellOverlaySearch(params: URLSearchParams): string {
  const next = withShellOverlay(new URLSearchParams(), readShellOverlay(params));
  // The plan choice opens above the shell from its own link, so it survives the redirect too.
  if (params.has("plans")) next.set("plans", "");
  return searchString(next);
}

/** Routes under `/app` that are not a chat, so a chat move must not treat them as one. */
const SHELL_CHAT_RESERVED = new Set(["artifacts", "board", "x"]);

/** A shell chat: `/app`, `/app/:botId`, `/app/:botId/c/:threadId`, or `/app/g/:groupId`. The board, files and plugin pages are not. */
export function isShellChatPath(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "app") return false;
  if (parts.length === 1) return true;
  if (parts.length === 2) return parts[1] !== "g" && !SHELL_CHAT_RESERVED.has(parts[1]!);
  if (parts.length === 3) return parts[1] === "g" && parts[2]!.length > 0;
  return (
    parts.length === 4 &&
    parts[1] !== "g" &&
    !SHELL_CHAT_RESERVED.has(parts[1]!) &&
    parts[2] === "c" &&
    parts[3]!.length > 0
  );
}

/** Only the open document studio. A chat change keeps this and nothing else. */
export function documentOverlaySearch(params: URLSearchParams): string {
  const overlay = readShellOverlay(params);
  if (overlay?.kind !== "doc") return "";
  return searchString(withShellOverlay(new URLSearchParams(), overlay));
}

/**
 * A same-space chat move keeps the open Word, PowerPoint, Excel or PDF studio.
 * The path is returned unchanged when it is not a chat, already names a document, or opens a
 * page: closing the studio, opening another file, and opening a page stay as they are.
 * Settings, message highlights and routine editors are not carried across.
 */
export function withDocumentOverlay(path: string, current: URLSearchParams | string): string {
  const hashAt = path.indexOf("#");
  const hash = hashAt === -1 ? "" : path.slice(hashAt);
  const bare = hashAt === -1 ? path : path.slice(0, hashAt);
  const queryAt = bare.indexOf("?");
  const pathname = queryAt === -1 ? bare : bare.slice(0, queryAt);
  if (!isShellChatPath(pathname)) return path;
  const next = new URLSearchParams(queryAt === -1 ? "" : bare.slice(queryAt + 1));
  // A page owns the chat dock, and a path that already names a document chose that file.
  if (next.has("doc") || next.has("page") || next.has("view")) return path;
  const carried = documentOverlaySearch(
    typeof current === "string" ? new URLSearchParams(current) : current,
  );
  if (!carried) return path;
  const doc = new URLSearchParams(carried.slice(1));
  for (const [key, value] of doc) next.set(key, value);
  return `${pathname}${searchString(next)}${hash}`;
}
