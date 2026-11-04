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
  name: "slide-text",
  category: "text",
  description:
    "A headline that slides in from the right and fades up, with an optional subheading following it. Use for a simple, clean statement or section title.",
  props: {
    text: 'string (default "Delivering infrastructure across Ireland and the UK")',
    subheading: 'string shown under the headline (default none)',
    dark: "boolean: dark OCSC background, false for a light one (default false: white)",
  },
  seconds: 4,
  media: "none",
  fits: "A headline of up to 8 words and a subheading.",
  instead: "fullscreen_text for the same message with less motion.",
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

export default function SlideText(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);

  const dark = props.dark === true;
  const text = str(props.text, "Delivering infrastructure across Ireland and the UK");
  const subheading = str(props.subheading, "");

  const opacity = spring({ frame, fps, from: 0, to: 1, durationInFrames: 30 });
  const slideX = spring({
    frame,
    fps,
    from: 200,
    to: 0,
    durationInFrames: 30,
    config: { damping: 12, mass: 0.5 },
  });
  const subOpacity = spring({
    frame: frame - 10,
    fps,
    from: 0,
    to: 1,
    durationInFrames: 30,
  });
  const subX = spring({
    frame: frame - 10,
    fps,
    from: 200,
    to: 0,
    durationInFrames: 30,
    config: { damping: 12, mass: 0.5 },
  });
  // Keeps drifting slightly left while it holds.
  const drift = interpolate(frame, [30, durationInFrames], [0, -14], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const width = stage.width - 80;
  const fontSize = fitSize(text, 64, width, stage.vertical ? 5 : 2);

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
        }}
      >
        <div
          style={{
            opacity,
            transform: `translateX(${slideX + drift}px)`,
            color: dark ? p.onDark : p.text,
            fontSize,
            fontWeight: "bold",
            lineHeight: 1.15,
            maxWidth: width,
          }}
        >
          {text}
        </div>
        {subheading ? (
          <div
            style={{
              opacity: subOpacity,
              transform: `translateX(${subX + drift}px)`,
              color: dark ? p.lighter : p.dark,
              fontSize: 28,
              fontWeight: 500,
              marginTop: 20,
              maxWidth: width,
            }}
          >
            {subheading}
          </div>
        ) : null}
      </div>
    </Stage>
  );
}
