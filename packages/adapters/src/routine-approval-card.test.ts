import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { buildApprovalAskBlock } from "./approval-ask.js";
import { routineCardSummary } from "./routine-approval-card.js";

const routine = {
  name: "Morning inbox digest",
  prompt: "Summarise unread emails from the last day and post the five most important.",
  crons: ["0 8 * * 1-5"],
  timezone: "Europe/Dublin",
  active: true,
  nextRunAt: new Date("2030-01-07T08:00:00Z"),
  watch: null,
};

function prismaWith(row: typeof routine | null) {
  const findFirst = vi.fn(async () => row);
  const prisma = {
    routine: { findFirst },
    user: { findUnique: vi.fn(async () => ({ timezone: "Europe/London" })) },
  } as unknown as PrismaClient;
  return { prisma, findFirst };
}

const scope = { spaceId: "s1", botId: "b1", userId: "u1" };

describe("routine approval cards", () => {
  it("names the routine, what it does and that pausing keeps it", async () => {
    const { prisma, findFirst } = prismaWith(routine);
    const card = await routineCardSummary(prisma, scope, "schedule_update", {
      routineId: "r1",
      active: false,
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ...scope, id: "r1" } }),
    );
    expect(card?.title).toBe("Pause the routine “Morning inbox digest”?");
    const text = card!.lines.join("\n");
    expect(text).toContain("What it does: Summarise unread emails");
    expect(text).toContain(
      "Now: running, Weekdays at 8:00 AM (Europe/Dublin); next run Mon 7 Jan, 08:00",
    );
    expect(text).toContain(
      "Pause it: it stops running until someone resumes it. Nothing is deleted",
    );
    expect(text).not.toContain("routineId");
  });

  it("shows a changed schedule and the whole new instructions", async () => {
    const { prisma } = prismaWith({ ...routine, active: false });
    const card = await routineCardSummary(prisma, scope, "schedule_update", {
      routineId: "r1",
      active: true,
      every: 2,
      unit: "hours",
      prompt: "Only flag emails from clients.",
    });
    expect(card?.title).toBe("Resume the routine “Morning inbox digest”?");
    const text = card!.lines.join("\n");
    expect(text).toContain("Now: paused (normally Weekdays at 8:00 AM (Europe/Dublin))");
    expect(text).toContain("- Resume it");
    expect(text).toContain("- Change when it runs to: Every 2 hours (Europe/Dublin), first run");
    expect(text).toContain("New instructions:\nOnly flag emails from clients.");
  });

  it("warns that deleting cannot be undone", async () => {
    const { prisma, findFirst } = prismaWith(routine);
    const card = await routineCardSummary(prisma, { ...scope, threadId: "t1" }, "schedule_cancel", {
      name: "Morning inbox digest",
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ...scope, threadId: "t1", name: "Morning inbox digest" },
      }),
    );
    expect(card?.title).toBe("Delete the routine “Morning inbox digest”?");
    expect(card!.lines.join("\n")).toContain("This cannot be undone");
  });

  it("shows a new routine's timing, its full instructions and a watched command in full", async () => {
    const { prisma } = prismaWith(null);
    const timed = await routineCardSummary(prisma, scope, "schedule_create", {
      name: "Friday report",
      prompt: "Write the weekly report.",
      cron: "0 16 * * 5",
    });
    expect(timed?.title).toBe("Create the routine “Friday report”?");
    expect(timed!.lines.join("\n")).toMatch(
      /When: Every Friday at 4:00 PM \(Europe\/London\), first run .*\n.*\n\nWhat it will do each time:\nWrite the weekly report\./,
    );
    const watched = await routineCardSummary(prisma, scope, "schedule_create", {
      name: "Build check",
      prompt: "Tell me when the build output changes.",
      watch: { kind: "command", command: "npm run build --silent", everyMinutes: 30 },
    });
    expect(watched!.lines.join("\n")).toContain(
      "checked every 30 minutes; the command runs on the computer each time without asking):\nnpm run build --silent",
    );
  });

  it("falls back to the generic card when the routine is not this agent's", async () => {
    const { prisma } = prismaWith(null);
    expect(
      await routineCardSummary(prisma, scope, "schedule_update", {
        routineId: "r9",
        active: false,
      }),
    ).toBeUndefined();
  });

  it("leads with the reviewer's reason on the card", async () => {
    const { prisma } = prismaWith(routine);
    const summary = await routineCardSummary(prisma, scope, "schedule_update", {
      routineId: "r1",
      active: false,
    });
    const block = buildApprovalAskBlock("e1", "schedule_update", {}, [], {
      reviewReason: "This run read an email, so a person confirms routine changes.",
      summary,
    });
    expect(block).toMatchObject({ text: "Pause the routine “Morning inbox digest”?" });
    expect(String((block as { detail?: string }).detail)).toMatch(
      /^This run read an email, so a person confirms routine changes\.\n\nWhat it does:/,
    );
  });
});
