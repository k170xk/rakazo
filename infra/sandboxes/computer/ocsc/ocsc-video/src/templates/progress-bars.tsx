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
  name: "progress-bars",
  category: "charts",
  description:
    "A stack of labelled horizontal bars that fill one after another while their figures count up. Use for progress by stage or workstream, or any short ranked list of percentages.",
  props: {
    title: 'string (default "Programme progress")',
    data: '{label: string, value: number}[] (default [{label: "Site investigation", value: 100}, {label: "Detailed design", value: 85}, {label: "Planning consent", value: 70}, {label: "Construction", value: 45}, {label: "Commissioning", value: 15}])',
    prefix: 'string before each figure, e.g. "€" (default "")',
    suffix: 'string after each figure, e.g. "%" or "m" (default "%")',
    max: 'number: the value of a full bar (default 100 when suffix is "%", otherwise the largest value)',
    dark: "boolean: dark OCSC background, false for a light one (default false: white)",
  },
  seconds: 6,
  media: "none",
  fits: "3-6 bars with labels of up to 3 words.",
  instead: "stats for figures that are not percentages.",
};

type Datum = { label?: string; value?: number | string };

type Props = BrandProps & {
  title?: string;
  data?: Datum[];
  prefix?: string;
  suffix?: string;
  max?: number;
  dark?: boolean;
};

const DEFAULT_DATA: Datum[] = [
  { label: "Site investigation", value: 100 },
  { label: "Detailed design", value: 85 },
  { label: "Planning consent", value: 70 },
  { label: "Construction", value: 45 },
  { label: "Commissioning", value: 15 },
];

const decimalsOf = (n: number) =>
  Math.min(2, (String(n).split(".")[1] ?? "").length);

export default function ProgressBars(props: Props) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);

  const dark = props.dark === true;
  const fg = dark ? p.onDark : p.text;
  const muted = dark ? p.onDarkMuted : p.textMuted;

  const title = str(props.title, "Programme progress");
  const prefix = str(props.prefix, "");
  const suffix = props.suffix === "" ? "" : str(props.suffix, "%");
  const items = list<Datum>(props.data, DEFAULT_DATA).map((d) => ({
    label: str(d?.label, ""),
    value: num(d?.value, 0),
  }));
  const n = items.length;
  const largest = Math.max(...items.map((s) => s.value));
  const max = Math.max(
    num(props.max, suffix === "%" ? 100 : largest),
    largest,
    1e-9,
  );
  const decimals = Math.max(...items.map((s) => decimalsOf(s.value)));

  // Squeeze the rows a little when there are many, so the card still fits the frame.
  const rowGap = n > 6 ? 12 : 22;
  const barHeight = n > 6 ? 10 : 14;

  const fill = 20;
  const enter = Math.min(70, Math.max(36, durationInFrames * 0.4));
  const stagger = n > 1 ? Math.min(8, (enter - fill - 5) / (n - 1)) : 0;

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
            padding: stage.vertical ? "36px 30px" : "40px 50px",
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
              marginBottom: n > 6 ? 24 : 35,
              textAlign: "center",
            }}
          >
            {title}
          </div>

          {items.map((item, i) => {
            const shown = interpolate(
              frame,
              [5 + i * stagger, 5 + fill + i * stagger],
              [0, item.value],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.out(Easing.cubic),
              },
            );
            const labelOpacity = interpolate(
              frame,
              [i * stagger, 5 + i * stagger],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
            const width = Math.max(0, Math.min(100, (shown / max) * 100));

            return (
              <div
                key={`item-${i}`}
                style={{
                  marginBottom: i < n - 1 ? rowGap : 0,
                  opacity: labelOpacity,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 16,
                    marginBottom: 8,
                  }}
                >
                  <span style={{ color: fg, fontSize: 16, fontWeight: 600 }}>
                    {item.label}
                  </span>
                  <span
                    style={{
                      color: muted,
                      fontSize: 16,
                      fontWeight: 500,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {prefix}
                    {shown.toLocaleString("en-IE", {
                      minimumFractionDigits: decimals,
                      maximumFractionDigits: decimals,
                    })}
                    {suffix}
                  </span>
                </div>

                <div
                  style={{
                    width: "100%",
                    height: barHeight,
                    backgroundColor: dark
                      ? "rgba(255, 255, 255, 0.1)"
                      : alpha(p.text, 0.08),
                    borderRadius: barHeight / 2,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${width}%`,
                      height: "100%",
                      background: `linear-gradient(90deg, ${p.dark}, ${p.primary})`,
                      borderRadius: barHeight / 2,
                      boxShadow: `0 0 10px ${alpha(p.primary, 0.25)}`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Stage>
  );
}
