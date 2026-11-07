export type MaskPoint = { x: number; y: number };

export type MaskShape =
  | { type: "polygon"; points: MaskPoint[] }
  | { type: "rect"; x: number; y: number; w: number; h: number }
  | { type: "brush"; points: MaskPoint[]; radius: number };

export type StudioTool = "pan" | "lasso" | "rect" | "brush";
export type StudioSize = "1024x1024" | "1536x1024" | "1024x1536";
export type StudioQuality = "low" | "medium" | "high";

export type RenderVersion = {
  id: string;
  /** Object URL of `blob`. */
  url: string;
  blob: Blob;
  prompt: string;
  hadMask: boolean;
  version: number;
  parentRenderId: string | null;
};

/** The closest gpt-image-2 output size to an image's aspect ratio. */
export function pickBestSize(width: number, height: number): StudioSize {
  const ratio = Math.log(width / height);
  const candidates: [StudioSize, number][] = [
    ["1024x1024", 0],
    ["1536x1024", Math.log(1.5)],
    ["1024x1536", Math.log(1 / 1.5)],
  ];
  let best = candidates[0] as [StudioSize, number];
  for (const candidate of candidates) {
    if (Math.abs(ratio - candidate[1]) < Math.abs(ratio - best[1])) best = candidate;
  }
  return best[0];
}

/** Named in the edit prompt, so the model knows which marks to follow and then remove. */
export const MARKUP_COLOUR_NAME = "magenta";
const MARKUP_STROKE = "rgb(255 0 255)";
const MARKUP_TINT = "rgb(255 0 255 / 0.22)";

/**
 * A transparent PNG overlay the size of the image that outlines each marked area in magenta.
 * Image models take it as `markup`; their pixel `mask` input leaves the marked area black.
 */
export async function buildMarkupPng(
  width: number,
  height: number,
  shapes: readonly MaskShape[],
): Promise<Blob | null> {
  if (!shapes.length) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const outline = Math.max(3, Math.round(Math.max(width, height) / 160));
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const shape of shapes) {
    context.fillStyle = MARKUP_TINT;
    context.strokeStyle = MARKUP_STROKE;
    context.lineWidth = outline;
    if (shape.type === "polygon" && shape.points.length >= 3) {
      context.beginPath();
      tracePoints(context, shape.points);
      context.closePath();
      context.fill();
      context.stroke();
    } else if (shape.type === "rect") {
      context.fillRect(shape.x, shape.y, shape.w, shape.h);
      context.strokeRect(shape.x, shape.y, shape.w, shape.h);
    } else if (shape.type === "brush" && shape.points.length > 0) {
      context.strokeStyle = MARKUP_TINT;
      context.lineWidth = shape.radius * 2;
      context.beginPath();
      tracePoints(context, shape.points);
      if (shape.points.length === 1) {
        const [point] = shape.points as [MaskPoint];
        context.lineTo(point.x + 0.01, point.y);
      }
      context.stroke();
    }
  }
  return canvasBlob(canvas);
}

/** The largest image edge sent for editing; bigger pictures are scaled down when loaded. */
const MAX_EDGE = 2048;
const MAX_BYTES = 8 * 1024 * 1024;

/** The picture to edit: as loaded, or redrawn smaller as PNG when too large to send. */
export async function editableImage(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const supported = ["image/png", "image/jpeg", "image/webp"].includes(blob.type);
  const edge = Math.max(bitmap.width, bitmap.height);
  if (supported && blob.size <= MAX_BYTES && edge <= MAX_EDGE) {
    bitmap.close();
    return blob;
  }
  const scale = Math.min(1, MAX_EDGE / edge);
  const resized = await redraw(
    bitmap,
    Math.round(bitmap.width * scale),
    Math.round(bitmap.height * scale),
  );
  bitmap.close();
  return resized;
}

/** Scales a rendered image back to the original's exact size, so edits never resize it. */
export async function resizeTo(blob: Blob, width: number, height: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  if (bitmap.width === width && bitmap.height === height) {
    bitmap.close();
    return blob;
  }
  const resized = await redraw(bitmap, width, height);
  bitmap.close();
  return resized;
}

async function redraw(bitmap: ImageBitmap, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  const png = await canvasBlob(canvas);
  if (!png) throw new Error("canvas");
  return png;
}

function tracePoints(context: CanvasRenderingContext2D, points: readonly MaskPoint[]) {
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}
