import { z } from "zod";

const bytes = z.number().nonnegative().nullable();

/** One server as its tool runner sees it; null fields could not be read. */
export const InfraServerSchema = z.object({
  up: z.boolean(),
  /** Friendly compute name (e.g. computer.ocsc.me, tools2). Absent on older samples. */
  name: z.string().optional(),
  /** Data centre label (e.g. Manchester, UK (DC18)). Absent on older samples. */
  datacenter: z.string().optional(),
  cpuPercent: z.number().nullable(),
  load1: z.number().nullable(),
  cpus: z.number().int().nullable(),
  memUsedBytes: bytes,
  memTotalBytes: bytes,
  diskUsedBytes: bytes,
  diskTotalBytes: bytes,
});
export type InfraServer = z.infer<typeof InfraServerSchema>;

/** A runner lane: commands running and waiting, and how many started since the runner began. */
export const InfraLaneSchema = z.object({
  slots: z.number().int(),
  running: z.number().int(),
  queued: z.number().int(),
  started: z.number().int().nullable(),
});
export type InfraLane = z.infer<typeof InfraLaneSchema>;

/** One dedicated tool runner server in the pool, with its own host metrics and command lanes. */
export const InfraToolRunnerNodeSchema = InfraServerSchema.extend({
  id: z.string(),
  name: z.string(),
  primary: z.boolean().optional(),
  lanes: z
    .object({
      tools: InfraLaneSchema,
      large: InfraLaneSchema,
      video: InfraLaneSchema,
    })
    .nullable(),
});
export type InfraToolRunnerNode = z.infer<typeof InfraToolRunnerNodeSchema>;

/** One member server of the Incus computer cluster. */
export const InfraIncusMemberSchema = z.object({
  name: z.string(),
  datacenter: z.string().optional(),
  up: z.boolean(),
  cpus: z.number().int().nullable(),
  memUsedBytes: bytes,
  memTotalBytes: bytes,
  diskUsedBytes: bytes,
  diskTotalBytes: bytes,
  running: z.number().int().nullable(),
  stopped: z.number().int().nullable(),
});
export type InfraIncusMember = z.infer<typeof InfraIncusMemberSchema>;

/** One reading of every server, runner and Incus, taken by the app worker each minute. */
export const InfraSampleSchema = z.object({
  app: InfraServerSchema,
  /** The document runners (aggregate when multiple), when they are on their own server(s). */
  tools: InfraServerSchema.optional(),
  /** Individual dedicated tool runner servers in the pool. Absent on older samples. */
  toolNodes: z.array(InfraToolRunnerNodeSchema).optional(),
  routines: InfraServerSchema,
  incus: z.object({
    up: z.boolean(),
    /** Online cluster members included in this reading. Absent on readings taken before clustering. */
    members: z.number().int().optional(),
    /** Per-member readings for the Incus cluster. Absent on older samples. */
    nodes: z.array(InfraIncusMemberSchema).optional(),
    cpus: z.number().int().nullable(),
    memUsedBytes: bytes,
    memTotalBytes: bytes,
    diskUsedBytes: bytes,
    diskTotalBytes: bytes,
    running: z.number().int().nullable(),
    stopped: z.number().int().nullable(),
  }),
  runners: z.object({
    /** The primary/pooled document runners: tools, large documents and video. */
    app: z
      .object({ tools: InfraLaneSchema, large: InfraLaneSchema, video: InfraLaneSchema })
      .nullable(),
    /** The routine server's runner, which also takes chats' overflow. */
    routines: z.object({ tools: InfraLaneSchema, large: InfraLaneSchema }).nullable(),
  }),
  fleet: z.object({
    computersRunning: z.number().int(),
    chatRuns: z.number().int(),
    routineRuns: z.number().int(),
    queuedRuns: z.number().int(),
  }),
});
export type InfraSample = z.infer<typeof InfraSampleSchema>;

export const INFRA_PERIODS = ["24h", "7d", "30d"] as const;
export type InfraPeriod = (typeof INFRA_PERIODS)[number];

/** The series the dashboards chart; each point is the highest reading in its bucket. */
export const INFRA_SERIES = [
  "appCpu",
  "appMemUsed",
  "appDiskUsed",
  "toolsCpu",
  "toolsMemUsed",
  "toolsDiskUsed",
  "routinesCpu",
  "routinesMemUsed",
  "routinesDiskUsed",
  "incusMemUsed",
  "incusDiskUsed",
  "incusRunning",
  "appToolsRunning",
  "appToolsQueued",
  "appLargeRunning",
  "appVideoRunning",
  "routinesToolsRunning",
  "routinesToolsQueued",
  "chatRuns",
  "routineRuns",
  "queuedRuns",
] as const;
export type InfraSeriesKey = (typeof INFRA_SERIES)[number];

export const InfrastructureSchema = z.object({
  period: z.enum(INFRA_PERIODS),
  /** The newest reading; null until the worker has taken one. */
  latest: z.object({ sampledAt: z.string(), sample: InfraSampleSchema }).nullable(),
  bucketMinutes: z.number().int(),
  points: z.array(
    z.object({
      at: z.string(),
      values: z.record(z.enum(INFRA_SERIES), z.number().nullable()),
    }),
  ),
});
export type Infrastructure = z.infer<typeof InfrastructureSchema>;
