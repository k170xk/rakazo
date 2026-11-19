import { formatCron, isOneShotRoutineCrons } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import type { FleetCardSummary } from "./approval-ask.js";
import {
  compactScheduleInput,
  isScheduleValueProvided,
  resolveScheduleTiming,
  userTimeZone,
  watchFromTool,
} from "./schedule-tools.js";

export const ROUTINE_CARD_TOOLS = new Set([
  "schedule_create",
  "schedule_update",
  "schedule_cancel",
]);

/** The routine's own instructions, cut short where they only remind the person which one it is. */
const PURPOSE_LENGTH = 300;

type RoutineScope = { spaceId: string; botId: string; userId: string; threadId?: string };

type RoutineRow = {
  name: string;
  prompt: string;
  crons: string[];
  timezone: string;
  active: boolean;
  nextRunAt: Date | null;
  watch: unknown;
};

/**
 * A routine approval card in plain words: which routine, what it does, when it runs and what the
 * change does to it. Undefined when the routine cannot be found, so the generic card shows instead.
 */
export async function routineCardSummary(
  prisma: PrismaClient,
  scope: RoutineScope,
  toolName: string,
  args: Record<string, unknown>,
): Promise<FleetCardSummary | undefined> {
  if (toolName === "schedule_create") return createCard(prisma, scope.userId, args);
  const routineId = typeof args.routineId === "string" ? args.routineId.trim() : "";
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!routineId && !(toolName === "schedule_cancel" && name)) return undefined;
  const routine = await prisma.routine.findFirst({
    where: { ...scope, ...(routineId ? { id: routineId } : { name }) },
    select: {
      name: true,
      prompt: true,
      crons: true,
      timezone: true,
      active: true,
      nextRunAt: true,
      watch: true,
    },
  });
  if (!routine) return undefined;
  return toolName === "schedule_cancel" ? cancelCard(routine) : updateCard(routine, args);
}

async function createCard(
  prisma: PrismaClient,
  userId: string,
  args: Record<string, unknown>,
): Promise<FleetCardSummary> {
  const name = String(args.name ?? "").trim() || "Untitled";
  const timezone = isScheduleValueProvided(args.timezone)
    ? String(args.timezone)
    : await userTimeZone(prisma, userId);
  const watch = watchFromTool(args.watch);
  return {
    withReason: true,
    title: `Create the routine “${name}”?`,
    lines: [
      watch ? watchLine(watch) : `When: ${newTiming(args, timezone)}`,
      "It runs on its own at these times, without you starting it, and posts what it does in this chat.",
      "",
      "What it will do each time:",
      String(args.prompt ?? "").trim(),
    ],
  };
}

function updateCard(routine: RoutineRow, args: Record<string, unknown>): FleetCardSummary {
  const changes: string[] = [];
  const pausing = args.active === false && routine.active;
  const resuming = args.active === true && !routine.active;
  if (pausing)
    changes.push(
      "Pause it: it stops running until someone resumes it. Nothing is deleted, and it can be resumed at any time from Routines.",
    );
  if (resuming) changes.push("Resume it: it starts running on its schedule again.");
  if (isScheduleValueProvided(args.name) && String(args.name).trim() !== routine.name)
    changes.push(`Rename it to “${String(args.name).trim()}”.`);
  const timezone = isScheduleValueProvided(args.timezone)
    ? String(args.timezone)
    : routine.timezone;
  const timing = compactScheduleInput({
    cron: args.cron,
    every: args.every,
    unit: args.unit,
    runAt: args.runAt,
    delayMinutes: args.delayMinutes,
    delaySeconds: args.delaySeconds,
  });
  if (Object.keys(timing).length)
    changes.push(`Change when it runs to: ${newTiming({ ...args, ...timing }, timezone)}.`);
  else if (isScheduleValueProvided(args.startAt))
    changes.push(`Keep its schedule, starting from ${String(args.startAt)}.`);
  if (timezone !== routine.timezone) changes.push(`Use the ${timezone} time zone.`);
  const prompt = isScheduleValueProvided(args.prompt) ? String(args.prompt).trim() : undefined;
  if (prompt !== undefined && prompt !== routine.prompt.trim())
    changes.push("Replace what it does each time with the new instructions below.");
  if (!changes.length) changes.push("Leave it as it is: nothing in this request changes it.");
  const title = pausing
    ? `Pause the routine “${routine.name}”?`
    : resuming
      ? `Resume the routine “${routine.name}”?`
      : `Change the routine “${routine.name}”?`;
  return {
    withReason: true,
    title,
    lines: [
      ...routineLines(routine),
      "",
      "This will:",
      ...changes.map((change) => `- ${change}`),
      ...(prompt !== undefined && prompt !== routine.prompt.trim()
        ? ["", "New instructions:", prompt]
        : []),
    ],
  };
}

function cancelCard(routine: RoutineRow): FleetCardSummary {
  return {
    withReason: true,
    title: `Delete the routine “${routine.name}”?`,
    lines: [
      ...routineLines(routine),
      "",
      "This will:",
      "- Stop it and remove it from Routines. This cannot be undone; to stop it for now and keep it, pause it instead.",
    ],
  };
}

/** What the routine does and when it runs today, so the person knows which one this is. */
function routineLines(routine: RoutineRow): string[] {
  const purpose = routine.prompt.replace(/\s+/g, " ").trim();
  return [
    `What it does: ${purpose.length > PURPOSE_LENGTH ? `${purpose.slice(0, PURPOSE_LENGTH)}…` : purpose}`,
    `Now: ${currentTiming(routine)}`,
  ];
}

function currentTiming(routine: RoutineRow): string {
  const watch = watchFromTool(routine.watch);
  const schedule = watch
    ? watchLine(watch).replace(/^When: /, "")
    : isOneShotRoutineCrons(routine.crons)
      ? "once"
      : routine.crons.length
        ? `${routine.crons.map((cron) => formatCron(cron)).join("; ")} (${routine.timezone})`
        : "no schedule";
  if (!routine.active) return `paused (normally ${schedule})`;
  const next = routine.nextRunAt ? when(routine.nextRunAt, routine.timezone) : undefined;
  return next ? `running, ${schedule}; next run ${next}` : `running, ${schedule}`;
}

/** New timing as the tool will resolve it, or the fields as given when they do not resolve. */
function newTiming(args: Record<string, unknown>, timezone: string): string {
  const timing = compactScheduleInput({
    cron: args.cron,
    every: args.every,
    unit: args.unit,
    runAt: args.runAt,
    delayMinutes: args.delayMinutes,
    delaySeconds: args.delaySeconds,
    startAt: args.startAt,
  });
  const resolved = resolveScheduleTiming(timing, timezone);
  if (!resolved.ok) {
    return Object.entries(timing)
      .map(([key, value]) => `${key} ${String(value)}`)
      .join(", ");
  }
  const next = when(resolved.nextRunAt, timezone);
  return resolved.oneShot
    ? `once, on ${next} (${timezone})`
    : `${formatCron(resolved.cron)} (${timezone}), first run ${next}`;
}

function watchLine(watch: NonNullable<ReturnType<typeof watchFromTool>>): string {
  const every = `checked every ${watch.everyMinutes} minutes`;
  if (watch.kind === "files")
    return `When: whenever ${(watch.paths ?? []).join(", ")} changes on the computer (${every})`;
  if (watch.kind === "command")
    return `When: whenever the output of this command changes (${every}; the command runs on the computer each time without asking):\n${watch.command ?? ""}`;
  return `When: whenever ${watch.tool ?? "a connected tool"} returns something new (${every})${
    watch.args ? `, with ${JSON.stringify(watch.args)}` : ""
  }`;
}

/** "Thu 20 Nov, 09:00" in the routine's own time zone. */
function when(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}
