import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useId } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  Pie,
  PieChart,
  AreaChart as RAreaChart,
  BarChart as RBarChart,
  ResponsiveContainer,
  LineChart as RLineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_COLORS, cn } from "./cn.js";
import type { NumberFormat } from "./kpi.js";
import { formatNumber } from "./kpi.js";

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

const seriesOf = (series: Array<Series | string>): Series[] =>
  series.map((item, index) => {
    const value = typeof item === "string" ? { key: item } : item;
    return { ...value, color: value.color ?? CHART_COLORS[index % CHART_COLORS.length] };
  });

const AXIS = {
  tickLine: false,
  axisLine: false,
  tick: { fill: "hsl(var(--muted-foreground))", fontSize: 12 },
} as const;

function ChartTooltip({
  active,
  payload,
  label,
  format,
  currency,
}: {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number;
    color?: string;
    payload?: Record<string, unknown>;
  }>;
  label?: ReactNode;
  format?: NumberFormat;
  currency?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-xl border border-border bg-popover/95 px-3 py-2.5 text-xs shadow-lift backdrop-blur">
      {label !== undefined && label !== "" && (
        <p className="mb-1.5 font-bold text-foreground">{label}</p>
      )}
      <div className="flex flex-col gap-1">
        {payload.map((item) => (
          <div key={item.name} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-full" style={{ background: item.color }} />
              {item.name}
            </span>
            <span className="font-bold tabular text-foreground">
              {formatNumber(Number(item.value), format, currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Frame({
  height,
  className,
  children,
}: {
  height: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className={cn("w-full", className)}
      style={{ height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        {children as never}
      </ResponsiveContainer>
    </motion.div>
  );
}

export function AreaChart({
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
  const id = useId().replace(/:/g, "");
  const list = seriesOf(series);
  return (
    <Frame height={height} className={className}>
      <RAreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {list.map((item) => (
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
        </defs>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 4" />
        <XAxis dataKey={x} {...AXIS} dy={8} />
        <YAxis
          {...AXIS}
          width={56}
          tickFormatter={(value: number) =>
            formatNumber(value, format === "currency" ? "compact" : format, currency)
          }
        />
        <Tooltip
          content={<ChartTooltip format={format} currency={currency} />}
          cursor={{ stroke: "hsl(var(--border))" }}
        />
        {legend && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
        {list.map((item) => (
          <Area
            key={item.key}
            type="monotone"
            dataKey={item.key}
            name={item.label ?? item.key}
            stroke={item.color}
            strokeWidth={2.5}
            fill={`url(#area-${id}-${item.key})`}
            stackId={stacked ? "stack" : undefined}
            animationDuration={900}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "hsl(var(--card))" }}
          />
        ))}
      </RAreaChart>
    </Frame>
  );
}

export function BarChart({
  data,
  x,
  series,
  height = 280,
  format,
  currency,
  legend,
  stacked,
  horizontal,
  className,
}: BaseProps & { stacked?: boolean; horizontal?: boolean }) {
  const list = seriesOf(series);
  return (
    <Frame height={height} className={className}>
      <RBarChart
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        barGap={4}
      >
        <CartesianGrid
          vertical={horizontal}
          horizontal={!horizontal}
          stroke="hsl(var(--border))"
          strokeDasharray="3 4"
        />
        {horizontal ? (
          <>
            <XAxis
              type="number"
              {...AXIS}
              tickFormatter={(value: number) =>
                formatNumber(value, format === "currency" ? "compact" : format, currency)
              }
            />
            <YAxis type="category" dataKey={x} {...AXIS} width={120} />
          </>
        ) : (
          <>
            <XAxis dataKey={x} {...AXIS} dy={8} />
            <YAxis
              {...AXIS}
              width={56}
              tickFormatter={(value: number) =>
                formatNumber(value, format === "currency" ? "compact" : format, currency)
              }
            />
          </>
        )}
        <Tooltip
          content={<ChartTooltip format={format} currency={currency} />}
          cursor={{ fill: "hsl(var(--muted) / 0.6)" }}
        />
        {legend && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
        {list.map((item, index) => (
          <Bar
            key={item.key}
            dataKey={item.key}
            name={item.label ?? item.key}
            fill={item.color}
            stackId={stacked ? "stack" : undefined}
            radius={
              stacked && index < list.length - 1 ? 0 : horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]
            }
            maxBarSize={44}
            animationDuration={800}
          />
        ))}
      </RBarChart>
    </Frame>
  );
}

export function LineChart({
  data,
  x,
  series,
  height = 280,
  format,
  currency,
  legend,
  className,
}: BaseProps) {
  const list = seriesOf(series);
  return (
    <Frame height={height} className={className}>
      <RLineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 4" />
        <XAxis dataKey={x} {...AXIS} dy={8} />
        <YAxis
          {...AXIS}
          width={56}
          tickFormatter={(value: number) =>
            formatNumber(value, format === "currency" ? "compact" : format, currency)
          }
        />
        <Tooltip content={<ChartTooltip format={format} currency={currency} />} />
        {legend && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
        {list.map((item) => (
          <Line
            key={item.key}
            type="monotone"
            dataKey={item.key}
            name={item.label ?? item.key}
            stroke={item.color}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "hsl(var(--card))" }}
            animationDuration={900}
          />
        ))}
      </RLineChart>
    </Frame>
  );
}

/** A donut with the total in the middle and a legend beside it. */
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
  const total = data.reduce((sum, item) => sum + (Number(item[value]) || 0), 0);
  return (
    <div className={cn("flex flex-col items-center gap-5 sm:flex-row", className)}>
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<ChartTooltip format={format} currency={currency} />} />
            <Pie
              data={data}
              dataKey={value}
              nameKey={label}
              innerRadius="68%"
              outerRadius="100%"
              paddingAngle={2}
              cornerRadius={6}
              stroke="none"
              animationDuration={900}
            >
              {data.map((item, index) => (
                <Cell key={String(item[label])} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs font-semibold text-muted-foreground">{centerLabel}</span>
          <span className="text-xl font-bold tabular">{formatNumber(total, format, currency)}</span>
        </div>
      </div>
      <ul className="flex w-full min-w-0 flex-col gap-2">
        {data.map((item, index) => {
          const amount = Number(item[value]) || 0;
          return (
            <li key={String(item[label])} className="flex items-center gap-2.5 text-sm">
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
