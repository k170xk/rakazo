import { ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import type { Tone } from "../schema.js";
import { Badge, Button } from "./basic.js";
import { cn, TONE_DOT, toneFor } from "./cn.js";

type AnyRow = Record<string, unknown> & { _id?: string };

/**
 * Cards in columns by a field (status, stage, owner). Cards drag between columns when onMove is
 * given; the move shows at once.
 */
export function Kanban<T extends AnyRow>({
  rows,
  groupBy,
  columns,
  renderCard,
  onMove,
  onOpen,
  className,
}: {
  rows: T[];
  groupBy: string;
  /** Column order and tones; values found in rows are added after. */
  columns?: Array<{ value: string; label?: string; tone?: Tone }>;
  renderCard: (row: T) => ReactNode;
  onMove?: (row: T, value: string) => void;
  onOpen?: (row: T) => void;
  className?: string;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
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
  return (
    <div className={cn("flex gap-4 overflow-x-auto pb-2", className)}>
      {lanes.map((lane) => {
        const items = rows.filter((row) => String(row[groupBy] ?? "") === lane.value);
        const tone = lane.tone ?? toneFor(lane.value, "accent");
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: a drop target for dragged cards; moving is also possible by editing the row
          <div
            key={lane.value || "_none"}
            onDragOver={(event) => {
              if (!onMove) return;
              event.preventDefault();
              setOver(lane.value);
            }}
            onDragLeave={() => setOver((current) => (current === lane.value ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              setOver(null);
              const row = rows.find((item) => item._id === dragging);
              setDragging(null);
              if (row && onMove && String(row[groupBy] ?? "") !== lane.value)
                onMove(row, lane.value);
            }}
            className={cn(
              "flex w-[300px] shrink-0 flex-col rounded-2xl bg-muted/50 p-2 transition-colors",
              over === lane.value && "bg-primary/10 ring-2 ring-primary/30",
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
                {items.map((row) => (
                  <motion.div
                    key={row._id}
                    layout
                    layoutId={`card-${row._id}`}
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: dragging === row._id ? 0.45 : 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  >
                    {/* biome-ignore lint/a11y/useSemanticElements: a draggable card holding block content */}
                    <div
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") onOpen?.(row);
                      }}
                      draggable={Boolean(onMove)}
                      onDragStart={() => setDragging(row._id ?? null)}
                      onDragEnd={() => setDragging(null)}
                      onClick={() => onOpen?.(row)}
                      className={cn(
                        "rounded-xl border border-border/70 bg-card p-3.5 shadow-card transition-shadow hover:shadow-lift",
                        onMove && "cursor-grab active:cursor-grabbing",
                        onOpen && !onMove && "cursor-pointer",
                      )}
                    >
                      {renderCard(row)}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        );
      })}
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
