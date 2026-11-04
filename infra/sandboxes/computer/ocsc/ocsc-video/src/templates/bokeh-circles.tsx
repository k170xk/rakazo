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
  name: "bokeh-circles",
  category: "background",
  description:
    "Soft out-of-focus green lights drift and pulse on white (or the dark OCSC background). Use it behind a title or as a calm backdrop between scenes.",
  props: {
    heading: 'string: centred over the background, empty for none (default "")',
    subheading: 'string: under the heading, empty for none (default "")',
    count: "number: how many lights, 5 to 40 (default 15)",
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 6,
  media: "none",
  fits: "A heading of up to 6 words and a short subheading.",
  instead: "fullscreen_text for a statement with no background motion.",
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

export default function BokehCircles(props: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { width, height } = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const t = frame / fps;
  const count = Math.max(5, Math.min(40, Math.round(num(props.count, 15))));
  // p.lighter all but vanishes on white, so the light version uses the stronger greens.
  const colors = dark ? [p.primary, p.light, p.lighter] : [p.light, p.primary, p.light];

  const circles = Array.from({ length: count }, (_, i) => {
    const baseX = ((i * 173 + 53) % 100) / 100;
    const baseY = ((i * 241 + 97) % 100) / 100;
    const driftX = Math.sin(t * 0.2 + i * 1.3) * 30;
    const driftY = Math.cos(t * 0.15 + i * 0.9) * 25;
    const baseSize = 40 + ((i * 37 + 11) % 80);
    const pulse = Math.sin(t * 0.4 + i * 0.7) * 0.2 + 1;
    const opacity = 0.1 + ((i * 19 + 7) % 20) / 100;
    return {
      x: baseX * width + driftX,
      y: baseY * height + driftY,
      size: baseSize * pulse,
      opacity,
      color: colors[i % colors.length],
    };
  });

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      {circles.map((circle, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: circle.x,
            top: circle.y,
            width: circle.size,
            height: circle.size,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${alpha(circle.color, circle.opacity + 0.1)} 0%, ${alpha(circle.color, 0)} 100%)`,
            transform: "translate(-50%, -50%)",
          }}
        />
      ))}
      <Heading heading={str(props.heading, "")} subheading={str(props.subheading, "")} p={p} dark={dark} />
    </Stage>
  );
}
