import type { ComponentType } from "react";

/**
 * The Bot's own scenes, keyed by their file path in the video's spec. `ocsc-video` rewrites this
 * file in a private copy of the project for each render that uses custom scenes; the image's
 * prebuilt bundle has none.
 */
export const customScenes: Record<
  string,
  ComponentType<Record<string, unknown>>
> = {};
