import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Tone } from "../schema.js";
import { Badge, Button } from "./basic.js";
import { cn, TONE_DOT, toneFor } from "./cn.js";

type AnyRow = Record<string, unknown> & { _id?: string };

/** Where a card was dropped: its lane, its place in the lane and an order value to save. */
export type KanbanDrop<T> = {
  index: number;
  before: T | null;
  after: T | null;
  /** A number between its new neighbours' orderBy values, ready to save in that field. */
  order: number;
};

const HOLD_MS = 260;

/**
 * Cards in columns by a field (status, stage, owner). With onMove, cards drag between columns and
 * (with orderBy) up and down within one: mouse drag, press and hold on touch, or Alt + arrow keys.
 * The move shows at once.
 */
export function Kanban<T extends AnyRow>({
  rows,
  groupBy,
  orderBy,
  columns,
  renderCard,
  onMove,
  onOpen,
  onAdd,
  className,
}: {
  rows: T[];
  groupBy: string;
  /** A number field that orders cards in a column; dragging up or down saves a new value. */
  orderBy?: string;
  /** Column order and tones; values found in rows are added after. */
  columns?: Array<{ value: string; label?: string; tone?: Tone }>;
  renderCard: (row: T) => ReactNode;
  /** A card moved: save row[groupBy] = value (and row[orderBy] = drop.order when ordering). */
  onMove?: (row: T, value: string, drop: KanbanDrop<T>) => void;
  onOpen?: (row: T) => void;
  /** An Add button under each column. */
  onAdd?: (value: string) => void;
  className?: string;
}) {
  const board = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{
    id: string;
    lane: string;
    index: number;
    x: number;
    y: number;
    dx: number;
    dy: number;
    width: number;
    height: number;
  } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const justDropped = useRef(0);
  const touched = useRef(false);
  const lanes = useMemo(() => {
    const list = [...(columns ?? [])];
    for (const row of rows) {
      const value = String(row[groupBy] ?? "");
      if (value && !list.some((lane) => lane.value === value)) list.push({ value });
    }
    if (rows.some((row) => !row[groupBy]))
      list.push({ value: "", label: "Unassigned", tone: "neutral" });
    return list;
  }, [rows, groupBy, columns]);
  const laneRows = useCallback(
    (value: string, without?: string) => {
      const items = rows.filter(
        (row) => String(row[groupBy] ?? "") === value && row._id !== without,
      );
      if (!orderBy) return items;
      const rank = (row: T) => {
        const n = Number(row[orderBy]);
        return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
      };
      return [...items].sort((a, b) => rank(a) - rank(b));
    },
    [rows, groupBy, orderBy],
  );

  const drop = useCallback(
    (row: T, value: string, index: number) => {
      if (!onMove) return;
      const items = laneRows(value, row._id);
      const at = Math.min(Math.max(index, 0), items.length);
      const before = items[at - 1] ?? null;
      const after = items[at] ?? null;
      const value_ = (item: T | null, fallback: number) => {
        const n = orderBy && item ? Number(item[orderBy]) : Number.NaN;
        return Number.isFinite(n) ? n : fallback;
      };
      const low = value_(before, at - 1);
      const high = value_(after, at + 1);
      const order = before && after ? (low + high) / 2 : before ? low + 1 : after ? high - 1 : 0;
      const sameLane = String(row[groupBy] ?? "") === value;
      const oldIndex = laneRows(value).findIndex((item) => item._id === row._id);
      if (sameLane && (!orderBy || oldIndex === at)) return;
      onMove(row, value, { index: at, before, after, order });
    },
    [onMove, laneRows, orderBy, groupBy],
  );

  // The lane and slot under the pointer, from the cards' boxes on screen.
  const target = (x: number, y: number, id: string) => {
    const lane = (document.elementFromPoint(x, y) as Element | null)?.closest<HTMLElement>(
      "[data-kanban-lane]",
    );
    if (!lane || !board.current?.contains(lane)) return null;
    const cards = [...lane.querySelectorAll<HTMLElement>("[data-kanban-card]")].filter(
      (card) => card.dataset.kanbanCard !== id,
    );
    const index = orderBy
      ? cards.filter((card) => {
          const box = card.getBoundingClientRect();
          return box.top + box.height / 2 < y;
        }).length
      : cards.length;
    return { lane: lane.dataset.kanbanLane ?? "", index };
  };

  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      const now = dragRef.current;
      if (!now) return;
      const spot = target(event.clientX, event.clientY, now.id);
      setDrag({ ...now, x: event.clientX, y: event.clientY, ...(spot ?? {}) });
      const box = board.current?.getBoundingClientRect();
      if (box && board.current) {
        if (event.clientX > box.right - 48) board.current.scrollLeft += 14;
        else if (event.clientX < box.left + 48) board.current.scrollLeft -= 14;
      }
    };
    const end = () => {
      const now = dragRef.current;
      setDrag(null);
      justDropped.current = Date.now();
      const row = now && rows.find((item) => item._id === now.id);
      if (row && now) drop(row, now.lane, now.index);
    };
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrag(null);
    };
    const holdStill = (event: TouchEvent) => event.preventDefault();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("keydown", cancel);
    document.addEventListener("touchmove", holdStill, { passive: false });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("keydown", cancel);
      document.removeEventListener("touchmove", holdStill);
    };
  }, [Boolean(drag)]);

  const pickUp = (event: ReactPointerEvent<HTMLElement>, row: T, lane: string, index: number) => {
    touched.current = event.pointerType !== "mouse";
    if (!onMove || !row._id || (event.pointerType === "mouse" && event.button !== 0)) return;
    const card = event.currentTarget;
    const start = { x: event.clientX, y: event.clientY };
    const begin = (x: number, y: number) => {
      const box = card.getBoundingClientRect();
      setDrag({
        id: row._id as string,
        lane,
        index,
        x,
        y,
        dx: start.x - box.left,
        dy: start.y - box.top,
        width: box.width,
        height: box.height,
      });
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", watch);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    const watch = (next: PointerEvent) => {
      const far = Math.hypot(next.clientX - start.x, next.clientY - start.y);
      if (event.pointerType === "mouse" && far > 5) {
        stop();
        begin(next.clientX, next.clientY);
      } else if (event.pointerType !== "mouse" && far > 8) stop();
    };
    if (event.pointerType !== "mouse") {
      timer = setTimeout(() => {
        stop();
        navigator.vibrate?.(12);
        begin(start.x, start.y);
      }, HOLD_MS);
    }
    window.addEventListener("pointermove", watch);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const keyMove = (
    event: ReactKeyboardEvent<HTMLElement>,
    row: T,
    laneAt: number,
    index: number,
  ) => {
    if (event.key === "Enter") return onOpen?.(row);
    if (!onMove || !event.altKey) return;
    const sideways = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    const upDown = { ArrowUp: -1, ArrowDown: 1 }[event.key];
    if (sideways) {
      const lane = lanes[laneAt + sideways];
      if (!lane) return;
      event.preventDefault();
      drop(row, lane.value, orderBy ? index : laneRows(lane.value).length);
    } else if (upDown && orderBy) {
      event.preventDefault();
      drop(row, lanes[laneAt]?.value ?? "", index + upDown);
    }
  };

  const dragged = drag ? rows.find((row) => row._id === drag.id) : undefined;
  return (
    <div ref={board} className={cn("flex gap-4 overflow-x-auto pb-2", className)}>
      {lanes.map((lane, laneAt) => {
        const items = laneRows(lane.value);
        const tone = lane.tone ?? toneFor(lane.value, "accent");
        const here = drag?.lane === lane.value;
        const placeholder = (
          <div
            key="__drop"
            className="rounded-xl border-2 border-dashed border-primary/50 bg-primary/5"
            style={{ height: drag?.height ?? 60 }}
          />
        );
        let slot = 0;
        return (
          <div
            key={lane.value || "_none"}
            data-kanban-lane={lane.value}
            className={cn(
              "flex w-[300px] shrink-0 flex-col rounded-2xl bg-muted/50 p-2 transition-colors",
              here && "bg-primary/10 ring-2 ring-primary/30",
            )}
          >
            <div className="flex items-center gap-2 px-2 pt-1.5 pb-2.5">
              <span className={cn("size-2 rounded-full", TONE_DOT[tone])} />
              <span className="text-[13px] font-bold">
                {lane.label ?? (lane.value || "Unassigned")}
              </span>
              <span className="ml-auto rounded-full bg-card px-2 text-xs font-semibold tabular text-muted-foreground">
                {items.length}
              </span>
            </div>
            <div className="flex min-h-16 flex-col gap-2">
              <AnimatePresence initial={false}>
                {items.flatMap((row) => {
                  const lifted = drag?.id === row._id;
                  const index = slot;
                  if (!lifted) slot++;
                  const card = (
                    <motion.div
                      key={row._id}
                      layout
                      className={cn(lifted && "hidden")}
                      initial={{ opacity: 0, scale: 0.97 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    >
                      {/* biome-ignore lint/a11y/useSemanticElements: a draggable card holding block content */}
                      <div
                        role="button"
                        tabIndex={0}
                        data-kanban-card={row._id}
                        aria-roledescription={onMove ? "Draggable card" : undefined}
                        aria-keyshortcuts={onMove ? "Alt+ArrowLeft Alt+ArrowRight" : undefined}
                        onKeyDown={(event) => keyMove(event, row, laneAt, index)}
                        onPointerDown={(event) => pickUp(event, row, lane.value, index)}
                        onContextMenu={(event) => {
                          if (onMove && touched.current) event.preventDefault();
                        }}
                        onClick={() => {
                          if (Date.now() - justDropped.current > 300) onOpen?.(row);
                        }}
                        className={cn(
                          "rounded-xl border border-border/70 bg-card p-3.5 shadow-card transition-shadow select-none hover:shadow-lift [-webkit-touch-callout:none]",
                          onMove && "cursor-grab active:cursor-grabbing",
                          onOpen && !onMove && "cursor-pointer",
                        )}
                      >
                        {renderCard(row)}
                      </div>
                    </motion.div>
                  );
                  return here && !lifted && drag.index === index ? [placeholder, card] : [card];
                })}
                {here && drag.index >= slot && placeholder}
              </AnimatePresence>
            </div>
            {onAdd && (
              <button
                type="button"
                onClick={() => onAdd(lane.value)}
                className="mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
              >
                <Plus className="size-4" /> Add
              </button>
            )}
          </div>
        );
      })}
      {drag &&
        dragged &&
        createPortal(
          <div
            className="pointer-events-none fixed z-50 rotate-2 rounded-xl border border-primary/40 bg-card p-3.5 shadow-2xl"
            style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.width }}
          >
            {renderCard(dragged)}
          </div>,
          document.body,
        )}
    </div>
  );
}

const DAY = 86_400_000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const isoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** A month grid with each row placed on its date. */
export function CalendarMonth<T extends AnyRow>({
  rows,
  dateKey,
  titleKey,
  toneKey,
  onOpen,
  initialMonth,
}: {
  rows: T[];
  dateKey: string;
  titleKey: string;
  /** A field whose value colours the entry (a status). */
  toneKey?: string;
  onOpen?: (row: T) => void;
  initialMonth?: string;
}) {
  const [month, setMonth] = useState(() => {
    const base = initialMonth ? new Date(`${initialMonth.slice(0, 7)}-01T00:00:00`) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const byDay = useMemo(() => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const value = String(row[dateKey] ?? "").slice(0, 10);
      if (!value) continue;
      map.set(value, [...(map.get(value) ?? []), row]);
    }
    return map;
  }, [rows, dateKey]);
  const start = new Date(month.getTime() - ((month.getDay() + 6) % 7) * DAY);
  const cells = Array.from(
    { length: 42 },
    (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index),
  );
  const today = isoDay(new Date());
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card">
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <h3 className="text-[15px] font-bold">
          {month.toLocaleDateString("en-IE", { month: "long", year: "numeric" })}
        </h3>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next month"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-border/70 bg-muted/40">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="px-2 py-2 text-center text-xs font-bold text-muted-foreground uppercase"
          >
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((date) => {
          const key = isoDay(date);
          const entries = byDay.get(key) ?? [];
          const inMonth = date.getMonth() === month.getMonth();
          return (
            <div
              key={key}
              className={cn(
                "min-h-[104px] border-r border-b border-border/50 p-1.5 [&:nth-child(7n)]:border-r-0",
                !inMonth && "bg-muted/25",
              )}
            >
              <div
                className={cn(
                  "mb-1 flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular",
                  key === today
                    ? "bg-primary text-primary-foreground"
                    : inMonth
                      ? "text-foreground"
                      : "text-muted-foreground/50",
                )}
              >
                {date.getDate()}
              </div>
              <div className="flex flex-col gap-1">
                {entries.slice(0, 3).map((row) => {
                  const tone = toneKey ? toneFor(row[toneKey], "accent") : "accent";
                  return (
                    <button
                      key={row._id}
                      type="button"
                      onClick={() => onOpen?.(row)}
                      className="flex items-center gap-1.5 truncate rounded-md bg-muted/70 px-1.5 py-1 text-left text-[11px] font-semibold hover:bg-muted"
                    >
                      <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
                      <span className="truncate">{String(row[titleKey] ?? "")}</span>
                    </button>
                  );
                })}
                {entries.length > 3 && (
                  <span className="px-1.5 text-[11px] font-semibold text-muted-foreground">
                    +{entries.length - 3} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Bars across time from a start to an end date, one row each (a simple Gantt). */
export function Timeline<T extends AnyRow>({
  rows,
  startKey,
  endKey,
  titleKey,
  toneKey,
  onOpen,
}: {
  rows: T[];
  startKey: string;
  endKey: string;
  titleKey: string;
  toneKey?: string;
  onOpen?: (row: T) => void;
}) {
  const items = rows
    .map((row) => {
      const start = Date.parse(String(row[startKey] ?? ""));
      const end = Date.parse(String(row[endKey] ?? row[startKey] ?? ""));
      return Number.isNaN(start)
        ? null
        : { row, start, end: Number.isNaN(end) || end < start ? start + DAY : end + DAY };
    })
    .filter((item): item is { row: T; start: number; end: number } => item !== null)
    .sort((a, b) => a.start - b.start);
  if (!items.length) return null;
  const min = Math.min(...items.map((item) => item.start));
  const max = Math.max(...items.map((item) => item.end));
  const span = Math.max(max - min, DAY);
  const months: Date[] = [];
  for (
    let cursor = new Date(new Date(min).getFullYear(), new Date(min).getMonth(), 1);
    cursor.getTime() <= max;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  ) {
    months.push(cursor);
  }
  const today = Date.now();
  const toneClass: Record<Tone, string> = {
    accent: "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-destructive",
    info: "bg-info",
    neutral: "bg-muted-foreground/60",
  };
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card">
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="relative ml-[220px] h-9 border-b border-border/70">
            {months.map((date) => (
              <span
                key={date.toISOString()}
                className="absolute top-2.5 text-xs font-bold whitespace-nowrap text-muted-foreground"
                style={{ left: `${Math.max(0, ((date.getTime() - min) / span) * 100)}%` }}
              >
                {date.toLocaleDateString("en-IE", { month: "short", year: "2-digit" })}
              </span>
            ))}
          </div>
          <div className="relative">
            {today > min && today < max && (
              <div className="pointer-events-none absolute inset-y-0 z-10 ml-[220px] w-[calc(100%-220px)]">
                <div
                  className="absolute inset-y-0 w-px bg-destructive/60"
                  style={{ left: `${((today - min) / span) * 100}%` }}
                />
              </div>
            )}
            {items.map(({ row, start, end }, index) => {
              const tone = toneKey ? toneFor(row[toneKey], "accent") : "accent";
              return (
                <div
                  key={row._id ?? index}
                  className="flex h-11 items-center border-b border-border/40 last:border-0"
                >
                  <button
                    type="button"
                    onClick={() => onOpen?.(row)}
                    className="w-[220px] shrink-0 truncate px-4 text-left text-[13px] font-semibold hover:text-primary"
                  >
                    {String(row[titleKey] ?? "")}
                  </button>
                  <div className="relative h-full flex-1">
                    <motion.button
                      type="button"
                      onClick={() => onOpen?.(row)}
                      initial={{ scaleX: 0, opacity: 0 }}
                      animate={{ scaleX: 1, opacity: 1 }}
                      transition={{ duration: 0.6, delay: index * 0.03, ease: [0.22, 1, 0.36, 1] }}
                      style={{
                        left: `${((start - min) / span) * 100}%`,
                        width: `${Math.max(((end - start) / span) * 100, 0.8)}%`,
                        transformOrigin: "left",
                      }}
                      className={cn(
                        "absolute top-3 h-5 rounded-md shadow-sm hover:brightness-110",
                        toneClass[tone],
                      )}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A vertical list of dated events, newest first. */
export function ActivityFeed({
  items,
}: {
  items: Array<{
    id: string;
    title: ReactNode;
    description?: ReactNode;
    date?: string;
    tone?: Tone;
    icon?: ReactNode;
  }>;
}) {
  return (
    <ol className="relative flex flex-col gap-5 pl-6 before:absolute before:top-1 before:bottom-1 before:left-[7px] before:w-px before:bg-border">
      {items.map((item, index) => (
        <motion.li
          key={item.id}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.04 }}
          className="relative"
        >
          <span
            className={cn(
              "absolute top-1 -left-6 size-[15px] rounded-full border-[3px] border-card",
              TONE_DOT[item.tone ?? "accent"],
            )}
          />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">{item.title}</p>
            {item.date && <span className="text-xs text-muted-foreground">{item.date}</span>}
          </div>
          {item.description && (
            <p className="mt-0.5 text-[13px] text-muted-foreground">{item.description}</p>
          )}
        </motion.li>
      ))}
    </ol>
  );
}

export { Badge };
