import { createHash, createHmac, randomBytes } from "node:crypto";
import type {
  AdapterContext,
  ConnectorCall,
  ConnectorCatalogItem,
  ConnectorEvent,
  ConnectorTool,
  ManagedConnectorProvider,
  SecretStore,
} from "@rakazo/adapter-kit";
import type { SharePointFolder } from "@rakazo/contracts";
import { SHAREPOINT_FOLDER_LIMIT } from "@rakazo/contracts";
import type { Prisma, PrismaClient } from "@rakazo/db";
import { runAsSystem, runAsTenant } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { combineSignals, sanitizeConnectorError } from "./connector-safety.js";
import type { MailGraph } from "./microsoft-mail.js";
import {
  assertMailRead,
  OUTLOOK_PROVIDER,
  OUTLOOK_SCOPES,
  OUTLOOK_TOOL_NAMES,
  outlookTools,
  runMailTool,
} from "./microsoft-mail.js";
import { isVitestRuntime } from "./test-runtime.js";
import { readBodyCapped } from "./web-ssrf.js";

export const MICROSOFT_CONNECTOR_ID = "microsoft";

/** Someone signed in to Microsoft as another person than their Rakazo account. */
export class MicrosoftOtherAccountError extends Error {
  constructor() {
    super("That Microsoft account belongs to someone else.");
    this.name = "MicrosoftOtherAccountError";
  }
}

/** A mailbox may be connected only by its own person: Microsoft's address or sign-in name is theirs. */
export function microsoftAccountIsPerson(
  me: { mail?: string | null; userPrincipalName?: string | null },
  email: string | null | undefined,
): boolean {
  const own = email?.trim().toLowerCase();
  if (!own) return false;
  return [me.mail, me.userPrincipalName].some((address) => address?.trim().toLowerCase() === own);
}
export const SHAREPOINT_PROVIDER = "sharepoint";
export const MICROSOFT_CALLBACK_PATH = "/api/v1/connections/microsoft/callback";
/** Read-only by design: nothing here lets the app change or delete a file. */
export const MICROSOFT_SCOPES =
  "openid profile offline_access User.Read Files.Read.All Sites.Read.All";

/**
 * The Microsoft apps on the company's Entra app. Each is its own connection with its own
 * sign-in, so connecting SharePoint never grants mail and connecting Outlook never grants files.
 */
const MICROSOFT_APPS = {
  [SHAREPOINT_PROVIDER]: {
    name: "SharePoint",
    logo: "/apps/sharepoint.svg",
    scopes: MICROSOFT_SCOPES,
    keywords: "sharepoint microsoft files documents",
  },
  [OUTLOOK_PROVIDER]: {
    name: "Outlook",
    logo: "/apps/outlook.svg",
    scopes: OUTLOOK_SCOPES,
    keywords: "outlook microsoft email mail inbox",
  },
} as const;
type MicrosoftApp = keyof typeof MICROSOFT_APPS;
const MICROSOFT_APP_SLUGS = Object.keys(MICROSOFT_APPS) as MicrosoftApp[];

function isMicrosoftApp(provider: string | null | undefined): provider is MicrosoftApp {
  return MICROSOFT_APP_SLUGS.includes(provider as MicrosoftApp);
}

/** SharePoint was the only Microsoft app before Outlook, so a row without a known one is it. */
function appOf(row: { provider?: string | null }): MicrosoftApp {
  return isMicrosoftApp(row.provider) ? row.provider : SHAREPOINT_PROVIDER;
}
export const SHAREPOINT_MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Where a read file lands on the assistant's computer. */
export const SHAREPOINT_COMPUTER_FOLDER = "sharepoint";

const GRAPH = "https://graph.microsoft.com/v1.0";
const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const SEARCH_LIMIT = 25;
const LIST_LIMIT = 200;
const ITEM_FIELDS =
  "id,name,size,webUrl,folder,file,root,parentReference,lastModifiedDateTime,lastModifiedBy";

export interface MicrosoftConnectorConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  /** Only sign-in needs it, so the worker may leave it empty. */
  webOrigin: string;
  /** Derives each sign-in's PKCE verifier from its state, so nothing extra is stored. */
  identitySecret: string;
}

export function microsoftConfigFromEnv(
  source: Record<string, string | undefined>,
  values: { webOrigin: string; encryptionKey: string },
): MicrosoftConnectorConfig {
  return {
    clientId: source.MICROSOFT_CLIENT_ID?.trim() ?? "",
    clientSecret: source.MICROSOFT_CLIENT_SECRET?.trim() ?? "",
    tenantId: source.MICROSOFT_TENANT_ID?.trim() ?? "",
    webOrigin: values.webOrigin,
    identitySecret: values.encryptionKey,
  };
}

export function isMicrosoftEnabled(config: Partial<MicrosoftConnectorConfig>): boolean {
  return Boolean(
    config.clientId &&
      config.clientSecret &&
      config.tenantId &&
      config.identitySecret &&
      !isVitestRuntime(),
  );
}

interface StoredTokens {
  refreshToken: string;
  account?: { name?: string; email?: string };
}

export interface DriveItem {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  folder?: { childCount?: number };
  file?: { mimeType?: string };
  root?: object;
  parentReference?: { driveId?: string; id?: string; path?: string; siteId?: string };
  lastModifiedDateTime?: string;
  lastModifiedBy?: { user?: { displayName?: string } };
}

export interface MicrosoftConnectorDependencies {
  fetch?: typeof fetch;
}

type ConnectionRow = {
  id: string;
  spaceId: string;
  userId: string;
  provider?: string;
  status: string;
  secretId: string | null;
  providerRef: string | null;
  metadata: Prisma.JsonValue;
};

export class MicrosoftReconnectError extends Error {
  constructor(app = "SharePoint") {
    super(`${app} needs signing in again. Reconnect it in Plugins.`);
  }
}

/** The path of an item inside its library, "" for the library itself, compared without case. */
export function drivePath(item: DriveItem): string | undefined {
  if (item.root) return "";
  const parent = item.parentReference?.path;
  if (parent === undefined) return undefined;
  const at = parent.indexOf("root:");
  if (at < 0) return undefined;
  let rest = parent.slice(at + "root:".length);
  try {
    rest = decodeURIComponent(rest);
  } catch {}
  return `${rest.replace(/\/+$/, "")}/${item.name}`.toLowerCase();
}

/** True when `item` is one of `folders` or sits anywhere below one. */
export function withinFolders(
  item: DriveItem,
  folders: Array<{ driveId: string; path: string }>,
): boolean {
  const driveId = item.parentReference?.driveId;
  const path = drivePath(item);
  if (!driveId || path === undefined) return false;
  return folders.some(
    (folder) =>
      folder.driveId === driveId && (path === folder.path || path.startsWith(`${folder.path}/`)),
  );
}

export function savedFolders(metadata: Prisma.JsonValue | undefined): SharePointFolder[] {
  const value =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).folders
      : undefined;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const folder = entry as Record<string, unknown>;
    if (typeof folder.driveId !== "string" || typeof folder.itemId !== "string") return [];
    return [
      {
        driveId: folder.driveId,
        itemId: folder.itemId,
        name: typeof folder.name === "string" ? folder.name : "Folder",
        location: typeof folder.location === "string" ? folder.location : "",
        webUrl: typeof folder.webUrl === "string" ? folder.webUrl : null,
      },
    ];
  });
}

function metadataRecord(metadata: Prisma.JsonValue | undefined): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

/** A file name safe to write on the computer, keeping its extension. */
export function computerFileName(name: string): string {
  const cleaned = Array.from(name, (char) =>
    char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? "_" : char,
  )
    .join("")
    .replace(/^\.+/, "_")
    .trim()
    .slice(-180);
  return cleaned || "file";
}

function describeItem(item: DriveItem) {
  return {
    name: item.name,
    kind: item.folder ? "folder" : "file",
    drive_id: item.parentReference?.driveId,
    item_id: item.id,
    ...(item.size !== undefined && !item.folder ? { size: item.size } : {}),
    modified: item.lastModifiedDateTime,
    modified_by: item.lastModifiedBy?.user?.displayName,
    web_url: item.webUrl,
  };
}

function routeFor(connectionId: string) {
  return (toolName: string) => ({ connectorId: MICROSOFT_CONNECTOR_ID, toolName, connectionId });
}

const ID_ARGS = {
  drive_id: { type: "string", description: "drive_id from a SharePoint listing or search" },
  item_id: { type: "string", description: "item_id from a SharePoint listing or search" },
};

/**
 * Read-only SharePoint and Outlook for one person, through their own Microsoft sign-in.
 * SharePoint assistants only reach the folders that person chose, and every listing, search
 * and read checks it again; Outlook reads only the signed-in person's own mailbox.
 */
export class MicrosoftConnector implements ManagedConnectorProvider {
  private readonly accessTokens = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    private readonly config: MicrosoftConnectorConfig,
    private readonly prisma: PrismaClient,
    private readonly secrets: SecretStore,
    private readonly dependencies: MicrosoftConnectorDependencies = {},
  ) {}

  describe() {
    return {
      id: MICROSOFT_CONNECTOR_ID,
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { discover: true, oauth: true, secretsBrokered: true },
    };
  }

  get redirectUrl(): string {
    return new URL(MICROSOFT_CALLBACK_PATH, this.config.webOrigin).toString();
  }

  async catalog(context: AdapterContext, query?: string): Promise<ConnectorCatalogItem[]> {
    const words = (query ?? "").trim().toLowerCase();
    const apps = MICROSOFT_APP_SLUGS.filter(
      (slug) => !words || MICROSOFT_APPS[slug].keywords.includes(words),
    );
    if (apps.length === 0) return [];
    const connected = await this.listConnectedExternalIds(context);
    return apps.map((slug) => ({
      connectorId: MICROSOFT_CONNECTOR_ID,
      slug,
      name: MICROSOFT_APPS[slug].name,
      logo: MICROSOFT_APPS[slug].logo,
      connected: connected.includes(slug),
      noAuth: false,
    }));
  }

  async listConnectedExternalIds(context: AdapterContext): Promise<string[]> {
    const rows = await this.rows(context, { status: "connected", secretId: { not: null } });
    return [...new Set(rows.map(appOf))];
  }

  async begin(
    request: { provider: string; redirectUrl: string },
    _context: AdapterContext,
  ): Promise<{ authorizationUrl: string | null; state: string }> {
    if (!isMicrosoftApp(request.provider)) throw new Error("Unknown Microsoft app");
    const state = randomBytes(32).toString("base64url");
    const url = new URL(
      `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId)}/oauth2/v2.0/authorize`,
    );
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      redirect_uri: this.redirectUrl,
      response_mode: "query",
      scope: MICROSOFT_APPS[request.provider].scopes,
      state,
      code_challenge: createHash("sha256").update(this.verifier(state)).digest("base64url"),
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return { authorizationUrl: url.toString(), state };
  }

  /** The server finishes sign-in at its callback; the app's poll then sees the connection. */
  async complete(request: { state: string }): Promise<{ connectionRef: string }> {
    return { connectionRef: request.state };
  }

  /**
   * Swap the code Microsoft returned for tokens and keep them encrypted on the person's own
   * pending connection. Only the person who started this sign-in can finish it.
   */
  async finishSignIn(
    userId: string,
    request: { state: string; code?: string; error?: string },
  ): Promise<boolean> {
    if (!request.state) return false;
    // The person may have started it from any of their Spaces; only their own rows are read.
    const found = await runAsSystem("find a person's pending Microsoft sign-in by its state", () =>
      this.prisma.connection.findFirst({
        where: {
          userId,
          connectorId: MICROSOFT_CONNECTOR_ID,
          provider: { in: MICROSOFT_APP_SLUGS },
          providerRef: request.state,
          status: "pending",
        },
        select: { spaceId: true },
      }),
    );
    if (!found) return false;
    const owner = { spaceId: found.spaceId, userId };
    return runAsTenant(owner, async () => {
      const row = await this.prisma.connection.findFirst({
        where: {
          spaceId: owner.spaceId,
          userId: owner.userId,
          connectorId: MICROSOFT_CONNECTOR_ID,
          provider: { in: MICROSOFT_APP_SLUGS },
          providerRef: request.state,
          status: "pending",
        },
      });
      if (!row) return false;
      const app = appOf(row);
      if (request.error || !request.code) {
        await this.prisma.connection.updateMany({
          where: { id: row.id, status: "pending" },
          data: { status: "error" },
        });
        return false;
      }
      const tokens = await this.tokenRequest(app, {
        grant_type: "authorization_code",
        code: request.code,
        redirect_uri: this.redirectUrl,
        code_verifier: this.verifier(request.state),
      });
      if (!tokens.refresh_token) throw new Error("Microsoft did not return a refresh token.");
      const me = await this.graphJson<{
        displayName?: string;
        mail?: string;
        userPrincipalName?: string;
      }>(tokens.access_token, "/me?$select=displayName,mail,userPrincipalName");
      const person = await runAsSystem("read whose Microsoft sign-in this is", () =>
        this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
      );
      if (!microsoftAccountIsPerson(me, person?.email)) {
        await this.prisma.connection.updateMany({
          where: { id: row.id, status: "pending" },
          data: { status: "error" },
        });
        throw new MicrosoftOtherAccountError();
      }
      const account = {
        name: me.displayName,
        email: me.mail ?? me.userPrincipalName,
      };
      const stored = await this.secrets.put(
        JSON.stringify({ refreshToken: tokens.refresh_token, account } satisfies StoredTokens),
        {
          operationId: "microsoft.signin",
          traceId: "microsoft.signin",
          spaceId: owner.spaceId,
          userId: owner.userId,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      await this.prisma.$transaction(async (tx) => {
        await tx.secret.create({
          data: {
            id: stored.id,
            spaceId: owner.spaceId,
            userId: owner.userId,
            kind: "connector",
            ciphertext: stored.ciphertext,
          },
        });
        const updated = await tx.connection.updateMany({
          where: { id: row.id, status: "pending", providerRef: request.state },
          data: {
            secretId: stored.id,
            ...(account.email
              ? { displayName: `${MICROSOFT_APPS[app].name} (${account.email})` }
              : {}),
            metadata: { ...metadataRecord(row.metadata), signedIn: request.state, account },
          },
        });
        if (updated.count === 0) throw new Error("This sign-in was replaced by a newer one.");
        if (row.secretId) await tx.secret.deleteMany({ where: { id: row.secretId } });
        // connectionReady waits for every pending attempt, so abandoned ones would hold this
        // finished sign-in at pending for good; they are closed and their tokens deleted.
        const abandoned = await tx.connection.findMany({
          where: {
            spaceId: owner.spaceId,
            userId: owner.userId,
            connectorId: MICROSOFT_CONNECTOR_ID,
            provider: row.provider,
            status: "pending",
            id: { not: row.id },
          },
          select: { id: true, secretId: true },
        });
        if (abandoned.length > 0) {
          await tx.connection.updateMany({
            where: { id: { in: abandoned.map((entry) => entry.id) }, status: "pending" },
            data: { status: "revoked", secretId: null },
          });
          const secretIds = abandoned.flatMap((entry) => entry.secretId ?? []);
          if (secretIds.length > 0) {
            await tx.secret.deleteMany({ where: { id: { in: secretIds }, userId: owner.userId } });
          }
        }
      });
      this.accessTokens.set(row.id, {
        value: tokens.access_token,
        expiresAt: Date.now() + (tokens.expires_in ?? 3_600) * 1_000,
      });
      return true;
    });
  }

  async connectionReady(context: AdapterContext, externalId: string): Promise<boolean> {
    if (!isMicrosoftApp(externalId)) return false;
    const rows = await this.rows(context, { status: { in: ["pending", "connected"] } }, externalId);
    const pending = rows.filter((row) => row.status === "pending");
    if (pending.length > 0) {
      return pending.every(
        (row) => row.secretId && metadataRecord(row.metadata).signedIn === row.providerRef,
      );
    }
    return rows.some((row) => row.secretId);
  }

  async revoke(connectionRef: string, context: AdapterContext): Promise<void> {
    await runAsTenant(context, async () => {
      const rows = await this.prisma.connection.findMany({
        where: {
          spaceId: context.spaceId,
          userId: context.userId,
          connectorId: MICROSOFT_CONNECTOR_ID,
          ...(isMicrosoftApp(connectionRef)
            ? { provider: connectionRef, status: "revoked" }
            : { providerRef: connectionRef }),
        },
        select: { id: true, secretId: true },
      });
      for (const row of rows) {
        this.accessTokens.delete(row.id);
        if (!row.secretId) continue;
        const secretId = row.secretId;
        await this.prisma.$transaction(async (tx) => {
          await tx.connection.updateMany({
            where: { id: row.id, secretId },
            data: { secretId: null },
          });
          await tx.secret.deleteMany({ where: { id: secretId, userId: context.userId } });
        });
      }
    });
  }

  async discoverTools(context: AdapterContext): Promise<ConnectorTool[]> {
    const connections =
      context.connectedConnections?.filter(
        (connection) =>
          connection.connectorId === MICROSOFT_CONNECTOR_ID &&
          isMicrosoftApp(connection.externalId),
      ) ?? [];
    if (connections.length === 0) return [];
    const rows = await this.rows(context, {
      id: { in: connections.map((connection) => connection.id) },
      status: "connected",
    });
    return rows.flatMap((row) =>
      appOf(row) === OUTLOOK_PROVIDER
        ? outlookTools(routeFor(row.id))
        : this.toolsFor(row.id, savedFolders(row.metadata)),
    );
  }

  private toolsFor(connectionId: string, folders: SharePointFolder[]): ConnectorTool[] {
    const route = routeFor(connectionId);
    const shared =
      folders.length === 0
        ? "The person has not chosen any SharePoint folders yet; ask them to choose some in Plugins → SharePoint → Choose folders."
        : `Only these SharePoint folders (and everything inside them) are available: ${folders
            .map((folder) => `${folder.name} (${folder.location})`)
            .join("; ")}.`;
    return [
      {
        name: "sharepoint_list_folders",
        description: `List the SharePoint folders the person lets you read, with their drive_id and item_id. ${shared}`,
        inputSchema: { type: "object", properties: {} },
        readOnly: true,
        route: route("sharepoint_list_folders"),
      },
      {
        name: "sharepoint_search",
        description: `Search SharePoint file names and contents in the person's chosen folders. ${shared} Optionally limit to one folder with its drive_id and item_id.`,
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Words to find" },
            ...ID_ARGS,
          },
          required: ["query"],
        },
        readOnly: true,
        route: route("sharepoint_search"),
      },
      {
        name: "sharepoint_list",
        description: `List what is inside a SharePoint folder (one of the chosen folders or a folder below one). ${shared}`,
        inputSchema: { type: "object", properties: ID_ARGS, required: ["drive_id", "item_id"] },
        readOnly: true,
        route: route("sharepoint_list"),
      },
      {
        name: "sharepoint_read_file",
        description: `Copy a SharePoint file onto your computer under ${SHAREPOINT_COMPUTER_FOLDER}/ so you can read it like an attached file (Word, PDF, Excel, PowerPoint and others). Read-only: changes you make never reach SharePoint. ${shared}`,
        inputSchema: { type: "object", properties: ID_ARGS, required: ["drive_id", "item_id"] },
        readOnly: true,
        route: route("sharepoint_read_file"),
      },
    ];
  }

  async *execute(call: ConnectorCall, context: AdapterContext): AsyncIterable<ConnectorEvent> {
    const connectionId = call.route?.connectionId ?? call.connectionId;
    const tool = call.route?.toolName ?? call.tool;
    const wanted: MicrosoftApp = tool.startsWith("outlook_")
      ? OUTLOOK_PROVIDER
      : SHAREPOINT_PROVIDER;
    const allowed = context.connectedConnections?.some(
      (connection) =>
        connection.id === connectionId &&
        connection.connectorId === MICROSOFT_CONNECTOR_ID &&
        appOf({ provider: connection.externalId }) === wanted,
    );
    if (!connectionId || !allowed) {
      yield {
        type: "error",
        message: `${MICROSOFT_APPS[wanted].name} is only available in the person's own chat with their own assistant.`,
      };
      return;
    }
    if (wanted === OUTLOOK_PROVIDER && !OUTLOOK_TOOL_NAMES.includes(tool)) {
      yield { type: "error", message: "Outlook is read-only here: that request was refused." };
      return;
    }
    let token: string | undefined;
    try {
      const [row] = await this.rows(context, { id: connectionId, status: "connected" }, wanted);
      if (!row) {
        yield {
          type: "error",
          message: `${MICROSOFT_APPS[wanted].name} is not connected. Reconnect it in Plugins.`,
        };
        return;
      }
      if (wanted === OUTLOOK_PROVIDER) {
        const mailToken = await this.accessToken(row, context);
        token = mailToken;
        const account = metadataRecord(row.metadata).account as StoredTokens["account"];
        yield* runMailTool(
          this.mailGraph(mailToken, context.signal, account?.email),
          tool,
          call.args,
        );
        return;
      }
      const folders = savedFolders(row.metadata);
      if (folders.length === 0) {
        yield {
          type: "error",
          message:
            "No SharePoint folders are chosen yet. Ask the person to choose folders in Plugins → SharePoint → Choose folders.",
        };
        return;
      }
      token = await this.accessToken(row, context);
      const scope = await this.resolveFolders(token, folders, context.signal);
      if (tool === "sharepoint_list_folders") {
        yield {
          type: "result",
          data: {
            folders: folders.map((folder) => ({
              name: folder.name,
              location: folder.location,
              drive_id: folder.driveId,
              item_id: folder.itemId,
              web_url: folder.webUrl,
              available: scope.some((entry) => entry.itemId === folder.itemId),
            })),
          },
        };
        return;
      }
      if (tool === "sharepoint_search") {
        yield {
          type: "result",
          data: await this.search(token, scope, call.args, context.signal),
        };
        return;
      }
      const item = await this.scopedItem(token, scope, call.args, context.signal);
      if (tool === "sharepoint_list") {
        if (!item.folder) throw new Error("That is a file, not a folder.");
        const listed = await this.graphJson<{ value?: DriveItem[] }>(
          token,
          `/drives/${encodeURIComponent(item.parentReference?.driveId ?? "")}/items/${encodeURIComponent(item.id)}/children?$top=${LIST_LIMIT}&$select=${ITEM_FIELDS}`,
          context.signal,
        );
        const items = listed.value ?? [];
        yield {
          type: "result",
          data: {
            folder: item.name,
            items: items.map(describeItem),
            ...(items.length >= LIST_LIMIT ? { note: `Showing the first ${LIST_LIMIT}.` } : {}),
          },
        };
        return;
      }
      if (tool === "sharepoint_read_file") {
        if (item.folder) throw new Error("That is a folder; use sharepoint_list.");
        if ((item.size ?? 0) > SHAREPOINT_MAX_FILE_BYTES) {
          throw new Error("That file is larger than 50 MB.");
        }
        const content = await this.download(token, item, context.signal);
        const path = `${SHAREPOINT_COMPUTER_FOLDER}/${computerFileName(item.name)}`;
        yield { type: "file", path, content };
        yield {
          type: "result",
          data: {
            ok: true,
            path,
            name: item.name,
            bytes: content.byteLength,
            web_url: item.webUrl,
            modified: item.lastModifiedDateTime,
          },
        };
        return;
      }
      yield { type: "error", message: `unknown tool ${tool}` };
    } catch (error) {
      yield {
        type: "error",
        message: sanitizeConnectorError(
          error,
          [token, this.config.clientSecret].filter((value): value is string => Boolean(value)),
        ),
      };
    }
  }

  // ---- Folder picker (the person's own browsing, never an assistant's) ----

  async browse(
    owner: { spaceId: string; userId: string },
    connectionId: string,
    location:
      | { kind: "sites"; query?: string }
      | { kind: "libraries"; siteId: string }
      | { kind: "folder"; driveId: string; itemId: string },
    signal?: AbortSignal,
  ): Promise<
    Array<{
      kind: "site" | "library" | "folder";
      id: string;
      driveId?: string;
      name: string;
      detail?: string;
    }>
  > {
    const row = await this.ownedRow(owner, connectionId);
    const token = await this.accessToken(row, owner);
    if (location.kind === "sites") {
      const query = location.query?.trim() || "*";
      const found = await this.graphJson<{
        value?: Array<{ id: string; displayName?: string; name?: string; webUrl?: string }>;
      }>(token, `/sites?search=${encodeURIComponent(query)}&$top=50`, signal);
      const sites = (found.value ?? []).map((site) => ({
        kind: "site" as const,
        id: site.id,
        name: site.displayName || site.name || "Site",
        detail: site.webUrl,
      }));
      // Personal OneDrive is not a SharePoint site search hit; offer it at the root when
      // browsing (or when the search could mean OneDrive). Scopes already include Files.Read.All.
      const needle = query === "*" ? "" : query.toLowerCase();
      const wantOneDrive =
        !needle ||
        (needle.length >= 3 &&
          ["onedrive", "one drive", "my files", "myfiles", "personal"].some(
            (label) => label.includes(needle) || needle.includes(label),
          ));
      if (!wantOneDrive) return sites;
      const oneDrive = await this.graphJson<{
        id?: string;
        name?: string;
        webUrl?: string;
      }>(token, `/me/drive?$select=id,name,webUrl`, signal).catch(() => null);
      if (!oneDrive?.id) return sites;
      const root = await this.graphJson<{ id?: string }>(
        token,
        `/me/drive/root?$select=id`,
        signal,
      ).catch(() => ({ id: undefined }));
      if (!root.id) return sites;
      return [
        {
          kind: "library" as const,
          id: root.id,
          driveId: oneDrive.id,
          name: "My files",
          detail: oneDrive.webUrl || oneDrive.name || "OneDrive",
        },
        ...sites,
      ];
    }
    if (location.kind === "libraries") {
      const found = await this.graphJson<{
        value?: Array<{ id: string; name?: string; webUrl?: string; driveType?: string }>;
      }>(
        token,
        `/sites/${encodeURIComponent(location.siteId)}/drives?$select=id,name,webUrl,driveType`,
        signal,
      );
      const libraries = (found.value ?? [])
        .filter((drive) => drive.driveType === "documentLibrary")
        .slice(0, 50);
      return Promise.all(
        libraries.map(async (drive) => {
          const root = await this.graphJson<{ id?: string }>(
            token,
            `/drives/${encodeURIComponent(drive.id)}/root?$select=id`,
            signal,
          ).catch(() => ({ id: undefined }));
          return {
            kind: "library" as const,
            id: root.id ?? "root",
            driveId: drive.id,
            name: drive.name || "Documents",
            detail: drive.webUrl,
          };
        }),
      );
    }
    const children = await this.graphJson<{ value?: DriveItem[] }>(
      token,
      `/drives/${encodeURIComponent(location.driveId)}/items/${encodeURIComponent(location.itemId)}/children?$top=${LIST_LIMIT}&$select=id,name,folder,parentReference`,
      signal,
    );
    return (children.value ?? [])
      .filter((item) => item.folder)
      .map((item) => ({
        kind: "folder" as const,
        id: item.id,
        driveId: location.driveId,
        name: item.name,
        detail:
          item.folder?.childCount === undefined ? undefined : `${item.folder.childCount} items`,
      }));
  }

  /** Save the folders a person chose, checked against SharePoint as that person. */
  async chooseFolders(
    owner: { spaceId: string; userId: string },
    connectionId: string,
    choices: Array<{ driveId: string; itemId: string }>,
    signal?: AbortSignal,
  ): Promise<SharePointFolder[]> {
    if (choices.length > SHAREPOINT_FOLDER_LIMIT) {
      throw new Error(`Choose up to ${SHAREPOINT_FOLDER_LIMIT} folders.`);
    }
    const row = await this.ownedRow(owner, connectionId);
    const token = await this.accessToken(row, owner);
    const seen = new Set<string>();
    const folders: SharePointFolder[] = [];
    for (const choice of choices) {
      const item = await this.graphJson<DriveItem>(
        token,
        `/drives/${encodeURIComponent(choice.driveId)}/items/${encodeURIComponent(choice.itemId)}?$select=${ITEM_FIELDS}`,
        signal,
      );
      if (!item.folder && !item.root) throw new Error(`${item.name} is not a folder.`);
      const driveId = item.parentReference?.driveId ?? choice.driveId;
      if (seen.has(`${driveId}:${item.id}`)) continue;
      seen.add(`${driveId}:${item.id}`);
      const drive = await this.graphJson<{ name?: string; webUrl?: string }>(
        token,
        `/drives/${encodeURIComponent(driveId)}?$select=name,webUrl`,
        signal,
      ).catch(() => ({ name: undefined, webUrl: undefined }));
      const site = item.parentReference?.siteId
        ? await this.graphJson<{ displayName?: string }>(
            token,
            `/sites/${encodeURIComponent(item.parentReference.siteId)}?$select=displayName`,
            signal,
          ).catch(() => ({ displayName: undefined }))
        : { displayName: undefined };
      const relative = item.root
        ? ""
        : (item.parentReference?.path?.split("root:")[1] ?? "").replace(/^\/+/, "");
      const place =
        site.displayName || (item.parentReference?.siteId ? undefined : drive.name || "OneDrive");
      folders.push({
        driveId,
        itemId: item.id,
        name: item.root ? drive.name || "My files" : item.name,
        location: [place, drive.name, relative && decodeSafely(relative)]
          .filter(Boolean)
          .join(" › "),
        webUrl: item.webUrl ?? drive.webUrl ?? null,
      });
    }
    await runAsTenant(owner, () =>
      this.prisma.connection.updateMany({
        where: { id: row.id, userId: owner.userId, spaceId: owner.spaceId },
        data: { metadata: { ...metadataRecord(row.metadata), folders } as Prisma.InputJsonValue },
      }),
    );
    return folders;
  }

  async chosenFolders(
    owner: { spaceId: string; userId: string },
    connectionId: string,
  ): Promise<SharePointFolder[]> {
    return savedFolders((await this.ownedRow(owner, connectionId)).metadata);
  }

  // ---- internals ----

  private verifier(state: string): string {
    return createHmac("sha256", this.config.identitySecret)
      .update(`microsoft-pkce:${state}`)
      .digest("base64url");
  }

  /** The person's own Microsoft connections, for one app or all of them. */
  private rows(
    context: Pick<AdapterContext, "spaceId" | "userId">,
    where: Prisma.ConnectionWhereInput,
    app?: MicrosoftApp,
  ): Promise<ConnectionRow[]> {
    return runAsTenant(context, () =>
      this.prisma.connection.findMany({
        where: {
          ...where,
          spaceId: context.spaceId,
          userId: context.userId,
          connectorId: MICROSOFT_CONNECTOR_ID,
          provider: app ?? { in: MICROSOFT_APP_SLUGS },
        },
        select: {
          id: true,
          spaceId: true,
          userId: true,
          provider: true,
          status: true,
          secretId: true,
          providerRef: true,
          metadata: true,
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      }),
    );
  }

  private async ownedRow(
    owner: { spaceId: string; userId: string },
    connectionId: string,
  ): Promise<ConnectionRow> {
    const [row] = await this.rows(
      owner,
      { id: connectionId, status: "connected" },
      SHAREPOINT_PROVIDER,
    );
    if (!row) throw new Error("SharePoint is not connected.");
    return row;
  }

  private async accessToken(
    row: ConnectionRow,
    owner: Pick<AdapterContext, "spaceId" | "userId">,
  ): Promise<string> {
    const cached = this.accessTokens.get(row.id);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
    const app = appOf(row);
    const name = MICROSOFT_APPS[app].name;
    if (!row.secretId) throw new MicrosoftReconnectError(name);
    const material = await runAsTenant(owner, async () => {
      const secret = await this.prisma.secret.findFirst({
        where: { id: row.secretId!, userId: owner.userId },
        select: { id: true, ciphertext: true },
      });
      if (!secret) throw new MicrosoftReconnectError(name);
      return {
        id: secret.id,
        tokens: JSON.parse(await this.secrets.load(secret.ciphertext, secret.id)) as StoredTokens,
      };
    });
    let tokens: Awaited<ReturnType<MicrosoftConnector["tokenRequest"]>>;
    try {
      tokens = await this.tokenRequest(app, {
        grant_type: "refresh_token",
        refresh_token: material.tokens.refreshToken,
      });
    } catch (error) {
      if (error instanceof MicrosoftGrantError) {
        await runAsTenant(owner, () =>
          this.prisma.connection.updateMany({
            where: { id: row.id, status: "connected" },
            data: { status: "error" },
          }),
        );
        throw new MicrosoftReconnectError(name);
      }
      throw error;
    }
    this.accessTokens.set(row.id, {
      value: tokens.access_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3_600) * 1_000,
    });
    if (tokens.refresh_token && tokens.refresh_token !== material.tokens.refreshToken) {
      await this.replaceRefreshToken(row, owner, material, tokens.refresh_token).catch((error) =>
        getLogger().warn("microsoft refresh token not saved", {
          "connection.id": row.id,
          reason: sanitizeConnectorError(error, [tokens.refresh_token ?? ""]),
        }),
      );
    }
    return tokens.access_token;
  }

  private async replaceRefreshToken(
    row: ConnectionRow,
    owner: Pick<AdapterContext, "spaceId" | "userId">,
    material: { id: string; tokens: StoredTokens },
    refreshToken: string,
  ): Promise<void> {
    const stored = await this.secrets.put(
      JSON.stringify({ ...material.tokens, refreshToken } satisfies StoredTokens),
      {
        operationId: "microsoft.refresh",
        traceId: "microsoft.refresh",
        spaceId: owner.spaceId,
        userId: owner.userId,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    await runAsTenant(owner, () =>
      this.prisma.$transaction(async (tx) => {
        await tx.secret.create({
          data: {
            id: stored.id,
            spaceId: owner.spaceId,
            userId: owner.userId,
            kind: "connector",
            ciphertext: stored.ciphertext,
          },
        });
        const moved = await tx.connection.updateMany({
          where: { id: row.id, secretId: material.id },
          data: { secretId: stored.id },
        });
        // Another refresh already moved it on; keep that one.
        if (moved.count === 0) await tx.secret.deleteMany({ where: { id: stored.id } });
        else await tx.secret.deleteMany({ where: { id: material.id } });
      }),
    );
  }

  private async tokenRequest(
    app: MicrosoftApp,
    fields: Record<string, string>,
  ): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  }> {
    const response = await this.fetch()(
      `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          scope: MICROSOFT_APPS[app].scopes,
          ...fields,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    const text = new TextDecoder().decode(
      await readBodyCapped(response, MAX_JSON_BYTES, AbortSignal.timeout(REQUEST_TIMEOUT_MS)),
    );
    let body: { access_token?: string; error?: string; error_description?: string } = {};
    try {
      body = JSON.parse(text);
    } catch {}
    if (!response.ok || !body.access_token) {
      if (body.error === "invalid_grant" || body.error === "interaction_required") {
        throw new MicrosoftGrantError(body.error);
      }
      throw new Error(
        `Microsoft sign-in failed: ${body.error ?? response.status}${
          body.error_description ? ` (${body.error_description.split("\r\n")[0]})` : ""
        }`,
      );
    }
    return body as { access_token: string; refresh_token?: string; expires_in?: number };
  }

  private async graphJson<T>(
    token: string,
    path: string,
    signal?: AbortSignal,
    options: { app?: string; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const app = options.app ?? "SharePoint";
    const abort = combineSignals(signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
    const response = await this.fetch()(`${GRAPH}${path}`, {
      method: "GET",
      headers: {
        ...options.headers,
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
      signal: abort,
    });
    const text = new TextDecoder().decode(await readBodyCapped(response, MAX_JSON_BYTES, abort));
    if (!response.ok) throw graphError(app, response.status, text);
    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * Outlook as the signed-in person, through their own token only. The token can write, so
   * this client only ever sends a GET without a body, and only to a mailbox read path.
   */
  private mailGraph(token: string, signal: AbortSignal | undefined, mailbox?: string): MailGraph {
    return {
      mailbox,
      json: (path, headers) => {
        assertMailRead(path);
        const prefer = headers?.prefer;
        return this.graphJson(token, path, signal, {
          app: "Outlook",
          headers: prefer ? { prefer } : undefined,
        });
      },
      bytes: async (path, maxBytes) => {
        assertMailRead(path);
        const abort = combineSignals(signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS));
        const response = await this.fetch()(`${GRAPH}${path}`, {
          method: "GET",
          headers: { authorization: `Bearer ${token}` },
          signal: abort,
          redirect: "follow",
        });
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw graphError("Outlook", response.status, text);
        }
        try {
          return await readBodyCapped(response, maxBytes, abort);
        } catch (error) {
          if (error instanceof Error && error.message === "Response is too large") {
            throw new Error("That attachment is larger than 50 MB.");
          }
          throw error;
        }
      },
      fileName: computerFileName,
    };
  }

  /** The chosen folders as they are now, so a moved or renamed folder keeps its contents. */
  private async resolveFolders(
    token: string,
    folders: SharePointFolder[],
    signal?: AbortSignal,
  ): Promise<Array<{ driveId: string; itemId: string; path: string }>> {
    const resolved = await Promise.all(
      folders.map(async (folder) => {
        try {
          const item = await this.graphJson<DriveItem>(
            token,
            `/drives/${encodeURIComponent(folder.driveId)}/items/${encodeURIComponent(folder.itemId)}?$select=id,name,root,folder,parentReference`,
            signal,
          );
          const path = drivePath(item);
          return path === undefined
            ? []
            : [{ driveId: folder.driveId, itemId: folder.itemId, path }];
        } catch {
          return [];
        }
      }),
    );
    return resolved.flat();
  }

  private async scopedItem(
    token: string,
    scope: Array<{ driveId: string; itemId: string; path: string }>,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<DriveItem> {
    const driveId = typeof args.drive_id === "string" ? args.drive_id.trim() : "";
    const itemId = typeof args.item_id === "string" ? args.item_id.trim() : "";
    if (!driveId || !itemId) throw new Error("Give the drive_id and item_id from SharePoint.");
    const item = await this.graphJson<DriveItem>(
      token,
      `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}?$select=${ITEM_FIELDS}`,
      signal,
    );
    if (item.root) item.parentReference = { ...item.parentReference, driveId };
    if (!withinFolders(item, scope)) {
      throw new Error("That item is outside the SharePoint folders the person chose.");
    }
    return item;
  }

  private async search(
    token: string,
    scope: Array<{ driveId: string; itemId: string; path: string }>,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    const query = typeof args.query === "string" ? args.query.trim().slice(0, 200) : "";
    if (!query) throw new Error("Give some words to search for.");
    const driveId = typeof args.drive_id === "string" ? args.drive_id.trim() : "";
    const itemId = typeof args.item_id === "string" ? args.item_id.trim() : "";
    let targets = scope;
    if (driveId && itemId) {
      const item = await this.scopedItem(token, scope, args, signal);
      const path = drivePath(item);
      if (!item.folder && !item.root) throw new Error("Search inside a folder, not a file.");
      targets = [{ driveId, itemId: item.id, path: path ?? "" }];
    }
    const escaped = query.replace(/'/g, "''");
    const found = await Promise.all(
      targets.map(async (target) => {
        const result = await this.graphJson<{ value?: DriveItem[] }>(
          token,
          `/drives/${encodeURIComponent(target.driveId)}/items/${encodeURIComponent(target.itemId)}/search(q='${encodeURIComponent(escaped)}')?$top=${SEARCH_LIMIT}&$select=${ITEM_FIELDS}`,
          signal,
        ).catch(() => ({ value: [] as DriveItem[] }));
        return (result.value ?? []).map((item) => ({ target, item }));
      }),
    );
    const seen = new Set<string>();
    const results: ReturnType<typeof describeItem>[] = [];
    for (const { target, item } of found.flat()) {
      if (results.length >= SEARCH_LIMIT) break;
      let checked = item;
      if (!checked.parentReference?.driveId) {
        checked = {
          ...checked,
          parentReference: { ...checked.parentReference, driveId: target.driveId },
        };
      }
      if (drivePath(checked) === undefined) {
        checked = await this.graphJson<DriveItem>(
          token,
          `/drives/${encodeURIComponent(target.driveId)}/items/${encodeURIComponent(item.id)}?$select=${ITEM_FIELDS}`,
          signal,
        ).catch(() => checked);
      }
      const key = `${checked.parentReference?.driveId}:${checked.id}`;
      if (seen.has(key) || !withinFolders(checked, scope)) continue;
      seen.add(key);
      results.push(describeItem(checked));
    }
    return { query, results, ...(results.length === 0 ? { note: "Nothing matched." } : {}) };
  }

  private async download(
    token: string,
    item: DriveItem,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const abort = combineSignals(signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS));
    const response = await this.fetch()(
      `${GRAPH}/drives/${encodeURIComponent(item.parentReference?.driveId ?? "")}/items/${encodeURIComponent(item.id)}/content`,
      { headers: { authorization: `Bearer ${token}` }, signal: abort, redirect: "follow" },
    );
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`SharePoint could not send that file (HTTP ${response.status}).`);
    }
    try {
      return await readBodyCapped(response, SHAREPOINT_MAX_FILE_BYTES, abort);
    } catch (error) {
      if (error instanceof Error && error.message === "Response is too large") {
        throw new Error("That file is larger than 50 MB.");
      }
      throw error;
    }
  }

  private fetch(): typeof fetch {
    return this.dependencies.fetch ?? globalThis.fetch;
  }
}

class MicrosoftGrantError extends Error {}

function graphError(app: string, status: number, text: string): Error {
  let message = `HTTP ${status}`;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    if (parsed.error?.message) message = parsed.error.message;
  } catch {}
  const thing = app === "Outlook" ? "that email, folder or attachment" : "that item";
  if (status === 404) return new Error(`${app} could not find ${thing}.`);
  if (status === 403) return new Error(`${app} refused access to ${thing} for this person.`);
  return new Error(`${app} returned ${message}`);
}

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
