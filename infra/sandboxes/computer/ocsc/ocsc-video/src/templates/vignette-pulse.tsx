// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
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
  "https://images.pexels.com/photos/358549/pexels-photo-358549.jpeg?auto=compress&cs=tinysrgb&w=1920";

export const meta: TemplateMeta = {
  name: "vignette-pulse",
  category: "cinematic",
  description:
    "A dark vignette that gently breathes in and out around the edges of the frame. Best as an overlay to focus attention on the centre of a photo or video.",
  props: {
    imageUrl: `string: photo shown when used as a scene (default "${DEFAULT_IMAGE}", modern buildings)`,
    heading: 'string: shown when used as a scene (default "Focus on what matters")',
    subheading: 'string: shown when used as a scene (default "Engineering clarity from concept to completion")',
    strength: "number 0-1: average darkness at the edges (default 0.55)",
    pulse: "number 0-1: how far the darkness swings either way (default 0.25)",
    periodSeconds: "number: seconds per pulse (default 2)",
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 5,
  media: "photo, or an overlay on footage",
  fits: "A heading of up to 5 words when used as a scene.",
  instead: "Leave it off when the photo is already dark.",
  fullBleed: true,
  overlay: true,
};

type Props = BrandProps & {
  imageUrl?: string;
  heading?: string;
  subheading?: string;
  strength?: number;
  pulse?: number;
  periodSeconds?: number;
  dark?: boolean;
  /** Set by the overlay layer, so only the vignette is drawn. */
  asOverlay?: boolean;
};

export default function VignettePulse(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const strength = num(props.strength, 0.55);
  const pulse = num(props.pulse, 0.25);
  const period = Math.max(0.25, num(props.periodSeconds, 2));
  const fadeIn = interpolate(frame, [0, fps * 0.5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const vignette = Math.max(
    0,
    Math.min(1, (strength + pulse * Math.sin((frame / fps / period) * Math.PI * 2)) * fadeIn),
  );

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
              transform: `scale(${interpolate(frame, [0, durationInFrames], [1, 1.06], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              })})`,
            }}
          />
          <div
            style={{ position: "absolute", inset: 0, background: alpha(p.ink, dark ? 0.3 : 0.1) }}
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
              opacity: interpolate(frame, [5, 25], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            <div
              style={
                dark
                  ? { display: "contents" }
                  : {
                      maxWidth: stage.width - 80,
                      background: p.paper,
                      border: `1px solid ${alpha(p.primary, 0.18)}`,
                      borderRadius: 16,
                      boxShadow: "0 10px 30px rgba(15, 23, 42, 0.18)",
                      padding: stage.vertical ? "28px 28px" : "32px 44px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                    }
              }
            >
              <div
                style={{
                  color: dark ? p.onDark : p.text,
                  fontSize: stage.vertical ? 32 : 40,
                  fontWeight: 700,
                  lineHeight: 1.15,
                  textShadow: dark ? "0 4px 20px rgba(0, 0, 0, 0.4)" : undefined,
                }}
              >
                {str(props.heading, "Focus on what matters")}
              </div>
              {!dark && (
                <div
                  style={{
                    width: 60,
                    height: 3,
                    background: `linear-gradient(90deg, ${p.primary}, ${p.light})`,
                    borderRadius: 2,
                    margin: "14px 0 4px",
                  }}
                />
              )}
              <div
                style={{
                  color: dark ? p.lighter : p.textMuted,
                  fontSize: 18,
                  marginTop: 8,
                  lineHeight: 1.4,
                }}
              >
                {str(props.subheading, "Engineering clarity from concept to completion")}
              </div>
            </div>
          </div>
        </>
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at center, transparent 40%, rgba(0, 0, 0, ${vignette}) 100%)`,
          pointerEvents: "none",
        }}
      />
    </Stage>
  );
}
