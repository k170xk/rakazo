import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { VideoProjectConfig } from "./types";

const SECONDS = 0.7;

/** A short fade to black on the last frames, so a video settles instead of stopping dead. */
export const EndFade: React.FC<{ config: VideoProjectConfig }> = ({ config }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  if (config.settings.endFade === false) return null;
  const opacity = interpolate(
    frame,
    [durationInFrames - SECONDS * fps, durationInFrames - 1],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  if (opacity <= 0) return null;
  return <AbsoluteFill style={{ backgroundColor: "#000000", opacity, zIndex: 100 }} />;
};
