import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn, toneFor } from "./cn.js";

type AnyRow = Record<string, unknown> & { _id?: string };

const DAY_MS = 86_400_000;
const ROW = 40;
const HEADER = 52;
const SCALES = { day: 34, week: 14, month: 4.5 } as const;
export type GanttScale = keyof typeof SCALES;

const BAR_TONE: Record<string, string> = {
  neutral: "hsl(var(--muted-foreground))",
  accent: "hsl(var(--primary))",
  success: "hsl(var(--success))",
  warning: "hsl(var(--warning))",
  danger: "hsl(var(--destructive))",
  info: "hsl(var(--info))",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Whole days since 1970 for a date or "YYYY-MM-DD", ignoring time zones and clock changes. */
export function dayNumber(value: unknown): number | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / DAY_MS;
  }
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS;
}

/** "YYYY-MM-DD" for a day number. */
export function dayText(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

const today = () => dayNumber(new Date()) as number;

type Bar<T> = {
  row: T;
  id: string;
  start: number;
  end: number;
  title: string;
  group: string;
  progress: number | null;
  tone: string;
  milestone: boolean;
  depends: string[];
};

/**
 * A Gantt chart: a bar per row from its start to end date, grouped into sections, with progress,
 * milestones (start equals end), dependency arrows and a today line. With onChange, bars drag to
 * move and their ends drag to change dates (snapped to days); the change shows at once.
 */
export function Gantt<T extends AnyRow>({
  rows,
  startKey,
  endKey,
  titleKey,
  groupKey,
  progressKey,
  dependsKey,
  toneKey,
  scale: startScale = "week",
  onChange,
  onOpen,
  renderLabel,
  className,
}: {
  rows: T[];
  startKey: string;
  /** Without an end date a row is a one-day milestone. */
  endKey?: string;
  titleKey: string;
  /** Rows with the same value sit together under a heading (a phase, team or project). */
  groupKey?: string;
  /** 0-100 (or 0-1) shown as a darker fill inside the bar. */
  progressKey?: string;
  /** _ids of rows that must finish first (comma separated text or a list); drawn as arrows. */
  dependsKey?: string;
  /** A field whose value colours the bar (a status). */
  toneKey?: string;
  scale?: GanttScale;
  /** A bar moved or resized: save the new dates ("YYYY-MM-DD"). */
  onChange?: (row: T, dates: { start: string; end: string }) => void;
  onOpen?: (row: T) => void;
  /** The text in the left column (defaults to the title). */
  renderLabel?: (row: T) => ReactNode;
  className?: string;
}) {
  const [scale, setScale] = useState<GanttScale>(startScale);
  const [moving, setMoving] = useState<{
    id: string;
    mode: "move" | "start" | "end";
    from: number;
    shift: number;
  } | null>(null);
  const movingRef = useRef(moving);
  movingRef.current = moving;
  const justMoved = useRef(0);
  const timeline = useRef<HTMLDivElement>(null);
  const perDay = SCALES[scale];

  const bars = useMemo(() => {
    const list: Bar<T>[] = [];
    rows.forEach((row, index) => {
      const start = dayNumber(row[startKey]);
      if (start === null) return;
      const endValue = endKey ? dayNumber(row[endKey]) : null;
      const end = Math.max(endValue ?? start, start);
      const rawProgress = progressKey ? Number(row[progressKey]) : Number.NaN;
      const progress = Number.isFinite(rawProgress)
        ? Math.min(
            Math.max(rawProgress <= 1 && rawProgress > 0 ? rawProgress * 100 : rawProgress, 0),
            100,
          )
        : null;
      const toneValue = toneKey ? String(row[toneKey] ?? "") : "";
      const dependsValue = dependsKey ? row[dependsKey] : null;
      list.push({
        row,
        id: row._id ?? String(index),
        start,
        end,
        title: String(row[titleKey] ?? "Untitled"),
        group: groupKey ? String(row[groupKey] ?? "") : "",
        progress,
        tone: BAR_TONE[toneValue ? toneFor(toneValue, "accent") : "accent"] ?? BAR_TONE.accent!,
        milestone: !endKey || endValue === start,
        depends: (Array.isArray(dependsValue)
          ? dependsValue.map(String)
          : String(dependsValue ?? "").split(",")
        )
          .map((item) => item.trim())
          .filter(Boolean),
      });
    });
    return list;
  }, [rows, startKey, endKey, titleKey, groupKey, progressKey, dependsKey, toneKey]);

  // Bars as they look mid-drag.
  const shown = useMemo(
    () =>
      bars.map((bar) => {
        if (!moving || moving.id !== bar.id) return bar;
        const { mode, shift } = moving;
        if (mode === "move") return { ...bar, start: bar.start + shift, end: bar.end + shift };
        if (mode === "start") return { ...bar, start: Math.min(bar.start + shift, bar.end) };
        return { ...bar, end: Math.max(bar.end + shift, bar.start) };
      }),
    [bars, moving],
  );

  // Sections in first-seen order, each a heading row then its bars.
  const lines = useMemo(() => {
    const out: Array<{ heading: string } | { bar: Bar<T> }> = [];
    if (!groupKey) return shown.map((bar) => ({ bar }));
    const order: string[] = [];
    for (const bar of shown) if (!order.includes(bar.group)) order.push(bar.group);
    for (const group of order) {
      out.push({ heading: group || "Other" });
      for (const bar of shown) if (bar.group === group) out.push({ bar });
    }
    return out;
  }, [shown, groupKey]);

  const now = today();
  const range = useMemo(() => {
    const starts = bars.map((bar) => bar.start);
    const ends = bars.map((bar) => bar.end);
    const first = Math.min(now, ...starts) - 7;
    const last = Math.max(now, ...ends) + 21;
    // Begin on a Monday so weeks line up.
    const monday = first - ((new Date(first * DAY_MS).getUTCDay() + 6) % 7);
    return { first: monday, days: Math.max(last - monday, 56) };
  }, [bars, now]);

  const x = (day: number) => (day - range.first) * perDay;
  const width = range.days * perDay;
  const rowOf = new Map<string, number>();
  lines.forEach((line, index) => {
    if ("bar" in line) rowOf.set(line.bar.id, index);
  });

  // The timeline opens with today in view.
  useEffect(() => {
    const element = timeline.current;
    if (element) element.scrollLeft = Math.max(0, x(now) - element.clientWidth / 3);
  }, [scale]);

  useEffect(() => {
    if (!moving) return;
    const move = (event: PointerEvent) => {
      const current = movingRef.current;
      if (!current) return;
      const shift = Math.round((event.clientX - current.from) / perDay);
      if (shift !== current.shift) setMoving({ ...current, shift });
    };
    const end = () => {
      const current = movingRef.current;
      setMoving(null);
      if (!current || current.shift === 0) return;
      justMoved.current = Date.now();
      const bar = bars.find((item) => item.id === current.id);
      if (!bar || !onChange) return;
      const { mode, shift } = current;
      const start =
        mode === "end"
          ? bar.start
          : Math.min(bar.start + shift, mode === "start" ? bar.end : Number.POSITIVE_INFINITY);
      const finish =
        mode === "start"
          ? bar.end
          : Math.max(bar.end + shift, mode === "end" ? bar.start : Number.NEGATIVE_INFINITY);
      onChange(bar.row, { start: dayText(start), end: dayText(finish) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [Boolean(moving)]);

  const grab = (event: ReactPointerEvent, bar: Bar<T>, mode: "move" | "start" | "end") => {
    if (!onChange || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    setMoving({ id: bar.id, mode, from: event.clientX, shift: 0 });
  };

  // Header ticks: months always; weeks or days beneath.
  const months: Array<{ left: number; label: string }> = [];
  const ticks: Array<{ left: number; label: string; weekend?: boolean }> = [];
  for (let day = range.first; day <= range.first + range.days; day++) {
    const date = new Date(day * DAY_MS);
    if (date.getUTCDate() === 1 || day === range.first) {
      months.push({
        left: x(day),
        label: `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
      });
    }
    const weekday = date.getUTCDay();
    if (scale === "day") {
      ticks.push({
        left: x(day),
        label: String(date.getUTCDate()),
        weekend: weekday === 0 || weekday === 6,
      });
    } else if (scale === "week" && weekday === 1) {
      ticks.push({ left: x(day), label: String(date.getUTCDate()) });
    }
  }
  const height = lines.length * ROW;

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border/70 bg-card", className)}>
      <div className="flex items-center justify-end gap-1 border-b border-border/70 px-3 py-2">
        {(Object.keys(SCALES) as GanttScale[]).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={scale === option}
            onClick={() => setScale(option)}
            className={cn(
              "rounded-lg px-2.5 py-1 text-[12.5px] font-semibold capitalize transition-colors",
              scale === option
                ? "bg-primary/12 text-primary"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {option === "day" ? "Days" : option === "week" ? "Weeks" : "Months"}
          </button>
        ))}
      </div>
      <div className="flex">
        <div className="w-56 shrink-0 border-r border-border/70">
          <div style={{ height: HEADER }} className="border-b border-border/70" />
          {lines.map((line, index) =>
            "heading" in line ? (
              <div
                key={`h${index}`}
                style={{ height: ROW }}
                className="flex items-center bg-muted/40 px-3 text-xs font-bold tracking-wide text-muted-foreground uppercase"
              >
                <span className="truncate">{line.heading}</span>
              </div>
            ) : (
              <button
                key={line.bar.id}
                type="button"
                onClick={() => onOpen?.(line.bar.row)}
                style={{ height: ROW }}
                className={cn(
                  "flex w-full items-center px-3 text-left text-[13px] font-medium",
                  onOpen ? "hover:bg-muted/60" : "cursor-default",
                )}
              >
                <span className="truncate">
                  {renderLabel ? renderLabel(line.bar.row) : line.bar.title}
                </span>
              </button>
            ),
          )}
          {!lines.length && (
            <p className="p-4 text-sm text-muted-foreground">Nothing scheduled yet</p>
          )}
        </div>
        <div ref={timeline} className="relative min-w-0 flex-1 overflow-x-auto">
          <div style={{ width, height: HEADER + height }} className="relative">
            <div
              style={{ height: HEADER }}
              className="sticky top-0 border-b border-border/70 bg-card"
            >
              {months.map((month) => (
                <span
                  key={month.left}
                  className="absolute top-1.5 border-l border-border/70 pl-1.5 text-[11.5px] font-bold whitespace-nowrap"
                  style={{ left: month.left }}
                >
                  {month.label}
                </span>
              ))}
              {ticks.map((tick) => (
                <span
                  key={tick.left}
                  className={cn(
                    "absolute bottom-1.5 text-center text-[10.5px] tabular text-muted-foreground",
                    tick.weekend && "text-muted-foreground/60",
                  )}
                  style={{ left: tick.left, width: scale === "day" ? perDay : perDay * 7 }}
                >
                  {tick.label}
                </span>
              ))}
            </div>
            <svg
              className="pointer-events-none absolute left-0"
              style={{ top: HEADER }}
              width={width}
              height={height}
              aria-hidden="true"
            >
              {lines.map((line, index) =>
                "heading" in line ? (
                  <rect
                    key={`h${index}`}
                    x={0}
                    y={index * ROW}
                    width={width}
                    height={ROW}
                    className="fill-muted/40"
                  />
                ) : null,
              )}
              {scale === "day" &&
                ticks.map((tick) =>
                  tick.weekend ? (
                    <rect
                      key={tick.left}
                      x={tick.left}
                      y={0}
                      width={perDay}
                      height={height}
                      className="fill-muted/50"
                    />
                  ) : null,
                )}
              {scale !== "day" &&
                ticks.map((tick) => (
                  <line
                    key={tick.left}
                    x1={tick.left}
                    x2={tick.left}
                    y1={0}
                    y2={height}
                    className="stroke-border/60"
                  />
                ))}
              {shown.flatMap((bar) =>
                bar.depends.flatMap((id) => {
                  const before = shown.find((item) => item.id === id);
                  const from = before && rowOf.get(before.id);
                  const to = rowOf.get(bar.id);
                  if (!before || from === undefined || to === undefined) return [];
                  const x1 = x(before.end + 1);
                  const y1 = from * ROW + ROW / 2;
                  const x2 = x(bar.start);
                  const y2 = to * ROW + ROW / 2;
                  const bend = x1 + 8;
                  const late = bar.start <= before.end;
                  return [
                    <path
                      key={`${id}>${bar.id}`}
                      d={`M${x1},${y1} H${bend} V${y2} H${x2 - 2}`}
                      fill="none"
                      stroke={late ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))"}
                      strokeWidth={1.5}
                      markerEnd={late ? "url(#gantt-late)" : "url(#gantt-arrow)"}
                    />,
                  ];
                }),
              )}
              <defs>
                <marker
                  id="gantt-arrow"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8 Z" fill="hsl(var(--muted-foreground))" />
                </marker>
                <marker
                  id="gantt-late"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8 Z" fill="hsl(var(--destructive))" />
                </marker>
              </defs>
              <line
                x1={x(now) + perDay / 2}
                x2={x(now) + perDay / 2}
                y1={0}
                y2={height}
                stroke="hsl(var(--destructive))"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            </svg>
            {lines.map((line, index) => {
              if ("heading" in line) return null;
              const { bar } = line;
              const top = HEADER + index * ROW;
              const left = x(bar.start);
              const span = (bar.end - bar.start + 1) * perDay;
              const label = `${bar.title}: ${dayText(bar.start)}${bar.milestone ? "" : ` to ${dayText(bar.end)}`}`;
              if (bar.milestone) {
                return (
                  <button
                    key={bar.id}
                    type="button"
                    title={label}
                    aria-label={label}
                    data-dense=""
                    onPointerDown={(event) => grab(event, bar, "move")}
                    onClick={() => Date.now() - justMoved.current > 300 && onOpen?.(bar.row)}
                    className={cn(
                      "absolute size-4 rotate-45 rounded-[3px] shadow touch-none",
                      onChange && "cursor-grab",
                    )}
                    style={{
                      left: left + perDay / 2 - 8,
                      top: top + ROW / 2 - 8,
                      background: bar.tone,
                    }}
                  />
                );
              }
              return (
                <div
                  key={bar.id}
                  className={cn(
                    "group absolute flex touch-none items-center overflow-hidden rounded-md shadow-sm",
                    moving?.id === bar.id && "ring-2 ring-primary/40",
                  )}
                  style={{
                    left,
                    top: top + 9,
                    width: Math.max(span, 6),
                    height: ROW - 18,
                    background: bar.tone,
                  }}
                >
                  {bar.progress !== null && (
                    <span
                      className="absolute inset-y-0 left-0 bg-black/20"
                      style={{ width: `${bar.progress}%` }}
                    />
                  )}
                  <button
                    type="button"
                    title={label}
                    aria-label={label}
                    data-dense=""
                    onPointerDown={(event) => grab(event, bar, "move")}
                    onClick={() => Date.now() - justMoved.current > 300 && onOpen?.(bar.row)}
                    className={cn(
                      "relative h-full flex-1 truncate px-2 text-left text-[11.5px] font-semibold text-white",
                      onChange
                        ? "cursor-grab active:cursor-grabbing"
                        : onOpen
                          ? "cursor-pointer"
                          : "cursor-default",
                    )}
                  >
                    {span > 60 ? bar.title : ""}
                  </button>
                  {onChange && (
                    <>
                      <span
                        aria-hidden="true"
                        onPointerDown={(event) => grab(event, bar, "start")}
                        className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40"
                      />
                      <span
                        aria-hidden="true"
                        onPointerDown={(event) => grab(event, bar, "end")}
                        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40"
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
