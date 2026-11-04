// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
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
  name: "pulsing-text",
  category: "text",
  description:
    "A word whose letters pulse in a rolling wave, each with a soft brand-green glow behind it. Use for a theme word or a short message that should feel alive on screen.",
  props: {
    text: 'string, best as one to three short words (default "Net Zero")',
    subheading: 'string shown under the word (default none)',
    dark: "boolean: dark OCSC background, false for a light one (default false: white)",
  },
  seconds: 4,
  media: "none",
  fits: "One word or a phrase of up to 3 words.",
  instead: "fullscreen_text for a longer message.",
};

type Props = BrandProps & {
  text?: string;
  subheading?: string;
  dark?: boolean;
};

/** A font size that keeps the text to `lines` lines and its longest word to one line. */
function fitSize(text: string, max: number, width: number, lines: number): number {
  const charWidth = 0.95;
  const longest = Math.max(...text.split(" ").map((w) => w.length), 1);
  return Math.min(
    max,
    (width * lines * 0.85) / Math.max(1, text.length * charWidth),
    width / (longest * charWidth),
  );
}

const PERIOD = 30;

export default function PulsingText(props: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);

  const dark = props.dark === true;
  const fg = dark ? p.onDark : p.text;
  const text = str(props.text, "Net Zero");
  const subheading = str(props.subheading, "");

  const fontSize = fitSize(text, 80, stage.width - 80, stage.vertical ? 3 : 2);
  const gap = fontSize * 0.2;
  const glowSize = fontSize;

  const appear = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const subOpacity = interpolate(frame, [fps * 0.6, fps * 0.6 + 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const words = text.split(" ").filter(Boolean);
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
          opacity: appear,
          transform: `scale(${0.9 + appear * 0.1})`,
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: `${gap}px ${gap * 3}px`,
          }}
        >
          {words.map((word, w) => {
            const letters = word.split("").map((char) => {
              const delay = index * 6;
              index += 1;
              // Each letter starts its pulse a little after the one before it.
              const phase = frame < delay ? 0 : ((frame - delay) % PERIOD) / PERIOD;
              const pulse = interpolate(phase, [0, 0.5, 1], [1, 1.2, 1]);
              const glow = interpolate(phase, [0, 0.5, 1], [0.5, 1, 0.5]);
              return (
                <div
                  key={`c-${delay}`}
                  style={{ position: "relative", transform: `scale(${pulse})` }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      width: glowSize,
                      height: glowSize,
                      background: alpha(p.primary, dark ? 0.45 : 0.35),
                      borderRadius: "50%",
                      filter: "blur(20px)",
                      opacity: glow,
                    }}
                  />
                  <span
                    style={{
                      position: "relative",
                      fontSize,
                      fontWeight: "bold",
                      color: fg,
                      lineHeight: 1.2,
                    }}
                  >
                    {char}
                  </span>
                </div>
              );
            });
            index += 1;
            return (
              <div key={`w-${w}`} style={{ display: "flex", gap }}>
                {letters}
              </div>
            );
          })}
        </div>

        {subheading ? (
          <div
            style={{
              marginTop: 32,
              fontSize: 28,
              fontWeight: 500,
              color: dark ? p.lighter : p.dark,
              textAlign: "center",
              opacity: subOpacity,
            }}
          >
            {subheading}
          </div>
        ) : null}
      </div>
    </Stage>
  );
}
