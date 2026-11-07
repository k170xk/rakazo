import { ORPCError } from "@orpc/server";
import {
  listEvolveConversations,
  listEvolveHistoryAssistants,
  readEvolveConversation,
  readWholeEvolveConversation,
} from "@rakazo/adapters";
import type { EvolveConversationBlock } from "@rakazo/contracts";
import { evolveConversationTranscript } from "@rakazo/contracts";
import { getLogger } from "@rakazo/logging";
import { actorEmail } from "./bots.js";
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
      message: "That conversation is not in your Evolve history.",
    });
  }
  getLogger().warn("evolve history", { error: String(error) });
  throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Evolve could not be reached." });
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

/** Read-only Evolve chat history; each call is made as the signed-in person's Evolve profile. */
export function evolveHistoryRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  return {
    evolveHistory: {
      assistants: authed.evolveHistory.assistants.handler(async ({ context }) => {
        const linked = await linkedEvolve(deps, context.actor);
        if (!linked) return { available: false, assistants: [] };
        const assistants = await listEvolveHistoryAssistants(linked.connection, linked.email, {
          signal: context.signal,
        }).catch(unreachable);
        const bots = await deps.prisma.bot.findMany({
          where: {
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            archivedAt: null,
            evolveAssistantId: { in: assistants.map((assistant) => assistant.id) },
          },
          select: { id: true, evolveAssistantId: true },
          orderBy: { createdAt: "asc" },
        });
        const botFor = new Map<string, string>();
        for (const bot of bots) {
          if (bot.evolveAssistantId && !botFor.has(bot.evolveAssistantId)) {
            botFor.set(bot.evolveAssistantId, bot.id);
          }
        }
        return {
          available: true,
          assistants: assistants.map((assistant) => ({
            ...assistant,
            botId: botFor.get(assistant.id) ?? null,
          })),
        };
      }),
      conversations: authed.evolveHistory.conversations.handler(async ({ context, input }) => {
        const { connection, email } = await requiredEvolve(deps, context.actor);
        return listEvolveConversations(connection, email, input, {
          signal: context.signal,
        }).catch(unreachable);
      }),
      messages: authed.evolveHistory.messages.handler(async ({ context, input }) => {
        const { connection, email } = await requiredEvolve(deps, context.actor);
        return readEvolveConversation(connection, email, input, {
          signal: context.signal,
        }).catch(unreachable);
      }),
    },
  };
}
