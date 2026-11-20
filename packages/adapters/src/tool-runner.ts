import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm, utimes } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ComputerFileEntry, ComputerRef, SandboxProvider } from "@rakazo/adapter-kit";
import type { ComputerMode } from "@rakazo/contracts";
import { outgoingCorrelationHeaders } from "@rakazo/logging";
import { normalizeWorkspacePath, teamBotWorkspaceDirectory } from "./computer-support.js";
import { measureTree, pinnedDirectory } from "./file-retention.js";

/** OCSC programs that finish in one command and need no screen, so a tool runner can run them. */
export const RUNNER_PROGRAMS: ReadonlySet<string> = new Set([
  "word",
  "pptx",
  "xlsx",
  "pdf",
  "plan",
  "video",
]);
/** Server folder beside the homes holding colleague conversation folders; no computer mounts it. */
export const TOOL_WORK = "tool-work";
/** A colleague conversation folder stops taking new work past this size: a 500 MB upload and two copies. */
export const CONVERSATION_FOLDER_MAX_BYTES = 3 * 1024 ** 3;

/** Inputs this size or larger run with the large-document memory from the start. */
export const LARGE_INPUT_BYTES = 40 * 1024 ** 2;
const INPUT_FLAGS: ReadonlySet<string> = new Set(["--in", "--old", "--new"]);

/** The size of the biggest file an OCSC command reads, from its `--in`, `--old` and `--new`. */
export async function largestInputBytes(workspace: ToolRunnerWorkspace, args: readonly string[]) {
  const folder = path.resolve(workspace.root, workspace.cwd);
  let largest = 0;
  for (const [index, arg] of args.entries()) {
    const equals = arg.indexOf("=");
    const value = INPUT_FLAGS.has(arg)
      ? args[index + 1]
      : equals > 0 && INPUT_FLAGS.has(arg.slice(0, equals))
        ? arg.slice(equals + 1)
        : undefined;
    if (!value) continue;
    const full = path.resolve(folder, value);
    if (!full.startsWith(`${folder}${path.sep}`)) continue;
    const info = await lstat(full).catch(() => null);
    if (info?.isFile()) largest = Math.max(largest, info.size);
  }
  return largest;
}

/**
 * The one folder a run's OCSC commands and file tools reach without a computer.
 * `base` joined with a workspace path (as resolveRunFilePath gives it) is the file on disk;
 * the runner mounts `mount` (relative to the data directory) and starts in `cwd` inside it.
 */
export interface ToolRunnerWorkspace {
  base: string;
  mount: string;
  cwd: string;
  /** The mounted folder on this server's disk. */
  root: string;
  /** The conversation folder's path on disk, set on a colleague's turn. */
  conversation?: string;
}

const HOME_KEY = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/**
 * A colleague's turn works in tool-work/conversations/<thread>, outside every home; a
 * Tools-only person's own turn works in their bot folder in their home, or in its document
 * home (`documentHomePath`) when their computer keeps its own copy.
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
    const conversation = path.join(base, input.folder);
    return {
      base,
      mount: path.posix.join(TOOL_WORK, normalizeWorkspacePath(input.folder)),
      cwd: "",
      root: conversation,
      conversation,
    };
  }
  if (!input.homePath) return undefined;
  const mount = path.relative(dataDir, path.resolve(input.homePath)).split(path.sep).join("/");
  const [, parent, key] = /^(homes|tool-work\/documents)\/([^/]+)$/.exec(mount) ?? [];
  if (!parent || !key || !HOME_KEY.test(key)) return undefined;
  return {
    base: path.resolve(input.homePath),
    mount,
    root: path.resolve(input.homePath),
    cwd: input.mode === "team" ? teamBotWorkspaceDirectory(input.botId) : "",
  };
}

/** A person who never had a computer has no home yet; the runner only mounts folders that exist. */
export async function ensureToolRunnerFolder(workspace: ToolRunnerWorkspace) {
  await mkdir(path.join(workspace.root, workspace.cwd), { recursive: true, mode: 0o755 });
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
  return "This conversation's files have reached 3 GB. Start a new chat with the agent to keep making documents.";
}

export interface ToolRunOutput {
  stdout: string;
  stderr: string;
  code: number;
}

export interface FolderFile {
  path: string;
  size: number;
  mtimeMs: number;
}

/** Plain files under `under` in `root`, skipping links, listed the way the runner lists its copy. */
export async function listFolderFiles(root: string, under: string, maxEntries = 20_000) {
  const files: FolderFile[] = [];
  const walk = async (relative: string) => {
    const pinned = await pinnedDirectory(root, relative);
    if (!pinned) return;
    const folders: string[] = [];
    try {
      for (const entry of await readdir(pinned.path, { withFileTypes: true })) {
        if (files.length >= maxEntries) throw new Error("too many files to copy");
        const info = await lstat(path.join(pinned.path, entry.name)).catch(() => null);
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        if (!info || info.isSymbolicLink()) continue;
        if (info.isFile()) {
          files.push({ path: child, size: info.size, mtimeMs: Math.round(info.mtimeMs) });
        } else if (info.isDirectory()) {
          folders.push(child);
        }
      }
    } finally {
      await pinned.close();
    }
    for (const folder of folders) await walk(folder);
  };
  await walk(under);
  return files;
}

const sameFile = (a: FolderFile | undefined, b: FolderFile) =>
  a !== undefined && a.size === b.size && a.mtimeMs === b.mtimeMs;

type SlotStats = {
  slots: number;
  running: number;
  queued: number;
  /** The most one person holds at once, and how many the asking person holds. */
  perOwner?: number;
  ownerRunning?: number;
};

export interface ToolRunnerStatus extends SlotStats {
  video?: SlotStats;
  /** Absent from runners older than the large-document lane. */
  large?: SlotStats;
  /** Absent from runners older than overflow; such a runner is never treated as quiet. */
  host?: { load1: number; cpus: number; memAvailableBytes: number | null };
}

/** An overflow runner takes work only while its server is this quiet. */
export const OVERFLOW_MAX_LOAD_PER_CPU = 0.5;
export const OVERFLOW_MIN_AVAILABLE_BYTES = 8 * 1024 ** 3;
const OVERFLOW_STATUS_TIMEOUT_MS = 1500;
/** An overflow runner that did not answer is left alone this long. */
const OVERFLOW_DOWN_MS = 30_000;

/** Runners ping every 30 seconds, so this much silence means the connection is gone. */
export const TOOL_RUN_SILENCE_MAX_MS = 2 * 60_000;
/** Longest a command waits for a slot before the chat is told the runners are busy. */
export const TOOL_RUN_QUEUE_MAX_MS = 15 * 60_000;
const VIDEO_QUEUE_MAX_MS = 60 * 60_000;
/** Each server runs one large document at a time, and one can take half an hour. */
const LARGE_QUEUE_MAX_MS = 60 * 60_000;
/** Copying a folder to or from a runner on another server. */
const TOOL_RUN_SYNC_MAX_MS = 10 * 60_000;

/** How long a sent command may go unreported by its runner before it stops counting as taken. */
const UNREPORTED_HOLD_MS = 1500;

/**
 * Whether the asking person's command would start at once. A runner that caps each person
 * keeps only capped people waiting while a runner is free, so their queue does not count.
 */
function hasFreeSlot(stats: SlotStats | undefined, unreported = 0) {
  if (stats === undefined || stats.running + unreported >= stats.slots) return false;
  if (stats.perOwner === undefined) return stats.queued === 0;
  return (stats.ownerRunning ?? 0) < stats.perOwner;
}

type Lane = "normal" | "large";

function laneFor(program: string, large: boolean | undefined): Lane {
  return large && program !== "video" ? "large" : "normal";
}

/** `unreported` counts commands this process sent that the runner may not list yet. */
function freeFor(status: ToolRunnerStatus, program: string, unreported = 0, lane: Lane = "normal") {
  if (lane === "large") return hasFreeSlot(status.large, unreported);
  return hasFreeSlot(status, unreported) && (program !== "video" || hasFreeSlot(status.video));
}

export function overflowRunnerQuiet(
  status: ToolRunnerStatus,
  program: string,
  unreported = 0,
  lane: Lane = "normal",
) {
  const host = status.host;
  return (
    freeFor(status, program, unreported, lane) &&
    host !== undefined &&
    host.cpus > 0 &&
    host.load1 / host.cpus < OVERFLOW_MAX_LOAD_PER_CPU &&
    host.memAvailableBytes !== null &&
    host.memAvailableBytes >= OVERFLOW_MIN_AVAILABLE_BYTES
  );
}

/** Calls the tool runners: the supervisor's /tool-runs endpoint on this server or another. */
export class ToolRunnerClient {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly options: {
      /** Runners on another server work on a copy: send changed files first, fetch results after. */
      synced?: boolean;
      /**
       * Runners on other servers used only while every slot here is taken and their own server
       * is quiet; a command otherwise waits here. Each command runs start to finish on one runner.
       */
      overflow?: readonly ToolRunnerClient[];
      limits?: { silenceMs?: number; queueMs?: number };
    } = {},
  ) {}

  /**
   * Commands sent here that the runner may not count yet, so a burst that arrives at once
   * does not all read the same free slots. Each choice and its reservation share one tick.
   */
  private readonly unreported: Record<Lane, number> = { normal: 0, large: 0 };
  /** When this runner, as an overflow runner, may be asked again after it failed to answer. */
  private downUntil = 0;

  private reserve(lane: Lane) {
    this.unreported[lane] += 1;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.unreported[lane] -= 1;
    };
  }

  private async pick(
    program: string,
    owner: string,
    lane: Lane,
  ): Promise<{ runner: ToolRunnerClient; reported: () => void }> {
    const overflow = this.options.overflow ?? [];
    if (overflow.length === 0) return { runner: this, reported: () => undefined };
    const here = await this.status(AbortSignal.timeout(OVERFLOW_STATUS_TIMEOUT_MS), owner).catch(
      () => undefined,
    );
    if (here && freeFor(here, program, this.unreported[lane], lane)) {
      return { runner: this, reported: this.reserve(lane) };
    }
    // Busy here, or not answering: a quiet runner elsewhere takes it, otherwise it waits here.
    for (const runner of overflow) {
      if (runner.downUntil > Date.now()) continue;
      const there = await runner
        .status(AbortSignal.timeout(OVERFLOW_STATUS_TIMEOUT_MS), owner)
        .catch(() => {
          runner.downUntil = Date.now() + OVERFLOW_DOWN_MS;
          return undefined;
        });
      if (there && overflowRunnerQuiet(there, program, runner.unreported[lane], lane)) {
        return { runner, reported: runner.reserve(lane) };
      }
    }
    return { runner: this, reported: this.reserve(lane) };
  }

  private endpoint(route: string, query?: Record<string, string>) {
    const search = query ? `?${new URLSearchParams(query)}` : "";
    return `${this.url.replace(/\/$/, "")}${route}${search}`;
  }

  private headers(extra: Record<string, string> = {}) {
    return { authorization: `Bearer ${this.token}`, ...outgoingCorrelationHeaders(), ...extra };
  }

  private async postJson<T>(route: string, body: unknown, signal: AbortSignal) {
    const res = await fetch(this.endpoint(route), {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`tool runner ${route} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  async status(signal?: AbortSignal, owner?: string) {
    const res = await fetch(this.endpoint("/tool-runs/status", owner ? { owner } : undefined), {
      headers: { authorization: `Bearer ${this.token}` },
      signal: signal ?? AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`tool runner status failed: ${res.status}`);
    return (await res.json()) as ToolRunnerStatus;
  }

  private async remoteFiles(workspace: ToolRunnerWorkspace, signal: AbortSignal) {
    const { files } = await this.postJson<{ files: FolderFile[] }>(
      "/tool-runs/files/list",
      { mount: workspace.mount, under: workspace.cwd },
      signal,
    );
    return new Map(files.map((file) => [file.path, file]));
  }

  /** Brings the runner's copy in line with this server's folder; returns what was sent. */
  private async sendFolder(workspace: ToolRunnerWorkspace, signal: AbortSignal) {
    const [local, remote] = await Promise.all([
      listFolderFiles(workspace.root, workspace.cwd),
      this.remoteFiles(workspace, signal),
    ]);
    const sent = new Map(local.map((file) => [file.path, file]));
    for (const file of local) {
      if (!sameFile(remote.get(file.path), file)) await this.upload(workspace, file, signal);
    }
    const gone = [...remote.keys()].filter((name) => !sent.has(name));
    if (gone.length > 0) {
      await this.postJson(
        "/tool-runs/files/delete",
        { mount: workspace.mount, paths: gone },
        signal,
      );
    }
    return sent;
  }

  /** Copies back every file the run made or changed. */
  private async fetchResults(
    workspace: ToolRunnerWorkspace,
    sent: Map<string, FolderFile>,
    signal: AbortSignal,
  ) {
    for (const file of (await this.remoteFiles(workspace, signal)).values()) {
      if (!sameFile(sent.get(file.path), file)) await this.download(workspace, file, signal);
    }
  }

  private async upload(workspace: ToolRunnerWorkspace, file: FolderFile, signal: AbortSignal) {
    const { dir, name } = splitPath(file.path);
    const pinned = await pinnedDirectory(workspace.root, dir);
    if (!pinned) return;
    try {
      const handle = await open(
        path.join(pinned.path, name),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      ).catch(() => null);
      if (!handle) return;
      const body = handle.createReadStream();
      try {
        const res = await fetch(
          this.endpoint("/tool-runs/files", {
            mount: workspace.mount,
            path: file.path,
            mtimeMs: String(file.mtimeMs),
          }),
          {
            method: "PUT",
            headers: this.headers({ "content-type": "application/octet-stream" }),
            body: Readable.toWeb(body) as ReadableStream,
            duplex: "half",
            signal,
          } as RequestInit,
        );
        if (!res.ok) {
          throw new Error(`could not copy ${file.path} to the runner: ${await res.text()}`);
        }
      } finally {
        body.destroy();
      }
    } finally {
      await pinned.close();
    }
  }

  private async download(workspace: ToolRunnerWorkspace, file: FolderFile, signal: AbortSignal) {
    const res = await fetch(
      this.endpoint("/tool-runs/files", { mount: workspace.mount, path: file.path }),
      { headers: this.headers(), signal },
    );
    if (res.status === 404) return;
    if (!res.ok || !res.body) {
      throw new Error(`could not copy ${file.path} from the runner: ${await res.text()}`);
    }
    const { dir, name } = splitPath(file.path);
    const pinned = await pinnedDirectory(workspace.root, dir, { create: true });
    if (!pinned) throw new Error(`could not save ${file.path}: that folder cannot be written`);
    const temporary = path.join(pinned.path, `.${name}.${randomUUID().slice(0, 8)}.download`);
    try {
      const handle = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o644,
      );
      await pipeline(
        Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
        handle.createWriteStream(),
      );
      const when = new Date(Number(res.headers.get("x-rakazo-mtime-ms")) || file.mtimeMs);
      await utimes(temporary, when, when);
      await rename(temporary, path.join(pinned.path, name));
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    } finally {
      await pinned.close();
    }
  }

  async run(input: {
    workspace: ToolRunnerWorkspace;
    program: string;
    args: readonly string[];
    owner: string;
    /** Written as the author of tracked changes and review comments. */
    author?: string;
    timeoutMs: number;
    signal: AbortSignal;
    /** The file is too big for an ordinary runner's memory. */
    large?: boolean;
    onQueued?: (ahead: number) => void;
    /** A queued command got its runner. */
    onStarted?: () => void;
    /** The command ran out of memory and starts again with the large-document memory. */
    onRetry?: () => void;
    onOutput?: (snapshot: { stdout: string; stderr: string }) => void;
  }): Promise<ToolRunOutput> {
    const lane = laneFor(input.program, input.large);
    const { runner, reported } = await this.pick(input.program, input.owner, lane);
    try {
      return await runner.runHere(input, reported);
    } finally {
      reported();
    }
  }

  private async runHere(
    input: Parameters<ToolRunnerClient["run"]>[0],
    reported: () => void,
  ): Promise<ToolRunOutput> {
    const synced = this.options.synced === true;
    const syncSignal = () =>
      AbortSignal.any([input.signal, AbortSignal.timeout(TOOL_RUN_SYNC_MAX_MS)]);
    const sent = synced ? await this.sendFolder(input.workspace, syncSignal()) : undefined;
    const stop = new AbortController();
    const fail = (message: string) => stop.abort(new ToolRunnerGaveUp(message));
    let silence: NodeJS.Timeout | undefined;
    let queueWait: NodeJS.Timeout | undefined;
    const heard = () => {
      clearTimeout(silence);
      silence = setTimeout(
        () => fail("lost contact with the document runner; try the command again"),
        this.options.limits?.silenceMs ?? TOOL_RUN_SILENCE_MAX_MS,
      );
    };
    let large = laneFor(input.program, input.large) === "large";
    const queueMaxMs = () =>
      this.options.limits?.queueMs ??
      (input.program === "video"
        ? VIDEO_QUEUE_MAX_MS
        : large
          ? LARGE_QUEUE_MAX_MS
          : TOOL_RUN_QUEUE_MAX_MS);
    try {
      heard();
      const result = await this.stream(
        input,
        synced,
        AbortSignal.any([input.signal, stop.signal]),
        () => {
          heard();
          reported();
        },
        reported,
        {
          queued: () => {
            const waitMs = queueMaxMs();
            queueWait ??= setTimeout(
              () =>
                fail(
                  `every document runner stayed busy for ${Math.max(1, Math.round(waitMs / 60_000))} minutes; tell the person and suggest trying again in a few minutes`,
                ),
              waitMs,
            );
          },
          started: () => {
            clearTimeout(queueWait);
            queueWait = undefined;
          },
          retrying: () => {
            large = true;
          },
        },
      );
      clearTimeout(silence);
      if (sent) await this.fetchResults(input.workspace, sent, syncSignal());
      return result;
    } catch (error) {
      if (stop.signal.reason instanceof ToolRunnerGaveUp && !input.signal.aborted) {
        throw stop.signal.reason;
      }
      throw error;
    } finally {
      clearTimeout(silence);
      clearTimeout(queueWait);
    }
  }

  private async stream(
    input: Parameters<ToolRunnerClient["run"]>[0],
    synced: boolean,
    signal: AbortSignal,
    heard: () => void,
    reported: () => void,
    queue: { queued: () => void; started: () => void; retrying: () => void },
  ): Promise<ToolRunOutput> {
    const res = await fetch(this.endpoint("/tool-runs/run"), {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({
        mount: input.workspace.mount,
        cwd: input.workspace.cwd,
        program: input.program,
        args: input.args,
        owner: input.owner,
        ...(input.author ? { author: input.author } : {}),
        timeoutMs: input.timeoutMs,
        ...(synced ? { synced: true } : {}),
        ...(input.large ? { large: true } : {}),
      }),
      signal,
    }).catch((error: unknown) => {
      if (signal.aborted) throw error;
      throw new Error("could not reach the document runner; try the command again in a minute", {
        cause: error,
      });
    });
    if (!res.ok || !res.body) {
      throw new Error(`tool runner refused the command: ${res.status} ${await res.text()}`.trim());
    }
    // The runner lists an accepted command within moments, even one that prints nothing.
    setTimeout(reported, UNREPORTED_HOLD_MS).unref();
    const result: ToolRunOutput = { stdout: "", stderr: "", code: 1 };
    let exited = false;
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
      else if (event.type === "exit") {
        result.code = event.code ?? 1;
        exited = true;
      } else if (event.type === "queued") {
        queue.queued();
        input.onQueued?.(event.ahead ?? 0);
      } else if (event.type === "started") {
        queue.started();
        input.onStarted?.();
      } else if (event.type === "retrying") {
        // The first try's partial output would only confuse the second.
        result.stdout = "";
        result.stderr = "";
        queue.retrying();
        input.onRetry?.();
      }
      if (event.type === "stdout" || event.type === "stderr") {
        input.onOutput?.({ stdout: result.stdout, stderr: result.stderr });
      }
    };
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      heard();
      pending += decoder.decode(chunk, { stream: true });
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        handle(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
    }
    handle(pending + decoder.decode());
    if (!exited) {
      throw new Error("the document runner stopped before the command finished; try it again");
    }
    return result;
  }
}

class ToolRunnerGaveUp extends Error {}

/** The runner client for a Docker install, unless RAKAZO_TOOL_RUNNER=off. */
export function toolRunnerFromEnv(
  env: NodeJS.ProcessEnv,
  sandboxProvider: string,
  supervisor: { url: string; token: string | undefined },
): ToolRunnerClient | undefined {
  if (env.RAKAZO_TOOL_RUNNER === "off") return undefined;
  const remote = env.RAKAZO_TOOL_RUNNER_URL;
  const url = remote || (sandboxProvider === "docker" ? supervisor.url : "");
  const token = env.RAKAZO_TOOL_RUNNER_TOKEN || supervisor.token;
  if (!url || !token) return undefined;
  const overflow = (env.RAKAZO_TOOL_RUNNER_OVERFLOW_URLS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry !== url)
    .map((entry) => new ToolRunnerClient(entry, token, { synced: true }));
  // The stack's own supervisor shares DATA_DIR, so only a runner elsewhere is sent the folder.
  return new ToolRunnerClient(url, token, {
    synced: Boolean(remote) && remote !== supervisor.url,
    ...(overflow.length > 0 ? { overflow } : {}),
  });
}
