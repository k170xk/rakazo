// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  OCSC_INK,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "typewriter-subtitle",
  category: "text",
  description:
    "A line of text typed out letter by letter with a blinking brand-coloured cursor. Use as a caption or subtitle over footage, or on its own for a quote or key line.",
  props: {
    text: 'string (default "We design infrastructure that lasts for generations.")',
    position: '"center" | "bottom" (default "bottom" as an overlay, otherwise "center")',
    dark: "boolean: draw on the dark OCSC background when used as a scene, false for a light one (default false: white)",
  },
  seconds: 5,
  media: "none, or an overlay on footage",
  fits: "One line of up to 12 words.",
  instead: "fullscreen_text for a statement that appears at once.",
  overlay: true,
};

type Props = BrandProps & {
  text?: string;
  position?: "center" | "bottom";
  dark?: boolean;
  /** Set by the overlay layer, so the caption draws over the scene underneath. */
  asOverlay?: boolean;
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

/** Typing speed in characters per second. */
const CPS = 18;

export default function TypewriterSubtitle(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);

  const text = str(props.text, "We design infrastructure that lasts for generations.");
  const overlay = props.asOverlay === true;
  const dark = props.dark === true;
  const position = props.position ?? (overlay ? "bottom" : "center");
  const onDark = overlay || dark;

  // Types at a steady pace, but always finishes with time left to read it.
  const typing = Math.min((text.length / CPS) * fps, durationInFrames * 0.7);
  const visibleCharacters = Math.floor(
    interpolate(frame, [0, typing], [0, text.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const blink = Math.max(2, Math.round(fps / 2));
  const cursorOn = frame % blink < blink / 2;

  const width = stage.width - (overlay ? 120 : 80);
  const fontSize = fitSize(text, 48, width, stage.vertical ? 5 : 2);

  const background = overlay ? undefined : dark ? p.darkGradient : p.lightGradient;

  return (
    <Stage background={background}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: position === "bottom" ? "flex-end" : "center",
          justifyContent: "center",
          padding:
            position === "bottom"
              ? `0 32px ${Math.round(stage.height * 0.1)}px`
              : 32,
        }}
      >
        <div
          style={{
            maxWidth: width,
            textAlign: "center",
            fontSize,
            fontWeight: "bold",
            lineHeight: 1.25,
            color: onDark ? "white" : p.text,
            opacity: interpolate(frame, [0, 6], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            ...(overlay
              ? {
                  background: alpha(OCSC_INK, 0.72),
                  padding: "14px 24px",
                  borderRadius: 8,
                }
              : {}),
          }}
        >
          <span>{text.slice(0, visibleCharacters)}</span>
          <span
            style={{
              position: "absolute",
              color: p.light,
              opacity: cursorOn ? 1 : 0,
              marginLeft: "0.05em",
            }}
          >
            ▌
          </span>
          <span style={{ visibility: "hidden" }}>{text.slice(visibleCharacters)}</span>
        </div>
      </div>
    </Stage>
  );
}
