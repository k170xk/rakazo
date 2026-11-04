// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  type Palette,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "liquid-wave",
  category: "background",
  description:
    "A soft, blurred green wave rolls across the lower part of a white (or dark OCSC) background. Use it behind water, flood-risk or drainage content, or any calm title.",
  props: {
    heading: 'string: centred over the background, empty for none (default "")',
    subheading: 'string: under the heading, empty for none (default "")',
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 6,
  media: "none",
  fits: "A heading of up to 6 words and a short subheading.",
  instead: "Use it mostly for water, drainage and flood-risk topics.",
};

type Props = BrandProps & {
  heading?: string;
  subheading?: string;
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

export default function LiquidWave(props: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { width, height } = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const t = frame / fps;
  const numberOfPoints = 50;
  // The surface sits a little below centre so a heading reads above the brightest part.
  const wavePath = (base: number, amplitude: number, speed: number, phase: number) => {
    const points = Array.from({ length: numberOfPoints + 1 }).map((_, i) => {
      const x = (i / numberOfPoints) * width;
      const y = base + Math.sin(t * speed + i / 5 + phase) * amplitude;
      return `${x},${y}`;
    });
    return `M 0,${height} ${points.join(" ")} ${width},${height} Z`;
  };

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ position: "absolute", inset: 0 }}
      >
        <defs>
          <linearGradient id="ocsc-liquid-wave-fill" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={dark ? p.dark : p.lighter} />
            <stop offset="100%" stopColor={dark ? p.primary : p.light} />
          </linearGradient>
        </defs>
        <path
          d={wavePath(height * 0.6, 40, 1.1, 2)}
          fill={alpha(p.primary, dark ? 0.18 : 0.14)}
          style={{ filter: "blur(14px)" }}
        />
        <path
          d={wavePath(height * 0.66, 50, 1.5, 0)}
          fill="url(#ocsc-liquid-wave-fill)"
          opacity={dark ? 0.85 : 0.6}
          style={{ filter: "blur(10px)" }}
        />
      </svg>
      <Heading heading={str(props.heading, "")} subheading={str(props.subheading, "")} p={p} dark={dark} />
    </Stage>
  );
}
