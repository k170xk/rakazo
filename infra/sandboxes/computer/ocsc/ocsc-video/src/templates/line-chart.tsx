// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
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
  name: "line-chart",
  category: "charts",
  description:
    "A line chart that draws itself left to right over a grid, with points appearing as the line reaches them. Use to show growth or a trend over time.",
  props: {
    title: 'string (default "Projects delivered")',
    subtitle: 'string (default "Cumulative, 2016 to 2025" with the default data, otherwise none)',
    data: '{label: string, value: number}[] (default [{label: "2016", value: 480}, {label: "2017", value: 560}, ... {label: "2025", value: 1250}])',
    prefix: 'string shown before values, e.g. "€" (default "")',
    suffix: 'string shown after values, e.g. "%" or "m" (default "")',
    max: "number: top of the value scale (default: the largest value, rounded up)",
    dark: "boolean: dark OCSC background, false for a light one (default false: white)",
  },
  seconds: 6,
  media: "none",
  fits: "6-12 points over time.",
  instead: "area-chart to stress volume; bar_chart for categories.",
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
  { label: "2016", value: 480 },
  { label: "2017", value: 560 },
  { label: "2018", value: 610 },
  { label: "2019", value: 700 },
  { label: "2020", value: 760 },
  { label: "2021", value: 850 },
  { label: "2022", value: 930 },
  { label: "2023", value: 1020 },
  { label: "2024", value: 1130 },
  { label: "2025", value: 1250 },
];

/** A round top for the scale and a round step for its four grid lines. */
function niceScale(v: number, fixedMax?: number): { max: number; step: number } {
  if (fixedMax && fixedMax > 0) return { max: fixedMax, step: fixedMax / 4 };
  if (v <= 0) return { max: 1, step: 0.25 };
  const raw = v / 4;
  const exp = 10 ** Math.floor(Math.log10(raw));
  const f = raw / exp;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
  return { max: Math.ceil(v / step) * step, step };
}

const decimalsOf = (n: number) =>
  Math.min(2, (String(n).split(".")[1] ?? "").length);

export default function LineChart(props: Props) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);

  const dark = props.dark === true;
  const fg = dark ? p.onDark : p.text;
  const muted = dark ? p.onDarkMuted : p.textMuted;
  const grid = dark ? "rgba(255, 255, 255, 0.1)" : alpha(p.text, 0.08);
  const axis = dark ? "rgba(255, 255, 255, 0.2)" : alpha(p.text, 0.2);

  const title = str(props.title, "Projects delivered");
  const usingDefaults = !Array.isArray(props.data) || !props.data.length;
  const subtitle = str(
    props.subtitle,
    usingDefaults ? "Cumulative, 2016 to 2025" : "",
  );
  const prefix = str(props.prefix, "");
  const suffix = str(props.suffix, "");
  const data = list<Datum>(props.data, DEFAULT_DATA).map((d) => ({
    label: str(d?.label, ""),
    value: num(d?.value, 0),
  }));
  const n = data.length;
  const scale = niceScale(
    Math.max(...data.map((d) => d.value)),
    num(props.max, 0),
  );
  const decimals = Math.max(...data.map((d) => decimalsOf(d.value)));
  const fmt = (v: number, places = decimals) =>
    `${prefix}${v.toLocaleString("en-IE", {
      minimumFractionDigits: places,
      maximumFractionDigits: places,
    })}${suffix}`;
  const ticks = Array.from(
    { length: Math.round(scale.max / scale.step) + 1 },
    (_, k) => k * scale.step,
  );
  const tickDecimals = decimalsOf(scale.step);

  const chartWidth = Math.min(900, stage.width - 40);
  const chartHeight = stage.vertical
    ? Math.min(680, stage.height - 120)
    : Math.min(500, stage.height - 40);
  const padLeft = stage.vertical ? 62 : 80;
  const padRight = stage.vertical ? 24 : 50;
  const plotTop = 130;
  const plotBottom = chartHeight - 50;

  const xScale = (i: number) =>
    n > 1
      ? (i / (n - 1)) * (chartWidth - padLeft - padRight) + padLeft
      : (chartWidth + padLeft - padRight) / 2;
  const yScale = (y: number) =>
    plotBottom -
    (Math.max(0, Math.min(y, scale.max)) / scale.max) * (plotBottom - plotTop);

  const points = data.map((d, i) => `${xScale(i)},${yScale(d.value)}`).join(" ");

  // Running length to each point, so each point pops in when the line reaches it.
  const lengths = [0];
  for (let i = 1; i < n; i++) {
    const dx = xScale(i) - xScale(i - 1);
    const dy = yScale(data[i].value) - yScale(data[i - 1].value);
    lengths.push(lengths[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const totalLength = Math.max(1, lengths[n - 1]);

  const draw = Math.min(75, Math.max(40, durationInFrames * 0.4));
  const drawn = interpolate(frame, [0, draw], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  const dashOffset = totalLength * (1 - drawn);

  const last = data[n - 1];
  const lastTag = interpolate(frame, [draw, draw + 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const labelSize = (chartWidth - padLeft - padRight) / n < 50 ? 11 : 13;

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
          }}
        >
          <svg
            width={chartWidth}
            height={chartHeight}
            style={{ position: "absolute", inset: 0 }}
          >
            {ticks.map((val) => (
              <line
                key={`grid-${val}`}
                x1={padLeft}
                y1={yScale(val)}
                x2={chartWidth - padRight}
                y2={yScale(val)}
                stroke={grid}
                strokeWidth="1"
              />
            ))}

            {ticks.map((val) => (
              <text
                key={`y-${val}`}
                x={padLeft - 12}
                y={yScale(val) + 4}
                textAnchor="end"
                fill={muted}
                fontSize="12"
              >
                {fmt(val, tickDecimals)}
              </text>
            ))}

            <line
              x1={padLeft}
              y1={plotBottom}
              x2={chartWidth - padRight}
              y2={plotBottom}
              stroke={axis}
              strokeWidth="2"
            />
            <line
              x1={padLeft}
              y1={plotTop}
              x2={padLeft}
              y2={plotBottom}
              stroke={axis}
              strokeWidth="2"
            />

            {data.map((point, i) => (
              <text
                key={`x-label-${i}`}
                x={xScale(i)}
                y={plotBottom + 25}
                textAnchor="middle"
                fill={muted}
                fontSize={labelSize}
                fontWeight="500"
              >
                {point.label}
              </text>
            ))}

            <polyline
              points={points}
              fill="none"
              stroke={p.primary}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={totalLength}
              strokeDashoffset={dashOffset}
            />

            {data.map((point, i) => {
              const reach = (lengths[i] / totalLength) * draw;
              const pointProgress = interpolate(
                frame,
                [reach, reach + 6],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
              );
              return (
                <circle
                  key={`point-${i}`}
                  cx={xScale(i)}
                  cy={yScale(point.value)}
                  r={5 * pointProgress}
                  fill={dark ? p.light : "white"}
                  stroke={dark ? "white" : p.primary}
                  strokeWidth="2"
                  opacity={pointProgress}
                />
              );
            })}

            {last ? (
              <text
                x={xScale(n - 1)}
                y={yScale(last.value) - 16}
                textAnchor={n > 1 ? "end" : "middle"}
                fill={fg}
                fontSize="16"
                fontWeight="bold"
                opacity={lastTag}
              >
                {fmt(last.value)}
              </text>
            ) : null}
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
