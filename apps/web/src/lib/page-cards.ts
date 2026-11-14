import type { MessageBlock } from "@rakazo/contracts";
import { newestPageCards, pageCardSuperseded } from "@rakazo/core";

export type PageBlock = Extract<MessageBlock, { kind: "page" }>;

function mergePageBlocks(existing: readonly PageBlock[], incoming: readonly PageBlock[]): PageBlock[] {
  const out = [...existing];
  for (const block of incoming) {
    const at = out.findIndex((item) => item.pageId === block.pageId);
    if (at === -1) {
      out.push(block);
    } else {
      const prev = out[at]!;
      const created = prev.created === true || block.created === true;
      out[at] = {
        ...block,
        ...(created ? { created: true } : {}),
        ...(!created && (block.summary ?? prev.summary)
          ? { summary: block.summary ?? prev.summary }
          : {}),
      };
    }
  }
  return out;
}

/**
 * Page-only bot messages fold under the same bot's next reply, which introduces them, keeping only
 * the latest version per page within that turn (and collapsing consecutive interim saves while streaming).
 */
export function projectPageCards<
  Message extends { id: string; role: string; botId?: string; blocks: MessageBlock[] },
>(messages: readonly Message[]) {
  const pages = new Map<string, PageBlock[]>();
  const foldedInto = new Map<string, string>();
  messages.forEach((message, index) => {
    if (
      message.role !== "bot" ||
      message.blocks.length === 0 ||
      !message.blocks.every((block) => block.kind === "page")
    )
      return;
    const blocks = message.blocks as PageBlock[];
    let laterSamePage: string | null = null;
    for (const next of messages.slice(index + 1)) {
      if (next.role !== "bot" || next.botId !== message.botId) break;
      if (next.blocks.some((block) => block.kind === "text")) {
        pages.set(next.id, mergePageBlocks(pages.get(next.id) ?? [], blocks));
        foldedInto.set(message.id, next.id);
        return;
      }
      if (
        next.blocks.length > 0 &&
        next.blocks.every((block) => block.kind === "page") &&
        blocks.every((block) =>
          (next.blocks as PageBlock[]).some((later) => later.pageId === block.pageId),
        )
      ) {
        laterSamePage = next.id;
      }
    }
    if (laterSamePage) foldedInto.set(message.id, laterSamePage);
  });
  const resolveOwner = (id: string): string => {
    let cur = id;
    const seen = new Set<string>();
    while (foldedInto.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = foldedInto.get(cur)!;
    }
    return cur;
  };
  const lastCard = newestPageCards(messages, resolveOwner);
  const visibleMessages = messages.filter((message) => !foldedInto.has(message.id));
  const seenPages = new Set<string>();
  const markFirst = (block: PageBlock): PageBlock => {
    const first = !seenPages.has(block.pageId);
    seenPages.add(block.pageId);
    if (block.created !== undefined) return block;
    return { ...block, created: first };
  };
  const normalizedMessages = visibleMessages.map((message) => {
    const attached = pages.get(message.id);
    const hasInlinePage = message.blocks.some((block) => block.kind === "page");
    const nextBlocks = hasInlinePage
      ? message.blocks.map((block) => (block.kind === "page" ? markFirst(block) : block))
      : message.blocks;
    if (attached) {
      pages.set(message.id, attached.map(markFirst));
    }
    return hasInlinePage ? { ...message, blocks: nextBlocks } : message;
  });
  return {
    visibleMessages: normalizedMessages,
    pages,
    foldedInto,
    /** Changes only when a card becomes the newest one for its page. */
    cardsKey: [...lastCard].join(" "),
    /** Whether a later card in this thread shows the same page. */
    isSuperseded: (messageId: string, block: PageBlock) =>
      pageCardSuperseded(lastCard, messageId, block),
  };
}

/** The tallest frame a page may ask for. */
const MAX_PAGE_HEIGHT = 200_000;

/** A height a page reported, kept to a sane range whatever the page sends. */
export function pageFrameHeight(height: number): number {
  return Number.isFinite(height) ? Math.min(Math.max(height, 0), MAX_PAGE_HEIGHT) : 0;
}
