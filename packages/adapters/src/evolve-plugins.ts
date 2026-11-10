import { createHmac } from "node:crypto";
import { getLogger } from "@rakazo/logging";

/**
 * Evolve staff plugins: OCSC Intelligence builds a plugin on the person's computer and these
 * calls hand it to Evolve as that person. The signing secret stays in this server; the computer
 * never sees it or any Evolve sign-in.
 */
export interface EvolvePluginsConnection {
  /** Evolve's plugin-builder function. */
  url: string;
  secret: string;
  /** The repository Cursor agents push plugin branches to, read with a read-only token. */
  repo?: { owner: string; name: string; token: string };
}

export const EVOLVE_PLUGINS_AUDIENCE = "evolve-plugins";
export const EVOLVE_ASSISTANTS_AUDIENCE = "evolve-assistants";
export const EVOLVE_INFOGRAPHICS_AUDIENCE = "evolve-infographics";
export const EVOLVE_MY_PROFILE_AUDIENCE = "evolve-my-profile";
export const EVOLVE_COMPUTER_MCP_AUDIENCE = "evolve-computer-mcp";
export const EVOLVE_DOCUMENT_LIBRARY_AUDIENCE = "evolve-document-library";
export const EVOLVE_PLUGINS_ISSUER = "ocsc-intelligence";
const TOKEN_SECONDS = 120;
const REQUEST_TIMEOUT_MS = 30_000;

export const PLUGIN_SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const BRANCH = /^(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/;
const IMPORT_EXT = /\.(tsx?|jsx?|mjs|cjs|css|html|json|md|svg|txt)$/i;
const IMPORT_SKIP = /(^|\/)(node_modules|dist|\.git|\.evolve|\.vite-cache)(\/|$)|(^|\/)\.env/;
const IMPORT_MAX_FILES = 400;
const IMPORT_MAX_BYTES = 3 * 1024 * 1024;

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function createEvolvePluginsConnection(
  source: NodeJS.ProcessEnv = process.env,
): EvolvePluginsConnection | null {
  const url = optional(source.EVOLVE_PLUGINS_URL);
  const secret = optional(source.EVOLVE_PLUGINS_SECRET);
  if (!url || !secret) return null;
  if (!URL.canParse(url) || new URL(url).protocol !== "https:" || secret.length < 32) {
    // Misconfigured: the plugin tools stay off rather than the server failing to start.
    getLogger().error(
      "Evolve plugins disabled: EVOLVE_PLUGINS_URL must be https and the secret 32+ characters",
    );
    return null;
  }
  const repo = optional(source.EVOLVE_PLUGINS_REPO);
  const token = optional(source.EVOLVE_PLUGINS_GITHUB_TOKEN);
  const [owner, name] = repo?.split("/") ?? [];
  return {
    url,
    secret,
    ...(owner && name && token ? { repo: { owner, name, token } } : {}),
  };
}

const base64Url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

/** A two-minute HS256 token naming the person, matching Evolve's verifyEvolvePluginsToken. */
export function signEvolvePluginsToken(
  secret: string,
  email: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  audience: string = EVOLVE_PLUGINS_AUDIENCE,
): string {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      aud: audience,
      iss: EVOLVE_PLUGINS_ISSUER,
      sub: email.trim().toLowerCase(),
      iat: nowSeconds,
      exp: nowSeconds + TOKEN_SECONDS,
    }),
  );
  const signature = createHmac("sha256", secret).update(`${header}.${claims}`).digest("base64url");
  return `${header}.${claims}.${signature}`;
}

export class EvolvePluginsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function withTimeout(signal: AbortSignal | undefined, ms = REQUEST_TIMEOUT_MS) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function callEvolvePlugins<T = Record<string, unknown>>(
  connection: EvolvePluginsConnection,
  email: string,
  body: Record<string, unknown>,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<T> {
  return postEvolve<T>(connection.url, EVOLVE_PLUGINS_AUDIENCE, connection, email, body, options);
}

/** Evolve's chat assistants, through its evolve-assistants function beside plugin-builder. */
export function callEvolveAssistants<T = Record<string, unknown>>(
  connection: EvolvePluginsConnection,
  email: string,
  body: Record<string, unknown>,
  options: { signal?: AbortSignal; fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<T> {
  const url = new URL("evolve-assistants", connection.url).toString();
  return postEvolve<T>(url, EVOLVE_ASSISTANTS_AUDIENCE, connection, email, body, options);
}

/** GPT Image infographics rendered on Evolve, every item at once. */
export function callEvolveInfographics<T = Record<string, unknown>>(
  connection: EvolvePluginsConnection,
  email: string,
  body: Record<string, unknown>,
  options: { signal?: AbortSignal; fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<T> {
  const url = new URL("evolve-infographics", connection.url).toString();
  return postEvolve<T>(url, EVOLVE_INFOGRAPHICS_AUDIENCE, connection, email, body, options);
}

/** The caller's own Evolve CV profile: name, role, photo, phone and email. */
export function callEvolveMyProfile<T = Record<string, unknown>>(
  connection: EvolvePluginsConnection,
  email: string,
  options: { signal?: AbortSignal; fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<T> {
  const url = new URL("evolve-my-profile", connection.url).toString();
  return postEvolve<T>(url, EVOLVE_MY_PROFILE_AUDIENCE, connection, email, {}, options);
}

/**
 * Lists the Document Library's AI access or changes one document's, as the caller. Evolve lets
 * only its admins and Document Library managers do either.
 */
export function callEvolveDocumentLibrary<T = Record<string, unknown>>(
  connection: EvolvePluginsConnection,
  email: string,
  body: Record<string, unknown>,
  options: { signal?: AbortSignal; fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<T> {
  const url = new URL("evolve-document-library", connection.url).toString();
  return postEvolve<T>(url, EVOLVE_DOCUMENT_LIBRARY_AUDIENCE, connection, email, body, options);
}

/** One JSON-RPC message to Evolve's MCP server for the company tools every bot has. */
export function callEvolveComputerMcp<T = Record<string, unknown>>(
  connection: EvolvePluginsConnection,
  email: string,
  body: Record<string, unknown>,
  options: { signal?: AbortSignal; fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<T> {
  const url = new URL("evolve-computer-mcp", connection.url).toString();
  return postEvolve<T>(url, EVOLVE_COMPUTER_MCP_AUDIENCE, connection, email, body, options);
}

async function postEvolve<T>(
  url: string,
  audience: string,
  connection: EvolvePluginsConnection,
  email: string,
  body: Record<string, unknown>,
  options: { signal?: AbortSignal; fetch?: typeof fetch; timeoutMs?: number },
): Promise<T> {
  const token = signEvolvePluginsToken(connection.secret, email, undefined, audience);
  const response = await (options.fetch ?? fetch)(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: withTimeout(options.signal, options.timeoutMs),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      typeof payload.error === "string" ? payload.error : `Evolve answered ${response.status}`;
    throw new EvolvePluginsError(message, response.status);
  }
  return payload as T;
}

type GitHubTree = {
  tree: Array<{ path: string; type: string; sha: string; size?: number }>;
  truncated?: boolean;
};

/** Text files of one plugin folder on a branch of the plugins repository. */
export async function fetchPluginBranch(
  repo: NonNullable<EvolvePluginsConnection["repo"]>,
  branch: string,
  folder: string,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<Record<string, string>> {
  if (!BRANCH.test(branch)) throw new EvolvePluginsError("That branch name is not valid.", 400);
  if (!PLUGIN_SLUG.test(folder))
    throw new EvolvePluginsError("The folder must be the plugin's slug.", 400);
  const get = async <T>(path: string): Promise<T> => {
    const response = await (options.fetch ?? fetch)(
      `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}${path}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${repo.token}`,
          "x-github-api-version": "2022-11-28",
        },
        signal: withTimeout(options.signal),
      },
    );
    if (response.status === 404)
      throw new EvolvePluginsError("That branch or folder was not found.", 404);
    if (!response.ok)
      throw new EvolvePluginsError(`GitHub answered ${response.status}`, response.status);
    return (await response.json()) as T;
  };

  const ref = await get<{ commit: { commit: { tree: { sha: string } } } }>(
    `/branches/${branch.split("/").map(encodeURIComponent).join("/")}`,
  );
  const tree = await get<GitHubTree>(`/git/trees/${ref.commit.commit.tree.sha}?recursive=1`);
  if (tree.truncated)
    throw new EvolvePluginsError("The repository is too large to read in one go.", 413);
  const prefix = `${folder}/`;
  const entries = tree.tree.filter(
    (entry) =>
      entry.type === "blob" &&
      entry.path.startsWith(prefix) &&
      !entry.path.split("/").some((part) => part === ".." || part === ".") &&
      IMPORT_EXT.test(entry.path) &&
      !IMPORT_SKIP.test(entry.path.slice(prefix.length)),
  );
  if (!entries.length)
    throw new EvolvePluginsError(`No plugin files under ${folder}/ on ${branch}.`, 404);
  if (entries.length > IMPORT_MAX_FILES)
    throw new EvolvePluginsError("The plugin has too many files.", 413);
  if (entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0) > IMPORT_MAX_BYTES) {
    throw new EvolvePluginsError("The plugin's files are over 3 MB.", 413);
  }
  const files: Record<string, string> = {};
  for (const entry of entries) {
    const blob = await get<{ content: string; encoding: string }>(`/git/blobs/${entry.sha}`);
    files[entry.path.slice(prefix.length)] =
      blob.encoding === "base64"
        ? Buffer.from(blob.content, "base64").toString("utf8")
        : blob.content;
  }
  if (!files["evolve-plugin.json"])
    throw new EvolvePluginsError(`${folder}/ has no evolve-plugin.json.`, 400);
  return files;
}
