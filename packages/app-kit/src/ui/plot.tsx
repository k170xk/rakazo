import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "./cn.js";
import type { NumberFormat } from "./kpi.js";
import { formatNumber } from "./kpi.js";

/**
 * The kit's own chart drawing: scales, smooth curves, axes, tooltips and legends in plain SVG.
 * It replaces recharts inside the kit so a chart costs a few kilobytes instead of ~380 KB.
 */

export const AXIS_TEXT = { fill: "hsl(var(--muted-foreground))", fontSize: 12 } as const;
export const GRID_STROKE = "hsl(var(--border))";

/** The width of an element, following resizes; a fallback width before the first measure. */
export function useWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(Math.round(element.getBoundingClientRect().width) || fallback);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}

function niceStep(span: number, count: number): number {
  const raw = span / Math.max(count, 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normal = raw / magnitude;
  return (normal >= 7.5 ? 10 : normal >= 3.5 ? 5 : normal >= 1.5 ? 2 : 1) * magnitude;
}

/** Round tick values covering min..max (always including zero), about `count` of them. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  let low = Math.min(0, Number.isFinite(min) ? min : 0);
  let high = Math.max(0, Number.isFinite(max) ? max : 0);
  if (low === high) {
    high = low === 0 ? 1 : high + Math.abs(high);
    low = Math.min(0, low);
  }
  const step = niceStep(high - low, count);
  const ticks: number[] = [];
  for (
    let value = Math.floor(low / step) * step;
    value <= Math.ceil(high / step) * step + step / 2;
    value += step
  ) {
    ticks.push(Number(value.toPrecision(12)));
  }
  return ticks;
}

export type Scale = ((value: number) => number) & { domain: [number, number] };

export function linear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const scale = ((value: number) => r0 + ((value - d0) / span) * (r1 - r0)) as Scale;
  scale.domain = domain;
  return scale;
}

const sign = (value: number) => (value < 0 ? -1 : 1);

/** A smooth path through the points that never overshoots (monotone cubic, as d3's curveMonotoneX). */
export function monotonePath(points: Array<[number, number]>, move = true): string {
  const n = points.length;
  if (!n) return "";
  const head = `${move ? "M" : "L"}${points[0]![0]},${points[0]![1]}`;
  if (n === 1) return head;
  if (n === 2) return `${head}L${points[1]![0]},${points[1]![1]}`;
  const tangents = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[i + 1]!;
    const h0 = x1 - x0;
    const h1 = x2 - x1;
    const s0 = h0 ? (y1 - y0) / h0 : 0;
    const s1 = h1 ? (y2 - y1) / h1 : 0;
    const p = h0 + h1 ? (s0 * h1 + s1 * h0) / (h0 + h1) : 0;
    tangents[i] =
      (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  }
  const end = (a: [number, number], b: [number, number], t: number) => {
    const h = b[0] - a[0];
    return h ? (3 * (b[1] - a[1])) / h / 2 - t / 2 : t;
  };
  tangents[0] = end(points[0]!, points[1]!, tangents[1]!);
  tangents[n - 1] = end(points[n - 2]!, points[n - 1]!, tangents[n - 2]!);
  let path = head;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    const dx = (x1 - x0) / 3;
    path += `C${x0 + dx},${y0 + dx * tangents[i]!},${x1 - dx},${y1 - dx * tangents[i + 1]!},${x1},${y1}`;
  }
  return path;
}

/** A rectangle path with its own radius per corner (top-left, top-right, bottom-right, bottom-left). */
export function roundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  radii: [number, number, number, number],
): string {
  if (w <= 0 || h <= 0) return "";
  const limit = Math.min(w / 2, h / 2);
  const [tl, tr, br, bl] = radii.map((r) => Math.max(0, Math.min(r, limit))) as [
    number,
    number,
    number,
    number,
  ];
  return [
    `M${x + tl},${y}H${x + w - tr}`,
    tr ? `A${tr},${tr} 0 0 1 ${x + w},${y + tr}` : "",
    `V${y + h - br}`,
    br ? `A${br},${br} 0 0 1 ${x + w - br},${y + h}` : "",
    `H${x + bl}`,
    bl ? `A${bl},${bl} 0 0 1 ${x},${y + h - bl}` : "",
    `V${y + tl}`,
    tl ? `A${tl},${tl} 0 0 1 ${x + tl},${y}` : "",
    "Z",
  ].join("");
}

/** Axis numbers stay short: currency axes use compact figures (€12k), as the old charts did. */
export const axisNumber = (value: number, format?: NumberFormat, currency?: string) =>
  formatNumber(value, format === "currency" ? "compact" : format, currency);

export const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

export type TooltipRow = { name: string; value: number; color: string };

export function TooltipBox({
  label,
  rows,
  format,
  currency,
  left,
  top,
  flip,
}: {
  label?: ReactNode;
  rows: TooltipRow[];
  format?: NumberFormat;
  currency?: string;
  left: number;
  top: number;
  flip?: boolean;
}) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 min-w-36 rounded-xl border border-border bg-popover/95 px-3 py-2.5 text-xs shadow-lift backdrop-blur"
      style={{ left, top, transform: flip ? "translateX(calc(-100% - 24px))" : undefined }}
    >
      {label !== undefined && label !== "" && (
        <p className="mb-1.5 font-bold text-foreground">{label}</p>
      )}
      <div className="flex flex-col gap-1">
        {rows.map((row) => (
          <div key={row.name} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-full" style={{ background: row.color }} />
              {row.name}
            </span>
            <span className="font-bold tabular text-foreground">
              {formatNumber(row.value, format, currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Legend({
  items,
  className,
}: {
  items: Array<{ name: string; color: string }>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {items.map((item) => (
        <span key={item.name} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: item.color }} />
          {item.name}
        </span>
      ))}
    </div>
  );
}

/** Pointer and arrow-key tracking of which category is under the cursor. */
export function useActiveIndex(count: number, indexAt: (x: number, y: number) => number | null) {
  const [active, setActive] = useState<number | null>(null);
  return {
    active,
    setActive,
    handlers: {
      tabIndex: 0,
      onPointerMove: (event: PointerEvent<SVGSVGElement>) => {
        const box = event.currentTarget.getBoundingClientRect();
        setActive(indexAt(event.clientX - box.left, event.clientY - box.top));
      },
      onPointerLeave: () => setActive(null),
      onBlur: () => setActive(null),
      onKeyDown: (event: KeyboardEvent<SVGSVGElement>) => {
        if (!count) return;
        const step =
          event.key === "ArrowRight" || event.key === "ArrowDown"
            ? 1
            : event.key === "ArrowLeft" || event.key === "ArrowUp"
              ? -1
              : 0;
        if (!step) return;
        event.preventDefault();
        setActive((current) =>
          current === null ? (step > 0 ? 0 : count - 1) : (current + step + count) % count,
        );
      },
    },
  };
}
