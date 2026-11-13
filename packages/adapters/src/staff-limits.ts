import type { RoutineWatch, StaffLimits } from "@rakazo/contracts";
import { allowedModelKey, ModelAccessSchema } from "@rakazo/contracts";
import { isOneShotRoutineCron, nextCronDate, nextCronDateAcross } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";
import { companyFeatures, companyStaffLimits } from "./company-policy.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export type RoutineFiringSource = "schedule" | "watch" | "webhook" | "github" | "messaging";

/** One person's limits after their overrides are applied to the company's. */
export type PersonStaffLimits = StaffLimits & {
  mayChooseModels: boolean;
  /** Empty allows every model. */
  allowedModels: string[];
};

type PersonOverrides = {
  routineRunsPerDay: number | null;
  maxActiveRoutines: number | null;
  monthlyBudgetUsd: number | null;
  modelAccess: string | null;
  allowedModels: string[];
};

export const PERSON_LIMIT_SELECT = {
  routineRunsPerDay: true,
  maxActiveRoutines: true,
  monthlyBudgetUsd: true,
  modelAccess: true,
  allowedModels: true,
} as const;

/** Whether a person may change models: their admin-set access, else the company switch. */
export function personMayChooseModels(modelAccess: string | null | undefined): boolean {
  const access = ModelAccessSchema.safeParse(modelAccess);
  return access.success ? access.data === "choose" : companyFeatures().memberModels;
}

export function applyPersonLimits(
  person: PersonOverrides | null,
  company: StaffLimits = companyStaffLimits(),
): PersonStaffLimits {
  const budget = person?.monthlyBudgetUsd;
  return {
    routineRunsPerDay: person?.routineRunsPerDay ?? company.routineRunsPerDay,
    maxActiveRoutines: person?.maxActiveRoutines ?? company.maxActiveRoutines,
    monthlyBudgetUsd:
      budget === null || budget === undefined
        ? company.monthlyBudgetUsd
        : budget < 0
          ? null
          : budget,
    mayChooseModels: personMayChooseModels(person?.modelAccess),
    allowedModels: person?.allowedModels ?? [],
  };
}

export async function personStaffLimits(
  prisma: Pick<PrismaClient, "user">,
  userId: string,
): Promise<PersonStaffLimits> {
  const person = await runAsSystem("read a person's staff limits", () =>
    prisma.user.findUnique({ where: { id: userId }, select: PERSON_LIMIT_SELECT }),
  );
  return applyPersonLimits(person);
}

/** Whether this model is on the person's allowed list; an empty list allows every model. */
export function modelAllowed(
  limits: Pick<PersonStaffLimits, "allowedModels">,
  provider: string | null | undefined,
  modelId: string | null | undefined,
): boolean {
  if (limits.allowedModels.length === 0) return true;
  if (!provider || !modelId) return true;
  return limits.allowedModels.includes(allowedModelKey(provider, modelId));
}

export const MODEL_NOT_ALLOWED =
  "Your administrator has not made that model available to you. Pick one of the models they allowed.";
export const MODEL_CHOICE_OFF = "Your administrator chooses the model for your assistants.";

/**
 * How many times a routine started in the last 24 hours and, when that reaches its limit,
 * when the oldest of those runs leaves the window.
 */
export async function routineDailyAllowance(
  prisma: Pick<PrismaClient, "routineFiring">,
  routineId: string,
  limit: number,
  now = Date.now(),
): Promise<{ used: number; resumeAt: Date | null }> {
  const recent = await runAsSystem("count a routine's runs today", () =>
    prisma.routineFiring.findMany({
      where: { routineId, firedAt: { gte: new Date(now - DAY_MS) } },
      orderBy: { firedAt: "desc" },
      select: { firedAt: true },
      take: limit,
    }),
  );
  const oldest = recent.at(-1);
  if (recent.length < limit || !oldest) return { used: recent.length, resumeAt: null };
  return { used: recent.length, resumeAt: new Date(oldest.firedAt.getTime() + DAY_MS) };
}

export async function recordRoutineFiring(
  prisma: Pick<PrismaClient, "routineFiring">,
  firing: { routineId: string; userId: string; source: RoutineFiringSource },
): Promise<void> {
  await runAsSystem("record a routine run", () => prisma.routineFiring.create({ data: firing }));
}

/**
 * The inbound routines still under their owner's runs-per-day limit, each recorded as fired.
 * A limit that cannot be read lets the event through rather than losing it.
 */
export async function routinesWithinDailyLimit<T extends { id: string }>(
  prisma: Pick<PrismaClient, "routineFiring" | "user">,
  userId: string,
  routines: T[],
  source: RoutineFiringSource,
  now = Date.now(),
): Promise<T[]> {
  if (routines.length === 0) return routines;
  try {
    const { routineRunsPerDay } = await personStaffLimits(prisma, userId);
    const allowed: T[] = [];
    for (const routine of routines) {
      const { resumeAt } = await routineDailyAllowance(prisma, routine.id, routineRunsPerDay, now);
      if (resumeAt) continue;
      await recordRoutineFiring(prisma, { routineId: routine.id, userId, source });
      allowed.push(routine);
    }
    return allowed;
  } catch {
    return routines;
  }
}

/** Why this person may not switch on another routine, or null. */
export async function activeRoutineCapRefusal(
  prisma: Pick<PrismaClient, "routine" | "user">,
  userId: string,
  options: { excludeRoutineId?: string } = {},
): Promise<string | null> {
  const { maxActiveRoutines } = await personStaffLimits(prisma, userId);
  const active = await runAsSystem("count a person's active routines", () =>
    prisma.routine.count({
      where: {
        userId,
        active: true,
        ...(options.excludeRoutineId ? { id: { not: options.excludeRoutineId } } : {}),
      },
    }),
  );
  if (active < maxActiveRoutines) return null;
  if (maxActiveRoutines === 0)
    return "Your administrator has not allowed you to switch on routines. Ask them if you need one.";
  return `You already have ${active} routines switched on, the most your administrator allows (${maxActiveRoutines}). Switch one off or delete it first.`;
}

/** The most runs any 24 hours of the next week would hold. */
export function busiestDayRuns(crons: string[], timezone: string, now = new Date()): number {
  const recurring = crons.filter((cron) => !isOneShotRoutineCron(cron));
  if (recurring.length === 0) return crons.length > 0 ? 1 : 0;
  const end = now.getTime() + 8 * DAY_MS;
  const times: number[] = [];
  let from = now;
  while (times.length < 3000) {
    const next = nextCronDateAcross(recurring, from, timezone);
    if (!next || next.getTime() > end) break;
    times.push(next.getTime());
    from = next;
  }
  let busiest = 0;
  let start = 0;
  for (let i = 0; i < times.length; i += 1) {
    while ((times[i] ?? 0) - (times[start] ?? 0) >= DAY_MS) start += 1;
    busiest = Math.max(busiest, i - start + 1);
  }
  return busiest;
}

/**
 * Why a schedule runs more often than the owner's limit, or null. Change checks need no model,
 * so their interval is free; the runs they start count at fire time instead.
 */
export function routineScheduleRefusal(
  limits: Pick<StaffLimits, "routineRunsPerDay">,
  input: { crons: string[]; timezone: string; watch?: RoutineWatch | null },
  now = new Date(),
): string | null {
  const runs = busiestDayRuns(input.crons, input.timezone, now);
  if (runs <= limits.routineRunsPerDay) return null;
  const allowed =
    limits.routineRunsPerDay === 1 ? "once a day" : `${limits.routineRunsPerDay} times a day`;
  return `This schedule would run up to ${runs} times in a day; your administrator allows each routine to run at most ${allowed}. Choose a less frequent schedule.`;
}

/** The first scheduled time at or after `from`, for deferring a routine past its limit. */
export function nextScheduledAfter(crons: string[], timezone: string, from: Date): Date | null {
  const recurring = crons.filter((cron) => !isOneShotRoutineCron(cron));
  if (recurring.length === 0) return null;
  try {
    const before = new Date(from.getTime() - 1);
    return recurring
      .map((cron) => nextCronDate(cron, before, timezone))
      .reduce((a, b) => (a < b ? a : b));
  } catch {
    return nextCronDateAcross(recurring, from, timezone);
  }
}

function monthStart(now: number): Date {
  const date = new Date(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

const spendCache = new Map<string, { at: number; usd: number }>();
const SPEND_CACHE_MS = 30_000;

/** This person's AI spend so far this calendar month (UTC), across every space. */
export async function spentThisMonthUsd(
  prisma: Pick<PrismaClient, "usageRecord">,
  userId: string,
  now = Date.now(),
): Promise<number> {
  const cached = spendCache.get(userId);
  if (cached && now - cached.at < SPEND_CACHE_MS) return cached.usd;
  const sum = await runAsSystem("read a person's spend this month", () =>
    prisma.usageRecord.aggregate({
      where: { userId, createdAt: { gte: monthStart(now) } },
      _sum: { costUsd: true },
    }),
  );
  const usd = sum._sum.costUsd ?? 0;
  spendCache.set(userId, { at: now, usd });
  return usd;
}

/** Why a run must not start because its owner used their monthly budget, or null. */
export async function monthlyBudgetRefusal(
  prisma: Pick<PrismaClient, "usageRecord" | "user">,
  userId: string,
  now = Date.now(),
): Promise<string | null> {
  const { monthlyBudgetUsd } = await personStaffLimits(prisma, userId);
  if (monthlyBudgetUsd === null) return null;
  const spent = await spentThisMonthUsd(prisma, userId, now);
  if (spent < monthlyBudgetUsd) return null;
  return `You have reached your monthly AI budget ($${monthlyBudgetUsd.toFixed(2)}; used $${spent.toFixed(2)}). Your assistants are paused until next month or until an administrator raises your budget.`;
}

/** Test seam. */
export function clearSpendCache(): void {
  spendCache.clear();
}
