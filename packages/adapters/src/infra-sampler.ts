import type {
  InfraIncusMember,
  InfraLane,
  InfraSample,
  InfraServer,
  InfraToolRunnerNode,
} from "@rakazo/contracts";
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

export interface InfraServerLabel {
  name?: string;
  datacenter?: string;
}

export type InfraServerLabels = Record<string, InfraServerLabel>;

/**
 * Parses `RAKAZO_INFRA_SERVERS`, semicolon-separated `key=Name|Datacenter` entries.
 * Keys can be `app`, `routines`, a runner host/IP (e.g. `10.77.0.5`), or an Incus member name.
 */
export function parseInfraServerLabels(raw: string | undefined): InfraServerLabels {
  const labels: InfraServerLabels = {};
  for (const part of (raw ?? "").split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    const rest = trimmed.slice(eq + 1).trim();
    if (!key || !rest) continue;
    const pipe = rest.indexOf("|");
    if (pipe >= 0) {
      const name = rest.slice(0, pipe).trim();
      const datacenter = rest.slice(pipe + 1).trim();
      labels[key] = {
        ...(name ? { name } : {}),
        ...(datacenter ? { datacenter } : {}),
      };
    } else {
      labels[key] = { name: rest };
    }
  }
  return labels;
}

function hostKeyFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function resolveLabel(
  labels: InfraServerLabels | undefined,
  ...keys: (string | null | undefined)[]
): InfraServerLabel | undefined {
  if (!labels) return undefined;
  for (const key of keys) {
    if (!key) continue;
    const found = labels[key.toLowerCase()];
    if (found) return found;
  }
  return undefined;
}

export interface InfraSamplerOptions {
  prisma: PrismaClient;
  runners: {
    app?: string;
    tools?: string | string[];
    routines?: string;
    token?: string;
  };
  incus?: Pick<IncusSandboxOptions, "url" | "clientCert" | "clientKey" | "serverCert" | "project">;
  labels?: InfraServerLabels;
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

function withLabel(server: InfraServer, label: InfraServerLabel | undefined): InfraServer {
  if (!label) return server;
  return {
    ...server,
    ...(label.name ? { name: label.name } : {}),
    ...(label.datacenter ? { datacenter: label.datacenter } : {}),
  };
}

function sumLanes(lanes: InfraLane[]): InfraLane {
  let slots = 0;
  let running = 0;
  let queued = 0;
  let started: number | null = null;
  for (const item of lanes) {
    slots += item.slots;
    running += item.running;
    queued += item.queued;
    if (item.started !== null) started = (started ?? 0) + item.started;
  }
  return { slots, running, queued, started };
}

function aggregateToolServers(nodes: InfraToolRunnerNode[]): InfraServer {
  const online = nodes.filter((node) => node.up);
  if (online.length === 0) return DOWN;
  let cpuSum = 0;
  let cpuCount = 0;
  let loadSum = 0;
  let loadCount = 0;
  let cpus: number | null = null;
  let memUsed: number | null = null;
  let memTotal: number | null = null;
  let diskUsed: number | null = null;
  let diskTotal: number | null = null;
  for (const node of online) {
    if (node.cpuPercent !== null) {
      cpuSum += node.cpuPercent;
      cpuCount += 1;
    }
    if (node.load1 !== null) {
      loadSum += node.load1;
      loadCount += 1;
    }
    if (node.cpus !== null) cpus = (cpus ?? 0) + node.cpus;
    if (node.memUsedBytes !== null) memUsed = (memUsed ?? 0) + node.memUsedBytes;
    if (node.memTotalBytes !== null) memTotal = (memTotal ?? 0) + node.memTotalBytes;
    if (node.diskUsedBytes !== null) diskUsed = (diskUsed ?? 0) + node.diskUsedBytes;
    if (node.diskTotalBytes !== null) diskTotal = (diskTotal ?? 0) + node.diskTotalBytes;
  }
  const datacenters = [...new Set(nodes.map((node) => node.datacenter).filter(Boolean))] as string[];
  return {
    up: true,
    ...(nodes.length === 1 && nodes[0]?.name ? { name: nodes[0].name } : {}),
    ...(datacenters.length > 0 ? { datacenter: datacenters.join(" · ") } : {}),
    cpuPercent: cpuCount > 0 ? cpuSum / cpuCount : null,
    load1: loadCount > 0 ? loadSum : null,
    cpus,
    memUsedBytes: memUsed,
    memTotalBytes: memTotal,
    diskUsedBytes: diskUsed,
    diskTotalBytes: diskTotal,
  };
}

type ClusterMemberMeta = {
  name: string;
  online: boolean;
  description?: string;
};

function clusterMemberMeta(metadata: unknown): ClusterMemberMeta[] | null {
  if (!Array.isArray(metadata) || metadata.length === 0) return null;
  const members: ClusterMemberMeta[] = [];
  for (const entry of metadata) {
    if (typeof entry === "string") {
      const name = entry.split("/").filter(Boolean).pop();
      if (name) members.push({ name, online: true });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { server_name?: unknown; status?: unknown; description?: unknown };
    if (typeof record.server_name !== "string" || !record.server_name) continue;
    const description =
      typeof record.description === "string" && record.description.trim()
        ? record.description.trim()
        : undefined;
    members.push({
      name: record.server_name,
      online: typeof record.status !== "string" || record.status === "Online",
      ...(description ? { description } : {}),
    });
  }
  return members.length > 0 ? members : null;
}

async function incusReading(
  options: InfraSamplerOptions["incus"],
  labels?: InfraServerLabels,
): Promise<InfraSample["incus"]> {
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
    const [membersRaw, instances, pools] = await Promise.all([
      incusGet(options, "/1.0/cluster/members?recursion=1").catch(() => null),
      incusGet(options, `/1.0/instances?recursion=1&project=${project}`) as Promise<
        Array<{ status?: string; location?: string }>
      >,
      incusGet(options, "/1.0/storage-pools") as Promise<string[]>,
    ]);
    const list = Array.isArray(instances) ? instances : [];
    const meta = clusterMemberMeta(membersRaw);
    const poolNames = (pools ?? [])
      .map((pool) => (typeof pool === "string" ? pool.split("/").pop() : ""))
      .filter((name): name is string => Boolean(name));

    const targets: Array<{ name: string | null; online: boolean; description?: string }> = meta
      ? meta
      : [{ name: null, online: true }];

    const parts = await Promise.all(
      targets.map(async (target) => {
        const label = resolveLabel(labels, target.name, "incus");
        const memberName = label?.name || target.name || "incus";
        const datacenter = label?.datacenter || target.description;
        const memberInstances = target.name
          ? list.filter((instance) => instance.location === target.name)
          : list;
        const running = memberInstances.filter((instance) => instance.status === "Running").length;
        const stopped = memberInstances.filter((instance) => instance.status !== "Running").length;

        if (!target.online) {
          return {
            ok: false as const,
            node: {
              name: memberName,
              ...(datacenter ? { datacenter } : {}),
              up: false,
              cpus: null,
              memUsedBytes: null,
              memTotalBytes: null,
              diskUsedBytes: null,
              diskTotalBytes: null,
              running,
              stopped,
            } satisfies InfraIncusMember,
          };
        }

        const query = target.name ? `?target=${encodeURIComponent(target.name)}` : "";
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
          const metrics = {
            cpus: number(resources?.cpu?.total),
            memUsedBytes: number(resources?.memory?.used),
            memTotalBytes: number(resources?.memory?.total),
            diskUsedBytes: diskUsed,
            diskTotalBytes: diskTotal,
          };
          return {
            ok: true as const,
            metrics,
            node: {
              name: memberName,
              ...(datacenter ? { datacenter } : {}),
              up: true,
              ...metrics,
              running,
              stopped,
            } satisfies InfraIncusMember,
          };
        } catch {
          return {
            ok: false as const,
            node: {
              name: memberName,
              ...(datacenter ? { datacenter } : {}),
              up: false,
              cpus: null,
              memUsedBytes: null,
              memTotalBytes: null,
              diskUsedBytes: null,
              diskTotalBytes: null,
              running,
              stopped,
            } satisfies InfraIncusMember,
          };
        }
      }),
    );

    const total: InfraSample["incus"] = { ...down, running: null, stopped: null };
    for (const part of parts) {
      if (part.ok) accumulateMember(total, part.metrics);
    }
    if (!total.up) return down;
    total.running = list.filter((instance) => instance.status === "Running").length;
    total.stopped = list.filter((instance) => instance.status !== "Running").length;
    if (meta) {
      total.nodes = parts.map((part) => part.node);
    }
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
  const toolUrls = Array.isArray(options.runners.tools)
    ? options.runners.tools.filter(Boolean)
    : options.runners.tools
      ? [options.runners.tools]
      : [];

  const [app, toolStatuses, routines, incus, fleet] = await Promise.all([
    runnerStatus(fetcher, options.runners.app, token),
    Promise.all(toolUrls.map((url) => runnerStatus(fetcher, url, token))),
    runnerStatus(fetcher, options.runners.routines, token),
    incusReading(options.incus, options.labels),
    fleetReading(options.prisma, now),
  ]);

  const appLabel = resolveLabel(options.labels, "app", hostKeyFromUrl(options.runners.app));
  const routinesLabel = resolveLabel(
    options.labels,
    hostKeyFromUrl(options.runners.routines),
    "routines",
  );

  const toolNodes: InfraToolRunnerNode[] = toolUrls.map((url, index) => {
    const status = toolStatuses[index] ?? null;
    const host = hostKeyFromUrl(url) ?? `tools-${index + 1}`;
    const label = resolveLabel(options.labels, host, url, index === 0 ? "tools" : undefined);
    const base = serverFromStatus(status);
    return {
      ...base,
      id: host,
      name: label?.name || host,
      ...(label?.datacenter ? { datacenter: label.datacenter } : {}),
      primary: index === 0,
      lanes: status
        ? { tools: lane(status), large: lane(status.large), video: lane(status.video) }
        : null,
    };
  });

  const onlineToolLanes = toolNodes
    .map((node) => node.lanes)
    .filter((entry): entry is NonNullable<InfraToolRunnerNode["lanes"]> => entry !== null);

  const aggregatedAppLanes =
    onlineToolLanes.length > 0
      ? {
          tools: sumLanes(onlineToolLanes.map((entry) => entry.tools)),
          large: sumLanes(onlineToolLanes.map((entry) => entry.large)),
          video: sumLanes(onlineToolLanes.map((entry) => entry.video)),
        }
      : app
        ? { tools: lane(app), large: lane(app.large), video: lane(app.video) }
        : null;

  return {
    app: withLabel(serverFromStatus(app), appLabel),
    ...(toolNodes.length > 0 ? { tools: aggregateToolServers(toolNodes), toolNodes } : {}),
    routines: withLabel(serverFromStatus(routines), routinesLabel),
    incus,
    runners: {
      app: aggregatedAppLanes,
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
