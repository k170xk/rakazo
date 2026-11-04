// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  mix,
  num,
  type Palette,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "starfield",
  category: "background",
  description:
    "Points stream gently outward from the centre, as if moving forward through space: green specks on white, or points of light on deep green when dark. Use it behind a vision statement, future-focused title or intro.",
  props: {
    heading: 'string: centred over the background, empty for none (default "")',
    subheading: 'string: under the heading, empty for none (default "")',
    count: "number: how many stars, 20 to 200 (default 80)",
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 6,
  media: "none",
  fits: "A heading of up to 6 words and a short subheading.",
  instead: "Use it mostly for vision and future-focused messages.",
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

export default function Starfield(props: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { width, height } = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const cx = width / 2;
  const cy = height / 2;
  const totalStars = Math.max(20, Math.min(200, Math.round(num(props.count, 80))));
  const cycleLength = fps * 5;
  const maxRadius = Math.max(cx, cy) * 1.2;

  const stars = Array.from({ length: totalStars }, (_, i) => {
    const seedAngle = ((i * 137.508) % 360) * (Math.PI / 180);
    const seedRadius = ((i * 31 + 17) % 50) / 50;
    const speed = 0.5 + ((i * 7 + 3) % 10) / 10;
    const baseSize = 1 + ((i * 13 + 5) % 3);
    const progress = ((frame * speed + i * 15) % cycleLength) / cycleLength;
    const radius = seedRadius * 20 + progress * maxRadius;
    return {
      x: cx + Math.cos(seedAngle) * radius,
      y: cy + Math.sin(seedAngle) * radius,
      size: baseSize * (1 + progress * 2),
      opacity: Math.min(progress * 4, 1) * Math.max(1 - progress * 0.8, 0.2),
      color: dark
        ? i % 4 === 0
          ? p.light
          : mix("#ffffff", p.lighter, 0.5)
        : i % 4 === 0
          ? p.primary
          : p.light,
    };
  });

  return (
    <Stage
      background={
        dark
          ? `radial-gradient(circle at center, ${p.inkSoft} 0%, ${p.ink} 75%)`
          : p.paper
      }
    >
      {stars.map((star, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: star.x,
            top: star.y,
            width: star.size,
            height: star.size,
            borderRadius: "50%",
            backgroundColor: star.color,
            opacity: star.opacity,
            transform: "translate(-50%, -50%)",
          }}
        />
      ))}
      <Heading heading={str(props.heading, "")} subheading={str(props.subheading, "")} p={p} dark={dark} />
    </Stage>
  );
}
