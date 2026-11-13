import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useId, useState } from "react";
import { CHART_COLORS, cn, ease } from "./cn.js";
import type { NumberFormat } from "./kpi.js";
import { formatNumber } from "./kpi.js";
import {
  AXIS_TEXT,
  axisNumber,
  GRID_STROKE,
  Legend,
  linear,
  monotonePath,
  niceTicks,
  roundedRect,
  TooltipBox,
  truncate,
  useActiveIndex,
  useWidth,
} from "./plot.js";

export type Series = { key: string; label?: string; color?: string };

type BaseProps = {
  data: Array<Record<string, unknown>>;
  /** The field along the bottom axis. */
  x: string;
  series: Array<Series | string>;
  height?: number;
  format?: NumberFormat;
  currency?: string;
  legend?: boolean;
  className?: string;
};

type Kind = "area" | "line" | "bar";

const seriesOf = (series: Array<Series | string>) =>
  series.map((item, index) => {
    const value = typeof item === "string" ? { key: item } : item;
    return {
      ...value,
      name: value.label ?? value.key,
      color: value.color ?? CHART_COLORS[index % CHART_COLORS.length]!,
    };
  });

const LEGEND_HEIGHT = 26;
const BAR_RADIUS = 6;
const MAX_BAR = 44;

/** Each series' bottom and top per row; stacked series sit on the ones before (negatives below zero). */
function stack(values: number[][], stacked: boolean | undefined) {
  if (!stacked) return { lows: values.map((row) => row.map(() => 0)), highs: values };
  const up = values[0]?.map(() => 0) ?? [];
  const down = [...up];
  const lows: number[][] = [];
  const highs: number[][] = [];
  for (const row of values) {
    const low: number[] = [];
    const high: number[] = [];
    row.forEach((value, index) => {
      const base = value >= 0 ? up : down;
      low.push(base[index]!);
      base[index]! += value;
      high.push(base[index]!);
    });
    lows.push(low);
    highs.push(high);
  }
  return { lows, highs };
}

function Cartesian({
  kind,
  data,
  x,
  series,
  height = 280,
  format,
  currency,
  legend,
  stacked,
  className,
}: BaseProps & { kind: Kind; stacked?: boolean }) {
  const id = useId().replace(/:/g, "");
  const list = seriesOf(series);
  const [ref, width] = useWidth<HTMLDivElement>();
  const svgHeight = height - (legend ? LEGEND_HEIGHT : 0);
  const margin = { top: 8, right: 8, bottom: 28, left: 56 };
  const plotWidth = Math.max(width - margin.left - margin.right, 10);
  const plotHeight = Math.max(svgHeight - margin.top - margin.bottom, 10);
  const values = list.map((item) => data.map((row) => Number(row[item.key]) || 0));
  const { lows, highs } = stack(values, stacked && kind !== "line");
  const all = [...highs.flat(), ...lows.flat()];
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const y = linear([ticks[0]!, ticks[ticks.length - 1]!], [margin.top + plotHeight, margin.top]);
  const count = data.length;
  const band = kind === "bar";
  const step = band ? plotWidth / Math.max(count, 1) : plotWidth / Math.max(count - 1, 1);
  const xAt = (index: number) =>
    band
      ? margin.left + step * (index + 0.5)
      : margin.left + (count === 1 ? plotWidth / 2 : step * index);
  const labels = data.map((row) => String(row[x] ?? ""));
  const longest = Math.min(18, Math.max(1, ...labels.map((label) => label.length)));
  const every = Math.max(1, Math.ceil((longest * 7 + 12) / Math.max(step, 1)));
  const { active, handlers } = useActiveIndex(count, (px) => {
    if (!count || px < margin.left - 8 || px > margin.left + plotWidth + 8) return null;
    const raw = band
      ? Math.floor((px - margin.left) / step)
      : Math.round((px - margin.left) / step);
    return Math.max(0, Math.min(count - 1, raw));
  });
  const groupWidth = step * 0.84;
  const gap = Math.max(1, Math.min(4, step * 0.06));
  const barWidth = stacked
    ? Math.min(MAX_BAR, groupWidth)
    : Math.min(
        MAX_BAR,
        Math.max(2, (groupWidth - gap * (list.length - 1)) / Math.max(list.length, 1)),
      );
  const groupSpan = stacked ? barWidth : barWidth * list.length + gap * (list.length - 1);
  const label = `${kind === "bar" ? "Bar" : kind === "area" ? "Area" : "Line"} chart of ${list.map((item) => item.name).join(", ")} by ${x}`;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className={cn("relative w-full", className)}
      style={{ height }}
    >
      {width > 0 && (
        <>
          <svg
            width={width}
            height={svgHeight}
            role="img"
            aria-label={label}
            className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            {...handlers}
          >
            <defs>
              {kind === "area" &&
                list.map((item) => (
                  <linearGradient
                    key={item.key}
                    id={`area-${id}-${item.key}`}
                    x1="0"
                    x2="0"
                    y1="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={item.color} stopOpacity={0.32} />
                    <stop offset="95%" stopColor={item.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              <clipPath id={`reveal-${id}`}>
                <motion.rect
                  x={margin.left - 8}
                  y={0}
                  height={svgHeight}
                  initial={{ width: 0 }}
                  animate={{ width: plotWidth + 16 }}
                  transition={{ duration: 0.9, ease }}
                />
              </clipPath>
            </defs>
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={margin.left}
                  x2={margin.left + plotWidth}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke={GRID_STROKE}
                  strokeDasharray="3 4"
                />
                <text
                  x={margin.left - 8}
                  y={y(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  {...AXIS_TEXT}
                >
                  {axisNumber(tick, format, currency)}
                </text>
              </g>
            ))}
            {labels.map((text, index) =>
              index % every === 0 ? (
                <text
                  key={index}
                  x={xAt(index)}
                  y={margin.top + plotHeight + 20}
                  textAnchor="middle"
                  {...AXIS_TEXT}
                >
                  {truncate(text, 18)}
                </text>
              ) : null,
            )}
            {active !== null &&
              (band ? (
                <rect
                  x={margin.left + step * active}
                  y={margin.top}
                  width={step}
                  height={plotHeight}
                  rx={6}
                  fill="hsl(var(--muted) / 0.6)"
                />
              ) : (
                <line
                  x1={xAt(active)}
                  x2={xAt(active)}
                  y1={margin.top}
                  y2={margin.top + plotHeight}
                  stroke={GRID_STROKE}
                />
              ))}
            {band ? (
              list.map((item, seriesIndex) =>
                values[seriesIndex]!.map((value, index) => {
                  const top = Math.min(
                    y(lows[seriesIndex]![index]!),
                    y(highs[seriesIndex]![index]!),
                  );
                  const size = Math.abs(
                    y(lows[seriesIndex]![index]!) - y(highs[seriesIndex]![index]!),
                  );
                  const left =
                    margin.left +
                    step * index +
                    (step - groupSpan) / 2 +
                    (stacked ? 0 : seriesIndex * (barWidth + gap));
                  const rounded = !stacked || seriesIndex === list.length - 1 ? BAR_RADIUS : 0;
                  const radii: [number, number, number, number] =
                    value >= 0 ? [rounded, rounded, 0, 0] : [0, 0, rounded, rounded];
                  return (
                    <motion.path
                      key={`${item.key}-${index}`}
                      d={roundedRect(left, top, barWidth, size, radii)}
                      fill={item.color}
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ duration: 0.8, ease, delay: Math.min(index * 0.02, 0.4) }}
                      style={{ transformBox: "fill-box", originY: value >= 0 ? 1 : 0 }}
                    />
                  );
                }),
              )
            ) : (
              <g clipPath={`url(#reveal-${id})`}>
                {list.map((item, seriesIndex) => {
                  const top = highs[seriesIndex]!.map((value, index): [number, number] => [
                    xAt(index),
                    y(value),
                  ]);
                  const line = monotonePath(top);
                  const bottom = lows[seriesIndex]!.map((value, index): [number, number] => [
                    xAt(index),
                    y(value),
                  ]).reverse();
                  return (
                    <g key={item.key}>
                      {kind === "area" && (
                        <path
                          d={`${line}${monotonePath(bottom, false)}Z`}
                          fill={`url(#area-${id}-${item.key})`}
                        />
                      )}
                      <path
                        d={line}
                        fill="none"
                        stroke={item.color}
                        strokeWidth={2.5}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    </g>
                  );
                })}
              </g>
            )}
            {!band &&
              active !== null &&
              list.map((item, seriesIndex) => (
                <circle
                  key={item.key}
                  cx={xAt(active)}
                  cy={y(highs[seriesIndex]![active]!)}
                  r={5}
                  fill={item.color}
                  stroke="hsl(var(--card))"
                  strokeWidth={2}
                />
              ))}
          </svg>
          {active !== null && (
            <TooltipBox
              label={labels[active]}
              rows={list.map((item, seriesIndex) => ({
                name: item.name,
                value: values[seriesIndex]![active]!,
                color: item.color,
              }))}
              format={format}
              currency={currency}
              left={xAt(active) + 12}
              top={margin.top}
              flip={xAt(active) > width * 0.6}
            />
          )}
          {legend && <Legend items={list} className="mt-2" />}
        </>
      )}
    </motion.div>
  );
}

function HorizontalBars({
  data,
  x,
  series,
  height = 280,
  format,
  currency,
  legend,
  stacked,
  className,
}: BaseProps & { stacked?: boolean }) {
  const list = seriesOf(series);
  const [ref, width] = useWidth<HTMLDivElement>();
  const svgHeight = height - (legend ? LEGEND_HEIGHT : 0);
  const margin = { top: 8, right: 12, bottom: 24, left: 128 };
  const plotWidth = Math.max(width - margin.left - margin.right, 10);
  const plotHeight = Math.max(svgHeight - margin.top - margin.bottom, 10);
  const values = list.map((item) => data.map((row) => Number(row[item.key]) || 0));
  const { lows, highs } = stack(values, stacked);
  const all = [...highs.flat(), ...lows.flat()];
  const ticks = niceTicks(
    Math.min(0, ...all),
    Math.max(0, ...all),
    Math.max(2, Math.floor(plotWidth / 90)),
  );
  const scale = linear(
    [ticks[0]!, ticks[ticks.length - 1]!],
    [margin.left, margin.left + plotWidth],
  );
  const count = data.length;
  const step = plotHeight / Math.max(count, 1);
  const thickness = stacked
    ? Math.min(MAX_BAR, step * 0.8)
    : Math.min(
        MAX_BAR,
        Math.max(2, (step * 0.8 - 4 * (list.length - 1)) / Math.max(list.length, 1)),
      );
  const span = stacked ? thickness : thickness * list.length + 4 * (list.length - 1);
  const { active, handlers } = useActiveIndex(count, (_px, py) => {
    if (!count || py < margin.top || py > margin.top + plotHeight) return null;
    return Math.max(0, Math.min(count - 1, Math.floor((py - margin.top) / step)));
  });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className={cn("relative w-full", className)}
      style={{ height }}
    >
      {width > 0 && (
        <>
          <svg
            width={width}
            height={svgHeight}
            role="img"
            aria-label={`Bar chart of ${list.map((item) => item.name).join(", ")} by ${x}`}
            className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            {...handlers}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={scale(tick)}
                  x2={scale(tick)}
                  y1={margin.top}
                  y2={margin.top + plotHeight}
                  stroke={GRID_STROKE}
                  strokeDasharray="3 4"
                />
                <text
                  x={scale(tick)}
                  y={margin.top + plotHeight + 18}
                  textAnchor="middle"
                  {...AXIS_TEXT}
                >
                  {axisNumber(tick, format, currency)}
                </text>
              </g>
            ))}
            {active !== null && (
              <rect
                x={margin.left}
                y={margin.top + step * active}
                width={plotWidth}
                height={step}
                rx={6}
                fill="hsl(var(--muted) / 0.6)"
              />
            )}
            {data.map((row, index) => (
              <text
                key={index}
                x={margin.left - 8}
                y={margin.top + step * (index + 0.5)}
                textAnchor="end"
                dominantBaseline="middle"
                {...AXIS_TEXT}
              >
                {truncate(String(row[x] ?? ""), 16)}
              </text>
            ))}
            {list.map((item, seriesIndex) =>
              values[seriesIndex]!.map((value, index) => {
                const a = scale(lows[seriesIndex]![index]!);
                const b = scale(highs[seriesIndex]![index]!);
                const top =
                  margin.top +
                  step * index +
                  (step - span) / 2 +
                  (stacked ? 0 : seriesIndex * (thickness + 4));
                const rounded = !stacked || seriesIndex === list.length - 1 ? BAR_RADIUS : 0;
                const radii: [number, number, number, number] =
                  value >= 0 ? [0, rounded, rounded, 0] : [rounded, 0, 0, rounded];
                return (
                  <motion.path
                    key={`${item.key}-${index}`}
                    d={roundedRect(Math.min(a, b), top, Math.abs(b - a), thickness, radii)}
                    fill={item.color}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.8, ease, delay: Math.min(index * 0.03, 0.4) }}
                    style={{ transformBox: "fill-box", originX: value >= 0 ? 0 : 1 }}
                  />
                );
              }),
            )}
          </svg>
          {active !== null && (
            <TooltipBox
              label={String(data[active]?.[x] ?? "")}
              rows={list.map((item, seriesIndex) => ({
                name: item.name,
                value: values[seriesIndex]![active]!,
                color: item.color,
              }))}
              format={format}
              currency={currency}
              left={margin.left + 12}
              top={margin.top + step * (active + 1) + 4}
            />
          )}
          {legend && <Legend items={list} className="mt-2" />}
        </>
      )}
    </motion.div>
  );
}

export function AreaChart(props: BaseProps & { stacked?: boolean }) {
  return <Cartesian kind="area" {...props} />;
}

export function BarChart({
  horizontal,
  ...props
}: BaseProps & { stacked?: boolean; horizontal?: boolean }) {
  return horizontal ? <HorizontalBars {...props} /> : <Cartesian kind="bar" {...props} />;
}

export function LineChart(props: BaseProps) {
  return <Cartesian kind="line" {...props} />;
}

/** A donut with the total in the middle and a legend beside it; hovering a slice shows its figure. */
export function DonutChart({
  data,
  label = "label",
  value = "value",
  height = 240,
  format,
  currency,
  centerLabel = "Total",
  className,
}: {
  data: Array<Record<string, unknown>>;
  label?: string;
  value?: string;
  height?: number;
  format?: NumberFormat;
  currency?: string;
  centerLabel?: ReactNode;
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const amounts = data.map((item) => Math.max(0, Number(item[value]) || 0));
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  const gap = amounts.filter(Boolean).length > 1 ? 0.006 : 0;
  let start = 0;
  const slices = amounts.map((amount) => {
    const share = total ? amount / total : 0;
    const slice = { start, share: Math.max(0, share - gap) };
    start += share;
    return slice;
  });
  const shown = active === null ? null : data[active];
  return (
    <div className={cn("@container", className)}>
      <div className="flex flex-col items-center gap-5 @md:flex-row">
        <div
          className="relative aspect-square shrink-0"
          style={{ width: `min(${height}px, 100%)` }}
        >
          <svg
            viewBox="0 0 100 100"
            className="size-full"
            role="img"
            aria-label={`Donut chart by ${label}`}
          >
            <circle
              cx={50}
              cy={50}
              r={42}
              fill="none"
              stroke="hsl(var(--muted) / 0.5)"
              strokeWidth={16}
            />
            {slices.map((slice, index) =>
              slice.share > 0 ? (
                <motion.circle
                  key={String(data[index]?.[label] ?? index)}
                  cx={50}
                  cy={50}
                  r={42}
                  fill="none"
                  stroke={CHART_COLORS[index % CHART_COLORS.length]}
                  strokeWidth={active === index ? 18 : 16}
                  transform={`rotate(${slice.start * 360 - 90} 50 50)`}
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: slice.share }}
                  transition={{ duration: 0.9, ease, delay: slice.start * 0.4 }}
                  onPointerEnter={() => setActive(index)}
                  onPointerLeave={() => setActive(null)}
                  className="cursor-default transition-[stroke-width]"
                />
              ) : null,
            )}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <span className="max-w-full truncate text-xs font-semibold text-muted-foreground">
              {shown ? String(shown[label]) : centerLabel}
            </span>
            <span className="text-xl font-bold tabular">
              {formatNumber(shown ? amounts[active!]! : total, format, currency)}
            </span>
          </div>
        </div>
        <ul className="flex w-full min-w-0 flex-col gap-1">
          {data.map((item, index) => {
            const amount = amounts[index]!;
            return (
              <li
                key={String(item[label])}
                onPointerEnter={() => setActive(index)}
                onPointerLeave={() => setActive(null)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-1.5 py-0.5 text-sm transition-colors",
                  active === index && "bg-muted",
                )}
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
                />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {String(item[label])}
                </span>
                <span className="font-semibold tabular">
                  {formatNumber(amount, format, currency)}
                </span>
                <span className="w-11 text-right text-xs tabular text-muted-foreground">
                  {total ? `${Math.round((amount / total) * 100)}%` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** Ranked horizontal bars for "top N" lists, with values on the right. */
export function BarList({
  data,
  label = "label",
  value = "value",
  format,
  currency,
  max = 8,
  onSelect,
}: {
  data: Array<Record<string, unknown>>;
  label?: string;
  value?: string;
  format?: NumberFormat;
  currency?: string;
  max?: number;
  onSelect?: (item: Record<string, unknown>) => void;
}) {
  const sorted = [...data]
    .sort((a, b) => (Number(b[value]) || 0) - (Number(a[value]) || 0))
    .slice(0, max);
  const top = Math.max(...sorted.map((item) => Number(item[value]) || 0), 1);
  return (
    <ul className="flex flex-col gap-2">
      {sorted.map((item, index) => (
        <li key={String(item[label])}>
          <button
            type="button"
            disabled={!onSelect}
            onClick={() => onSelect?.(item)}
            className="group relative flex h-9 w-full items-center justify-between gap-3 overflow-hidden rounded-lg px-3 text-left text-sm disabled:cursor-default"
          >
            <motion.span
              className="absolute inset-y-0 left-0 rounded-lg bg-primary/14 group-enabled:group-hover:bg-primary/22"
              initial={{ width: 0 }}
              animate={{ width: `${((Number(item[value]) || 0) / top) * 100}%` }}
              transition={{ duration: 0.8, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
            />
            <span className="relative truncate font-medium">{String(item[label])}</span>
            <span className="relative font-bold tabular">
              {formatNumber(Number(item[value]) || 0, format, currency)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
