import * as z from "zod";

/** A board stays a diagram, not a document. */
export const BOARD_MAX_ITEMS = 800;
export const BOARD_MAX_OPS = 80;

export const BOARD_KINDS = [
  "sticky",
  "text",
  "rect",
  "ellipse",
  "diamond",
  "cylinder",
  "document",
  "cloud",
  "queue",
  "section",
  "arrow",
  "pen",
  "image",
] as const;

export const BOARD_COLORS = [
  "yellow",
  "green",
  "blue",
  "pink",
  "orange",
  "purple",
  "grey",
  "ink",
] as const;

const BoardEndSchema = z.union([
  z.strictObject({ x: z.number().finite(), y: z.number().finite() }),
  z.strictObject({ item: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/) }),
]);

export const BoardItemSchema = z
  .strictObject({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
    kind: z.enum(BOARD_KINDS),
    x: z.number().finite().min(-100_000).max(100_000),
    y: z.number().finite().min(-100_000).max(100_000),
    w: z.number().finite().min(0).max(8_000),
    h: z.number().finite().min(0).max(8_000),
    color: z.enum(BOARD_COLORS).optional(),
    text: z.string().max(2_000).optional(),
    points: z
      .array(z.tuple([z.number().finite(), z.number().finite()]))
      .max(4_000)
      .optional(),
    from: BoardEndSchema.optional(),
    to: BoardEndSchema.optional(),
    asset: z.string().min(1).max(200).optional(),
  })
  .superRefine((item, ctx) => {
    if (item.kind === "arrow" && (!item.from || !item.to)) {
      ctx.addIssue({ code: "custom", message: "an arrow needs from and to" });
    }
  });

export type BoardItem = z.infer<typeof BoardItemSchema>;

const BoardPatchSchema = z
  .strictObject({
    kind: z.enum(BOARD_KINDS).optional(),
    x: z.number().finite().min(-100_000).max(100_000).optional(),
    y: z.number().finite().min(-100_000).max(100_000).optional(),
    w: z.number().finite().min(0).max(8_000).optional(),
    h: z.number().finite().min(0).max(8_000).optional(),
    color: z.enum(BOARD_COLORS).optional(),
    text: z.string().max(2_000).optional(),
    points: z
      .array(z.tuple([z.number().finite(), z.number().finite()]))
      .max(4_000)
      .optional(),
    from: BoardEndSchema.optional(),
    to: BoardEndSchema.optional(),
    asset: z.string().min(1).max(200).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, "patch is empty");

export const BoardOpSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("add"), item: BoardItemSchema }),
  z.strictObject({
    op: z.literal("update"),
    id: z.string().min(1).max(64),
    patch: BoardPatchSchema,
  }),
  z.strictObject({ op: z.literal("remove"), id: z.string().min(1).max(64) }),
]);

export type BoardOp = z.infer<typeof BoardOpSchema>;

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Items that can be drawn, dropping anything malformed. A stored board always parses this way. */
export function readBoardItems(value: unknown): BoardItem[] {
  const raw = typeof value === "string" ? tryParse(value) : value;
  const items = (raw as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: BoardItem[] = [];
  for (const item of items) {
    const parsed = BoardItemSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
    if (out.length >= BOARD_MAX_ITEMS) break;
  }
  return out;
}

/** The JSON stored as the board's page source and as the viewer's document. */
export function boardSource(items: readonly BoardItem[]): string {
  return JSON.stringify({ items });
}

/**
 * Apply every op or none. A remove also drops arrows that were attached to that item, so a
 * deleted block does not leave a line pointing nowhere.
 */
export function applyBoardOps(
  items: readonly BoardItem[],
  ops: readonly BoardOp[],
): { ok: true; items: BoardItem[] } | { ok: false; error: string } {
  if (ops.length > BOARD_MAX_OPS) {
    return { ok: false, error: `Send at most ${BOARD_MAX_OPS} changes at once.` };
  }
  let next = items.map((item) => ({ ...item }));
  for (const [index, op] of ops.entries()) {
    const label = `Change ${index + 1}`;
    if (op.op === "add") {
      if (next.some((item) => item.id === op.item.id)) {
        return { ok: false, error: `${label}: "${op.item.id}" is already on the board.` };
      }
      next = [...next, op.item];
    } else if (op.op === "remove") {
      if (!next.some((item) => item.id === op.id)) {
        return { ok: false, error: `${label}: nothing on the board has id "${op.id}".` };
      }
      next = next.filter((item) => {
        if (item.id === op.id) return false;
        if (item.kind !== "arrow") return true;
        const from = item.from && "item" in item.from ? item.from.item : null;
        const to = item.to && "item" in item.to ? item.to.item : null;
        return from !== op.id && to !== op.id;
      });
    } else {
      const at = next.findIndex((item) => item.id === op.id);
      if (at < 0) {
        return { ok: false, error: `${label}: nothing on the board has id "${op.id}".` };
      }
      const parsed = BoardItemSchema.safeParse({ ...next[at], ...op.patch, id: op.id });
      if (!parsed.success) {
        return {
          ok: false,
          error: `${label}: ${parsed.error.issues[0]?.message ?? "that change is not valid."}`,
        };
      }
      next[at] = parsed.data;
    }
    if (next.length > BOARD_MAX_ITEMS) {
      return { ok: false, error: `A whiteboard holds at most ${BOARD_MAX_ITEMS} items.` };
    }
  }
  const dangling = danglingArrow(next);
  if (dangling) return { ok: false, error: dangling };
  return { ok: true, items: next };
}

/** An arrow whose end names a block that is not on the board. */
export function danglingArrow(items: readonly BoardItem[]): string | null {
  const ids = new Set(items.map((item) => item.id));
  for (const item of items) {
    if (item.kind !== "arrow") continue;
    for (const end of [item.from, item.to]) {
      if (end && "item" in end && !ids.has(end.item)) {
        return `Arrow "${item.id}" points at "${end.item}", which is not on the board.`;
      }
    }
  }
  return null;
}

/**
 * What the model reads back. A freehand stroke is a count, so a sketch someone drew is not
 * rewritten as hundreds of points and is left alone unless they ask.
 */
export function boardForModel(items: readonly BoardItem[]): unknown[] {
  return items.map((item) => {
    if (item.kind === "pen" && item.points && item.points.length > 30) {
      const { points, ...rest } = item;
      return { ...rest, strokePoints: points.length };
    }
    return item;
  });
}

/** Appended to a message sent while blocks are selected, so the edit can name them by id. */
export function whiteboardSelectionNote(
  items: readonly { id: string; kind: string; text?: string }[],
): string {
  if (!items.length) return "";
  const lines = items.slice(0, 12).map((item) => {
    const label = (item.text ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    return `- ${item.id} (${item.kind})${label ? `: ${label}` : ""}`;
  });
  const extra = items.length > 12 ? `\n- ${items.length - 12} more` : "";
  return `Selected on the whiteboard:\n${lines.join("\n")}${extra}`;
}
