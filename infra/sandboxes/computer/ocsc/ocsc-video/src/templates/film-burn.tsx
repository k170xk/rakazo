// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Img, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
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

const DEFAULT_IMAGE =
  "https://images.pexels.com/photos/17770160/pexels-photo-17770160.jpeg?auto=compress&cs=tinysrgb&w=1920";

export const meta: TemplateMeta = {
  name: "film-burn",
  category: "cinematic",
  description:
    "A warm, flickering film-burn light leak that swells and fades across the scene. Best as an overlay on a photo or video for a nostalgic or reflective moment, such as a project retrospective.",
  props: {
    imageUrl: `string: photo shown when used as a scene (default "${DEFAULT_IMAGE}", cranes at sunset)`,
    heading: 'string: shown when used as a scene (default "Designing for the long term")',
    subheading: 'string: shown when used as a scene (default "O\'Connor Sutton Cronin")',
    intensity: "number 0-1: peak strength of the light leak (default 0.85)",
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 4,
  media: "photo, or an overlay on footage",
  fits: "A heading of up to 6 words when used as a scene.",
  instead: "noise-grain for a subtler filmic texture.",
  fullBleed: true,
  overlay: true,
};

type Props = BrandProps & {
  imageUrl?: string;
  heading?: string;
  subheading?: string;
  intensity?: number;
  dark?: boolean;
  /** Set by the overlay layer, so only the light leak is drawn. */
  asOverlay?: boolean;
};

export default function FilmBurn(props: Props) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const peak = Math.max(0, Math.min(1, num(props.intensity, 0.85)));
  // Swells to a peak half way through the scene, then burns away.
  const envelope = interpolate(
    frame,
    [0, durationInFrames * 0.5, durationInFrames - 1],
    [0, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  // Smoothed deterministic flicker, like light through a projector gate.
  const step = frame / 4;
  const i = Math.floor(step);
  const a = random(`film-burn-${i}`);
  const b = random(`film-burn-${i + 1}`);
  const flicker = 0.88 + 0.24 * (a + (b - a) * (step - i));
  const intensity = envelope * peak * flicker;

  const orange = mix("#f97316", p.primary, 0.12);
  const amber = mix("#fbbf24", p.primary, 0.18);

  const x1 = 50 + Math.sin(frame * 0.05) * 30;
  const y1 = 50 + Math.cos(frame * 0.04) * 20;
  const x2 = 50 + Math.sin(frame * 0.07 + 2) * 25;
  const y2 = 50 + Math.cos(frame * 0.06 + 1) * 30;
  const x3 = 50 + Math.sin(frame * 0.03 + 4) * 20;
  const y3 = 50 + Math.cos(frame * 0.08 + 3) * 15;
  const edgeY = 30 + Math.sin(frame * 0.035) * 25;

  const layer = {
    position: "absolute",
    inset: 0,
    mixBlendMode: "screen",
    pointerEvents: "none",
  } as const;

  const heading = str(props.heading, "Designing for the long term");
  const subheading = str(props.subheading, "O'Connor Sutton Cronin");

  return (
    <Stage background={props.asOverlay ? undefined : dark ? "#000000" : p.paper}>
      {!props.asOverlay && (
        <>
          <Img
            src={str(props.imageUrl, DEFAULT_IMAGE)}
            style={{
              position: "absolute",
              inset: 0,
              width: stage.width,
              height: stage.height,
              objectFit: "cover",
              transform: `scale(${interpolate(frame, [0, durationInFrames], [1.04, 1.1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              })})`,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: alpha(p.ink, dark ? 0.45 : 0.15),
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              padding: "0 40px",
              textAlign: "center",
              opacity: interpolate(frame, [0, 20], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            {dark ? (
              <>
                <div
                  style={{
                    color: p.onDark,
                    fontSize: stage.vertical ? 32 : 40,
                    fontWeight: 700,
                    lineHeight: 1.15,
                  }}
                >
                  {heading}
                </div>
                <div style={{ color: p.lighter, fontSize: 18, marginTop: 8 }}>
                  {subheading}
                </div>
              </>
            ) : (
              <div
                style={{
                  maxWidth: stage.width - 80,
                  background: p.paper,
                  border: `1px solid ${alpha(p.primary, 0.18)}`,
                  borderRadius: 16,
                  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.18)",
                  padding: stage.vertical ? "28px 28px" : "32px 44px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    color: p.text,
                    fontSize: stage.vertical ? 32 : 40,
                    fontWeight: 700,
                    lineHeight: 1.15,
                  }}
                >
                  {heading}
                </div>
                <div
                  style={{
                    width: 60,
                    height: 3,
                    background: `linear-gradient(90deg, ${p.primary}, ${p.light})`,
                    borderRadius: 2,
                    margin: "14px 0 12px",
                  }}
                />
                <div style={{ color: p.textMuted, fontSize: 18 }}>{subheading}</div>
              </div>
            )}
          </div>
        </>
      )}

      <div
        style={{
          ...layer,
          background: `radial-gradient(circle at ${x1}% ${y1}%, ${alpha(orange, intensity * 0.7)}, transparent 60%)`,
        }}
      />
      <div
        style={{
          ...layer,
          background: `radial-gradient(circle at ${x2}% ${y2}%, ${alpha(amber, intensity * 0.5)}, transparent 50%)`,
        }}
      />
      <div
        style={{
          ...layer,
          background: `radial-gradient(circle at ${x3}% ${y3}%, rgba(255, 255, 255, ${intensity * 0.3}), transparent 40%)`,
        }}
      />
      <div
        style={{
          ...layer,
          background: `radial-gradient(ellipse at 0% ${edgeY}%, ${alpha(orange, intensity * 0.6)}, transparent 55%)`,
        }}
      />
    </Stage>
  );
}
