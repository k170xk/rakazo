import type {
  AnySceneConfig,
  TransitionType,
  VideoProjectConfig,
} from "./types";

export type SceneSlot = {
  scene: AnySceneConfig;
  index: number;
  /** First frame of the scene. Its transition plays over the end of the scene before it. */
  from: number;
  /** Frames the scene owns. */
  frames: number;
  /** Frames it stays on screen beyond its own, under the next scene's entrance. */
  tail: number;
  transition: TransitionType;
  transitionFrames: number;
  /** The next scene's entrance, which this scene leaves by during its tail. */
  exit: TransitionType;
};

const DEFAULT_TRANSITION_SECONDS = 0.5;

export function transitionOf(
  config: VideoProjectConfig,
  scene: AnySceneConfig,
): TransitionType {
  return scene.transition ?? config.settings.transition ?? "fade";
}

/**
 * Where each scene sits. Scenes start back to back at the sum of the durations before them, so a
 * transition never moves a voiceover; the outgoing scene is held on under the incoming one instead.
 */
export function timeline(config: VideoProjectConfig): {
  slots: SceneSlot[];
  frames: number;
} {
  const fps = config.settings.fps || 30;
  let from = 0;
  const slots: SceneSlot[] = config.scenes.map((scene, index) => {
    const frames = Math.max(1, Math.round(scene.duration * fps));
    const transition = index === 0 ? "none" : transitionOf(config, scene);
    const seconds =
      config.settings.transitionSeconds ?? DEFAULT_TRANSITION_SECONDS;
    const slot = {
      scene,
      index,
      from,
      frames,
      tail: 0,
      exit: "none" as TransitionType,
      transition,
      transitionFrames:
        transition === "none" ? 0 : Math.max(1, Math.round(seconds * fps)),
    };
    from += frames;
    return slot;
  });
  slots.forEach((slot, i) => {
    const next = slots[i + 1];
    if (!next) return;
    slot.tail = Math.min(next.transitionFrames, next.frames);
    slot.exit = next.transition;
  });
  return { slots, frames: Math.max(1, from) };
}

export const dbToGain = (db: number) => 10 ** (db / 20);

/** The voiceover spans, in absolute frames, that the music ducks under. */
export function voiceSpans(
  config: VideoProjectConfig,
): { start: number; end: number; slot: SceneSlot }[] {
  const fps = config.settings.fps || 30;
  return timeline(config)
    .slots.filter((slot) => slot.scene.voiceover?.audioUrl)
    .map((slot) => {
      const delay = Math.round((slot.scene.voiceover?.delay ?? 0.3) * fps);
      const length = Math.round(
        ((slot.scene.voiceover?.durationMs ?? slot.scene.duration * 1000) /
          1000) *
          fps,
      );
      return {
        start: slot.from + delay,
        end: slot.from + delay + length,
        slot,
      };
    });
}
