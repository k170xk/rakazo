// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Easing, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
  OCSC_SECTORS,
} from "./kit";

const DEFAULT_IMAGE =
  "https://images.pexels.com/photos/3862384/pexels-photo-3862384.jpeg?auto=compress&cs=tinysrgb&w=1920";

export const meta: TemplateMeta = {
  name: "spotlight-reveal",
  category: "cinematic",
  description:
    "A circle of light grows from the centre of a white frame (black in the dark version) to reveal a photo and a title, with a green glow at its edge. Use it to unveil a project, a design or a key image.",
  props: {
    imageUrl: `string (default "${DEFAULT_IMAGE}", engineers with drawings)`,
    heading: 'string (default "Project unveiled")',
    subheading: 'string (default "Civil · Structural · Mechanical · Electrical · Environmental · Sustainability · BIM")',
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 4,
  media: "photo",
  fits: "A heading of up to 4 words and a subheading.",
  instead: "image-zoom-reveal for a quieter reveal.",
  fullBleed: true,
};

type Props = BrandProps & {
  imageUrl?: string;
  heading?: string;
  subheading?: string;
  dark?: boolean;
};

export default function SpotlightReveal(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const revealEnd = Math.max(10, Math.min(durationInFrames * 0.8, fps * 2.5));
  // Ends a little past the corners so the whole frame is lit.
  const maxRadius = (Math.hypot(stage.width, stage.height) / 2) * 1.05;
  const radius = interpolate(frame, [0, revealEnd], [0, maxRadius], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const glowOpacity = interpolate(frame, [0, revealEnd * 0.375, revealEnd], [0, 0.6, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const photoScale = interpolate(frame, [0, durationInFrames], [1.1, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const accent = {
    width: 80,
    height: 4,
    borderRadius: 2,
  } as const;

  return (
    <Stage background={dark ? "#0a0a0a" : p.lightGradient}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          clipPath: `circle(${radius}px at 50% 50%)`,
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
            transform: `scale(${photoScale})`,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: dark
              ? `radial-gradient(ellipse at center, ${alpha(p.ink, 0.35)}, ${alpha(p.ink, 0.75)})`
              : `radial-gradient(ellipse at center, ${alpha(p.ink, 0.05)}, ${alpha(p.ink, 0.25)})`,
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
                    padding: stage.vertical ? "28px 28px" : "32px 48px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                  }
            }
          >
            <div
              style={{
                ...accent,
                background: `linear-gradient(90deg, ${p.primary}, ${p.light})`,
                marginBottom: 24,
              }}
            />
            <div
              style={{
                color: dark ? p.onDark : p.text,
                fontSize: stage.vertical ? 36 : 56,
                fontWeight: 800,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                lineHeight: 1.15,
              }}
            >
              {str(props.heading, "Project unveiled")}
            </div>
            <div
              style={{
                color: dark ? p.lighter : p.textMuted,
                fontSize: 18,
                marginTop: 12,
                lineHeight: 1.4,
              }}
            >
              {str(props.subheading, OCSC_SECTORS)}
            </div>
            <div
              style={{
                ...accent,
                background: `linear-gradient(90deg, ${p.light}, ${p.primary})`,
                marginTop: 24,
              }}
            />
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at 50% 50%, transparent ${Math.max(0, radius - 10)}px, ${alpha(p.primary, glowOpacity)} ${radius}px, transparent ${radius + 16}px)`,
          pointerEvents: "none",
        }}
      />
    </Stage>
  );
}
