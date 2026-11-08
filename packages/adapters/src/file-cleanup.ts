import type { AgentHomeStore, ArtifactStore } from "@rakazo/adapter-kit";
import { createAdapterContext } from "@rakazo/adapter-kit";
import type { CompanyTools, FileCleanupResult } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { Prisma, runAsSystem } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { companyTools } from "./company-policy.js";
import { sweepComputerFiles } from "./file-retention.js";

/** Scheduled cleanup follows UK time, where every OCSC office keeps its hours. */
export const FILE_CLEANUP_TIME_ZONE = "Europe/London";
const DAY_MS = 86_400_000;
const FAMILY_BATCH = 200;

type Schedule = Pick<
  CompanyTools,
  "fileCleanupSchedule" | "fileCleanupHour" | "fileCleanupWeekday"
>;

/** The calendar day and weekday at `ms` in the cleanup time zone. */
function localDay(ms: number) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: FILE_CLEANUP_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date(ms));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

/** The instant a local wall-clock hour starts, across summer-time changes. */
function zonedHour(year: number, month: number, day: number, hour: number) {
  const guess = Date.UTC(year, month - 1, day, hour);
  const offset = (ms: number) => {
    const shown = new Intl.DateTimeFormat("en-GB", {
      timeZone: FILE_CLEANUP_TIME_ZONE,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    }).formatToParts(new Date(ms));
    const get = (type: string) => Number(shown.find((p) => p.type === type)?.value);
    return (
      Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) -
      Math.floor(ms / 60_000) * 60_000
    );
  };
  const first = guess - offset(guess);
  return guess - offset(first);
}

/** Scheduled starts within a week either side of `now`, oldest first. */
function slotsAround(schedule: Schedule, now: number) {
  const slots: number[] = [];
  for (let back = 8; back >= -8; back -= 1) {
    const day = localDay(now - back * DAY_MS);
    if (schedule.fileCleanupSchedule === "weekly" && day.weekday !== schedule.fileCleanupWeekday)
      continue;
    const at = zonedHour(day.year, day.month, day.day, schedule.fileCleanupHour);
    if (!slots.includes(at)) slots.push(at);
  }
  return slots.sort((a, b) => a - b);
}

/** The latest scheduled start at or before `now`; null while cleanup is off. */
export function lastCleanupSlot(schedule: Schedule, now: number): number | null {
  if (schedule.fileCleanupSchedule === "off") return null;
  return (
    slotsAround(schedule, now)
      .filter((at) => at <= now)
      .pop() ?? null
  );
}

/** The next scheduled start after `now`; null while cleanup is off. */
export function nextCleanupSlot(schedule: Schedule, now: number): number | null {
  if (schedule.fileCleanupSchedule === "off") return null;
  return slotsAround(schedule, now).find((at) => at > now) ?? null;
}

/** Whether a cleanup is owed: an admin asked for one, or a scheduled start passed since the last run. */
export function cleanupDue(
  schedule: Schedule,
  state: { lastRunAt: Date | null; requestedAt: Date | null },
  now: number,
): boolean {
  const last = state.lastRunAt?.getTime() ?? 0;
  if (state.requestedAt && state.requestedAt.getTime() > last) return true;
  const slot = lastCleanupSlot(schedule, now);
  return slot !== null && slot > last;
}

/**
 * Deletes files bots attached in chats once every version is older than the retention. Files
 * people uploaded themselves are never touched. Rows go first, so a chat never points at a
 * record whose file is half gone; a stored file is removed only when no row still names it.
 */
export async function sweepChatAttachments(deps: {
  prisma: PrismaClient;
  artifacts: ArtifactStore;
  retentionDays: number;
  now: number;
}): Promise<{ deletedItems: number; freedBytes: number }> {
  const cutoff = new Date(deps.now - deps.retentionDays * DAY_MS);
  const result = { deletedItems: 0, freedBytes: 0 };
  for (;;) {
    const families = await runAsSystem("find expired chat attachments", () =>
      deps.prisma.$queryRaw<Array<{ family: string }>>(Prisma.sql`
        SELECT COALESCE("rootArtifactId", id) AS family
        FROM "artifacts"
        GROUP BY 1
        HAVING max("createdAt") < ${cutoff} AND bool_and("runId" IS NOT NULL)
        LIMIT ${FAMILY_BATCH}
      `),
    );
    if (families.length === 0) return result;
    for (const { family } of families) {
      const removed = await runAsSystem("delete an expired chat attachment", () =>
        deps.prisma.$transaction(async (tx) => {
          const members = await tx.artifact.findMany({
            where: { OR: [{ id: family }, { rootArtifactId: family }] },
            select: {
              id: true,
              spaceId: true,
              userId: true,
              botId: true,
              storageKey: true,
              size: true,
            },
          });
          await tx.artifact.deleteMany({ where: { rootArtifactId: family } });
          await tx.artifact.deleteMany({ where: { id: family } });
          return members;
        }),
      );
      for (const member of removed) {
        result.deletedItems += 1;
        result.freedBytes += member.size;
        const stillUsed = await runAsSystem("check a stored file is unused", () =>
          deps.prisma.artifact.count({ where: { storageKey: member.storageKey } }),
        );
        if (stillUsed) continue;
        await deps.artifacts
          .remove(
            member.storageKey,
            createAdapterContext(
              member,
              member.botId ?? member.id,
              `artifact-cleanup:${member.id}`,
            ),
          )
          .catch((error: unknown) => {
            const code = (error as { code?: string } | null)?.code;
            if (code !== "ENOENT" && code !== "ENOTDIR")
              getLogger().error("chat attachment cleanup", error, { "artifact.id": member.id });
          });
      }
    }
    if (families.length < FAMILY_BATCH) return result;
  }
}

/** One cleanup: computer files past their retention, then chat attachments when an admin set a period. */
export async function runFileCleanup(deps: {
  prisma: PrismaClient;
  home: AgentHomeStore;
  artifacts: ArtifactStore;
  dataDir: string | undefined;
  toolRunners?: boolean;
  now?: number;
}): Promise<FileCleanupResult> {
  const now = deps.now ?? Date.now();
  const result: FileCleanupResult = { deletedItems: 0, freedBytes: 0, error: null };
  try {
    const swept = await sweepComputerFiles({ ...deps, now });
    result.deletedItems += swept.deletedItems;
    result.freedBytes += swept.freedBytes;
    const chatDays = companyTools().chatFileRetentionDays;
    if (chatDays !== null) {
      const chats = await sweepChatAttachments({ ...deps, retentionDays: chatDays, now });
      result.deletedItems += chats.deletedItems;
      result.freedBytes += chats.freedBytes;
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

/**
 * Runs a cleanup when one is owed and records it. The claim moves the last-run time first, so
 * a second worker that checks at the same moment finds nothing owed and skips.
 */
export async function runDueFileCleanup(deps: {
  prisma: PrismaClient;
  home: AgentHomeStore;
  artifacts: ArtifactStore;
  dataDir: string | undefined;
  toolRunners?: boolean;
  now?: number;
}): Promise<FileCleanupResult | null> {
  const now = deps.now ?? Date.now();
  const row = await runAsSystem("read the file cleanup state", () =>
    deps.prisma.deploymentSettings.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
      select: { fileCleanupLastRunAt: true, fileCleanupRequestedAt: true },
    }),
  );
  const state = { lastRunAt: row.fileCleanupLastRunAt, requestedAt: row.fileCleanupRequestedAt };
  if (!cleanupDue(companyTools(), state, now)) return null;
  // The start time is the run's mark: a request made while it runs is newer, so it runs again.
  const startedAt = new Date(now);
  const claimed = await runAsSystem("claim the file cleanup", () =>
    deps.prisma.deploymentSettings.updateMany({
      where: { id: "default", fileCleanupLastRunAt: state.lastRunAt },
      data: { fileCleanupLastRunAt: startedAt },
    }),
  );
  if (!claimed.count) return null;
  const result = await runFileCleanup({ ...deps, now });
  await runAsSystem("record the file cleanup", () =>
    deps.prisma.deploymentSettings.updateMany({
      where: { id: "default", fileCleanupLastRunAt: startedAt },
      data: { fileCleanupLastResult: result as Prisma.InputJsonObject },
    }),
  );
  return result;
}
