// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  type BrandProps,
  num,
  palette,
  Stage,
  str,
  type TemplateMeta,
} from "./kit";

export const meta: TemplateMeta = {
  name: "countdown-intro",
  category: "intro",
  description:
    "A ring timer counts down one number per second, then a closing word springs in. Use before a launch, reveal or live presentation in an OCSC video.",
  props: {
    from: "number: seconds to count down from, 1 to 9 (default 3)",
    goText: 'string: shown when the count reaches zero (default "Welcome")',
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 5,
  media: "none",
  fits: "A count of 3-5 and a closing word.",
  instead: "countdown-timer for bigger numbers; use either once at most.",
};

type Props = BrandProps & {
  from?: number;
  goText?: string;
  dark?: boolean;
};

export default function CountdownIntro(props: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const from = Math.max(1, Math.min(9, Math.round(num(props.from, 3))));
  const totalCountdownFrames = fps * from;
  const currentSecond = Math.max(from - Math.floor(frame / fps), 1);
  const isCountdownDone = frame >= totalCountdownFrames;

  const ringProgress = (frame % fps) / fps;
  const circumference = 2 * Math.PI * 70;
  const dashOffset = circumference * ringProgress;
  // Each number pops in at the start of its second.
  const numberPop = spring({
    frame: frame % fps,
    fps,
    config: { damping: 12, stiffness: 160 },
  });

  const goScale = spring({
    frame: Math.max(frame - totalCountdownFrames, 0),
    fps,
    config: { damping: 8, stiffness: 100 },
  });
  const goOpacity = interpolate(
    frame,
    [totalCountdownFrames, totalCountdownFrames + 5],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

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
        <div style={{ position: "relative", width: 180, height: 180 }}>
          <svg width={180} height={180} style={{ transform: "rotate(-90deg)" }}>
            <circle
              cx={90}
              cy={90}
              r={70}
              fill="none"
              stroke={dark ? p.inkSoft : p.paperAlt}
              strokeWidth={6}
              opacity={isCountdownDone ? 0 : 1}
            />
            {!isCountdownDone && (
              <circle
                cx={90}
                cy={90}
                r={70}
                fill="none"
                stroke={p.primary}
                strokeWidth={6}
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
              />
            )}
          </svg>
          {!isCountdownDone && (
            <span
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: `translate(-50%, -50%) scale(${0.7 + numberPop * 0.3})`,
                color: dark ? p.onDark : p.text,
                fontSize: 64,
                fontWeight: 700,
              }}
            >
              {currentSecond}
            </span>
          )}
          {isCountdownDone && (
            <span
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: `translate(-50%, -50%) scale(${goScale})`,
                color: dark ? p.primary : p.dark,
                fontSize: 56,
                fontWeight: 800,
                whiteSpace: "nowrap",
                opacity: goOpacity,
              }}
            >
              {str(props.goText, "Welcome")}
            </span>
          )}
        </div>
      </div>
    </Stage>
  );
}
