import type { NotificationMessage } from "@rakazo/adapter-kit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutorDeps } from "./executor-deps.js";
import { notifyRun, safeNotificationCopy } from "./run-notifications.js";

vi.mock("./notification-identity.js", () => ({ notificationIdentity: async () => undefined }));

const upsertNotificationIntent = vi.fn(
  async (_db?: unknown, _input?: unknown) => ({ id: "intent-1", created: true }),
);
const deliverNotificationIntents = vi.fn(async (_deps?: unknown, _input?: unknown) => undefined);

vi.mock("@rakazo/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@rakazo/db")>();
  return {
    ...actual,
    upsertNotificationIntent: (db: unknown, input: unknown) => upsertNotificationIntent(db, input),
    countUnreadInboxChats: async () => 2,
  };
});

vi.mock("./notification-delivery.js", () => ({
  deliverNotificationIntents: (deps: unknown, input: unknown) =>
    deliverNotificationIntents(deps, input),
}));

const run = {
  spaceId: "space-1",
  userId: "user-1",
  botId: "bot-1",
  threadId: "thread-1",
  trigger: "user",
};

const message: NotificationMessage = {
  kind: "completion",
  title: "Scout finished",
  body: "The report is ready.",
  botId: "bot-1",
  threadId: "thread-1",
  runId: "run-1",
};

function deps({
  notifyOnFinish = true,
  groupId = null as string | null,
  enqueue = vi.fn(async () => undefined),
  withJobs = true,
} = {}) {
  const send = vi.fn(async () => undefined);
  const publish = vi.fn(async () => undefined);
  const value = {
    prisma: {
      routine: { findUnique: async () => null },
      run: {
        findFirst: async () => ({
          bot: {
            id: "bot-1",
            name: "Scout",
            color: "#000000",
            avatarSet: "",
            notifyOnFinish,
          },
          thread: { groupId },
        }),
      },
    },
    events: { publishChatAlert: publish },
    notifications: { send },
    ...(withJobs ? { jobs: { enqueue } } : {}),
  } as unknown as ExecutorDeps;
  return { value, publish, send, enqueue };
}

describe("safeNotificationCopy", () => {
  it("keeps lock-screen copy free of question text", () => {
    expect(safeNotificationCopy("help", "Scout")).toEqual({
      title: "Scout has a question",
      body: "Question waiting",
    });
    expect(safeNotificationCopy("help", "Scout", { approval: true })).toEqual({
      title: "Scout needs approval",
      body: "Approval needed",
    });
    expect(safeNotificationCopy("completion", "Scout")).toEqual({
      title: "Scout finished",
      body: "Work completed",
    });
    expect(safeNotificationCopy("failure", "Scout")).toEqual({
      title: "Scout needs attention",
      body: "Something needs attention",
    });
    expect(safeNotificationCopy("takeover", "Scout")).toEqual({
      title: "Scout needs you",
      body: "Something needs attention",
    });
  });
});

describe("notifyRun durable intents", () => {
  beforeEach(() => {
    upsertNotificationIntent.mockClear();
    deliverNotificationIntents.mockClear();
    upsertNotificationIntent.mockResolvedValue({ id: "intent-1", created: true });
  });

  it("upserts a safe-copy intent and enqueues delivery", async () => {
    const { value, enqueue, send, publish } = deps();
    await notifyRun(value, run, message);
    expect(upsertNotificationIntent).toHaveBeenCalledWith(
      value.prisma,
      expect.objectContaining({
        kind: "completion",
        category: "updates",
        title: "Scout finished",
        body: "Work completed",
        sourceEventKey: "completion:run-1:-",
        runId: "run-1",
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "notification.deliver",
        payload: { intentId: "intent-1" },
      }),
    );
    // Delivery happens on the job path, not inline when enqueue succeeds.
    expect(send).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(deliverNotificationIntents).not.toHaveBeenCalled();
  });

  it("names the group on the intent when the chat is shared", async () => {
    const { value } = deps({ notifyOnFinish: false, groupId: "group-1" });
    await notifyRun(value, run, message);
    expect(upsertNotificationIntent).toHaveBeenCalledWith(
      value.prisma,
      expect.objectContaining({ groupId: "group-1" }),
    );
  });

  it("creates nothing for a muted updates notice", async () => {
    const { value, enqueue } = deps({ notifyOnFinish: false });
    await notifyRun(value, run, message);
    expect(upsertNotificationIntent).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("still records help when finish notices are off", async () => {
    const { value } = deps({ notifyOnFinish: false });
    await notifyRun(value, run, {
      kind: "help",
      title: "Scout needs an answer",
      body: "What is the password?",
      botId: "bot-1",
      threadId: "thread-1",
      runId: "run-1",
    });
    expect(upsertNotificationIntent).toHaveBeenCalledWith(
      value.prisma,
      expect.objectContaining({
        kind: "help",
        category: "action_needed",
        title: "Scout has a question",
        body: "Question waiting",
      }),
    );
  });

  it("detects approval tone from the legacy title", async () => {
    const { value } = deps({ notifyOnFinish: false });
    await notifyRun(value, run, {
      kind: "help",
      title: "Scout needs approval",
      body: "Review before shell",
      botId: "bot-1",
      threadId: "thread-1",
      runId: "run-1",
    });
    expect(upsertNotificationIntent).toHaveBeenCalledWith(
      value.prisma,
      expect.objectContaining({
        title: "Scout needs approval",
        body: "Approval needed",
      }),
    );
  });

  it("falls back to immediate delivery when jobs are missing", async () => {
    const { value } = deps({ withJobs: false });
    await notifyRun(value, run, message);
    expect(deliverNotificationIntents).toHaveBeenCalledWith(
      expect.objectContaining({ prisma: value.prisma }),
      { intentId: "intent-1", workerId: "notify-run" },
    );
  });

  it("falls back to immediate delivery when enqueue fails", async () => {
    const { value } = deps({
      enqueue: vi.fn(async () => {
        throw new Error("queue down");
      }),
    });
    await notifyRun(value, run, message);
    expect(deliverNotificationIntents).toHaveBeenCalledWith(
      expect.objectContaining({ jobs: value.jobs }),
      { intentId: "intent-1", workerId: "notify-run" },
    );
  });
});
