// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
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
  name: "pie-chart",
  category: "charts",
  description:
    "A pie chart whose slices sweep in one after another, with a legend underneath. Use to show how a whole splits into parts, such as work by discipline or sector.",
  props: {
    title: 'string (default "Workload by discipline")',
    data: '{label: string, value: number}[] (default [{label: "Civil", value: 30}, {label: "Structural", value: 25}, {label: "MEP", value: 20}, {label: "Transport", value: 15}, {label: "Water", value: 10}])',
    prefix: 'string shown before each value in the legend, e.g. "€" (default "")',
    suffix: 'string shown after each value in the legend, e.g. "%" or "m" (default "%")',
    dark: "boolean: dark OCSC background, false for a light one (default false: white)",
  },
  seconds: 6,
  media: "none",
  fits: "3-6 slices with short labels.",
  instead: "donut-chart to add a headline figure.",
};

type Datum = { label?: string; value?: number | string };

type Props = BrandProps & {
  title?: string;
  data?: Datum[];
  prefix?: string;
  suffix?: string;
  dark?: boolean;
};

const DEFAULT_DATA: Datum[] = [
  { label: "Civil", value: 30 },
  { label: "Structural", value: 25 },
  { label: "MEP", value: 20 },
  { label: "Transport", value: 15 },
  { label: "Water", value: 10 },
];

const decimalsOf = (n: number) =>
  Math.min(2, (String(n).split(".")[1] ?? "").length);

export default function PieChart(props: Props) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);

  const dark = props.dark === true;
  const fg = dark ? p.onDark : p.text;
  const muted = dark ? p.onDarkMuted : p.textMuted;
  // On the dark background the darkest greens vanish, so lighter tones lead.
  const colors = dark
    ? [p.primary, "#94a3b8", p.lighter, p.slate, p.light, p.dark]
    : p.series;

  const title = str(props.title, "Workload by discipline");
  const prefix = str(props.prefix, "");
  const suffix = props.suffix === "" ? "" : str(props.suffix, "%");
  const segments = list<Datum>(props.data, DEFAULT_DATA).map((d, i) => ({
    label: str(d?.label, ""),
    value: Math.max(0, num(d?.value, 0)),
    color: colors[i % colors.length],
  }));
  const n = segments.length;
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  const decimals = Math.max(...segments.map((s) => decimalsOf(s.value)));
  const fmt = (v: number) =>
    `${prefix}${v.toLocaleString("en-IE", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix}`;

  const cardWidth = Math.min(600, stage.width - 40);
  const cardHeight = stage.vertical
    ? Math.min(640, stage.height - 120)
    : Math.min(520, stage.height - 20);
  const svgHeight = 380;
  const cx = cardWidth / 2;
  const cy = svgHeight / 2;
  const radius = 140;
  const circumference = 2 * Math.PI * radius;

  const sweep = 15;
  const enter = Math.min(60, Math.max(30, durationInFrames * 0.35));
  const stagger = n > 1 ? Math.min(10, (enter - sweep) / (n - 1)) : 0;

  let cumulativeOffset = 0;

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
            width: cardWidth,
            height: cardHeight,
            backgroundColor: dark ? "rgba(0, 0, 0, 0.2)" : p.paper,
            borderRadius: 16,
            boxShadow: dark
              ? "0 10px 30px rgba(0, 0, 0, 0.3)"
              : "0 10px 30px rgba(0, 0, 0, 0.08)",
            overflow: "hidden",
            padding: "20px 20px 25px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "space-between",
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
              textAlign: "center",
            }}
          >
            {title}
          </div>

          <svg width={cardWidth - 40} height={svgHeight}>
            {segments.map((segment, i) => {
              const segmentLength = (segment.value / total) * circumference;
              const currentOffset = cumulativeOffset;
              cumulativeOffset += segmentLength;

              const segmentProgress = interpolate(
                frame,
                [i * stagger, sweep + i * stagger],
                [0, 1],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.out(Easing.quad),
                },
              );
              const animatedLength = segmentLength * segmentProgress;

              return (
                <circle
                  key={`seg-${i}`}
                  cx={cx - 20}
                  cy={cy}
                  r={radius}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth="80"
                  strokeDasharray={`${animatedLength} ${circumference - animatedLength}`}
                  strokeDashoffset={-currentOffset}
                  transform={`rotate(-90 ${cx - 20} ${cy})`}
                />
              );
            })}
            <circle cx={cx - 20} cy={cy} r={60} fill={dark ? p.ink : p.paperAlt} />
          </svg>

          <div
            style={{
              display: "flex",
              gap: "8px 20px",
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            {segments.map((segment, i) => {
              const legendOpacity = interpolate(
                frame,
                [5 + i * stagger, 15 + i * stagger],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
              );
              return (
                <div
                  key={`legend-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    opacity: legendOpacity,
                  }}
                >
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      backgroundColor: segment.color,
                    }}
                  />
                  <span style={{ color: muted, fontSize: 13 }}>
                    {segment.label} ({fmt(segment.value)})
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Stage>
  );
}
