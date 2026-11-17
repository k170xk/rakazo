import { fmt } from "../eng/format.js";
import type { XY } from "./chart.js";
import type { LegendItem, PlotColor } from "./frame.js";
import { colorOf, FONT, INK, LegendRow, PlotBox, RULE, TEXT } from "./frame.js";
import { niceTicks, px, tickFormat } from "./scale.js";

export type PolarSeries = {
  name: string;
  /** [angle in degrees, radius] pairs. */
  data: readonly XY[];
  type?: "line" | "area" | "scatter";
  /** Join the last point back to the first (wind roses, radiation patterns). */
  closed?: boolean;
  color?: PlotColor;
  dash?: boolean;
};

export type PolarPlotProps = {
  series: PolarSeries[];
  rMax?: number;
  rLabel?: string;
  /** Where 0° points: "north" (top, compass) or "east" (right, mathematical). */
  zero?: "north" | "east";
  /** Angles increase clockwise (default with north) or anticlockwise (default with east). */
  clockwise?: boolean;
  /** Spoke spacing in degrees (default 30). */
  step?: number;
  height?: number;
  legend?: boolean;
  title?: string;
  exportName?: string;
  className?: string;
};

/** A polar plot: wind roses, directional loads, radiation and lighting patterns, Mohr-style sweeps. */
export function PolarPlot({
  series,
  rMax,
  rLabel,
  zero = "north",
  clockwise,
  step = 30,
  height = 340,
  legend = true,
  title,
  exportName,
  className,
}: PolarPlotProps) {
  const cw = clockwise ?? zero === "north";
  const top = Math.max(...series.flatMap((s) => s.data.map((p) => p[1])), 0);
  const rings = niceTicks(0, rMax ?? top, 4).filter((r) => r > 0);
  const outer = rMax ?? (rings[rings.length - 1]! < top ? top : (rings[rings.length - 1] ?? 1));
  const format = tickFormat(rings);
  const legendItems: LegendItem[] = series.map((s, i) => ({
    name: s.name,
    color: colorOf(s.color, i),
    kind: s.type === "area" ? "area" : s.type === "scatter" ? "marker" : "line",
  }));
  return (
    <PlotBox
      height={height}
      exportName={exportName}
      className={className}
      legend={legend ? <LegendRow items={legendItems} /> : null}
    >
      {(width, svgRef) => {
        const cx = width / 2;
        const cy = height / 2;
        const radius = Math.max(10, Math.min(width, height) / 2 - 30);
        const at = (deg: number, r: number) => {
          const theta = ((zero === "north" ? 90 : 0) - (cw ? 1 : -1) * deg) * (Math.PI / 180);
          const k = (Math.max(0, r) / (outer || 1)) * radius;
          return [cx + k * Math.cos(theta), cy - k * Math.sin(theta)] as const;
        };
        const spokes = Array.from({ length: Math.round(360 / step) }, (_, i) => i * step);
        return (
          <svg
            ref={svgRef}
            data-plot=""
            viewBox={`0 0 ${width} ${height}`}
            width="100%"
            height={height}
            role="img"
            aria-label={title ?? "Polar plot"}
            className="block"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            <g fontSize={FONT} fill={TEXT}>
              {rings.map((r) => (
                <g key={`r${r}`}>
                  <circle
                    cx={px(cx)}
                    cy={px(cy)}
                    r={px((r / outer) * radius)}
                    fill="none"
                    stroke={RULE}
                  />
                  <text x={px(at(step / 2, r)[0] + 2)} y={px(at(step / 2, r)[1] - 2)}>
                    {format(r)}
                  </text>
                </g>
              ))}
              {spokes.map((deg) => {
                const [x, y] = at(deg, outer);
                const [lx, ly] = at(deg, outer * 1.09);
                return (
                  <g key={`s${deg}`}>
                    <line x1={px(cx)} y1={px(cy)} x2={px(x)} y2={px(y)} stroke={RULE} />
                    <text
                      x={px(lx)}
                      y={px(ly + 3.5)}
                      textAnchor="middle"
                    >{`${fmt(deg, { sf: 4 })}°`}</text>
                  </g>
                );
              })}
              {rLabel && (
                <text x={px(cx + 3)} y={px(cy + 14)} fill={INK} fontWeight={600}>
                  {rLabel}
                </text>
              )}
            </g>
            {series.map((s, i) => {
              const color = colorOf(s.color, i);
              const pts = s.data.map(([deg, r]) => at(deg, r));
              const d = `${pts.map(([x, y], k) => `${k ? "L" : "M"}${px(x)},${px(y)}`).join("")}${s.closed || s.type === "area" ? "Z" : ""}`;
              return (
                <g key={`${s.name}${i}`}>
                  {s.type !== "scatter" && (
                    <path
                      d={d}
                      fill={s.type === "area" ? color : "none"}
                      fillOpacity={0.18}
                      stroke={color}
                      strokeWidth={2}
                      strokeDasharray={s.dash ? "6 4" : undefined}
                      strokeLinejoin="round"
                    />
                  )}
                  {s.type === "scatter" &&
                    pts.map(([x, y], k) => (
                      <circle key={k} cx={px(x)} cy={px(y)} r={3.5} fill={color} />
                    ))}
                </g>
              );
            })}
          </svg>
        );
      }}
    </PlotBox>
  );
}
