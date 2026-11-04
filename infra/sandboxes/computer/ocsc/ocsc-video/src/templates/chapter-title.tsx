// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  type BrandProps,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "chapter-title",
  category: "intro",
  description:
    "A large chapter number with a label and title between green rules. Use to open each section of a longer OCSC video, such as a project walkthrough.",
  props: {
    label: 'string (default "Chapter")',
    number: 'string (default "1")',
    title: 'string (default "The Brief")',
    dark: "boolean: dark OCSC background, or white when false (default false: white)",
  },
  seconds: 4,
  media: "none",
  fits: "A chapter number, a label and a title of up to 4 words.",
  instead: "section_header when the section needs a subheading or a photo.",
};

type Props = BrandProps & {
  label?: string;
  number?: string | number;
  title?: string;
  dark?: boolean;
};

export default function ChapterTitle(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const numberScale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 80 },
  });
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const subtitleOpacity = interpolate(frame, [20, 40], [0, 1], clamp);
  const subtitleY = interpolate(frame, [20, 40], [20, 0], clamp);
  const lineWidth = interpolate(frame, [10, 40], [0, stage.vertical ? 90 : 120], clamp);
  const labelOpacity = interpolate(frame, [5, 20], [0, 1], clamp);
  const drift = interpolate(frame, [40, durationInFrames], [1, 1.04], clamp);

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: 40,
          textAlign: "center",
          transform: `scale(${drift})`,
        }}
      >
        <p
          style={{
            color: dark ? p.onDarkMuted : p.textMuted,
            fontSize: 16,
            fontWeight: 500,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            margin: 0,
            marginBottom: 8,
            opacity: labelOpacity,
          }}
        >
          {str(props.label, "Chapter")}
        </p>
        <h1
          style={{
            color: dark ? p.onDark : p.text,
            fontSize: 128,
            fontWeight: 800,
            margin: 0,
            lineHeight: 1,
            transform: `scale(${numberScale})`,
          }}
        >
          {str(props.number, "1")}
        </h1>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            marginTop: 24,
            marginBottom: 16,
          }}
        >
          <div style={{ height: 1, width: lineWidth, backgroundColor: p.primary }} />
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              backgroundColor: p.primary,
              opacity: labelOpacity,
            }}
          />
          <div style={{ height: 1, width: lineWidth, backgroundColor: p.primary }} />
        </div>
        <p
          style={{
            color: dark ? p.lighter : p.text,
            fontSize: 24,
            fontWeight: 300,
            margin: 0,
            letterSpacing: "0.1em",
            opacity: subtitleOpacity,
            transform: `translateY(${subtitleY}px)`,
          }}
        >
          {str(props.title, "The Brief")}
        </p>
      </div>
    </Stage>
  );
}
