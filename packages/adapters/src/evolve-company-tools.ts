import type {
  AdapterContext,
  ConnectorCall,
  ConnectorEvent,
  ConnectorProvider,
  ConnectorTool,
} from "@rakazo/adapter-kit";
import type { CompanyToolsState, EvolveToolAccess } from "@rakazo/contracts";
import { EvolveToolAccessSchema } from "@rakazo/contracts";
import { provenEmail } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { companyFeatures, companyTools } from "./company-policy.js";
import type { EvolvePluginsConnection } from "./evolve-plugins.js";
import { callEvolveComputerMcp, EvolvePluginsError } from "./evolve-plugins.js";

/**
 * Evolve's tools for every bot of every account, with no MCP server for anyone to add. Skills
 * name these tools as mcp__evolve__<tool>, so that is the name the bots always see; a server a
 * member adds under the same name is renamed by the registry instead of replacing these.
 */
export const EVOLVE_COMPANY_CONNECTOR_ID = "company-evolve";
export const EVOLVE_TOOL_PREFIX = "mcp__evolve__";
const UNAVAILABLE = "unavailable";

/** The list is re-read this often; it also keeps Evolve's function warm. */
const REFRESH_MS = 10 * 60_000;
/** After a failed read, try again this soon rather than waiting for the next refresh. */
const RETRY_MS = 60_000;
const LIST_TIMEOUT_MS = 20_000;
/** Voiceovers, images and slide renders run inside the call. */
const CALL_TIMEOUT_MS = 180_000;
/** How long a run waits for a first list before going on without Evolve. */
const FIRST_LIST_WAIT_MS = 8_000;
/** Signs background reads of the tool list, which belong to no one; calls carry the person. */
const LIST_SUBJECT = "tools@ocsc-intelligence.invalid";

type EvolveTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  access?: EvolveToolAccess;
  changes?: string;
  page?: string;
  group?: string;
  approval?: boolean;
};
type RpcReply = { result?: unknown; error?: { message?: unknown } };

export interface EvolveCompanyToolsOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

/** Evolve tools never offered here: whole-slide pictures cannot be edited, and decks are made with ocsc-pptx. */
const NOT_OFFERED: ReadonlySet<string> = new Set(["create_presentation_slides"]);

function readTools(result: unknown): EvolveTool[] {
  const tools = (result as { tools?: unknown } | undefined)?.tools;
  if (!Array.isArray(tools)) throw new Error("Evolve sent no tool list");
  return tools.flatMap((tool) => {
    const entry = tool as (Partial<EvolveTool> & { _meta?: Record<string, unknown> }) | null;
    if (
      !entry ||
      typeof entry.name !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(entry.name) ||
      NOT_OFFERED.has(entry.name)
    )
      return [];
    return [
      {
        name: entry.name,
        description: typeof entry.description === "string" ? entry.description : "",
        inputSchema:
          entry.inputSchema && typeof entry.inputSchema === "object"
            ? entry.inputSchema
            : { type: "object" },
        ...toolAccess(entry._meta),
      },
    ];
  });
}

/** What Evolve says the tool does to its records, for the admin page; never sent to the model. */
function toolAccess(
  meta: Record<string, unknown> | undefined,
): Pick<EvolveTool, "access" | "changes" | "page" | "group" | "approval"> {
  const access = EvolveToolAccessSchema.safeParse(meta?.["ocsc/access"]);
  const changes = meta?.["ocsc/changes"];
  const page = meta?.["ocsc/page"];
  const group = meta?.["ocsc/group"];
  return {
    ...(access.success ? { access: access.data } : {}),
    ...(typeof changes === "string" && changes ? { changes: changes.slice(0, 300) } : {}),
    ...(typeof page === "string" && /^[a-z0-9_.-]{1,80}$/i.test(page) ? { page } : {}),
    ...(typeof group === "string" && group ? { group: group.slice(0, 60) } : {}),
    ...(typeof meta?.["ocsc/approval"] === "boolean" ? { approval: meta["ocsc/approval"] } : {}),
  };
}

class EvolveRpcError extends Error {}

function failure(error: unknown): string {
  if (error instanceof EvolveRpcError) return error.message;
  if (error instanceof EvolvePluginsError) {
    return error.status === 401
      ? "Evolve refused the sign-in: its evolve-computer-mcp function needs the signed sign-in and the same EVOLVE_PLUGINS_SECRET"
      : `Evolve answered ${error.status}`;
  }
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
    return "Evolve did not answer in time";
  return "Evolve could not be reached";
}

/** A cold function or a dropped connection, where nothing ran; never a tool's own failure. */
function worthRetrying(error: unknown): boolean {
  if (error instanceof EvolvePluginsError) return error.status === 502 || error.status === 503;
  return error instanceof TypeError;
}

/** What this process last read from Evolve, for notes on skills that name these tools. */
let lastRead: { names: Set<string>; error: string | null } | null = null;

/**
 * A note for a skill naming Evolve tools this bot cannot call right now, and why; null when all
 * are there. Without it a bot hunts for the tool and quietly does the job a lesser way.
 */
export function evolveToolsNote(skillContent: string): string | null {
  const named = [
    ...new Set(
      [...skillContent.matchAll(/mcp__evolve__([A-Za-z0-9_-]+)/g)].map((match) => match[1]!),
    ),
  ];
  if (named.length === 0) return null;
  if (!companyFeatures().evolveTools)
    return "Your company has turned Evolve's tools off, so the mcp__evolve__ tools in this skill are unavailable. Tell the user before doing the work without them.";
  const off = named.filter((name) => companyTools().disabledTools.includes(name));
  const missing = lastRead
    ? named.filter((name) => !off.includes(name) && !lastRead!.names.has(name))
    : [];
  const parts = [
    off.length ? `turned off by your company: ${off.join(", ")}` : "",
    missing.length
      ? `not offered by Evolve right now${lastRead?.error ? ` (${lastRead.error})` : ""}: ${missing.join(", ")}`
      : "",
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return `Some Evolve tools this skill uses are unavailable, ${parts.join("; ")}. If one is mcp__evolve__unavailable in your tools, call it once to retry. Otherwise tell the user which step you could not do rather than working around it silently.`;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class EvolveCompanyTools implements ConnectorProvider {
  private tools: EvolveTool[] = [];
  private checkedAt: number | null = null;
  private error: string | null = null;
  private loading: Promise<void> | null = null;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly connection: EvolvePluginsConnection | null,
    private readonly options: EvolveCompanyToolsOptions = {},
  ) {}

  describe() {
    return {
      id: EVOLVE_COMPANY_CONNECTOR_ID,
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { discover: true, oauth: false, secretsBrokered: true },
    };
  }

  /** Reads the list now and keeps it fresh; returns the stop function. */
  start(): () => void {
    if (!this.connection) return () => {};
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref?.();
    return () => clearInterval(this.timer);
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** Re-reads Evolve's tool list, keeping the last good one if this read fails. */
  refresh(): Promise<void> {
    if (!this.connection) return Promise.resolve();
    this.loading ??= this.load(this.connection).finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async load(connection: EvolvePluginsConnection): Promise<void> {
    try {
      const reply = await this.rpc(connection, LIST_SUBJECT, "tools/list", {}, LIST_TIMEOUT_MS);
      this.tools = readTools(reply);
      this.error = null;
      lastRead = { names: new Set(this.tools.map((tool) => tool.name)), error: null };
    } catch (error) {
      this.error = failure(error);
      if (lastRead) lastRead.error = this.error;
      getLogger().error("Evolve company tools could not be listed", { reason: this.error });
    }
    this.checkedAt = this.now();
  }

  private async rpc(
    connection: EvolvePluginsConnection,
    email: string,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const send = () =>
      callEvolveComputerMcp<RpcReply>(
        connection,
        email,
        { jsonrpc: "2.0", id: 1, method, params },
        { timeoutMs, signal, fetch: this.options.fetch },
      );
    let reply: RpcReply;
    try {
      reply = await send();
    } catch (error) {
      if (!worthRetrying(error) || signal?.aborted) throw error;
      await pause(1_500);
      reply = await send();
    }
    if (reply.error) {
      throw new EvolveRpcError(
        typeof reply.error.message === "string" ? reply.error.message : "Evolve refused the call",
      );
    }
    return reply.result;
  }

  private enabled(name: string): boolean {
    return !NOT_OFFERED.has(name) && !companyTools().disabledTools.includes(name);
  }

  /** What the admin page shows: every tool Evolve lists, switched on or off, and the last check. */
  health(): CompanyToolsState["evolve"] {
    const tools = this.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      enabled: this.enabled(tool.name),
      ...(tool.access ? { access: tool.access } : {}),
      ...(tool.changes ? { changes: tool.changes } : {}),
      ...(tool.page ? { page: tool.page } : {}),
      ...(tool.group ? { group: tool.group } : {}),
      ...(tool.approval !== undefined ? { approval: tool.approval } : {}),
    }));
    const checkedAt = this.checkedAt === null ? null : new Date(this.checkedAt).toISOString();
    if (!this.connection) return { status: "not-configured", tools, checkedAt, error: null };
    if (!companyFeatures().evolveTools) return { status: "off", tools, checkedAt, error: null };
    const status = this.tools.length > 0 && !this.error ? "ready" : "unavailable";
    return { status, tools, checkedAt, error: this.error };
  }

  private async currentTools(): Promise<EvolveTool[]> {
    if (!this.connection) return [];
    const stale =
      this.checkedAt === null || this.now() - this.checkedAt > (this.error ? RETRY_MS : REFRESH_MS);
    if (stale) {
      const reading = this.refresh();
      // A run waits briefly only when there is no list at all; otherwise the last one serves.
      if (this.tools.length === 0) await Promise.race([reading, pause(FIRST_LIST_WAIT_MS)]);
    }
    return this.tools.filter((tool) => this.enabled(tool.name));
  }

  async discoverTools(_context: AdapterContext): Promise<ConnectorTool[]> {
    if (!this.connection) return [];
    const tools = await this.currentTools();
    if (tools.length === 0) {
      return [
        {
          name: `${EVOLVE_TOOL_PREFIX}${UNAVAILABLE}`,
          description: `OCSC's Evolve tools (voiceover, stock media, project datasheets, people, images, infographics) could not be loaded just now: ${this.error ?? "Evolve sent no tools"}. Call this to try again, and tell the user which Evolve tool was unavailable rather than working around it silently.`,
          inputSchema: { type: "object", properties: {} },
          readOnly: true,
          route: { connectorId: EVOLVE_COMPANY_CONNECTOR_ID, toolName: UNAVAILABLE },
        },
      ];
    }
    return tools.map((tool) => ({
      name: `${EVOLVE_TOOL_PREFIX}${tool.name}`,
      description: tool.description,
      inputSchema: tool.inputSchema,
      route: { connectorId: EVOLVE_COMPANY_CONNECTOR_ID, toolName: tool.name },
    }));
  }

  async resolveCall(
    call: ConnectorCall,
    _context: AdapterContext,
  ): Promise<{ call: ConnectorCall; tool: ConnectorTool } | undefined> {
    if (call.route || !call.tool.startsWith(EVOLVE_TOOL_PREFIX)) return undefined;
    const toolName = call.tool.slice(EVOLVE_TOOL_PREFIX.length);
    const tool = (await this.currentTools()).find((entry) => entry.name === toolName);
    if (!tool) return undefined;
    const route = { connectorId: EVOLVE_COMPANY_CONNECTOR_ID, toolName };
    return {
      call: { ...call, route },
      tool: {
        name: call.tool,
        description: tool.description,
        inputSchema: tool.inputSchema,
        route,
      },
    };
  }

  async *execute(call: ConnectorCall, context: AdapterContext): AsyncIterable<ConnectorEvent> {
    const toolName = call.route?.toolName ?? call.tool.replace(EVOLVE_TOOL_PREFIX, "");
    if (!this.connection) {
      yield { type: "error", message: "Evolve's tools are not set up on this server." };
      return;
    }
    if (toolName === UNAVAILABLE) {
      await this.refresh();
      yield this.tools.length > 0
        ? {
            type: "result",
            data: `Evolve's tools are back: ${this.tools.map((tool) => tool.name).join(", ")}. Call them as ${EVOLVE_TOOL_PREFIX}<name>.`,
          }
        : { type: "error", message: `Evolve's tools are unavailable: ${this.error}` };
      return;
    }
    if (!this.enabled(toolName)) {
      yield { type: "error", message: "Your company has turned this Evolve tool off." };
      return;
    }
    const user = await runAsSystem("read the run owner's email for Evolve tools", () =>
      this.prisma.user.findUnique({
        where: { id: context.userId },
        select: { email: true, emailVerified: true },
      }),
    );
    const email = provenEmail(user);
    if (!email) {
      yield { type: "error", message: "Evolve's tools need an account with a verified email." };
      return;
    }
    try {
      const result = await this.rpc(
        this.connection,
        email,
        "tools/call",
        { name: toolName, arguments: call.args },
        CALL_TIMEOUT_MS,
        context.signal,
      );
      yield { type: "result", data: result };
    } catch (error) {
      yield { type: "error", message: `The Evolve tool ${toolName} failed: ${failure(error)}.` };
    }
  }
}
