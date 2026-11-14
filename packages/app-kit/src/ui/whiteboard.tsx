import {
  ArrowUpRight,
  Circle,
  Cloud,
  Database,
  Diamond,
  FileText,
  Frame,
  Hand,
  ImagePlus,
  Maximize,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  Rows3,
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
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { uploadImage, useAsset, useCanUpload } from "../sdk/index.js";
import { cn } from "./cn.js";
import { toast } from "./overlay.js";
import {
  computeBoardArrows,
  measureArrowLabel,
  roundedOrthogonalPath,
} from "./whiteboard-geometry.js";

export type BoardColor =
  | "yellow"
  | "green"
  | "blue"
  | "pink"
  | "orange"
  | "purple"
  | "grey"
  | "ink";
export type BoardKind =
  | "sticky"
  | "text"
  | "rect"
  | "ellipse"
  | "diamond"
  | "cylinder"
  | "document"
  | "cloud"
  | "queue"
  | "section"
  | "arrow"
  | "pen"
  | "image";
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
  /** section: the section container this block belongs to, so moving or tidying keeps them together. */
  section?: string;
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
const INK_LIGHT: Record<BoardColor, string> = {
  yellow: "#CA8A04",
  green: "#4D9A2A",
  blue: "#2563EB",
  pink: "#DB2777",
  orange: "#EA580C",
  purple: "#7C3AED",
  grey: "#6B7280",
  ink: "#1E293B",
};
const INK_DARK: Record<BoardColor, string> = {
  ...INK_LIGHT,
  ink: "#E2E8F0",
};
const ACCENT = "#76BF43";
const COLORS = Object.keys(FILL) as BoardColor[];
const BOXED = new Set<BoardKind>([
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
  "image",
]);
const WORDS = new Set<BoardKind>([
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
  "image",
]);
const CLICK_SIZE: Partial<Record<BoardKind, { w: number; h: number }>> = {
  sticky: { w: 180, h: 180 },
  text: { w: 220, h: 48 },
  section: { w: 480, h: 280 },
  diamond: { w: 160, h: 110 },
  cylinder: { w: 150, h: 100 },
  document: { w: 140, h: 110 },
  cloud: { w: 180, h: 110 },
  queue: { w: 170, h: 80 },
};
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

type ResizeCorner = "nw" | "ne" | "sw" | "se";

function useDarkTheme(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

function BoardImage({
  item,
  resolveAsset,
  cardFill,
  borderStroke,
}: {
  item: BoardItem;
  resolveAsset?: (assetId: string) => Promise<string | null>;
  cardFill: string;
  borderStroke: string;
}) {
  const sdkUrl = useAsset(resolveAsset ? null : item.asset);
  const [resolved, setResolved] = useState<string | null>(null);
  useEffect(() => {
    if (!resolveAsset || !item.asset) {
      setResolved(null);
      return;
    }
    if (item.asset.startsWith("data:") || item.asset.startsWith("https://")) {
      setResolved(item.asset);
      return;
    }
    let cancelled = false;
    resolveAsset(item.asset).then(
      (value) => {
        if (!cancelled) setResolved(value);
      },
      () => {
        if (!cancelled) setResolved(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [item.asset, resolveAsset]);
  const url = resolveAsset ? resolved : sdkUrl;
  const hasCaption = Boolean((item.text ?? "").trim());
  const imgH = hasCaption ? Math.max(40, item.h - 32) : item.h;
  const clipId = `clip-img-${item.id.replace(/[^A-Za-z0-9_-]/g, "")}`;
  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <rect
            x={item.x + 2}
            y={item.y + 2}
            width={Math.max(1, item.w - 4)}
            height={Math.max(1, imgH - 4)}
            rx={10}
          />
        </clipPath>
      </defs>
      <rect
        x={item.x}
        y={item.y}
        width={item.w}
        height={item.h}
        rx={12}
        fill={cardFill}
        stroke={borderStroke}
        strokeOpacity={0.35}
        strokeWidth={1.5}
      />
      {url ? (
        <image
          href={url}
          x={item.x + 4}
          y={item.y + 4}
          width={Math.max(1, item.w - 8)}
          height={Math.max(1, imgH - 8)}
          clipPath={`url(#${clipId})`}
          preserveAspectRatio="xMidYMid meet"
        />
      ) : (
        <rect
          x={item.x + 6}
          y={item.y + 6}
          width={Math.max(1, item.w - 12)}
          height={Math.max(1, imgH - 12)}
          rx={8}
          fill={borderStroke}
          fillOpacity={0.1}
        />
      )}
    </>
  );
}

/**
 * A whiteboard: sticky notes, text, boxes, diamonds, cylinders, documents, clouds, queues and
 * sections, arrows that stay attached to what they join, freehand pen and pictures, on a board
 * that pans and zooms (scroll, pinch, or the hand). Select to move, resize, recolour or delete;
 * double-click to edit words; undo with Ctrl/Cmd+Z. The value is plain JSON ({items}) for a
 * longtext column, and onChange hears each finished change, so colleagues' saves arrive live.
 */
export function Whiteboard({
  value,
  onChange,
  onSelectionChange,
  onUploadImage,
  resolveAsset,
  readOnly,
  height = 560,
  className,
}: {
  value: BoardValue | string | null | undefined;
  onChange?: (value: BoardValue) => void;
  /** Ids selected now, including an empty list, so a chat can tell the assistant which blocks. */
  onSelectionChange?: (ids: string[]) => void;
  /** Optional host upload handler (used when mounted outside an App Studio frame). */
  onUploadImage?: (file: File) => Promise<string>;
  /** Optional host asset resolver returning a displayable data/https URL for an asset id. */
  resolveAsset?: (assetId: string) => Promise<string | null>;
  readOnly?: boolean;
  height?: number | string;
  className?: string;
}) {
  const dark = useDarkTheme();
  const INK = dark ? INK_DARK : INK_LIGHT;
  const cardFill = dark ? "#1E293B" : "#FFFFFF";
  const borderColor = dark ? "#334155" : "#CBD5E1";
  const markerPrefix = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const sdkCanUpload = useCanUpload();
  const editable = !readOnly && Boolean(onChange);
  const canUpload = (Boolean(onUploadImage) || sdkCanUpload) && editable;
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
    | { kind: "resize"; id: string; corner: ResizeCorner; start: Point; origin: BoardItem }
    | { kind: "arrow-end"; id: string; end: "from" | "to"; origin: BoardItem }
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
    let fallbackSection: BoardItem | undefined;
    for (const element of document.elementsFromPoint(clientX, clientY)) {
      const id = element.closest<SVGElement | HTMLElement>("[data-board-item]")?.dataset.boardItem;
      if (!id || id === skip) continue;
      const found = byId.get(id);
      if (!found || found.kind === "arrow") continue;
      if (found.kind === "section") {
        fallbackSection ??= found;
        continue;
      }
      return found;
    }
    return fallbackSection;
  };
  const findEnclosingSection = (
    boxRect: { x: number; y: number; w: number; h: number },
    selfId?: string,
  ): string | undefined => {
    const cx = boxRect.x + boxRect.w / 2;
    const cy = boxRect.y + boxRect.h / 2;
    const candidates = items
      .filter(
        (sec) =>
          sec.kind === "section" &&
          sec.id !== selfId &&
          cx >= sec.x &&
          cx <= sec.x + sec.w &&
          cy >= sec.y + 40 &&
          cy <= sec.y + sec.h,
      )
      .sort((a, b) => a.w * a.h - b.w * b.h);
    return candidates[0]?.id;
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
  const showAll = (list: BoardItem[] = items) => {
    const bounds = boardBounds(list);
    const rect = box.current?.getBoundingClientRect();
    if (!bounds || !rect || rect.width < 10) return setView({ x: -40, y: -40, zoom: 1 });
    const topBar = editable ? 72 : 24;
    const availH = Math.max(120, rect.height - topBar - 56);
    const availW = Math.max(160, rect.width - 96);
    const zoom = Math.min(
      MAX_ZOOM,
      Math.max(
        MIN_ZOOM,
        Math.min(availW / Math.max(bounds.w, 120), availH / Math.max(bounds.h, 120), 1.15),
      ),
    );
    setView({
      zoom,
      x: bounds.x + bounds.w / 2 - rect.width / 2 / zoom,
      y: bounds.y + bounds.h / 2 - (topBar + availH / 2) / zoom,
    });
  };
  const fittedOnce = useRef(items.length > 0);
  useEffect(() => {
    if (items.length) showAll(items);
  }, []);
  useEffect(() => {
    if (!fittedOnce.current && items.length > 0) {
      fittedOnce.current = true;
      showAll(items);
    }
  }, [items]);
  useEffect(() => {
    onSelectionChange?.(selected);
  }, [selected, onSelectionChange]);

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
    const arrowHandle = (event.target as Element).closest<HTMLElement | SVGElement>(
      "[data-board-arrow-end]",
    );
    if (arrowHandle && tool === "select") {
      const id = arrowHandle.dataset.boardArrowId as string;
      const end = (arrowHandle.dataset.boardArrowEnd as "from" | "to") ?? "to";
      const origin = byId.get(id);
      if (origin) {
        gesture.current = { kind: "arrow-end", id, end, origin };
        return;
      }
    }
    const handle = (event.target as Element).closest<HTMLElement | SVGElement>(
      "[data-board-resize]",
    );
    if (handle && tool === "select") {
      const id = handle.dataset.boardResize as string;
      const corner = (handle.dataset.boardCorner as ResizeCorner | undefined) ?? "se";
      gesture.current = {
        kind: "resize",
        id,
        corner,
        start: at,
        origin: byId.get(id) as BoardItem,
      };
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
        const movingIds = new Set(chosen);
        for (const key of chosen) {
          const picked = byId.get(key);
          if (picked?.kind === "section") {
            for (const child of items) {
              if (child.kind === "arrow" || child.kind === "section") continue;
              const cx = child.x + child.w / 2;
              const cy = child.y + child.h / 2;
              if (
                child.section === picked.id ||
                (cx >= picked.x &&
                  cx <= picked.x + picked.w &&
                  cy >= picked.y &&
                  cy <= picked.y + picked.h)
              ) {
                movingIds.add(child.id);
              }
            }
          }
        }
        gesture.current = {
          kind: "move",
          start: at,
          origin: new Map(
            [...movingIds].flatMap((key) =>
              byId.get(key) ? [[key, byId.get(key) as BoardItem]] : [],
            ),
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
    } else if (now.kind === "arrow-end") {
      const target = itemAt(event.clientX, event.clientY, now.id);
      const nextEnd: BoardEnd = target ? { item: target.id } : at;
      setItems((list) =>
        list.map((item) => (item.id === now.id ? { ...item, [now.end]: nextEnd } : item)),
      );
    } else if (now.kind === "resize") {
      const dx = at.x - now.start.x;
      const dy = at.y - now.start.y;
      const minW = now.origin.kind === "section" ? 160 : 48;
      const minH = now.origin.kind === "section" ? 120 : 34;
      const west = now.corner === "nw" || now.corner === "sw";
      const north = now.corner === "nw" || now.corner === "ne";
      const w = west ? Math.max(minW, now.origin.w - dx) : Math.max(minW, now.origin.w + dx);
      let h = north ? Math.max(minH, now.origin.h - dy) : Math.max(minH, now.origin.h + dy);
      if (now.origin.kind === "image" && !event.shiftKey && now.origin.w > 0) {
        h = Math.max(minH, (w * now.origin.h) / now.origin.w);
      }
      const x = west ? now.origin.x + (now.origin.w - w) : now.origin.x;
      const y = north ? now.origin.y + (now.origin.h - h) : now.origin.y;
      setItems((list) => list.map((item) => (item.id === now.id ? { ...item, x, y, w, h } : item)));
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
    if (now.kind === "move" || now.kind === "resize" || now.kind === "arrow-end") {
      const before = now.kind === "move" ? [...now.origin.values()] : [now.origin];
      const changed = before.some((origin) => {
        const after = items.find((item) => item.id === origin.id);
        return (
          after &&
          (after.x !== origin.x ||
            after.y !== origin.y ||
            after.w !== origin.w ||
            after.h !== origin.h ||
            JSON.stringify(after.from) !== JSON.stringify(origin.from) ||
            JSON.stringify(after.to) !== JSON.stringify(origin.to))
        );
      });
      if (changed) {
        const previous = items.map(
          (item) => before.find((origin) => origin.id === item.id) ?? item,
        );
        const updated =
          now.kind === "move"
            ? items.map((item) => {
                if (!now.origin.has(item.id) || item.kind === "section" || item.kind === "arrow") {
                  return item;
                }
                // Update section membership when a standalone block is moved into or out of a section.
                if ([...now.origin.values()].some((o) => o.kind === "section")) return item;
                const secId = findEnclosingSection(item, item.id);
                return secId ? { ...item, section: secId } : { ...item, section: undefined };
              })
            : items;
        commit(updated, previous);
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
        const size = CLICK_SIZE[draft.kind] ?? { w: 160, h: 110 };
        made = {
          ...draft,
          ...size,
          x: draft.x - (draft.kind === "text" ? 0 : size.w / 2),
          y: draft.y - (draft.kind === "text" ? 24 : size.h / 2),
        };
      }
      setDraft(null);
      if (made) {
        if (made.kind !== "section" && made.kind !== "arrow" && made.kind !== "pen") {
          const secId = findEnclosingSection(made, made.id);
          if (secId) made = { ...made, section: secId };
        }
        commit([...items, made]);
        setSelected([made.id]);
        if (WORDS.has(made.kind) && made.kind !== "arrow" && made.kind !== "image") {
          setEditing(made.id);
        }
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
      const asset = onUploadImage ? await onUploadImage(file) : await uploadImage(file);
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
      d: "diamond",
      c: "cylinder",
      f: "document",
      k: "cloud",
      q: "queue",
      s: "section",
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
    { tool: "diamond", label: "Decision", icon: <Diamond />, key: "D" },
    { tool: "cylinder", label: "Database", icon: <Database />, key: "C" },
    { tool: "document", label: "Document", icon: <FileText />, key: "F" },
    { tool: "cloud", label: "Cloud", icon: <Cloud />, key: "K" },
    { tool: "queue", label: "Queue", icon: <Rows3 />, key: "Q" },
    { tool: "section", label: "Section", icon: <Frame />, key: "S" },
    {
      tool: "arrow",
      label: "Arrow (drag from one item to another to join them)",
      icon: <ArrowUpRight />,
      key: "A",
    },
    { tool: "pen", label: "Pen", icon: <Pencil />, key: "P" },
  ];

  const shown = useMemo(
    () =>
      [...(draft ? [...items, draft] : items)].sort((a, b) =>
        a.kind === b.kind ? 0 : a.kind === "section" ? -1 : b.kind === "section" ? 1 : 0,
      ),
    [items, draft],
  );
  const routedArrows = useMemo(() => computeBoardArrows(shown), [shown]);
  const single = selected.length === 1 ? byId.get(selected[0]!) : undefined;

  const words = (item: BoardItem, align: "center" | "start") => {
    const isEditing = editing === item.id;
    const label = item.kind === "arrow";
    const isSection = item.kind === "section";
    const isImage = item.kind === "image";
    if (isImage && !isEditing && !(item.text ?? "").trim()) return null;
    const size =
      label || isImage
        ? 12
        : item.kind === "text"
          ? 22
          : isSection
            ? 14
            : item.kind === "sticky"
              ? 16
              : 14;
    const textColor =
      item.kind === "text" || isSection || isImage
        ? INK[item.color ?? "ink"]
        : item.color === "ink"
          ? dark
            ? "#F8FAFC"
            : "#111827"
          : "#111827";
    const boxY = isSection ? item.y + 6 : isImage ? item.y + Math.max(8, item.h - 30) : item.y;
    const boxH = isSection ? 42 : isImage ? 28 : Math.max(item.h, 1);
    return (
      <foreignObject
        x={item.x}
        y={boxY}
        width={Math.max(item.w, 1)}
        height={boxH}
        style={{ pointerEvents: isEditing || isSection ? "auto" : "none" }}
      >
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
            className="h-full w-full resize-none bg-transparent p-2.5 outline-none"
            style={{
              fontSize: size,
              color: textColor,
              textAlign: align === "center" ? "center" : "left",
              lineHeight: 1.3,
              background: label || isImage ? cardFill : undefined,
              borderRadius: label ? 999 : undefined,
            }}
          />
        ) : (
          <div
            className={cn(
              "flex h-full w-full overflow-hidden break-words whitespace-pre-wrap select-none",
              label
                ? "items-center justify-center px-2.5 py-0.5 text-center"
                : isImage
                  ? "items-center justify-center px-3 text-center"
                  : isSection
                    ? "items-center px-4"
                    : item.kind === "diamond"
                      ? "items-center justify-center px-7 py-4 text-center"
                      : "p-3.5",
              !label && !isSection && !isImage && align === "center"
                ? "items-center justify-center text-center"
                : "",
              !label && !isSection && !isImage && align === "start" ? "items-start" : "",
            )}
            style={{
              fontSize: size,
              color: textColor,
              lineHeight: 1.32,
              fontWeight: item.kind === "text" || isSection ? 700 : 500,
              letterSpacing: isSection ? "0.02em" : undefined,
              background: label ? cardFill : undefined,
              border: label ? `1px solid ${borderColor}` : undefined,
              borderRadius: label ? 999 : undefined,
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
              id={`${markerPrefix}-head-${name}`}
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
          <marker
            id={`${markerPrefix}-head-selected`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 Z" fill={ACCENT} />
          </marker>
        </defs>
        <g transform={`scale(${view.zoom}) translate(${-view.x} ${-view.y})`}>
          {/* Pass 1: sections and shapes */}
          {shown
            .filter((item) => item.kind !== "arrow")
            .map((item) => {
              const isSelected = selected.includes(item.id);
              const ink = INK[item.color ?? "ink"];
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
                        stroke={ACCENT}
                        strokeDasharray="4 3"
                        strokeWidth={1.5 / view.zoom}
                      />
                    )}
                  </g>
                );
              }
              const shapeFill = (fallback: BoardColor) =>
                item.color === "ink" ? cardFill : FILL[item.color ?? fallback];
              return (
                <g key={item.id} data-board-item={item.id === draft?.id ? undefined : item.id}>
                  {item.kind === "diamond" && (
                    <polygon
                      points={`${item.x + item.w / 2},${item.y} ${item.x + item.w},${item.y + item.h / 2} ${item.x + item.w / 2},${item.y + item.h} ${item.x},${item.y + item.h / 2}`}
                      fill={shapeFill("orange")}
                      fillOpacity={item.color === "ink" ? 0.96 : 0.78}
                      stroke={ink}
                      strokeWidth={2.2}
                    />
                  )}
                  {item.kind === "cylinder" && (
                    <>
                      <path
                        d={`M${item.x},${item.y + 16} L${item.x},${item.y + item.h - 16} A${item.w / 2},16 0 0 0 ${item.x + item.w},${item.y + item.h - 16} L${item.x + item.w},${item.y + 16}`}
                        fill={shapeFill("blue")}
                        fillOpacity={item.color === "ink" ? 0.96 : 0.78}
                        stroke={ink}
                        strokeWidth={2.2}
                      />
                      <ellipse
                        cx={item.x + item.w / 2}
                        cy={item.y + 16}
                        rx={item.w / 2}
                        ry={16}
                        fill={shapeFill("blue")}
                        stroke={ink}
                        strokeWidth={2.2}
                      />
                    </>
                  )}
                  {item.kind === "document" && (
                    <>
                      <path
                        d={`M${item.x},${item.y} H${item.x + item.w - 22} L${item.x + item.w},${item.y + 22} V${item.y + item.h} H${item.x} Z`}
                        fill={shapeFill("grey")}
                        fillOpacity={item.color === "ink" ? 0.96 : 0.78}
                        stroke={ink}
                        strokeWidth={2.2}
                      />
                      <path
                        d={`M${item.x + item.w - 22},${item.y} V${item.y + 22} H${item.x + item.w}`}
                        fill="none"
                        stroke={ink}
                        strokeWidth={1.8}
                      />
                    </>
                  )}
                  {item.kind === "cloud" && (
                    <path
                      d={cloudPath(item)}
                      fill={shapeFill("green")}
                      fillOpacity={item.color === "ink" ? 0.96 : 0.78}
                      stroke={ink}
                      strokeWidth={2.2}
                    />
                  )}
                  {item.kind === "queue" && (
                    <>
                      <rect
                        x={item.x}
                        y={item.y}
                        width={item.w}
                        height={item.h}
                        rx={10}
                        fill={shapeFill("purple")}
                        fillOpacity={item.color === "ink" ? 0.96 : 0.65}
                        stroke={ink}
                        strokeWidth={2.2}
                      />
                      {[0.32, 0.52, 0.72].map((at) => (
                        <line
                          key={at}
                          x1={item.x + 14}
                          x2={item.x + item.w - 14}
                          y1={item.y + item.h * at}
                          y2={item.y + item.h * at}
                          stroke={ink}
                          strokeWidth={1.5}
                          strokeOpacity={0.45}
                        />
                      ))}
                    </>
                  )}
                  {item.kind === "section" && (
                    <>
                      <rect
                        x={item.x}
                        y={item.y}
                        width={item.w}
                        height={item.h}
                        rx={18}
                        fill={FILL[item.color ?? "grey"]}
                        fillOpacity={0.22}
                        stroke="none"
                        pointerEvents="none"
                      />
                      {/* Only the header bar and border stroke capture pointer events so marquee & arrows work inside sections */}
                      <rect
                        x={item.x}
                        y={item.y}
                        width={item.w}
                        height={Math.min(50, item.h)}
                        rx={18}
                        fill="transparent"
                        className="cursor-move"
                      />
                      <rect
                        x={item.x}
                        y={item.y}
                        width={item.w}
                        height={item.h}
                        rx={18}
                        fill="none"
                        stroke={ink}
                        strokeWidth={1.75}
                        strokeOpacity={0.65}
                        pointerEvents="stroke"
                        className="cursor-move"
                      />
                      <line
                        x1={item.x + 16}
                        x2={item.x + item.w - 16}
                        y1={item.y + 48}
                        y2={item.y + 48}
                        stroke={ink}
                        strokeOpacity={0.22}
                        strokeWidth={1}
                        pointerEvents="none"
                      />
                    </>
                  )}
                  {item.kind === "sticky" && (
                    <rect
                      x={item.x}
                      y={item.y}
                      width={item.w}
                      height={item.h}
                      rx={8}
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
                      fill={shapeFill("grey")}
                      fillOpacity={item.color === "ink" ? 0.96 : 0.68}
                      stroke={ink}
                      strokeWidth={2.2}
                    />
                  )}
                  {item.kind === "ellipse" && (
                    <ellipse
                      cx={item.x + item.w / 2}
                      cy={item.y + item.h / 2}
                      rx={item.w / 2}
                      ry={item.h / 2}
                      fill={shapeFill("grey")}
                      fillOpacity={item.color === "ink" ? 0.96 : 0.68}
                      stroke={ink}
                      strokeWidth={2.2}
                    />
                  )}
                  {item.kind === "text" && (
                    <rect x={item.x} y={item.y} width={item.w} height={item.h} fill="transparent" />
                  )}
                  {item.kind === "image" && (
                    <BoardImage
                      item={item}
                      resolveAsset={resolveAsset}
                      cardFill={cardFill}
                      borderStroke={ink}
                    />
                  )}
                  {WORDS.has(item.kind) &&
                    words(
                      item,
                      item.kind === "text" || item.kind === "section" ? "start" : "center",
                    )}
                  {isSelected && (
                    <rect
                      x={item.x - 3}
                      y={item.y - 3}
                      width={item.w + 6}
                      height={item.h + 6}
                      rx={8}
                      fill="none"
                      stroke={ACCENT}
                      strokeWidth={2 / view.zoom}
                      pointerEvents="none"
                    />
                  )}
                </g>
              );
            })}

          {/* Pass 2: connector lines drawn above shapes */}
          {shown
            .filter((item) => item.kind === "arrow")
            .map((item) => {
              const routed = routedArrows.get(item.id);
              if (!routed) return null;
              const d = roundedOrthogonalPath(routed.points);
              if (!d) return null;
              const isSelected = selected.includes(item.id);
              const ink = INK[item.color ?? "ink"];
              return (
                <g
                  key={item.id}
                  data-board-item={item.id === draft?.id ? undefined : item.id}
                  className={item.id === draft?.id ? "pointer-events-none" : "cursor-pointer"}
                >
                  <path d={d} fill="none" stroke="transparent" strokeWidth={16 / view.zoom} />
                  <path
                    d={d}
                    fill="none"
                    stroke={isSelected ? ACCENT : ink}
                    strokeWidth={2.4}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    markerEnd={`url(#${markerPrefix}-head-${isSelected ? "selected" : (item.color ?? "ink")})`}
                  />
                </g>
              );
            })}

          {/* Pass 3: non-overlapping arrow label pills drawn above all connector lines */}
          {shown
            .filter((item) => item.kind === "arrow")
            .map((item) => {
              const routed = routedArrows.get(item.id);
              if (!routed || (!item.text && editing !== item.id)) return null;
              const fallbackMid =
                routed.points.length >= 2
                  ? {
                      x: (routed.points[0]!.x + routed.points[routed.points.length - 1]!.x) / 2,
                      y: (routed.points[0]!.y + routed.points[routed.points.length - 1]!.y) / 2,
                    }
                  : { x: 0, y: 0 };
              const editSize = measureArrowLabel(item.text || "Label") ?? { w: 112, h: 26 };
              const boxRect = routed.label ?? {
                x: Math.round(fallbackMid.x - editSize.w / 2),
                y: Math.round(fallbackMid.y - editSize.h / 2),
                w: editSize.w,
                h: editSize.h,
              };
              return (
                <g key={`${item.id}-label`} data-board-item={item.id} className="cursor-pointer">
                  {words(
                    { ...item, x: boxRect.x, y: boxRect.y, w: boxRect.w, h: boxRect.h },
                    "center",
                  )}
                </g>
              );
            })}
          {single &&
            editable &&
            BOXED.has(single.kind) &&
            (
              [
                ["nw", single.x, single.y, "cursor-nwse-resize"],
                ["ne", single.x + single.w, single.y, "cursor-nesw-resize"],
                ["sw", single.x, single.y + single.h, "cursor-nesw-resize"],
                ["se", single.x + single.w, single.y + single.h, "cursor-nwse-resize"],
              ] as const
            ).map(([corner, cx, cy, cursor]) => (
              <rect
                key={corner}
                data-board-resize={single.id}
                data-board-corner={corner}
                x={cx - 6 / view.zoom}
                y={cy - 6 / view.zoom}
                width={12 / view.zoom}
                height={12 / view.zoom}
                rx={3 / view.zoom}
                fill={cardFill}
                stroke={ACCENT}
                strokeWidth={2 / view.zoom}
                className={cursor}
              />
            ))}
          {single &&
            editable &&
            single.kind === "arrow" &&
            (() => {
              const pts = routedArrows.get(single.id)?.points;
              if (!pts || pts.length < 2) return null;
              const startPt = pts[0]!;
              const endPt = pts[pts.length - 1]!;
              return (
                <>
                  {(
                    [
                      ["from", startPt],
                      ["to", endPt],
                    ] as const
                  ).map(([which, pt]) => (
                    <circle
                      key={which}
                      data-board-arrow-end={which}
                      data-board-arrow-id={single.id}
                      cx={pt.x}
                      cy={pt.y}
                      r={6 / view.zoom}
                      fill={cardFill}
                      stroke={ACCENT}
                      strokeWidth={2 / view.zoom}
                      className="cursor-grab"
                    />
                  ))}
                </>
              );
            })()}
          {marquee && (
            <rect
              x={Math.min(marquee.a.x, marquee.b.x)}
              y={Math.min(marquee.a.y, marquee.b.y)}
              width={Math.abs(marquee.a.x - marquee.b.x)}
              height={Math.abs(marquee.a.y - marquee.b.y)}
              fill="rgba(118, 191, 67, 0.1)"
              stroke={ACCENT}
              strokeDasharray="5 4"
              strokeWidth={1.2 / view.zoom}
              pointerEvents="none"
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
              (box.current?.getBoundingClientRect().top ?? 0) +
                (box.current?.clientHeight ?? 560) / 2,
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
              (box.current?.getBoundingClientRect().top ?? 0) +
                (box.current?.clientHeight ?? 560) / 2,
            )
          }
        >
          <Plus />
        </BoardButton>
        <BoardButton label="Show everything" onClick={() => showAll()}>
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

function cloudPath(item: BoardItem): string {
  const { x, y, w, h } = item;
  const p = (px: number, py: number) => `${x + w * px},${y + h * py}`;
  return `M ${p(0.22, 0.62)} C ${p(0.02, 0.62)} ${p(0.04, 0.32)} ${p(0.28, 0.34)} C ${p(0.32, 0.12)} ${p(0.58, 0.08)} ${p(0.64, 0.32)} C ${p(0.88, 0.16)} ${p(1.02, 0.42)} ${p(0.84, 0.58)} C ${p(1, 0.78)} ${p(0.72, 0.96)} ${p(0.5, 0.76)} C ${p(0.32, 0.98)} ${p(0.04, 0.86)} ${p(0.22, 0.62)} Z`;
}

/** The board fitted into a chat card, without the editor. */
export function BoardThumbnail({
  value,
  className,
}: {
  value: BoardValue | string | null | undefined;
  className?: string;
}) {
  const dark = useDarkTheme();
  const INK = dark ? INK_DARK : INK_LIGHT;
  const cardFill = dark ? "#1E293B" : "#FFFFFF";
  const items = readBoard(value).items;
  const routedMap = useMemo(() => computeBoardArrows(items), [items]);
  const bounds = boardBounds(items) ?? { x: 0, y: 0, w: 320, h: 180 };
  const pad = 28;
  return (
    <svg
      viewBox={`${bounds.x - pad} ${bounds.y - pad} ${Math.max(bounds.w, 40) + pad * 2} ${Math.max(bounds.h, 40) + pad * 2}`}
      className={cn("h-full w-full bg-card", className)}
      role="img"
      aria-label="Whiteboard"
    >
      {items.map((item) => {
        const ink = INK[item.color ?? "ink"];
        const fill = item.color === "ink" ? cardFill : FILL[item.color ?? "grey"];
        if (item.kind === "arrow") {
          const pts = routedMap.get(item.id)?.points;
          if (!pts) return null;
          return (
            <path
              key={item.id}
              d={roundedOrthogonalPath(pts, 8)}
              fill="none"
              stroke={ink}
              strokeWidth={2}
            />
          );
        }
        if (item.kind === "pen" || item.kind === "image") return null;
        return (
          <rect
            key={item.id}
            x={item.x}
            y={item.y}
            width={Math.max(item.w, 1)}
            height={Math.max(item.h, 1)}
            rx={item.kind === "ellipse" || item.kind === "cloud" ? item.h / 2 : 8}
            fill={fill}
            fillOpacity={item.kind === "section" ? 0.35 : 0.8}
            stroke={ink}
            strokeWidth={1.5}
          />
        );
      })}
    </svg>
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
