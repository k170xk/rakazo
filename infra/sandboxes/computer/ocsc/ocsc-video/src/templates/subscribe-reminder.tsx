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
  name: "subscribe-reminder",
  category: "intro",
  description:
    "A call-to-action pill with a pulsing green arrow that slides up in the bottom-right corner. Best as an overlay near the end of a scene to point viewers to ocsc.ie.",
  props: {
    text: 'string (default "Find out more at ocsc.ie")',
    subtext: 'string: smaller second line, empty to hide (default "O\'Connor Sutton Cronin")',
    dark: "boolean: draw on the dark OCSC background when used as a scene (default false: white)",
  },
  seconds: 5,
  media: "an overlay on a scene near the end",
  fits: "A call to action of up to 6 words and an optional second line.",
  instead: "end-card for a full closing call to action.",
  overlay: true,
};

type Props = BrandProps & {
  text?: string;
  subtext?: string;
  dark?: boolean;
  /** Set by the overlay layer, so the pill draws over the scene underneath. */
  asOverlay?: boolean;
};

export default function SubscribeReminder(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);

  const slideIn = spring({
    frame: frame - 10,
    fps,
    config: { damping: 14, stiffness: 100 },
  });
  const out = interpolate(
    frame,
    [durationInFrames - 15, durationInFrames - 1],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const translateY = interpolate(slideIn - out, [0, 1], [100, 0]);
  const pulse = interpolate(Math.sin(frame * 0.15), [-1, 1], [1, 1.15]);

  const background =
    props.asOverlay || props.dark !== true ? undefined : p.darkGradient;
  const subtext = typeof props.subtext === "string" ? props.subtext.trim() : "O'Connor Sutton Cronin";

  return (
    <Stage background={background}>
      <div
        style={{
          position: "absolute",
          bottom: 24,
          right: 24,
          maxWidth: stage.width - 48,
          display: "flex",
          alignItems: "center",
          gap: 12,
          backgroundColor: "rgba(0, 0, 0, 0.75)",
          padding: "10px 20px 10px 10px",
          borderRadius: 999,
          transform: `translateY(${translateY}px)`,
          opacity: 1 - out,
          border: `1px solid ${alpha(p.primary, 0.35)}`,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            flexShrink: 0,
            borderRadius: "50%",
            backgroundColor: p.primary,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            transform: `scale(${pulse})`,
            boxShadow: `0 0 12px ${alpha(p.primary, 0.5)}`,
          }}
        >
          <svg width={16} height={16} viewBox="0 0 16 16">
            <path
              d="M3 8h9M8.5 4l4 4-4 4"
              fill="none"
              stroke="#ffffff"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ color: p.onDark, fontSize: 15, fontWeight: 600 }}>
            {str(props.text, "Find out more at ocsc.ie")}
          </span>
          {subtext ? (
            <span style={{ color: p.lighter, fontSize: 11, marginTop: 2 }}>{subtext}</span>
          ) : null}
        </div>
      </div>
    </Stage>
  );
}
