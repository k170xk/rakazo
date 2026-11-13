import { ORPCError } from "@orpc/server";
import { companyFeatures, companyStaffLimits, refreshCompanyPolicy } from "@rakazo/adapters";
import type {
  RoutineActivity,
  RoutineActivityPeriod,
  StaffLimits,
  StaffLimitsState,
  StaffPersonLimits,
} from "@rakazo/contracts";
import { ModelAccessSchema, staffLimitsFrom } from "@rakazo/contracts";
import type { Prisma } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { requireAdmin } from "./admins.js";
import type { RouterDeps } from "./router.js";

type StaffLimitsDeps = Pick<RouterDeps, "prisma" | "secrets"> & {
  env: Pick<RouterDeps["env"], "adminEmails">;
};

const DAY_MS = 86_400_000;

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function staffLimitsState(
  deps: StaffLimitsDeps,
  actorUserId: string,
  now = new Date(),
): Promise<StaffLimitsState> {
  await requireAdmin(deps, actorUserId);
  const [people, active, spend] = await runAsSystem("read staff limits", () =>
    Promise.all([
      deps.prisma.user.findMany({
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          email: true,
          routineRunsPerDay: true,
          maxActiveRoutines: true,
          monthlyBudgetUsd: true,
          modelAccess: true,
          allowedModels: true,
        },
      }),
      deps.prisma.routine.groupBy({ by: ["userId"], where: { active: true }, _count: true }),
      deps.prisma.usageRecord.groupBy({
        by: ["userId"],
        where: { createdAt: { gte: monthStart(now) } },
        _sum: { costUsd: true },
      }),
    ]),
  );
  const activeBy = new Map(active.map((row) => [row.userId, row._count]));
  const spendBy = new Map(spend.map((row) => [row.userId, row._sum.costUsd ?? 0]));
  return {
    defaults: companyStaffLimits(),
    memberModels: companyFeatures().memberModels,
    people: people.map((person) => ({
      userId: person.id,
      name: person.name || person.email,
      email: person.email,
      routineRunsPerDay: person.routineRunsPerDay,
      maxActiveRoutines: person.maxActiveRoutines,
      monthlyBudgetUsd:
        person.monthlyBudgetUsd === null
          ? null
          : person.monthlyBudgetUsd < 0
            ? "none"
            : person.monthlyBudgetUsd,
      modelAccess: ModelAccessSchema.safeParse(person.modelAccess).data ?? null,
      allowedModels: person.allowedModels,
      activeRoutines: activeBy.get(person.id) ?? 0,
      spentThisMonthUsd: spendBy.get(person.id) ?? 0,
    })),
  };
}

export async function setStaffLimitDefaults(
  deps: StaffLimitsDeps,
  actorUserId: string,
  input: Partial<StaffLimits>,
): Promise<StaffLimitsState> {
  await requireAdmin(deps, actorUserId);
  await runAsSystem("save staff limits", async () => {
    const row = await deps.prisma.deploymentSettings.findUnique({
      where: { id: "default" },
      select: { staffLimits: true },
    });
    const next = { ...staffLimitsFrom(row?.staffLimits), ...input };
    await deps.prisma.deploymentSettings.upsert({
      where: { id: "default" },
      create: { id: "default", staffLimits: next as Prisma.InputJsonValue },
      update: { staffLimits: next as Prisma.InputJsonValue },
    });
  });
  await refreshCompanyPolicy(deps.prisma, deps.secrets);
  getLogger().info("company_admin.staff_limits_saved", { keys: Object.keys(input) });
  return staffLimitsState(deps, actorUserId);
}

export async function setStaffPersonLimits(
  deps: StaffLimitsDeps,
  actorUserId: string,
  input: Partial<StaffPersonLimits> & { userId: string },
): Promise<StaffLimitsState> {
  await requireAdmin(deps, actorUserId);
  const data: Prisma.UserUpdateManyMutationInput = {};
  if (input.routineRunsPerDay !== undefined) data.routineRunsPerDay = input.routineRunsPerDay;
  if (input.maxActiveRoutines !== undefined) data.maxActiveRoutines = input.maxActiveRoutines;
  if (input.monthlyBudgetUsd !== undefined)
    data.monthlyBudgetUsd = input.monthlyBudgetUsd === "none" ? -1 : input.monthlyBudgetUsd;
  if (input.modelAccess !== undefined) data.modelAccess = input.modelAccess;
  if (input.allowedModels !== undefined) data.allowedModels = [...new Set(input.allowedModels)];
  const updated = await runAsSystem("save a person's staff limits", () =>
    deps.prisma.user.updateMany({ where: { id: input.userId }, data }),
  );
  if (!updated.count) throw new ORPCError("NOT_FOUND", { message: "No such person." });
  getLogger().info("company_admin.person_limits_saved", {
    userId: input.userId,
    keys: Object.keys(data),
  });
  return staffLimitsState(deps, actorUserId);
}

const ACTIVITY_DAYS: Record<RoutineActivityPeriod, number> = { "7d": 7, "30d": 30, "90d": 90 };

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Routines created per day and per person, with each person's active routines and runs. */
export async function routineActivity(
  deps: StaffLimitsDeps,
  actorUserId: string,
  period: RoutineActivityPeriod,
  now = new Date(),
): Promise<RoutineActivity> {
  await requireAdmin(deps, actorUserId);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const since = new Date(today - (ACTIVITY_DAYS[period] - 1) * DAY_MS);
  const [created, active, runs] = await runAsSystem("read routine activity", () =>
    Promise.all([
      deps.prisma.routineCreation.findMany({
        where: { createdAt: { gte: since } },
        select: { userId: true, createdAt: true },
      }),
      deps.prisma.routine.groupBy({ by: ["userId"], where: { active: true }, _count: true }),
      deps.prisma.routineFiring.groupBy({
        by: ["userId"],
        where: { firedAt: { gte: since } },
        _count: true,
      }),
    ]),
  );
  const days = Array.from({ length: ACTIVITY_DAYS[period] }, (_, i) =>
    dayKey(new Date(since.getTime() + i * DAY_MS)),
  );
  const dayIndex = new Map(days.map((day, i) => [day, i]));
  const activeBy = new Map(active.map((row) => [row.userId, row._count]));
  const runsBy = new Map(runs.map((row) => [row.userId, row._count]));
  const byPerson = new Map<string, { daily: number[]; last: Date | null }>();
  const totalsByDay = days.map(() => 0);
  for (const row of created) {
    const index = dayIndex.get(dayKey(row.createdAt));
    if (index === undefined) continue;
    const entry = byPerson.get(row.userId) ?? { daily: days.map(() => 0), last: null };
    entry.daily[index] = (entry.daily[index] ?? 0) + 1;
    if (!entry.last || row.createdAt > entry.last) entry.last = row.createdAt;
    byPerson.set(row.userId, entry);
    totalsByDay[index] = (totalsByDay[index] ?? 0) + 1;
  }
  const ids = [...new Set([...byPerson.keys(), ...activeBy.keys(), ...runsBy.keys()])];
  const users = await runAsSystem("read staff names", () =>
    deps.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true },
    }),
  );
  const userById = new Map(users.map((user) => [user.id, user]));
  const people = ids
    .map((userId) => {
      const user = userById.get(userId);
      const entry = byPerson.get(userId);
      const daily = entry?.daily ?? days.map(() => 0);
      return {
        userId,
        name: user?.name || user?.email || "Removed account",
        email: user?.email ?? "",
        created: daily.reduce((sum, n) => sum + n, 0),
        active: activeBy.get(userId) ?? 0,
        runs: runsBy.get(userId) ?? 0,
        lastCreatedAt: entry?.last?.toISOString() ?? null,
        daily,
      };
    })
    .sort((a, b) => b.created - a.created || b.active - a.active || b.runs - a.runs);
  return {
    period,
    since: since.toISOString(),
    days: days.map((day, i) => ({ day, created: totalsByDay[i] ?? 0 })),
    totals: {
      created: created.length,
      active: people.reduce((sum, person) => sum + person.active, 0),
      runs: people.reduce((sum, person) => sum + person.runs, 0),
    },
    people,
  };
}
