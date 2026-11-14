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
import { Avatar, Badge, Button } from "./basic.js";
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
                          "rounded-xl border border-border/70 bg-card p-3.5 shadow-card transition-[transform,box-shadow,border-color] duration-200 select-none hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lift [-webkit-touch-callout:none]",
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

export type CalendarViewMode = "month" | "week" | "agenda";

/** A month, week or agenda calendar view with each row placed on its date. */
export function CalendarMonth<T extends AnyRow>({
  rows,
  dateKey,
  titleKey,
  subtitleKey,
  toneKey,
  onOpen,
  initialMonth,
  defaultView = "month",
}: {
  rows: T[];
  dateKey: string;
  titleKey: string;
  subtitleKey?: string;
  /** A field whose value colours the entry (a status). */
  toneKey?: string;
  onOpen?: (row: T) => void;
  initialMonth?: string;
  defaultView?: CalendarViewMode;
}) {
  const [view, setView] = useState<CalendarViewMode>(defaultView);
  const [cursor, setCursor] = useState(() => {
    const base = initialMonth ? new Date(`${initialMonth.slice(0, 7)}-01T00:00:00`) : new Date();
    return Number.isNaN(base.getTime()) ? new Date() : base;
  });
  const month = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1), [cursor]);
  const byDay = useMemo(() => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const value = String(row[dateKey] ?? "").slice(0, 10);
      if (!value) continue;
      map.set(value, [...(map.get(value) ?? []), row]);
    }
    return map;
  }, [rows, dateKey]);
  const monthStart = new Date(month.getTime() - ((month.getDay() + 6) % 7) * DAY);
  const weekStart = new Date(cursor.getTime() - ((cursor.getDay() + 6) % 7) * DAY);
  const cells = Array.from(
    { length: view === "week" ? 7 : 42 },
    (_, index) => {
      const origin = view === "week" ? weekStart : monthStart;
      return new Date(origin.getFullYear(), origin.getMonth(), origin.getDate() + index);
    },
  );
  const today = isoDay(new Date());
  const agendaDays = useMemo(
    () => [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)),
    [byDay],
  );
  const step = (dir: -1 | 1) => {
    if (view === "week") {
      setCursor(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + dir * 7));
    } else {
      setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1));
    }
  };
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
        <h3 className="text-[15px] font-bold">
          {view === "week"
            ? `${weekStart.toLocaleDateString("en-IE", { day: "numeric", month: "short" })} – ${new Date(weekStart.getTime() + 6 * DAY).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })}`
            : month.toLocaleDateString("en-IE", { month: "long", year: "numeric" })}
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs font-semibold" data-dense="">
            {(["month", "week", "agenda"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={view === mode}
                onClick={() => setView(mode)}
                className={cn(
                  "rounded-md px-2.5 py-1 capitalize transition-colors",
                  view === mode
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {mode}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>
            Today
          </Button>
          {view !== "agenda" && (
            <>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Previous"
                onClick={() => step(-1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Next"
                onClick={() => step(1)}
              >
                <ChevronRight />
              </Button>
            </>
          )}
        </div>
      </div>
      {view === "agenda" ? (
        <div className="divide-y divide-border/50">
          {agendaDays.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">No dated entries yet.</p>
          ) : (
            agendaDays.map(([day, list]) => (
              <div key={day} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-5">
                <div className="w-32 shrink-0 pt-0.5">
                  <p className={cn("text-xs font-bold uppercase tracking-wide", day === today ? "text-primary" : "text-muted-foreground")}>
                    {new Date(`${day}T12:00:00`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}
                  </p>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {list.map((row) => {
                    const tone = toneKey ? toneFor(row[toneKey], "accent") : "accent";
                    const label = subtitleKey && row[subtitleKey]
                      ? `${String(row[subtitleKey])} · ${String(row[titleKey] ?? "")}`
                      : String(row[titleKey] ?? "");
                    return (
                      <div
                        key={row._id}
                        onClick={onOpen ? () => onOpen(row) : undefined}
                        className={cn(
                          "flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-sm transition-[transform,background-color,border-color] duration-150 hover:border-primary/30 hover:bg-muted/60",
                          onOpen && "cursor-pointer hover:translate-x-0.5",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2 font-medium">
                          <span className={cn("size-2 shrink-0 rounded-full", TONE_DOT[tone])} />
                          <span className="truncate">{label}</span>
                        </span>
                        {toneKey && row[toneKey] ? (
                          <Badge tone={tone} dot>{String(row[toneKey])}</Badge>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <>
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
              const inMonth = view === "week" || date.getMonth() === month.getMonth();
              const limit = view === "week" ? 8 : 3;
              return (
                <div
                  key={key}
                  className={cn(
                    view === "week" ? "min-h-[180px]" : "min-h-[104px]",
                    "border-r border-b border-border/50 p-1.5 transition-colors duration-150 hover:bg-primary/[0.025] [&:nth-child(7n)]:border-r-0",
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
                  <div className="flex flex-col gap-1" data-dense="">
                    {entries.slice(0, limit).map((row) => {
                      const tone = toneKey ? toneFor(row[toneKey], "accent") : "accent";
                      const label = subtitleKey && row[subtitleKey]
                        ? `${String(row[subtitleKey])} · ${String(row[titleKey] ?? "")}`
                        : String(row[titleKey] ?? "");
                      if (!onOpen) {
                        return (
                          <span
                            key={row._id}
                            className="flex items-center gap-1.5 truncate rounded-md bg-muted/70 px-1.5 py-1 text-left text-xs font-semibold transition-colors hover:bg-muted"
                          >
                            <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
                            <span className="truncate">{label}</span>
                          </span>
                        );
                      }
                      return (
                        <button
                          key={row._id}
                          type="button"
                          onClick={() => onOpen(row)}
                          className="flex items-center gap-1.5 truncate rounded-md bg-muted/70 px-1.5 py-1 text-left text-xs font-semibold transition-[transform,background-color] duration-150 hover:translate-x-0.5 hover:bg-primary/14"
                        >
                          <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
                          <span className="truncate">{label}</span>
                        </button>
                      );
                    })}
                    {entries.length > limit && (
                      <span className="px-1.5 text-xs font-semibold text-muted-foreground">
                        +{entries.length - limit} more
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
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
                    className="h-full w-[220px] shrink-0 truncate px-4 text-left text-[13px] font-semibold hover:text-primary"
                  >
                    {String(row[titleKey] ?? "")}
                  </button>
                  <div className="relative h-full flex-1">
                    <motion.button
                      type="button"
                      data-dense=""
                      aria-label={String(row[titleKey] ?? "")}
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

/** A vertical list of dated events, newest first, with subtle hover highlights. */
export function ActivityFeed({
  items,
}: {
  items: Array<{
    id: string;
    title: ReactNode;
    description?: ReactNode;
    date?: string;
    badge?: ReactNode;
    tone?: Tone;
    icon?: ReactNode;
    onClick?: () => void;
  }>;
}) {
  return (
    <ol className="relative flex flex-col gap-2 pl-6 before:absolute before:top-2 before:bottom-2 before:left-[7px] before:w-px before:bg-border">
      {items.map((item, index) => (
        <motion.li
          key={item.id}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: Math.min(index, 12) * 0.035 }}
          onClick={item.onClick}
          className={cn(
            "group relative rounded-xl px-3 py-2.5 -ml-2 transition-[transform,background-color] duration-150 hover:bg-muted/45",
            item.onClick && "cursor-pointer hover:translate-x-0.5",
          )}
        >
          <span
            className={cn(
              "absolute top-3.5 -left-4 size-[15px] rounded-full border-[3px] border-card transition-transform duration-150 group-hover:scale-110",
              TONE_DOT[item.tone ?? "accent"],
            )}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {item.icon && <span className="text-primary [&_svg]:size-4">{item.icon}</span>}
              <p className="truncate text-sm font-semibold">{item.title}</p>
              {item.badge && (
                <Badge tone={item.tone ?? "neutral"} dot>
                  {item.badge}
                </Badge>
              )}
            </div>
            {item.date && <span className="text-xs tabular text-muted-foreground">{item.date}</span>}
          </div>
          {item.description && (
            <p className="mt-0.5 text-[13px] text-muted-foreground">{item.description}</p>
          )}
        </motion.li>
      ))}
    </ol>
  );
}

export type ActionListItem = {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
  tone?: Tone;
  /** Person name for an avatar, or pass a custom icon. */
  avatar?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
};

/**
 * Animated interactive list with staggered entrance and tactile hover elevation — ideal for
 * priority queues, recent records, attention items, and team lists.
 */
export function ActionList({
  items,
  empty = "Nothing to show",
  className,
}: {
  items: ActionListItem[];
  empty?: ReactNode;
  className?: string;
}) {
  if (!items.length) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {items.map((item, index) => {
        const tone = item.tone ?? (typeof item.badge === "string" ? toneFor(item.badge, "accent") : "accent");
        const content = (
          <>
            <span
              aria-hidden="true"
              className="absolute inset-y-2.5 left-0 w-[3px] origin-center scale-y-0 rounded-r-full bg-primary transition-transform duration-200 group-hover:scale-y-100"
            />
            {item.avatar ? (
              <Avatar name={item.avatar} size={34} />
            ) : item.icon ? (
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary transition-transform duration-200 group-hover:scale-105 [&_svg]:size-4">
                {item.icon}
              </span>
            ) : null}
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                  {item.title}
                </span>
                {item.badge !== undefined && item.badge !== null && item.badge !== "" && (
                  <Badge tone={tone} dot>
                    {item.badge}
                  </Badge>
                )}
              </span>
              {item.subtitle && (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {item.subtitle}
                </span>
              )}
            </span>
            {item.meta && (
              <span className="shrink-0 text-xs font-medium tabular text-muted-foreground">
                {item.meta}
              </span>
            )}
            {item.actions && <span className="flex shrink-0 items-center gap-1.5">{item.actions}</span>}
            {item.onClick && !item.actions && (
              <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary" />
            )}
          </>
        );
        const rowClass =
          "group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border border-border/70 bg-card px-3.5 py-3 text-left transition-[transform,box-shadow,border-color,background-color] duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-card";
        return (
          <motion.li
            key={item.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(index, 10) * 0.03 }}
          >
            {item.onClick && !item.actions ? (
              <button type="button" onClick={item.onClick} className={cn(rowClass, "cursor-pointer")}>
                {content}
              </button>
            ) : (
              <div
                onClick={item.onClick}
                className={cn(rowClass, item.onClick && "cursor-pointer")}
              >
                {content}
              </div>
            )}
          </motion.li>
        );
      })}
    </ul>
  );
}

export { Badge };
