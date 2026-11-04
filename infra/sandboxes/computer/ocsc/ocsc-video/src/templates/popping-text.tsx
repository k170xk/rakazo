// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Fragment } from "react";
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
  name: "popping-text",
  category: "text",
  description:
    "A big, heavy word whose letters pop in one by one in alternating brand shades with a white outline. Use to celebrate a milestone or land a one-word message.",
  props: {
    text: 'string, best as one or two short words (default "APPROVED!")',
    subheading: 'string shown under the word (default none)',
    dark: "boolean: dark OCSC background, false for a light one (default false: white)",
  },
  seconds: 3,
  media: "none",
  fits: "One word of up to 10 letters.",
  instead: "bubble-pop-text for an acronym; fullscreen_text for a sentence.",
};

type Props = BrandProps & {
  text?: string;
  subheading?: string;
  dark?: boolean;
};

/** A font size that keeps the text to `lines` lines and its longest word to one line. */
function fitSize(text: string, max: number, width: number, lines: number): number {
  const charWidth = 0.86;
  const longest = Math.max(...text.split(" ").map((w) => w.length), 1);
  return Math.min(
    max,
    (width * lines * 0.85) / Math.max(1, text.length * charWidth),
    width / (longest * charWidth),
  );
}

export default function PoppingText(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);

  const dark = props.dark === true;
  const text = str(props.text, "APPROVED!");
  const subheading = str(props.subheading, "");
  const colors = [p.dark, p.primary, p.lighter];

  const fontSize = fitSize(text, 128, stage.width - 80, stage.vertical ? 3 : 2);
  const step = Math.min(7, 45 / Math.max(1, text.length));
  const landed = step * text.length + 12;

  const subOpacity = interpolate(frame, [landed, landed + 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const drift = interpolate(frame, [0, durationInFrames], [1, 1.04], {
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
            fontWeight: 900,
            lineHeight: 1.05,
            letterSpacing: "0.05em",
          }}
        >
          {words.map((word, w) => {
            const chars = word.split("").map((char) => {
              const i = index;
              index += 1;
              const color = colors[i % colors.length];
              const scale = spring({
                frame: frame - i * step,
                fps,
                from: 0,
                to: 1,
                config: { mass: 0.4, damping: 8, stiffness: 100 },
              });
              const opacity = spring({
                frame: frame - i * step,
                fps,
                from: 0,
                to: 1,
                config: { mass: 0.3, damping: 8, stiffness: 100 },
              });
              return (
                <span
                  key={`c-${i}`}
                  style={{
                    display: "inline-block",
                    opacity,
                    color,
                    margin: "0 0.05em",
                    textShadow: `0 0 10px ${alpha(color, 0.5)}, -2px -2px 0 #fff, 2px -2px 0 #fff, -2px 2px 0 #fff, 2px 2px 0 #fff`,
                    transform: `scale(${scale})`,
                  }}
                >
                  {char}
                </span>
              );
            });
            index += 1;
            return (
              <Fragment key={`w-${w}`}>
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
              fontWeight: 600,
              color: dark ? p.onDark : p.text,
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
