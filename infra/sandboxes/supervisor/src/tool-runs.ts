import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { chown, lstat, mkdir, open, readdir, rename, rm, unlink } from "node:fs/promises";
import path from "node:path";
import type Docker from "dockerode";
import { z } from "zod";
import { parseMemoryBytes, parseNanoCpus, parsePidsLimit } from "./computer-spec.js";

/**
 * Tool runs: one OCSC document command in a fresh container that sees a single folder and
 * nothing else. Colleague conversations and Tools-only people work here, so their files never
 * sit where somebody's own computer, and so their shell, could reach them.
 */
export const TOOL_RUN_PROGRAMS = ["word", "pptx", "xlsx", "pdf", "video"] as const;
export const TOOL_RUN_LABEL = "rakazo.toolRun";
/** Network id shared by every tool run, kept apart from each person's computer network. */
export const TOOL_RUN_NETWORK_ID = "tool-runs";

const SEGMENT = "[A-Za-z0-9_][A-Za-z0-9_.-]*";
const MOUNT = new RegExp(`^(homes/${SEGMENT}|tool-work/conversations/${SEGMENT})$`);
const CWD = new RegExp(`^(bots/${SEGMENT})?$`);

export const toolRunRequestSchema = z.object({
  /** The one folder the run sees, relative to the data directory. */
  mount: z.string().regex(MOUNT),
  /** Where the command starts inside that folder. */
  cwd: z.string().regex(CWD).default(""),
  program: z.enum(TOOL_RUN_PROGRAMS),
  args: z.array(z.string().max(200_000)).max(200),
  /** Whose turn waits in line, so one person's burst cannot hold every runner. */
  owner: z.string().min(1).max(200),
  timeoutMs: z.number().int().positive().optional(),
  /** Run on this server's copy in tool-cache, which the caller keeps in step from its own disk. */
  synced: z.boolean().optional(),
});
export type ToolRunRequest = z.infer<typeof toolRunRequestSchema>;

/** Copies of folders from the server that holds them, when the runners live on another server. */
export const TOOL_CACHE = "tool-cache";

const filePath = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !value.includes("\0") &&
      value
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".." && part.length <= 255),
  );

export const toolRunFileSchema = z.object({ mount: z.string().regex(MOUNT), path: filePath });
export const toolRunFileListSchema = z.object({
  mount: z.string().regex(MOUNT),
  under: z.string().regex(CWD).default(""),
});
export const toolRunFileDeleteSchema = z.object({
  mount: z.string().regex(MOUNT),
  paths: z.array(filePath).max(20_000),
});

/** The folder a run mounts, relative to the data directory. */
export function toolRunLocalMount(request: { mount: string; synced?: boolean }) {
  return request.synced ? `${TOOL_CACHE}/${request.mount}` : request.mount;
}

function envOrDefault(name: string, fallback: string) {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === "" ? fallback : raw;
}

function positiveInteger(name: string, fallback: string) {
  const value = Number(envOrDefault(name, fallback));
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function toolRunSlots() {
  return positiveInteger("RAKAZO_TOOL_RUNNER_SLOTS", "2");
}

/** Videos hold a browser and an encoder for minutes, so fewer of them run at once. */
export function toolRunVideoSlots() {
  return positiveInteger("RAKAZO_TOOL_RUNNER_VIDEO_SLOTS", "2");
}

export function toolRunLimits(program: ToolRunRequest["program"] = "word") {
  const video = program === "video";
  const memoryName = video ? "RAKAZO_TOOL_RUNNER_VIDEO_MEMORY" : "RAKAZO_TOOL_RUNNER_MEMORY";
  const cpusName = video ? "RAKAZO_TOOL_RUNNER_VIDEO_CPUS" : "RAKAZO_TOOL_RUNNER_CPUS";
  const memory = parseMemoryBytes(memoryName, envOrDefault(memoryName, video ? "6g" : "4g"));
  return {
    Memory: memory,
    MemorySwap: memory,
    NanoCpus: parseNanoCpus(cpusName, envOrDefault(cpusName, "2")),
    // Half the default weight: when the CPUs are busy, the app and its database answer first and a
    // burst of documents takes a little longer instead.
    CpuShares: 512,
    PidsLimit: parsePidsLimit(
      "RAKAZO_TOOL_RUNNER_PIDS_LIMIT",
      envOrDefault("RAKAZO_TOOL_RUNNER_PIDS_LIMIT", "512"),
    ),
  };
}

/**
 * A fixed number of runners shared fairly: waiting people take turns, one command each,
 * in the order they first queued.
 */
export class FairSlots {
  private running = 0;
  private readonly waiting = new Map<string, Array<() => void>>();

  constructor(readonly slots: number) {}

  stats() {
    let queued = 0;
    for (const list of this.waiting.values()) queued += list.length;
    return { slots: this.slots, running: this.running, queued };
  }

  /** Resolves with a release once a runner is free; `onQueued` hears how many wait ahead. */
  acquire(owner: string, signal?: AbortSignal, onQueued?: (ahead: number) => void) {
    if (signal?.aborted) return Promise.reject(new Error("cancelled"));
    if (this.running < this.slots && this.waiting.size === 0) {
      this.running += 1;
      return Promise.resolve(this.releaser());
    }
    onQueued?.(this.stats().queued);
    return new Promise<() => void>((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener("abort", cancel);
        resolve(this.releaser());
      };
      const cancel = () => {
        const list = this.waiting.get(owner);
        const index = list?.indexOf(grant) ?? -1;
        if (list && index >= 0) {
          list.splice(index, 1);
          if (list.length === 0) this.waiting.delete(owner);
        }
        reject(new Error("cancelled"));
      };
      const list = this.waiting.get(owner) ?? [];
      list.push(grant);
      this.waiting.set(owner, list);
      signal?.addEventListener("abort", cancel, { once: true });
    });
  }

  private releaser() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.running -= 1;
      this.next();
    };
  }

  private next() {
    while (this.running < this.slots && this.waiting.size > 0) {
      const [owner, list] = this.waiting.entries().next().value as [string, Array<() => void>];
      const grant = list.shift()!;
      // Re-adding moves this person behind everyone else still waiting.
      this.waiting.delete(owner);
      if (list.length > 0) this.waiting.set(owner, list);
      this.running += 1;
      grant();
    }
  }
}

/**
 * Checks every folder from the data directory down to the mount is a real directory, never a
 * link, since Docker follows links in a bind source. Conversation folders are made here.
 */
export async function prepareToolRunMount(
  dataDir: string,
  mount: string,
  owner: { uid: number; gid: number } | undefined,
) {
  const create = mount.startsWith("tool-work/") || mount.startsWith(`${TOOL_CACHE}/`);
  const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  let current = path.resolve(dataDir);
  for (const segment of mount.split("/")) {
    current = path.join(current, segment);
    if (create) {
      const made = await mkdir(current, { mode: 0o750 }).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "EEXIST") return false;
          throw error;
        },
      );
      if (made && owner) await chown(current, owner.uid, owner.gid);
    }
    const handle = await open(current, flags).catch(() => {
      throw new Error("tool run folder is not a plain folder");
    });
    await handle.close();
  }
  return current;
}

type FolderOwner = { uid: number; gid: number } | undefined;
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

/**
 * Opens `relative` under a cache root one real folder at a time and keeps each open. On Linux
 * later steps go through the open handle, so a run that swaps a folder for a link cannot send
 * the supervisor's reads or writes anywhere else.
 */
async function pinnedCacheFolder(
  root: string,
  relative: string,
  create: { owner: FolderOwner } | undefined,
) {
  const handles: FileHandle[] = [];
  const close = () => Promise.all(handles.map((handle) => handle.close().catch(() => undefined)));
  const through = (handle: FileHandle, fallback: string) =>
    process.platform === "linux" ? `/proc/self/fd/${handle.fd}` : fallback;
  try {
    let plain = root;
    let current = await open(root, DIRECTORY_FLAGS);
    handles.push(current);
    for (const segment of relative.split("/").filter(Boolean)) {
      const next = path.join(through(current, plain), segment);
      if (create) {
        const made = await mkdir(next, { mode: 0o750 }).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code === "EEXIST") return false;
            throw error;
          },
        );
        if (made && create.owner) await chown(next, create.owner.uid, create.owner.gid);
      }
      current = await open(next, DIRECTORY_FLAGS);
      handles.push(current);
      plain = path.join(plain, segment);
    }
    return { path: through(current, plain), close };
  } catch (error) {
    await close();
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !create) return undefined;
    throw new Error("tool run folder is not a plain folder");
  }
}

function splitFilePath(relative: string) {
  const parts = relative.split("/");
  return { dir: parts.slice(0, -1).join("/"), name: parts.at(-1)! };
}

export interface ToolCacheEntry {
  path: string;
  size: number;
  mtimeMs: number;
}

/** Every plain file under `under`, skipping links, with what the caller compares to its copy. */
export async function listToolCacheFiles(root: string, under: string, maxEntries = 20_000) {
  const top = await pinnedCacheFolder(root, under, undefined);
  if (!top) return [];
  const files: ToolCacheEntry[] = [];
  const walk = async (dir: string, relative: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (files.length >= maxEntries) throw new Error("too many files to copy");
      const child = path.join(dir, entry.name);
      const info = await lstat(child).catch(() => undefined);
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (!info || info.isSymbolicLink()) continue;
      if (info.isFile()) {
        files.push({ path: childRelative, size: info.size, mtimeMs: Math.round(info.mtimeMs) });
      } else if (info.isDirectory()) {
        const handle = await open(child, DIRECTORY_FLAGS).catch(() => undefined);
        if (!handle) continue;
        try {
          await walk(
            process.platform === "linux" ? `/proc/self/fd/${handle.fd}` : child,
            childRelative,
          );
        } finally {
          await handle.close();
        }
      }
    }
  };
  try {
    await walk(top.path, under);
  } finally {
    await top.close();
  }
  return files;
}

/** Writes one copied file through a temporary name, then gives it the sender's change time. */
export async function writeToolCacheFile(input: {
  root: string;
  relative: string;
  body: AsyncIterable<Uint8Array>;
  mtimeMs: number;
  owner: FolderOwner;
  maxBytes: number;
}) {
  const { dir, name } = splitFilePath(input.relative);
  const folder = await pinnedCacheFolder(input.root, dir, { owner: input.owner });
  if (!folder) throw new Error("tool run folder is not a plain folder");
  const temporary = path.join(folder.path, `.${name}.${randomUUID().slice(0, 8)}.upload`);
  try {
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o644,
    );
    let written = 0;
    try {
      for await (const chunk of input.body) {
        written += chunk.byteLength;
        if (written > input.maxBytes) throw new Error(`file exceeds ${input.maxBytes} bytes`);
        await handle.write(chunk);
      }
      if (input.owner) await handle.chown(input.owner.uid, input.owner.gid);
      const when = new Date(input.mtimeMs);
      await handle.utimes(when, when);
    } finally {
      await handle.close();
    }
    await rename(temporary, path.join(folder.path, name));
    return written;
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await folder.close();
  }
}

/** An open copied file to stream back, or undefined when there is no such plain file. */
export async function openToolCacheFile(root: string, relative: string) {
  const { dir, name } = splitFilePath(relative);
  const folder = await pinnedCacheFolder(root, dir, undefined);
  if (!folder) return undefined;
  try {
    const handle = await open(
      path.join(folder.path, name),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    ).catch(() => undefined);
    if (!handle) return undefined;
    const info = await handle.stat();
    if (!info.isFile()) {
      await handle.close();
      return undefined;
    }
    return { handle, size: info.size, mtimeMs: Math.round(info.mtimeMs) };
  } finally {
    await folder.close();
  }
}

/** Removes copied files the caller no longer has; folders and links are left alone. */
export async function deleteToolCacheFiles(root: string, relatives: readonly string[]) {
  let removed = 0;
  for (const relative of relatives) {
    const { dir, name } = splitFilePath(relative);
    const folder = await pinnedCacheFolder(root, dir, undefined).catch(() => undefined);
    if (!folder) continue;
    try {
      const target = path.join(folder.path, name);
      const info = await lstat(target).catch(() => undefined);
      if (info?.isFile()) {
        await unlink(target);
        removed += 1;
      }
    } finally {
      await folder.close();
    }
  }
  return removed;
}

/** Days a copied folder stays after its last use; the server that sent it keeps the original. */
export function toolCacheDays() {
  const value = Number(envOrDefault("RAKAZO_TOOL_CACHE_DAYS", "7"));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("RAKAZO_TOOL_CACHE_DAYS must be a positive number");
  }
  return value;
}

/** Deletes copied folders not used within `maxIdleMs`. */
export async function sweepToolCache(dataDir: string, maxIdleMs: number, now = Date.now()) {
  let removed = 0;
  for (const parent of [`${TOOL_CACHE}/homes`, `${TOOL_CACHE}/tool-work/conversations`]) {
    const folder = path.join(dataDir, parent);
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const target = path.join(folder, entry.name);
      const info = await lstat(target).catch(() => undefined);
      if (!info || now - info.mtimeMs <= maxIdleMs) continue;
      await rm(target, { recursive: true, force: true });
      removed += 1;
    }
  }
  return removed;
}

export interface ToolRunContainerInput {
  name: string;
  image: string;
  user: string;
  request: ToolRunRequest;
  storage: { homePath: string; homeVolume?: { name: string; subpath: string } };
  networkMode?: string;
  dns?: string[];
}

export function toolRunContainerOptions(input: ToolRunContainerInput) {
  const workDir = path.posix.join("/work", input.request.cwd);
  const { homeVolume } = input.storage;
  return {
    Image: input.image,
    name: input.name,
    User: input.user,
    Entrypoint: [`/usr/local/bin/ocsc-${input.request.program}`],
    Cmd: input.request.args,
    Tty: false,
    AttachStdout: true,
    AttachStderr: true,
    Env: [
      "HOME=/tmp",
      `WORKSPACE_DIR=${workDir}`,
      // No screen to show files on; the document tools skip their preview.
      "OCSC_SCREEN_OPEN=none",
      "LD_PRELOAD=",
      "LANG=C.UTF-8",
      "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      "OCSC_VIDEO_INLINE=1",
    ],
    WorkingDir: workDir,
    Labels: { [TOOL_RUN_LABEL]: "true" },
    HostConfig: {
      ...(homeVolume
        ? {
            Mounts: [
              {
                Type: "volume" as const,
                Source: homeVolume.name,
                Target: "/work",
                // Docker makes Labels and DriverConfig optional; dockerode's types do not.
                VolumeOptions: {
                  NoCopy: true,
                  Subpath: homeVolume.subpath,
                } as Docker.MountSettings["VolumeOptions"],
              },
            ],
          }
        : { Binds: [`${input.storage.homePath}:/work`] }),
      ReadonlyRootfs: true,
      Tmpfs: {
        "/tmp": "rw,nosuid,nodev,size=2g,mode=1777",
        // Custom video scenes are bundled beside the engine, which is otherwise read-only.
        ...(input.request.program === "video"
          ? {
              "/opt/ocsc-video/.work": "rw,nosuid,nodev,size=1g,mode=1777",
              "/opt/ocsc-video/node_modules/.cache": "rw,nosuid,nodev,size=512m,mode=1777",
            }
          : {}),
      },
      ShmSize: 512 * 1024 * 1024,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      ...toolRunLimits(input.request.program),
      NetworkMode: input.networkMode ?? "bridge",
      ...(input.dns ? { Dns: input.dns } : {}),
      AutoRemove: false,
    },
  };
}
