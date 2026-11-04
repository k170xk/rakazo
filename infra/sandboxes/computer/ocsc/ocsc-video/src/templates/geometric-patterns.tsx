// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  num,
  type Palette,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "geometric-patterns",
  category: "background",
  description:
    "Nested outlined shapes, from squares to circles, spiral into place and keep turning slowly on white (or the dark OCSC background). Use it behind a section title or statement.",
  props: {
    heading: 'string: centred over the background, empty for none (default "")',
    subheading: 'string: under the heading, empty for none (default "")',
    count: "number: how many shapes, 5 to 30 (default 20)",
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 6,
  media: "none",
  fits: "A heading of up to 6 words and a short subheading.",
  instead: "grid-pulse for a technical feel; bokeh-circles for a softer one.",
};

type Props = BrandProps & {
  heading?: string;
  subheading?: string;
  count?: number;
  dark?: boolean;
};

function Heading({
  heading,
  subheading,
  p,
  dark,
}: {
  heading: string;
  subheading: string;
  p: Palette;
  dark: boolean;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stage = useStage();
  if (!heading && !subheading) return null;
  const enter = spring({ frame: frame - 8, fps, config: { damping: 16, mass: 0.7 } });
  const shadow = dark ? `0 2px 24px ${alpha(p.ink, 0.8)}` : "0 1px 18px rgba(255, 255, 255, 0.9)";
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: "0 40px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        opacity: enter,
        transform: `translateY(${(1 - enter) * 24}px)`,
      }}
    >
      {heading ? (
        <div
          style={{
            color: dark ? p.onDark : p.text,
            fontSize: stage.vertical ? 40 : 52,
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: "-0.01em",
            textShadow: shadow,
          }}
        >
          {heading}
        </div>
      ) : null}
      {subheading ? (
        <div
          style={{
            color: dark ? p.lighter : p.textMuted,
            fontSize: stage.vertical ? 18 : 22,
            fontWeight: 500,
            marginTop: heading ? 14 : 0,
            letterSpacing: "0.02em",
            textShadow: shadow,
          }}
        >
          {subheading}
        </div>
      ) : null}
    </div>
  );
}

export default function GeometricPatterns(props: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { width, height } = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const count = Math.max(5, Math.min(30, Math.round(num(props.count, 20))));
  const t = frame / fps;

  return (
    <Stage background={dark ? `linear-gradient(45deg, ${p.ink}, ${p.inkSoft})` : p.lightGradient}>
      {Array.from({ length: count }).map((_, i) => {
        const rotation = spring({
          frame: frame - i * 3,
          fps,
          from: 0,
          to: 360,
          config: { damping: 100 },
        });
        const scale = spring({
          frame: frame - i * 3,
          fps,
          from: 0.5,
          to: 1,
          config: { damping: 100 },
        });
        // A slow, alternating drift once the spiral has settled.
        const drift = t * 3 * (i % 2 === 0 ? 1 : -1);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: width / 2,
              top: height / 2,
              width,
              height,
              boxSizing: "border-box",
              transform: `translate(-50%, -50%) rotate(${rotation + drift}deg) scale(${scale})`,
              border: `2px solid ${
                dark
                  ? i % 3 === 0
                    ? alpha(p.primary, 0.22)
                    : "rgba(255, 255, 255, 0.08)"
                  : alpha(p.primary, i % 3 === 0 ? 0.4 : 0.14)
              }`,
              borderRadius: `${i * 5}%`,
            }}
          />
        );
      })}
      <Heading heading={str(props.heading, "")} subheading={str(props.subheading, "")} p={p} dark={dark} />
    </Stage>
  );
}
