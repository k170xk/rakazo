// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  mix,
  num,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "particle-explosion",
  category: "content",
  description:
    "A short word or phrase pops in the centre as a ring of brand-green particles bursts out around it. Use it to celebrate a milestone, award or big number.",
  props: {
    text: 'string (default "Milestone reached")',
    particles: "number: how many particles, 30 to 300 (default 150)",
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 4,
  media: "none",
  fits: "A phrase of up to 3 words.",
  instead: "popping-text for one bold word.",
};

type Props = BrandProps & {
  text?: string;
  particles?: number;
  dark?: boolean;
};

export default function ParticleExplosion(props: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const count = Math.max(30, Math.min(300, Math.round(num(props.particles, 150))));
  const t = frame / fps;

  const particles = Array.from({ length: count }).map((_, i) => {
    const baseAngle = (i / count) * Math.PI * 2;
    const rotatingAngle = baseAngle + t * 0.6;
    const scale = spring({
      frame,
      fps,
      from: 0,
      to: random(`particle-size-${i}`) * 1.2 + 0.3,
      config: { mass: 0.3, damping: 12 },
    });
    const distance = spring({
      frame,
      fps,
      from: 0,
      to: 180 + random(`particle-distance-${i}`) * 40,
      config: { mass: 0.4, damping: 10 },
    });
    return {
      x: Math.cos(rotatingAngle) * distance,
      y: Math.sin(rotatingAngle) * distance,
      scale,
      color: mix(p.primary, dark ? p.lighter : p.light, i / count),
    };
  });
  const particleOpacity = interpolate(frame, [0, fps * 3], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const textScale = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      {particles.map((particle, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: stage.width / 2,
            top: stage.height / 2,
            transform: `translate(-50%, -50%) translate(${particle.x}px, ${particle.y}px) scale(${particle.scale})`,
            width: 12,
            height: 12,
            backgroundColor: particle.color,
            borderRadius: "50%",
            opacity: particleOpacity,
            boxShadow: `0 0 5px ${alpha(dark ? p.lighter : p.primary, dark ? 0.4 : 0.3)}`,
          }}
        />
      ))}
      <div
        style={{
          position: "absolute",
          left: stage.width / 2,
          top: stage.height / 2,
          width: stage.width - 60,
          transform: `translate(-50%, -50%) scale(${textScale})`,
          fontSize: 48,
          fontWeight: 800,
          lineHeight: 1.1,
          textAlign: "center",
          color: dark ? p.onDark : p.text,
          textShadow: dark ? "0 0 10px rgba(255, 255, 255, 0.5)" : "0 1px 18px rgba(255, 255, 255, 0.9)",
        }}
      >
        {str(props.text, "Milestone reached")}
      </div>
    </Stage>
  );
}
