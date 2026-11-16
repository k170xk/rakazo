import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import type { BeamInput, BeamResult, Load, Reaction, Support } from "../eng/beam.js";
import { analyseBeam } from "../eng/beam.js";
import type { NumberStyle } from "../eng/format.js";
import { fmt } from "../eng/format.js";
import { Halo } from "./chart.js";
import type { PlotColor } from "./frame.js";
import { colorOf, FONT, INK, PlotBox, RULE, TEXT, useSvgId } from "./frame.js";
import { px } from "./scale.js";

/** Beam diagrams share these margins so a load diagram and its SFD/BMD line up when stacked. */
const SIDE = 56;

const span = (width: number, length: number) => (x: number) => SIDE + (x / (length || 1)) * (width - 2 * SIDE);

function Arrow({ x, y1, y2, color, width = 1.6 }: { x: number; y1: number; y2: number; color: string; width?: number }) {
  const dir = y2 > y1 ? 1 : -1;
  return (
    <g>
      <line x1={px(x)} x2={px(x)} y1={px(y1)} y2={px(y2 - dir * 6)} stroke={color} strokeWidth={width} />
      <path d={`M${px(x)},${px(y2)}L${px(x - 4)},${px(y2 - dir * 8)}L${px(x + 4)},${px(y2 - dir * 8)}Z`} fill={color} />
    </g>
  );
}

function SupportMark({ support, x, y, length, hatch }: { support: Support; x: number; y: number; length: number; hatch: string }) {
  if (support.type === "fixed") {
    const side = support.x <= length / 2 ? -1 : 1;
    const wall = x + side * 2;
    return (
      <g>
        <line x1={wall} x2={wall} y1={y - 22} y2={y + 22} stroke={INK} strokeWidth={2} />
        <rect x={side < 0 ? wall - 10 : wall} y={y - 22} width={10} height={44} fill={`url(#${hatch})`} />
      </g>
    );
  }
  const top = y + 3;
  const base = top + 14;
  return (
    <g>
      <path d={`M${px(x)},${px(top)}L${px(x - 9)},${px(base)}L${px(x + 9)},${px(base)}Z`} fill="hsl(var(--card))" stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
      {support.type === "roller" && (
        <>
          <circle cx={px(x - 5)} cy={px(base + 3.5)} r={3} fill="none" stroke={INK} strokeWidth={1.2} />
          <circle cx={px(x + 5)} cy={px(base + 3.5)} r={3} fill="none" stroke={INK} strokeWidth={1.2} />
        </>
      )}
      <line x1={px(x - 13)} x2={px(x + 13)} y1={px(base + (support.type === "roller" ? 7 : 0))} y2={px(base + (support.type === "roller" ? 7 : 0))} stroke={INK} strokeWidth={1.5} />
      <rect x={px(x - 13)} y={px(base + (support.type === "roller" ? 7 : 0))} width={26} height={6} fill={`url(#${hatch})`} />
    </g>
  );
}

function Couple({ x, y, moment, color }: { x: number; y: number; moment: number; color: string }) {
  const r = 15;
  const clockwise = moment >= 0;
  const start = clockwise ? [x - r, y] : [x + r, y];
  const end = clockwise ? [x + r * 0.7, y + r * 0.7] : [x - r * 0.7, y + r * 0.7];
  const sweep = clockwise ? 1 : 0;
  return (
    <g>
      <path d={`M${px(start[0]!)},${px(start[1]!)}A${r},${r} 0 1 ${sweep} ${px(end[0]!)},${px(end[1]!)}`} fill="none" stroke={color} strokeWidth={1.6} />
      <circle cx={px(end[0]!)} cy={px(end[1]!)} r={2.6} fill={color} />
    </g>
  );
}

export type BeamDiagramProps = {
  length: number;
  supports: Support[];
  loads: Load[];
  /** Reactions from analyseBeam, written under the supports. */
  reactions?: Reaction[];
  height?: number;
  /** Rounding of the load and length labels (default 4 significant figures). */
  style?: NumberStyle;
  title?: string;
  exportName?: string;
  className?: string;
};

/** The loaded beam: supports, point loads, distributed loads, couples, reactions and span dimensions. */
export function BeamDiagram({ length, supports, loads, reactions, height = 190, style = { sf: 4 }, title, exportName, className }: BeamDiagramProps) {
  const hatch = useSvgId("h");
  const n = (value: number) => fmt(value, style);
  const distributed = loads.flatMap((load) => (load.type === "udl" ? [Math.abs(load.w)] : load.type === "linear" ? [Math.abs(load.w1), Math.abs(load.w2)] : []));
  const wMax = Math.max(1e-12, ...distributed);
  const beamY = 92;
  return (
    <PlotBox height={height} exportName={exportName} className={className}>
      {(width, svgRef) => {
        const sx = span(width, length);
        const color = colorOf("danger");
        const dist = colorOf(5);
        const positions = [...new Set([0, length, ...supports.map((s) => s.x)])].sort((a, b) => a - b);
        const dimY = beamY + 58;
        return (
          <svg ref={svgRef} data-plot="" viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={title ?? `Beam ${n(length)} m`} className="block" style={{ fontVariantNumeric: "tabular-nums" }}>
            <defs>
              <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="5" stroke={TEXT} strokeWidth="1" />
              </pattern>
            </defs>
            <g fontSize={FONT}>
              {loads.map((load, i) => {
                if (load.type !== "udl" && load.type !== "linear") return null;
                const from = load.type === "udl" ? (load.from ?? 0) : load.from;
                const to = load.type === "udl" ? (load.to ?? length) : load.to;
                const w1 = load.type === "udl" ? load.w : load.w1;
                const w2 = load.type === "udl" ? load.w : load.w2;
                const x0 = sx(from);
                const x1 = sx(to);
                const count = Math.max(2, Math.round((x1 - x0) / 18));
                const tall = (w: number) => 10 + (Math.abs(w) / wMax) * 30;
                const stack = i % 2 ? 6 : 0;
                const tops = Array.from({ length: count + 1 }, (_, k) => {
                  const t = k / count;
                  return [x0 + t * (x1 - x0), beamY - 3 - stack - tall(w1 + t * (w2 - w1))] as const;
                });
                return (
                  <g key={`d${i}`}>
                    {tops.map(([x, top], k) => (
                      <Arrow key={k} x={x} y1={top} y2={beamY - 3 - stack} color={dist} width={1.2} />
                    ))}
                    <path d={tops.map(([x, top], k) => `${k ? "L" : "M"}${px(x)},${px(top)}`).join("")} fill="none" stroke={dist} strokeWidth={1.5} />
                    <Halo x={(x0 + x1) / 2} y={Math.min(...tops.map((t) => t[1])) - 6} anchor="middle" color={dist}>
                      {w1 === w2 ? `${n(w1)} kN/m` : `${n(w1)}–${n(w2)} kN/m`}
                    </Halo>
                  </g>
                );
              })}
              <line x1={sx(0)} x2={sx(length)} y1={beamY} y2={beamY} stroke={INK} strokeWidth={4} strokeLinecap="butt" />
              {supports.map((support, i) => (
                <SupportMark key={`s${i}`} support={support} x={sx(support.x)} y={beamY} length={length} hatch={hatch} />
              ))}
              {loads.map((load, i) => {
                if (load.type === "point") {
                  const x = sx(load.x);
                  const up = load.P < 0;
                  return (
                    <g key={`p${i}`}>
                      <Arrow x={x} y1={up ? beamY - 4 : beamY - 52} y2={up ? beamY - 52 : beamY - 4} color={color} width={2} />
                      <Halo x={x} y={beamY - 58} anchor="middle" color={color}>{`${n(Math.abs(load.P))} kN`}</Halo>
                    </g>
                  );
                }
                if (load.type === "moment") {
                  const x = sx(load.x);
                  return (
                    <g key={`m${i}`}>
                      <Couple x={x} y={beamY} moment={load.M} color={color} />
                      <Halo x={x} y={beamY - 22} anchor="middle" color={color}>{`${n(Math.abs(load.M))} kNm`}</Halo>
                    </g>
                  );
                }
                return null;
              })}
              {reactions?.map((r, i) => (
                <text key={`r${i}`} x={px(sx(r.x))} y={beamY + 40} textAnchor="middle" fill={TEXT}>
                  {r.type === "fixed" ? `${n(r.V)} kN · ${n(r.M)} kNm` : `${n(r.V)} kN`}
                </text>
              ))}
              {positions.slice(1).map((x, i) => {
                const a = sx(positions[i]!);
                const b = sx(x);
                return (
                  <g key={`dim${i}`} stroke={TEXT}>
                    <line x1={px(a)} x2={px(b)} y1={dimY} y2={dimY} />
                    <line x1={px(a)} x2={px(a)} y1={dimY - 5} y2={dimY + 5} />
                    <line x1={px(b)} x2={px(b)} y1={dimY - 5} y2={dimY + 5} />
                    <text x={px((a + b) / 2)} y={dimY + 15} textAnchor="middle" fill={INK} stroke="none">
                      {`${n(x - positions[i]!)} m`}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        );
      }}
    </PlotBox>
  );
}

export type ForceDiagramProps = {
  x: readonly number[];
  values: readonly number[];
  /** Beam length (default the last x), so diagrams align with BeamDiagram. */
  length?: number;
  /** Shown top left with the unit, e.g. "Bending moment". */
  label?: string;
  unit?: string;
  color?: PlotColor;
  /** Draw positive values below the axis (sagging moments on the tension side, the UK convention). */
  invert?: boolean;
  height?: number;
  style?: NumberStyle;
  title?: string;
  exportName?: string;
  className?: string;
};

/** A shear force, bending moment or deflection diagram from arrays, with the peaks labelled. */
export function ForceDiagram({ x, values, length, label, unit, color, invert, height = 150, style = { sf: 4 }, title, exportName, className }: ForceDiagramProps) {
  const [hover, setHover] = useState<number | null>(null);
  const L = length ?? x[x.length - 1] ?? 1;
  const tone = colorOf(color ?? 1);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const iMax = values.indexOf(max);
  const iMin = values.indexOf(min);
  const n = (value: number) => `${fmt(value, style)}${unit ? ` ${unit}` : ""}`;
  const summary = `${label ?? "Diagram"}: max ${n(max)}, min ${n(min)}`;
  return (
    <PlotBox height={height} exportName={exportName} className={className}>
      {(width, svgRef) => {
        const sx = span(width, L);
        const top = 24;
        const bottom = height - 18;
        const range = max - min || 1;
        const sign = invert ? -1 : 1;
        const hi = invert ? -min : max;
        const sy = (v: number) => top + ((hi - sign * v) / range) * (bottom - top);
        const zero = sy(0);
        const pts = x.map((xi, i) => [sx(xi), sy(values[i]!)] as const);
        const d = pts.length ? `M${px(pts[0]![0])},${px(zero)}${pts.map(([a, b]) => `L${px(a)},${px(b)}`).join("")}L${px(pts[pts.length - 1]![0])},${px(zero)}Z` : "";
        const peak = (i: number, v: number) => {
          if (i < 0 || v === 0) return null;
          const [a, b] = pts[i]!;
          const below = b > zero;
          const anchor = a < SIDE + 40 ? "start" : a > width - SIDE - 40 ? "end" : "middle";
          return (
            <Halo x={a} y={below ? b + 13 : b - 5} anchor={anchor} color={INK}>
              {n(v)}
            </Halo>
          );
        };
        const hovered = hover !== null ? pts[hover] : undefined;
        return (
          <svg
            ref={svgRef}
            data-plot=""
            viewBox={`0 0 ${width} ${height}`}
            width="100%"
            height={height}
            role="img"
            aria-label={title ?? summary}
            className="block touch-pan-y"
            style={{ fontVariantNumeric: "tabular-nums" }}
            onPointerMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const at = (event.clientX - box.left) * (box.width ? width / box.width : 1);
              let best = 0;
              pts.forEach(([a], i) => {
                if (Math.abs(a - at) < Math.abs(pts[best]![0] - at)) best = i;
              });
              setHover(pts.length ? best : null);
            }}
            onPointerLeave={() => setHover(null)}
          >
            <g fontSize={FONT}>
              {label && (
                <text x={4} y={14} fill={INK} fontWeight={600}>
                  {unit ? `${label} (${unit})` : label}
                </text>
              )}
              <path d={d} fill={tone} fillOpacity={0.18} stroke={tone} strokeWidth={1.8} strokeLinejoin="round" />
              <line x1={sx(0)} x2={sx(L)} y1={px(zero)} y2={px(zero)} stroke={INK} strokeWidth={1.2} />
              {peak(iMax, max)}
              {iMin !== iMax && peak(iMin, min)}
              {hovered && hover !== null && (
                <g pointerEvents="none" aria-hidden="true">
                  <line x1={px(hovered[0])} x2={px(hovered[0])} y1={top - 6} y2={bottom} stroke={RULE} />
                  <circle cx={px(hovered[0])} cy={px(hovered[1])} r={4} fill={tone} />
                  <Halo x={hovered[0] + (hovered[0] > width / 2 ? -8 : 8)} y={top - 8} anchor={hovered[0] > width / 2 ? "end" : "start"}>
                    {`x = ${fmt(x[hover]!, { sf: 4 })} m: ${n(values[hover]!)}`}
                  </Halo>
                </g>
              )}
            </g>
          </svg>
        );
      }}
    </PlotBox>
  );
}

export type BeamResultsProps = {
  beam: BeamInput;
  /** A result already worked out with analyseBeam (computed here when left out). */
  result?: BeamResult;
  /** Which diagrams to stack (default all that apply). */
  show?: Array<"loads" | "shear" | "moment" | "deflection">;
  /** Sagging moments drawn below the axis (default true). */
  saggingDown?: boolean;
  style?: NumberStyle;
  className?: string;
  children?: ReactNode;
};

/** The loaded beam with its shear force, bending moment and deflection diagrams, aligned. */
export function BeamResults({ beam, result, show, saggingDown = true, style, className, children }: BeamResultsProps) {
  const solved = useMemo(() => result ?? analyseBeam(beam), [beam, result]);
  const wanted = show ?? ["loads", "shear", "moment", ...(solved.deflection ? (["deflection"] as const) : [])];
  return (
    <div className={className}>
      {wanted.includes("loads") && <BeamDiagram length={beam.length} supports={beam.supports} loads={beam.loads} reactions={solved.reactions} style={style} />}
      {wanted.includes("shear") && <ForceDiagram x={solved.x} values={solved.shear} length={beam.length} label="Shear force" unit="kN" color={4} style={style} />}
      {wanted.includes("moment") && <ForceDiagram x={solved.x} values={solved.moment} length={beam.length} label="Bending moment" unit="kNm" color={1} invert={saggingDown} style={style} />}
      {wanted.includes("deflection") && solved.deflection && <ForceDiagram x={solved.x} values={solved.deflection} length={beam.length} label="Deflection" unit="mm" color={3} style={style} />}
      {children}
    </div>
  );
}
