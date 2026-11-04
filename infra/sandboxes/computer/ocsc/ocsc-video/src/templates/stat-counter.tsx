// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import {
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  type BrandProps,
  num,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "stat-counter",
  category: "charts",
  description:
    "One big number that springs in and counts up, with a label and an optional change figure underneath. Use to land a single headline statistic.",
  props: {
    value: "number (default 1250)",
    prefix: 'string before the number, e.g. "€" (default "")',
    suffix: 'string after the number, e.g. "%", "m" or "+" (default "")',
    label: 'string (default "Projects delivered")',
    change: 'string, "" to hide (default "↑ 12%")',
    changeLabel: 'string beside the change (default "on last year")',
    trend: '"up" | "down": colours the change brand green or red (default "up")',
    dark: "boolean: dark OCSC background, false for a light one (default false: white)",
  },
  seconds: 5,
  media: "none",
  fits: "One figure, a label of up to 4 words and an optional change figure.",
  instead: "big_number for a static figure; stats for several.",
};

type Props = BrandProps & {
  value?: number;
  prefix?: string;
  suffix?: string;
  label?: string;
  change?: string;
  changeLabel?: string;
  trend?: "up" | "down";
  dark?: boolean;
};

const decimalsOf = (n: number) =>
  Math.min(2, (String(n).split(".")[1] ?? "").length);

export default function StatCounter(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);

  const dark = props.dark === true;
  const fg = dark ? p.onDark : p.text;
  const muted = dark ? p.onDarkMuted : p.textMuted;

  const target = num(props.value, 1250);
  const prefix = str(props.prefix, "");
  const suffix = str(props.suffix, "");
  const label = str(props.label, "Projects delivered");
  const change = props.change === "" ? "" : str(props.change, "↑ 12%");
  const changeLabel =
    props.changeLabel === "" ? "" : str(props.changeLabel, "on last year");
  const changeColor = props.trend === "down" ? "#ef4444" : p.primary;
  const decimals = decimalsOf(target);

  const scaleSpring = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 100 },
  });

  const countEnd = Math.min(105, Math.max(50, durationInFrames * 0.45));
  const count = interpolate(frame, [10, countEnd], [0, target], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const subStatsOpacity = interpolate(
    frame,
    [countEnd - 15, countEnd],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // A slow push-in while the figure holds.
  const drift = interpolate(frame, [0, durationInFrames], [1, 1.03], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const text = `${prefix}${count.toLocaleString("en-IE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${suffix}`;
  const finalLength = `${prefix}${target.toLocaleString("en-IE")}${suffix}`.length;
  const maxWidth = stage.width - 120;
  const padX = stage.vertical ? 40 : 80;
  const fontSize = Math.min(96, (maxWidth - padX * 2) / (finalLength * 0.62));

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
            maxWidth,
            boxSizing: "border-box",
            backgroundColor: dark ? "rgba(0, 0, 0, 0.2)" : p.paper,
            borderRadius: 16,
            boxShadow: dark
              ? "0 10px 30px rgba(0, 0, 0, 0.3)"
              : "0 10px 30px rgba(0, 0, 0, 0.08)",
            padding: `${stage.vertical ? 50 : 60}px ${padX}px`,
            textAlign: "center",
            transform: `scale(${scaleSpring * drift})`,
          }}
        >
          <div
            style={{
              fontSize,
              fontWeight: "bold",
              color: fg,
              textShadow: dark ? "0 4px 8px rgba(0, 0, 0, 0.3)" : undefined,
              letterSpacing: "-2px",
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {text}
          </div>

          <div
            style={{
              fontSize: 24,
              color: muted,
              marginTop: 12,
              fontWeight: 500,
              letterSpacing: "1px",
            }}
          >
            {label}
          </div>

          {change || changeLabel ? (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                flexWrap: "wrap",
                gap: "6px 30px",
                marginTop: 30,
                opacity: subStatsOpacity,
              }}
            >
              {change ? (
                <span style={{ color: changeColor, fontSize: 18, fontWeight: 600 }}>
                  {change}
                </span>
              ) : null}
              {changeLabel ? (
                <span
                  style={{
                    color: dark ? "rgba(255, 255, 255, 0.5)" : p.textMuted,
                    fontSize: 18,
                    fontWeight: 400,
                  }}
                >
                  {changeLabel}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Stage>
  );
}
