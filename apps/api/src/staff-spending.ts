import type { StaffSpending, StaffSpendingPeriod } from "@rakazo/contracts";
import { runAsSystem } from "@rakazo/db";
import { requireAdmin } from "./admins.js";
import type { RouterDeps } from "./router.js";

type UsageSumField = "inputTokens" | "outputTokens" | "totalTokens" | "costUsd";
type UsageGroup = {
  _sum: Record<UsageSumField, number | null>;
  _count: Record<UsageSumField | "_all", number>;
};

const USAGE_SUMS = {
  inputTokens: true,
  outputTokens: true,
  totalTokens: true,
  costUsd: true,
} as const;
const USAGE_COUNTS = { _all: true, ...USAGE_SUMS } as const;

/**
 * Sums of the calls that reported each figure, with the calls that reported no cost counted
 * apart, so one call that failed before the provider replied cannot hide every other total.
 */
export function measuredUsageTotals(group: UsageGroup) {
  const measured = (field: UsageSumField) =>
    group._count[field] > 0 ? (group._sum[field] ?? 0) : null;
  return {
    inputTokens: measured("inputTokens"),
    outputTokens: measured("outputTokens"),
    totalTokens: measured("totalTokens"),
    costUsd: measured("costUsd"),
    modelCalls: group._count._all,
    unmeasuredCalls: group._count._all - group._count.costUsd,
  };
}

const PERIOD_DAYS: Record<Exclude<StaffSpendingPeriod, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/** Every person's model spending across all spaces, for company admins. */
export async function staffSpending(
  deps: Pick<RouterDeps, "prisma"> & { env: Pick<RouterDeps["env"], "adminEmails"> },
  actorUserId: string,
  period: StaffSpendingPeriod,
  now = new Date(),
): Promise<StaffSpending> {
  await requireAdmin(deps, actorUserId);
  const since =
    period === "all" ? null : new Date(now.getTime() - PERIOD_DAYS[period] * 86_400_000);
  const where = since ? { createdAt: { gte: since } } : {};
  const [overall, byPerson, byPersonModel] = await runAsSystem("read staff spending", () =>
    Promise.all([
      deps.prisma.usageRecord.aggregate({ where, _sum: USAGE_SUMS, _count: USAGE_COUNTS }),
      deps.prisma.usageRecord.groupBy({
        by: ["userId"],
        where,
        _sum: USAGE_SUMS,
        _count: USAGE_COUNTS,
        _max: { createdAt: true },
      }),
      deps.prisma.usageRecord.groupBy({
        by: ["userId", "provider", "model"],
        where,
        _sum: USAGE_SUMS,
        _count: USAGE_COUNTS,
      }),
    ]),
  );
  const users = await runAsSystem("read staff names", () =>
    deps.prisma.user.findMany({
      where: { id: { in: byPerson.map((row) => row.userId) } },
      select: { id: true, name: true, email: true, image: true },
    }),
  );
  const userById = new Map(users.map((user) => [user.id, user]));
  const people = byPerson
    .map((row) => {
      const user = userById.get(row.userId);
      return {
        userId: row.userId,
        name: user?.name || user?.email || "Removed account",
        email: user?.email ?? "",
        image: user?.image ?? null,
        lastUsedAt: (row._max.createdAt ?? now).toISOString(),
        ...measuredUsageTotals(row),
        models: byPersonModel
          .filter((model) => model.userId === row.userId)
          .map((model) => ({
            provider: model.provider,
            model: model.model,
            ...measuredUsageTotals(model),
          }))
          .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.modelCalls - a.modelCalls),
      };
    })
    .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.modelCalls - a.modelCalls);
  return {
    period,
    since: since?.toISOString() ?? null,
    totals: { ...measuredUsageTotals(overall), people: people.length },
    people,
  };
}
