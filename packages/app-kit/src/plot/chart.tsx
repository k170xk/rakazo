import type { ReactNode } from "react";
import { useState } from "react";
import { fmt } from "../eng/format.js";
import type { Tone } from "../schema.js";
import { monotonePath } from "../ui/plot.js";
import type { Axis, FrameContext, LegendItem, PlotColor, ResolvedAxis } from "./frame.js";
import { colorOf, FONT, Frame, INK, LegendRow, PlotBox, resolveAxis, TEXT } from "./frame.js";
import type { Scale } from "./scale.js";
import { niceTicks, px, tickFormat } from "./scale.js";

export type XY = readonly [number, number];
export type SeriesData = readonly XY[] | { x: readonly number[]; y: readonly number[] };

export type Series = {
  name: string;
  data: SeriesData;
  type?: "line" | "scatter" | "area" | "bar" | "step";
  /** "right" plots against the secondary axis (y2). */
  axis?: "left" | "right";
  color?: PlotColor;
  /** true for a dashed line, or an SVG dash pattern such as "6 3". */
  dash?: boolean | string;
  width?: number;
  marker?: boolean | "circle" | "square" | "triangle" | "diamond" | "cross";
  /** A smooth curve through the points that never overshoots them. */
  smooth?: boolean;
  /** Area fill down to this value (default 0, or the axis minimum). */
  base?: number;
  /** Write each point's value beside it. */
  labels?: boolean;
};

export type Annotation =
  | {
      type: "hline";
      y: number;
      label?: string;
      tone?: PlotColor;
      dash?: boolean;
      axis?: "left" | "right";
    }
  | { type: "vline"; x: number; label?: string; tone?: PlotColor; dash?: boolean }
  /** Shaded zone across x (x1–x2), y (y1–y2) or both. */
  | {
      type: "band";
      x?: readonly [number, number];
      y?: readonly [number, number];
      label?: string;
      tone?: PlotColor;
    }
  | {
      type: "point";
      x: number;
      y: number;
      label?: string;
      tone?: PlotColor;
      axis?: "left" | "right";
    }
  | {
      type: "text";
      x: number;
      y: number;
      text: string;
      tone?: PlotColor;
      anchor?: "start" | "middle" | "end";
    }
  /** A shaded polygon, e.g. an acceptable region or a design envelope. */
  | { type: "polygon"; points: readonly XY[]; label?: string; tone?: PlotColor; outline?: boolean };

export const pointsOf = (data: SeriesData): XY[] =>
  "x" in data && !Array.isArray(data)
    ? (data as { x: readonly number[]; y: readonly number[] }).x.map(
        (x, i) => [x, (data as { y: readonly number[] }).y[i] ?? Number.NaN] as const,
      )
    : [...(data as readonly XY[])];

const dashOf = (dash: Series["dash"]) => (dash === true ? "6 4" : dash || undefined);

/** A polyline path; non-finite points (log of zero, gaps) break the line. */
export function linePath(points: Array<[number, number]>, smooth = false, step = false): string {
  const runs: Array<Array<[number, number]>> = [[]];
  for (const point of points) {
    if (Number.isFinite(point[0]) && Number.isFinite(point[1]))
      runs[runs.length - 1]!.push([px(point[0]), px(point[1])]);
    else if (runs[runs.length - 1]!.length) runs.push([]);
  }
  return runs
    .filter((run) => run.length)
    .map((run) => {
      if (smooth && run.length > 2) return monotonePath(run);
      if (step) return run.map(([x, y], i) => (i ? `H${x}V${y}` : `M${x},${y}`)).join("");
      return run.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join("");
    })
    .join("");
}

function Marker({
  x,
  y,
  shape,
  color,
  size = 3.5,
}: {
  x: number;
  y: number;
  shape: Series["marker"];
  color: string;
  size?: number;
}) {
  const s = size;
  if (shape === "square")
    return <rect x={px(x - s)} y={px(y - s)} width={2 * s} height={2 * s} fill={color} />;
  if (shape === "triangle")
    return (
      <path
        d={`M${px(x)},${px(y - s * 1.2)}L${px(x + s)},${px(y + s * 0.8)}L${px(x - s)},${px(y + s * 0.8)}Z`}
        fill={color}
      />
    );
  if (shape === "diamond")
    return (
      <path
        d={`M${px(x)},${px(y - s * 1.3)}L${px(x + s)},${px(y)}L${px(x)},${px(y + s * 1.3)}L${px(x - s)},${px(y)}Z`}
        fill={color}
      />
    );
  if (shape === "cross")
    return (
      <path
        d={`M${px(x - s)},${px(y - s)}L${px(x + s)},${px(y + s)}M${px(x - s)},${px(y + s)}L${px(x + s)},${px(y - s)}`}
        stroke={color}
        strokeWidth={1.6}
      />
    );
  return (
    <circle cx={px(x)} cy={px(y)} r={s} fill={color} stroke="hsl(var(--card))" strokeWidth={1} />
  );
}

/** Text with a halo in the card colour so it reads over grid lines and fills. */
export function Halo({
  x,
  y,
  children,
  anchor = "start",
  color = INK,
  weight = 600,
  size = FONT,
}: {
  x: number;
  y: number;
  children: ReactNode;
  anchor?: "start" | "middle" | "end";
  color?: string;
  weight?: number;
  size?: number;
}) {
  return (
    <text
      x={px(x)}
      y={px(y)}
      textAnchor={anchor}
      fill={color}
      fontSize={size}
      fontWeight={weight}
      stroke="hsl(var(--card))"
      strokeWidth={3}
      strokeLinejoin="round"
      paintOrder="stroke"
    >
      {children}
    </text>
  );
}

function drawAnnotation(
  note: Annotation,
  ctx: FrameContext,
  index: number,
  xFormat: (v: number) => string,
  yFormat: (v: number) => string,
) {
  const color = colorOf(note.tone ?? "danger");
  const key = `a${index}`;
  const yScale = (axis?: "left" | "right") => (axis === "right" && ctx.y2 ? ctx.y2 : ctx.y);
  switch (note.type) {
    case "hline": {
      const y = px(yScale(note.axis)(note.y));
      if (!Number.isFinite(y)) return null;
      return (
        <g key={key}>
          <line
            x1={ctx.left}
            x2={ctx.right}
            y1={y}
            y2={y}
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray={note.dash === false ? undefined : "6 4"}
          />
          {note.label && (
            <Halo x={ctx.right - 4} y={y - 5} anchor="end" color={color}>
              {note.label}
            </Halo>
          )}
        </g>
      );
    }
    case "vline": {
      const x = px(ctx.x(note.x));
      if (!Number.isFinite(x)) return null;
      return (
        <g key={key}>
          <line
            x1={x}
            x2={x}
            y1={ctx.top}
            y2={ctx.bottom}
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray={note.dash === false ? undefined : "6 4"}
          />
          {note.label && (
            <Halo x={x + 4} y={ctx.top + 12} color={color}>
              {note.label}
            </Halo>
          )}
        </g>
      );
    }
    case "band": {
      const xs = note.x ? note.x.map((v) => ctx.x(v)) : [ctx.left, ctx.right];
      const ys = note.y ? note.y.map((v) => ctx.y(v)) : [ctx.top, ctx.bottom];
      const x = Math.max(ctx.left, Math.min(xs[0]!, xs[1]!));
      const y = Math.max(ctx.top, Math.min(ys[0]!, ys[1]!));
      const w = Math.min(ctx.right, Math.max(xs[0]!, xs[1]!)) - x;
      const h = Math.min(ctx.bottom, Math.max(ys[0]!, ys[1]!)) - y;
      if (!(w > 0 && h > 0)) return null;
      return (
        <g key={key}>
          <rect x={px(x)} y={px(y)} width={px(w)} height={px(h)} fill={color} fillOpacity={0.1} />
          {note.label && (
            <Halo x={x + 6} y={y + 14} color={color}>
              {note.label}
            </Halo>
          )}
        </g>
      );
    }
    case "point": {
      const x = ctx.x(note.x);
      const y = yScale(note.axis)(note.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const flip = x > (ctx.left + ctx.right) / 2;
      return (
        <g key={key}>
          <circle
            cx={px(x)}
            cy={px(y)}
            r={4.5}
            fill={color}
            stroke="hsl(var(--card))"
            strokeWidth={1.5}
          />
          <Halo x={x + (flip ? -8 : 8)} y={y - 7} anchor={flip ? "end" : "start"} color={color}>
            {note.label ?? `${xFormat(note.x)}, ${yFormat(note.y)}`}
          </Halo>
        </g>
      );
    }
    case "text":
      return (
        <Halo
          key={key}
          x={ctx.x(note.x)}
          y={ctx.y(note.y)}
          anchor={note.anchor}
          color={note.tone ? color : INK}
        >
          {note.text}
        </Halo>
      );
    case "polygon": {
      const pts = note.points.map(([x, y]) => [ctx.x(x), ctx.y(y)] as [number, number]);
      const d = `${linePath(pts)}Z`;
      const cx = pts.reduce((sum, p) => sum + p[0], 0) / (pts.length || 1);
      const cy = pts.reduce((sum, p) => sum + p[1], 0) / (pts.length || 1);
      return (
        <g key={key}>
          <path
            d={d}
            fill={color}
            fillOpacity={0.12}
            stroke={note.outline === false ? "none" : color}
            strokeWidth={1.5}
          />
          {note.label && (
            <Halo x={cx} y={cy} anchor="middle" color={color}>
              {note.label}
            </Halo>
          )}
        </g>
      );
    }
  }
}

export type PlotProps = {
  series: Series[];
  x?: Axis;
  y?: Axis;
  /** Secondary axis on the right for series with axis: "right". */
  y2?: Axis;
  annotations?: Annotation[];
  height?: number;
  /** One unit of x is as long as one unit of y (both axes linear), for geometry and mode shapes. */
  equal?: boolean;
  legend?: boolean;
  /** Accessible name, e.g. "Particle size distribution". */
  title?: string;
  /** Shows a download button saving the chart as an SVG file of this name. */
  exportName?: string;
  className?: string;
};

type Projected = {
  series: Series;
  index: number;
  color: string;
  points: Array<[number, number]>;
  raw: XY[];
  scale: Scale;
};

/**
 * An engineering chart in SVG: line, scatter, area, step and bar series on linear or log axes (log-log
 * for grading curves and frequency response), a secondary axis, limit lines, shaded zones and labelled
 * points. Output is deterministic: the same data and width draw the same SVG.
 */
export function Plot({
  series,
  x,
  y,
  y2,
  annotations = [],
  height = 320,
  equal,
  legend = true,
  title,
  exportName,
  className,
}: PlotProps) {
  const [hover, setHover] = useState<{ series: number; point: number } | null>(null);
  const all = series.map((s) => pointsOf(s.data));
  const hasBars = series.some((s) => s.type === "bar");
  const xs = all.flat().map((p) => p[0]);
  const noteXs = annotations.flatMap((a) =>
    a.type === "vline"
      ? [a.x]
      : a.type === "point" || a.type === "text"
        ? [a.x]
        : a.type === "polygon"
          ? a.points.map((p) => p[0])
          : [],
  );
  const leftYs = series.flatMap((s, i) =>
    s.axis === "right"
      ? []
      : [
          ...all[i]!.map((p) => p[1]),
          ...(s.type === "area" || s.type === "bar" ? [s.base ?? 0] : []),
        ],
  );
  const noteYs = annotations.flatMap((a) =>
    a.type === "hline" && a.axis !== "right"
      ? [a.y]
      : a.type === "point" && a.axis !== "right"
        ? [a.y]
        : a.type === "text"
          ? [a.y]
          : a.type === "polygon"
            ? a.points.map((p) => p[1])
            : [],
  );
  const rightYs = series.flatMap((s, i) => (s.axis === "right" ? all[i]!.map((p) => p[1]) : []));
  const legendItems: LegendItem[] = series.map((s, i) => ({
    name: s.name,
    color: colorOf(s.color, i),
    kind: s.type === "area" || s.type === "bar" ? "area" : s.type === "scatter" ? "marker" : "line",
    dash: dashOf(s.dash),
  }));
  return (
    <PlotBox
      height={height}
      exportName={exportName}
      className={className}
      legend={legend ? <LegendRow items={legendItems} /> : null}
    >
      {(width, svgRef) => {
        let xAxis = resolveAxis({ zero: false, ...x }, [...xs, ...noteXs], width - 80, "x");
        let yAxis = resolveAxis({ zero: hasBars, ...y }, [...leftYs, ...noteYs], height - 40, "y");
        const y2Axis = y2 ? resolveAxis(y2, rightYs, height - 40, "y") : undefined;
        if (equal && xAxis.type === "linear" && yAxis.type === "linear")
          [xAxis, yAxis] = equalise(xAxis, yAxis, width, height);
        return (
          <Frame
            x={xAxis}
            y={yAxis}
            y2={y2Axis}
            width={width}
            height={height}
            title={title}
            svgRef={svgRef}
            onPointer={(ctx, at) => setHover(at ? nearest(project(series, all, ctx), at) : null)}
            overlay={(ctx) =>
              hover && (
                <HoverMark
                  projected={project(series, all, ctx)}
                  hover={hover}
                  ctx={ctx}
                  xText={x?.categories ? xAxis.format : (v) => fmt(v, { sf: 4 })}
                />
              )
            }
          >
            {(ctx) => {
              const projected = project(series, all, ctx);
              const bars = projected.filter((p) => p.series.type === "bar");
              return (
                <g>
                  <g clipPath={`url(#${ctx.clip})`}>
                    {annotations
                      .filter((a) => a.type === "band" || a.type === "polygon")
                      .map((a, i) => drawAnnotation(a, ctx, i, xAxis.format, yAxis.format))}
                    {projected.map((p) => (
                      <SeriesShape
                        key={`${p.series.name}-${p.index}`}
                        p={p}
                        ctx={ctx}
                        bars={bars}
                      />
                    ))}
                    {annotations
                      .filter((a) => a.type === "hline" || a.type === "vline")
                      .map((a, i) => drawAnnotation(a, ctx, i + 1000, xAxis.format, yAxis.format))}
                  </g>
                  {projected.map(
                    (p) =>
                      p.series.labels && (
                        <PointLabels
                          key={`l${p.index}`}
                          p={p}
                          yFormat={(p.series.axis === "right" ? y2Axis : yAxis)?.format ?? String}
                        />
                      ),
                  )}
                  {annotations
                    .filter((a) => a.type === "point" || a.type === "text")
                    .map((a, i) => drawAnnotation(a, ctx, i + 2000, xAxis.format, yAxis.format))}
                </g>
              );
            }}
          </Frame>
        );
      }}
    </PlotBox>
  );
}

/** Widens one axis so a unit of x and of y take the same length on screen. */
function equalise(
  xAxis: ResolvedAxis,
  yAxis: ResolvedAxis,
  width: number,
  height: number,
): [ResolvedAxis, ResolvedAxis] {
  const plotW = width - 90;
  const plotH = height - 40;
  const [x0, x1] = xAxis.domain;
  const [y0, y1] = yAxis.domain;
  const k = Math.min(plotW / (x1 - x0 || 1), plotH / (y1 - y0 || 1));
  const grow = (domain: [number, number], length: number): [number, number] => {
    const mid = (domain[0] + domain[1]) / 2;
    const half = length / k / 2;
    return [mid - half, mid + half];
  };
  const retick = (axis: ResolvedAxis, domain: [number, number], length: number): ResolvedAxis => {
    const major = niceTicks(domain[0], domain[1], Math.max(2, Math.round(length / 70)));
    return { ...axis, domain, major, minor: [], format: tickFormat(major) };
  };
  return [
    retick(xAxis, grow(xAxis.domain, plotW), plotW),
    retick(yAxis, grow(yAxis.domain, plotH), plotH),
  ];
}

function project(series: Series[], all: XY[][], ctx: FrameContext): Projected[] {
  return series.map((s, index) => {
    const scale = s.axis === "right" && ctx.y2 ? ctx.y2 : ctx.y;
    const raw = all[index]!;
    return {
      series: s,
      index,
      color: colorOf(s.color, index),
      raw,
      scale,
      points: raw.map(([x, y]) => [ctx.x(x), scale(y)] as [number, number]),
    };
  });
}

function nearest(projected: Projected[], at: { x: number; y: number }) {
  let best: { series: number; point: number; d: number } | null = null;
  for (const p of projected) {
    p.points.forEach(([x, y], i) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const d = (x - at.x) ** 2 + (y - at.y) ** 2;
      if (!best || d < best.d) best = { series: p.index, point: i, d };
    });
  }
  const found = best as { series: number; point: number; d: number } | null;
  return found && found.d < 60 ** 2 ? { series: found.series, point: found.point } : null;
}

function HoverMark({
  projected,
  hover,
  ctx,
  xText,
}: {
  projected: Projected[];
  hover: { series: number; point: number };
  ctx: FrameContext;
  xText: (v: number) => string;
}) {
  const p = projected[hover.series];
  const point = p?.points[hover.point];
  const raw = p?.raw[hover.point];
  if (!p || !point || !raw) return null;
  const flip = point[0] > (ctx.left + ctx.right) / 2;
  return (
    <g pointerEvents="none">
      <line
        x1={px(point[0])}
        x2={px(point[0])}
        y1={ctx.top}
        y2={ctx.bottom}
        stroke={TEXT}
        strokeOpacity={0.4}
        strokeDasharray="3 3"
      />
      <circle
        cx={px(point[0])}
        cy={px(point[1])}
        r={5}
        fill={p.color}
        stroke="hsl(var(--card))"
        strokeWidth={2}
      />
      <Halo
        x={point[0] + (flip ? -10 : 10)}
        y={Math.max(ctx.top + 12, point[1] - 10)}
        anchor={flip ? "end" : "start"}
      >
        {`${p.series.name}: ${xText(raw[0])}, ${fmt(raw[1], { sf: 4 })}`}
      </Halo>
    </g>
  );
}

function PointLabels({ p, yFormat }: { p: Projected; yFormat: (v: number) => string }) {
  return (
    <g>
      {p.points.map(([x, y], i) =>
        Number.isFinite(x) && Number.isFinite(y) ? (
          <Halo key={i} x={x} y={y - 8} anchor="middle" color={p.color}>
            {yFormat(p.raw[i]![1])}
          </Halo>
        ) : null,
      )}
    </g>
  );
}

function SeriesShape({ p, ctx, bars }: { p: Projected; ctx: FrameContext; bars: Projected[] }) {
  const { series, color, points } = p;
  const type = series.type ?? "line";
  const width = series.width ?? 2;
  if (type === "bar") {
    const slot = bars.indexOf(p);
    const xs = [...new Set(bars.flatMap((b) => b.points.map((q) => q[0])))].sort((a, b) => a - b);
    const gap =
      xs.length > 1
        ? Math.min(...xs.slice(1).map((v, i) => v - xs[i]!))
        : (ctx.right - ctx.left) / 4;
    const group = Math.max(2, gap * 0.72);
    const barW = group / bars.length;
    const base = p.scale(series.base ?? (p.scale.type === "log" ? p.scale.domain[0] : 0));
    return (
      <g>
        {points.map(([x, y], i) => {
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
          const left = x - group / 2 + slot * barW;
          return (
            <rect
              key={i}
              x={px(left + 0.5)}
              y={px(Math.min(y, base))}
              width={px(Math.max(1, barW - 1))}
              height={px(Math.abs(base - y))}
              rx={2}
              fill={color}
              fillOpacity={0.85}
            />
          );
        })}
      </g>
    );
  }
  const d = linePath(points, series.smooth, type === "step");
  const markers = series.marker ?? type === "scatter";
  const shape = series.marker === true || series.marker === undefined ? "circle" : series.marker;
  return (
    <g>
      {type === "area" && d && (
        <path
          d={`${d}${(() => {
            const finite = points.filter((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]));
            const base = px(
              p.scale(
                series.base ??
                  (p.scale.type === "log"
                    ? p.scale.domain[0]
                    : Math.max(Math.min(0, p.scale.domain[1]), p.scale.domain[0])),
              ),
            );
            return finite.length
              ? `L${px(finite[finite.length - 1]![0])},${base}L${px(finite[0]![0])},${base}Z`
              : "";
          })()}`}
          fill={color}
          fillOpacity={0.16}
        />
      )}
      {type !== "scatter" && d && (
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeDasharray={dashOf(series.dash)}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {markers &&
        points.map(([x, y], i) =>
          Number.isFinite(x) && Number.isFinite(y) ? (
            <Marker key={i} x={x} y={y} shape={shape} color={color} />
          ) : null,
        )}
    </g>
  );
}

// ---------------------------------------------------------------------------------------------
// Contours and heat maps

export type Grid = {
  x: readonly number[];
  y: readonly number[] /** z[row for y][column for x] */;
  z: readonly (readonly number[])[];
};
export type Segment = [[number, number], [number, number]];

/** Contour line segments at `level` by marching squares (saddles split by the cell average). */
export function contourSegments({ x, y, z }: Grid, level: number): Segment[] {
  const out: Segment[] = [];
  const lerp = (a: number, b: number, za: number, zb: number) =>
    zb === za ? (a + b) / 2 : a + ((level - za) / (zb - za)) * (b - a);
  for (let j = 0; j < y.length - 1; j++) {
    for (let i = 0; i < x.length - 1; i++) {
      const z00 = z[j]![i]!;
      const z10 = z[j]![i + 1]!;
      const z11 = z[j + 1]![i + 1]!;
      const z01 = z[j + 1]![i]!;
      if (![z00, z10, z11, z01].every(Number.isFinite)) continue;
      const code =
        (z00 >= level ? 1 : 0) |
        (z10 >= level ? 2 : 0) |
        (z11 >= level ? 4 : 0) |
        (z01 >= level ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const bottom: [number, number] = [lerp(x[i]!, x[i + 1]!, z00, z10), y[j]!];
      const right: [number, number] = [x[i + 1]!, lerp(y[j]!, y[j + 1]!, z10, z11)];
      const top: [number, number] = [lerp(x[i]!, x[i + 1]!, z01, z11), y[j + 1]!];
      const left: [number, number] = [x[i]!, lerp(y[j]!, y[j + 1]!, z00, z01)];
      const centre = (z00 + z10 + z11 + z01) / 4 >= level;
      const cases: Record<number, Segment[]> = {
        1: [[left, bottom]],
        2: [[bottom, right]],
        3: [[left, right]],
        4: [[right, top]],
        5: centre
          ? [
              [left, top],
              [bottom, right],
            ]
          : [
              [left, bottom],
              [right, top],
            ],
        6: [[bottom, top]],
        7: [[left, top]],
        8: [[top, left]],
        9: [[top, bottom]],
        10: centre
          ? [
              [bottom, left],
              [top, right],
            ]
          : [
              [bottom, right],
              [top, left],
            ],
        11: [[top, right]],
        12: [[right, left]],
        13: [[right, bottom]],
        14: [[bottom, left]],
      };
      out.push(...(cases[code] ?? []));
    }
  }
  return out;
}

const RAMPS = {
  thermal: ["--chart-4", "--chart-1", "--chart-3", "--chart-5"],
  sequential: ["--muted", "--primary"],
  diverging: ["--info", "--card", "--destructive"],
} as const;
export type Ramp = keyof typeof RAMPS;

/** A theme colour along a ramp (t from 0 to 1), mixed in the browser so light and dark both work. */
export function rampColor(t: number, ramp: Ramp = "thermal"): string {
  const stops = RAMPS[ramp];
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const at = clamped * (stops.length - 1);
  const seg = Math.min(stops.length - 2, Math.floor(at));
  const local = Math.round((at - seg) * 1000) / 10;
  return `color-mix(in oklab, hsl(var(${stops[seg + 1]})) ${local}%, hsl(var(${stops[seg]})))`;
}

export type ContourPlotProps = {
  grid: Grid;
  /** Contour values (default about 8 round values across the data). */
  levels?: number[];
  /** Colour the cells as a heat map behind the lines (default true). */
  fill?: boolean;
  lines?: boolean;
  ramp?: Ramp;
  x?: Axis;
  y?: Axis;
  /** Label for the colour bar, e.g. "Settlement (mm)". */
  zLabel?: string;
  zFormat?: (value: number) => string;
  annotations?: Annotation[];
  height?: number;
  equal?: boolean;
  title?: string;
  exportName?: string;
  className?: string;
};

/** A heat map of a grid with labelled contour lines and a colour bar: stresses, settlement, flood depth, noise. */
export function ContourPlot({
  grid,
  levels,
  fill = true,
  lines = true,
  ramp = "thermal",
  x,
  y,
  zLabel,
  zFormat,
  annotations = [],
  height = 360,
  equal,
  title,
  exportName,
  className,
}: ContourPlotProps) {
  const values = grid.z.flat().filter(Number.isFinite);
  const zMin = Math.min(...values);
  const zMax = Math.max(...values);
  const contourLevels = (levels ?? niceTicks(zMin, zMax, 8)).filter(
    (level) => level > zMin && level < zMax,
  );
  const format = zFormat ?? tickFormat(levels ?? niceTicks(zMin, zMax, 8));
  const t = (z: number) => (zMax === zMin ? 0.5 : (z - zMin) / (zMax - zMin));
  const edges = (axis: readonly number[]) =>
    axis.map(
      (v, i) =>
        [
          i === 0 ? v - ((axis[1] ?? v + 1) - v) / 2 : (axis[i - 1]! + v) / 2,
          i === axis.length - 1 ? v + (v - (axis[i - 1] ?? v - 1)) / 2 : (v + axis[i + 1]!) / 2,
        ] as const,
    );
  const xEdges = edges(grid.x);
  const yEdges = edges(grid.y);
  const gutter = 64;
  return (
    <PlotBox height={height} exportName={exportName} className={className}>
      {(width, svgRef) => {
        let xAxis = resolveAxis(
          { min: xEdges[0]![0], max: xEdges[xEdges.length - 1]![1], ...x },
          [],
          width - 80 - gutter,
          "x",
        );
        let yAxis = resolveAxis(
          { min: yEdges[0]![0], max: yEdges[yEdges.length - 1]![1], ...y },
          [],
          height - 40,
          "y",
        );
        if (equal) [xAxis, yAxis] = equalise(xAxis, yAxis, width - gutter, height);
        return (
          <Frame
            x={xAxis}
            y={yAxis}
            width={width}
            height={height}
            gutter={gutter}
            title={title}
            svgRef={svgRef}
          >
            {(ctx) => (
              <g>
                <g clipPath={`url(#${ctx.clip})`}>
                  {fill &&
                    grid.z.map((row, j) =>
                      row.map((z, i) => {
                        if (!Number.isFinite(z)) return null;
                        const x0 = ctx.x(xEdges[i]![0]);
                        const x1 = ctx.x(xEdges[i]![1]);
                        const y0 = ctx.y(yEdges[j]![0]);
                        const y1 = ctx.y(yEdges[j]![1]);
                        return (
                          <rect
                            key={`${j}-${i}`}
                            x={px(Math.min(x0, x1))}
                            y={px(Math.min(y0, y1))}
                            width={px(Math.abs(x1 - x0) + 0.6)}
                            height={px(Math.abs(y1 - y0) + 0.6)}
                            style={{ fill: rampColor(t(z), ramp) }}
                          />
                        );
                      }),
                    )}
                  {lines &&
                    contourLevels.map((level) => {
                      const segments = contourSegments(grid, level);
                      const d = segments
                        .map(
                          ([a, b]) =>
                            `M${px(ctx.x(a[0]))},${px(ctx.y(a[1]))}L${px(ctx.x(b[0]))},${px(ctx.y(b[1]))}`,
                        )
                        .join("");
                      return (
                        <path
                          key={`c${level}`}
                          d={d}
                          fill="none"
                          stroke={INK}
                          strokeOpacity={0.7}
                          strokeWidth={1}
                        />
                      );
                    })}
                  {annotations.map((a, i) => drawAnnotation(a, ctx, i, xAxis.format, yAxis.format))}
                </g>
                {lines &&
                  contourLevels.map((level) => {
                    const segments = contourSegments(grid, level);
                    const middle = segments[Math.floor(segments.length / 2)];
                    if (!middle) return null;
                    const lx = (ctx.x(middle[0][0]) + ctx.x(middle[1][0])) / 2;
                    const ly = (ctx.y(middle[0][1]) + ctx.y(middle[1][1])) / 2;
                    return (
                      <Halo key={`cl${level}`} x={lx} y={ly + 3.5} anchor="middle" size={10}>
                        {format(level)}
                      </Halo>
                    );
                  })}
                <ColorBar
                  ctx={ctx}
                  ramp={ramp}
                  min={zMin}
                  max={zMax}
                  label={zLabel}
                  format={format}
                />
              </g>
            )}
          </Frame>
        );
      }}
    </PlotBox>
  );
}

function ColorBar({
  ctx,
  ramp,
  min,
  max,
  label,
  format,
}: {
  ctx: FrameContext;
  ramp: Ramp;
  min: number;
  max: number;
  label?: string;
  format: (v: number) => string;
}) {
  const x = ctx.right + 14;
  const steps = 40;
  const h = ctx.bottom - ctx.top;
  const ticks = niceTicks(min, max, 5);
  const at = (v: number) => ctx.bottom - ((v - min) / (max - min || 1)) * h;
  return (
    <g fontSize={FONT - 1} fill={TEXT}>
      {Array.from({ length: steps }, (_, i) => (
        <rect
          key={i}
          x={x}
          y={px(ctx.bottom - ((i + 1) * h) / steps)}
          width={12}
          height={px(h / steps + 0.5)}
          style={{ fill: rampColor((i + 0.5) / steps, ramp) }}
        />
      ))}
      <rect x={x} y={ctx.top} width={12} height={h} fill="none" stroke="hsl(var(--border))" />
      {ticks.map((v) => (
        <text key={v} x={x + 16} y={px(at(v) + 3.5)}>
          {format(v)}
        </text>
      ))}
      {label && (
        <text
          transform={`translate(${ctx.width - 4} ${px((ctx.top + ctx.bottom) / 2)}) rotate(90)`}
          textAnchor="middle"
          fill={INK}
          fontWeight={600}
          fontSize={FONT}
        >
          {label}
        </text>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------------------------
// Interaction diagrams

/** Whether a point lies inside a closed polygon (ray casting; points on the edge count as inside). */
export function insidePolygon([px0, py0]: XY, polygon: readonly XY[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    const cross = (px0 - xi) * (yj - yi) - (py0 - yi) * (xj - xi);
    if (
      Math.abs(cross) < 1e-9 * (Math.abs(xj - xi) + Math.abs(yj - yi) + 1) &&
      px0 >= Math.min(xi, xj) &&
      px0 <= Math.max(xi, xj) &&
      py0 >= Math.min(yi, yj) &&
      py0 <= Math.max(yi, yj)
    )
      return true;
    if (yi > py0 !== yj > py0 && px0 < ((xj - xi) * (py0 - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export type InteractionDiagramProps = {
  /** The capacity curve as [M, N] points around the closed boundary. */
  curve: readonly XY[];
  /** Design actions; inside the curve pass, outside fail. */
  points: Array<{ M: number; N: number; label?: string }>;
  x?: Axis;
  y?: Axis;
  height?: number;
  title?: string;
  exportName?: string;
  className?: string;
};

/** An M–N interaction diagram: the closed capacity curve and load points coloured pass or fail. */
export function InteractionDiagram({
  curve,
  points,
  x,
  y,
  height = 360,
  title,
  exportName,
  className,
}: InteractionDiagramProps) {
  const closed =
    curve.length &&
    (curve[0]![0] !== curve[curve.length - 1]![0] || curve[0]![1] !== curve[curve.length - 1]![1])
      ? [...curve, curve[0]!]
      : [...curve];
  const annotations: Annotation[] = [
    { type: "polygon", points: closed, tone: "primary", outline: false },
    ...points.map(
      (p): Annotation => ({
        type: "point",
        x: p.M,
        y: p.N,
        label: p.label,
        tone: (insidePolygon([p.M, p.N], closed) ? "success" : "danger") as Tone,
      }),
    ),
  ];
  return (
    <Plot
      series={[{ name: "Capacity", data: closed, color: "primary" }]}
      annotations={annotations}
      x={{ label: "M", unit: "kNm", zero: true, ...x }}
      y={{ label: "N", unit: "kN", zero: true, ...y }}
      height={height}
      legend={false}
      title={title ?? "Interaction diagram"}
      exportName={exportName}
      className={className}
    />
  );
}
