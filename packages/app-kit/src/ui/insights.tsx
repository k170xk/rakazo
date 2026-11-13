import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Tone } from "../schema.js";
import { CHART_COLORS, cn, ease } from "./cn.js";
import type { NumberFormat } from "./kpi.js";
import { formatNumber } from "./kpi.js";
import { AXIS_TEXT, axisNumber, GRID_STROKE, Legend, linear, niceTicks, useWidth } from "./plot.js";

type AnyRow = Record<string, unknown>;

const TONE_STROKE: Record<Tone, string> = {
  accent: "hsl(var(--primary))",
  success: "hsl(var(--success))",
  warning: "hsl(var(--warning))",
  danger: "hsl(var(--destructive))",
  info: "hsl(var(--info))",
  neutral: "hsl(var(--muted-foreground))",
};

/**
 * A half-circle dial for one figure against a target or limit: budget spent, capacity used,
 * a score. `value` is 0-1, or a raw number with `max`.
 */
export function Gauge({
  value,
  max,
  label,
  format = "percent",
  currency,
  tone,
  hint,
  size = 220,
  className,
}: {
  value: number;
  max?: number;
  label?: ReactNode;
  format?: NumberFormat;
  currency?: string;
  /** Defaults to green, amber past 80% and red past 100%. */
  tone?: Tone;
  hint?: ReactNode;
  size?: number;
  className?: string;
}) {
  const ratio = max ? value / max : value;
  const shown = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const color = TONE_STROKE[tone ?? (ratio > 1 ? "danger" : ratio > 0.8 ? "warning" : "accent")];
  const radius = 80;
  const arc = Math.PI * radius;
  return (
    <div className={cn("flex flex-col items-center", className)}>
      <svg viewBox="0 0 200 112" width={size} height={(size * 112) / 200} role="img">
        <path
          d="M20 100 A80 80 0 0 1 180 100"
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={16}
          strokeLinecap="round"
        />
        <motion.path
          d="M20 100 A80 80 0 0 1 180 100"
          fill="none"
          stroke={color}
          strokeWidth={16}
          strokeLinecap="round"
          strokeDasharray={arc}
          initial={{ strokeDashoffset: arc }}
          animate={{ strokeDashoffset: arc * (1 - shown) }}
          transition={{ duration: 1, ease }}
        />
        <text
          x="100"
          y="92"
          textAnchor="middle"
          className="fill-foreground"
          style={{ fontSize: 28, fontWeight: 700 }}
        >
          {formatNumber(format === "percent" ? ratio * 100 : max ? value : ratio, format, currency)}
        </text>
      </svg>
      {label && <p className="-mt-1 text-sm font-semibold">{label}</p>}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Stages that narrow (enquiries → quotes → won), with each stage's share of the first and the
 * drop from the one before.
 */
export function FunnelChart({
  data,
  label = "label",
  value = "value",
  format,
  currency,
  onSelect,
}: {
  data: AnyRow[];
  label?: string;
  value?: string;
  format?: NumberFormat;
  currency?: string;
  onSelect?: (item: AnyRow) => void;
}) {
  const first = Math.max(Number(data[0]?.[value]) || 0, 1);
  return (
    <ol className="flex flex-col gap-1.5">
      {data.map((item, index) => {
        const amount = Number(item[value]) || 0;
        const previous = index ? Number(data[index - 1]?.[value]) || 0 : amount;
        const width = Math.max((amount / first) * 100, 6);
        return (
          <li key={String(item[label])}>
            <button
              type="button"
              disabled={!onSelect}
              onClick={() => onSelect?.(item)}
              className="group flex w-full items-center gap-3 text-left text-sm disabled:cursor-default"
            >
              <span className="w-20 shrink-0 truncate font-medium text-muted-foreground sm:w-28">
                {String(item[label])}
              </span>
              <span className="relative flex h-10 flex-1 items-center justify-center">
                <motion.span
                  className="absolute inset-y-0 rounded-lg group-enabled:group-hover:brightness-110"
                  style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
                  initial={{ width: 0 }}
                  animate={{ width: `${width}%` }}
                  transition={{ duration: 0.8, delay: index * 0.08, ease }}
                />
                <span className="relative font-bold tabular text-white drop-shadow-sm">
                  {formatNumber(amount, format, currency)}
                </span>
              </span>
              <span className="w-12 shrink-0 text-right text-xs tabular text-muted-foreground sm:w-24">
                {index === 0 ? "100%" : `${Math.round((amount / first) * 100)}%`}
                {index > 0 && previous > 0 && (
                  <span className="hidden sm:inline">
                    {` · −${Math.max(0, Math.round((1 - amount / previous) * 100))}%`}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Points by two numbers (fee against hours, size against margin), optionally sized and grouped. */
export function ScatterChart({
  data,
  x,
  y,
  size,
  groupBy,
  labelKey,
  xLabel,
  yLabel,
  xFormat,
  yFormat,
  currency,
  height = 300,
  onSelect,
}: {
  data: AnyRow[];
  x: string;
  y: string;
  size?: string;
  groupBy?: string;
  labelKey?: string;
  xLabel?: string;
  yLabel?: string;
  xFormat?: NumberFormat;
  yFormat?: NumberFormat;
  currency?: string;
  height?: number;
  onSelect?: (row: AnyRow) => void;
}) {
  const groups = useMemo(() => {
    const out = new Map<string, AnyRow[]>();
    for (const row of data) {
      if (!Number.isFinite(Number(row[x])) || !Number.isFinite(Number(row[y]))) continue;
      const key = groupBy ? String(row[groupBy] ?? "—") : "all";
      out.set(key, [...(out.get(key) ?? []), { ...row, [x]: Number(row[x]), [y]: Number(row[y]) }]);
    }
    return [...out];
  }, [data, x, y, groupBy]);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<AnyRow | null>(null);
  const legendShown = Boolean(groupBy && groups.length > 1);
  const svgHeight = height - (legendShown ? 26 : 0);
  const margin = { top: 8, right: 12, bottom: 28, left: 56 };
  const plotWidth = Math.max(width - margin.left - margin.right, 10);
  const plotHeight = Math.max(svgHeight - margin.top - margin.bottom, 10);
  const rows = groups.flatMap(([, list]) => list);
  const xs = rows.map((row) => Number(row[x]));
  const ys = rows.map((row) => Number(row[y]));
  const xTicks = niceTicks(
    Math.min(0, ...xs),
    Math.max(0, ...xs),
    Math.max(2, Math.floor(plotWidth / 90)),
  );
  const yTicks = niceTicks(Math.min(0, ...ys), Math.max(0, ...ys));
  const sx = linear(
    [xTicks[0]!, xTicks[xTicks.length - 1]!],
    [margin.left, margin.left + plotWidth],
  );
  const sy = linear(
    [yTicks[0]!, yTicks[yTicks.length - 1]!],
    [margin.top + plotHeight, margin.top],
  );
  const sizes = size ? rows.map((row) => Number(row[size]) || 0) : [];
  const sizeMin = Math.min(...sizes);
  const sizeMax = Math.max(...sizes);
  // Point area from 40 to 400 square pixels, as the previous scatter drew them.
  const radius = (row: AnyRow) => {
    if (!size) return 4.5;
    const share =
      sizeMax > sizeMin ? ((Number(row[size]) || 0) - sizeMin) / (sizeMax - sizeMin) : 0.5;
    return Math.sqrt((40 + share * 360) / Math.PI);
  };
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <>
          <svg
            width={width}
            height={svgHeight}
            role="img"
            aria-label={`Scatter of ${yLabel ?? y} against ${xLabel ?? x}`}
            className="block"
          >
            {yTicks.map((tick) => (
              <g key={`y${tick}`}>
                <line
                  x1={margin.left}
                  x2={margin.left + plotWidth}
                  y1={sy(tick)}
                  y2={sy(tick)}
                  stroke={GRID_STROKE}
                  strokeDasharray="3 4"
                />
                <text
                  x={margin.left - 8}
                  y={sy(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  {...AXIS_TEXT}
                >
                  {axisNumber(tick, yFormat, currency)}
                </text>
              </g>
            ))}
            {xTicks.map((tick) => (
              <g key={`x${tick}`}>
                <line
                  x1={sx(tick)}
                  x2={sx(tick)}
                  y1={margin.top}
                  y2={margin.top + plotHeight}
                  stroke={GRID_STROKE}
                  strokeDasharray="3 4"
                />
                <text
                  x={sx(tick)}
                  y={margin.top + plotHeight + 20}
                  textAnchor="middle"
                  {...AXIS_TEXT}
                >
                  {axisNumber(tick, xFormat, currency)}
                </text>
              </g>
            ))}
            {groups.map(([name, list], groupIndex) =>
              list.map((row, index) => (
                <motion.circle
                  key={`${name}-${index}`}
                  cx={sx(Number(row[x]))}
                  cy={sy(Number(row[y]))}
                  fill={CHART_COLORS[groupIndex % CHART_COLORS.length]}
                  fillOpacity={active === row ? 1 : 0.8}
                  stroke={active === row ? "hsl(var(--card))" : "none"}
                  strokeWidth={2}
                  initial={{ r: 0 }}
                  animate={{ r: radius(row) }}
                  transition={{ duration: 0.6, ease, delay: Math.min(index * 0.01, 0.4) }}
                  onPointerEnter={() => setActive(row)}
                  onPointerLeave={() => setActive(null)}
                  onClick={() => onSelect?.(row)}
                  className={onSelect ? "cursor-pointer" : undefined}
                />
              )),
            )}
          </svg>
          {active && (
            <div
              role="status"
              className="pointer-events-none absolute z-10 rounded-xl border border-border bg-popover/95 px-3 py-2 text-xs shadow-lift"
              style={{
                left: sx(Number(active[x])) + 12,
                top: Math.max(0, sy(Number(active[y])) - 12),
                transform:
                  sx(Number(active[x])) > width * 0.6
                    ? "translateX(calc(-100% - 24px))"
                    : undefined,
              }}
            >
              {labelKey && <p className="mb-1 font-bold">{String(active[labelKey] ?? "")}</p>}
              <p className="text-muted-foreground">
                {xLabel ?? x}:{" "}
                <b className="text-foreground">
                  {formatNumber(Number(active[x]), xFormat, currency)}
                </b>
              </p>
              <p className="text-muted-foreground">
                {yLabel ?? y}:{" "}
                <b className="text-foreground">
                  {formatNumber(Number(active[y]), yFormat, currency)}
                </b>
              </p>
            </div>
          )}
          {legendShown && (
            <Legend
              className="mt-1"
              items={groups.map(([name], index) => ({
                name,
                color: CHART_COLORS[index % CHART_COLORS.length]!,
              }))}
            />
          )}
        </>
      )}
    </div>
  );
}

const DAY = 86_400_000;
const isoDay = (time: number) => new Date(time).toISOString().slice(0, 10);

/**
 * A year of days as squares, darker where more happened (site visits, timesheet hours, issues
 * raised): rows counted per day, or `valueKey` summed.
 */
export function CalendarHeatmap({
  rows,
  dateKey,
  valueKey,
  weeks = 52,
  format,
  label = "on",
  onSelect,
}: {
  rows: AnyRow[];
  dateKey: string;
  valueKey?: string;
  weeks?: number;
  format?: NumberFormat;
  label?: string;
  onSelect?: (day: string, rows: AnyRow[]) => void;
}) {
  const { days, top, byDay } = useMemo(() => {
    const byDay = new Map<string, AnyRow[]>();
    for (const row of rows) {
      const time = Date.parse(String(row[dateKey] ?? ""));
      if (Number.isNaN(time)) continue;
      const day = isoDay(time);
      byDay.set(day, [...(byDay.get(day) ?? []), row]);
    }
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const end = today.getTime() + (6 - today.getUTCDay()) * DAY;
    const start = end - (weeks * 7 - 1) * DAY;
    const days: Array<{ day: string; value: number; future: boolean }> = [];
    let top = 0;
    for (let time = start; time <= end; time += DAY) {
      const day = isoDay(time);
      const items = byDay.get(day) ?? [];
      const value = valueKey
        ? items.reduce((sum, row) => sum + (Number(row[valueKey]) || 0), 0)
        : items.length;
      top = Math.max(top, value);
      days.push({ day, value, future: time > today.getTime() });
    }
    return { days, top, byDay };
  }, [rows, dateKey, valueKey, weeks]);
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [weeks]);
  const shade = (value: number) =>
    value <= 0 ? 0.08 : 0.25 + 0.75 * Math.min(1, value / Math.max(top, 1));
  return (
    <div className="flex flex-col gap-2">
      <div ref={scroller} className="overflow-x-auto [contain:inline-size]">
        <div
          className="grid min-w-[520px] grid-flow-col gap-[3px]"
          style={{
            gridTemplateRows: "repeat(7, auto)",
            gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`,
          }}
        >
          {days.map(({ day, value, future }) => (
            <button
              key={day}
              type="button"
              disabled={future || !onSelect}
              onClick={() => onSelect?.(day, byDay.get(day) ?? [])}
              title={`${formatNumber(value, format)} ${label} ${new Date(day).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}`}
              className={cn(
                "aspect-square w-full max-w-5 rounded-[3px] disabled:cursor-default",
                future && "opacity-30",
              )}
              style={{ background: `hsl(var(--primary) / ${shade(value)})` }}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
        Less
        {[0, 0.25, 0.5, 0.75, 1].map((step) => (
          <span
            key={step}
            className="size-2.5 rounded-[2px]"
            style={{ background: `hsl(var(--primary) / ${step ? 0.25 + 0.75 * step : 0.08})` }}
          />
        ))}
        More
      </div>
    </div>
  );
}

/**
 * A grid of two categories with each cell shaded by its total (office by month, discipline by
 * stage), for spotting where the work or the problems are.
 */
export function Heatmap({
  rows,
  x,
  y,
  valueKey,
  format,
  currency,
  onSelect,
}: {
  rows: AnyRow[];
  x: string;
  y: string;
  valueKey?: string;
  format?: NumberFormat;
  currency?: string;
  onSelect?: (cell: { x: string; y: string; rows: AnyRow[] }) => void;
}) {
  const { xs, ys, cells, top } = useMemo(() => {
    const xs: string[] = [];
    const ys: string[] = [];
    const cells = new Map<string, { value: number; rows: AnyRow[] }>();
    let top = 0;
    for (const row of rows) {
      const cx = String(row[x] ?? "—");
      const cy = String(row[y] ?? "—");
      if (!xs.includes(cx)) xs.push(cx);
      if (!ys.includes(cy)) ys.push(cy);
      const key = `${cy}\u0000${cx}`;
      const cell = cells.get(key) ?? { value: 0, rows: [] };
      cell.value += valueKey ? Number(row[valueKey]) || 0 : 1;
      cell.rows.push(row);
      cells.set(key, cell);
      top = Math.max(top, cell.value);
    }
    return { xs: xs.slice(0, 24), ys: ys.slice(0, 30), cells, top };
  }, [rows, x, y, valueKey]);
  return (
    <div className="overflow-x-auto [contain:inline-size]">
      <table className="w-full border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th />
            {xs.map((cx) => (
              <th
                key={cx}
                className="px-1 pb-1 text-center font-semibold whitespace-nowrap text-muted-foreground"
              >
                {cx}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ys.map((cy) => (
            <tr key={cy}>
              <th className="pr-2 text-left font-semibold whitespace-nowrap text-muted-foreground">
                {cy}
              </th>
              {xs.map((cx) => {
                const cell = cells.get(`${cy}\u0000${cx}`);
                const strength = cell ? 0.15 + 0.85 * (cell.value / Math.max(top, 1)) : 0;
                return (
                  <td key={cx} className="p-0">
                    <button
                      type="button"
                      disabled={!cell || !onSelect}
                      onClick={() => cell && onSelect?.({ x: cx, y: cy, rows: cell.rows })}
                      className={cn(
                        "flex h-9 w-full min-w-12 items-center justify-center rounded-md font-semibold tabular disabled:cursor-default",
                        strength > 0.55 ? "text-primary-foreground" : "text-foreground",
                      )}
                      style={{
                        background: cell
                          ? `hsl(var(--primary) / ${strength})`
                          : "hsl(var(--muted) / 0.5)",
                      }}
                    >
                      {cell ? formatNumber(cell.value, format, currency) : ""}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
