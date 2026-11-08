import { ORPCError } from "@orpc/server";
import {
  deleteEvolveConversation,
  listEvolveConversations,
  listEvolveHistoryAssistants,
  readEvolveConversation,
  readWholeEvolveConversation,
  restoreEvolveConversation,
} from "@rakazo/adapters";
import type {
  EvolveConversationBlock,
  EvolveConversationMessages,
  EvolveHistoryMessage,
  MessageBlock,
} from "@rakazo/contracts";
import {
  BOT_NAME_MAX_LENGTH,
  EVOLVE_REFERENCE_CONTEXT_MAX_CHARS,
  evolveConversationTranscript,
} from "@rakazo/contracts";
import { BOT_AVATAR_COLORS, organicAvatarFamily, shippedHash } from "@rakazo/core";
import { createThreadMessageInTransaction } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { actorEmail, evolveAssistantFor } from "./bots.js";
import type { RouterContext } from "./context.js";

type Deps = Parameters<typeof actorEmail>[0];
type Actor = Parameters<typeof actorEmail>[1];

async function linkedEvolve(deps: Deps, actor: Actor) {
  const email = await actorEmail(deps, actor);
  if (!deps.evolvePlugins || !email) return null;
  return { connection: deps.evolvePlugins, email };
}

async function requiredEvolve(deps: Deps, actor: Actor) {
  const linked = await linkedEvolve(deps, actor);
  if (!linked)
    throw new ORPCError("BAD_REQUEST", { message: "Evolve is not linked to this server." });
  return linked;
}

function unreachable(error: unknown): never {
  if (error instanceof ORPCError) throw error;
  const status = (error as { status?: number } | null)?.status;
  if (status === 404) {
    throw new ORPCError("NOT_FOUND", {
      message: "That chat is not in your archive.",
    });
  }
  getLogger().warn("evolve history", { error: String(error) });
  throw new ORPCError("SERVICE_UNAVAILABLE", {
    message: "Your archived chats could not be reached. Try again shortly.",
  });
}

/**
 * The person's earlier Evolve conversation as a block for their bot's chat, read from Evolve as
 * them. Its files are offered to the bot's knowledge search only when the bot came from Evolve.
 */
export async function evolveConversationBlock(
  deps: Deps,
  actor: Actor,
  conversationId: string,
  botFromEvolve: boolean,
): Promise<EvolveConversationBlock> {
  const { connection, email } = await requiredEvolve(deps, actor);
  const { conversation, messages } = await readWholeEvolveConversation(
    connection,
    email,
    conversationId,
  ).catch(unreachable);
  const { transcript, omittedMessages } = evolveConversationTranscript(messages);
  return {
    conversationId: conversation.id,
    title: conversation.title,
    assistantName: conversation.assistantName,
    lastMessageAt: conversation.lastMessageAt,
    messageCount: messages.length,
    files: conversation.files.slice(0, 500),
    searchable: conversation.searchable && botFromEvolve,
    omittedMessages,
    transcript,
  };
}

/** Bots made by opening an archived chat; never an assistant's own bot. */
const NOT_ARCHIVED_CHAT = {
  OR: [{ spawnKey: null }, { NOT: { spawnKey: { startsWith: "evolve:" } } }],
};

type AssistantBot = { id: string; color: string; avatarSet: string | null };

/** An assistant's look: its own bot's avatar, or a fixed colour and body chosen from its id. */
export function assistantLook(assistantId: string, bot: AssistantBot | undefined) {
  if (bot) {
    return {
      color: bot.color,
      avatarSet: bot.avatarSet === "rakazo" ? ("rakazo" as const) : ("organic" as const),
      identity: bot.id,
    };
  }
  return {
    color: BOT_AVATAR_COLORS[shippedHash(assistantId) % BOT_AVATAR_COLORS.length]!,
    avatarSet: "organic" as const,
    identity: assistantId,
  };
}

/** Remembers that a conversation was continued in this bot's chat, so the archive can say so. */
export async function recordEvolveContinuation(
  deps: Deps,
  actor: Actor,
  conversationId: string,
  botId: string,
): Promise<void> {
  await deps.prisma.evolveConversationLink.upsert({
    where: {
      userId_conversationId_botId: { userId: actor.userId, conversationId, botId },
    },
    create: { userId: actor.userId, spaceId: actor.spaceId, conversationId, botId },
    update: {},
  });
}

/** The person's live bots in this space each conversation was continued in, oldest first. */
async function continuedBots(
  deps: Deps,
  actor: Actor,
  conversationIds: string[],
): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  if (conversationIds.length === 0) return found;
  const links = await deps.prisma.evolveConversationLink.findMany({
    where: {
      userId: actor.userId,
      spaceId: actor.spaceId,
      conversationId: { in: conversationIds },
      bot: { archivedAt: null, userId: actor.userId, spaceId: actor.spaceId },
    },
    select: { conversationId: true, botId: true },
    orderBy: { createdAt: "asc" },
  });
  for (const link of links) {
    found.set(link.conversationId, [...(found.get(link.conversationId) ?? []), link.botId]);
  }
  return found;
}

/** One archived message as the blocks of a chat message; null when nothing was saved. */
export function archivedMessageBlocks(message: EvolveHistoryMessage): MessageBlock[] | null {
  let text = message.content.trim();
  if (message.type === "references" && text.length > EVOLVE_REFERENCE_CONTEXT_MAX_CHARS) {
    text = `${text.slice(0, EVOLVE_REFERENCE_CONTEXT_MAX_CHARS)}\n… (reference details trimmed)`;
  }
  const extras: string[] = [];
  for (const url of message.images) extras.push(`![image](${url})`);
  if (message.files.length > 0) {
    extras.push(`Attached: ${message.files.map((file) => file.name).join(", ")}`);
  }
  const body = [text, ...extras].filter(Boolean).join("\n\n");
  return body ? [{ kind: "text", text: body }] : null;
}

function shortDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso.slice(0, 10)
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

const GENERIC_TITLES = new Set(["", "new conversation", "new chat", "untitled"]);

function archivedChatName(conversation: EvolveConversationMessages["conversation"]): string {
  const title = conversation.title.trim();
  const name = GENERIC_TITLES.has(title.toLowerCase())
    ? `${conversation.assistantName} · ${shortDay(conversation.lastMessageAt)}`
    : title;
  return name.slice(0, BOT_NAME_MAX_LENGTH);
}

/**
 * An archived chat as a chat of its own: a bot from the same assistant (its settings copied from
 * the person's existing bot for that assistant, if any) whose thread holds the old messages at
 * their original times. Opening it again returns the same chat.
 */
async function openArchivedChat(
  ctx: RouterContext,
  actor: Actor,
  conversationId: string,
): Promise<{ botId: string; created: boolean }> {
  const { deps, repos } = ctx;
  const linked = await deps.prisma.evolveConversationLink.findFirst({
    where: {
      userId: actor.userId,
      spaceId: actor.spaceId,
      conversationId,
      bot: { archivedAt: null, userId: actor.userId, spaceId: actor.spaceId },
    },
    select: { botId: true },
    orderBy: { createdAt: "asc" },
  });
  if (linked) return { botId: linked.botId, created: false };

  const { connection, email } = await requiredEvolve(deps, actor);
  const { conversation, messages } = await readWholeEvolveConversation(
    connection,
    email,
    conversationId,
  ).catch(unreachable);
  const spawnKey = `evolve:${conversation.id}`;
  const earlier = await deps.prisma.bot.findFirst({
    where: { spaceId: actor.spaceId, userId: actor.userId, spawnKey },
    select: { id: true, archivedAt: true },
  });
  if (earlier) {
    if (earlier.archivedAt) {
      await deps.prisma.bot.update({ where: { id: earlier.id }, data: { archivedAt: null } });
    }
    await recordEvolveContinuation(deps, actor, conversation.id, earlier.id);
    return { botId: earlier.id, created: false };
  }

  const template = await deps.prisma.bot.findFirst({
    where: {
      spaceId: actor.spaceId,
      userId: actor.userId,
      archivedAt: null,
      evolveAssistantId: conversation.assistantId,
      ...NOT_ARCHIVED_CHAT,
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      avatarSet: true,
      instructions: true,
      description: true,
      color: true,
      modelProvider: true,
      modelId: true,
      thinkingLevel: true,
      disabledBuiltinTools: true,
    },
  });
  const assistant = template
    ? null
    : await evolveAssistantFor(deps, actor, conversation.assistantId).catch(() => null);
  const keepsAssistant = Boolean(template || assistant);
  const look = assistantLook(conversation.assistantId, template ?? undefined);

  const bot = await repos.createBot(actor, {
    name: archivedChatName(conversation),
    description: (template?.description ?? assistant?.description ?? "").slice(0, 500),
    instructions: template?.instructions ?? assistant?.instructions ?? "",
    notifyOnFinish: true,
    color: look.color,
    avatarSet: look.avatarSet,
    avatarFamily: organicAvatarFamily(look.identity),
    modelProvider: template?.modelProvider ?? null,
    modelId: template?.modelId ?? null,
    thinkingLevel: template?.thinkingLevel ?? null,
    disabledBuiltinTools: template?.disabledBuiltinTools,
    evolveAssistantId: keepsAssistant ? conversation.assistantId : null,
    spawnKey,
    initialMessage: {
      role: "system",
      blocks: [
        {
          kind: "meta",
          text: `Archived chat with ${conversation.assistantName}, started ${conversation.createdAt.slice(0, 10)}`,
        },
      ],
    },
    seed: async (tx, botId) => {
      const thread = await tx.thread.findUniqueOrThrow({
        where: { botId },
        select: { id: true },
      });
      for (const message of messages) {
        const blocks = archivedMessageBlocks(message);
        if (!blocks) continue;
        const createdAt = new Date(message.createdAt);
        await createThreadMessageInTransaction(tx, {
          threadId: thread.id,
          role: message.role === "user" ? "user" : "bot",
          botId: message.role === "user" ? undefined : botId,
          blocks,
          markUnread: false,
          createdAt: Number.isNaN(createdAt.getTime()) ? undefined : createdAt,
        });
      }
      const { nextMessageSeq } = await tx.thread.findUniqueOrThrow({
        where: { id: thread.id },
        select: { nextMessageSeq: true },
      });
      await tx.thread.update({
        where: { id: thread.id },
        data: { unread: false, lastReadSeq: nextMessageSeq - 1 },
      });
      await tx.evolveConversationLink.create({
        data: {
          userId: actor.userId,
          spaceId: actor.spaceId,
          conversationId: conversation.id,
          botId,
        },
      });
    },
  });
  return { botId: bot.id, created: true };
}

/** The signed-in person's Evolve chats. The sidebar lists archived ones and can restore or delete them. */
export function evolveHistoryRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  return {
    evolveHistory: {
      open: authed.evolveHistory.open.handler(({ context, input }) =>
        openArchivedChat(ctx, context.actor, input.conversationId),
      ),
      assistants: authed.evolveHistory.assistants.handler(async ({ context }) => {
        const linked = await linkedEvolve(deps, context.actor);
        if (!linked) return { available: false, assistants: [], continued: 0 };
        const assistants = await listEvolveHistoryAssistants(linked.connection, linked.email, {
          signal: context.signal,
        }).catch(unreachable);
        const bots = await deps.prisma.bot.findMany({
          where: {
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            archivedAt: null,
            evolveAssistantId: { in: assistants.map((assistant) => assistant.id) },
            ...NOT_ARCHIVED_CHAT,
          },
          select: { id: true, evolveAssistantId: true, color: true, avatarSet: true },
          orderBy: { createdAt: "asc" },
        });
        const botFor = new Map<string, AssistantBot>();
        for (const bot of bots) {
          if (bot.evolveAssistantId && !botFor.has(bot.evolveAssistantId)) {
            botFor.set(bot.evolveAssistantId, bot);
          }
        }
        const continued = await deps.prisma.evolveConversationLink.findMany({
          where: {
            userId: context.actor.userId,
            spaceId: context.actor.spaceId,
            bot: { archivedAt: null },
          },
          distinct: ["conversationId"],
          select: { conversationId: true },
        });
        return {
          available: true,
          continued: continued.length,
          assistants: assistants.map((assistant) => ({
            ...assistant,
            botId: botFor.get(assistant.id)?.id ?? null,
            look: assistantLook(assistant.id, botFor.get(assistant.id)),
          })),
        };
      }),
      conversations: authed.evolveHistory.conversations.handler(async ({ context, input }) => {
        const { connection, email } = await requiredEvolve(deps, context.actor);
        const page = await listEvolveConversations(connection, email, input, {
          signal: context.signal,
        }).catch(unreachable);
        const continuedIn = await continuedBots(
          deps,
          context.actor,
          page.conversations.map((conversation) => conversation.id),
        );
        return {
          ...page,
          conversations: page.conversations.map((conversation) => ({
            ...conversation,
            continuedIn: continuedIn.get(conversation.id) ?? [],
          })),
        };
      }),
      restore: authed.evolveHistory.restore.handler(async ({ context, input }) => {
        const { connection, email } = await requiredEvolve(deps, context.actor);
        await restoreEvolveConversation(connection, email, input.conversationId, {
          signal: context.signal,
        }).catch(unreachable);
        return { ok: true as const };
      }),
      remove: authed.evolveHistory.remove.handler(async ({ context, input }) => {
        const { connection, email } = await requiredEvolve(deps, context.actor);
        await deleteEvolveConversation(connection, email, input.conversationId, {
          signal: context.signal,
        }).catch(unreachable);
        await deps.prisma.evolveConversationLink.deleteMany({
          where: { userId: context.actor.userId, conversationId: input.conversationId },
        });
        return { ok: true as const };
      }),
      messages: authed.evolveHistory.messages.handler(async ({ context, input }) => {
        const { connection, email } = await requiredEvolve(deps, context.actor);
        const result = await readEvolveConversation(connection, email, input, {
          signal: context.signal,
        }).catch(unreachable);
        const continuedIn = await continuedBots(deps, context.actor, [result.conversation.id]);
        return {
          ...result,
          conversation: {
            ...result.conversation,
            continuedIn: continuedIn.get(result.conversation.id) ?? [],
          },
        };
      }),
    },
  };
}
