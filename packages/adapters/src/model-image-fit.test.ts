import { MODEL_IMAGE_MAX_EDGE, MODEL_IMAGE_MAX_PIXELS } from "@rakazo/contracts";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { fitContextImages, modelImageScale } from "./model-image-fit.js";

async function png(width: number, height: number) {
  const bytes = await sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
  return { type: "image" as const, data: bytes.toString("base64"), mimeType: "image/png" };
}

describe("fitContextImages", () => {
  it("scales a drawing sheet that is over the pixel limit, in history and tool results", async () => {
    const sheet = await png(8_000, 4_000);
    const context = {
      systemPrompt: "x",
      messages: [
        { role: "user", content: [{ type: "text", text: "Check this" }, sheet] },
        { role: "toolResult", content: [sheet] },
      ],
    };
    const fitted = await fitContextImages(context);
    expect(fitted).not.toBe(context);
    for (const message of fitted.messages) {
      const image = message.content.find((part) => part.type === "image") as typeof sheet;
      const { width, height } = await sharp(Buffer.from(image.data, "base64")).metadata();
      expect(width * height).toBeLessThanOrEqual(MODEL_IMAGE_MAX_PIXELS);
      expect(Math.max(width, height)).toBeLessThanOrEqual(MODEL_IMAGE_MAX_EDGE);
      expect(width / height).toBeCloseTo(2, 2);
    }
    expect(fitted.messages[0]!.content[0]).toEqual({ type: "text", text: "Check this" });
  });

  it("leaves a context whose images already fit untouched", async () => {
    const context = { messages: [{ role: "user", content: [await png(1_600, 1_200)] }] };
    expect(await fitContextImages(context)).toBe(context);
  });

  it("caps the long edge as well as the area", () => {
    expect(modelImageScale(16_000, 500)).toBeCloseTo(MODEL_IMAGE_MAX_EDGE / 16_000);
    expect(modelImageScale(2_000, 2_000)).toBe(1);
  });
});
