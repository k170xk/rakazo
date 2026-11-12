import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { animate, motion, useInView, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import type { Tone } from "../schema.js";
import { cn, ease } from "./cn.js";

export type NumberFormat =
  | "number"
  | "currency"
  | "percent"
  | "compact"
  | ((value: number) => string);

export function formatNumber(
  value: number,
  format: NumberFormat = "number",
  currency = "EUR",
): string {
  if (typeof format === "function") return format(value);
  if (!Number.isFinite(value)) return "—";
  switch (format) {
    case "currency":
      return new Intl.NumberFormat("en-IE", {
        style: "currency",
        currency,
        maximumFractionDigits: Math.abs(value) >= 1_000_000 ? 1 : Math.abs(value) >= 1000 ? 0 : 2,
        notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard",
      }).format(value);
    case "percent":
      return `${value.toLocaleString("en-IE", { maximumFractionDigits: 1 })}%`;
    case "compact":
      return new Intl.NumberFormat("en-IE", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);
    default:
      return value.toLocaleString("en-IE", { maximumFractionDigits: Math.abs(value) < 10 ? 2 : 0 });
  }
}

/** A number that counts up when it comes into view and glides when it changes. */
export function CountUp({
  value,
  format = "number",
  currency,
  duration = 1.1,
}: {
  value: number;
  format?: NumberFormat;
  currency?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true });
  const still = useReducedMotion();
  const from = useRef(0);
  const [shown, setShown] = useState(still ? value : 0);
  useEffect(() => {
    if (still) {
      from.current = value;
      setShown(value);
      return;
    }
    if (!seen) return;
    const controls = animate(from.current, value, {
      duration,
      ease,
      onUpdate: (latest) => setShown(latest),
    });
    from.current = value;
    return () => controls.stop();
  }, [seen, still, value, duration]);
  const decimals = Number.isInteger(value) ? 0 : 1;
  const display = Math.abs(value - shown) < 1e-9 ? value : Number(shown.toFixed(decimals));
  return (
    <span ref={ref} className="tabular">
      {formatNumber(display, format, currency)}
    </span>
  );
}

/** A tiny trend line drawn in on mount. */
export function Sparkline({
  data,
  width = 120,
  height = 36,
  tone = "accent",
  fill = true,
}: {
  data: number[];
  width?: number;
  height?: number;
  tone?: Tone;
  fill?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const points: Array<[number, number]> = data.map((value, index) => [
    (index / (data.length - 1)) * width,
    height - 3 - ((value - min) / span) * (height - 6),
  ]);
  const line = points
    .map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const color =
    tone === "danger"
      ? "hsl(var(--destructive))"
      : tone === "warning"
        ? "hsl(var(--warning))"
        : tone === "info"
          ? "hsl(var(--info))"
          : "hsl(var(--primary))";
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {fill && (
        <motion.path
          d={`${line} L${width},${height} L0,${height} Z`}
          fill={`url(#spark-${id})`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.4 }}
        />
      )}
      <motion.path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.1, ease }}
      />
    </svg>
  );
}

export type KpiProps = {
  label: ReactNode;
  value: number | string;
  format?: NumberFormat;
  currency?: string;
  /** Change against the last period, in percent; green when up unless downIsGood. */
  delta?: number | null;
  deltaLabel?: ReactNode;
  downIsGood?: boolean;
  trend?: number[];
  icon?: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  onClick?: () => void;
  className?: string;
};

export function KpiCard({
  label,
  value,
  format,
  currency,
  delta,
  deltaLabel,
  downIsGood,
  trend,
  icon,
  hint,
  tone = "accent",
  onClick,
  className,
}: KpiProps) {
  const good =
    delta === null || delta === undefined || delta === 0
      ? null
      : downIsGood
        ? delta < 0
        : delta > 0;
  const iconTint: Record<Tone, string> = {
    accent: "bg-primary/12 text-primary",
    success: "bg-success/12 text-success",
    warning: "bg-warning/15 text-warning",
    danger: "bg-destructive/12 text-destructive",
    info: "bg-info/12 text-info",
    neutral: "bg-muted text-muted-foreground",
  };
  return (
    <motion.div
      whileHover={onClick ? { y: -2 } : undefined}
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border/70 bg-card p-5 shadow-card",
        onClick && "cursor-pointer transition-shadow hover:shadow-lift",
        className,
      )}
    >
      <div className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full bg-primary/6 blur-2xl transition-opacity group-hover:opacity-100" />
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-[13px] font-semibold text-muted-foreground">{label}</p>
        {icon && (
          <div
            className={cn(
              "flex size-9 items-center justify-center rounded-xl [&_svg]:size-[18px]",
              iconTint[tone],
            )}
          >
            {icon}
          </div>
        )}
      </div>
      <div className="relative mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[28px] leading-none font-bold tracking-tight">
            {typeof value === "number" ? (
              <CountUp value={value} format={format} currency={currency} />
            ) : (
              value
            )}
          </p>
          {(good !== null || hint) && (
            <div className="mt-2.5 flex items-center gap-2 text-xs">
              {good !== null && delta !== null && delta !== undefined && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-bold",
                    good ? "bg-success/12 text-success" : "bg-destructive/12 text-destructive",
                  )}
                >
                  {delta > 0 ? (
                    <ArrowUpRight className="size-3" />
                  ) : delta < 0 ? (
                    <ArrowDownRight className="size-3" />
                  ) : (
                    <Minus className="size-3" />
                  )}
                  {Math.abs(delta).toLocaleString("en-IE", { maximumFractionDigits: 1 })}%
                </span>
              )}
              <span className="truncate text-muted-foreground">{deltaLabel ?? hint}</span>
            </div>
          )}
        </div>
        {trend && trend.length > 1 && (
          <div className="shrink-0">
            <Sparkline
              data={trend}
              tone={good === false ? "danger" : tone === "neutral" ? "accent" : tone}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}
