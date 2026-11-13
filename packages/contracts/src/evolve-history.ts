import * as z from "zod";
import { BOT_AVATAR_VALUE_MAX_LENGTH } from "./bot-avatar.js";

/**
 * Evolve chat history: each person's own conversations with Evolve's chat assistants, read live
 * from Evolve (conversations + messages tables) and never copied. Continuing one puts its
 * transcript in a bot's chat as an evolve_conversation block.
 */

const EvolveId = z.string().uuid();
const Timestamp = z.string().min(1).max(64);
const Name = z.string().max(2_000);

/** Characters of an old conversation carried into a bot's chat; the newest messages are kept. */
export const EVOLVE_CONVERSATION_TRANSCRIPT_MAX_CHARS = 60_000;
export const EVOLVE_CONVERSATION_MESSAGE_TEXT = "Continued an archived chat";
/** Characters kept from one message that added references (Evolve stores their full details). */
export const EVOLVE_REFERENCE_CONTEXT_MAX_CHARS = 6_000;

export const EvolveHistoryAssistantSchema = z.object({
  id: EvolveId,
  name: Name,
  /** Whether this person may still use the assistant, and so add it as a bot. */
  available: z.boolean(),
  conversations: z.number().int().nonnegative(),
  lastMessageAt: Timestamp.nullable(),
  /** The person's own bot started from this assistant, if they have one. */
  botId: z.string().min(1).max(64).nullable().default(null),
  /** The assistant's bot avatar: its bot's look, or a fixed one, shared by its archived chats. */
  look: z
    .object({
      /** The bot's stored avatar value, which may be an uploaded image. */
      color: z.string().min(1).max(BOT_AVATAR_VALUE_MAX_LENGTH),
      avatarSet: z.enum(["organic", "rakazo"]),
      /** Draw with this identity so the organic body matches. */
      identity: z.string().min(1).max(64),
    })
    .optional(),
});
export type EvolveHistoryAssistant = z.infer<typeof EvolveHistoryAssistantSchema>;

export const EvolveConversationSummarySchema = z.object({
  id: EvolveId,
  title: Name,
  assistantId: EvolveId,
  assistantName: Name,
  available: z.boolean(),
  createdAt: Timestamp,
  lastMessageAt: Timestamp,
  /** Files uploaded to the conversation. */
  files: z.number().int().nonnegative(),
  /** The person's bots whose chats this conversation was continued in. */
  continuedIn: z.array(z.string().min(1).max(64)).max(50).default([]),
});
export type EvolveConversationSummary = z.infer<typeof EvolveConversationSummarySchema>;

export const EvolveConversationPageSchema = z.object({
  conversations: z.array(EvolveConversationSummarySchema),
  page: z.number().int().nonnegative(),
  nextPage: z.number().int().nonnegative().nullable(),
});
export type EvolveConversationPage = z.infer<typeof EvolveConversationPageSchema>;

export const EvolveHistoryMessageSchema = z.object({
  id: z.string().min(1).max(64),
  role: z.enum(["user", "assistant"]),
  type: z.string().max(64),
  content: z.string(),
  createdAt: Timestamp,
  images: z.array(z.string().url().max(4_000)).default([]),
  files: z
    .array(
      z.object({
        name: Name,
        size: z.number().nullable().optional(),
        type: Name.nullable().optional(),
      }),
    )
    .default([]),
  references: z
    .object({
      projects: z.array(z.object({ name: Name, client: Name.nullable().optional() })).default([]),
      people: z.array(z.object({ name: Name, role: Name.nullable().optional() })).default([]),
      exemplars: z.array(z.object({ title: Name })).default([]),
    })
    .default({ projects: [], people: [], exemplars: [] }),
  /** The reply failed in Evolve. */
  error: z.boolean().optional(),
  /** Evolve started a reply but never saved its text. */
  unsaved: z.boolean().optional(),
});
export type EvolveHistoryMessage = z.infer<typeof EvolveHistoryMessageSchema>;

export const EvolveConversationDetailSchema = EvolveConversationSummarySchema.omit({
  files: true,
}).extend({
  files: z.array(Name),
  /** Its files sit in a vector store the bot can search after continuing. */
  searchable: z.boolean(),
});
export type EvolveConversationDetail = z.infer<typeof EvolveConversationDetailSchema>;

export const EvolveConversationMessagesSchema = z.object({
  conversation: EvolveConversationDetailSchema,
  messages: z.array(EvolveHistoryMessageSchema),
  /** Pass back as `before` for the next older page; null at the start of the conversation. */
  before: Timestamp.nullable(),
});
export type EvolveConversationMessages = z.infer<typeof EvolveConversationMessagesSchema>;

/** An old Evolve conversation continued in a bot's chat, kept on that message. */
export const EvolveConversationBlockSchema = z.object({
  conversationId: EvolveId,
  title: Name,
  assistantName: Name,
  lastMessageAt: Timestamp,
  messageCount: z.number().int().nonnegative(),
  files: z.array(Name).max(500).default([]),
  searchable: z.boolean(),
  /** Earlier messages left out to fit EVOLVE_CONVERSATION_TRANSCRIPT_MAX_CHARS. */
  omittedMessages: z.number().int().nonnegative().default(0),
  transcript: z.string().max(EVOLVE_CONVERSATION_TRANSCRIPT_MAX_CHARS + 2_000),
});
export type EvolveConversationBlock = z.infer<typeof EvolveConversationBlockSchema>;

/** One message as transcript text: who spoke, what they said, and what was attached. */
export function evolveHistoryMessageText(message: EvolveHistoryMessage): string {
  const speaker = message.role === "user" ? "User" : "Assistant";
  const notes: string[] = [];
  const { projects, people, exemplars } = message.references;
  if (projects.length) notes.push(`Reference projects: ${projects.map((p) => p.name).join("; ")}`);
  if (people.length) {
    notes.push(
      `Reference people: ${people.map((p) => (p.role ? `${p.name} (${p.role})` : p.name)).join("; ")}`,
    );
  }
  if (exemplars.length)
    notes.push(`Exemplar responses: ${exemplars.map((e) => e.title).join("; ")}`);
  if (message.files.length)
    notes.push(`Attached files: ${message.files.map((f) => f.name).join("; ")}`);
  if (message.images.length) notes.push(`Images: ${message.images.join(" ")}`);
  let body = message.content.trim() || (message.unsaved ? "(No reply was saved in Evolve.)" : "");
  if (message.type === "references" && body.length > EVOLVE_REFERENCE_CONTEXT_MAX_CHARS) {
    body = `${body.slice(0, EVOLVE_REFERENCE_CONTEXT_MAX_CHARS)}… (reference details trimmed)`;
  }
  return [`${speaker}: ${body}`, ...notes.map((note) => `[${note}]`)].join("\n");
}

/**
 * The conversation as transcript text, newest messages kept when it is longer than the budget,
 * with a count of the earlier ones left out.
 */
export function evolveConversationTranscript(
  messages: readonly EvolveHistoryMessage[],
  maxChars = EVOLVE_CONVERSATION_TRANSCRIPT_MAX_CHARS,
): { transcript: string; omittedMessages: number } {
  const kept: string[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = evolveHistoryMessageText(messages[index]!);
    const cost = text.length + 2;
    if (used + cost > maxChars) {
      if (kept.length > 0) return { transcript: kept.join("\n\n"), omittedMessages: index + 1 };
      return { transcript: `${text.slice(0, maxChars - 20)}… (cut short)`, omittedMessages: index };
    }
    kept.unshift(text);
    used += cost;
  }
  return { transcript: kept.join("\n\n"), omittedMessages: 0 };
}

/** What the model reads for a continued conversation. */
export function evolveConversationPromptText(block: EvolveConversationBlock): string {
  const lines = [
    `Continue from this earlier conversation the user had in Evolve chat with ${block.assistantName}: "${block.title}" (last active ${block.lastMessageAt.slice(0, 10)}, ${block.messageCount} messages). Treat it as this chat's history and pick up where it left off.`,
  ];
  if (block.files.length) lines.push(`Files uploaded to it: ${block.files.join("; ")}.`);
  if (block.searchable) {
    lines.push(
      `Search those files, and the user's own Evolve files, with evolve_knowledge_search and conversationId "${block.conversationId}".`,
    );
  }
  if (block.omittedMessages > 0) {
    lines.push(`The ${block.omittedMessages} earliest messages are left out for length.`);
  }
  lines.push("", "Transcript:", "", block.transcript);
  return lines.join("\n");
}
