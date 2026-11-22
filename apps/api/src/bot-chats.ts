import { ORPCError } from "@orpc/server";
import { runJobKey } from "@rakazo/adapter-kit";
import type { Actor, BotChatSummary, MessageBlock } from "@rakazo/contracts";
import {
  ACTIVE_RUN_STATUSES,
  BACKGROUND_RUN_TRIGGERS,
  isBackgroundRunTrigger,
  userVisibleMessages,
} from "@rakazo/core";
import type { Prisma, PrismaClient } from "@rakazo/db";
import {
  cancelRunsInTransaction,
  expireComputerExecutionLeases,
  IsolationError,
  previewFromBlocks,
  primaryActiveRun,
  threadRunStatus,
} from "@rakazo/db";
import type { RouterDeps } from "./router.js";

const MAX_CHAT_TITLE_LENGTH = 120;
const AUTO_TITLE_MAX_LENGTH = 60;
const PREVIEW_WINDOW = 10;

/** Derives a short, clean conversation title from the first user message in an untitled extra chat. */
export function deriveChatTitleFromText(rawText: string | undefined): string | null {
  if (!rawText) return null;
  const firstLine = rawText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^[#>*\-\s]+/, "").trim())
    .find(Boolean);
  if (!firstLine) return null;
  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  if (collapsed.length <= AUTO_TITLE_MAX_LENGTH) return collapsed;
  const sliced = collapsed.slice(0, AUTO_TITLE_MAX_LENGTH);
  const lastSpace = sliced.lastIndexOf(" ");
  const clipped =
    lastSpace >= Math.floor(AUTO_TITLE_MAX_LENGTH * 0.5) ? sliced.slice(0, lastSpace) : sliced;
  return `${clipped.trimEnd()}…`;
}

function normalizeChatTitle(title: string | undefined): string | null {
  const trimmed = title?.trim().slice(0, MAX_CHAT_TITLE_LENGTH) ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function runErrorIdForThread(
  latestTerminal: { id: string; status: string } | undefined,
  activeRun: { status: string } | undefined,
): string | null {
  if (
    latestTerminal?.status !== "failed" ||
    activeRun?.status === "waiting_input" ||
    activeRun?.status === "waiting_takeover"
  ) {
    return null;
  }
  return latestTerminal.id;
}

async function requireOwnedBot(prisma: PrismaClient, actor: Actor, botId: string) {
  const bot = await prisma.bot.findFirst({
    where: {
      id: botId,
      spaceId: actor.spaceId,
      userId: actor.userId,
      archivedAt: null,
    },
    select: {
      id: true,
      spaceId: true,
      userId: true,
      updatedAt: true,
      thread: {
        select: {
          id: true,
          botId: true,
          chatBotId: true,
          title: true,
          unread: true,
          nextMessageSeq: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });
  if (!bot?.thread) throw new IsolationError();
  return { ...bot, thread: bot.thread };
}

async function buildChatSummaries(
  prisma: PrismaClient,
  botId: string,
  threads: Array<{
    id: string;
    botId: string | null;
    chatBotId: string | null;
    title: string | null;
    unread: boolean;
    nextMessageSeq: number;
    createdAt: Date;
    updatedAt: Date;
  }>,
): Promise<BotChatSummary[]> {
  if (threads.length === 0) return [];
  const threadIds = threads.map((thread) => thread.id);
  const [recentMessages, activeRuns, latestRuns] = await Promise.all([
    prisma.message.findMany({
      where: { threadId: { in: threadIds } },
      orderBy: [{ seq: "desc" }],
      take: Math.max(threadIds.length * PREVIEW_WINDOW, 40),
      select: {
        id: true,
        threadId: true,
        seq: true,
        role: true,
        botId: true,
        runId: true,
        blocks: true,
        createdAt: true,
      },
    }),
    prisma.run.findMany({
      where: {
        botId,
        threadId: { in: threadIds },
        status: { in: [...ACTIVE_RUN_STATUSES] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, threadId: true, status: true, trigger: true },
    }),
    prisma.run.findMany({
      where: {
        botId,
        threadId: { in: threadIds },
        trigger: { notIn: [...BACKGROUND_RUN_TRIGGERS] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      distinct: ["threadId"],
      select: { id: true, threadId: true, status: true },
    }),
  ]);

  const candidateRunIds = [...new Set(recentMessages.flatMap((m) => (m.runId ? [m.runId] : [])))];
  const specialRuns =
    candidateRunIds.length > 0
      ? await prisma.run.findMany({
          where: {
            id: { in: candidateRunIds },
            trigger: { in: ["bot_message", ...BACKGROUND_RUN_TRIGGERS] },
          },
          select: { id: true, trigger: true },
        })
      : [];
  const peerRunIds = new Set<string>();
  const backgroundRunIds = new Set<string>();
  for (const row of specialRuns) {
    if (isBackgroundRunTrigger(row.trigger)) backgroundRunIds.add(row.id);
    else peerRunIds.add(row.id);
  }

  const messagesByThread = new Map<string, typeof recentMessages>();
  for (const message of recentMessages) {
    const list = messagesByThread.get(message.threadId) ?? [];
    if (list.length < PREVIEW_WINDOW) list.push(message);
    messagesByThread.set(message.threadId, list);
  }
  const latestRunByThread = new Map(latestRuns.map((run) => [run.threadId, run]));

  return threads.map((thread) => {
    const messages = messagesByThread.get(thread.id) ?? [];
    const visible = userVisibleMessages(
      messages.map((message) => ({
        ...message,
        blocks: message.blocks as MessageBlock[],
        runId: message.runId ?? undefined,
      })),
      {
        knownPeerRunIds: peerRunIds,
        backgroundRunIds,
        includeDelegatedReplyText: false,
      },
    );
    let preview = "";
    for (const message of visible) {
      preview = previewFromBlocks(message.blocks);
      if (preview) break;
    }
    const threadActiveRuns = activeRuns.filter((run) => run.threadId === thread.id);
    const activeRun = primaryActiveRun(threadActiveRuns);
    const status = threadRunStatus(threadActiveRuns, thread.id);
    const runErrorId = runErrorIdForThread(latestRunByThread.get(thread.id), activeRun);
    const newestCreatedAt = messages[0]?.createdAt ?? thread.updatedAt ?? thread.createdAt;
    return {
      id: thread.id,
      botId,
      title: thread.title?.trim() ?? "",
      isPrimary: thread.botId === botId,
      preview,
      unread: thread.unread,
      status,
      runErrorId,
      messageCount: thread.nextMessageSeq,
      createdAt: thread.createdAt.toISOString(),
      updatedAt: newestCreatedAt.toISOString(),
    };
  });
}

/** Lists the agent's primary conversation first, followed by additional conversations newest-active first. */
export async function listBotChats(
  prisma: PrismaClient,
  actor: Actor,
  botId: string,
): Promise<BotChatSummary[]> {
  const bot = await requireOwnedBot(prisma, actor, botId);
  const extraThreads = await prisma.thread.findMany({
    where: {
      spaceId: actor.spaceId,
      userId: actor.userId,
      chatBotId: bot.id,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      botId: true,
      chatBotId: true,
      title: true,
      unread: true,
      nextMessageSeq: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const summaries = await buildChatSummaries(prisma, bot.id, [bot.thread, ...extraThreads]);
  const primary = summaries.find((item) => item.isPrimary);
  const extras = summaries
    .filter((item) => !item.isPrimary)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return primary ? [primary, ...extras] : extras;
}

/** Creates a brand-new blank conversation under an agent. */
export async function createBotChat(
  prisma: PrismaClient,
  actor: Actor,
  botId: string,
  title?: string,
): Promise<BotChatSummary> {
  const bot = await requireOwnedBot(prisma, actor, botId);
  const now = new Date();
  const created = await prisma.thread.create({
    data: {
      spaceId: bot.spaceId,
      userId: bot.userId,
      chatBotId: bot.id,
      title: normalizeChatTitle(title),
      updatedAt: now,
    },
    select: {
      id: true,
      title: true,
      unread: true,
      nextMessageSeq: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return {
    id: created.id,
    botId: bot.id,
    title: created.title ?? "",
    isPrimary: false,
    preview: "",
    unread: created.unread,
    status: "idle",
    runErrorId: null,
    messageCount: created.nextMessageSeq,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
}

/** Renames any conversation (main or additional) belonging to the agent. */
export async function renameBotChat(
  prisma: PrismaClient,
  actor: Actor,
  botId: string,
  threadId: string,
  title: string,
): Promise<BotChatSummary> {
  const bot = await requireOwnedBot(prisma, actor, botId);
  const target = await prisma.thread.findFirst({
    where: {
      id: threadId,
      spaceId: actor.spaceId,
      userId: actor.userId,
      OR: [{ botId: bot.id }, { chatBotId: bot.id }],
    },
    select: { id: true },
  });
  if (!target) throw new IsolationError();
  const updated = await prisma.thread.update({
    where: { id: target.id },
    data: { title: normalizeChatTitle(title) },
    select: {
      id: true,
      botId: true,
      chatBotId: true,
      title: true,
      unread: true,
      nextMessageSeq: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const [summary] = await buildChatSummaries(prisma, bot.id, [updated]);
  if (!summary) throw new IsolationError();
  return summary;
}

/** Deletes an additional conversation under an agent. Never deletes the primary conversation. */
export async function deleteBotChat(
  deps: Pick<RouterDeps, "prisma" | "jobs">,
  actor: Actor,
  botId: string,
  threadId: string,
): Promise<void> {
  const bot = await requireOwnedBot(deps.prisma, actor, botId);
  if (bot.thread.id === threadId) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The main conversation cannot be deleted. You can clear it instead.",
    });
  }
  const cancelledRunIds = await deps.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const thread = await tx.thread.findFirst({
      where: {
        id: threadId,
        spaceId: actor.spaceId,
        userId: actor.userId,
        chatBotId: bot.id,
      },
      select: { id: true },
    });
    if (!thread) throw new IsolationError();
    const now = new Date();
    const activeRuns = await tx.run.findMany({
      where: {
        spaceId: actor.spaceId,
        threadId: thread.id,
        status: { in: [...ACTIVE_RUN_STATUSES] },
      },
      select: { id: true, taskId: true, userId: true, spaceId: true },
    });
    const runIds = (await cancelRunsInTransaction(tx, activeRuns, now)).map((run) => run.id);
    if (runIds.length > 0) {
      await expireComputerExecutionLeases(tx, { runId: { in: runIds } });
    }
    const retiredIndex = `${thread.id}:deleted:${now.getTime()}`;
    await tx.chatFileIndex.updateMany({
      where: { threadId: thread.id },
      data: { threadId: retiredIndex },
    });
    await tx.chatFileIndexEntry.updateMany({
      where: { threadId: thread.id },
      data: { threadId: retiredIndex },
    });
    await tx.conversationDeletion.createMany({
      data: [{ spaceId: bot.spaceId, userId: bot.userId, threadId: thread.id }],
      skipDuplicates: true,
    });
    await tx.thread.delete({ where: { id: thread.id } });
    return runIds;
  });
  if (cancelledRunIds.length > 0) {
    await Promise.allSettled(cancelledRunIds.map((runId) => deps.jobs.cancel(runJobKey(runId))));
  }
}
