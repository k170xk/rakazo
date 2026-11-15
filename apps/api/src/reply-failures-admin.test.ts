import {
  CURRENT_TURN_TOO_LARGE_ERROR,
  MODEL_CONTEXT_TOO_SMALL_ERROR,
  MODEL_OUTPUT_LIMIT_ERROR,
} from "@rakazo/core";
import { describe, expect, it, vi } from "vitest";
import { replyFailureKind, replyFailures } from "./reply-failures-admin.js";
import type { RouterDeps } from "./router.js";

const now = new Date("2026-11-15T12:00:00Z");

function deps(admin: boolean) {
  const prisma = {
    user: {
      findUnique: vi.fn(async () => ({
        email: admin ? "boss@ocsc.co.uk" : "someone@ocsc.co.uk",
        emailVerified: true,
      })),
      findMany: vi.fn(async () => [{ id: "user-1", name: "Ann", email: "ann@ocsc.co.uk" }]),
    },
    run: {
      findMany: vi.fn(async () => [
        {
          botId: "bot-1",
          error: "Required context exceeds the model context budget (12 > 10)",
          completedAt: new Date("2026-11-14T09:00:00Z"),
          updatedAt: new Date("2026-11-14T09:00:00Z"),
        },
        {
          botId: "bot-1",
          error: MODEL_OUTPUT_LIMIT_ERROR,
          completedAt: null,
          updatedAt: new Date("2026-11-15T08:00:00Z"),
        },
        {
          botId: "bot-2",
          error: "Internal server error",
          completedAt: new Date("2026-11-15T10:00:00Z"),
          updatedAt: new Date("2026-11-15T10:00:00Z"),
        },
      ]),
    },
    bot: {
      findMany: vi.fn(async () => [{ id: "bot-1", name: "Cody", userId: "user-1" }]),
    },
    $queryRaw: vi.fn(async () => [
      { day: "2026-11-14", n: 40n },
      { day: "2026-11-15", n: 60n },
    ]),
  };
  const value = {
    prisma,
    env: { adminEmails: ["boss@ocsc.co.uk"] },
  } as unknown as Pick<RouterDeps, "prisma" | "env">;
  return { value, prisma };
}

describe("reply failures", () => {
  it("sorts failures into too much context, output limit and other", () => {
    expect(replyFailureKind(CURRENT_TURN_TOO_LARGE_ERROR)).toBe("context");
    expect(replyFailureKind(MODEL_CONTEXT_TOO_SMALL_ERROR)).toBe("context");
    expect(replyFailureKind("Required context exceeds the model context budget")).toBe("context");
    expect(replyFailureKind(MODEL_OUTPUT_LIMIT_ERROR)).toBe("output");
    expect(replyFailureKind("Internal server error")).toBe("other");
    expect(replyFailureKind(null)).toBe("other");
  });

  it("is for admins only", async () => {
    const { value, prisma } = deps(false);
    await expect(replyFailures(value, "someone", "7d", now)).rejects.toThrow(/Admins only/);
    expect(prisma.run.findMany).not.toHaveBeenCalled();
  });

  it("counts each day and each agent, with removed agents still listed", async () => {
    const { value } = deps(true);
    const result = await replyFailures(value, "admin-1", "7d", now);
    expect(result.days).toHaveLength(7);
    expect(result.days.at(-2)).toEqual({
      day: "2026-11-14",
      finished: 40,
      context: 1,
      output: 0,
      other: 0,
    });
    expect(result.days.at(-1)).toEqual({
      day: "2026-11-15",
      finished: 60,
      context: 0,
      output: 1,
      other: 1,
    });
    expect(result.totals).toEqual({ finished: 100, context: 1, output: 1, other: 1 });
    expect(result.agents).toEqual([
      {
        botId: "bot-1",
        name: "Cody",
        owner: "Ann",
        context: 1,
        output: 1,
        other: 0,
        lastFailedAt: "2026-11-15T08:00:00.000Z",
      },
      {
        botId: "bot-2",
        name: "Removed agent",
        owner: "",
        context: 0,
        output: 0,
        other: 1,
        lastFailedAt: "2026-11-15T10:00:00.000Z",
      },
    ]);
  });
});
