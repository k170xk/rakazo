import type { AdapterContext } from "./types.js";

export type MediaGenerationInput = { prompt: string };
export type GeneratedMedia = {
  bytes: Uint8Array;
  mimeType: "image/png";
};
/** Images only: OCSC Video (the ocsc tool) is the one way assistants make videos. */
export interface MediaGenerationProvider {
  readonly id: string;
  readonly capabilities: { images: boolean; offline: boolean };
  generateImage(input: MediaGenerationInput, context: AdapterContext): Promise<GeneratedMedia>;
}
export type MediaGenerationErrorCode =
  | "invalid_input"
  | "unsupported"
  | "authentication"
  | "rate_limit"
  | "provider_failure"
  | "output_limit";
export class MediaGenerationError extends Error {
  constructor(public readonly code: MediaGenerationErrorCode) {
    super(`Media generation: ${code}`);
    this.name = "MediaGenerationError";
  }
}
