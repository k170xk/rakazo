import { describe, expect, it, vi } from "vitest";
import { dailyLimitRefusal, dailyRunLimitsFromEnv } from "./daily-run-limits.js";

function prisma(runs: number, spend: number | null) {
  return {
    run: { count: vi.fn(async () => runs) },
    usageRecord: { aggregate: vi.fn(async () => ({ _sum: { costUsd: spend } })) },
  } as unknown as Parameters<typeof dailyLimitRefusal>[0];
}

const limits = { runs: 200, spendUsd: 150 };

describe("dailyLimitRefusal", () => {
  it("never holds back a run a person started", async () => {
    const db = prisma(10_000, 10_000);
    for (const trigger of ["user", "resume", "messaging", "created", "reaction", "call_end"]) {
      await expect(dailyLimitRefusal(db, { id: "r", userId: "u", trigger }, limits)).resolves.toBe(
        null,
      );
    }
    expect(db.run.count).not.toHaveBeenCalled();
  });

  it("lets automatic runs go on under both limits", async () => {
    await expect(
      dailyLimitRefusal(prisma(199, 149), { id: "r", userId: "u", trigger: "routine" }, limits),
    ).resolves.toBeNull();
  });

  it("stops automatic runs at the run limit or the spend limit", async () => {
    await expect(
      dailyLimitRefusal(prisma(200, 0), { id: "r", userId: "u", trigger: "routine" }, limits),
    ).resolves.toMatch(/200 runs on its own/);
    await expect(
      dailyLimitRefusal(prisma(3, 151), { id: "r", userId: "u", trigger: "bot_message" }, limits),
    ).resolves.toMatch(/\$151/);
  });
});

describe("dailyRunLimitsFromEnv", () => {
  it("uses the defaults unless a positive number is set", () => {
    expect(dailyRunLimitsFromEnv({})).toEqual({ runs: 200, spendUsd: 150 });
    expect(
      dailyRunLimitsFromEnv({
        RAKAZO_DAILY_AUTOMATIC_RUNS: "50",
        RAKAZO_DAILY_AUTOMATIC_SPEND_USD: "20.5",
      }),
    ).toEqual({ runs: 50, spendUsd: 20.5 });
    expect(
      dailyRunLimitsFromEnv({
        RAKAZO_DAILY_AUTOMATIC_RUNS: "0",
        RAKAZO_DAILY_AUTOMATIC_SPEND_USD: "abc",
      }),
    ).toEqual({ runs: 200, spendUsd: 150 });
  });
});
