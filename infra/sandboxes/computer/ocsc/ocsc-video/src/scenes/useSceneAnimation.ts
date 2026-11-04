import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { AnimationConfig, AnimationPreset } from "../types";

interface AnimatedStyle {
  opacity: number;
  transform: string;
}

export function useSceneAnimation(
  anim?: AnimationConfig,
  elementIndex = 0,
): AnimatedStyle {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const preset = anim?.entrance || "fade-in";
  const duration = anim?.entranceDuration || 20;
  const stagger = anim?.staggerDelay || 8;
  const delay = elementIndex * stagger;
  const f = Math.max(0, frame - delay);

  return getAnimatedStyle(preset, f, duration, fps);
}

export function getAnimatedStyle(
  preset: AnimationPreset,
  f: number,
  duration: number,
  fps: number,
): AnimatedStyle {
  switch (preset) {
    case "none":
      return { opacity: 1, transform: "none" };

    case "fade-in": {
      const opacity = interpolate(f, [0, duration], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      return { opacity, transform: "none" };
    }

    case "slide-up": {
      const opacity = interpolate(f, [0, duration * 0.6], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      const y = interpolate(
        spring({ frame: f, fps, config: { damping: 20, stiffness: 180 } }),
        [0, 1],
        [60, 0],
      );
      return { opacity, transform: `translateY(${y}px)` };
    }

    case "slide-left": {
      const opacity = interpolate(f, [0, duration * 0.6], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      const x = interpolate(
        spring({ frame: f, fps, config: { damping: 20, stiffness: 180 } }),
        [0, 1],
        [-80, 0],
      );
      return { opacity, transform: `translateX(${x}px)` };
    }

    case "slide-right": {
      const opacity = interpolate(f, [0, duration * 0.6], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      const x = interpolate(
        spring({ frame: f, fps, config: { damping: 20, stiffness: 180 } }),
        [0, 1],
        [80, 0],
      );
      return { opacity, transform: `translateX(${x}px)` };
    }

    case "scale-up": {
      const opacity = interpolate(f, [0, duration * 0.6], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      const s = interpolate(
        spring({ frame: f, fps, config: { damping: 15, stiffness: 120 } }),
        [0, 1],
        [0.7, 1],
      );
      return { opacity, transform: `scale(${s})` };
    }

    case "bounce": {
      const opacity = interpolate(f, [0, duration * 0.4], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      const s = spring({
        frame: f,
        fps,
        config: { damping: 8, stiffness: 200 },
      });
      return {
        opacity,
        transform: `scale(${interpolate(s, [0, 1], [0.3, 1])})`,
      };
    }

    case "blur-in": {
      const opacity = interpolate(f, [0, duration], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      // Note: filter blur is set inline by the component, not in transform
      return { opacity, transform: "none" };
    }

    case "typewriter": {
      const opacity = interpolate(f, [0, 5], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      return { opacity, transform: "none" };
    }

    default:
      return { opacity: 1, transform: "none" };
  }
}
