// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "title-split",
  category: "intro",
  description:
    "Two words slide in from above and below to meet in the middle, an outlined word over a solid one, then glow green. Use for a punchy two-word title such as a service or project name.",
  props: {
    top: 'string: the outlined top word (default "ENGINEERING")',
    bottom: 'string: the solid bottom word (default "EXCELLENCE")',
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 4,
  media: "none",
  fits: "Two words.",
  instead: "animated-text or slide-text for a longer title.",
};

type Props = BrandProps & {
  top?: string;
  bottom?: string;
  dark?: boolean;
};

export default function TitleSplit(props: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const meet = spring({ frame, fps, config: { damping: 14, stiffness: 80 } });
  const topY = interpolate(meet, [0, 1], [-120, 0]);
  const bottomY = interpolate(meet, [0, 1], [120, 0]);
  const glowOpacity = interpolate(Math.sin(frame * 0.1), [-1, 1], [0.3, 0.8]);
  const glowIn = interpolate(frame, [15, 25], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const glow = glowOpacity * glowIn;
  const textShadow = dark
    ? `0 0 ${20 * glow}px ${alpha(p.primary, glow)}`
    : `0 ${6 * glow}px ${20 * glow}px ${alpha(p.primary, glow * 0.6)}`;

  const top = str(props.top, "ENGINEERING");
  const bottom = str(props.bottom, "EXCELLENCE");
  const longest = Math.max(top.length, bottom.length);
  // Shrinks long words so they still fit the stage width with 0.15em tracking.
  const fontSize = Math.min(80, (stage.width - 60) / (longest * 0.82));

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
          gap: 4,
          textAlign: "center",
        }}
      >
        <h1
          style={{
            color: "transparent",
            fontSize,
            fontWeight: 800,
            margin: 0,
            lineHeight: 1.15,
            letterSpacing: "0.15em",
            WebkitTextStroke: `2px ${dark ? "white" : p.text}`,
            transform: `translateY(${topY}px)`,
            opacity: meet,
            textShadow,
          }}
        >
          {top}
        </h1>
        <h1
          style={{
            color: dark ? p.onDark : p.text,
            fontSize,
            fontWeight: 800,
            margin: 0,
            lineHeight: 1.15,
            letterSpacing: "0.15em",
            transform: `translateY(${bottomY}px)`,
            opacity: meet,
            textShadow,
          }}
        >
          {bottom}
        </h1>
      </div>
    </Stage>
  );
}
