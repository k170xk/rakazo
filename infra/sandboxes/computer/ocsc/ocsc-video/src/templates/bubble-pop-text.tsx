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
  name: "bubble-pop-text",
  category: "text",
  description:
    "A short word spelled out in brand-coloured bubbles that pop in one letter at a time. Use for an acronym, a short punchy word or a playful section opener.",
  props: {
    text: 'string, best under about 12 letters (default "OCSC")',
    subheading: 'string, "" to hide (default "O\'Connor Sutton Cronin")',
    dark: "boolean: dark OCSC background, false for a light one (default false: white)",
  },
  seconds: 4,
  media: "none",
  fits: "One word or acronym of up to 6 letters.",
  instead: "popping-text for a longer word.",
};

type Props = BrandProps & {
  text?: string;
  subheading?: string;
  dark?: boolean;
};

export default function BubblePopText(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);

  const dark = props.dark === true;
  const text = str(props.text, "OCSC");
  const subheading =
    props.subheading === ""
      ? ""
      : str(props.subheading, "O'Connor Sutton Cronin");

  const words = text.split(" ").filter(Boolean);
  const longest = Math.max(...words.map((w) => w.length), 1);
  const gap = 8;
  // Bubbles shrink so the longest word still fits on one row.
  const size = Math.max(
    36,
    Math.min(100, (stage.width - 80) / longest - gap),
  );
  const step = Math.min(5, 40 / Math.max(1, text.length));
  const landed = step * text.length + 15;

  const subOpacity = interpolate(frame, [landed, landed + 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // A gentle bob once everything has popped in.
  const bob = Math.sin(frame / 20) * 4 * subOpacity;
  const drift = interpolate(frame, [0, durationInFrames], [1, 1.03], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

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
          gap: 32,
          padding: 40,
          transform: `scale(${drift})`,
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: `${gap * 2}px ${size * 0.4}px`,
          }}
        >
          {words.map((word, w) => {
            const bubbles = word.split("").map((char) => {
              const i = index;
              index += 1;
              const scale = spring({
                frame: frame - i * step,
                fps,
                from: 0,
                to: 1,
                config: { damping: 8, mass: 0.3, stiffness: 100 },
              });
              return (
                <span
                  key={`b-${i}`}
                  style={{
                    boxSizing: "border-box",
                    transform: `translateY(${i % 2 ? bob : -bob}px) scale(${scale})`,
                    fontSize: size * 0.64,
                    fontWeight: "bold",
                    color: "white",
                    border: "4px solid rgba(255, 255, 255, 0.2)",
                    borderRadius: "50%",
                    width: size,
                    height: size,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: `linear-gradient(45deg, ${p.dark}, ${p.primary})`,
                    boxShadow: `0 4px 15px ${alpha(p.primary, 0.5)}`,
                  }}
                >
                  {char}
                </span>
              );
            });
            index += 1;
            return (
              <div key={`w-${w}`} style={{ display: "flex", gap }}>
                {bubbles}
              </div>
            );
          })}
        </div>

        {subheading ? (
          <div
            style={{
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
