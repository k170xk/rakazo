// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Fragment } from "react";
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
  name: "animated-text",
  category: "text",
  description:
    "A headline whose letters drop and spin into place one by one, with an optional line underneath. Use for a bold title or key message card.",
  props: {
    text: 'string (default "Building better places")',
    subheading: 'string shown under the headline (default none)',
    dark: "boolean: dark OCSC background, false for a light one (default false: white)",
  },
  seconds: 4,
  media: "none",
  fits: "A headline of up to 5 words.",
  instead: "fullscreen_text for a longer statement; title-split for two words.",
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

export default function AnimatedText(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);

  const dark = props.dark === true;
  const fg = dark ? p.onDark : p.text;
  const text = str(props.text, "Building better places");
  const subheading = str(props.subheading, "");

  const width = stage.width - 80;
  const fontSize = fitSize(text, 80, width, stage.vertical ? 4 : 2);
  // Long headlines type in faster, so every letter is in within about two seconds.
  const step = Math.min(5, 45 / Math.max(1, text.length));
  const landed = step * text.length + 15;

  const subOpacity = interpolate(frame, [landed, landed + 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const drift = interpolate(frame, [0, durationInFrames], [1, 1.03], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const words = text.split(" ");
  let index = 0;

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
          transform: `scale(${drift})`,
        }}
      >
        <div
          style={{
            textAlign: "center",
            fontSize,
            fontWeight: "bold",
            lineHeight: 1.15,
            color: fg,
          }}
        >
          {words.map((word, w) => {
            const chars = word.split("").map((char) => {
              const delay = index * step;
              index += 1;
              const opacity = spring({
                frame: frame - delay,
                fps,
                from: 0,
                to: 1,
                config: { mass: 0.5, damping: 10 },
              });
              const y = spring({
                frame: frame - delay,
                fps,
                from: -50,
                to: 0,
                config: { mass: 0.5, damping: 10 },
              });
              const rotate = spring({
                frame: frame - delay,
                fps,
                from: -180,
                to: 0,
                config: { mass: 0.5, damping: 12 },
              });
              return (
                <span
                  key={delay}
                  style={{
                    display: "inline-block",
                    opacity,
                    transform: `translateY(${y}px) rotate(${rotate}deg)`,
                  }}
                >
                  {char}
                </span>
              );
            });
            index += 1;
            return (
              <Fragment key={`word-${w}`}>
                <span style={{ display: "inline-block", whiteSpace: "nowrap" }}>
                  {chars}
                </span>
                {w < words.length - 1 ? " " : null}
              </Fragment>
            );
          })}
        </div>

        {subheading ? (
          <div
            style={{
              marginTop: 24,
              fontSize: 28,
              fontWeight: 500,
              color: dark ? p.lighter : p.dark,
              textAlign: "center",
              opacity: subOpacity,
              transform: `translateY(${(1 - subOpacity) * 12}px)`,
            }}
          >
            {subheading}
          </div>
        ) : null}
      </div>
    </Stage>
  );
}
