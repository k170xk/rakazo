// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import type { CSSProperties } from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  palette,
  Stage,
  str,
  type TemplateMeta,
} from "./kit";

export const meta: TemplateMeta = {
  name: "card-flip",
  category: "content",
  description:
    "A card spins in showing one message, then flips over to reveal a second. Use it for before/after, challenge/solution or question/answer beats.",
  props: {
    frontTitle: 'string (default "Every discipline")',
    frontText: 'string (default "Civil, structural, MEP, environmental and BIM")',
    backTitle: 'string (default "One team")',
    backText: 'string (default "From brief to handover")',
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 5,
  media: "none",
  fits: "A title of up to 3 words and one line on each side.",
  instead: "comparison for several points a side.",
};

type Props = BrandProps & {
  frontTitle?: string;
  frontText?: string;
  backTitle?: string;
  backText?: string;
  dark?: boolean;
};

export default function CardFlip(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  // Spins in on entry like the original, then flips to the back side and holds there.
  const flipAt = Math.max(fps * 1.5, Math.round(durationInFrames * 0.45));
  const config = { damping: 15, mass: 0.5 };
  const rotation =
    spring({ frame, fps, from: 0, to: 360, config }) +
    spring({ frame: frame - flipAt, fps, from: 0, to: 180, config });
  const enter = spring({ frame, fps, config: { damping: 14, mass: 0.6 } });

  const face: CSSProperties = {
    position: "absolute",
    inset: 0,
    backfaceVisibility: "hidden",
    borderRadius: 20,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    textAlign: "center",
    padding: 28,
    color: dark ? p.onDark : p.text,
    boxShadow: dark
      ? "0 20px 50px rgba(0, 0, 0, 0.35)"
      : "0 10px 30px rgba(15, 23, 42,0.08)",
  };
  const title: CSSProperties = { fontSize: 32, fontWeight: 700, lineHeight: 1.15 };
  const text: CSSProperties = {
    fontSize: 18,
    fontWeight: 500,
    marginTop: 14,
    lineHeight: 1.35,
    color: dark ? p.lighter : p.textMuted,
  };
  const rule = (
    <div
      style={{
        width: 48,
        height: 4,
        borderRadius: 2,
        background: p.primary,
        marginBottom: 18,
      }}
    />
  );

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          perspective: 1000,
          opacity: enter,
        }}
      >
        <div
          style={{
            width: 300,
            height: 400,
            position: "relative",
            transformStyle: "preserve-3d",
            transform: `scale(${0.6 + enter * 0.4}) rotateY(${rotation}deg)`,
          }}
        >
          <div
            style={{
              ...face,
              background: dark
                ? `linear-gradient(45deg, ${p.dark}, ${p.primary})`
                : p.paper,
              border: dark ? undefined : `1px solid ${alpha(p.primary, 0.18)}`,
            }}
          >
            {dark ? null : rule}
            <div style={title}>{str(props.frontTitle, "Every discipline")}</div>
            <div style={text}>
              {str(props.frontText, "Civil, structural, MEP, environmental and BIM")}
            </div>
          </div>
          <div
            style={{
              ...face,
              background: dark
                ? `linear-gradient(45deg, ${p.inkSoft}, ${p.dark})`
                : p.paperAlt,
              border: `2px solid ${p.primary}`,
              transform: "rotateY(180deg)",
            }}
          >
            {dark ? null : rule}
            <div style={{ ...title, color: dark ? undefined : p.dark }}>{str(props.backTitle, "One team")}</div>
            <div style={text}>{str(props.backText, "From brief to handover")}</div>
          </div>
        </div>
      </div>
    </Stage>
  );
}
