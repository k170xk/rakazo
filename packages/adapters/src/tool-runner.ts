import { constants } from "node:fs";
import { lstat, mkdir, open, readdir } from "node:fs/promises";
import path from "node:path";
import type { ComputerFileEntry, ComputerRef, SandboxProvider } from "@rakazo/adapter-kit";
import type { ComputerMode } from "@rakazo/contracts";
import { outgoingCorrelationHeaders } from "@rakazo/logging";
import { normalizeWorkspacePath, teamBotWorkspaceDirectory } from "./computer-support.js";
import { measureTree, pinnedDirectory } from "./file-retention.js";

/** OCSC programs that finish in one command and need no screen, so a tool runner can run them. */
export const RUNNER_PROGRAMS: ReadonlySet<string> = new Set(["word", "pptx", "xlsx", "pdf"]);
/** Server folder beside the homes holding colleague conversation folders; no computer mounts it. */
export const TOOL_WORK = "tool-work";
/** A colleague conversation folder stops taking new work past this size. */
export const CONVERSATION_FOLDER_MAX_BYTES = 1024 ** 3;

/**
 * The one folder a run's OCSC commands and file tools reach without a computer.
 * `base` joined with a workspace path (as resolveRunFilePath gives it) is the file on disk;
 * the runner mounts `mount` (relative to the data directory) and starts in `cwd` inside it.
 */
export interface ToolRunnerWorkspace {
  base: string;
  mount: string;
  cwd: string;
  /** The conversation folder's path on disk, set on a colleague's turn. */
  conversation?: string;
}

/**
 * A colleague's turn works in tool-work/conversations/<thread>, outside every home; a
 * Tools-only person's own turn works in their bot folder in their home.
 */
export function toolRunnerWorkspace(input: {
  dataDir: string;
  homePath: string | null;
  mode: ComputerMode;
  botId: string;
  folder: string | undefined;
}): ToolRunnerWorkspace | undefined {
  const dataDir = path.resolve(input.dataDir);
  if (input.folder) {
    const base = path.join(dataDir, TOOL_WORK);
    return {
      base,
      mount: path.posix.join(TOOL_WORK, normalizeWorkspacePath(input.folder)),
      cwd: "",
      conversation: path.join(base, input.folder),
    };
  }
  if (!input.homePath) return undefined;
  const mount = path.relative(dataDir, path.resolve(input.homePath)).split(path.sep).join("/");
  if (!/^homes\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(mount)) return undefined;
  return {
    base: path.resolve(input.homePath),
    mount,
    cwd: input.mode === "team" ? teamBotWorkspaceDirectory(input.botId) : "",
  };
}

/** Stands in for a computer where the file helpers ask for one; the folder files ignore it. */
export const TOOL_RUNNER_COMPUTER: ComputerRef = {
  id: "tool-runner",
  botId: "tool-runner",
  kind: "docker",
  providerRef: "tool-runner",
};

export type WorkspaceFiles = Pick<SandboxProvider, "listFiles" | "readFile" | "writeFile">;

function splitPath(stored: string) {
  const normalized = normalizeWorkspacePath(stored);
  const segments = normalized.split("/").filter(Boolean);
  return { dir: segments.slice(0, -1).join("/"), name: segments.at(-1) ?? "", normalized };
}

/**
 * File tools straight on this server's disk under `base`, opening every folder without
 * following links, so nothing in the folder can point them elsewhere.
 */
export function folderFiles(base: string): WorkspaceFiles {
  const ensureBase = () => mkdir(base, { recursive: true });
  return {
    async listFiles(_computer, stored) {
      await ensureBase();
      const normalized = normalizeWorkspacePath(stored);
      const pinned = await pinnedDirectory(base, normalized);
      if (!pinned) return [];
      try {
        const entries: ComputerFileEntry[] = [];
        for (const entry of await readdir(pinned.path, { withFileTypes: true })) {
          const info = await lstat(path.join(pinned.path, entry.name)).catch(() => null);
          if (!info || info.isSymbolicLink()) continue;
          entries.push({
            path: normalized ? `${normalized}/${entry.name}` : entry.name,
            kind: info.isDirectory() ? "dir" : "file",
            size: info.isFile() ? info.size : 0,
          });
        }
        return entries;
      } finally {
        await pinned.close();
      }
    },
    async readFile(_computer, stored, _context, options) {
      await ensureBase();
      const { dir, name } = splitPath(stored);
      const pinned = await pinnedDirectory(base, dir);
      if (!pinned || !name) throw new Error("file not found");
      try {
        const handle = await open(
          path.join(pinned.path, name),
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          const info = await handle.stat();
          if (!info.isFile()) throw new Error("file not found");
          if (options?.maxBytes !== undefined && info.size > options.maxBytes) {
            throw new Error(`file exceeds ${options.maxBytes} bytes`);
          }
          return new Uint8Array(await handle.readFile());
        } finally {
          await handle.close();
        }
      } finally {
        await pinned.close();
      }
    },
    async writeFile(_computer, file) {
      await ensureBase();
      const { dir, name } = splitPath(file.path);
      if (!name) throw new Error("A file path is required");
      const pinned = await pinnedDirectory(base, dir, { create: true });
      if (!pinned) throw new Error("That folder cannot be written");
      try {
        const handle = await open(
          path.join(pinned.path, name),
          constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
          file.executable ? 0o755 : 0o644,
        );
        try {
          await handle.writeFile(file.content);
        } finally {
          await handle.close();
        }
      } finally {
        await pinned.close();
      }
    },
  };
}

/** Refuses new work in a colleague conversation folder that has grown past its limit. */
export async function conversationFolderRefusal(workspace: ToolRunnerWorkspace) {
  if (!workspace.conversation) return undefined;
  const { size } = await measureTree(workspace.conversation);
  if (size <= CONVERSATION_FOLDER_MAX_BYTES) return undefined;
  return "This conversation's files have reached 1 GB. Start a new chat with the bot to keep making documents.";
}

export interface ToolRunOutput {
  stdout: string;
  stderr: string;
  code: number;
}

/** Calls the tool runners: the supervisor's /tool-runs endpoint on this server or another. */
export class ToolRunnerClient {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async status(signal?: AbortSignal) {
    const res = await fetch(`${this.url.replace(/\/$/, "")}/tool-runs/status`, {
      headers: { authorization: `Bearer ${this.token}` },
      signal: signal ?? AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`tool runner status failed: ${res.status}`);
    return (await res.json()) as { slots: number; running: number; queued: number };
  }

  async run(input: {
    workspace: ToolRunnerWorkspace;
    program: string;
    args: readonly string[];
    owner: string;
    timeoutMs: number;
    signal: AbortSignal;
    onQueued?: (ahead: number) => void;
    onOutput?: (snapshot: { stdout: string; stderr: string }) => void;
  }): Promise<ToolRunOutput> {
    const res = await fetch(`${this.url.replace(/\/$/, "")}/tool-runs/run`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        ...outgoingCorrelationHeaders(),
      },
      body: JSON.stringify({
        mount: input.workspace.mount,
        cwd: input.workspace.cwd,
        program: input.program,
        args: input.args,
        owner: input.owner,
        timeoutMs: input.timeoutMs,
      }),
      signal: input.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`tool runner refused the command: ${res.status} ${await res.text()}`.trim());
    }
    const result: ToolRunOutput = { stdout: "", stderr: "", code: 1 };
    const decoder = new TextDecoder();
    let pending = "";
    const handle = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as {
        type: string;
        data?: string;
        code?: number;
        ahead?: number;
      };
      if (event.type === "stdout") result.stdout += event.data ?? "";
      else if (event.type === "stderr") result.stderr += event.data ?? "";
      else if (event.type === "exit") result.code = event.code ?? 1;
      else if (event.type === "queued") input.onQueued?.(event.ahead ?? 0);
      if (event.type === "stdout" || event.type === "stderr") {
        input.onOutput?.({ stdout: result.stdout, stderr: result.stderr });
      }
    };
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      pending += decoder.decode(chunk, { stream: true });
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        handle(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
    }
    handle(pending + decoder.decode());
    return result;
  }
}

/** The runner client for a Docker install, unless RAKAZO_TOOL_RUNNER=off. */
export function toolRunnerFromEnv(
  env: NodeJS.ProcessEnv,
  sandboxProvider: string,
  supervisor: { url: string; token: string | undefined },
): ToolRunnerClient | undefined {
  if (env.RAKAZO_TOOL_RUNNER === "off") return undefined;
  const url = env.RAKAZO_TOOL_RUNNER_URL || (sandboxProvider === "docker" ? supervisor.url : "");
  const token = env.RAKAZO_TOOL_RUNNER_TOKEN || supervisor.token;
  if (!url || !token) return undefined;
  return new ToolRunnerClient(url, token);
}
