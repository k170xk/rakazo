import { Audio, interpolate, Sequence, useVideoConfig } from "remotion";
import { dbToGain, timeline, voiceSpans } from "./timeline";
import type { VideoProjectConfig } from "./types";

const DUCK_DOWN_SECONDS = 0.25;
const DUCK_UP_SECONDS = 0.6;

/**
 * Voiceover, music and sound effects. Every file arrives levelled to the same loudness (`levelDb`,
 * measured before the render), so `volumeDb` means the same thing for any track. The music bed
 * fades in and out and drops under every voice line by `duckDb`, so the voice is never turned
 * down to make room for the music.
 */
export const AudioLayer: React.FC<{ config: VideoProjectConfig }> = ({
  config,
}) => {
  const { fps, durationInFrames } = useVideoConfig();
  const { slots } = timeline(config);
  const spans = voiceSpans(config);
  const voiceDb = config.audio?.voiceVolumeDb ?? 0;
  const music = config.audio?.music;

  const musicVolume = (frame: number) => {
    if (!music) return 0;
    const base = (music.levelDb ?? 0) + (music.volumeDb ?? -8);
    const duck = music.duckDb ?? -10;
    const down = DUCK_DOWN_SECONDS * fps;
    const up = DUCK_UP_SECONDS * fps;
    // How far into a duck this frame is: 1 inside a voice line, ramping at each edge.
    let ducked = 0;
    for (const span of spans) {
      const amount =
        frame < span.start - down || frame > span.end + up
          ? 0
          : frame < span.start
            ? (frame - (span.start - down)) / down
            : frame <= span.end
              ? 1
              : 1 - (frame - span.end) / up;
      ducked = Math.max(ducked, amount);
    }
    const fade = interpolate(
      frame,
      [
        0,
        (music.fadeIn ?? 1) * fps,
        durationInFrames - (music.fadeOut ?? 3) * fps,
        durationInFrames,
      ],
      [0, 1, 1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    return dbToGain(base + duck * ducked) * fade;
  };

  return (
    <>
      {music?.src && (
        <Audio
          src={music.src}
          loop
          startFrom={Math.round((music.startAt ?? 0) * fps)}
          volume={musicVolume}
        />
      )}
      {spans.map((span) => (
        <Sequence key={`voice-${span.slot.index}`} from={span.start}>
          <Audio
            src={span.slot.scene.voiceover?.audioUrl as string}
            volume={dbToGain(
              voiceDb + (span.slot.scene.voiceover?.levelDb ?? 0),
            )}
          />
        </Sequence>
      ))}
      {slots.flatMap((slot) =>
        (slot.scene.sfx ?? []).map((effect) => (
          <Sequence
            key={`sfx-${slot.index}-${effect.at ?? 0}-${effect.src}`}
            from={slot.from + Math.round((effect.at ?? 0) * fps)}
          >
            <Audio
              src={effect.src}
              volume={dbToGain((effect.levelDb ?? 0) + (effect.volumeDb ?? -6))}
            />
          </Sequence>
        )),
      )}
    </>
  );
};
