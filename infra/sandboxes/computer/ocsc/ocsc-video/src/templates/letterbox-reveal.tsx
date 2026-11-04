// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Easing, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  num,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
  OCSC_SECTORS_TWO_LINES,
} from "./kit";

const DEFAULT_IMAGE =
  "https://images.pexels.com/photos/358549/pexels-photo-358549.jpeg?auto=compress&cs=tinysrgb&w=1920";

export const meta: TemplateMeta = {
  name: "letterbox-reveal",
  category: "cinematic",
  description:
    "Cinema bars (white, or black in the dark version) open from the centre to reveal a photo and a title in widescreen letterbox. Use it to open a film or introduce a project with a cinematic feel.",
  props: {
    imageUrl: `string (default "${DEFAULT_IMAGE}", modern buildings)`,
    heading: 'string (default "Shaping places")',
    subheading: 'string (default the OCSC sectors on two lines; \\n starts a new line)',
    barSize: "number: final height of each bar as a percentage of the frame (default 12)",
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 5,
  media: "photo",
  fits: "A heading of up to 3 words and a subheading.",
  instead: "title for a standard opening.",
  fullBleed: true,
};

type Props = BrandProps & {
  imageUrl?: string;
  heading?: string;
  subheading?: string;
  barSize?: number;
  dark?: boolean;
};

export default function LetterboxReveal(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const barSize = Math.max(0, Math.min(40, num(props.barSize, 12)));
  const barHeight = interpolate(frame, [0, fps * 2], [50, barSize], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const contentOpacity = interpolate(frame, [fps * 0.5, fps * 1.5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const photoScale = interpolate(frame, [0, durationInFrames], [1.12, 1.02], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const bar = {
    position: "absolute",
    left: 0,
    width: "100%",
    height: `${barHeight}%`,
    backgroundColor: dark ? "#000000" : p.paper,
  } as const;

  const heading = str(props.heading, "Shaping places");
  const subheading = str(props.subheading, OCSC_SECTORS_TWO_LINES);

  return (
    <Stage background={dark ? "#000000" : p.paper}>
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
        style={{ position: "absolute", inset: 0, background: alpha(p.ink, dark ? 0.4 : 0.12) }}
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
          opacity: contentOpacity,
        }}
      >
        {dark ? (
          <>
            <div
              style={{
                color: p.onDark,
                fontSize: stage.vertical ? 36 : 56,
                fontWeight: 800,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                lineHeight: 1.15,
                textShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
              }}
            >
              {heading}
            </div>
            <div
              style={{
                color: p.lighter,
                fontSize: stage.vertical ? 16 : 19,
                marginTop: 16,
                letterSpacing: "0.15em",
                lineHeight: 1.4,
                whiteSpace: "pre-line",
              }}
            >
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
              padding: stage.vertical ? "28px 28px" : "34px 48px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <div
              style={{
                color: p.text,
                fontSize: stage.vertical ? 36 : 56,
                fontWeight: 800,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
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
                margin: "16px 0 14px",
              }}
            />
            <div
              style={{
                color: p.textMuted,
                fontSize: stage.vertical ? 16 : 19,
                letterSpacing: "0.15em",
                lineHeight: 1.4,
                whiteSpace: "pre-line",
              }}
            >
              {subheading}
            </div>
          </div>
        )}
      </div>
      <div style={{ ...bar, top: 0 }} />
      <div style={{ ...bar, bottom: 0 }} />
    </Stage>
  );
}
