// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  num,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "sound-wave",
  category: "content",
  description:
    "A row of green bars on white (white bars with a green glow when dark) pulses like an audio meter. Use it behind a voiceover, podcast clip or interview audio.",
  props: {
    label: 'string: caption under the wave, empty for none (default "")',
    bars: "number: how many bars, 10 to 80 (default 40)",
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 6,
  media: "none",
  fits: "An optional label of up to 6 words.",
  instead: "Use it behind a voiceover or an interview clip only.",
};

type Props = BrandProps & {
  label?: string;
  bars?: number;
  dark?: boolean;
};

export default function SoundWave(props: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const count = Math.max(10, Math.min(80, Math.round(num(props.bars, 40))));
  const gap = 4;
  const barWidth = Math.max(3, Math.min(12, (stage.width - 60) / count - gap));
  const t = frame / fps;
  const grow = spring({ frame, fps, config: { damping: 14, mass: 0.6 } });
  const label = str(props.label, "");

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap,
          boxShadow: dark ? `inset 0 0 100px ${alpha(p.primary, 0.2)}` : undefined,
        }}
      >
        {Array.from({ length: count }).map((_, i) => {
          const height =
            (Math.abs(Math.sin(t * 3 + i / 2)) * 100 + random(`bar-${i}`) * 50) * grow + 6;
          return (
            <div
              key={i}
              style={{
                width: barWidth,
                height,
                flexShrink: 0,
                background: dark ? p.onDark : p.primary,
                borderRadius: barWidth / 2,
                boxShadow: dark
                  ? `0 0 10px ${alpha(p.primary, 0.6)}`
                  : `0 4px 10px ${alpha(p.primary, 0.25)}`,
              }}
            />
          );
        })}
      </div>
      {label ? (
        <div
          style={{
            position: "absolute",
            left: 30,
            right: 30,
            top: stage.height / 2 + 110,
            textAlign: "center",
            color: dark ? p.lighter : p.textMuted,
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "0.04em",
            opacity: grow,
          }}
        >
          {label}
        </div>
      ) : null}
    </Stage>
  );
}
