import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import type { NumberStyle } from "../eng/format.js";
import { fmt } from "../eng/format.js";
import type { Bar, Shape } from "../eng/sections.js";
import { sectionDepth, sectionWidth } from "../eng/sections.js";
import { Halo } from "./chart.js";
import type { PlotColor } from "./frame.js";
import { colorOf, FONT, INK, PlotBox, TEXT, useSvgId } from "./frame.js";
import { px } from "./scale.js";

type Point = readonly [number, number];

type DrawingContextValue = {
  /** World to screen. */
  sx: (x: number) => number;
  sy: (y: number) => number;
  /** Screen pixels per world unit. */
  k: number;
  units: string;
  hatch: string;
  style: NumberStyle;
};

const DrawingContext = createContext<DrawingContextValue | null>(null);

function useDrawing(): DrawingContextValue {
  const ctx = useContext(DrawingContext);
  if (!ctx) throw new Error("Drawing parts go inside <Drawing>.");
  return ctx;
}

export type DrawingProps = {
  /** World extent [xmin, ymin, xmax, ymax] in drawing units; y points up. */
  bounds: readonly [number, number, number, number];
  /** Drawing units for dimension labels, e.g. "mm" or "m". */
  units?: string;
  /** Tallest the drawing gets in pixels; it keeps true proportions inside the width. */
  height?: number;
  /** Screen margin around the bounds for dimensions, px. */
  padding?: number;
  /** Rounding of dimension labels (default whole numbers). */
  style?: NumberStyle;
  title?: string;
  exportName?: string;
  className?: string;
  children: ReactNode;
};

/**
 * A drawing to scale: one unit of x is the same length as one unit of y. Children draw in world
 * coordinates (DrawingLine, DrawingPoly, DrawingCircle, DrawingText, Dim, SectionDrawing parts).
 */
export function Drawing({
  bounds,
  units = "mm",
  height = 360,
  padding = 40,
  style = { dp: 0 },
  title,
  exportName,
  className,
  children,
}: DrawingProps) {
  const hatch = useSvgId("d");
  const [x0, y0, x1, y1] = bounds;
  const w = Math.max(1e-9, x1 - x0);
  const h = Math.max(1e-9, y1 - y0);
  return (
    <PlotBox height={0} exportName={exportName} className={className}>
      {(width, svgRef) => {
        const k = Math.max(1e-9, Math.min((width - 2 * padding) / w, (height - 2 * padding) / h));
        const drawnH = Math.round(h * k + 2 * padding);
        const offsetX = (width - w * k) / 2;
        const ctx: DrawingContextValue = {
          sx: (x) => offsetX + (x - x0) * k,
          sy: (y) => padding + (y1 - y) * k,
          k,
          units,
          hatch,
          style,
        };
        return (
          <svg
            ref={svgRef}
            data-plot=""
            viewBox={`0 0 ${width} ${drawnH}`}
            width="100%"
            height={drawnH}
            role="img"
            aria-label={title}
            className="block"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {title && <title>{title}</title>}
            <defs>
              <pattern
                id={hatch}
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="6"
                  stroke={TEXT}
                  strokeWidth="0.8"
                  strokeOpacity="0.7"
                />
              </pattern>
            </defs>
            <g fontSize={FONT}>
              <DrawingContext.Provider value={ctx}>{children}</DrawingContext.Provider>
            </g>
          </svg>
        );
      }}
    </PlotBox>
  );
}

export function DrawingLine({
  from,
  to,
  color,
  width = 1.5,
  dash,
}: {
  from: Point;
  to: Point;
  color?: PlotColor;
  width?: number;
  dash?: boolean | string;
}) {
  const { sx, sy } = useDrawing();
  return (
    <line
      x1={px(sx(from[0]))}
      y1={px(sy(from[1]))}
      x2={px(sx(to[0]))}
      y2={px(sy(to[1]))}
      stroke={color ? colorOf(color) : INK}
      strokeWidth={width}
      strokeDasharray={dash === true ? "6 4" : dash || undefined}
    />
  );
}

export type Fill = "none" | "hatch" | "concrete" | "steel" | "timber" | "soil" | "card" | PlotColor;

function fillOf(
  fill: Fill | undefined,
  hatch: string,
): { fill: string; opacity: number; hatch: boolean } {
  switch (fill) {
    case undefined:
    case "none":
      return { fill: "none", opacity: 1, hatch: false };
    case "hatch":
      return { fill: `url(#${hatch})`, opacity: 1, hatch: false };
    case "card":
      return { fill: "hsl(var(--card))", opacity: 1, hatch: false };
    case "concrete":
      return { fill: "hsl(var(--muted-foreground))", opacity: 0.14, hatch: true };
    case "steel":
      return { fill: "hsl(var(--muted-foreground))", opacity: 0.55, hatch: false };
    case "timber":
      return { fill: "hsl(var(--chart-3))", opacity: 0.3, hatch: false };
    case "soil":
      return { fill: "hsl(var(--chart-5))", opacity: 0.18, hatch: true };
    default:
      return { fill: colorOf(fill), opacity: 0.25, hatch: false };
  }
}

/** A closed outline; several rings with evenodd make holes (hollow sections, openings). */
export function DrawingPoly({
  rings,
  fill,
  color,
  width = 1.5,
}: {
  rings: ReadonlyArray<readonly Point[]>;
  fill?: Fill;
  color?: PlotColor;
  width?: number;
}) {
  const { sx, sy, hatch } = useDrawing();
  const d = rings
    .map(
      (ring) => `${ring.map(([x, y], i) => `${i ? "L" : "M"}${px(sx(x))},${px(sy(y))}`).join("")}Z`,
    )
    .join("");
  const paint = fillOf(fill, hatch);
  return (
    <g>
      <path d={d} fill={paint.fill} fillOpacity={paint.opacity} fillRule="evenodd" />
      {paint.hatch && <path d={d} fill={`url(#${hatch})`} fillRule="evenodd" />}
      <path
        d={d}
        fill="none"
        stroke={color ? colorOf(color) : INK}
        strokeWidth={width}
        strokeLinejoin="round"
      />
    </g>
  );
}

export function DrawingCircle({
  c,
  r,
  fill,
  color,
  width = 1.5,
}: {
  c: Point;
  r: number;
  fill?: Fill;
  color?: PlotColor;
  width?: number;
}) {
  const { sx, sy, k, hatch } = useDrawing();
  const paint = fillOf(fill, hatch);
  const cx = px(sx(c[0]));
  const cy = px(sy(c[1]));
  return (
    <g>
      <circle cx={cx} cy={cy} r={px(r * k)} fill={paint.fill} fillOpacity={paint.opacity} />
      {paint.hatch && <circle cx={cx} cy={cy} r={px(r * k)} fill={`url(#${hatch})`} />}
      {width > 0 && (
        <circle
          cx={cx}
          cy={cy}
          r={px(r * k)}
          fill="none"
          stroke={color ? colorOf(color) : INK}
          strokeWidth={width}
        />
      )}
    </g>
  );
}

export function DrawingText({
  at,
  children,
  anchor = "middle",
  color,
  dx = 0,
  dy = 0,
}: {
  at: Point;
  children: ReactNode;
  anchor?: "start" | "middle" | "end";
  color?: PlotColor;
  dx?: number;
  dy?: number;
}) {
  const { sx, sy } = useDrawing();
  return (
    <Halo
      x={sx(at[0]) + dx}
      y={sy(at[1]) + dy + 4}
      anchor={anchor}
      color={color ? colorOf(color) : INK}
    >
      {children}
    </Halo>
  );
}

/**
 * A dimension line between two points with extension lines and arrowheads. offset is in screen
 * pixels, positive to the left of from → to (above a left-to-right line); label defaults to the length.
 */
export function Dim({
  from,
  to,
  offset = 18,
  label,
}: {
  from: Point;
  to: Point;
  offset?: number;
  label?: ReactNode;
}) {
  const { sx, sy, units, style } = useDrawing();
  const a = [sx(from[0]), sy(from[1])] as const;
  const b = [sx(to[0]), sy(to[1])] as const;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Screen y points down, so the left of the direction is (uy, -ux).
  const side = Math.sign(offset) || 1;
  // Unit normal towards the offset side; screen y points down, so the left of the direction is (uy, -ux).
  const nx = uy * side;
  const ny = -ux * side;
  const p = [a[0] + nx * Math.abs(offset), a[1] + ny * Math.abs(offset)] as const;
  const q = [b[0] + nx * Math.abs(offset), b[1] + ny * Math.abs(offset)] as const;
  const head = (tip: readonly [number, number], dir: number) =>
    `M${px(tip[0])},${px(tip[1])}L${px(tip[0] + dir * ux * 7 - uy * 2.6)},${px(tip[1] + dir * uy * 7 + ux * 2.6)}L${px(tip[0] + dir * ux * 7 + uy * 2.6)},${px(tip[1] + dir * uy * 7 - ux * 2.6)}Z`;
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle >= 90) angle -= 180;
  if (angle < -90) angle += 180;
  const rad = (angle * Math.PI) / 180;
  const above = -Math.sin(rad) * nx + Math.cos(rad) * ny < 0;
  const mid = [(p[0] + q[0]) / 2 + nx * 3, (p[1] + q[1]) / 2 + ny * 3] as const;
  const text =
    label ??
    `${fmt(Math.hypot(to[0] - from[0], to[1] - from[1]), style)}${units ? ` ${units}` : ""}`;
  return (
    <g>
      <line
        x1={px(a[0] + nx * 3)}
        y1={px(a[1] + ny * 3)}
        x2={px(p[0] + nx * 4)}
        y2={px(p[1] + ny * 4)}
        stroke={TEXT}
        strokeWidth={0.8}
      />
      <line
        x1={px(b[0] + nx * 3)}
        y1={px(b[1] + ny * 3)}
        x2={px(q[0] + nx * 4)}
        y2={px(q[1] + ny * 4)}
        stroke={TEXT}
        strokeWidth={0.8}
      />
      <line
        x1={px(p[0])}
        y1={px(p[1])}
        x2={px(q[0])}
        y2={px(q[1])}
        stroke={TEXT}
        strokeWidth={0.9}
      />
      <path d={head(p, 1)} fill={TEXT} />
      <path d={head(q, -1)} fill={TEXT} />
      <text
        transform={`translate(${px(mid[0])} ${px(mid[1])}) rotate(${px(angle)})`}
        y={above ? -1 : 9}
        textAnchor="middle"
        fill={INK}
        stroke="hsl(var(--card))"
        strokeWidth={3}
        paintOrder="stroke"
        fontWeight={600}
      >
        {text}
      </text>
    </g>
  );
}

/** Outline rings of a section in mm, centred on x = 0 with the bottom fibre at y = 0. */
export function sectionRings(shape: Shape): Point[][] {
  switch (shape.type) {
    case "rect": {
      const b = shape.b / 2;
      return [
        [
          [-b, 0],
          [b, 0],
          [b, shape.h],
          [-b, shape.h],
        ],
      ];
    }
    case "rhs": {
      const b = shape.b / 2;
      const t = shape.t;
      return [
        [
          [-b, 0],
          [b, 0],
          [b, shape.h],
          [-b, shape.h],
        ],
        [
          [-b + t, t],
          [b - t, t],
          [b - t, shape.h - t],
          [-b + t, shape.h - t],
        ],
      ];
    }
    case "i": {
      const { h, tf } = shape;
      const b = shape.b / 2;
      const w = shape.tw / 2;
      return [
        [
          [-b, 0],
          [b, 0],
          [b, tf],
          [w, tf],
          [w, h - tf],
          [b, h - tf],
          [b, h],
          [-b, h],
          [-b, h - tf],
          [-w, h - tf],
          [-w, tf],
          [-b, tf],
        ],
      ];
    }
    case "t": {
      const { h, tf } = shape;
      const b = shape.b / 2;
      const w = shape.tw / 2;
      return [
        [
          [-w, 0],
          [w, 0],
          [w, h - tf],
          [b, h - tf],
          [b, h],
          [-b, h],
          [-b, h - tf],
          [-w, h - tf],
        ],
      ];
    }
    default:
      return [];
  }
}

export type SectionDrawingProps = {
  shape: Shape;
  /** Reinforcement bars (x from the centre line, y from the bottom, diameter d), e.g. from barRow. */
  bars?: Bar[];
  /** A link drawn inside the cover: { cover, dia } in mm. */
  link?: { cover: number; dia: number };
  material?: "concrete" | "steel" | "timber";
  /** Overall width and depth dimensions (default true). */
  dims?: boolean;
  height?: number;
  title?: string;
  exportName?: string;
  className?: string;
  /** Extra parts drawn on top, in the section's mm coordinates (neutral axis, strain lines). */
  children?: ReactNode;
};

/** A cross-section drawn to scale with dimensions, links and bars; the same Shape @ocsc/eng gives properties for. */
export function SectionDrawing({
  shape,
  bars = [],
  link,
  material,
  dims = true,
  height = 320,
  title,
  exportName,
  className,
  children,
}: SectionDrawingProps) {
  const b = sectionWidth(shape);
  const h = sectionDepth(shape);
  const fill =
    material ??
    (bars.length
      ? "concrete"
      : shape.type === "rect" || shape.type === "t" || shape.type === "circle"
        ? "concrete"
        : "steel");
  const round = shape.type === "circle" || shape.type === "chs";
  return (
    <Drawing
      bounds={[-b / 2, 0, b / 2, h]}
      units="mm"
      height={height}
      padding={44}
      title={title ?? `Section ${b} × ${h} mm`}
      exportName={exportName}
      className={className}
    >
      {round ? (
        <>
          <DrawingCircle c={[0, h / 2]} r={h / 2} fill={fill} />
          {shape.type === "chs" && <DrawingCircle c={[0, h / 2]} r={h / 2 - shape.t} fill="card" />}
        </>
      ) : (
        <DrawingPoly rings={sectionRings(shape)} fill={fill} />
      )}
      {link && <LinkOutline shape={shape} link={link} />}
      {bars.map((bar, i) => (
        <DrawingCircle key={i} c={[bar.x, bar.y]} r={bar.d / 2} fill="foreground" width={0} />
      ))}
      {dims && (
        <>
          <Dim from={[-b / 2, 0]} to={[b / 2, 0]} offset={-22} />
          <Dim from={[-b / 2, h]} to={[-b / 2, 0]} offset={-22} />
          {shape.type === "chs" || shape.type === "rhs" ? (
            <DrawingText at={[0, h / 2]}>{`t = ${shape.t} mm`}</DrawingText>
          ) : null}
        </>
      )}
      {children}
    </Drawing>
  );
}

function LinkOutline({ shape, link }: { shape: Shape; link: { cover: number; dia: number } }) {
  const { sx, sy, k } = useDrawing();
  const inset = link.cover + link.dia / 2;
  if (shape.type === "circle") {
    return (
      <circle
        cx={px(sx(0))}
        cy={px(sy(shape.d / 2))}
        r={px((shape.d / 2 - inset) * k)}
        fill="none"
        stroke={INK}
        strokeWidth={Math.max(1, link.dia * k)}
        strokeOpacity={0.8}
      />
    );
  }
  if (shape.type !== "rect" && shape.type !== "t") return null;
  const half = (shape.type === "rect" ? shape.b : shape.tw) / 2 - inset;
  const top = shape.h - inset;
  const r = Math.max(2, 2 * link.dia * k);
  return (
    <rect
      x={px(sx(-half))}
      y={px(sy(top))}
      width={px(2 * half * k)}
      height={px((top - inset) * k)}
      rx={r}
      fill="none"
      stroke={INK}
      strokeWidth={Math.max(1, link.dia * k)}
      strokeOpacity={0.8}
    />
  );
}
