import type { InfraLane, InfraSample, InfraServer } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";
import { Agent, request as httpRequest } from "undici";
import type { IncusSandboxOptions } from "./incus-sandbox.js";
import { incusTlsOptions } from "./incus-sandbox.js";

/** Readings older than this are deleted; the dashboards show at most 30 days. */
export const INFRA_SAMPLE_RETENTION_DAYS = 90;
export const INFRA_SAMPLE_INTERVAL_MS = 60_000;
const READ_TIMEOUT_MS = 5_000;
const ROUTINE_TRIGGERS = ["routine", "webhook"];

export interface InfraSamplerOptions {
  prisma: PrismaClient;
  runners: { app?: string; tools?: string; routines?: string; token?: string };
  incus?: Pick<IncusSandboxOptions, "url" | "clientCert" | "clientKey" | "serverCert" | "project">;
  fetch?: typeof fetch;
}

type RunnerStatus = {
  slots?: number;
  running?: number;
  queued?: number;
  started?: number;
  video?: { slots?: number; running?: number; queued?: number; started?: number };
  large?: { slots?: number; running?: number; queued?: number; started?: number };
  host?: {
    load1?: number;
    cpus?: number;
    cpuBusyPercent?: number | null;
    memAvailableBytes?: number | null;
    memTotalBytes?: number | null;
    disk?: { totalBytes: number; freeBytes: number } | null;
  };
};

const DOWN: InfraServer = {
  up: false,
  cpuPercent: null,
  load1: null,
  cpus: null,
  memUsedBytes: null,
  memTotalBytes: null,
  diskUsedBytes: null,
  diskTotalBytes: null,
};

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function lane(stats: RunnerStatus["large"]): InfraLane {
  return {
    slots: count(stats?.slots),
    running: count(stats?.running),
    queued: count(stats?.queued),
    started: number(stats?.started),
  };
}

/** A server as its runner reports it; runners older than the full host report leave gaps. */
export function serverFromStatus(status: RunnerStatus | null): InfraServer {
  if (!status) return DOWN;
  const host = status.host;
  const total = number(host?.memTotalBytes);
  const available = number(host?.memAvailableBytes);
  const disk = host?.disk;
  return {
    up: true,
    cpuPercent: number(host?.cpuBusyPercent),
    load1: number(host?.load1),
    cpus: number(host?.cpus),
    memUsedBytes: total !== null && available !== null ? Math.max(0, total - available) : null,
    memTotalBytes: total,
    diskUsedBytes: disk ? Math.max(0, disk.totalBytes - disk.freeBytes) : null,
    diskTotalBytes: disk ? disk.totalBytes : null,
  };
}

async function runnerStatus(
  fetcher: typeof fetch,
  url: string | undefined,
  token: string | undefined,
): Promise<RunnerStatus | null> {
  if (!url || !token) return null;
  try {
    const response = await fetcher(new URL("/tool-runs/status", url), {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as RunnerStatus;
  } catch {
    return null;
  }
}

let incusAgent: { key: string; agent: Agent } | undefined;

async function incusGet(options: NonNullable<InfraSamplerOptions["incus"]>, path: string) {
  const key = `${options.url}\n${options.clientCert}`;
  if (incusAgent?.key !== key) {
    incusAgent = { key, agent: new Agent({ connect: incusTlsOptions(options) }) };
  }
  const response = await httpRequest(new URL(path, options.url), {
    dispatcher: incusAgent.agent,
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  });
  const body = (await response.body.json()) as { metadata?: unknown };
  if (response.statusCode >= 400) throw new Error(`Incus returned HTTP ${response.statusCode}`);
  return body.metadata;
}

type HostResources = {
  cpu?: { total?: number };
  memory?: { used?: number; total?: number };
};

/** Online member names from `/1.0/cluster/members`. Null when this Incus is not a cluster. */
export function clusterMemberNames(metadata: unknown): string[] | null {
  if (!Array.isArray(metadata) || metadata.length === 0) return null;
  const names: string[] = [];
  for (const entry of metadata) {
    if (typeof entry === "string") {
      const name = entry.split("/").filter(Boolean).pop();
      if (name) names.push(name);
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { server_name?: unknown; status?: unknown };
    if (typeof record.server_name !== "string" || !record.server_name) continue;
    if (typeof record.status === "string" && record.status !== "Online") continue;
    names.push(record.server_name);
  }
  return names.length > 0 ? names : null;
}

/** Adds one cluster member into the computer-host reading. A missing figure stays missing. */
export function accumulateMember(
  total: InfraSample["incus"],
  member: {
    cpus: number | null;
    memUsedBytes: number | null;
    memTotalBytes: number | null;
    diskUsedBytes: number | null;
    diskTotalBytes: number | null;
  },
) {
  total.up = true;
  total.members = (total.members ?? 0) + 1;
  if (member.cpus !== null) total.cpus = (total.cpus ?? 0) + member.cpus;
  if (member.memUsedBytes !== null) {
    total.memUsedBytes = (total.memUsedBytes ?? 0) + member.memUsedBytes;
  }
  if (member.memTotalBytes !== null) {
    total.memTotalBytes = (total.memTotalBytes ?? 0) + member.memTotalBytes;
  }
  if (member.diskUsedBytes !== null) {
    total.diskUsedBytes = (total.diskUsedBytes ?? 0) + member.diskUsedBytes;
  }
  if (member.diskTotalBytes !== null) {
    total.diskTotalBytes = (total.diskTotalBytes ?? 0) + member.diskTotalBytes;
  }
}

async function incusReading(options: InfraSamplerOptions["incus"]): Promise<InfraSample["incus"]> {
  const down = {
    up: false,
    members: 0,
    cpus: null,
    memUsedBytes: null,
    memTotalBytes: null,
    diskUsedBytes: null,
    diskTotalBytes: null,
    running: null,
    stopped: null,
  };
  if (!options?.url) return down;
  try {
    const project = encodeURIComponent(options.project || "default");
    const [members, instances, pools] = await Promise.all([
      incusGet(options, "/1.0/cluster/members?recursion=1").catch(() => null),
      incusGet(options, `/1.0/instances?recursion=1&project=${project}`) as Promise<
        Array<{ status?: string }>
      >,
      incusGet(options, "/1.0/storage-pools") as Promise<string[]>,
    ]);
    const names = clusterMemberNames(members);
    const targets = names ?? [null];
    const poolNames = (pools ?? [])
      .map((pool) => (typeof pool === "string" ? pool.split("/").pop() : ""))
      .filter((name): name is string => Boolean(name));
    const parts = await Promise.all(
      targets.map(async (target) => {
        const query = target ? `?target=${encodeURIComponent(target)}` : "";
        try {
          const resources = (await incusGet(options, `/1.0/resources${query}`)) as HostResources;
          let diskUsed: number | null = null;
          let diskTotal: number | null = null;
          for (const name of poolNames) {
            const space = (
              (await incusGet(
                options,
                `/1.0/storage-pools/${encodeURIComponent(name)}/resources${query}`,
              )) as { space?: { used?: number; total?: number } }
            )?.space;
            if (number(space?.total) === null) continue;
            diskUsed = (diskUsed ?? 0) + count(space?.used);
            diskTotal = (diskTotal ?? 0) + count(space?.total);
          }
          return {
            cpus: number(resources?.cpu?.total),
            memUsedBytes: number(resources?.memory?.used),
            memTotalBytes: number(resources?.memory?.total),
            diskUsedBytes: diskUsed,
            diskTotalBytes: diskTotal,
          };
        } catch {
          return null;
        }
      }),
    );
    // A missing member would make the cluster look smaller than it is.
    if (parts.some((part) => part === null)) return down;
    const total: InfraSample["incus"] = { ...down, running: null, stopped: null };
    for (const part of parts) {
      if (part) accumulateMember(total, part);
    }
    if (!total.up) return down;
    const list = Array.isArray(instances) ? instances : [];
    total.running = list.filter((instance) => instance.status === "Running").length;
    total.stopped = list.filter((instance) => instance.status !== "Running").length;
    return total;
  } catch {
    return down;
  }
}

async function fleetReading(prisma: PrismaClient, now: Date): Promise<InfraSample["fleet"]> {
  const [computersRunning, active, queuedRuns] = await runAsSystem("sample fleet load", () =>
    Promise.all([
      prisma.computer.count({ where: { state: "running" } }),
      prisma.run.groupBy({
        by: ["trigger"],
        where: { status: { in: ["leased", "running"] } },
        _count: true,
      }),
      prisma.run.count({
        where: { status: "queued", OR: [{ wakeAt: null }, { wakeAt: { lte: now } }] },
      }),
    ]),
  );
  let chatRuns = 0;
  let routineRuns = 0;
  for (const row of active) {
    if (ROUTINE_TRIGGERS.includes(row.trigger)) routineRuns += row._count;
    else chatRuns += row._count;
  }
  return { computersRunning, chatRuns, routineRuns, queuedRuns };
}

/** Reads every server, runner and Incus once; a part that does not answer is marked down. */
export async function takeInfraSample(
  options: InfraSamplerOptions,
  now = new Date(),
): Promise<InfraSample> {
  const fetcher = options.fetch ?? fetch;
  const { token } = options.runners;
  const [app, tools, routines, incus, fleet] = await Promise.all([
    runnerStatus(fetcher, options.runners.app, token),
    runnerStatus(fetcher, options.runners.tools, token),
    runnerStatus(fetcher, options.runners.routines, token),
    incusReading(options.incus),
    fleetReading(options.prisma, now),
  ]);
  const slots = tools ?? app;
  return {
    app: serverFromStatus(app),
    ...(tools ? { tools: serverFromStatus(tools) } : {}),
    routines: serverFromStatus(routines),
    incus,
    runners: {
      app: slots ? { tools: lane(slots), large: lane(slots.large), video: lane(slots.video) } : null,
      routines: routines ? { tools: lane(routines), large: lane(routines.large) } : null,
    },
    fleet,
  };
}

/** Takes a reading, stores it, and deletes readings past retention. */
export async function recordInfraSample(options: InfraSamplerOptions, now = new Date()) {
  const sample = await takeInfraSample(options, now);
  const cutoff = new Date(now.getTime() - INFRA_SAMPLE_RETENTION_DAYS * 86_400_000);
  await runAsSystem("store infrastructure sample", () =>
    options.prisma.infraSample.create({ data: { sampledAt: now, data: sample } }),
  );
  await runAsSystem("prune infrastructure samples", () =>
    options.prisma.infraSample.deleteMany({ where: { sampledAt: { lt: cutoff } } }),
  );
  return sample;
}
