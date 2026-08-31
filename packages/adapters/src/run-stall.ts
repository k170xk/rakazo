import type { PrismaClient, ThreadEvents } from "@rakazo/db";

/** Graphile fence after ~2 minutes of 10s computer-busy retries. */
export const COMPUTER_WAIT_MAX_FENCE = 12;
export const RUN_STALL_MS = 8 * 60_000;

export const WAITING_FOR_SHARED_DESKTOP = "Waiting for the shared desktop";
export const DESKTOP_BUSY_TOO_LONG =
  "The shared desktop stayed busy too long. Send the message again.";
export const RUN_STALLED_TOO_LONG =
  "Stopped because this turn made no progress for several minutes. Send the message again.";

export function shouldGiveUpComputerWait(fence: number): boolean {
  return fence >= COMPUTER_WAIT_MAX_FENCE;
}

export function isStalledRun(
  lastActivityAt: Date | null | undefined,
  now = new Date(),
  stallMs = RUN_STALL_MS,
): boolean {
  if (!lastActivityAt) return false;
  return now.getTime() - lastActivityAt.getTime() >= stallMs;
}

export function isComputerWaitAnnouncement(payload: unknown): boolean {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      "text" in payload &&
      (payload as { text: unknown }).text === WAITING_FOR_SHARED_DESKTOP,
  );
}

export async function failStalledRuns(
  prisma: PrismaClient,
  events?: ThreadEvents,
  now = new Date(),
): Promise<string[]> {
  const candidates = await prisma.run.findMany({
    where: {
      status: { in: ["running", "leased"] },
      startedAt: { lte: new Date(now.getTime() - RUN_STALL_MS) },
    },
    select: {
      id: true,
      startedAt: true,
      workspaceId: true,
      threadId: true,
      botId: true,
    },
  });
  const failed: string[] = [];
  for (const run of candidates) {
    if (!run.startedAt) continue;
    const last = await prisma.event.findFirst({
      where: { runId: run.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const lastActivityAt = last?.createdAt ?? run.startedAt;
    if (!isStalledRun(lastActivityAt, now)) continue;
    const stopped = await prisma.run.updateMany({
      where: { id: run.id, status: { in: ["running", "leased"] } },
      data: {
        status: "failed",
        error: RUN_STALLED_TOO_LONG,
        completedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    if (stopped.count !== 1) continue;
    await prisma.computerExecutionLease.deleteMany({ where: { runId: run.id } });
    await prisma.attempt.updateMany({
      where: { runId: run.id, status: "running" },
      data: { status: "failed", error: RUN_STALLED_TOO_LONG, finishedAt: now },
    });
    await events
      ?.append({
        workspaceId: run.workspaceId,
        threadId: run.threadId,
        botId: run.botId,
        type: "run.failed",
        runId: run.id,
        payload: { error: RUN_STALLED_TOO_LONG },
      })
      .catch(() => undefined);
    failed.push(run.id);
  }
  return failed;
}
