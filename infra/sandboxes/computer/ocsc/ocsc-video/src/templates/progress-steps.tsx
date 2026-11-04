// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  list,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "progress-steps",
  category: "content",
  description:
    "Numbered steps light up in turn along a connecting line. Use it to show a project's stages or OCSC's process from brief to handover.",
  props: {
    title: 'string (default "Project timeline")',
    steps:
      'string[] (default ["Brief", "Design", "Planning", "Construction", "Handover"])',
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 6,
  media: "none",
  fits: "3-6 steps with labels of one or two words.",
  instead: "process_steps when each step needs a description; timeline for dated steps.",
};

type Props = BrandProps & {
  title?: string;
  steps?: string[];
  dark?: boolean;
};

export default function ProgressSteps(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const vertical = stage.vertical;
  const dark = props.dark === true;
  const offRing = dark ? "#4b5563" : alpha(p.primary, 0.3);
  const offText = dark ? "#6b7280" : p.textMuted;

  const steps = list<unknown>(props.steps, [
    "Brief",
    "Design",
    "Planning",
    "Construction",
    "Handover",
  ])
    .slice(0, 8)
    .map((s, i) => str(s, `Step ${i + 1}`));
  // The steps fill about two thirds of the scene, between half a second and 1.5 seconds each.
  const framesPerStep = Math.round(
    Math.max(fps * 0.5, Math.min(fps * 1.5, (durationInFrames * 0.65) / steps.length)),
  );
  const intro = Math.round(fps * 0.4);
  const titleIn = spring({ frame, fps, config: { damping: 14, mass: 0.6 } });
  const connector = vertical ? 40 : Math.min(80, (stage.width - 80 - steps.length * 80) / Math.max(1, steps.length - 1));

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
        <h2
          style={{
            color: dark ? p.onDark : p.text,
            fontSize: 32,
            fontWeight: 700,
            margin: 0,
            paddingBottom: vertical ? 40 : 60,
            textAlign: "center",
            opacity: titleIn,
            transform: `translateY(${(1 - titleIn) * 20}px)`,
          }}
        >
          {str(props.title, "Project timeline")}
        </h2>

        <div
          style={{
            display: "flex",
            flexDirection: vertical ? "column" : "row",
            alignItems: vertical ? "flex-start" : "center",
          }}
        >
          {steps.map((label, i) => {
            const stepStart = intro + i * framesPerStep;
            const fillProgress = interpolate(
              frame,
              [stepStart, stepStart + framesPerStep * 0.6],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
            const isActive = frame >= stepStart && frame < stepStart + framesPerStep;
            const isComplete = frame >= stepStart + framesPerStep * 0.6;
            const pulse = isActive
              ? spring({
                  frame: frame - stepStart,
                  fps,
                  config: { damping: 8, stiffness: 150, mass: 0.4 },
                })
              : 1;
            const circleScale = isActive ? 0.9 + pulse * 0.2 : isComplete ? 1.1 : 1;
            const lineProgress =
              i < steps.length - 1
                ? interpolate(
                    frame,
                    [stepStart + framesPerStep * 0.5, stepStart + framesPerStep],
                    [0, 1],
                    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                  )
                : 0;
            const on = fillProgress > 0;

            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  flexDirection: vertical ? "column" : "row",
                  alignItems: vertical ? "flex-start" : "center",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: vertical ? "row" : "column",
                    alignItems: "center",
                    width: vertical ? undefined : 80,
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      boxSizing: "border-box",
                      borderRadius: "50%",
                      border: `3px solid ${on ? p.primary : offRing}`,
                      background: on
                        ? `linear-gradient(135deg, ${p.primary}, ${p.dark})`
                        : dark
                          ? "transparent"
                          : p.paper,
                      boxShadow: dark ? undefined : "0 6px 16px rgba(15, 23, 42, 0.08)",
                      opacity: on ? 0.4 + fillProgress * 0.6 : 1,
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      transform: `scale(${circleScale})`,
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        color: on ? p.onDark : offText,
                        fontSize: 16,
                        fontWeight: 700,
                      }}
                    >
                      {i + 1}
                    </span>
                  </div>
                  <span
                    style={{
                      color: on ? (dark ? p.lighter : p.text) : offText,
                      fontSize: vertical ? 18 : 13,
                      fontWeight: 500,
                      marginTop: vertical ? 0 : 10,
                      marginLeft: vertical ? 16 : 0,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label}
                  </span>
                </div>

                {i < steps.length - 1 && (
                  <div
                    style={{
                      width: vertical ? 3 : connector,
                      height: vertical ? connector : 3,
                      background: dark ? "rgba(255, 255, 255, 0.15)" : alpha(p.primary, 0.15),
                      borderRadius: 2,
                      position: "relative",
                      overflow: "hidden",
                      margin: vertical ? "6px 0 6px 22.5px" : "0 0 24px 0",
                    }}
                  >
                    <div
                      style={{
                        width: vertical ? "100%" : `${lineProgress * 100}%`,
                        height: vertical ? `${lineProgress * 100}%` : "100%",
                        background: `linear-gradient(${vertical ? 180 : 90}deg, ${p.primary}, ${p.light})`,
                        borderRadius: 2,
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Stage>
  );
}
