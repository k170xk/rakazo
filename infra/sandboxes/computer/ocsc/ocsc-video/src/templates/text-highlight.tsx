// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
  type BrandProps,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "text-highlight",
  category: "content",
  description:
    "A short statement whose words are swept with a brand-green highlighter one by one. Use it for a mission line, key message or quote.",
  props: {
    text: 'string (default "Engineering the places where people live and work")',
    dark: "boolean: dark OCSC background, false for a light one (default false: white)",
  },
  seconds: 5,
  media: "none",
  fits: "A statement of up to 12 words.",
  instead: "fullscreen_text for a quieter version.",
};

type Props = BrandProps & {
  text?: string;
  dark?: boolean;
};

export default function TextHighlight(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const words = str(props.text, "Engineering the places where people live and work")
    .split(/\s+/)
    .filter(Boolean);
  // 0.6s a word, faster for long lines so the last word is lit by about three quarters through.
  const framesPerWord = Math.max(
    4,
    Math.floor(Math.min(fps * 0.6, (durationInFrames * 0.75) / words.length)),
  );
  const fontSize = (stage.vertical ? 40 : 56) * (words.length > 10 ? 0.75 : 1);

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
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
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            alignItems: "center",
            gap: 16,
            maxWidth: Math.min(780, stage.width - 40),
            padding: 20,
          }}
        >
          {words.map((word, i) => {
            const wordStart = i * framesPerWord;
            const highlightProgress = interpolate(
              frame,
              [wordStart, wordStart + framesPerWord * 0.5],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
            const lit = highlightProgress > 0;

            return (
              <span
                key={i}
                style={{
                  position: "relative",
                  display: "inline-block",
                  fontSize,
                  fontWeight: 700,
                  lineHeight: 1.15,
                  color: dark || highlightProgress > 0.5 ? p.onDark : p.text,
                  padding: "4px 12px",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${highlightProgress * 100}%`,
                    background: `linear-gradient(135deg, ${p.primary}, ${p.dark})`,
                    borderRadius: 6,
                    opacity: lit ? 0.85 : 0,
                  }}
                />
                <span style={{ position: "relative" }}>{word}</span>
              </span>
            );
          })}
        </div>
      </div>
    </Stage>
  );
}
