// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { useId } from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  list,
  num,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "chart-animation",
  category: "charts",
  description:
    "A bar chart whose bars grow up one after another with their values on top. Use to compare a figure across months, years, regions or disciplines.",
  props: {
    title: 'string (default "Site inspections")',
    subtitle: 'string (default "Monthly, 2025" with the default data, otherwise none)',
    data: '{label: string, value: number}[] (default [{label: "Jan", value: 42}, {label: "Feb", value: 58}, ... 10 months])',
    prefix: 'string shown before each value, e.g. "€" (default "")',
    suffix: 'string shown after each value, e.g. "%" or "m" (default "")',
    max: "number: top of the value scale (default: the largest value, rounded up)",
    dark: "boolean: dark OCSC background, false for a light one (default false: white)",
  },
  seconds: 6,
  media: "none",
  fits: "5-12 bars with short labels.",
  instead: "bar_chart for other chart types; comparison-chart for just two bars.",
};

type Datum = { label?: string; value?: number | string };

type Props = BrandProps & {
  title?: string;
  subtitle?: string;
  data?: Datum[];
  prefix?: string;
  suffix?: string;
  max?: number;
  dark?: boolean;
};

const DEFAULT_DATA: Datum[] = [
  { label: "Jan", value: 42 },
  { label: "Feb", value: 58 },
  { label: "Mar", value: 37 },
  { label: "Apr", value: 64 },
  { label: "May", value: 51 },
  { label: "Jun", value: 72 },
  { label: "Jul", value: 60 },
  { label: "Aug", value: 46 },
  { label: "Sep", value: 69 },
  { label: "Oct", value: 78 },
];

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const raw = v / 4;
  const exp = 10 ** Math.floor(Math.log10(raw));
  const f = raw / exp;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
  return Math.ceil(v / step) * step;
}

const decimalsOf = (n: number) =>
  Math.min(2, (String(n).split(".")[1] ?? "").length);

export default function ChartAnimation(props: Props) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const id = useId().replace(/:/g, "");

  const dark = props.dark === true;
  const fg = dark ? p.onDark : p.text;
  const muted = dark ? p.onDarkMuted : p.textMuted;
  const axis = dark ? "rgba(255, 255, 255, 0.2)" : alpha(p.text, 0.2);

  const title = str(props.title, "Site inspections");
  const usingDefaults = !Array.isArray(props.data) || !props.data.length;
  const subtitle = str(props.subtitle, usingDefaults ? "Monthly, 2025" : "");
  const prefix = str(props.prefix, "");
  const suffix = str(props.suffix, "");
  const data = list<Datum>(props.data, DEFAULT_DATA).map((d) => ({
    label: str(d?.label, ""),
    value: num(d?.value, 0),
  }));
  const n = data.length;
  const maxValue = num(
    props.max,
    niceMax(Math.max(...data.map((d) => d.value))),
  );
  const decimals = Math.max(...data.map((d) => decimalsOf(d.value)));
  const fmt = (v: number) =>
    `${prefix}${v.toLocaleString("en-IE", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix}`;

  const chartWidth = Math.min(900, stage.width - 40);
  const chartHeight = stage.vertical
    ? Math.min(680, stage.height - 120)
    : Math.min(500, stage.height - 40);
  const padding = stage.vertical ? 30 : 60;
  const plotTop = 130;
  const plotBottom = chartHeight - 50;
  const slot = (chartWidth - padding * 2) / n;
  const barWidth = slot * 0.7;
  const fontSize = slot < 50 ? 12 : 14;

  // Every bar is up within the first two seconds, however many there are.
  const grow = 15;
  const enter = Math.min(60, Math.max(30, durationInFrames * 0.35));
  const stagger = n > 1 ? (enter - grow) / (n - 1) : 0;

  const cardIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "relative",
            width: chartWidth,
            height: chartHeight,
            backgroundColor: dark ? "rgba(0, 0, 0, 0.2)" : p.paper,
            borderRadius: 16,
            boxShadow: dark
              ? "0 10px 30px rgba(0, 0, 0, 0.3)"
              : "0 10px 30px rgba(0, 0, 0, 0.08)",
            overflow: "hidden",
            opacity: cardIn,
          }}
        >
          <svg
            width={chartWidth}
            height={chartHeight}
            style={{ position: "absolute", inset: 0 }}
          >
            <defs>
              <linearGradient id={`${id}-bar`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={p.light} />
                <stop offset="100%" stopColor={p.primary} />
              </linearGradient>
              <filter id={`${id}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="4" stdDeviation="4" floodOpacity="0.3" />
              </filter>
            </defs>

            <line
              x1={padding}
              y1={plotBottom}
              x2={chartWidth - padding}
              y2={plotBottom}
              stroke={axis}
              strokeWidth="2"
            />

            {data.map((point, i) => {
              const cx = padding + slot * (i + 0.5);
              const barHeight =
                (Math.max(0, Math.min(point.value, maxValue)) / maxValue) *
                (plotBottom - plotTop);
              const barProgress = interpolate(
                frame,
                [i * stagger, grow + i * stagger],
                [0, 1],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.out(Easing.cubic),
                },
              );
              const currentHeight = barHeight * barProgress;
              const currentY = plotBottom - currentHeight;
              const valueOpacity = interpolate(barProgress, [0.85, 1], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });

              return (
                <g key={`bar-${i}`}>
                  <text
                    x={cx}
                    y={plotBottom + 25}
                    textAnchor="middle"
                    fill={muted}
                    fontSize={fontSize}
                    fontWeight="500"
                  >
                    {point.label}
                  </text>
                  <rect
                    x={cx - barWidth / 2}
                    y={currentY}
                    width={barWidth}
                    height={currentHeight}
                    fill={`url(#${id}-bar)`}
                    rx="6"
                    ry="6"
                    filter={`url(#${id}-shadow)`}
                  />
                  <text
                    x={cx}
                    y={currentY - 10}
                    textAnchor="middle"
                    fill={fg}
                    fontSize={fontSize}
                    fontWeight="bold"
                    opacity={valueOpacity}
                  >
                    {fmt(point.value)}
                  </text>
                </g>
              );
            })}
          </svg>

          <div
            style={{
              position: "absolute",
              top: 25,
              left: 20,
              right: 20,
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 28,
                fontWeight: "bold",
                color: fg,
                textShadow: dark ? "0 2px 4px rgba(0, 0, 0, 0.3)" : undefined,
                letterSpacing: "-0.5px",
                lineHeight: 1.2,
              }}
            >
              {title}
            </div>
            {subtitle ? (
              <div style={{ fontSize: 16, color: muted, marginTop: 6 }}>
                {subtitle}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Stage>
  );
}
