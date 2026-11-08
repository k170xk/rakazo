import { constants } from "node:fs";
import { chown, mkdir, open } from "node:fs/promises";
import path from "node:path";
import type Docker from "dockerode";
import { z } from "zod";
import { parseMemoryBytes, parseNanoCpus, parsePidsLimit } from "./computer-spec.js";

/**
 * Tool runs: one OCSC document command in a fresh container that sees a single folder and
 * nothing else. Colleague conversations and Tools-only people work here, so their files never
 * sit where somebody's own computer, and so their shell, could reach them.
 */
export const TOOL_RUN_PROGRAMS = ["word", "pptx", "xlsx", "pdf"] as const;
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
});
export type ToolRunRequest = z.infer<typeof toolRunRequestSchema>;

function envOrDefault(name: string, fallback: string) {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === "" ? fallback : raw;
}

export function toolRunSlots() {
  const value = Number(envOrDefault("RAKAZO_TOOL_RUNNER_SLOTS", "2"));
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("RAKAZO_TOOL_RUNNER_SLOTS must be a positive integer");
  }
  return value;
}

export function toolRunLimits() {
  const memory = parseMemoryBytes(
    "RAKAZO_TOOL_RUNNER_MEMORY",
    envOrDefault("RAKAZO_TOOL_RUNNER_MEMORY", "4g"),
  );
  return {
    Memory: memory,
    MemorySwap: memory,
    NanoCpus: parseNanoCpus(
      "RAKAZO_TOOL_RUNNER_CPUS",
      envOrDefault("RAKAZO_TOOL_RUNNER_CPUS", "2"),
    ),
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
  const create = mount.startsWith("tool-work/");
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
      Tmpfs: { "/tmp": "rw,nosuid,nodev,size=2g,mode=1777" },
      ShmSize: 512 * 1024 * 1024,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      ...toolRunLimits(),
      NetworkMode: input.networkMode ?? "bridge",
      ...(input.dns ? { Dns: input.dns } : {}),
      AutoRemove: false,
    },
  };
}
