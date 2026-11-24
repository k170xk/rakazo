import type { JobPublisher, NotificationMessage, NotificationProvider } from "@rakazo/adapter-kit";
import { notificationDeliverJob } from "@rakazo/adapter-kit";
import type { NotificationCategory } from "@rakazo/contracts";
import { truncatePlainText } from "@rakazo/core";
import {
  claimPendingNotificationIntents,
  countUnreadInboxChats,
  getOrCreateNotificationPreferences,
  markNotificationIntentFailed,
  markNotificationIntentSent,
  markNotificationIntentSkipped,
  notificationCategoryAllowed,
  notificationChannelsEnabled,
  type NotificationIntentRow,
  type PrismaClient,
  type ThreadEvents,
} from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { notificationIdentity } from "./notification-identity.js";

const ALERT_MAX_CHARS = 180;

const MAX_ATTEMPTS = 8;
const BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 60_000] as const;
const DRAIN_LIMIT = 25;

export type NotificationDeliveryDeps = {
  prisma: PrismaClient;
  events: Pick<ThreadEvents, "publishChatAlert">;
  notifications?: NotificationProvider;
  jobs?: JobPublisher;
  now?: () => Date;
};

/** Backoff for the next attempt; null once attempts are exhausted. */
export function notificationRetryAt(attempts: number, now = new Date()): Date | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] ?? BACKOFF_MS.at(-1)!;
  return new Date(now.getTime() + delay);
}

/**
 * Claim due notification intents and deliver or skip them according to
 * preferences and channel settings. Retries transient provider failures.
 */
export async function deliverNotificationIntents(
  deps: NotificationDeliveryDeps,
  input: { intentId?: string; workerId: string } = { workerId: "notification-deliver" },
): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const claimed = await claimPendingNotificationIntents(deps.prisma, {
    workerId: input.workerId,
    limit: input.intentId ? 1 : DRAIN_LIMIT,
    now,
    ...(input.intentId ? { intentId: input.intentId } : {}),
  });
  for (const intent of claimed) {
    await deliverOne(deps, intent, now);
  }
}

async function deliverOne(
  deps: NotificationDeliveryDeps,
  intent: NotificationIntentRow,
  now: Date,
): Promise<void> {
  const log = getLogger();
  const category = parseCategory(intent.category);
  if (!category) {
    await markNotificationIntentSkipped(deps.prisma, {
      id: intent.id,
      reason: "unknown_category",
    });
    log.info("notification intent skipped", {
      intentId: intent.id,
      category: intent.category,
      attempt: intent.attempts,
      outcome: "unknown_category",
    });
    return;
  }

  const prefs = await getOrCreateNotificationPreferences(deps.prisma, {
    spaceId: intent.spaceId,
    userId: intent.userId,
  });
  if (!notificationCategoryAllowed(prefs, category)) {
    await markNotificationIntentSkipped(deps.prisma, {
      id: intent.id,
      reason: "category_disabled",
    });
    log.info("notification intent skipped", {
      intentId: intent.id,
      category,
      attempt: intent.attempts,
      outcome: "category_disabled",
    });
    return;
  }

  const channels = notificationChannelsEnabled(prefs);
  if (!channels.inApp && !channels.push) {
    await markNotificationIntentSkipped(deps.prisma, {
      id: intent.id,
      reason: "channels_disabled",
    });
    log.info("notification intent skipped", {
      intentId: intent.id,
      category,
      attempt: intent.attempts,
      outcome: "channels_disabled",
    });
    return;
  }

  if (category === "updates") {
    const updatesAllowed = await updatesStillEnabled(deps.prisma, intent);
    if (!updatesAllowed) {
      await markNotificationIntentSkipped(deps.prisma, {
        id: intent.id,
        reason: "bot_updates_disabled",
      });
      log.info("notification intent skipped", {
        intentId: intent.id,
        category,
        attempt: intent.attempts,
        outcome: "bot_updates_disabled",
      });
      return;
    }
  }

  const deliveryId = intent.deliveryId ?? intent.id;
  const kind = parseKind(intent.kind);
  if (!kind) {
    await markNotificationIntentSkipped(deps.prisma, { id: intent.id, reason: "unknown_kind" });
    log.info("notification intent skipped", {
      intentId: intent.id,
      category,
      attempt: intent.attempts,
      outcome: "unknown_kind",
    });
    return;
  }

  const bot = await deps.prisma.bot.findFirst({
    where: { id: intent.botId, spaceId: intent.spaceId },
    select: { id: true, name: true, color: true, avatarSet: true },
  });
  const sender = bot ? await notificationIdentity(bot) : undefined;
  const badge = channels.push
    ? await countUnreadInboxChats(deps.prisma, {
        userId: intent.userId,
        spaceId: intent.spaceId,
      }).catch((error) => {
        log.error("unread chat count", error);
        return undefined;
      })
    : undefined;

  const message: NotificationMessage = {
    kind,
    category,
    title: intent.title,
    body: intent.body,
    botId: intent.botId,
    threadId: intent.threadId,
    ...(intent.runId ? { runId: intent.runId } : {}),
    ...(intent.messageId ? { messageId: intent.messageId } : {}),
    ...(intent.groupId ? { groupId: intent.groupId } : {}),
    ...(sender ? { sender } : {}),
    ...(badge === undefined ? {} : { badge }),
  };

  try {
    if (channels.inApp) {
      publishIntentChatAlert(deps.events, intent, message, deliveryId);
    }
    if (channels.push && deps.notifications) {
      await deps.notifications.send(message, {
        operationId: "notify",
        traceId: intent.botId,
        spaceId: intent.spaceId,
        userId: intent.userId,
        botId: intent.botId,
        signal: new AbortController().signal,
      });
    }
    await markNotificationIntentSent(deps.prisma, { id: intent.id, deliveryId });
    log.info("notification intent delivered", {
      intentId: intent.id,
      category,
      attempt: intent.attempts,
      outcome: "sent",
      inApp: channels.inApp,
      push: channels.push && Boolean(deps.notifications),
    });
  } catch (error) {
    const retryAt = notificationRetryAt(intent.attempts, now);
    const errorText = error instanceof Error ? error.message : String(error);
    await markNotificationIntentFailed(deps.prisma, {
      id: intent.id,
      error: errorText,
      nextAttemptAt: retryAt,
    });
    log.error("notification intent delivery failed", error, {
      intentId: intent.id,
      category,
      attempt: intent.attempts,
      outcome: retryAt ? "retry" : "exhausted",
    });
    if (retryAt && deps.jobs) {
      await deps.jobs.enqueue(notificationDeliverJob(intent.id, retryAt));
    }
  }
}

async function updatesStillEnabled(
  prisma: PrismaClient,
  intent: NotificationIntentRow,
): Promise<boolean> {
  if (intent.groupId) return true;
  const bot = await prisma.bot.findFirst({
    where: { id: intent.botId, spaceId: intent.spaceId },
    select: { notifyOnFinish: true },
  });
  return Boolean(bot?.notifyOnFinish);
}

function parseCategory(value: string): NotificationCategory | null {
  switch (value) {
    case "action_needed":
    case "updates":
    case "problems":
      return value;
    default:
      return null;
  }
}

function parseKind(value: string): NotificationMessage["kind"] | null {
  switch (value) {
    case "completion":
    case "failure":
    case "help":
    case "takeover":
      return value;
    default:
      return null;
  }
}

/** Open-app alert for a claimed intent. Fire-and-forget so push is never delayed. */
function publishIntentChatAlert(
  events: Pick<ThreadEvents, "publishChatAlert"> | undefined,
  intent: NotificationIntentRow,
  message: NotificationMessage,
  deliveryId: string,
) {
  void (async () =>
    events?.publishChatAlert?.(intent.userId, {
      kind: message.kind,
      ...(message.category ? { category: message.category } : {}),
      title: truncatePlainText(message.title, ALERT_MAX_CHARS),
      body: truncatePlainText(message.body, ALERT_MAX_CHARS),
      spaceId: intent.spaceId,
      botId: message.botId,
      threadId: message.threadId,
      ...(intent.groupId ? { groupId: intent.groupId } : {}),
      ...(message.runId ? { runId: message.runId } : {}),
      ...(message.messageId ? { messageId: message.messageId } : {}),
      deliveryId,
    }))().catch((error) => getLogger().error("chat alert publish", error));
}
