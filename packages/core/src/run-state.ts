import type { RunStatus } from "@rakazo/contracts";

export const ACTIVE_RUN_STATUSES = [
  "queued",
  "leased",
  "running",
  "waiting_input",
  "waiting_takeover",
] as const satisfies readonly RunStatus[];
const TERMINAL: RunStatus[] = ["completed", "failed", "cancelled"];

const allowed: Record<RunStatus, RunStatus[]> = {
  queued: ["leased", "cancelled"],
  leased: ["running", "queued", "cancelled"],
  running: ["waiting_input", "waiting_takeover", "completed", "failed", "cancelled", "leased"],
  waiting_input: ["queued", "leased", "cancelled"],
  waiting_takeover: ["queued", "leased", "cancelled"],
  completed: [],
  failed: ["queued"],
  cancelled: [],
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return allowed[from]?.includes(to) ?? false;
}

export function assertTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal run transition ${from} -> ${to}`);
  }
}

export function isActive(status: RunStatus): boolean {
  return (ACTIVE_RUN_STATUSES as readonly RunStatus[]).includes(status);
}

/** Roster status when several runs are live: show work, not a newer wait. */
const ROSTER_RUN_RANK: Record<string, number> = {
  running: 0,
  waiting_input: 1,
  waiting_takeover: 1,
  leased: 2,
  queued: 3,
};

export function preferredActiveRunStatus(statuses: readonly string[]): string {
  if (statuses.length === 0) return "idle";
  return [...statuses].sort(
    (left, right) => (ROSTER_RUN_RANK[left] ?? 9) - (ROSTER_RUN_RANK[right] ?? 9),
  )[0]!;
}

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL.includes(status);
}

export function nextFence(current: number): number {
  return current + 1;
}

/** What a composer send should do when this bot already has a live user turn. */
export type LiveSendDisposition = "new-run" | "redirect" | "resume";

export function liveSendDisposition(status: string | undefined): LiveSendDisposition {
  if (status === "running" || status === "leased" || status === "waiting_takeover") {
    return "redirect";
  }
  if (status === "waiting_input") return "resume";
  return "new-run";
}

/** After this much silence on a streamed reply, a follow-up is a new turn. */
export const LIVE_TURN_IDLE_AFTER_MS = 8_000;

export function lastEventMeansPendingWork(
  last: { type: string; createdAt: Date } | null | undefined,
  now = new Date(),
): boolean {
  if (!last) return true;
  if (last.type === "agent.tool.called" || last.type === "thread.subagent") return true;
  const age = now.getTime() - last.createdAt.getTime();
  if (age < LIVE_TURN_IDLE_AFTER_MS) return true;
  return false;
}
