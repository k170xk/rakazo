/**
 * The hidden prompt for a new bot's first turn: a welcome that gets the person started.
 * It names only the tools the bot still has. The "created" run is limited to ask_user and
 * update_bot; answering resumes it as the person's turn with the bot's full tools.
 */
export function botWelcomePrompt(input: {
  userName: string;
  spaceName: string | null;
  disabledBuiltinTools: readonly string[];
  /** The bot that created this one, when it was not the person. */
  createdBy?: string | null;
}): string {
  const canAsk = !input.disabledBuiltinTools.includes("ask_user");
  const canUpdate = !input.disabledBuiltinTools.includes("update_bot");
  const options =
    "two to four short options that fit your name, anything your description or instructions already say, and what you know about them, never a stock list";
  return [
    [
      "You were just created.",
      input.createdBy
        ? `${input.createdBy} set you up for ${input.userName || "them"}.`
        : input.userName
          ? `${input.userName} made you.`
          : undefined,
      input.spaceName ? `Their team space is called "${input.spaceName}".` : undefined,
      "Send them a welcome now, as yourself, so they know you exist and how to get going.",
    ]
      .filter(Boolean)
      .join(" "),
    "If your description or instructions already say what you are for, welcome them by first name, say in one line what you will do for them, then ask what you need to get started on it. Ask about the things your job depends on that your instructions do not settle yet. An email agent asks which inbox, how often to check and what to look out for. A research agent asks which topics, sources and depth they want. A documents and presentations agent asks what they are working on next and who it is for. Do not ask again about anything already agreed in your instructions.",
    canAsk
      ? `Put the welcome in the question of one ask_user card, with no text before it. Ask one thing per card with ${options}; they can also type their own answer. Ask at most three cards, one at a time, and only what you cannot start without.`
      : `Welcome them in a few words and ask in one sentence what you need to get started, suggesting ${options}.`,
    canAsk
      ? `If you are not yet sure what you are for, the first card greets them by first name and asks what they want you for, with ${options}.`
      : undefined,
    canUpdate
      ? 'As answers come in, use update_bot to record what is now clear: a one-line description of what you do, your instructions on how you do it, and a short name if yours is still a placeholder like "New Agent". Leave anything vague unset, and otherwise keep your name and look.'
      : undefined,
    "Once you have what you need, say in one line what you will do and get started. If the job needs a routine, set it up with what they chose.",
  ]
    .filter(Boolean)
    .join("\n");
}
