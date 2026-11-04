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
  name: "floating-bubble-text",
  category: "text",
  description:
    "A short phrase in a brand-coloured pill with a slowly rotating gradient border, floating gently up and down. Use for a friendly statement, a theme word or a value.",
  props: {
    text: 'string (default "Built to last")',
    subheading: 'string shown inside the pill under the text (default none)',
    dark: "boolean: dark OCSC background, false for a light one (default false: white)",
  },
  seconds: 4,
  media: "none",
  fits: "A phrase of up to 4 words.",
  instead: "fullscreen_text for a longer message.",
};

type Props = BrandProps & {
  text?: string;
  subheading?: string;
  dark?: boolean;
};

/** A font size that keeps the text to `lines` lines and its longest word to one line. */
function fitSize(text: string, max: number, width: number, lines: number): number {
  const charWidth = 0.6;
  const longest = Math.max(...text.split(" ").map((w) => w.length), 1);
  return Math.min(
    max,
    (width * lines * 0.85) / Math.max(1, text.length * charWidth),
    width / (longest * charWidth),
  );
}

export default function FloatingBubbleText(props: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);

  const dark = props.dark === true;
  const text = str(props.text, "Built to last");
  const subheading = str(props.subheading, "");

  const float = Math.sin(frame / 30) * 20;
  const scale = spring({
    frame,
    fps,
    from: 0,
    to: 1,
    config: { damping: 12, mass: 0.5 },
  });
  // The border's gradient turns once every three seconds.
  const angle = (frame / (3 * fps)) * 360;
  const subOpacity = interpolate(frame, [15, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const padX = stage.vertical ? 36 : 56;
  const fontSize = fitSize(
    text,
    72,
    stage.width - 80 - padX * 2,
    stage.vertical ? 3 : 2,
  );

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            maxWidth: stage.width - 80,
            transform: `translateY(${float}px) scale(${scale})`,
            padding: 3,
            borderRadius: 27,
            background: `conic-gradient(from ${angle}deg, ${p.lighter}, ${alpha(p.primary, 0.2)}, ${p.light}, ${alpha(p.primary, 0.2)}, ${p.lighter})`,
            boxShadow: `0 8px 32px ${alpha(p.dark, 0.35)}`,
          }}
        >
          <div
            style={{
              fontSize,
              fontWeight: "bold",
              color: "white",
              lineHeight: 1.1,
              textAlign: "center",
              padding: `32px ${padX}px`,
              borderRadius: 24,
              background: `linear-gradient(45deg, ${p.dark}, ${p.primary})`,
            }}
          >
            {text}
            {subheading ? (
              <div
                style={{
                  fontSize: Math.min(24, fontSize * 0.4),
                  fontWeight: 500,
                  color: p.lighter,
                  marginTop: 12,
                  opacity: subOpacity,
                }}
              >
                {subheading}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Stage>
  );
}
