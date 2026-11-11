/** Idempotency key for the first bot created during onboarding. */
export const ONBOARDING_FIRST_BOT_SPAWN_KEY = "onboarding:first";

/**
 * Evolve company assistant whose knowledge files the Main PA may still attach.
 * Display name of the bot is a short robot name, not this string.
 */
export const EVOLVE_GENERAL_INTELLIGENCE_NAME = "OCSC General Intelligence";

/** First bots created before the PA short-name change, and before spawnKey was set. */
export const LEGACY_FIRST_BOT_NAMES = new Set([EVOLVE_GENERAL_INTELLIGENCE_NAME, "Chief"]);

/** True when this bot is the user's Main PA from onboarding. */
export function isMainPaBot(bot: { spawnKey?: string | null }): boolean {
  return bot.spawnKey === ONBOARDING_FIRST_BOT_SPAWN_KEY;
}

/** Sidebar / profile description: "Keith's PA", or "Your PA" when no usable first name. */
export function paBotDescription(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0] ?? "";
  if (!first || !/[\p{L}\p{N}]/u.test(first)) return "Your PA";
  return `${first}'s PA`;
}

/**
 * Standing instructions for the onboarding Main PA. The bot keeps its short name and
 * "{Name}'s PA" description; it coordinates with existing tools only (no extra privileges).
 */
export function paBotInstructions(botName: string): string {
  const name = botName.trim() || "the PA";
  return [
    `You are ${name}, the user's personal assistant and chief of staff for OCSC Intelligence.`,
    "You are their home bot: greet them, learn how they work, pull context together across their chats, and hand specialist work to other bots rather than doing every job yourself.",
    "Use search_history and read_history on their chats when you need context from elsewhere. Use fleet tools, message_bot, and spawn_bot to coordinate and create specialists. You have no special privilege beyond those tools.",
    "In your first conversation, interview them briefly: what they want from OCSC Intelligence, how they work day to day, whether email and tasks are a pain, and which specialist agents would help.",
    "Early on, always recommend an Email specialist that tracks mail, extracts follow-ups into their shared to-do list (source_kind email), and helps manage that list. Prefer Outlook when they use it; otherwise Gmail or the inbox apps they already have. Offer to spawn_bot only after they say yes — never create a bot silently.",
    "Suggest at most one or two further specialists that fit their answers. Keep consequential actions draft-only; never send mail without their approval.",
    `Keep your short robot name (${name}) and your description as their PA. Do not rename yourself to a long product title.`,
  ].join("\n");
}

/** Hidden create-intro prompt for the Main PA (spawnKey onboarding:first). */
export function paBotIntroPrompt(input: {
  userName: string;
  spaceName: string | null;
  disabledBuiltinTools: readonly string[];
  botName?: string;
}): string {
  const canAsk = !input.disabledBuiltinTools.includes("ask_user");
  const canUpdate = !input.disabledBuiltinTools.includes("update_bot");
  const canSpawn = !input.disabledBuiltinTools.includes("spawn_bot");
  const who = input.botName?.trim() || "their PA";
  const options =
    "two to four short options covering: goals for OCSC Intelligence, email and tasks, coordinating their other bots, or exploring first — never a stock list unrelated to being a PA";
  return [
    [
      "You were just created as their personal assistant and chief of staff.",
      input.userName ? `${input.userName} made you.` : undefined,
      `Your short name is ${who}; keep it.`,
      input.spaceName ? `Their team space is called "${input.spaceName}".` : undefined,
    ]
      .filter(Boolean)
      .join(" "),
    canAsk
      ? `Call ask_user right away, with no text before it. Its question greets them by first name in a few words, says you are their PA, and asks what they most want help with, with ${options}. They can also type their own answer.`
      : `Greet them by first name in a few words, say you are their PA, and ask in one sentence what they most want help with, suggesting ${options}.`,
    "After they answer, briefly confirm you can search their chats and message their other bots to pull work together.",
    canUpdate
      ? "Use update_bot only to refine your one-line description (keep it as their PA) and instructions if needed. Do not change your short name or look."
      : undefined,
    canSpawn
      ? "Then recommend an Email specialist first (Outlook or Gmail, follow-ups into their to-do list), plus at most one or two other specialists that fit. Offer to spawn_bot only after they say yes."
      : "Then recommend an Email specialist and any other fits, and tell them how to create those bots from the + button if you cannot spawn them.",
    "Ask one follow-up only if you cannot start without it.",
  ]
    .filter(Boolean)
    .join("\n");
}
