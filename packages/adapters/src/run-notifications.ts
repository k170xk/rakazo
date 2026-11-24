import type { NotificationMessage } from "@rakazo/adapter-kit";
import { notificationDeliverJob } from "@rakazo/adapter-kit";
import type { MessageBlock } from "@rakazo/contracts";
import {
  isBackgroundRunTrigger,
  plainTextFromMarkdown,
  redactSecrets,
  truncatedPlainText,
  truncatePlainText,
} from "@rakazo/core";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";
import {
  notificationCategoryFromKind,
  notificationSourceEventKey,
  upsertNotificationIntent,
} from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import type { ExecutorDeps } from "./executor-deps.js";
import { deliverNotificationIntents } from "./notification-delivery.js";

const COMPLETION_NOTIFICATION_MAX_CHARS = 180;

export async function runNotificationsEnabled(
  prisma: PrismaClient,
  run: { spaceId: string; userId: string; botId: string; threadId: string },
): Promise<boolean> {
  return (await runNotice(prisma, run)).enabled;
}

async function runNotice(
  prisma: PrismaClient,
  run: { spaceId: string; userId: string; botId: string; threadId: string },
  routineId?: string | null,
): Promise<{
  enabled: boolean;
  groupId: string | null;
  bot?: { id: string; name: string; color: string; avatarSet: string; notifyOnFinish: boolean };
}> {
  // A routine carries its own notify setting, which decides on its failures.
  const routine = routineId
    ? await prisma.routine.findUnique({ where: { id: routineId }, select: { notify: true } })
    : null;
  const source = await prisma.run.findFirst({
    where: {
      botId: run.botId,
      threadId: run.threadId,
      spaceId: run.spaceId,
      userId: run.userId,
    },
    select: {
      bot: { select: { id: true, name: true, color: true, avatarSet: true, notifyOnFinish: true } },
      thread: { select: { groupId: true } },
    },
  });
  if (!source) return { enabled: false, groupId: null };
  return {
    enabled: routine ? routine.notify : Boolean(source.thread.groupId || source.bot.notifyOnFinish),
    groupId: source.thread.groupId,
    bot: source.bot,
  };
}

/** Whether this kind may create an intent before preference/channel checks. */
function intentEligible(
  kind: NotificationMessage["kind"],
  notice: { enabled: boolean },
  routineId?: string | null,
): boolean {
  const category = notificationCategoryFromKind(kind);
  switch (category) {
    case "updates":
      return notice.enabled;
    case "action_needed":
      return true;
    case "problems":
      // Routine failures still honour the routine's notify flag.
      return routineId ? notice.enabled : true;
    default: {
      const _exhaustive: never = category;
      return _exhaustive;
    }
  }
}

/**
 * Lock-screen-safe title and body. Never includes question text or markdown
 * previews — only the bot name and the kind of attention needed.
 */
export function safeNotificationCopy(
  kind: NotificationMessage["kind"],
  botName: string,
  options: { approval?: boolean } = {},
): { title: string; body: string } {
  const name = botName.trim() || "Agent";
  switch (kind) {
    case "help":
      if (options.approval) {
        return { title: `${name} needs approval`, body: "Approval needed" };
      }
      return { title: `${name} has a question`, body: "Question waiting" };
    case "takeover":
      return { title: `${name} needs you`, body: "Something needs attention" };
    case "completion":
      return { title: `${name} finished`, body: "Work completed" };
    case "failure":
      return { title: `${name} needs attention`, body: "Something needs attention" };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function looksLikeApproval(title: string): boolean {
  return /\bapproval\b/i.test(title);
}

export async function notifyRun(
  deps: ExecutorDeps,
  run: {
    spaceId: string;
    userId: string;
    botId: string;
    threadId: string;
    trigger: string;
    routineId?: string | null;
  },
  message: NotificationMessage,
  options: { retryOnFailure?: boolean } = {},
) {
  if (
    (!deps.notifications && !deps.events.publishChatAlert) ||
    (isBackgroundRunTrigger(run.trigger) && message.kind !== "help" && message.kind !== "takeover")
  )
    return;

  const routineId = message.kind === "failure" ? run.routineId : null;
  const notice = await runNotice(deps.prisma, run, routineId).catch((error) => {
    if (options.retryOnFailure) throw error;
    getLogger().error("notification preference lookup", error);
    return null;
  });
  if (!notice?.bot) return;
  if (!intentEligible(message.kind, notice, routineId)) return;

  const category = notificationCategoryFromKind(message.kind);
  const copy = safeNotificationCopy(message.kind, notice.bot.name, {
    approval: looksLikeApproval(message.title),
  });
  const runId = message.runId;
  if (!runId) {
    getLogger().error("notification intent missing runId", {
      kind: message.kind,
      botId: message.botId,
    });
    return;
  }
  const sourceEventKey = notificationSourceEventKey({
    kind: message.kind,
    runId,
    messageId: message.messageId,
  });

  let intentId: string;
  try {
    const upserted = await upsertNotificationIntent(deps.prisma, {
      spaceId: run.spaceId,
      userId: run.userId,
      botId: run.botId,
      threadId: run.threadId,
      groupId: notice.groupId,
      runId,
      messageId: message.messageId ?? null,
      sourceEventKey,
      kind: message.kind,
      category,
      title: copy.title,
      body: copy.body,
    });
    intentId = upserted.id;
  } catch (error) {
    if (options.retryOnFailure) throw error;
    getLogger().error("notification intent upsert", error);
    return;
  }

  const workerId = "notify-run";
  if (deps.jobs) {
    await deps.jobs.enqueue(notificationDeliverJob(intentId)).catch(async (error) => {
      getLogger().error("notification.deliver enqueue", error);
      // Fall back to an immediate attempt so a queue blip does not lose the alert.
      await deliverNotificationIntents(
        {
          prisma: deps.prisma,
          events: deps.events,
          ...(deps.notifications ? { notifications: deps.notifications } : {}),
          jobs: deps.jobs,
        },
        { intentId, workerId },
      ).catch((deliverError) => getLogger().error("notification intent deliver", deliverError));
    });
    return;
  }

  // Tests and legacy callers without a job queue deliver once inline.
  await deliverNotificationIntents(
    {
      prisma: deps.prisma,
      events: deps.events,
      ...(deps.notifications ? { notifications: deps.notifications } : {}),
    },
    { intentId, workerId },
  ).catch((error) => {
    if (options.retryOnFailure) throw error;
    getLogger().error("notification intent deliver", error);
  });
}

/** Open apps alert from the same message. Not awaited, so it never holds up the push. */
export function publishChatAlert(
  events: Pick<ThreadEvents, "publishChatAlert"> | undefined,
  run: { spaceId: string; userId: string },
  message: NotificationMessage,
  groupId: string | null,
  deliveryId?: string,
) {
  void (async () =>
    events?.publishChatAlert?.(run.userId, {
      kind: message.kind,
      ...(message.category ? { category: message.category } : {}),
      title: truncatePlainText(message.title, COMPLETION_NOTIFICATION_MAX_CHARS),
      body: truncatePlainText(message.body, COMPLETION_NOTIFICATION_MAX_CHARS),
      spaceId: run.spaceId,
      botId: message.botId,
      threadId: message.threadId,
      ...(groupId ? { groupId } : {}),
      ...(message.runId ? { runId: message.runId } : {}),
      ...(message.messageId ? { messageId: message.messageId } : {}),
      ...(deliveryId ? { deliveryId } : {}),
    }))().catch((error) => getLogger().error("chat alert publish", error));
}

export function runSendsFinishNotification(trigger: string): boolean {
  return trigger !== "created" && !isBackgroundRunTrigger(trigger);
}

/** User-facing text for completion notifications; empty when only tool/step activity remains. */
export function completionNotificationBody(assembled: string, blocks: MessageBlock[]): string {
  if (assembled) return assembled;
  return blocks
    .filter((block): block is Extract<MessageBlock, { kind: "text" }> => block.kind === "text")
    .map((block) => block.text)
    .join("");
}

/** Push body: Markdown stripped, then truncated so a cut cannot land inside a marker. */
export function completionNotificationPreview(text: string): string {
  return truncatedPlainText(text, COMPLETION_NOTIFICATION_MAX_CHARS);
}

/** A secret card can ask for a code or a login, so the title stays generic and the label short. */
export function secretAskNotification(botName: string, label: string, runSecrets: string[]) {
  // Strip and redact before shortening so no protected value is left half-shown.
  const text = plainTextFromMarkdown(redactSecrets(label, runSecrets), { maxSource: Infinity });
  const body = truncatePlainText(
    redactSecrets(text, runSecrets),
    COMPLETION_NOTIFICATION_MAX_CHARS,
  );
  return { title: `${botName} needs an answer`, body };
}

export function completionMarksUnread(
  trigger: string,
  text: string,
  userFacingPeerReply = false,
): boolean {
  if (trigger === "bot_message") return userFacingPeerReply;
  if (isBackgroundRunTrigger(trigger)) return false;
  return (trigger !== "routine" && trigger !== "reaction") || Boolean(text);
}

export function subagentMarksUnread(
  trigger: string,
  status: "running" | "completed" | "failed",
  userFacingPeerReply = false,
) {
  if (isBackgroundRunTrigger(trigger)) return false;
  return (
    status === "failed" ||
    (trigger === "bot_message" && userFacingPeerReply) ||
    (trigger !== "routine" && trigger !== "bot_message")
  );
}
