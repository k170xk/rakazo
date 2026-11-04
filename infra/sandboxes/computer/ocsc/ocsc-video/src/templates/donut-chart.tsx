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
  name: "donut-chart",
  category: "charts",
  description:
    "A thin donut chart drawn segment by segment around a headline figure that counts up in the middle. Use for a status breakdown with one key number, such as a project portfolio by stage.",
  props: {
    title: 'string (default "Project portfolio")',
    data: '{label: string, value: number}[] (default [{label: "Completed", value: 62}, {label: "In construction", value: 21}, {label: "In design", value: 11}, {label: "At planning", value: 6}])',
    centerValue: "number shown in the middle (default: the first segment's share of the total, 62)",
    centerLabel: 'string under the middle number (default: the first segment\'s label, "Completed")',
    prefix: 'string before the middle number, e.g. "€" (default "")',
    suffix: 'string after the middle number, e.g. "%" or "m" (default "%")',
    dark: "boolean: dark OCSC background, false for a light one (default false: white)",
  },
  seconds: 6,
  media: "none",
  fits: "3-5 segments and one headline figure.",
  instead: "pie-chart for a breakdown without a headline figure.",
};

type Datum = { label?: string; value?: number | string };

type Props = BrandProps & {
  title?: string;
  data?: Datum[];
  centerValue?: number;
  centerLabel?: string;
  prefix?: string;
  suffix?: string;
  dark?: boolean;
};

const DEFAULT_DATA: Datum[] = [
  { label: "Completed", value: 62 },
  { label: "In construction", value: 21 },
  { label: "In design", value: 11 },
  { label: "At planning", value: 6 },
];

const decimalsOf = (n: number) =>
  Math.min(2, (String(n).split(".")[1] ?? "").length);

export default function DonutChart(props: Props) {
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

  const title = str(props.title, "Project portfolio");
  const segments = list<Datum>(props.data, DEFAULT_DATA).map((d, i) => ({
    label: str(d?.label, ""),
    value: Math.max(0, num(d?.value, 0)),
    color: colors[i % colors.length],
  }));
  const n = segments.length;
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  const prefix = str(props.prefix, "");
  const suffix = props.suffix === "" ? "" : str(props.suffix, "%");
  const target = num(
    props.centerValue,
    Math.round((segments[0].value / total) * 100),
  );
  const centerLabel = str(props.centerLabel, segments[0].label);
  const decimals = decimalsOf(target);

  const cardWidth = Math.min(600, stage.width - 40);
  const cardHeight = stage.vertical
    ? Math.min(640, stage.height - 120)
    : Math.min(520, stage.height - 20);
  const svgWidth = cardWidth - 40;
  const svgHeight = 320;
  const cx = svgWidth / 2;
  const cy = svgHeight / 2;
  const radius = 120;
  const strokeWidth = 20;
  const circumference = 2 * Math.PI * radius;

  const sweep = 20;
  const enter = Math.min(70, Math.max(36, durationInFrames * 0.4));
  const stagger = n > 1 ? Math.min(12, (enter - sweep) / (n - 1)) : 0;

  const centerValue = interpolate(frame, [10, 10 + enter], [0, target], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const centerText = `${prefix}${centerValue.toLocaleString("en-IE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${suffix}`;

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

          <svg width={svgWidth} height={svgHeight}>
            <circle
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={dark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)"}
              strokeWidth={strokeWidth}
            />

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
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  strokeDasharray={`${animatedLength} ${circumference - animatedLength}`}
                  strokeDashoffset={-currentOffset}
                  transform={`rotate(-90 ${cx} ${cy})`}
                />
              );
            })}

            <text
              x={cx}
              y={cy - 5}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={fg}
              fontSize="48"
              fontWeight="bold"
            >
              {centerText}
            </text>
            <text
              x={cx}
              y={cy + 32}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={muted}
              fontSize="16"
            >
              {centerLabel}
            </text>
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
                    {segment.label}
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
