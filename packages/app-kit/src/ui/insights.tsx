import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useLayoutEffect, useMemo, useRef } from "react";
import {
  CartesianGrid,
  ResponsiveContainer,
  ScatterChart as RScatterChart,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { Tone } from "../schema.js";
import { CHART_COLORS, cn, ease } from "./cn.js";
import type { NumberFormat } from "./kpi.js";
import { formatNumber } from "./kpi.js";

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
  const axis = {
    tickLine: false,
    axisLine: false,
    tick: { fill: "hsl(var(--muted-foreground))", fontSize: 12 },
  } as const;
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 4" />
          <XAxis
            type="number"
            dataKey={x}
            name={xLabel ?? x}
            {...axis}
            tickFormatter={(value: number) =>
              formatNumber(value, xFormat === "currency" ? "compact" : xFormat, currency)
            }
          />
          <YAxis
            type="number"
            dataKey={y}
            name={yLabel ?? y}
            width={56}
            {...axis}
            tickFormatter={(value: number) =>
              formatNumber(value, yFormat === "currency" ? "compact" : yFormat, currency)
            }
          />
          {size && <ZAxis type="number" dataKey={size} range={[40, 400]} />}
          <Tooltip
            cursor={{ strokeDasharray: "3 4" }}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as AnyRow | undefined) : undefined;
              if (!row) return null;
              return (
                <div className="rounded-xl border border-border bg-popover/95 px-3 py-2 text-xs shadow-lift">
                  {labelKey && <p className="mb-1 font-bold">{String(row[labelKey] ?? "")}</p>}
                  <p className="text-muted-foreground">
                    {xLabel ?? x}:{" "}
                    <b className="text-foreground">
                      {formatNumber(Number(row[x]), xFormat, currency)}
                    </b>
                  </p>
                  <p className="text-muted-foreground">
                    {yLabel ?? y}:{" "}
                    <b className="text-foreground">
                      {formatNumber(Number(row[y]), yFormat, currency)}
                    </b>
                  </p>
                </div>
              );
            }}
          />
          {groups.map(([name, rows], index) => (
            <Scatter
              key={name}
              name={name}
              data={rows}
              fill={CHART_COLORS[index % CHART_COLORS.length]}
              fillOpacity={0.8}
              animationDuration={800}
              onClick={(point: { payload?: AnyRow }) => point.payload && onSelect?.(point.payload)}
              className={onSelect ? "cursor-pointer" : undefined}
            />
          ))}
        </RScatterChart>
      </ResponsiveContainer>
      {groupBy && groups.length > 1 && (
        <div className="mt-1 flex flex-wrap justify-center gap-3 text-xs text-muted-foreground">
          {groups.map(([name], index) => (
            <span key={name} className="inline-flex items-center gap-1.5">
              <span
                className="size-2 rounded-full"
                style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
              />
              {name}
            </span>
          ))}
        </div>
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
