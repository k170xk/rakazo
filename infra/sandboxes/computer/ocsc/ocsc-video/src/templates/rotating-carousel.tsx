// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  list,
  mix,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "rotating-carousel",
  category: "content",
  description:
    "Cards circle slowly round a 3D carousel under a heading. Use it to present services, sectors or capabilities.",
  props: {
    title: 'string (default "Our services")',
    cards:
      'string[] (default ["Civil & Structural", "Building Services", "Transport", "Water"])',
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 8,
  media: "none",
  fits: "4-8 cards with labels of up to 3 words.",
  instead: "icon_list when each item needs a description.",
};

type Props = BrandProps & {
  title?: string;
  cards?: string[];
  dark?: boolean;
};

export default function RotatingCarousel(props: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const cards = list<unknown>(props.cards, [
    "Civil & Structural",
    "Building Services",
    "Transport",
    "Water",
  ])
    .slice(0, 8)
    .map((c, i) => str(c, `Service ${i + 1}`));
  const angle = (frame / fps) * 0.45;
  const radius = Math.min(220, stage.width / 2 - 100);
  const enter = spring({ frame, fps, config: { damping: 14, mass: 0.6 } });

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      <h2
        style={{
          position: "absolute",
          top: stage.vertical ? 140 : 40,
          left: 0,
          right: 0,
          textAlign: "center",
          color: dark ? p.onDark : p.text,
          fontSize: 29,
          fontWeight: 700,
          margin: 0,
          opacity: enter,
          transform: `translateY(${(1 - enter) * -20}px)`,
        }}
      >
        {str(props.title, "Our services")}
      </h2>
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: enter,
          transform: `scale(${0.85 + enter * 0.15})`,
        }}
      >
        {cards.map((label, i) => {
          const cardAngle = angle + (i * Math.PI * 2) / cards.length;
          const x = Math.sin(cardAngle) * radius;
          const normalizedZ = (Math.cos(cardAngle) + 1) / 2;
          const cardScale = interpolate(normalizedZ, [0, 1], [0.6, 1]);
          const cardOpacity = interpolate(normalizedZ, [0, 1], [0.3, 1]);

          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: stage.width / 2,
                top: stage.height / 2 + 20,
                transform: `translate(-50%, -50%) translateX(${x}px) scale(${cardScale})`,
                opacity: cardOpacity,
                zIndex: Math.round(normalizedZ * 100),
                width: 180,
                height: 220,
                boxSizing: "border-box",
                borderRadius: 16,
                background: dark
                  ? `linear-gradient(135deg, ${p.inkSoft}, ${mix(p.inkSoft, "#ffffff", 0.1)})`
                  : p.paper,
                border: `1px solid ${alpha(p.primary, dark ? 0.3 : 0.18)}`,
                boxShadow: dark ? "0 12px 30px rgba(0, 0, 0, 0.3)" : "0 10px 30px rgba(15, 23, 42, 0.08)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                padding: 24,
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: `linear-gradient(135deg, ${p.primary}, ${p.dark})`,
                  marginBottom: 16,
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  color: p.onDark,
                  fontSize: 18,
                  fontWeight: 700,
                }}
              >
                {i + 1}
              </div>
              <span
                style={{
                  color: dark ? p.onDark : p.text,
                  fontSize: 18,
                  fontWeight: 600,
                  textAlign: "center",
                  lineHeight: 1.2,
                }}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </Stage>
  );
}
