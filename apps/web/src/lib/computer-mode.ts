import type { ComputerMode } from "@rakazo/contracts";

export function computerModeKind(mode: ComputerMode): "shared" | "own" {
  return mode === "dedicated" ? "own" : "shared";
}

export const WORKING_RUN_STATUSES = [
  "running",
  "queued",
  "leased",
  "waiting_input",
  "waiting_takeover",
] as const;

export type RosterRunTone =
  | "idle"
  | "queued"
  | "starting"
  | "working"
  | "needs_reply"
  | "needs_desktop";

export function rosterRunTone(status: string): RosterRunTone {
  switch (status) {
    case "queued":
      return "queued";
    case "leased":
      return "starting";
    case "running":
      return "working";
    case "waiting_input":
      return "needs_reply";
    case "waiting_takeover":
      return "needs_desktop";
    default:
      return "idle";
  }
}

export function isWorkingRunStatus(status: string): boolean {
  return (WORKING_RUN_STATUSES as readonly string[]).includes(status);
}

export function desktopAccessNames(
  bots: Array<{ name: string; computerMode: ComputerMode }>,
  active: { name: string; computerMode: ComputerMode },
): string[] {
  if (computerModeKind(active.computerMode) === "own") return [active.name];
  return bots
    .filter((bot) => computerModeKind(bot.computerMode) === "shared")
    .map((bot) => bot.name);
}

export function botHoldsDesktop(input: {
  botId: string;
  botName: string;
  busyBotId?: string | null;
  busyBotName?: string | null;
}): boolean {
  if (input.busyBotId) return input.busyBotId === input.botId;
  return Boolean(input.busyBotName && input.busyBotName === input.botName);
}
