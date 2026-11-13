import { fetchSafeHttpRequest } from "./web-ssrf.js";

const TTL_MS = 60 * 60_000;
const cache = new Map<string, { expires: number; usable: boolean }>();

export type McpProbeResponse = { status: number; headers: Headers; body: Uint8Array };
export type McpProbe = (
  url: string,
  request: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<McpProbeResponse>;

/** A host that only exists in tests. Probing it would wait on DNS. */
function reservedHost(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname;
    return (
      host === "localhost" ||
      host.endsWith(".test") ||
      host.endsWith(".example") ||
      host.endsWith(".invalid") ||
      host.endsWith(".localhost")
    );
  } catch {
    return true;
  }
}

/** RFC 9728: the protected-resource document sits beside the MCP path. */
export function protectedResourceMetadataUrl(endpoint: string): string {
  const url = new URL(endpoint);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return `${url.origin}/.well-known/oauth-protected-resource${path}`;
}

function text(body: Uint8Array): string {
  return new TextDecoder().decode(body);
}

function registrationEndpoint(body: Uint8Array): string | null {
  try {
    const parsed = JSON.parse(text(body)) as { registration_endpoint?: unknown };
    const endpoint = parsed.registration_endpoint;
    return typeof endpoint === "string" && endpoint.startsWith("https://") ? endpoint : null;
  } catch {
    return null;
  }
}

function authorizationServers(body: Uint8Array): string[] {
  try {
    const parsed = JSON.parse(text(body)) as { authorization_servers?: unknown };
    return Array.isArray(parsed.authorization_servers)
      ? parsed.authorization_servers.filter(
          (server): server is string => typeof server === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function resourceMetadataUrl(headers: Headers): string | null {
  const header = headers.get("www-authenticate") ?? "";
  const match = /resource_metadata="([^"]+)"/.exec(header);
  return match?.[1]?.startsWith("https://") ? match[1] : null;
}

const defaultProbe: McpProbe = (url, request) =>
  fetchSafeHttpRequest(url, request, { maxBytes: 100_000, signal: AbortSignal.timeout(8_000) });

/**
 * Whether a remote MCP address can be connected here. True when it answers without a sign-in, or
 * its sign-in can register this app on its own. False when it needs a client the vendor must
 * register in advance (or never asks for a sign-in at all). Null when the check itself failed,
 * so a slow server stays listed.
 */
export async function remoteMcpConnectorUsable(
  endpoint: string,
  probe: McpProbe = defaultProbe,
): Promise<boolean | null> {
  if (reservedHost(endpoint)) return null;
  const cached = cache.get(endpoint);
  if (cached && cached.expires > Date.now()) return cached.usable;
  let usable: boolean | null;
  try {
    usable = await check(endpoint, probe);
  } catch {
    return null;
  }
  if (usable !== null) cache.set(endpoint, { usable, expires: Date.now() + TTL_MS });
  return usable;
}

async function check(endpoint: string, probe: McpProbe): Promise<boolean | null> {
  const listed = await probe(protectedResourceMetadataUrl(endpoint), { method: "GET" }).catch(
    () => null,
  );
  const document = listed?.status === 200 ? listed : await advertisedDocument(endpoint, probe);
  if (document) {
    const servers = authorizationServers(document.body).slice(0, 3);
    if (!servers.length) return false;
    for (const issuer of servers) {
      if (await issuerRegistersClients(issuer, probe)) return true;
    }
    return false;
  }
  const initialized = await probe(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "ocsc-intelligence", version: "1" },
      },
    }),
  }).catch(() => null);
  if (!initialized) return null;
  if (initialized.status >= 200 && initialized.status < 300) return true;
  if (initialized.status === 401 || initialized.status === 403) return false;
  return null;
}

/** The document named by a 401, when the well-known path itself was missing. */
async function advertisedDocument(
  endpoint: string,
  probe: McpProbe,
): Promise<McpProbeResponse | null> {
  const challenged = await probe(endpoint, {
    method: "POST",
    headers: { accept: "application/json, text/event-stream" },
    body: "{}",
  }).catch(() => null);
  const url = challenged ? resourceMetadataUrl(challenged.headers) : null;
  if (!url) return null;
  const document = await probe(url, { method: "GET" }).catch(() => null);
  return document?.status === 200 ? document : null;
}

async function issuerRegistersClients(issuer: string, probe: McpProbe): Promise<boolean> {
  let base: URL;
  try {
    base = new URL(issuer);
  } catch {
    return false;
  }
  const root = `${base.origin}/.well-known/`;
  for (const url of [`${root}oauth-authorization-server`, `${root}openid-configuration`]) {
    const response = await probe(url, { method: "GET" }).catch(() => null);
    if (response?.status === 200 && registrationEndpoint(response.body)) return true;
  }
  return false;
}

/** Tests start from an empty cache. */
export function resetRemoteMcpUsableCache(): void {
  cache.clear();
}
