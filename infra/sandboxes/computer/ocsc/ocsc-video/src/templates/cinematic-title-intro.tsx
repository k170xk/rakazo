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
  name: "cinematic-title-intro",
  category: "intro",
  description:
    "A title that rises into place over a green underline, followed by a subtitle. Use as the opening title of a project film or showreel.",
  props: {
    title: 'string (default "Engineering Better Places")',
    subtitle: 'string (default "O\'Connor Sutton Cronin")',
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 5,
  media: "none",
  fits: "A title of up to 5 words and a subtitle.",
  instead: "title for the standard opening with the logo.",
};

type Props = BrandProps & {
  title?: string;
  subtitle?: string;
  dark?: boolean;
};

export default function CinematicTitleIntro(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const titleY = interpolate(
    spring({ frame, fps, durationInFrames: 40, config: { damping: 14, mass: 0.8 } }),
    [0, 1],
    [50, 0],
  );
  const titleOpacity = spring({ frame, fps, durationInFrames: 30 });
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const underlineWidth = interpolate(frame, [20, 50], [0, 100], clamp);
  const subtitleOpacity = interpolate(frame, [40, 60], [0, 1], clamp);
  const drift = interpolate(frame, [0, durationInFrames], [1, 1.05], clamp);

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 40,
          textAlign: "center",
          transform: `scale(${drift})`,
        }}
      >
        <h1
          style={{
            color: dark ? p.onDark : p.text,
            fontSize: stage.vertical ? 48 : 64,
            fontWeight: 700,
            lineHeight: 1.1,
            opacity: titleOpacity,
            transform: `translateY(${titleY}px)`,
            margin: 0,
            letterSpacing: "0.05em",
          }}
        >
          {str(props.title, "Engineering Better Places")}
        </h1>
        <div
          style={{
            width: `${underlineWidth}%`,
            maxWidth: 320,
            height: 4,
            background: `linear-gradient(90deg, ${p.primary}, ${p.light})`,
            borderRadius: 2,
            marginTop: 16,
          }}
        />
        <p
          style={{
            color: dark ? p.onDarkMuted : p.textMuted,
            fontSize: 24,
            fontWeight: 300,
            opacity: subtitleOpacity,
            marginTop: 24,
            marginBottom: 0,
            letterSpacing: "0.1em",
          }}
        >
          {str(props.subtitle, "O'Connor Sutton Cronin")}
        </p>
      </div>
    </Stage>
  );
}
