import { ANNOUNCEMENT_IMAGE_MAX_CHARS } from "@rakazo/contracts";

const MAX_EDGE_PX = 1800;
const QUALITIES = [0.86, 0.75, 0.6, 0.45];

/** The scale that fits an image's longer edge within `maxEdge`, never enlarging it. */
export function fitScale(width: number, height: number, maxEdge = MAX_EDGE_PX): number {
  const edge = Math.max(width, height);
  return edge > maxEdge ? maxEdge / edge : 1;
}

/**
 * A screenshot as a data URL small enough to send: at most 1800px on its longer edge, WebP where
 * the browser can encode it (JPEG otherwise, e.g. older Safari), lowering quality until it fits.
 */
export async function shrinkScreenshot(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = fitScale(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot prepare images.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of QUALITIES) {
    let url = canvas.toDataURL("image/webp", quality);
    if (!url.startsWith("data:image/webp")) url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= ANNOUNCEMENT_IMAGE_MAX_CHARS) return url;
  }
  throw new Error("That screenshot is too large. Try a smaller one.");
}
