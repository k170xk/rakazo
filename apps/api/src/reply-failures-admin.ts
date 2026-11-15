import type { ReplyFailureKind, ReplyFailurePeriod, ReplyFailures } from "@rakazo/contracts";
import { normalizeRunError } from "@rakazo/core";
import { runAsSystem } from "@rakazo/db";
import { requireAdmin } from "./admins.js";
import type { RouterDeps } from "./router.js";

type ReplyFailuresDeps = Pick<RouterDeps, "prisma"> & {
  env: Pick<RouterDeps["env"], "adminEmails">;
};

const DAY_MS = 86_400_000;
const PERIOD_DAYS: Record<ReplyFailurePeriod, number> = { "7d": 7, "30d": 30, "90d": 90 };
/** Runs that failed this way before the error had a plain-English message. */
const LEGACY_CONTEXT_ERROR = /^Required context exceeds the model context budget/;

export function replyFailureKind(error: string | null): ReplyFailureKind {
  const text = error?.trim() ?? "";
  if (LEGACY_CONTEXT_ERROR.test(text)) return "context";
  const kind = text ? normalizeRunError(text).kind : undefined;
  return kind === "context" || kind === "output" ? kind : "other";
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Failed replies per day and per agent, split by context, output and other failures. */
export async function replyFailures(
  deps: ReplyFailuresDeps,
  actorUserId: string,
  period: ReplyFailurePeriod,
  now = new Date(),
): Promise<ReplyFailures> {
  await requireAdmin(deps, actorUserId);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const since = new Date(today - (PERIOD_DAYS[period] - 1) * DAY_MS);
  const [failed, finished] = await runAsSystem("read reply failures", () =>
    Promise.all([
      deps.prisma.run.findMany({
        where: { status: "failed", updatedAt: { gte: since } },
        select: { botId: true, error: true, completedAt: true, updatedAt: true },
      }),
      deps.prisma.$queryRaw<{ day: string; n: bigint }[]>`
        select to_char(date_trunc('day', coalesce("completedAt", "updatedAt") at time zone 'UTC'), 'YYYY-MM-DD') as day,
               count(*) as n
        from runs
        where status in ('completed', 'failed') and "updatedAt" >= ${since}
        group by 1`,
    ]),
  );
  const days = Array.from({ length: PERIOD_DAYS[period] }, (_, i) =>
    dayKey(new Date(since.getTime() + i * DAY_MS)),
  );
  const dayIndex = new Map(days.map((day, i) => [day, i]));
  const byDay = days.map((day) => ({ day, finished: 0, context: 0, output: 0, other: 0 }));
  for (const row of finished) {
    const entry = byDay[dayIndex.get(row.day) ?? -1];
    if (entry) entry.finished = Number(row.n);
  }
  const byAgent = new Map<
    string,
    { context: number; output: number; other: number; last: Date | null }
  >();
  for (const row of failed) {
    const at = row.completedAt ?? row.updatedAt;
    const kind = replyFailureKind(row.error);
    const entry = byDay[dayIndex.get(dayKey(at)) ?? -1];
    if (entry) entry[kind] += 1;
    const agent = byAgent.get(row.botId) ?? { context: 0, output: 0, other: 0, last: null };
    agent[kind] += 1;
    if (!agent.last || at > agent.last) agent.last = at;
    byAgent.set(row.botId, agent);
  }
  const bots = await runAsSystem("read agent names", () =>
    deps.prisma.bot.findMany({
      where: { id: { in: [...byAgent.keys()] } },
      select: { id: true, name: true, userId: true },
    }),
  );
  const owners = await runAsSystem("read agent owners", () =>
    deps.prisma.user.findMany({
      where: { id: { in: [...new Set(bots.map((bot) => bot.userId))] } },
      select: { id: true, name: true, email: true },
    }),
  );
  const botById = new Map(bots.map((bot) => [bot.id, bot]));
  const ownerById = new Map(owners.map((user) => [user.id, user]));
  const agents = [...byAgent.entries()]
    .map(([botId, entry]) => {
      const bot = botById.get(botId);
      const owner = bot ? ownerById.get(bot.userId) : undefined;
      return {
        botId,
        name: bot?.name ?? "Removed agent",
        owner: owner?.name || owner?.email || "",
        context: entry.context,
        output: entry.output,
        other: entry.other,
        lastFailedAt: entry.last?.toISOString() ?? null,
      };
    })
    .sort(
      (a, b) =>
        b.context + b.output - (a.context + a.output) ||
        b.other - a.other ||
        a.name.localeCompare(b.name),
    );
  const sum = (key: "finished" | ReplyFailureKind) =>
    byDay.reduce((total, day) => total + day[key], 0);
  return {
    period,
    since: since.toISOString(),
    days: byDay,
    totals: {
      finished: sum("finished"),
      context: sum("context"),
      output: sum("output"),
      other: sum("other"),
    },
    agents,
  };
}
