import type { MediaGenerationProvider } from "@rakazo/adapter-kit";
import {
  FakeMediaGenerationProvider,
  FalMediaGenerationProvider,
} from "./media-generation-provider.js";

export function createMediaGenerationProvider(
  env: NodeJS.ProcessEnv = process.env,
): MediaGenerationProvider | undefined {
  const kind = env.MEDIA_GENERATION_PROVIDER?.trim().toLowerCase();
  if (!kind || kind === "disabled") return undefined;
  if (kind === "fake") return new FakeMediaGenerationProvider();
  if (kind !== "fal") throw new Error("Unknown media generation provider");
  const apiKey = env.MEDIA_GENERATION_API_KEY?.trim();
  const imageModel = env.MEDIA_GENERATION_IMAGE_MODEL?.trim();
  if (!apiKey || !imageModel)
    throw new Error("Media generation requires credentials and an image model");
  return new FalMediaGenerationProvider({
    apiKey,
    imageModel,
    baseUrl: env.MEDIA_GENERATION_BASE_URL,
  });
}
