import type { PrismaClient } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";

/** Runs nobody started by hand, which could otherwise keep spending through the night. */
const AUTOMATIC_TRIGGERS = [
  "routine",
  "follow_up",
  "bot_message",
  "webhook",
  "spawn",
  "skill",
  "cloud_agent",
  "tickets",
] as const;
const AUTOMATIC = new Set<string>(AUTOMATIC_TRIGGERS);
const DAY_MS = 24 * 60 * 60 * 1000;

export type DailyRunLimits = { runs: number; spendUsd: number };

function positive(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return raw?.trim() && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Per person over the last 24 hours; far above anyone's real use, low enough to stop a runaway. */
export function dailyRunLimitsFromEnv(env: Record<string, string | undefined>): DailyRunLimits {
  return {
    runs: Math.floor(positive(env.RAKAZO_DAILY_AUTOMATIC_RUNS, 200)),
    spendUsd: positive(env.RAKAZO_DAILY_AUTOMATIC_SPEND_USD, 150),
  };
}

/**
 * Why an automatic run must not start, or null. Runs a person starts are never held back; an
 * automatic one stops once that person's automatic runs or total model spend in the last day
 * reach the limit.
 */
export async function dailyLimitRefusal(
  prisma: Pick<PrismaClient, "run" | "usageRecord">,
  run: { id: string; userId: string; trigger: string },
  limits: DailyRunLimits,
  now = Date.now(),
): Promise<string | null> {
  if (!AUTOMATIC.has(run.trigger)) return null;
  const since = new Date(now - DAY_MS);
  const [runs, spend] = await runAsSystem("count a person's automatic runs and spend today", () =>
    Promise.all([
      prisma.run.count({
        where: {
          userId: run.userId,
          trigger: { in: [...AUTOMATIC_TRIGGERS] },
          createdAt: { gte: since },
          id: { not: run.id },
        },
      }),
      prisma.usageRecord.aggregate({
        where: { userId: run.userId, createdAt: { gte: since } },
        _sum: { costUsd: true },
      }),
    ]),
  );
  if (runs >= limits.runs) {
    return `This agent has started ${runs} runs on its own in the last day, the most allowed. It will carry on once that eases, or when you message it.`;
  }
  if ((spend._sum.costUsd ?? 0) >= limits.spendUsd) {
    return `Your agents have used about $${Math.round(spend._sum.costUsd ?? 0)} of AI in the last day, so work nobody asked for is paused. Message an agent to carry on.`;
  }
  return null;
}
