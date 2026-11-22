import { describe, expect, it, vi } from "vitest";
import { dailyLimitNotice, resolveRoutineThread } from "./run-routines.js";

describe("dailyLimitNotice", () => {
  it("says how often it ran and when it runs again, in the routine's timezone", () => {
    const text = dailyLimitNotice(24, new Date("2026-11-14T08:00:00Z"), "Europe/Dublin");
    expect(text).toMatch(/run 24 times in the last 24 hours/);
    expect(text).toMatch(/Sat/);
    expect(text).toMatch(/08:00/);
    expect(dailyLimitNotice(1, new Date("2026-11-14T08:00:00Z"), "Europe/Dublin")).toMatch(
      /run once/,
    );
  });

  it("still reads when the timezone is not one the runtime knows", () => {
    expect(dailyLimitNotice(2, new Date("2026-11-14T08:00:00Z"), "Mars/Base")).toMatch(
      /until 2026-11-14 08:00/,
    );
  });
});

describe("resolveRoutineThread", () => {
  it("targets an extra conversation (chatBotId) when the routine was created there", async () => {
    const findFirst = vi.fn(async () => ({ id: "extra-chat" }));
    const prisma = { thread: { findFirst } } as never;
    const resolved = await resolveRoutineThread(
      prisma,
      { id: "bot-1", spaceId: "space-1", userId: "user-1", thread: { id: "primary-chat" } },
      { spaceId: "space-1", threadId: "extra-chat" },
    );
    expect(resolved).toEqual({ id: "extra-chat" });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "extra-chat",
          OR: expect.arrayContaining([{ botId: "bot-1" }, { chatBotId: "bot-1" }]),
        }),
      }),
    );
  });

  it("falls back to the bot's primary thread when the routine's original chat was deleted", async () => {
    const prisma = { thread: { findFirst: vi.fn(async () => null) } } as never;
    const resolved = await resolveRoutineThread(
      prisma,
      { id: "bot-1", spaceId: "space-1", userId: "user-1", thread: { id: "promoted-chat" } },
      { spaceId: "space-1", threadId: null },
    );
    expect(resolved).toEqual({ id: "promoted-chat" });
  });

  it("promotes the newest extra chat if the bot's primary thread is ever missing", async () => {
    const findFirst = vi.fn(async () => ({ id: "extra-newest" }));
    const update = vi.fn(async () => ({ id: "extra-newest" }));
    const create = vi.fn();
    const prisma = { thread: { findFirst, update, create } } as never;
    const resolved = await resolveRoutineThread(
      prisma,
      { id: "bot-1", spaceId: "space-1", userId: "user-1", thread: null },
      { spaceId: "space-1", threadId: null },
    );
    expect(resolved).toEqual({ id: "extra-newest" });
    expect(update).toHaveBeenCalledWith({
      where: { id: "extra-newest" },
      data: { botId: "bot-1", chatBotId: null },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a fresh blank chat if the bot has zero chats remaining", async () => {
    const findFirst = vi.fn(async () => null);
    const create = vi.fn(async () => ({ id: "fresh-routine-chat" }));
    const prisma = { thread: { findFirst, create } } as never;
    const resolved = await resolveRoutineThread(
      prisma,
      { id: "bot-1", spaceId: "space-1", userId: "user-1", thread: null },
      { spaceId: "space-1", threadId: null },
    );
    expect(resolved).toEqual({ id: "fresh-routine-chat" });
    expect(create).toHaveBeenCalledWith({
      data: { spaceId: "space-1", userId: "user-1", botId: "bot-1" },
    });
  });
});
