import {
  computerSupportsTerminal,
  computerSupportsUpdate,
  DISK_WARNING_PERCENT,
  diskUsedPercent,
} from "@rakazo/adapters";
import type { ComputerStatus } from "@rakazo/contracts";
import { ACTIVE_RUN_STATUSES, computerScreenSize } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";

/** Mirrors computer.takeover: an execution lease blocks user control unless a takeover is pending. */
export function executionBlocksUserTakeover(input: {
  hasLease: boolean;
  leaseExpiresAt: Date | null | undefined;
  runStatus: string | null | undefined;
  now?: number;
  takeoverRequested?: boolean;
}): boolean {
  if (!input.hasLease) return false;
  if (input.runStatus === "waiting_takeover" || input.takeoverRequested) return false;
  const now = input.now ?? Date.now();
  const leaseActive = Boolean(input.leaseExpiresAt && input.leaseExpiresAt.getTime() > now);
  const runActive = Boolean(
    input.runStatus && (ACTIVE_RUN_STATUSES as readonly string[]).includes(input.runStatus),
  );
  return leaseActive || runActive;
}

export async function resolveBusyBotName(
  prisma: PrismaClient,
  input: {
    computerId: string | null | undefined;
    botId: string;
    botName: string;
  },
): Promise<string | null> {
  if (!input.computerId) return null;
  const leases = await prisma.computerExecutionLease.findMany({
    where: {
      computerId: input.computerId,
      OR: [{ botId: input.botId }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { updatedAt: "desc" },
    take: 8,
    select: {
      botId: true,
      expiresAt: true,
      runId: true,
      computer: { select: { controlRunId: true } },
    },
  });
  if (leases.length === 0) return null;
  const runs = await prisma.run.findMany({
    where: { id: { in: leases.map((lease) => lease.runId) } },
    select: { id: true, status: true },
  });
  const status = new Map(runs.map((run) => [run.id, run.status]));
  const working = leases.filter((lease) =>
    executionBlocksUserTakeover({
      hasLease: true,
      leaseExpiresAt: lease.expiresAt,
      runStatus: status.get(lease.runId),
      takeoverRequested: lease.computer.controlRunId === lease.runId,
    }),
  );
  if (working.some((lease) => lease.botId === input.botId)) return input.botName;
  // On a computer several agents share, name the one at work there now.
  const other = working[0];
  if (!other) return null;
  const bot = await prisma.bot.findUnique({ where: { id: other.botId }, select: { name: true } });
  return bot?.name ?? null;
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
    maintenanceId?: string | null;
    diskUsedBytes?: bigint | null;
    diskFreeBytes?: bigint | null;
    diskDismissedPercent?: number | null;
  } | null,
  busyBotName: string | null = null,
): ComputerStatus {
  const kind = (computer?.kind ?? "fake") as ComputerStatus["kind"];
  const state =
    kind === "none"
      ? "stopped"
      : computer?.maintenanceId
        ? "booting"
        : computer?.state === "quarantined"
          ? "error"
          : computer?.state === "suspending"
            ? "running"
            : computer?.state === "stopped" ||
                computer?.state === "booting" ||
                computer?.state === "running" ||
                computer?.state === "suspended" ||
                computer?.state === "error"
              ? computer.state
              : "stopped";
  const screen = computerScreenSize(computer?.kind);
  const diskPercent = computer ? diskUsedPercent(computer) : null;
  const diskFull =
    diskPercent !== null &&
    diskPercent >= DISK_WARNING_PERCENT &&
    diskPercent > (computer?.diskDismissedPercent ?? 0);
  return {
    botId,
    mode: computer?.scope === "dedicated" ? "dedicated" : "team",
    kind,
    state,
    controlHolder: (computer?.controlHolder ?? "none") as ComputerStatus["controlHolder"],
    controlBotId: computer?.controlBotId ?? null,
    takeoverRequested: Boolean(computer?.controlRunId),
    screenAvailable: !computer?.maintenanceId && (state === "running" || state === "booting"),
    screenWidth: screen.width,
    screenHeight: screen.height,
    homeRevision: computer?.homeRevision ?? null,
    busyBotName,
    canUpdate: computerSupportsUpdate(kind),
    terminalAvailable: computerSupportsTerminal(kind),
    ...(diskFull ? { diskFullPercent: diskPercent } : {}),
  };
}
