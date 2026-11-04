// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  num,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "comparison-chart",
  category: "charts",
  description:
    "Two bars side by side, before and after, rising with their figures counting up. Use to show the improvement a project or intervention made.",
  props: {
    title: 'string (default "Retrofit energy efficiency")',
    beforeValue: "number (default 34)",
    afterValue: "number (default 89)",
    beforeLabel: 'string (default "Before retrofit")',
    afterLabel: 'string (default "After retrofit")',
    prefix: 'string before each figure, e.g. "€" (default "")',
    suffix: 'string after each figure, e.g. "%" or "m" (default "%")',
    max: 'number: the value of a full-height bar (default 100 when suffix is "%", otherwise the larger value)',
    dark: "boolean: dark OCSC background, false for a light one (default false: white)",
  },
  seconds: 5,
  media: "none",
  fits: "Two figures with short labels.",
  instead: "comparison for points in words; chart-animation for more than two figures.",
};

type Props = BrandProps & {
  title?: string;
  beforeValue?: number;
  afterValue?: number;
  beforeLabel?: string;
  afterLabel?: string;
  prefix?: string;
  suffix?: string;
  max?: number;
  dark?: boolean;
};

const decimalsOf = (n: number) =>
  Math.min(2, (String(n).split(".")[1] ?? "").length);

export default function ComparisonChart(props: Props) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);

  const dark = props.dark === true;
  const fg = dark ? p.onDark : p.text;
  const muted = dark ? "rgba(255, 255, 255, 0.8)" : p.textMuted;

  const title = str(props.title, "Retrofit energy efficiency");
  const before = num(props.beforeValue, 34);
  const after = num(props.afterValue, 89);
  const prefix = str(props.prefix, "");
  const suffix = props.suffix === "" ? "" : str(props.suffix, "%");
  const largest = Math.max(before, after);
  const max = Math.max(
    num(props.max, suffix === "%" ? 100 : largest),
    largest,
    1e-9,
  );
  const decimals = Math.max(decimalsOf(before), decimalsOf(after));
  const fmt = (v: number) =>
    `${prefix}${v.toLocaleString("en-IE", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix}`;

  const maxBarHeight = stage.vertical ? 360 : 280;
  const rise = Math.min(60, Math.max(30, durationInFrames * 0.3));
  const ease = {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  } as const;

  const beforeShown = interpolate(frame, [10, 10 + rise], [0, before], ease);
  const afterShown = interpolate(frame, [20, 20 + rise], [0, after], ease);
  const barHeight = (v: number) =>
    (Math.max(0, Math.min(v, max)) / max) * maxBarHeight;

  const dividerOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dividerHeight = interpolate(
    frame,
    [0, 20],
    [0, maxBarHeight + 70],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const sides = [
    { value: beforeShown, label: str(props.beforeLabel, "Before retrofit"), color: p.slate },
    { value: afterShown, label: str(props.afterLabel, "After retrofit"), color: p.primary },
  ];
  const valueSize = stage.vertical ? 40 : 48;

  const side = (s: (typeof sides)[number]) => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        flex: 1,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: valueSize,
          fontWeight: "bold",
          color: s.color,
          marginBottom: 15,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {fmt(s.value)}
      </div>
      <div
        style={{
          width: 120,
          height: barHeight(s.value),
          backgroundColor: s.color,
          borderRadius: "8px 8px 0 0",
          boxShadow: `0 0 20px ${alpha(s.color, 0.3)}`,
        }}
      />
      <div
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: muted,
          marginTop: 15,
          textAlign: "center",
          lineHeight: 1.2,
          minHeight: 24,
        }}
      >
        {s.label}
      </div>
    </div>
  );

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
            width: Math.min(700, stage.width - 40),
            boxSizing: "border-box",
            backgroundColor: dark ? "rgba(0, 0, 0, 0.2)" : p.paper,
            borderRadius: 16,
            boxShadow: dark
              ? "0 10px 30px rgba(0, 0, 0, 0.3)"
              : "0 10px 30px rgba(0, 0, 0, 0.08)",
            padding: stage.vertical ? "36px 24px" : "30px 40px",
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
              marginBottom: 20,
            }}
          >
            {title}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              height: maxBarHeight + 110,
              position: "relative",
            }}
          >
            {side(sides[0])}
            <div
              style={{
                width: 2,
                height: dividerHeight,
                backgroundColor: dark
                  ? "rgba(255, 255, 255, 0.2)"
                  : alpha(p.text, 0.15),
                opacity: dividerOpacity,
                alignSelf: "center",
                margin: stage.vertical ? "0 16px" : "0 30px",
              }}
            />
            {side(sides[1])}
          </div>
        </div>
      </div>
    </Stage>
  );
}
