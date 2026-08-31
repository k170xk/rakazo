import type { ComputerStatus } from "@rakazo/contracts";
import { ACTIVE_RUN_STATUSES, computerScreenSize } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";

/** Mirrors computer.takeover: an execution lease blocks user control unless waiting_takeover. */
export function executionBlocksUserTakeover(input: {
  hasLease: boolean;
  leaseExpiresAt: Date | null | undefined;
  runStatus: string | null | undefined;
  now?: number;
}): boolean {
  if (!input.hasLease) return false;
  if (input.runStatus === "waiting_takeover") return false;
  const now = input.now ?? Date.now();
  const leaseActive = Boolean(input.leaseExpiresAt && input.leaseExpiresAt.getTime() > now);
  const runActive = Boolean(
    input.runStatus && (ACTIVE_RUN_STATUSES as readonly string[]).includes(input.runStatus),
  );
  return leaseActive || runActive;
}

export async function resolveBusyBot(
  prisma: PrismaClient,
  input: {
    computerId: string | null | undefined;
    botId: string;
    botName: string;
  },
): Promise<{ botId: string; name: string } | null> {
  if (!input.computerId) return null;
  const now = new Date();
  const leases = await prisma.computerExecutionLease.findMany({
    where: { computerId: input.computerId, expiresAt: { gt: now } },
    select: { botId: true, runId: true, expiresAt: true },
    orderBy: { updatedAt: "desc" },
  });
  if (leases.length === 0) return null;
  const runs = await prisma.run.findMany({
    where: { id: { in: leases.map((lease) => lease.runId) } },
    select: { id: true, status: true },
  });
  const statusByRun = new Map(runs.map((run) => [run.id, run.status]));
  const blocking = leases.filter((lease) =>
    executionBlocksUserTakeover({
      hasLease: true,
      leaseExpiresAt: lease.expiresAt,
      runStatus: statusByRun.get(lease.runId),
    }),
  );
  const holder =
    blocking.find((lease) => statusByRun.get(lease.runId) === "running") ?? blocking[0];
  if (!holder) return null;
  if (holder.botId === input.botId) return { botId: input.botId, name: input.botName };
  const bot = await prisma.bot.findUnique({
    where: { id: holder.botId },
    select: { name: true },
  });
  return { botId: holder.botId, name: bot?.name ?? input.botName };
}

export async function resolveBusyBotName(
  prisma: PrismaClient,
  input: {
    computerId: string | null | undefined;
    botId: string;
    botName: string;
  },
): Promise<string | null> {
  return (await resolveBusyBot(prisma, input))?.name ?? null;
}

export function toComputerStatus(
  botId: string,
  computer: {
    kind: string;
    state: string;
    scope: string;
    controlHolder: string;
    controlBotId?: string | null;
    controlRunId?: string | null;
    homeRevision: string;
  } | null,
  busyBotName: string | null = null,
  busyBotId: string | null = null,
): ComputerStatus {
  const state =
    computer?.state === "suspending"
      ? "running"
      : computer?.state === "stopped" ||
          computer?.state === "booting" ||
          computer?.state === "running" ||
          computer?.state === "suspended" ||
          computer?.state === "error"
        ? computer.state
        : "stopped";
  const screen = computerScreenSize(computer?.kind);
  const kind = (computer?.kind ?? "fake") as ComputerStatus["kind"];
  return {
    botId,
    mode: computer?.scope === "dedicated" ? "dedicated" : "team",
    kind,
    state,
    controlHolder: (computer?.controlHolder ?? "none") as ComputerStatus["controlHolder"],
    controlBotId: computer?.controlBotId ?? null,
    takeoverRequested: Boolean(computer?.controlRunId),
    screenAvailable: state === "running" || state === "booting",
    screenWidth: screen.width,
    screenHeight: screen.height,
    homeRevision: computer?.homeRevision ?? null,
    busyBotName,
    busyBotId,
    updateAvailable: kind !== "desktop",
  };
}
