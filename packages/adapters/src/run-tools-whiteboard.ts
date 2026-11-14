import type { BOARD_COLORS, BoardItem, BoardOp, MessageBlock } from "@rakazo/contracts";
import {
  applyBoardOps,
  BOARD_KINDS,
  BoardItemSchema,
  BoardOpSchema,
  boardForModel,
  boardSource,
  danglingArrow,
  PAGE_SOURCE_MAX_BYTES,
  PAGE_TITLE_MAX_LENGTH,
  PageTitleSchema,
  pageSourceBytes,
  readBoardItems,
} from "@rakazo/contracts";
import { containsEncodedSecret, containsSecret, redactSecrets } from "@rakazo/core";
import type { RunContext } from "./run-context.js";
import { isUniqueViolation, publishMessage } from "./run-messages.js";
import type { ToolCall, ToolHandlers } from "./run-tool-gate.js";
import { argumentGiven } from "./update-bot-patch.js";

const SHAPE: Record<
  (typeof BOARD_KINDS)[number],
  { w: number; h: number; color: (typeof BOARD_COLORS)[number] }
> = {
  sticky: { w: 180, h: 150, color: "yellow" },
  text: { w: 240, h: 48, color: "ink" },
  rect: { w: 200, h: 84, color: "green" },
  ellipse: { w: 160, h: 90, color: "grey" },
  diamond: { w: 170, h: 110, color: "orange" },
  cylinder: { w: 150, h: 96, color: "blue" },
  document: { w: 150, h: 110, color: "grey" },
  cloud: { w: 190, h: 110, color: "green" },
  queue: { w: 180, h: 80, color: "purple" },
  section: { w: 520, h: 300, color: "grey" },
  arrow: { w: 0, h: 0, color: "ink" },
  pen: { w: 0, h: 0, color: "ink" },
  image: { w: 220, h: 150, color: "grey" },
};

function place(index: number, existing: readonly BoardItem[], kind: keyof typeof SHAPE) {
  const shape = SHAPE[kind];
  const boxes = existing.filter((item) => item.kind !== "arrow");
  const bottom = boxes.length ? Math.max(...boxes.map((item) => item.y + item.h)) : 0;
  return {
    x: 48 + (index % 3) * (shape.w + 40),
    y: (boxes.length ? bottom + 48 : 48) + Math.floor(index / 3) * (shape.h + 36),
  };
}

/** Fills in size, colour and a spot when the model names a block without laying it out. */
function normalizeItem(
  raw: unknown,
  index: number,
  existing: readonly BoardItem[],
): BoardItem | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return `Item ${index + 1} must be an object.`;
  }
  const item = raw as Record<string, unknown>;
  const kind = typeof item.kind === "string" ? item.kind : "";
  if (!(kind in SHAPE)) {
    return `Item ${index + 1}: kind must be one of ${BOARD_KINDS.join(", ")}.`;
  }
  const shape = SHAPE[kind as keyof typeof SHAPE];
  const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : `n${index + 1}`;
  const spot =
    typeof item.x === "number" && typeof item.y === "number"
      ? null
      : place(index, existing, kind as keyof typeof SHAPE);
  const draft = {
    id,
    kind,
    x: typeof item.x === "number" ? item.x : spot!.x,
    y: typeof item.y === "number" ? item.y : spot!.y,
    w: typeof item.w === "number" ? item.w : shape.w,
    h: typeof item.h === "number" ? item.h : shape.h,
    color: typeof item.color === "string" ? item.color : shape.color,
    ...(typeof item.text === "string" ? { text: item.text } : {}),
    ...(item.from && typeof item.from === "object" ? { from: item.from } : {}),
    ...(item.to && typeof item.to === "object" ? { to: item.to } : {}),
    ...(typeof item.asset === "string" ? { asset: item.asset } : {}),
    ...(Array.isArray(item.points) ? { points: item.points } : {}),
  };
  const parsed = BoardItemSchema.safeParse(draft);
  if (!parsed.success) {
    return `Item ${index + 1}: ${parsed.error.issues[0]?.message ?? "invalid"}.`;
  }
  return parsed.data;
}

function parseItems(value: unknown): BoardItem[] | string {
  if (!Array.isArray(value)) return "items must be a list of blocks.";
  const items: BoardItem[] = [];
  for (const [index, raw] of value.entries()) {
    const item = normalizeItem(raw, index, items);
    if (typeof item === "string") return item;
    items.push(item);
  }
  const dangling = danglingArrow(items);
  if (dangling) return dangling;
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) return `"${item.id}" is used more than once.`;
    ids.add(item.id);
  }
  return items;
}

function parseOps(value: unknown, existing: readonly BoardItem[]): BoardOp[] | string {
  if (!Array.isArray(value) || value.length === 0) return "ops must be a non-empty list.";
  const ops: BoardOp[] = [];
  const added: BoardItem[] = [];
  for (const [index, raw] of value.entries()) {
    const op = raw as { op?: unknown; item?: unknown } | null;
    if (op?.op === "add") {
      const item = normalizeItem(op.item, index, [...existing, ...added]);
      if (typeof item === "string") return item;
      added.push(item);
      ops.push({ op: "add", item });
      continue;
    }
    const parsed = BoardOpSchema.safeParse(raw);
    if (!parsed.success || parsed.data.op === "add") {
      return `Change ${index + 1}: ${parsed.success ? "invalid" : (parsed.error.issues[0]?.message ?? "invalid")}.`;
    }
    ops.push(parsed.data);
  }
  return ops;
}

class BoardChangedError extends Error {}

async function saveWhiteboard(ctx: RunContext, call: ToolCall) {
  const { deps, run, bot, thread } = ctx;
  const { args } = call;
  const whiteboardId = argumentGiven(args.whiteboardId)
    ? String(args.whiteboardId)
    : argumentGiven(args.pageId)
      ? String(args.pageId)
      : undefined;
  const hasItems = Array.isArray(args.items);
  const hasOps = Array.isArray(args.ops) ? args.ops.length > 0 : argumentGiven(args.ops);
  if (hasItems && hasOps)
    return { error: "Send items for a new board, or ops to change one, not both." };

  let title: string | undefined;
  if (argumentGiven(args.title)) {
    const parsed = PageTitleSchema.safeParse(args.title);
    if (!parsed.success) return { error: "title must be 1 to 200 characters." };
    title = redactSecrets(parsed.data, ctx.secrets).slice(0, PAGE_TITLE_MAX_LENGTH);
  }

  const reachable = thread.groupId
    ? [{ botId: bot.id }, { groupId: thread.groupId }]
    : [{ botId: bot.id }];
  const page = whiteboardId
    ? await deps.prisma.page.findFirst({
        where: { id: whiteboardId, spaceId: run.spaceId, userId: run.userId, OR: reachable },
        select: {
          id: true,
          kind: true,
          title: true,
          currentVersion: true,
          versions: { orderBy: { version: "desc" }, take: 1, select: { source: true } },
        },
      })
    : null;
  if (whiteboardId && !page) {
    return { error: "No whiteboard with that id belongs to this bot or chat." };
  }
  if (page && page.kind !== "whiteboard") {
    return { error: "That id is not a whiteboard." };
  }

  const current = readBoardItems(page?.versions[0]?.source ?? "");
  if (page && !hasItems && !hasOps && !title) {
    ctx.state.tainted = true;
    return {
      whiteboardId: page.id,
      pageId: page.id,
      version: page.currentVersion,
      title: page.title,
      items: boardForModel(current),
    };
  }
  if (!page && hasOps) return { error: "ops need the whiteboardId of the board to change." };
  if (!page && !title) return { error: "A new whiteboard needs a title." };

  let items = current;
  if (hasItems) {
    const parsed = parseItems(args.items);
    if (typeof parsed === "string") return { error: parsed, unchanged: true };
    items = parsed;
  }
  if (hasOps) {
    const base = typeof args.baseVersion === "number" ? args.baseVersion : null;
    if (base === null) return { error: "ops need baseVersion from the last read or save." };
    if (page && base !== page.currentVersion) {
      ctx.state.tainted = true;
      return {
        error:
          "The whiteboard changed since that version. Apply your changes to this board and retry.",
        unchanged: true,
        whiteboardId: page.id,
        version: page.currentVersion,
        title: page.title,
        items: boardForModel(current),
      };
    }
    const ops = parseOps(args.ops, current);
    if (typeof ops === "string") return { error: ops, unchanged: true };
    const applied = applyBoardOps(current, ops);
    if (!applied.ok) return { error: applied.error, unchanged: true };
    items = applied.items;
  }

  const source = boardSource(items);
  if (pageSourceBytes(source) > PAGE_SOURCE_MAX_BYTES) {
    return { error: "That board is too large. Remove some items and save again.", unchanged: true };
  }
  if (
    containsSecret([source, title ?? ""], ctx.secrets) ||
    containsEncodedSecret([source], ctx.secrets)
  ) {
    return {
      error: "The whiteboard contains a secret value; nothing was saved. Remove it and save again.",
      unchanged: true,
    };
  }

  let saved: { pageId: string; version: number; title: string };
  try {
    saved = await deps.prisma.$transaction(async (tx) => {
      if (!page) {
        const created = await tx.page.create({
          data: {
            spaceId: run.spaceId,
            userId: run.userId,
            botId: bot.id,
            groupId: thread.groupId,
            title: title!,
            kind: "whiteboard",
            versions: {
              create: {
                version: 1,
                title: title!,
                source,
                code: source,
                runId: ctx.runId,
                via: "assistant",
              },
            },
          },
        });
        return { pageId: created.id, version: 1, title: created.title };
      }
      const version = page.currentVersion + 1;
      const moved = await tx.page.updateMany({
        where: { id: page.id, currentVersion: page.currentVersion },
        data: { currentVersion: version, title, updatedAt: new Date() },
      });
      if (moved.count === 0) throw new BoardChangedError();
      let nextTitle =
        title ??
        (await tx.page.findUniqueOrThrow({ where: { id: page.id }, select: { title: true } }))
          .title;
      const kept = redactSecrets(nextTitle, ctx.secrets).slice(0, PAGE_TITLE_MAX_LENGTH);
      if (kept !== nextTitle) {
        nextTitle = kept;
        await tx.page.update({ where: { id: page.id }, data: { title: kept } });
      }
      await tx.pageVersion.create({
        data: {
          pageId: page.id,
          version,
          title: nextTitle,
          source,
          code: source,
          runId: ctx.runId,
          via: "assistant",
        },
      });
      return { pageId: page.id, version, title: nextTitle };
    });
  } catch (error) {
    if (error instanceof BoardChangedError || isUniqueViolation(error)) {
      return {
        error: "The whiteboard changed while saving; read it again and retry.",
        unchanged: true,
      };
    }
    throw error;
  }

  const linkText = saved.title.replace(/[\\[\]]/g, "\\$&");
  const mention = `Mention it in your reply as [${linkText}](page:${saved.pageId})`;
  if (!page) {
    const block: MessageBlock = { kind: "page", ...saved };
    try {
      await publishMessage(deps, run, "bot", [block]);
    } catch (error) {
      return {
        ...saved,
        whiteboardId: saved.pageId,
        items: boardForModel(items),
        error: `The whiteboard was saved, but its card could not be posted in the chat (${
          error instanceof Error ? error.message : "unknown error"
        }). Link it in your reply as [${linkText}](page:${saved.pageId}).`,
      };
    }
  }
  return {
    whiteboardId: saved.pageId,
    pageId: saved.pageId,
    version: saved.version,
    title: saved.title,
    items: boardForModel(items),
    mention,
  };
}

export const whiteboardTools: ToolHandlers = {
  async save_whiteboard(ctx, call) {
    return call.finish(await saveWhiteboard(ctx, call));
  },
};
