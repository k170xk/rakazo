import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  AnimationConfig,
  BackgroundConfig,
  BarChartItem,
  ChartVariant,
  TextStyleConfig,
} from "../types";
import { SceneBackground } from "./SceneBackground";
import { useSceneAnimation } from "./useSceneAnimation";

interface Props {
  heading?: string;
  items: BarChartItem[];
  unit?: string;
  chartType?: ChartVariant;
  showValues?: boolean;
  brandColor: string;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

const fmt = (v: number) => {
  const decimals = v % 1 !== 0 ? 1 : 0;
  return v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const withAlpha = (color: string, alphaHex: string) => {
  if (/^#[0-9a-f]{6}$/i.test(color)) return `${color}${alphaHex}`;
  if (/^#[0-9a-f]{8}$/i.test(color)) return `${color.slice(0, 7)}${alphaHex}`;
  return color;
};

const palette = (_brandColor: string, n: number): string[] => {
  const variants = [
    "#76bf43",
    "#8ecb5b",
    "#a4d873",
    "#b9e38d",
    "#60a5fa",
    "#f59e0b",
    "#ec4899",
    "#8b5cf6",
  ];
  return Array.from({ length: n }, (_, i) => variants[i % variants.length]);
};

export const BarChartScene: React.FC<Props> = ({
  heading,
  items,
  unit = "",
  chartType = "bar",
  showValues = true,
  brandColor,
  background,
  headingStyle,
  animation,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const headAnim = useSceneAnimation(animation, 0);
  const hs = headingStyle || {};
  const colors = palette(brandColor, items.length);
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "80px 120px",
      }}
    >
      <SceneBackground config={background} brandColor={brandColor} />
      <div style={{ position: "relative", zIndex: 1, width: "100%" }}>
        {heading && (
          <h2
            style={{
              fontSize: hs.fontSize || 44,
              fontWeight: hs.fontWeight || 700,
              color: hs.color || "#0f172a",
              marginBottom: 50,
              opacity: headAnim.opacity,
              transform: headAnim.transform,
            }}
          >
            {heading}
          </h2>
        )}

        {chartType === "bar" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 24,
              width: "100%",
            }}
          >
            {items.map((it, i) => {
              const delay = 12 + i * 8;
              const sp = spring({
                frame: Math.max(0, frame - delay),
                fps,
                config: { damping: 22, stiffness: 80 },
              });
              const fillPct = (it.value / max) * 100 * sp;
              const valueSp = spring({
                frame: Math.max(0, frame - delay),
                fps,
                config: { damping: 30, stiffness: 60 },
              });
              const animatedValue = it.value * valueSp;
              const fallbackColor = colors[i];
              const c = /^#[0-9a-f]{6,8}$/i.test(it.color || "")
                ? (it.color as string)
                : fallbackColor;
              return (
                <div
                  key={i}
                  style={{
                    width: "100%",
                    opacity: interpolate(sp, [0, 0.3], [0, 1], {
                      extrapolateRight: "clamp",
                    }),
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      marginBottom: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 22,
                        color: "#334155",
                        fontWeight: 600,
                      }}
                    >
                      {it.label}
                    </span>
                    {showValues && (
                      <span style={{ fontSize: 28, color: c, fontWeight: 800 }}>
                        {fmt(animatedValue)}
                        {unit}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      width: "100%",
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: withAlpha(c, "18"),
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.max(0, Math.min(100, fillPct))}%`,
                        height: "100%",
                        borderRadius: 14,
                        backgroundColor: c,
                        boxShadow: `0 0 20px ${withAlpha(c, "50")}`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {chartType === "column" && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: 24,
              height: 480,
              padding: "0 40px",
            }}
          >
            {items.map((it, i) => {
              const delay = 12 + i * 6;
              const sp = spring({
                frame: Math.max(0, frame - delay),
                fps,
                config: { damping: 18, stiffness: 90 },
              });
              const h = interpolate(sp, [0, 1], [0, (it.value / max) * 100]);
              const valueSp = spring({
                frame: Math.max(0, frame - delay),
                fps,
                config: { damping: 30, stiffness: 60 },
              });
              const animatedValue = it.value * valueSp;
              const c = it.color || colors[i];
              return (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    height: "100%",
                    opacity: interpolate(sp, [0, 0.3], [0, 1]),
                  }}
                >
                  {showValues && (
                    <div
                      style={{
                        fontSize: 28,
                        color: c,
                        fontWeight: 800,
                        marginBottom: 12,
                      }}
                    >
                      {fmt(animatedValue)}
                      {unit}
                    </div>
                  )}
                  <div
                    style={{
                      width: "85%",
                      height: `${h}%`,
                      borderRadius: "14px 14px 4px 4px",
                      background: `linear-gradient(180deg, ${c}, ${c}aa)`,
                      boxShadow: `0 0 30px ${c}50`,
                    }}
                  />
                  <div
                    style={{
                      fontSize: 20,
                      color: "#334155",
                      fontWeight: 600,
                      marginTop: 16,
                    }}
                  >
                    {it.label}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {(chartType === "line" || chartType === "area") &&
          (() => {
            const W = 1400,
              H = 460;
            const pad = 60;
            const chartW = W - pad * 2,
              chartH = H - pad * 2;
            const stepX = items.length > 1 ? chartW / (items.length - 1) : 0;
            const points = items.map((it, i) => ({
              x: pad + i * stepX,
              y: pad + chartH - (it.value / max) * chartH,
              v: it.value,
              label: it.label,
            }));
            const reveal = spring({
              frame,
              fps,
              config: { damping: 30, stiffness: 50 },
            });
            const lineLen = 2000;
            const dashOffset = interpolate(reveal, [0, 1], [lineLen, 0]);
            const path = points.reduce(
              (a, p, i) =>
                a + (i === 0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`),
              "",
            );
            const areaPath = `${path} L ${points[points.length - 1]?.x} ${pad + chartH} L ${pad} ${pad + chartH} Z`;
            return (
              <svg
                width="100%"
                viewBox={`0 0 ${W} ${H}`}
                style={{ maxHeight: 480 }}
              >
                <defs>
                  <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={brandColor}
                      stopOpacity="0.5"
                    />
                    <stop
                      offset="100%"
                      stopColor={brandColor}
                      stopOpacity="0"
                    />
                  </linearGradient>
                </defs>
                {/* Y grid */}
                {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                  <line
                    key={t}
                    x1={pad}
                    x2={pad + chartW}
                    y1={pad + chartH * t}
                    y2={pad + chartH * t}
                    stroke="#ffffff15"
                    strokeWidth={1}
                  />
                ))}
                {chartType === "area" && (
                  <path
                    d={areaPath}
                    fill="url(#areaGrad)"
                    opacity={interpolate(reveal, [0.3, 1], [0, 1], {
                      extrapolateRight: "clamp",
                    })}
                  />
                )}
                <path
                  d={path}
                  fill="none"
                  stroke={brandColor}
                  strokeWidth={5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    strokeDasharray: lineLen,
                    strokeDashoffset: dashOffset,
                    filter: `drop-shadow(0 0 12px ${brandColor}99)`,
                  }}
                />
                {points.map((p, i) => {
                  const dotDelay = 8 + i * 6;
                  const dotSp = spring({
                    frame: Math.max(0, frame - dotDelay),
                    fps,
                    config: { damping: 14 },
                  });
                  const r = interpolate(dotSp, [0, 1], [0, 9]);
                  return (
                    <g key={i} opacity={interpolate(dotSp, [0, 0.4], [0, 1])}>
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={r + 6}
                        fill={brandColor}
                        opacity={0.25}
                      />
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={r}
                        fill="#0f172a"
                        stroke={brandColor}
                        strokeWidth={3}
                      />
                      {showValues && (
                        <text
                          x={p.x}
                          y={p.y - 22}
                          textAnchor="middle"
                          fill="#0f172a"
                          fontSize={20}
                          fontWeight={700}
                        >
                          {fmt(p.v)}
                          {unit}
                        </text>
                      )}
                      <text
                        x={p.x}
                        y={pad + chartH + 30}
                        textAnchor="middle"
                        fill="#94a3b8"
                        fontSize={18}
                      >
                        {p.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            );
          })()}

        {(chartType === "donut" || chartType === "pie") &&
          (() => {
            const total = items.reduce((s, it) => s + it.value, 0) || 1;
            const cx = 280,
              cy = 240,
              r = 200,
              innerR = chartType === "donut" ? 120 : 0;
            let cumAngle = -Math.PI / 2;
            const reveal = spring({
              frame,
              fps,
              config: { damping: 28, stiffness: 60 },
            });
            const arcs = items.map((it, i) => {
              const sliceAngle = (it.value / total) * Math.PI * 2 * reveal;
              const start = cumAngle;
              const end = cumAngle + sliceAngle;
              cumAngle = end;
              const x1 = cx + r * Math.cos(start),
                y1 = cy + r * Math.sin(start);
              const x2 = cx + r * Math.cos(end),
                y2 = cy + r * Math.sin(end);
              const large = sliceAngle > Math.PI ? 1 : 0;
              const ix1 = cx + innerR * Math.cos(end),
                iy1 = cy + innerR * Math.sin(end);
              const ix2 = cx + innerR * Math.cos(start),
                iy2 = cy + innerR * Math.sin(start);
              const path =
                innerR > 0
                  ? `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${innerR} ${innerR} 0 ${large} 0 ${ix2} ${iy2} Z`
                  : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
              return {
                path,
                color: it.color || colors[i],
                pct: (it.value / total) * 100,
                label: it.label,
                value: it.value,
              };
            });
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 60 }}>
                <svg width={560} height={480} viewBox="0 0 560 480">
                  {arcs.map((a, i) => (
                    <path
                      key={i}
                      d={a.path}
                      fill={a.color}
                      stroke="#0f172a"
                      strokeWidth={3}
                    />
                  ))}
                  {chartType === "donut" && (
                    <text
                      x={cx}
                      y={cy + 12}
                      textAnchor="middle"
                      fill="#0f172a"
                      fontSize={42}
                      fontWeight={800}
                    >
                      {fmt(total)}
                      {unit}
                    </text>
                  )}
                </svg>
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                  }}
                >
                  {arcs.map((a, i) => {
                    const delay = 14 + i * 6;
                    const sp = spring({
                      frame: Math.max(0, frame - delay),
                      fps,
                      config: { damping: 18 },
                    });
                    return (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 16,
                          opacity: sp,
                          transform: `translateX(${interpolate(sp, [0, 1], [20, 0])}px)`,
                        }}
                      >
                        <div
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            backgroundColor: a.color,
                            flexShrink: 0,
                          }}
                        />
                        <div
                          style={{
                            flex: 1,
                            fontSize: 22,
                            color: "#334155",
                            fontWeight: 600,
                          }}
                        >
                          {a.label}
                        </div>
                        <div
                          style={{
                            fontSize: 24,
                            color: a.color,
                            fontWeight: 800,
                          }}
                        >
                          {fmt(a.value)}
                          {unit}
                        </div>
                        <div
                          style={{
                            fontSize: 18,
                            color: "#64748b",
                            minWidth: 60,
                            textAlign: "right",
                          }}
                        >
                          {a.pct.toFixed(0)}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

        {chartType === "radial" &&
          (() => {
            const cx = 700,
              cy = 240,
              baseR = 80,
              gap = 32;
            const reveal = spring({
              frame,
              fps,
              config: { damping: 26, stiffness: 60 },
            });
            return (
              <svg
                width="100%"
                viewBox="0 0 1400 480"
                style={{ maxHeight: 480 }}
              >
                {items.map((it, i) => {
                  const r = baseR + i * gap;
                  const circ = 2 * Math.PI * r;
                  const fillPct = (it.value / max) * reveal;
                  const c = it.color || colors[i];
                  return (
                    <g key={i} transform={`rotate(-90 ${cx} ${cy})`}>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={r}
                        fill="none"
                        stroke={`${c}22`}
                        strokeWidth={20}
                      />
                      <circle
                        cx={cx}
                        cy={cy}
                        r={r}
                        fill="none"
                        stroke={c}
                        strokeWidth={20}
                        strokeLinecap="round"
                        strokeDasharray={circ}
                        strokeDashoffset={circ * (1 - fillPct)}
                        style={{ filter: `drop-shadow(0 0 8px ${c}aa)` }}
                      />
                    </g>
                  );
                })}
                {items.map((it, i) => {
                  const c = it.color || colors[i];
                  return (
                    <g
                      key={i}
                      transform={`translate(1000, ${120 + i * 50})`}
                      opacity={interpolate(
                        spring({
                          frame: Math.max(0, frame - (10 + i * 5)),
                          fps,
                          config: { damping: 18 },
                        }),
                        [0, 1],
                        [0, 1],
                      )}
                    >
                      <circle cx={0} cy={0} r={9} fill={c} />
                      <text
                        x={20}
                        y={6}
                        fill="#1f2937"
                        fontSize={22}
                        fontWeight={600}
                      >
                        {it.label}
                      </text>
                      <text
                        x={280}
                        y={6}
                        fill={c}
                        fontSize={24}
                        fontWeight={800}
                        textAnchor="end"
                      >
                        {fmt(it.value)}
                        {unit}
                      </text>
                    </g>
                  );
                })}
              </svg>
            );
          })()}
      </div>
    </div>
  );
};
