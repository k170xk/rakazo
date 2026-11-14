/** One card in the strip shown over a whiteboard or app while the chat is tucked away. */
export type StudioCard = {
  id: string;
  who: "you" | "agent" | "action";
  text: string;
  live: boolean;
};

type ActivityBlock = {
  kind: string;
  text?: string;
  title?: string;
  summary?: string;
  activity?: boolean;
  steps?: readonly { label: string }[];
};

type ActivityMessage = {
  id: string;
  role: string;
  blocks: readonly ActivityBlock[];
};

const SNIP = 96;
const EMPTY: StudioCard[] = [];

function clip(text: string): string {
  const clean = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s*\(page:[^)]+\)/g, " ")
    .replace(/[#>*_`[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > SNIP ? `${clean.slice(0, SNIP - 1)}…` : clean;
}

function messageText(message: ActivityMessage): string {
  return clip(
    message.blocks
      .filter((block) => block.kind === "text" && block.text)
      .map((block) => block.text ?? "")
      .join(" "),
  );
}

/**
 * The latest things said and done in a chat, oldest first, for a horizontal strip.
 * A live run marks its newest action; a run with nothing to show yet is left empty
 * so the strip can say it is working in the viewer's language.
 */
export function studioActivity(
  messages: readonly ActivityMessage[],
  running: boolean,
): StudioCard[] {
  const cards: StudioCard[] = [];
  const recent = messages.slice(-6);
  for (let index = 0; index < recent.length; index += 1) {
    const message = recent[index]!;
    const last = index === recent.length - 1;
    const steps = message.blocks.find((block) => block.kind === "steps" && block.steps?.length);
    if (steps?.steps) {
      const tail = steps.steps.slice(-4);
      const start = steps.steps.length - tail.length;
      tail.forEach((step, stepIndex) => {
        const text = clip(step.label);
        if (!text) return;
        cards.push({
          id: `${message.id}:step:${start + stepIndex}`,
          who: "action",
          text,
          live: running && last && stepIndex === tail.length - 1,
        });
      });
    }
    const text = messageText(message);
    if (text) {
      cards.push({
        id: `${message.id}:text`,
        who: message.role === "user" ? "you" : "agent",
        text,
        live: false,
      });
    } else if (!steps) {
      const page = [...message.blocks]
        .reverse()
        .find((block) => block.kind === "page" && (block.summary || block.title));
      const label = page ? clip(page.summary || page.title || "") : "";
      if (label) {
        cards.push({ id: `${message.id}:page`, who: "action", text: label, live: false });
      }
    }
  }
  const shown = cards.slice(-8);
  return shown.length ? shown : EMPTY;
}

export function sameStudioCards(
  left: readonly StudioCard[] | undefined,
  right: readonly StudioCard[] | undefined,
): boolean {
  const a = left ?? EMPTY;
  const b = right ?? EMPTY;
  if (a.length !== b.length) return false;
  return a.every((card, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      card.id === other.id &&
      card.who === other.who &&
      card.text === other.text &&
      card.live === other.live
    );
  });
}
