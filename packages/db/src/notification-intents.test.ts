import { describe, expect, it, vi } from "vitest";
import {
  markNotificationIntentFailed,
  markNotificationIntentSent,
  markNotificationIntentSkipped,
  notificationSourceEventKey,
  upsertNotificationIntent,
} from "./notification-intents.js";

describe("notificationSourceEventKey", () => {
  it("is stable for the same kind, run, and message", () => {
    expect(
      notificationSourceEventKey({ kind: "help", runId: "run-1", messageId: "msg-1" }),
    ).toBe("help:run-1:msg-1");
    expect(notificationSourceEventKey({ kind: "completion", runId: "run-1" })).toBe(
      "completion:run-1:-",
    );
  });

  it("changes when the kind or message changes", () => {
    const base = notificationSourceEventKey({ kind: "help", runId: "run-1" });
    expect(notificationSourceEventKey({ kind: "failure", runId: "run-1" })).not.toBe(base);
    expect(
      notificationSourceEventKey({ kind: "help", runId: "run-1", messageId: "msg-2" }),
    ).not.toBe(base);
  });
});

describe("upsertNotificationIntent", () => {
  it("creates a new intent when missing", async () => {
    const create = vi.fn(async () => ({ id: "intent-1" }));
    const prisma = { notificationIntent: { create, findUniqueOrThrow: vi.fn() } };

    await expect(
      upsertNotificationIntent(prisma as never, {
        spaceId: "space-1",
        userId: "user-1",
        botId: "bot-1",
        threadId: "thread-1",
        sourceEventKey: "help:run-1:-",
        kind: "help",
        category: "action_needed",
        title: "Scout has a question",
        body: "Question waiting",
      }),
    ).resolves.toEqual({ id: "intent-1", created: true });
  });

  it("returns created false when the unique key already exists", async () => {
    const { Prisma } = await import("./client.js");
    const create = vi.fn(async () => {
      throw new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
      });
    });
    const findUniqueOrThrow = vi.fn(async () => ({ id: "intent-existing" }));
    const prisma = { notificationIntent: { create, findUniqueOrThrow } };

    await expect(
      upsertNotificationIntent(prisma as never, {
        spaceId: "space-1",
        userId: "user-1",
        botId: "bot-1",
        threadId: "thread-1",
        sourceEventKey: "help:run-1:-",
        kind: "help",
        category: "action_needed",
        title: "Scout has a question",
        body: "Question waiting",
      }),
    ).resolves.toEqual({ id: "intent-existing", created: false });
  });
});

describe("mark helpers", () => {
  it("mark sent, skipped, and failed only touch processing rows", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = { notificationIntent: { updateMany } };

    await markNotificationIntentSent(prisma as never, { id: "i-1", deliveryId: "d-1" });
    await markNotificationIntentSkipped(prisma as never, { id: "i-1", reason: "category_disabled" });
    await markNotificationIntentFailed(prisma as never, {
      id: "i-1",
      error: "provider down",
      nextAttemptAt: new Date("2026-01-01T00:00:01Z"),
    });

    const calls = updateMany.mock.calls as unknown as Array<
      [{ where: unknown; data: Record<string, unknown> }]
    >;
    expect(calls.map(([args]) => args.where)).toEqual([
      { id: "i-1", status: "processing" },
      { id: "i-1", status: "processing" },
      { id: "i-1", status: "processing" },
    ]);
    expect(calls[0]![0].data.status).toBe("sent");
    expect(calls[1]![0].data.status).toBe("skipped");
    expect(calls[2]![0].data).toMatchObject({
      status: "failed",
      lastError: "provider down",
    });
  });
});
