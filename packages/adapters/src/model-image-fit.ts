import { createHash } from "node:crypto";
import { MODEL_IMAGE_MAX_EDGE, MODEL_IMAGE_MAX_PIXELS } from "@rakazo/contracts";
import { getLogger } from "@rakazo/logging";
import { piImageDimensions } from "./pi-image-context.js";

const CACHE_LIMIT = 32;

type ImagePart = { type: "image"; data: string; mimeType: string };
type TextPart = { type: "text"; text: string };

/** How much an image must shrink to be accepted by every provider; 1 when it already fits. */
export function modelImageScale(width: number, height: number): number {
  return Math.min(
    1,
    MODEL_IMAGE_MAX_EDGE / Math.max(width, height),
    Math.sqrt(MODEL_IMAGE_MAX_PIXELS / (width * height)),
  );
}

const fitted = new Map<string, Promise<ImagePart | TextPart>>();

async function shrink(
  image: ImagePart,
  width: number,
  height: number,
): Promise<ImagePart | TextPart> {
  const scale = modelImageScale(width, height);
  try {
    const { default: sharp } = await import("sharp");
    const resized = sharp(Buffer.from(image.data, "base64"), {
      limitInputPixels: 500_000_000,
    }).resize({
      width: Math.max(1, Math.floor(width * scale)),
      height: Math.max(1, Math.floor(height * scale)),
      fit: "fill",
    });
    const encoded =
      image.mimeType === "image/jpeg"
        ? await resized.jpeg({ quality: 90 }).toBuffer()
        : image.mimeType === "image/webp"
          ? await resized.webp({ quality: 90 }).toBuffer()
          : await resized.png({ compressionLevel: 9 }).toBuffer();
    const mimeType =
      image.mimeType === "image/jpeg" || image.mimeType === "image/webp"
        ? image.mimeType
        : "image/png";
    return { type: "image", data: encoded.toString("base64"), mimeType };
  } catch (error) {
    getLogger().warn("model image resize failed", { error: String(error), width, height });
    return {
      type: "text",
      text: `[An image of ${width}×${height} pixels was too large to show you and could not be resized. Tell the user to send a smaller image or fewer pages.]`,
    };
  }
}

/** An image every provider accepts: oversized ones are scaled down, never sent as they are. */
export async function fitModelImage(image: ImagePart): Promise<ImagePart | TextPart> {
  const dimensions = piImageDimensions(image.data, image.mimeType);
  if (!dimensions || modelImageScale(...dimensions) >= 1) return image;
  const key = createHash("sha256").update(image.data).digest("hex");
  let pending = fitted.get(key);
  if (!pending) {
    pending = shrink(image, ...dimensions);
    fitted.set(key, pending);
    if (fitted.size > CACHE_LIMIT) fitted.delete(fitted.keys().next().value!);
  }
  return pending;
}

const isImagePart = (part: unknown): part is ImagePart =>
  typeof part === "object" &&
  part !== null &&
  (part as { type?: unknown }).type === "image" &&
  typeof (part as { data?: unknown }).data === "string" &&
  typeof (part as { mimeType?: unknown }).mimeType === "string";

/**
 * The model context with every image sized for the provider. History keeps its stored images, so
 * one oversized drawing would otherwise fail every later turn in the chat.
 */
export async function fitContextImages<C extends { messages: readonly unknown[] }>(
  context: C,
): Promise<C> {
  let changed = false;
  const messages = await Promise.all(
    context.messages.map(async (message) => {
      const content = (message as { content?: unknown }).content;
      if (!Array.isArray(content) || !content.some(isImagePart)) return message;
      const parts = await Promise.all(
        content.map((part) => (isImagePart(part) ? fitModelImage(part) : part)),
      );
      if (parts.every((part, index) => part === content[index])) return message;
      changed = true;
      return { ...(message as object), content: parts };
    }),
  );
  return changed ? { ...context, messages } : context;
}
