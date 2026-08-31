import type { ThreadMessage } from "@rakazo/contracts";

/** Plain message text for clipboard copy — text/ask/progress only, no chrome. */
export function copyableMessageText(message: ThreadMessage): string {
  return message.blocks
    .map((block) => {
      if (block.kind === "phone_channel_message") {
        return `iMessage · ${block.fromLabel}: ${block.text}`;
      }
      if (block.kind === "bot_message_sent") {
        return `To ${block.toBotName}: ${block.text}`;
      }
      if (block.kind === "bot_message_received") {
        return `From ${block.fromBotName}: ${block.text}`;
      }
      if (block.kind === "text" || block.kind === "progress" || block.kind === "ask") {
        return block.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}
