import { DEFAULT_COMPANY_FEATURES, staffLimitsFrom } from "@rakazo/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setCompanyPolicy } from "./company-policy.js";
import {
  activeRoutineCapRefusal,
  applyPersonLimits,
  busiestDayRuns,
  clearSpendCache,
  modelAllowed,
  monthlyBudgetRefusal,
  nextScheduledAfter,
  routineDailyAllowance,
  routineScheduleRefusal,
  routinesWithinDailyLimit,
} from "./staff-limits.js";

const NO_OVERRIDES = {
  routineRunsPerDay: null,
  maxActiveRoutines: null,
  monthlyBudgetUsd: null,
  modelAccess: null,
  allowedModels: [],
};

afterEach(() => {
  setCompanyPolicy({ features: null, staffLimits: null });
  clearSpendCache();
});

describe("staffLimitsFrom", () => {
  it("defaults to 24 runs a day and ten routines with no budget", () => {
    expect(staffLimitsFrom({})).toEqual({
      routineRunsPerDay: 24,
      maxActiveRoutines: 10,
      monthlyBudgetUsd: null,
    });
  });

  it("keeps valid keys and drops invalid ones", () => {
    expect(
      staffLimitsFrom({ routineRunsPerDay: 4, maxActiveRoutines: -1, monthlyBudgetUsd: 25 }),
    ).toEqual({ routineRunsPerDay: 4, maxActiveRoutines: 10, monthlyBudgetUsd: 25 });
  });
});

describe("applyPersonLimits", () => {
  const company = { routineRunsPerDay: 1, maxActiveRoutines: 5, monthlyBudgetUsd: 50 };

  it("follows the company where the person has no override", () => {
    expect(applyPersonLimits({ ...NO_OVERRIDES }, company)).toMatchObject(company);
  });

  it("applies overrides, with a negative budget meaning none", () => {
    expect(
      applyPersonLimits(
        { ...NO_OVERRIDES, routineRunsPerDay: 3, maxActiveRoutines: 0, monthlyBudgetUsd: -1 },
        company,
      ),
    ).toMatchObject({ routineRunsPerDay: 3, maxActiveRoutines: 0, monthlyBudgetUsd: null });
  });

  it("lets a person's model access outrank the company switch either way", () => {
    setCompanyPolicy({ features: { ...DEFAULT_COMPANY_FEATURES, memberModels: false } });
    expect(applyPersonLimits({ ...NO_OVERRIDES }, company).mayChooseModels).toBe(false);
    expect(
      applyPersonLimits({ ...NO_OVERRIDES, modelAccess: "choose" }, company).mayChooseModels,
    ).toBe(true);
    setCompanyPolicy({ features: { ...DEFAULT_COMPANY_FEATURES, memberModels: true } });
    expect(
      applyPersonLimits({ ...NO_OVERRIDES, modelAccess: "fixed" }, company).mayChooseModels,
    ).toBe(false);
  });
});

describe("modelAllowed", () => {
  it("allows everything with an empty list and only listed models otherwise", () => {
    expect(modelAllowed({ allowedModels: [] }, "openai", "gpt-5")).toBe(true);
    const limits = { allowedModels: ["openrouter/anthropic/claude-sonnet"] };
    expect(modelAllowed(limits, "openrouter", "anthropic/claude-sonnet")).toBe(true);
    expect(modelAllowed(limits, "openai", "gpt-5")).toBe(false);
  });
});

describe("routine schedules", () => {
  const now = new Date("2026-11-13T09:00:00Z");

  it("counts the busiest 24 hours of a schedule", () => {
    expect(busiestDayRuns(["0 9 * * *"], "UTC", now)).toBe(1);
    expect(busiestDayRuns(["0 9 * * *", "0 17 * * *"], "UTC", now)).toBe(2);
    expect(busiestDayRuns(["*/15 * * * *"], "UTC", now)).toBe(96);
    expect(busiestDayRuns(["0 9 * * 1"], "UTC", now)).toBe(1);
    expect(busiestDayRuns([], "UTC", now)).toBe(0);
  });

  it("refuses a schedule past the runs-per-day limit", () => {
    expect(
      routineScheduleRefusal(
        { routineRunsPerDay: 1 },
        { crons: ["0 9 * * *"], timezone: "UTC" },
        now,
      ),
    ).toBeNull();
    expect(
      routineScheduleRefusal(
        { routineRunsPerDay: 1 },
        { crons: ["0 * * * *"], timezone: "UTC" },
        now,
      ),
    ).toMatch(/at most once a day/);
    expect(
      routineScheduleRefusal(
        { routineRunsPerDay: 24 },
        { crons: ["0 * * * *"], timezone: "UTC" },
        now,
      ),
    ).toBeNull();
  });

  it("finds the first scheduled time at or after a moment", () => {
    expect(
      nextScheduledAfter(["0 9 * * *"], "UTC", new Date("2026-11-14T09:00:00Z"))?.toISOString(),
    ).toBe("2026-11-14T09:00:00.000Z");
    expect(
      nextScheduledAfter(["0 9 * * *"], "UTC", new Date("2026-11-14T09:00:01Z"))?.toISOString(),
    ).toBe("2026-11-15T09:00:00.000Z");
  });
});

describe("routineDailyAllowance", () => {
  it("reports when the oldest run in the window leaves it", async () => {
    const now = Date.parse("2026-11-13T12:00:00Z");
    const firedAt = new Date("2026-11-13T08:00:00Z");
    const prisma = { routineFiring: { findMany: vi.fn(async () => [{ firedAt }]) } };
    await expect(routineDailyAllowance(prisma as never, "r1", 1, now)).resolves.toEqual({
      used: 1,
      resumeAt: new Date("2026-11-14T08:00:00Z"),
    });
    await expect(routineDailyAllowance(prisma as never, "r1", 2, now)).resolves.toEqual({
      used: 1,
      resumeAt: null,
    });
  });
});

describe("routinesWithinDailyLimit", () => {
  it("drops routines at their limit and records the rest", async () => {
    const create = vi.fn(async () => ({}));
    const prisma = {
      user: { findUnique: vi.fn(async () => ({ ...NO_OVERRIDES, routineRunsPerDay: 1 })) },
      routineFiring: {
        findMany: vi.fn(async ({ where }: { where: { routineId: string } }) =>
          where.routineId === "busy" ? [{ firedAt: new Date() }] : [],
        ),
        create,
      },
    };
    const kept = await routinesWithinDailyLimit(
      prisma as never,
      "u1",
      [{ id: "busy" }, { id: "quiet" }],
      "webhook",
    );
    expect(kept).toEqual([{ id: "quiet" }]);
    expect(create).toHaveBeenCalledWith({
      data: { routineId: "quiet", userId: "u1", source: "webhook" },
    });
  });

  it("lets the event through when the limit cannot be read", async () => {
    const prisma = { user: { findUnique: vi.fn(async () => Promise.reject(new Error("down"))) } };
    await expect(
      routinesWithinDailyLimit(prisma as never, "u1", [{ id: "r1" }], "github"),
    ).resolves.toEqual([{ id: "r1" }]);
  });
});

describe("activeRoutineCapRefusal", () => {
  it("refuses once the person has as many routines on as allowed", async () => {
    const prisma = (active: number, cap: number | null) => ({
      user: { findUnique: vi.fn(async () => ({ ...NO_OVERRIDES, maxActiveRoutines: cap })) },
      routine: { count: vi.fn(async () => active) },
    });
    await expect(activeRoutineCapRefusal(prisma(9, null) as never, "u1")).resolves.toBeNull();
    await expect(activeRoutineCapRefusal(prisma(10, null) as never, "u1")).resolves.toMatch(
      /the most your administrator allows \(10\)/,
    );
    await expect(activeRoutineCapRefusal(prisma(0, 0) as never, "u1")).resolves.toMatch(
      /not allowed you to switch on routines/,
    );
  });
});

describe("monthlyBudgetRefusal", () => {
  it("blocks once this month's spend reaches the budget", async () => {
    const prisma = (spent: number, budget: number | null) => ({
      user: { findUnique: vi.fn(async () => ({ ...NO_OVERRIDES, monthlyBudgetUsd: budget })) },
      usageRecord: { aggregate: vi.fn(async () => ({ _sum: { costUsd: spent } })) },
    });
    await expect(monthlyBudgetRefusal(prisma(100, null) as never, "u1")).resolves.toBeNull();
    clearSpendCache();
    await expect(monthlyBudgetRefusal(prisma(9.99, 10) as never, "u1")).resolves.toBeNull();
    clearSpendCache();
    await expect(monthlyBudgetRefusal(prisma(10, 10) as never, "u1")).resolves.toMatch(
      /reached your monthly AI budget \(\$10\.00; used \$10\.00\)/,
    );
  });

  it("follows the company budget for people without their own", async () => {
    setCompanyPolicy({
      staffLimits: { routineRunsPerDay: 1, maxActiveRoutines: 5, monthlyBudgetUsd: 20 },
    });
    const prisma = {
      user: { findUnique: vi.fn(async () => ({ ...NO_OVERRIDES })) },
      usageRecord: { aggregate: vi.fn(async () => ({ _sum: { costUsd: 25 } })) },
    };
    await expect(monthlyBudgetRefusal(prisma as never, "u1")).resolves.toMatch(/\$20\.00/);
  });
});
