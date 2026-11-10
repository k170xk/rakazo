import type { ComputerAccess } from "@rakazo/contracts";
import type { Prisma } from "@rakazo/db";

/**
 * Which runs a process executes. "routines" takes only routine work (schedules, change checks,
 * test runs and webhooks), so it can run on its own server apart from chat and computers;
 * "chat" takes everything else; "all", the default, takes both.
 */
export type RunPool = "all" | "chat" | "routines";

/** Triggers whose runs belong to the routines pool. */
export const ROUTINE_POOL_TRIGGERS: readonly string[] = ["routine", "webhook"];

const RUN_READY_TOPIC = "runs:ready";
const ROUTINE_RUN_READY_TOPIC = "runs:ready:routines";

export function runPoolFromEnv(env: NodeJS.ProcessEnv): RunPool {
  const value = env.RAKAZO_RUN_POOL?.trim() || "all";
  if (value === "all" || value === "chat" || value === "routines") return value;
  throw new Error(`RAKAZO_RUN_POOL must be all, chat or routines, not ${value}`);
}

export function runPoolOf(trigger: string): Exclude<RunPool, "all"> {
  return ROUTINE_POOL_TRIGGERS.includes(trigger) ? "routines" : "chat";
}

export function runInPool(trigger: string, pool: RunPool): boolean {
  return pool === "all" || runPoolOf(trigger) === pool;
}

/** The rows a process in this pool may claim. */
export function runPoolWhere(pool: RunPool): Prisma.RunWhereInput {
  if (pool === "all") return {};
  return pool === "routines"
    ? { trigger: { in: [...ROUTINE_POOL_TRIGGERS] } }
    : { trigger: { notIn: [...ROUTINE_POOL_TRIGGERS] } };
}

/** Where a run is announced when it needs another process; "all" listens on both. */
export function runReadyTopic(pool: RunPool): string {
  return pool === "routines" ? ROUTINE_RUN_READY_TOPIC : RUN_READY_TOPIC;
}

export function runReadyTopics(pool: RunPool): string[] {
  return pool === "all" ? [RUN_READY_TOPIC, ROUTINE_RUN_READY_TOPIC] : [runReadyTopic(pool)];
}

/**
 * The routines pool runs apart from every computer, so its runs get at most the document
 * commands and the bot's files, never a shell, screen or browser.
 */
export function poolComputerAccess(access: ComputerAccess, pool: RunPool): ComputerAccess {
  return pool === "routines" && access === "full" ? "tools" : access;
}
