import type {
  EvolveConversationMessages,
  EvolveConversationPage,
  EvolveHistoryAssistant,
  EvolveHistoryMessage,
} from "@rakazo/contracts";
import {
  EvolveConversationMessagesSchema,
  EvolveConversationPageSchema,
  EvolveHistoryAssistantSchema,
} from "@rakazo/contracts";
import { z } from "zod";
import type { EvolvePluginsConnection } from "./evolve-plugins.js";
import { callEvolveAssistants } from "./evolve-plugins.js";

type CallOptions = { signal?: AbortSignal; fetch?: typeof fetch };

/** Pages of 200 read when continuing a conversation; 10,000 messages at most. */
const MAX_CONTINUE_PAGES = 50;

/** Assistants the person has Evolve conversations with, most recently used first. */
export async function listEvolveHistoryAssistants(
  connection: EvolvePluginsConnection,
  email: string,
  options: CallOptions = {},
): Promise<EvolveHistoryAssistant[]> {
  const payload = await callEvolveAssistants(
    connection,
    email,
    { action: "conversations.assistants" },
    options,
  );
  return z.object({ assistants: z.array(EvolveHistoryAssistantSchema) }).parse(payload).assistants;
}

/** One page (30) of the person's own conversations, newest first. */
export async function listEvolveConversations(
  connection: EvolvePluginsConnection,
  email: string,
  input: { assistantId?: string; search: string; page: number },
  options: CallOptions = {},
): Promise<EvolveConversationPage> {
  const payload = await callEvolveAssistants(
    connection,
    email,
    { action: "conversations.list", ...input },
    options,
  );
  return EvolveConversationPageSchema.parse(payload);
}

/** Messages of one of the person's conversations, oldest first, older pages via `before`. */
export async function readEvolveConversation(
  connection: EvolvePluginsConnection,
  email: string,
  input: { conversationId: string; before?: string; limit?: number },
  options: CallOptions = {},
): Promise<EvolveConversationMessages> {
  const payload = await callEvolveAssistants(
    connection,
    email,
    { action: "conversations.messages", ...input },
    options,
  );
  return EvolveConversationMessagesSchema.parse(payload);
}

/** The whole conversation, oldest message first, for carrying it into a bot's chat. */
export async function readWholeEvolveConversation(
  connection: EvolvePluginsConnection,
  email: string,
  conversationId: string,
  options: CallOptions = {},
): Promise<EvolveConversationMessages> {
  let before: string | undefined;
  let messages: EvolveHistoryMessage[] = [];
  let first: EvolveConversationMessages | undefined;
  for (let page = 0; page < MAX_CONTINUE_PAGES; page += 1) {
    const result = await readEvolveConversation(
      connection,
      email,
      { conversationId, before, limit: 200 },
      options,
    );
    first ??= result;
    messages = [...result.messages, ...messages];
    if (!result.before) break;
    before = result.before;
  }
  return { conversation: first!.conversation, messages, before: null };
}
