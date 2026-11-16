import { Download } from "lucide-react";
import type { PointerEvent, ReactNode } from "react";
import { useId, useRef } from "react";
import type { NumberStyle } from "../eng/format.js";
import { fmt } from "../eng/format.js";
import type { Tone } from "../schema.js";
import { download } from "../sdk/index.js";
import { cn } from "../ui/cn.js";
import { useWidth } from "../ui/plot.js";
import { PRINT_LIGHT } from "./print.js";
import type { Scale, ScaleType } from "./scale.js";
import { linearScale, logDomain, logScale, logTicks, niceDomain, niceTicks, px, tickFormat } from "./scale.js";

export type Axis = {
  label?: string;
  unit?: string;
  scale?: ScaleType;
  min?: number;
  max?: number;
  /** Exact tick values instead of generated ones. */
  ticks?: number[];
  /** Named positions 0, 1, 2 … (bar charts by element, stage or option). */
  categories?: string[];
  format?: (value: number) => string;
  style?: NumberStyle;
  /** Values increase downwards (y) or leftwards (x), e.g. depth below ground. */
  reverse?: boolean;
  /** Keep zero inside the axis. */
  zero?: boolean;
  grid?: boolean;
};

export type ResolvedAxis = {
  type: ScaleType;
  domain: [number, number];
  major: number[];
  minor: number[];
  format: (value: number) => string;
  title: string;
  reverse: boolean;
  grid: boolean;
};

/** Colour by chart slot (1–6), semantic tone, or any CSS colour. */
export type PlotColor = number | Tone | "primary" | "foreground" | "muted" | (string & {});

const TONE_VAR: Record<string, string> = {
  success: "--success",
  warning: "--warning",
  danger: "--destructive",
  info: "--info",
  accent: "--chart-4",
  neutral: "--muted-foreground",
  muted: "--muted-foreground",
  primary: "--primary",
  foreground: "--foreground",
};

export function colorOf(color: PlotColor | undefined, index = 0): string {
  if (color === undefined) return `hsl(var(--chart-${(index % 6) + 1}))`;
  if (typeof color === "number") return `hsl(var(--chart-${((Math.max(1, Math.round(color)) - 1) % 6) + 1}))`;
  const token = TONE_VAR[color];
  return token ? `hsl(var(${token}))` : color;
}

export const TEXT = "hsl(var(--muted-foreground))";
export const INK = "hsl(var(--foreground))";
export const RULE = "hsl(var(--border))";
export const FONT = 11;

/** Works out an axis's scale type, domain, ticks and label format from its options and data. */
export function resolveAxis(axis: Axis = {}, values: number[], length: number, along: "x" | "y"): ResolvedAxis {
  const type: ScaleType = axis.scale ?? "linear";
  const title = [axis.label, axis.unit ? `(${axis.unit})` : ""].filter(Boolean).join(" ");
  const base = { type, title, reverse: Boolean(axis.reverse), grid: axis.grid ?? true };
  if (axis.categories) {
    const n = axis.categories.length;
    const major = axis.categories.map((_, i) => i);
    return { ...base, type: "linear", domain: [-0.5, Math.max(0.5, n - 0.5)], major, minor: [], format: (v) => axis.categories?.[Math.round(v)] ?? "" };
  }
  const finite = values.filter((v) => Number.isFinite(v) && (type === "linear" || v > 0));
  let low = Math.min(...finite);
  let high = Math.max(...finite);
  if (!finite.length) [low, high] = type === "log" ? [1, 10] : [0, 1];
  if (axis.zero && type === "linear") {
    low = Math.min(low, 0);
    high = Math.max(high, 0);
  }
  const count = Math.max(2, Math.round(length / (along === "x" ? 90 : 48)));
  let domain: [number, number];
  if (type === "log") {
    const auto = logDomain(low, high);
    domain = [axis.min ?? auto[0], axis.max ?? auto[1]];
  } else {
    const auto = niceDomain(low, high, count);
    domain = [axis.min ?? auto[0], axis.max ?? auto[1]];
  }
  let major: number[];
  let minor: number[] = [];
  if (axis.ticks) major = axis.ticks.filter((t) => t >= Math.min(...domain) && t <= Math.max(...domain));
  else if (type === "log") ({ major, minor } = logTicks(domain[0], domain[1]));
  else {
    major = niceTicks(domain[0], domain[1], count);
    const step = major.length > 1 ? major[1]! - major[0]! : 0;
    if (step) minor = niceTicks(domain[0], domain[1], Math.round((domain[1] - domain[0]) / (step / 5))).filter((t) => !major.includes(t));
  }
  const format = axis.format ?? (axis.style ? (v: number) => fmt(v, axis.style) : tickFormat(major));
  return { ...base, domain, major, minor, format };
}

export const makeScale = (axis: ResolvedAxis, range: [number, number]): Scale => {
  const r: [number, number] = axis.reverse ? [range[1], range[0]] : range;
  return axis.type === "log" ? logScale(axis.domain, r) : linearScale(axis.domain, r);
};

/** Characters × average digit width at 11px: enough room for tick labels without measuring text. */
const labelWidth = (axis: ResolvedAxis) => Math.max(...axis.major.map((t) => axis.format(t).length), 1) * 6.4;

export type FrameContext = {
  x: Scale;
  y: Scale;
  y2?: Scale;
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  clip: string;
  id: string;
};

export type LegendItem = { name: string; color: string; kind?: "line" | "area" | "marker"; dash?: string };

export function LegendRow({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null;
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 px-2 pt-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.name} className="inline-flex items-center gap-1.5">
          <svg width="18" height="10" aria-hidden="true">
            {item.kind === "area" ? (
              <rect x="1" y="1" width="16" height="8" rx="2" fill={item.color} fillOpacity={0.35} stroke={item.color} />
            ) : item.kind === "marker" ? (
              <circle cx="9" cy="5" r="3.5" fill={item.color} />
            ) : (
              <line x1="1" x2="17" y1="5" y2="5" stroke={item.color} strokeWidth={2} strokeDasharray={item.dash} />
            )}
          </svg>
          {item.name}
        </span>
      ))}
    </div>
  );
}

const INLINE = ["fill", "stroke", "stroke-width", "stroke-dasharray", "fill-opacity", "stroke-opacity", "opacity", "font-size", "font-family", "font-weight", "paint-order", "stop-color"];

const LIGHT_TOKENS = [...PRINT_LIGHT.matchAll(/print:\[(--[\w-]+):([^\]]+)\]/g)].map((m) => [m[1]!, m[2]!.replaceAll("_", " ")] as const);

/**
 * The SVG as a standalone file: theme colours resolved to values, always in the light palette,
 * so it reads the same on paper and in other documents whichever theme the app is in.
 */
export function svgFile(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const before = svg.getAttribute("style");
  for (const [name, value] of LIGHT_TOKENS) svg.style.setProperty(name, value);
  const source = [svg, ...svg.querySelectorAll("*")];
  const target = [clone, ...clone.querySelectorAll("*")];
  try {
    source.forEach((element, i) => {
      const style = getComputedStyle(element);
      const out = target[i] as SVGElement;
      for (const property of INLINE) {
        const value = style.getPropertyValue(property);
        if (value) out.style.setProperty(property, value);
      }
    });
  } finally {
    if (before === null) svg.removeAttribute("style");
    else svg.setAttribute("style", before);
  }
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const box = svg.viewBox.baseVal;
  if (box?.width) {
    clone.setAttribute("width", String(box.width));
    clone.setAttribute("height", String(box.height));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

/**
 * A plot or drawing as a PNG data URL on white, for PDF reports: `{ type: "image", src }` blocks.
 * Pass the element holding the charts (a ref on a wrapping div; several stack top to bottom) or an SVG.
 */
export async function plotImage(target: Element | null, { scale = 2 }: { scale?: number } = {}): Promise<string> {
  const svgs = target instanceof SVGSVGElement ? [target] : [...(target?.querySelectorAll<SVGSVGElement>("svg[data-plot]") ?? [])];
  if (svgs.length === 0) throw new Error("There is no chart or drawing to capture.");
  const parts = await Promise.all(
    svgs.map(async (svg) => {
      const box = svg.viewBox.baseVal;
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgFile(svg))}`;
      await image.decode();
      return { image, width: box?.width || svg.clientWidth || 640, height: box?.height || svg.clientHeight || 320 };
    }),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(Math.max(...parts.map((p) => p.width)) * scale);
  canvas.height = Math.round(parts.reduce((sum, p) => sum + p.height, 0) * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can't draw the image.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  let y = 0;
  for (const part of parts) {
    context.drawImage(part.image, 0, Math.round(y * scale), Math.round(part.width * scale), Math.round(part.height * scale));
    y += part.height;
  }
  return canvas.toDataURL("image/png");
}

export function ExportButton({ target, name }: { target: () => SVGSVGElement | null; name: string }) {
  return (
    <button
      type="button"
      aria-label="Download SVG"
      title="Download SVG"
      className="absolute top-1 right-1 grid size-8 place-items-center rounded-lg text-muted-foreground opacity-70 transition hover:bg-muted hover:opacity-100 focus-visible:opacity-100 print:hidden"
      onClick={() => {
        const svg = target();
        if (svg) void download(`${name.replace(/[^\w.-]+/g, "-")}.svg`, svgFile(svg), "image/svg+xml");
      }}
    >
      <Download className="size-4" />
    </button>
  );
}

/** A stable id for clip paths and patterns: React's useId, kept to characters url(#…) accepts. */
export function useSvgId(prefix: string) {
  return `${prefix}${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
}

export type FrameProps = {
  x: ResolvedAxis;
  y: ResolvedAxis;
  y2?: ResolvedAxis;
  width: number;
  height: number;
  /** Extra room on the right (colour bars). */
  gutter?: number;
  title?: string;
  children: (ctx: FrameContext) => ReactNode;
  overlay?: (ctx: FrameContext) => ReactNode;
  onPointer?: (ctx: FrameContext, point: { x: number; y: number } | null) => void;
  svgRef?: (element: SVGSVGElement | null) => void;
};

/** Axes, grid and tick labels around a plot area; the chart draws inside through children(ctx). */
export function Frame({ x, y, y2, width, height, gutter = 0, title, children, overlay, onPointer, svgRef }: FrameProps) {
  const id = useSvgId("p");
  const left = Math.round(10 + labelWidth(y) + (y.title ? 18 : 0));
  const right = width - Math.round(12 + gutter + (y2 ? labelWidth(y2) + 10 + (y2.title ? 18 : 0) : 0));
  const top = 10;
  const bottom = height - (24 + (x.title ? 18 : 0));
  const ctx: FrameContext = {
    x: makeScale(x, [left, right]),
    y: makeScale(y, [bottom, top]),
    ...(y2 ? { y2: makeScale(y2, [bottom, top]) } : {}),
    left,
    right,
    top,
    bottom,
    width,
    height,
    clip: `${id}c`,
    id,
  };
  const pointer = (event: PointerEvent<SVGSVGElement>) => {
    if (!onPointer) return;
    const box = event.currentTarget.getBoundingClientRect();
    const scale = box.width ? width / box.width : 1;
    onPointer(ctx, { x: (event.clientX - box.left) * scale, y: (event.clientY - box.top) * scale });
  };
  const gridLines = (axis: ResolvedAxis, scale: Scale, along: "x" | "y", values: number[], minor: boolean) =>
    axis.grid &&
    values.map((value) => {
      const at = px(scale(value));
      if (!Number.isFinite(at)) return null;
      return along === "x" ? (
        <line key={`${along}${minor ? "m" : ""}${value}`} x1={at} x2={at} y1={top} y2={bottom} stroke={RULE} strokeOpacity={minor ? 0.45 : 1} strokeDasharray={minor ? "2 3" : undefined} />
      ) : (
        <line key={`${along}${minor ? "m" : ""}${value}`} x1={left} x2={right} y1={at} y2={at} stroke={RULE} strokeOpacity={minor ? 0.45 : 1} strokeDasharray={minor ? "2 3" : undefined} />
      );
    });
  return (
    <svg
      ref={svgRef}
      data-plot=""
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label={title}
      className="block touch-pan-y overflow-visible select-none"
      style={{ fontVariantNumeric: "tabular-nums" }}
      onPointerMove={onPointer ? pointer : undefined}
      onPointerLeave={onPointer ? () => onPointer(ctx, null) : undefined}
    >
      {title && <title>{title}</title>}
      <defs>
        <clipPath id={ctx.clip}>
          <rect x={left} y={top} width={Math.max(0, right - left)} height={Math.max(0, bottom - top)} />
        </clipPath>
      </defs>
      <g>
        {gridLines(x, ctx.x, "x", x.minor, true)}
        {gridLines(y, ctx.y, "y", y.minor, true)}
        {gridLines(x, ctx.x, "x", x.major, false)}
        {gridLines(y, ctx.y, "y", y.major, false)}
      </g>
      <rect x={left} y={top} width={Math.max(0, right - left)} height={Math.max(0, bottom - top)} fill="none" stroke={RULE} />
      <g fontSize={FONT} fill={TEXT}>
        {x.major.map((value) => {
          const at = px(ctx.x(value));
          return Number.isFinite(at) ? (
            <text key={`xt${value}`} x={at} y={bottom + 15} textAnchor="middle">
              {x.format(value)}
            </text>
          ) : null;
        })}
        {y.major.map((value) => {
          const at = px(ctx.y(value));
          return Number.isFinite(at) ? (
            <text key={`yt${value}`} x={left - 6} y={at + 3.5} textAnchor="end">
              {y.format(value)}
            </text>
          ) : null;
        })}
        {y2 &&
          ctx.y2 &&
          y2.major.map((value) => {
            const at = px(ctx.y2!(value));
            return Number.isFinite(at) ? (
              <text key={`y2t${value}`} x={right + 6} y={at + 3.5} textAnchor="start">
                {y2.format(value)}
              </text>
            ) : null;
          })}
        {x.title && (
          <text x={px((left + right) / 2)} y={height - 4} textAnchor="middle" fill={INK} fontWeight={600}>
            {x.title}
          </text>
        )}
        {y.title && (
          <text transform={`translate(12 ${px((top + bottom) / 2)}) rotate(-90)`} textAnchor="middle" fill={INK} fontWeight={600}>
            {y.title}
          </text>
        )}
        {y2?.title && (
          <text transform={`translate(${width - 6 - gutter} ${px((top + bottom) / 2)}) rotate(90)`} textAnchor="middle" fill={INK} fontWeight={600}>
            {y2.title}
          </text>
        )}
      </g>
      {children(ctx)}
      {overlay?.(ctx)}
    </svg>
  );
}

/** The responsive wrapper every chart sits in: measured width, export button, print colours. */
export function PlotBox({
  height,
  exportName,
  className,
  legend,
  children,
}: {
  height: number;
  exportName?: string;
  className?: string;
  legend?: ReactNode;
  children: (width: number, svgRef: (element: SVGSVGElement | null) => void) => ReactNode;
}) {
  const [ref, measured] = useWidth<HTMLDivElement>(640);
  const svg = useRef<SVGSVGElement | null>(null);
  const width = measured || 640;
  return (
    <div ref={ref} className={cn("relative w-full min-w-0", PRINT_LIGHT, className)} style={{ minHeight: height }}>
      {children(width, (element) => {
        svg.current = element;
      })}
      {legend}
      {exportName && <ExportButton target={() => svg.current} name={exportName} />}
    </div>
  );
}
