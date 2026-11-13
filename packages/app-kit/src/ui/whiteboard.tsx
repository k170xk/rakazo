import {
  ArrowUpRight,
  Circle,
  Hand,
  ImagePlus,
  Maximize,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  PointerEvent as ReactPointerEvent,
  WheelEvent,
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { uploadImage, useAsset, useCanUpload } from "../sdk/index.js";
import { cn } from "./cn.js";
import { toast } from "./overlay.js";

export type BoardColor =
  | "yellow"
  | "green"
  | "blue"
  | "pink"
  | "orange"
  | "purple"
  | "grey"
  | "ink";
export type BoardKind = "sticky" | "text" | "rect" | "ellipse" | "arrow" | "pen" | "image";
/** An arrow end: a point on the board, or another item it stays attached to. */
export type BoardEnd = { x: number; y: number } | { item: string };

/** One thing on a whiteboard. Positions are board units; x, y is the top-left corner. */
export type BoardItem = {
  id: string;
  kind: BoardKind;
  x: number;
  y: number;
  w: number;
  h: number;
  color?: BoardColor;
  text?: string;
  /** pen: the stroke's points, relative to x, y. */
  points?: Array<[number, number]>;
  /** arrow: where it starts and ends. */
  from?: BoardEnd;
  to?: BoardEnd;
  /** image: its picture id. */
  asset?: string;
};

export type BoardValue = { items: BoardItem[] };

type Tool = "select" | "hand" | BoardKind;
type View = { x: number; y: number; zoom: number };
type Point = { x: number; y: number };

const FILL: Record<BoardColor, string> = {
  yellow: "#FEF3A0",
  green: "#C9EBB2",
  blue: "#BFDDF8",
  pink: "#F8C8DC",
  orange: "#FDD5AE",
  purple: "#DCCDF6",
  grey: "#E5E7EB",
  ink: "#1F2937",
};
const INK: Record<BoardColor, string> = {
  yellow: "#CA8A04",
  green: "#4D9A2A",
  blue: "#2563EB",
  pink: "#DB2777",
  orange: "#EA580C",
  purple: "#7C3AED",
  grey: "#6B7280",
  ink: "hsl(var(--foreground))",
};
const COLORS = Object.keys(FILL) as BoardColor[];
const BOXED = new Set<BoardKind>(["sticky", "text", "rect", "ellipse", "image"]);
const WORDS = new Set<BoardKind>(["sticky", "text", "rect", "ellipse", "arrow"]);
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

const newId = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const isPoint = (end: BoardEnd | undefined): end is Point => !!end && "x" in end;

/** The board's items made safe to draw, whatever was saved. */
export function readBoard(value: unknown): BoardValue {
  const raw = typeof value === "string" ? safeParse(value) : value;
  const items = Array.isArray((raw as BoardValue | null)?.items) ? (raw as BoardValue).items : [];
  return {
    items: items.filter(
      (item): item is BoardItem =>
        !!item &&
        typeof item.id === "string" &&
        typeof item.x === "number" &&
        typeof item.y === "number",
    ),
  };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The box around some items, for fitting them in view. */
export function boardBounds(
  items: BoardItem[],
): { x: number; y: number; w: number; h: number } | null {
  const boxes = items.filter((item) => item.kind !== "arrow");
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((item) => item.x));
  const y = Math.min(...boxes.map((item) => item.y));
  const right = Math.max(...boxes.map((item) => item.x + item.w));
  const bottom = Math.max(...boxes.map((item) => item.y + item.h));
  return { x, y, w: right - x, h: bottom - y };
}

/** Where an arrow end sits: its point, or the edge of the item it is attached to facing the other end. */
function endPoint(
  end: BoardEnd | undefined,
  toward: Point,
  byId: Map<string, BoardItem>,
): Point | null {
  if (!end) return null;
  if (isPoint(end)) return end;
  const item = byId.get(end.item);
  if (!item) return null;
  const centre = { x: item.x + item.w / 2, y: item.y + item.h / 2 };
  const dx = toward.x - centre.x;
  const dy = toward.y - centre.y;
  if (!dx && !dy) return centre;
  const t = Math.min(
    dx ? Math.abs(item.w / 2 / dx) : Number.POSITIVE_INFINITY,
    dy ? Math.abs(item.h / 2 / dy) : Number.POSITIVE_INFINITY,
  );
  return t >= 1 ? centre : { x: centre.x + dx * (t + 0.02), y: centre.y + dy * (t + 0.02) };
}

function arrowEnds(item: BoardItem, byId: Map<string, BoardItem>): [Point, Point] | null {
  const guess = (end: BoardEnd | undefined): Point | null => {
    if (!end) return null;
    if (isPoint(end)) return end;
    const target = byId.get(end.item);
    return target ? { x: target.x + target.w / 2, y: target.y + target.h / 2 } : null;
  };
  const a = guess(item.from);
  const b = guess(item.to);
  if (!a || !b) return null;
  const start = endPoint(item.from, b, byId);
  const finish = endPoint(item.to, a, byId);
  return start && finish ? [start, finish] : null;
}

function BoardImage({ item }: { item: BoardItem }) {
  const url = useAsset(item.asset);
  return url ? (
    <image
      href={url}
      x={item.x}
      y={item.y}
      width={item.w}
      height={item.h}
      preserveAspectRatio="xMidYMid slice"
    />
  ) : (
    <rect x={item.x} y={item.y} width={item.w} height={item.h} fill="hsl(var(--muted))" />
  );
}

/**
 * A whiteboard: sticky notes, text, boxes, circles, arrows that stay attached to what they join,
 * freehand pen and pictures, on a board that pans and zooms (scroll, pinch, or the hand). Select to
 * move, resize, recolour or delete; double-click to edit words; undo with Ctrl/Cmd+Z. The value is
 * plain JSON ({items}) for a longtext column, and onChange hears each finished change, so
 * colleagues' saves arrive live.
 */
export function Whiteboard({
  value,
  onChange,
  readOnly,
  height = 560,
  className,
}: {
  value: BoardValue | string | null | undefined;
  onChange?: (value: BoardValue) => void;
  readOnly?: boolean;
  height?: number;
  className?: string;
}) {
  const editable = !readOnly && Boolean(onChange);
  const canUpload = useCanUpload() && editable;
  const box = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<BoardItem[]>(() => readBoard(value).items);
  const [view, setView] = useState<View>({ x: -40, y: -40, zoom: 1 });
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState<BoardColor>("yellow");
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null);
  const [draft, setDraft] = useState<BoardItem | null>(null);
  const past = useRef<BoardItem[][]>([]);
  const future = useRef<BoardItem[][]>([]);
  const sent = useRef(JSON.stringify(readBoard(value).items));
  const gesture = useRef<
    | { kind: "move"; start: Point; origin: Map<string, BoardItem> }
    | { kind: "resize"; id: string; start: Point; origin: BoardItem }
    | { kind: "pan"; start: Point; origin: View }
    | { kind: "marquee"; start: Point }
    | { kind: "create"; start: Point }
    | { kind: "pinch"; distance: number; mid: Point; origin: View }
    | null
  >(null);
  const pointers = useRef(new Map<number, Point>());
  const spaceDown = useRef(false);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  // Saves from elsewhere (a colleague, another tab) replace the board when nothing is in hand.
  useEffect(() => {
    const next = readBoard(value).items;
    const text = JSON.stringify(next);
    if (text === sent.current || gesture.current || editing) return;
    sent.current = text;
    setItems(next);
  }, [value, editing]);

  const commit = (next: BoardItem[], previous: BoardItem[] = items) => {
    past.current = [...past.current.slice(-99), previous];
    future.current = [];
    setItems(next);
    sent.current = JSON.stringify(next);
    onChange?.({ items: next });
  };
  const undo = () => {
    const previous = past.current.pop();
    if (!previous) return;
    future.current.push(items);
    setItems(previous);
    sent.current = JSON.stringify(previous);
    onChange?.({ items: previous });
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(items);
    setItems(next);
    sent.current = JSON.stringify(next);
    onChange?.({ items: next });
  };

  const toBoard = (clientX: number, clientY: number): Point => {
    const rect = box.current?.getBoundingClientRect();
    return {
      x: (clientX - (rect?.left ?? 0)) / view.zoom + view.x,
      y: (clientY - (rect?.top ?? 0)) / view.zoom + view.y,
    };
  };
  const itemAt = (clientX: number, clientY: number, skip?: string): BoardItem | undefined => {
    for (const element of document.elementsFromPoint(clientX, clientY)) {
      const id = element.closest<SVGElement | HTMLElement>("[data-board-item]")?.dataset.boardItem;
      if (id && id !== skip && byId.get(id)?.kind !== "arrow") return byId.get(id);
    }
    return undefined;
  };
  const zoomAt = (zoom: number, clientX: number, clientY: number, from: View = view) => {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    const rect = box.current?.getBoundingClientRect();
    const sx = clientX - (rect?.left ?? 0);
    const sy = clientY - (rect?.top ?? 0);
    const wx = sx / from.zoom + from.x;
    const wy = sy / from.zoom + from.y;
    setView({ zoom: next, x: wx - sx / next, y: wy - sy / next });
  };
  const showAll = () => {
    const bounds = boardBounds(items);
    const rect = box.current?.getBoundingClientRect();
    if (!bounds || !rect) return setView({ x: -40, y: -40, zoom: 1 });
    const zoom = Math.min(
      MAX_ZOOM,
      Math.max(
        MIN_ZOOM,
        Math.min((rect.width - 80) / bounds.w, (rect.height - 80) / bounds.h, 1.5),
      ),
    );
    setView({
      zoom,
      x: bounds.x + bounds.w / 2 - rect.width / 2 / zoom,
      y: bounds.y + bounds.h / 2 - rect.height / 2 / zoom,
    });
  };
  useEffect(() => {
    if (items.length) showAll();
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("[data-board-control]")) return;
    box.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      gesture.current = {
        kind: "pinch",
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        origin: view,
      };
      setDraft(null);
      setMarquee(null);
      return;
    }
    if (editing) setEditing(null);
    const at = toBoard(event.clientX, event.clientY);
    const panning = tool === "hand" || event.button === 1 || spaceDown.current || !editable;
    if (panning) {
      gesture.current = {
        kind: "pan",
        start: { x: event.clientX, y: event.clientY },
        origin: view,
      };
      return;
    }
    const handle = (event.target as Element).closest<HTMLElement | SVGElement>(
      "[data-board-resize]",
    );
    if (handle && tool === "select") {
      const id = handle.dataset.boardResize as string;
      gesture.current = { kind: "resize", id, start: at, origin: byId.get(id) as BoardItem };
      return;
    }
    if (tool === "select") {
      const id = (event.target as Element).closest<HTMLElement | SVGElement>("[data-board-item]")
        ?.dataset.boardItem;
      if (id) {
        const chosen = event.shiftKey
          ? selected.includes(id)
            ? selected.filter((item) => item !== id)
            : [...selected, id]
          : selected.includes(id)
            ? selected
            : [id];
        setSelected(chosen);
        gesture.current = {
          kind: "move",
          start: at,
          origin: new Map(
            chosen.flatMap((key) => (byId.get(key) ? [[key, byId.get(key) as BoardItem]] : [])),
          ),
        };
      } else {
        if (!event.shiftKey) setSelected([]);
        gesture.current = { kind: "marquee", start: at };
        setMarquee({ a: at, b: at });
      }
      return;
    }
    gesture.current = { kind: "create", start: at };
    const base = { id: newId(), x: at.x, y: at.y, w: 0, h: 0, color };
    if (tool === "arrow") {
      const from = itemAt(event.clientX, event.clientY);
      setDraft({
        ...base,
        kind: "arrow",
        color: color === "yellow" ? "ink" : color,
        from: from ? { item: from.id } : at,
        to: at,
      });
    } else if (tool === "pen") {
      setDraft({
        ...base,
        kind: "pen",
        color: color === "yellow" ? "ink" : color,
        points: [[0, 0]],
      });
    } else {
      setDraft({ ...base, kind: tool as BoardKind });
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const now = gesture.current;
    if (!now) return;
    if (now.kind === "pinch") {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      if (!a || !b) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const moved = {
        ...now.origin,
        x: now.origin.x - (mid.x - now.mid.x) / now.origin.zoom,
        y: now.origin.y - (mid.y - now.mid.y) / now.origin.zoom,
      };
      zoomAt(now.origin.zoom * (distance / (now.distance || 1)), mid.x, mid.y, moved);
      return;
    }
    if (now.kind === "pan") {
      setView({
        ...now.origin,
        x: now.origin.x - (event.clientX - now.start.x) / now.origin.zoom,
        y: now.origin.y - (event.clientY - now.start.y) / now.origin.zoom,
      });
      return;
    }
    const at = toBoard(event.clientX, event.clientY);
    if (now.kind === "move") {
      const dx = at.x - now.start.x;
      const dy = at.y - now.start.y;
      setItems((list) =>
        list.map((item) => {
          const origin = now.origin.get(item.id);
          if (!origin) return item;
          return {
            ...item,
            x: origin.x + dx,
            y: origin.y + dy,
            ...(origin.kind === "arrow"
              ? {
                  from: isPoint(origin.from)
                    ? { x: origin.from.x + dx, y: origin.from.y + dy }
                    : origin.from,
                  to: isPoint(origin.to) ? { x: origin.to.x + dx, y: origin.to.y + dy } : origin.to,
                }
              : {}),
          } as BoardItem;
        }),
      );
    } else if (now.kind === "resize") {
      const w = Math.max(40, now.origin.w + at.x - now.start.x);
      const h = Math.max(30, now.origin.h + at.y - now.start.y);
      const keep = now.origin.kind === "image" && !event.shiftKey;
      setItems((list) =>
        list.map((item) =>
          item.id === now.id
            ? { ...item, w, h: keep ? (w * now.origin.h) / now.origin.w : h }
            : item,
        ),
      );
    } else if (now.kind === "marquee") {
      setMarquee({ a: now.start, b: at });
    } else if (now.kind === "create") {
      setDraft((current) => {
        if (!current) return current;
        if (current.kind === "arrow") return { ...current, to: at };
        if (current.kind === "pen") {
          return {
            ...current,
            points: [...(current.points ?? []), [at.x - current.x, at.y - current.y]],
          };
        }
        return {
          ...current,
          x: Math.min(at.x, now.start.x),
          y: Math.min(at.y, now.start.y),
          w: Math.abs(at.x - now.start.x),
          h: Math.abs(at.y - now.start.y),
        };
      });
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    const now = gesture.current;
    if (now?.kind === "pinch") {
      if (pointers.current.size === 0) gesture.current = null;
      return;
    }
    gesture.current = null;
    if (!now) return;
    if (now.kind === "move" || now.kind === "resize") {
      const before = now.kind === "move" ? [...now.origin.values()] : [now.origin];
      const changed = before.some((origin) => {
        const after = items.find((item) => item.id === origin.id);
        return (
          after &&
          (after.x !== origin.x ||
            after.y !== origin.y ||
            after.w !== origin.w ||
            after.h !== origin.h)
        );
      });
      if (changed) {
        const previous = items.map(
          (item) => before.find((origin) => origin.id === item.id) ?? item,
        );
        commit(items, previous);
      }
    } else if (now.kind === "marquee" && marquee) {
      const left = Math.min(marquee.a.x, marquee.b.x);
      const top = Math.min(marquee.a.y, marquee.b.y);
      const right = Math.max(marquee.a.x, marquee.b.x);
      const bottom = Math.max(marquee.a.y, marquee.b.y);
      if (right - left > 4 || bottom - top > 4) {
        const inside = items.filter((item) => {
          const ends = item.kind === "arrow" ? arrowEnds(item, byId) : null;
          const bx = ends ? Math.min(ends[0].x, ends[1].x) : item.x;
          const by = ends ? Math.min(ends[0].y, ends[1].y) : item.y;
          const bw = ends ? Math.abs(ends[0].x - ends[1].x) : item.w;
          const bh = ends ? Math.abs(ends[0].y - ends[1].y) : item.h;
          return bx >= left && by >= top && bx + bw <= right && by + bh <= bottom;
        });
        setSelected((current) => [...new Set([...current, ...inside.map((item) => item.id)])]);
      }
      setMarquee(null);
    } else if (now.kind === "create" && draft) {
      let made: BoardItem | null = draft;
      if (draft.kind === "arrow") {
        const target = itemAt(event.clientX, event.clientY);
        const to = target ? { item: target.id } : draft.to;
        const ends = arrowEnds({ ...draft, to }, byId);
        const sameItem = target && !isPoint(draft.from) && draft.from?.item === target.id;
        made =
          ends && !sameItem && Math.hypot(ends[0].x - ends[1].x, ends[0].y - ends[1].y) > 12
            ? { ...draft, to }
            : null;
      } else if (draft.kind === "pen") {
        const points = draft.points ?? [];
        if (points.length < 2) made = null;
        else {
          const xs = points.map((point) => point[0]);
          const ys = points.map((point) => point[1]);
          const minX = Math.min(...xs);
          const minY = Math.min(...ys);
          made = {
            ...draft,
            x: draft.x + minX,
            y: draft.y + minY,
            w: Math.max(1, Math.max(...xs) - minX),
            h: Math.max(1, Math.max(...ys) - minY),
            points: points.map(([x, y]) => [Math.round(x - minX), Math.round(y - minY)]),
          };
        }
      } else if (draft.w < 12 && draft.h < 12) {
        const size =
          draft.kind === "sticky"
            ? { w: 180, h: 180 }
            : draft.kind === "text"
              ? { w: 220, h: 48 }
              : { w: 160, h: 110 };
        made = {
          ...draft,
          ...size,
          x: draft.x - (draft.kind === "text" ? 0 : size.w / 2),
          y: draft.y - (draft.kind === "text" ? 24 : size.h / 2),
        };
      }
      setDraft(null);
      if (made) {
        commit([...items, made]);
        setSelected([made.id]);
        if (made.kind === "sticky" || made.kind === "text") setEditing(made.id);
        if (made.kind !== "pen") setTool("select");
      }
    }
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey) {
      zoomAt(view.zoom * Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
    } else {
      setView({
        ...view,
        x: view.x + event.deltaX / view.zoom,
        y: view.y + event.deltaY / view.zoom,
      });
    }
  };

  // Scroll and pinch stay on the board instead of moving the page.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const stop = (event: Event) => event.preventDefault();
    element.addEventListener("wheel", stop, { passive: false });
    element.addEventListener("gesturestart", stop);
    return () => {
      element.removeEventListener("wheel", stop);
      element.removeEventListener("gesturestart", stop);
    };
  }, []);

  const remove = () => {
    if (!selected.length) return;
    const gone = new Set(selected);
    const next = items.filter(
      (item) =>
        !gone.has(item.id) &&
        !(
          item.kind === "arrow" &&
          ((!isPoint(item.from) && gone.has(item.from?.item ?? "")) ||
            (!isPoint(item.to) && gone.has(item.to?.item ?? "")))
        ),
    );
    commit(next);
    setSelected([]);
  };
  const recolour = (next: BoardColor) => {
    setColor(next);
    if (!selected.length) return;
    commit(items.map((item) => (selected.includes(item.id) ? { ...item, color: next } : item)));
  };
  const duplicate = () => {
    const copies = items
      .filter((item) => selected.includes(item.id) && item.kind !== "arrow")
      .map((item) => ({ ...item, id: newId(), x: item.x + 24, y: item.y + 24 }));
    if (!copies.length) return;
    commit([...items, ...copies]);
    setSelected(copies.map((item) => item.id));
  };
  const setText = (id: string, text: string) => {
    const before = byId.get(id);
    if (!before || (before.text ?? "") === text) return;
    commit(items.map((item) => (item.id === id ? { ...item, text } : item)));
  };

  const addPicture = async (file: File | undefined) => {
    if (!file) return;
    try {
      const size = await createImageBitmap(file).then((bitmap) => {
        const out = { w: bitmap.width, h: bitmap.height };
        bitmap.close();
        return out;
      });
      const asset = await uploadImage(file);
      const rect = box.current?.getBoundingClientRect();
      const w = Math.min(360, size.w);
      const h = (w * size.h) / size.w;
      const centre = toBoard(
        (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
        (rect?.top ?? 0) + (rect?.height ?? 0) / 2,
      );
      const made: BoardItem = {
        id: newId(),
        kind: "image",
        x: centre.x - w / 2,
        y: centre.y - h / 2,
        w,
        h,
        asset,
      };
      commit([...items, made]);
      setSelected([made.id]);
      setTool("select");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That picture couldn't be added.");
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editing || (event.target as Element).closest("textarea,input")) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (key === " ") {
      spaceDown.current = true;
      event.preventDefault();
      return;
    }
    if (mod && key === "z") {
      event.preventDefault();
      if (!editable) return;
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && key === "y" && editable) return redo();
    if (mod && key === "a") {
      event.preventDefault();
      return setSelected(items.map((item) => item.id));
    }
    if (mod && key === "d" && editable) {
      event.preventDefault();
      return duplicate();
    }
    if ((key === "delete" || key === "backspace") && editable) {
      event.preventDefault();
      return remove();
    }
    if (key === "escape") {
      setSelected([]);
      return setTool("select");
    }
    if (
      key === "enter" &&
      selected.length === 1 &&
      editable &&
      WORDS.has(byId.get(selected[0]!)?.kind as BoardKind)
    ) {
      event.preventDefault();
      return setEditing(selected[0]!);
    }
    const nudge = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[
      key
    ];
    if (nudge && selected.length && editable) {
      event.preventDefault();
      const step = event.shiftKey ? 20 : 2;
      return commit(
        items.map((item) =>
          selected.includes(item.id) && item.kind !== "arrow"
            ? { ...item, x: item.x + nudge[0]! * step, y: item.y + nudge[1]! * step }
            : item,
        ),
      );
    }
    if (mod || !editable) return;
    const shortcut: Record<string, Tool> = {
      v: "select",
      h: "hand",
      n: "sticky",
      t: "text",
      r: "rect",
      o: "ellipse",
      a: "arrow",
      p: "pen",
    };
    if (shortcut[key]) setTool(shortcut[key]);
  };

  const tools: Array<{ tool: Tool; label: string; icon: ReactNode; key: string }> = [
    { tool: "select", label: "Select", icon: <MousePointer2 />, key: "V" },
    { tool: "hand", label: "Move the board", icon: <Hand />, key: "H" },
    { tool: "sticky", label: "Sticky note", icon: <StickyNote />, key: "N" },
    { tool: "text", label: "Text", icon: <Type />, key: "T" },
    { tool: "rect", label: "Box", icon: <Square />, key: "R" },
    { tool: "ellipse", label: "Circle", icon: <Circle />, key: "O" },
    {
      tool: "arrow",
      label: "Arrow (drag from one item to another to join them)",
      icon: <ArrowUpRight />,
      key: "A",
    },
    { tool: "pen", label: "Pen", icon: <Pencil />, key: "P" },
  ];

  const shown = draft ? [...items, draft] : items;
  const single = selected.length === 1 ? byId.get(selected[0]!) : undefined;

  const words = (item: BoardItem, align: "center" | "start") => {
    const isEditing = editing === item.id;
    const size = item.kind === "text" ? 20 : item.kind === "sticky" ? 17 : 15;
    const textColor =
      item.kind === "text"
        ? INK[item.color ?? "ink"]
        : item.color === "ink" && item.kind === "sticky"
          ? "#fff"
          : "#1F2937";
    return (
      <foreignObject x={item.x} y={item.y} width={Math.max(item.w, 1)} height={Math.max(item.h, 1)}>
        {isEditing ? (
          <textarea
            // biome-ignore lint/a11y/noAutofocus: editing starts where the person double-clicked
            autoFocus
            defaultValue={item.text ?? ""}
            onBlur={(event) => {
              setText(item.id, event.target.value);
              setEditing(null);
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Escape" ||
                (event.key === "Enter" && (event.metaKey || event.ctrlKey))
              ) {
                (event.target as HTMLTextAreaElement).blur();
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
            className="h-full w-full resize-none bg-transparent p-3 outline-none"
            style={{
              fontSize: size,
              color: textColor,
              textAlign: align === "center" ? "center" : "left",
              lineHeight: 1.3,
            }}
          />
        ) : (
          <div
            className={cn(
              "flex h-full w-full overflow-hidden p-3 break-words whitespace-pre-wrap select-none",
              align === "center" ? "items-center justify-center text-center" : "items-start",
            )}
            style={{
              fontSize: size,
              color: textColor,
              lineHeight: 1.3,
              fontWeight: item.kind === "text" ? 600 : 500,
            }}
          >
            {item.text ||
              (item.kind === "sticky" && editable ? (
                <span className="opacity-40">Double-click to write</span>
              ) : null)}
          </div>
        )}
      </foreignObject>
    );
  };

  return (
    <div
      ref={box}
      role="application"
      aria-label="Whiteboard"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the board takes keyboard shortcuts (tools, delete, undo, arrows)
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => {
        if (event.key === " ") spaceDown.current = false;
      }}
      onDoubleClick={(event) => {
        if (!editable) return;
        const id = (event.target as Element).closest<HTMLElement | SVGElement>("[data-board-item]")
          ?.dataset.boardItem;
        const item = id ? byId.get(id) : undefined;
        if (item && WORDS.has(item.kind)) return setEditing(item.id);
        if (!item && tool === "select") {
          const at = toBoard(event.clientX, event.clientY);
          const made: BoardItem = {
            id: newId(),
            kind: "sticky",
            x: at.x - 90,
            y: at.y - 90,
            w: 180,
            h: 180,
            color,
          };
          commit([...items, made]);
          setSelected([made.id]);
          setEditing(made.id);
        }
      }}
      className={cn(
        "relative touch-none overflow-hidden rounded-2xl border border-border/70 bg-card bg-dots outline-none select-none focus-visible:ring-2 focus-visible:ring-ring",
        tool === "hand" || !editable
          ? "cursor-grab"
          : tool === "select"
            ? "cursor-default"
            : "cursor-crosshair",
        className,
      )}
      style={{ height, backgroundPosition: `${-view.x * view.zoom}px ${-view.y * view.zoom}px` }}
    >
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          {COLORS.map((name) => (
            <marker
              key={name}
              id={`board-head-${name}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 Z" fill={INK[name]} />
            </marker>
          ))}
        </defs>
        <g transform={`scale(${view.zoom}) translate(${-view.x} ${-view.y})`}>
          {shown.map((item) => {
            const isSelected = selected.includes(item.id);
            const ink = INK[item.color ?? "ink"];
            if (item.kind === "arrow") {
              const ends = arrowEnds(item, byId);
              if (!ends) return null;
              const [a, b] = ends;
              const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
              return (
                <g
                  key={item.id}
                  data-board-item={item.id === draft?.id ? undefined : item.id}
                  className={item.id === draft?.id ? "pointer-events-none" : ""}
                >
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="transparent"
                    strokeWidth={16 / view.zoom}
                  />
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={isSelected ? "hsl(var(--primary))" : ink}
                    strokeWidth={2.5}
                    markerEnd={`url(#board-head-${item.color ?? "ink"})`}
                  />
                  {(item.text || editing === item.id) &&
                    words({ ...item, x: mid.x - 80, y: mid.y - 20, w: 160, h: 40 }, "center")}
                </g>
              );
            }
            if (item.kind === "pen") {
              const d = (item.points ?? [])
                .map(([x, y], index) => `${index ? "L" : "M"}${item.x + x},${item.y + y}`)
                .join(" ");
              return (
                <g key={item.id} data-board-item={item.id === draft?.id ? undefined : item.id}>
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14 / view.zoom}
                    strokeLinecap="round"
                  />
                  <path
                    d={d}
                    fill="none"
                    stroke={ink}
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {isSelected && (
                    <rect
                      x={item.x - 4}
                      y={item.y - 4}
                      width={item.w + 8}
                      height={item.h + 8}
                      fill="none"
                      stroke="hsl(var(--primary))"
                      strokeDasharray="4 3"
                      strokeWidth={1.5 / view.zoom}
                    />
                  )}
                </g>
              );
            }
            return (
              <g key={item.id} data-board-item={item.id === draft?.id ? undefined : item.id}>
                {item.kind === "sticky" && (
                  <rect
                    x={item.x}
                    y={item.y}
                    width={item.w}
                    height={item.h}
                    rx={6}
                    fill={FILL[item.color ?? "yellow"]}
                    style={{ filter: "drop-shadow(0 3px 5px rgb(0 0 0 / 0.14))" }}
                  />
                )}
                {item.kind === "rect" && (
                  <rect
                    x={item.x}
                    y={item.y}
                    width={item.w}
                    height={item.h}
                    rx={10}
                    fill={item.color === "ink" ? "hsl(var(--card))" : FILL[item.color ?? "grey"]}
                    fillOpacity={0.55}
                    stroke={ink}
                    strokeWidth={2.5}
                  />
                )}
                {item.kind === "ellipse" && (
                  <ellipse
                    cx={item.x + item.w / 2}
                    cy={item.y + item.h / 2}
                    rx={item.w / 2}
                    ry={item.h / 2}
                    fill={item.color === "ink" ? "hsl(var(--card))" : FILL[item.color ?? "grey"]}
                    fillOpacity={0.55}
                    stroke={ink}
                    strokeWidth={2.5}
                  />
                )}
                {item.kind === "text" && (
                  <rect x={item.x} y={item.y} width={item.w} height={item.h} fill="transparent" />
                )}
                {item.kind === "image" && <BoardImage item={item} />}
                {WORDS.has(item.kind) && words(item, item.kind === "text" ? "start" : "center")}
                {isSelected && (
                  <rect
                    x={item.x - 3}
                    y={item.y - 3}
                    width={item.w + 6}
                    height={item.h + 6}
                    rx={8}
                    fill="none"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2 / view.zoom}
                  />
                )}
              </g>
            );
          })}
          {single && editable && BOXED.has(single.kind) && (
            <rect
              data-board-resize={single.id}
              x={single.x + single.w - 6 / view.zoom}
              y={single.y + single.h - 6 / view.zoom}
              width={12 / view.zoom}
              height={12 / view.zoom}
              rx={3 / view.zoom}
              fill="hsl(var(--card))"
              stroke="hsl(var(--primary))"
              strokeWidth={2 / view.zoom}
              className="cursor-nwse-resize"
            />
          )}
          {marquee && (
            <rect
              x={Math.min(marquee.a.x, marquee.b.x)}
              y={Math.min(marquee.a.y, marquee.b.y)}
              width={Math.abs(marquee.a.x - marquee.b.x)}
              height={Math.abs(marquee.a.y - marquee.b.y)}
              fill="hsl(var(--primary) / 0.08)"
              stroke="hsl(var(--primary))"
              strokeDasharray="5 4"
              strokeWidth={1 / view.zoom}
            />
          )}
        </g>
      </svg>

      {editable && (
        <div
          data-board-control=""
          className="absolute top-3 left-1/2 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-xl border border-border bg-card/95 p-1 shadow-lg backdrop-blur"
        >
          {tools.map((option) => (
            <BoardButton
              key={option.tool}
              label={`${option.label} (${option.key})`}
              active={tool === option.tool}
              onClick={() => setTool(option.tool)}
            >
              {option.icon}
            </BoardButton>
          ))}
          {canUpload && (
            <BoardButton label="Add a picture" onClick={() => picker.current?.click()}>
              <ImagePlus />
            </BoardButton>
          )}
          <span className="mx-1 h-6 w-px shrink-0 bg-border" />
          {COLORS.map((name) => (
            <button
              key={name}
              type="button"
              aria-label={`Colour ${name}`}
              aria-pressed={color === name}
              title={name}
              onClick={() => recolour(name)}
              className={cn(
                "size-6 shrink-0 rounded-full border border-black/10 transition-transform",
                color === name && "scale-110 ring-2 ring-primary ring-offset-1 ring-offset-card",
              )}
              style={{ background: FILL[name] }}
            />
          ))}
          <span className="mx-1 h-6 w-px shrink-0 bg-border" />
          <BoardButton label="Undo (Ctrl+Z)" onClick={undo}>
            <Undo2 />
          </BoardButton>
          <BoardButton label="Redo (Ctrl+Shift+Z)" onClick={redo}>
            <Redo2 />
          </BoardButton>
          <BoardButton label="Delete selected" onClick={remove} disabled={!selected.length}>
            <Trash2 />
          </BoardButton>
        </div>
      )}
      <div
        data-board-control=""
        className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-xl border border-border bg-card/95 p-1 shadow-sm backdrop-blur"
      >
        <BoardButton
          label="Zoom out"
          onClick={() =>
            zoomAt(
              view.zoom / 1.25,
              (box.current?.getBoundingClientRect().left ?? 0) +
                (box.current?.clientWidth ?? 0) / 2,
              (box.current?.getBoundingClientRect().top ?? 0) + height / 2,
            )
          }
        >
          <Minus />
        </BoardButton>
        <span className="w-11 text-center text-xs font-semibold tabular text-muted-foreground">
          {Math.round(view.zoom * 100)}%
        </span>
        <BoardButton
          label="Zoom in"
          onClick={() =>
            zoomAt(
              view.zoom * 1.25,
              (box.current?.getBoundingClientRect().left ?? 0) +
                (box.current?.clientWidth ?? 0) / 2,
              (box.current?.getBoundingClientRect().top ?? 0) + height / 2,
            )
          }
        >
          <Plus />
        </BoardButton>
        <BoardButton label="Show everything" onClick={showAll}>
          <Maximize />
        </BoardButton>
      </div>
      {!items.length && !draft && (
        <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          {editable
            ? "Double-click to add a sticky note, or pick a tool above"
            : "Nothing on this board yet"}
        </p>
      )}
      <input
        ref={picker}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void addPicture(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}

function BoardButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-lg transition-colors disabled:opacity-35 [&_svg]:size-4",
        active ? "bg-primary/12 text-primary" : "text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
