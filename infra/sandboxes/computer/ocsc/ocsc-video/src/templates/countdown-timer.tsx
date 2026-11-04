// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  type BrandProps,
  num,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "countdown-timer",
  category: "content",
  description:
    "Big numbers count down and pop, ending on a brand-green word. Use it before a launch, a reveal or the start of a webinar.",
  props: {
    from: "number: the first number shown, 1 to 20 (default 5)",
    endText: 'string: shown after 1 and held to the end (default "Go")',
    label: 'string: small caption above the numbers, empty for none (default "")',
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 6,
  media: "none",
  fits: "A count of 3-10 and a closing word.",
  instead: "countdown-intro for a ring timer.",
};

type Props = BrandProps & {
  from?: number;
  endText?: string;
  label?: string;
  dark?: boolean;
};

export default function CountdownTimer(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const start = Math.max(1, Math.min(20, Math.round(num(props.from, 5))));
  const labels = [
    ...Array.from({ length: start }, (_, i) => String(start - i)),
    str(props.endText, "Go"),
  ];
  const label = str(props.label, "");

  // At most one number per second; shorter scenes count faster so the end word is always reached.
  const framesPerNumber = Math.max(
    6,
    Math.floor(Math.min(fps, durationInFrames / (labels.length + 0.5))),
  );
  const currentIndex = Math.min(
    Math.floor(frame / framesPerNumber),
    labels.length - 1,
  );
  const frameInSegment = frame - currentIndex * framesPerNumber;
  const isEnd = currentIndex === labels.length - 1;
  const currentLabel = labels[currentIndex];

  const scale = spring({
    frame: frameInSegment,
    fps,
    config: { damping: 12, stiffness: 200, mass: 0.5 },
  });
  const opacity = interpolate(
    frameInSegment,
    [0, 5, framesPerNumber - 8, framesPerNumber],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const endSize = Math.min(128, (stage.width * 0.9) / Math.max(1, currentLabel.length * 0.62));

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        {label ? (
          <div
            style={{
              color: dark ? p.lighter : p.dark,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: 24,
              textAlign: "center",
              padding: "0 30px",
            }}
          >
            {label}
          </div>
        ) : null}
        <div
          style={{
            transform: `scale(${scale})`,
            opacity: isEnd ? 1 : opacity,
            fontSize: isEnd ? endSize : 160,
            fontWeight: 800,
            color: dark ? p.onDark : p.text,
            background: isEnd
              ? dark
                ? `linear-gradient(135deg, ${p.primary}, ${p.light})`
                : `linear-gradient(135deg, ${p.dark}, ${p.primary})`
              : "none",
            WebkitBackgroundClip: isEnd ? "text" : undefined,
            WebkitTextFillColor: isEnd ? "transparent" : undefined,
            textAlign: "center",
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {currentLabel}
        </div>
      </div>
    </Stage>
  );
}
