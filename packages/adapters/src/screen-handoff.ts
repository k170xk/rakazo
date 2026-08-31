import type { MessageBlock } from "@rakazo/contracts";

export function buildScreenHandoffAskBlock(botName: string): MessageBlock {
  return {
    kind: "ask",
    input: "screen_handoff",
    text: `${botName} needs the shared desktop. Another session is using it.`,
    status: "pending",
    actions: [
      { id: "allow", label: "Let this agent take over" },
      { id: "deny", label: "Not now" },
    ],
  };
}
