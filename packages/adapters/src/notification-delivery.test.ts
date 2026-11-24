import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deliverNotificationIntents,
  notificationRetryAt,
} from "./notification-delivery.js";

vi.mock("./notification-identity.js", () => ({
  notificationIdentity: async () => ({ botId: "bot-1", name: "Scout" }),
}));

const intent = {
  id: "intent-1",
  spaceId: "space-1",
  userId: "user-1",
  botId: "bot-1",
  threadId: "thread-1",
  groupId: null as string | null,
  runId: "run-1",
  messageId: null as string | null,
  sourceEventKey: "completion:run-1:-",
  kind: "completion",
  category: "updates",
  title: "Scout finished",
  body: "Work completed",
  status: "processing",
  attempts: 1,
  nextAttemptAt: null,
  claimedBy: "worker-1",
  claimedAt: new Date(),
  deliveryId: null,
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function prefs(overrides: Record<string, boolean> = {}) {
  return {
    inApp: true,
    push: true,
    actionNeeded: true,
    updates: true,
    problems: true,
    ...overrides,
  };
}

function deliveryDeps({
  claimed = [intent],
  preferences = prefs(),
  notifyOnFinish = true,
  send = vi.fn(async () => undefined),
  publish = vi.fn(async () => undefined),
  enqueue = vi.fn(async () => undefined),
  markSent = vi.fn(async () => undefined),
  markSkipped = vi.fn(async () => undefined),
  markFailed = vi.fn(async () => undefined),
} = {}) {
  const prisma = {
    bot: {
      findFirst: async () => ({
        id: "bot-1",
        name: "Scout",
        color: "#000",
        avatarSet: "",
        notifyOnFinish,
      }),
    },
  };
  const deps = {
    prisma: prisma as never,
    events: { publishChatAlert: publish },
    notifications: { send },
    jobs: { enqueue },
    now: () => new Date("2026-01-01T00:00:00Z"),
  } as unknown as import("./notification-delivery.js").NotificationDeliveryDeps;
  return {
    deps,
    send,
    publish,
    enqueue,
    markSent,
    markSkipped,
    markFailed,
    claimed,
    preferences,
  };
}

vi.mock("@rakazo/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@rakazo/db")>();
  return {
    ...actual,
    claimPendingNotificationIntents: vi.fn(),
    getOrCreateNotificationPreferences: vi.fn(),
    markNotificationIntentSent: vi.fn(),
    markNotificationIntentSkipped: vi.fn(),
    markNotificationIntentFailed: vi.fn(),
    countUnreadInboxChats: vi.fn(async () => 2),
  };
});

import {
  claimPendingNotificationIntents,
  getOrCreateNotificationPreferences,
  markNotificationIntentFailed,
  markNotificationIntentSent,
  markNotificationIntentSkipped,
} from "@rakazo/db";

describe("notificationRetryAt", () => {
  it("backs off then stops after the attempt budget", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(notificationRetryAt(1, now)?.getTime()).toBe(now.getTime() + 1_000);
    expect(notificationRetryAt(3, now)?.getTime()).toBe(now.getTime() + 5_000);
    expect(notificationRetryAt(8, now)).toBeNull();
  });
});

describe("deliverNotificationIntents", () => {
  beforeEach(() => {
    vi.mocked(claimPendingNotificationIntents).mockReset();
    vi.mocked(getOrCreateNotificationPreferences).mockReset();
    vi.mocked(markNotificationIntentSent).mockReset();
    vi.mocked(markNotificationIntentSkipped).mockReset();
    vi.mocked(markNotificationIntentFailed).mockReset();
  });

  it("skips when the category preference is off", async () => {
    const { deps } = deliveryDeps();
    vi.mocked(claimPendingNotificationIntents).mockResolvedValueOnce([intent] as never);
    vi.mocked(getOrCreateNotificationPreferences).mockResolvedValueOnce(
      prefs({ updates: false }) as never,
    );
    await deliverNotificationIntents(deps, { workerId: "worker-1" });
    expect(markNotificationIntentSkipped).toHaveBeenCalledWith(
      deps.prisma,
      expect.objectContaining({ id: "intent-1", reason: "category_disabled" }),
    );
  });

  it("skips when both channels are off", async () => {
    const { deps } = deliveryDeps();
    vi.mocked(claimPendingNotificationIntents).mockResolvedValueOnce([intent] as never);
    vi.mocked(getOrCreateNotificationPreferences).mockResolvedValueOnce(
      prefs({ inApp: false, push: false }) as never,
    );
    await deliverNotificationIntents(deps, { workerId: "worker-1" });
    expect(markNotificationIntentSkipped).toHaveBeenCalledWith(
      deps.prisma,
      expect.objectContaining({ reason: "channels_disabled" }),
    );
  });

  it("skips updates when the bot turned finish notices off and the chat is not a group", async () => {
    const { deps } = deliveryDeps({ notifyOnFinish: false });
    vi.mocked(claimPendingNotificationIntents).mockResolvedValueOnce([intent] as never);
    vi.mocked(getOrCreateNotificationPreferences).mockResolvedValueOnce(prefs() as never);
    await deliverNotificationIntents(deps, { workerId: "worker-1" });
    expect(markNotificationIntentSkipped).toHaveBeenCalledWith(
      deps.prisma,
      expect.objectContaining({ reason: "bot_updates_disabled" }),
    );
  });

  it("delivers in-app and push then marks sent", async () => {
    const { deps, send, publish } = deliveryDeps();
    vi.mocked(claimPendingNotificationIntents).mockResolvedValueOnce([intent] as never);
    vi.mocked(getOrCreateNotificationPreferences).mockResolvedValueOnce(prefs() as never);
    await deliverNotificationIntents(deps, { workerId: "worker-1" });
    expect(publish).toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
    expect(markNotificationIntentSent).toHaveBeenCalledWith(
      deps.prisma,
      expect.objectContaining({ id: "intent-1", deliveryId: "intent-1" }),
    );
  });

  it("marks failed with backoff and re-enqueues on a transient push error", async () => {
    const { deps, enqueue } = deliveryDeps({
      send: vi.fn(async () => {
        throw new Error("provider down");
      }),
    });
    vi.mocked(claimPendingNotificationIntents).mockResolvedValueOnce([intent] as never);
    vi.mocked(getOrCreateNotificationPreferences).mockResolvedValueOnce(prefs() as never);
    await deliverNotificationIntents(deps, { workerId: "worker-1" });
    expect(markNotificationIntentFailed).toHaveBeenCalledWith(
      deps.prisma,
      expect.objectContaining({
        id: "intent-1",
        error: "provider down",
        nextAttemptAt: expect.any(Date),
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "notification.deliver",
        payload: { intentId: "intent-1" },
      }),
    );
  });
});
