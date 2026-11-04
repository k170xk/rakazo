// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
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

const DEFAULT_IMAGE =
  "https://images.pexels.com/photos/5504388/pexels-photo-5504388.jpeg?auto=compress&cs=tinysrgb&w=1920";

export const meta: TemplateMeta = {
  name: "camera-shake",
  category: "cinematic",
  description:
    "A photo with a heading card, hit by a camera shake that settles over the scene. Use it for a high-impact moment such as a milestone, a completion or a big announcement.",
  props: {
    imageUrl: `string (default "${DEFAULT_IMAGE}", tower cranes)`,
    heading: 'string (default "Built to last")',
    subheading: 'string (default "Structural engineering across Ireland and the UK")',
    intensity: "number: starting shake in stage px, decays to 0 (default 15)",
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 4,
  media: "photo",
  fits: "A heading of up to 4 words.",
  instead: "particle-explosion to celebrate without a photo; ken-burns for a calm photo.",
  fullBleed: true,
};

type Props = BrandProps & {
  imageUrl?: string;
  heading?: string;
  subheading?: string;
  intensity?: number;
  dark?: boolean;
};

export default function CameraShake(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const intensity = Math.max(0, num(props.intensity, 15));
  const amplitude = interpolate(frame, [0, durationInFrames], [intensity, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Several frequencies so the shake feels organic rather than a clean wobble.
  const shakeX = Math.sin(frame * 0.8) * amplitude + Math.sin(frame * 2.3) * amplitude * 0.3;
  const shakeY = Math.cos(frame * 1.1) * amplitude + Math.cos(frame * 1.9) * amplitude * 0.25;
  const tilt = Math.sin(frame * 0.6) * amplitude * 0.03;
  // Over-scales the photo so its edges never show while it shakes.
  const cover = 1 + (intensity * 3) / Math.min(stage.width, stage.height);

  const card = spring({ frame, fps, config: { damping: 14, mass: 0.7 } });

  return (
    <Stage background={dark ? "#000000" : p.paper}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translate(${shakeX}px, ${shakeY}px) rotate(${tilt}deg)`,
        }}
      >
        <Img
          src={str(props.imageUrl, DEFAULT_IMAGE)}
          style={{
            position: "absolute",
            inset: 0,
            width: stage.width,
            height: stage.height,
            objectFit: "cover",
            transform: `scale(${cover})`,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: dark
              ? `linear-gradient(180deg, ${alpha(p.ink, 0.2)}, ${alpha(p.ink, 0.6)})`
              : `linear-gradient(180deg, ${alpha(p.ink, 0.05)}, ${alpha(p.ink, 0.25)})`,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            style={{
              maxWidth: stage.width - 60,
              background: dark ? alpha(p.ink, 0.72) : p.paper,
              border: `1px solid ${alpha(p.primary, dark ? 0.35 : 0.18)}`,
              borderRadius: 16,
              padding: stage.vertical ? "32px 28px" : "40px 48px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              boxShadow: dark
                ? `0 0 40px ${alpha(p.primary, 0.15)}`
                : "0 10px 30px rgba(15, 23, 42, 0.18)",
              opacity: card,
              transform: `scale(${0.9 + 0.1 * card})`,
            }}
          >
            <div
              style={{
                color: dark ? p.onDark : p.text,
                fontSize: stage.vertical ? 38 : 56,
                fontWeight: 800,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                textAlign: "center",
                lineHeight: 1.1,
              }}
            >
              {str(props.heading, "Built to last")}
            </div>
            <div
              style={{
                width: 60,
                height: 3,
                background: `linear-gradient(90deg, ${p.primary}, ${p.light})`,
                margin: "16px 0",
                borderRadius: 2,
              }}
            />
            <div
              style={{
                color: dark ? p.lighter : p.textMuted,
                fontSize: 18,
                textAlign: "center",
                lineHeight: 1.4,
              }}
            >
              {str(props.subheading, "Structural engineering across Ireland and the UK")}
            </div>
          </div>
        </div>
      </div>
    </Stage>
  );
}
