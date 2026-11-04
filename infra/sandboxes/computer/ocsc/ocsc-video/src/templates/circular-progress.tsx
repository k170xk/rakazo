// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { useId } from "react";
import {
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  alpha,
  type BrandProps,
  num,
  palette,
  Stage,
  str,
  type TemplateMeta,
} from "./kit";

export const meta: TemplateMeta = {
  name: "circular-progress",
  category: "charts",
  description:
    "A progress ring that fills to a figure while the number counts up in the centre, gently pulsing once it lands. Use for a single completion or performance figure.",
  props: {
    value: "number (default 85)",
    max: 'number: the value of a full ring (default 100 when suffix is "%", otherwise the value itself)',
    prefix: 'string before the number, e.g. "€" (default "")',
    suffix: 'string after the number, e.g. "%" or "m" (default "%")',
    label: 'string under the ring, "" to hide (default "Detailed design complete")',
    dark: "boolean: dark OCSC background, false for a light one (default false: white)",
  },
  seconds: 5,
  media: "none",
  fits: "One percentage and a label of up to 4 words.",
  instead: "big_number or stat-counter for a figure that is not a percentage.",
};

type Props = BrandProps & {
  value?: number;
  max?: number;
  prefix?: string;
  suffix?: string;
  label?: string;
  dark?: boolean;
};

const decimalsOf = (n: number) =>
  Math.min(2, (String(n).split(".")[1] ?? "").length);

export default function CircularProgress(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const p = palette(props.brandColor);
  const id = useId().replace(/:/g, "");

  const dark = props.dark === true;
  const fg = dark ? p.onDark : p.text;
  const muted = dark ? p.onDarkMuted : p.textMuted;

  const target = num(props.value, 85);
  const prefix = str(props.prefix, "");
  const suffix = props.suffix === "" ? "" : str(props.suffix, "%");
  const max = Math.max(
    num(props.max, suffix === "%" ? 100 : target),
    1e-9,
  );
  const label =
    props.label === "" ? "" : str(props.label, "Detailed design complete");
  const decimals = decimalsOf(target);

  const appear = spring({ frame, fps, config: { damping: 14, mass: 0.6 } });
  const fill = Math.min(90, Math.max(45, durationInFrames * 0.45));
  const shown = interpolate(frame, [5, 5 + fill], [0, target], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const fraction = Math.max(0, Math.min(1, shown / max));

  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - fraction);

  // The dot rides the end of the arc.
  const angle = fraction * 2 * Math.PI;
  const dotX = 100 + radius * Math.sin(angle);
  const dotY = 100 - radius * Math.cos(angle);

  // The pulse only starts once the ring has filled.
  const settle = interpolate(frame, [5 + fill - 10, 5 + fill + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pulse = 1 + Math.sin(frame / 10) * 0.03 * settle;

  const labelOpacity = interpolate(frame, [15, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const text = `${prefix}${shown.toLocaleString("en-IE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${suffix}`;
  const finalLength = `${prefix}${target.toLocaleString("en-IE")}${suffix}`.length;
  const fontSize = Math.min(48, 190 / (finalLength * 0.62));

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
        }}
      >
        <div
          style={{
            position: "relative",
            width: 300,
            height: 300,
            transform: `scale(${appear * pulse})`,
          }}
        >
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 200 200"
            style={{ position: "absolute", inset: 0 }}
          >
            <defs>
              <linearGradient id={`${id}-ring`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={p.light} />
                <stop offset="100%" stopColor={p.dark} />
              </linearGradient>
            </defs>
            <circle
              cx="100"
              cy="100"
              r={radius}
              fill="none"
              stroke={dark ? "rgba(255, 255, 255, 0.1)" : alpha(p.text, 0.08)}
              strokeWidth="12"
            />
            <circle
              cx="100"
              cy="100"
              r={radius}
              fill="none"
              stroke={`url(#${id}-ring)`}
              strokeWidth="12"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              transform="rotate(-90 100 100)"
            />
            <circle
              cx={dotX}
              cy={dotY}
              r="8"
              fill={p.primary}
              stroke="white"
              strokeWidth="2"
              opacity={fraction > 0.01 ? 1 : 0}
              style={{ filter: `drop-shadow(0 0 6px ${alpha(p.primary, 0.8)})` }}
            />
          </svg>

          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              fontSize,
              fontWeight: "bold",
              color: fg,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {text}
          </div>
        </div>

        {label ? (
          <div
            style={{
              color: muted,
              fontSize: 24,
              fontWeight: 500,
              letterSpacing: "0.5px",
              textAlign: "center",
              maxWidth: 480,
              opacity: labelOpacity,
            }}
          >
            {label}
          </div>
        ) : null}
      </div>
    </Stage>
  );
}
