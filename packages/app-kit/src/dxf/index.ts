import { download } from "../sdk/index.js";
import { parseDxf } from "./read.js";
import { writeDxf, type DxfDrawing } from "./write.js";

export { parseDxf } from "./read.js";
export { writeDxf } from "./write.js";
export type { DxfDrawing, DxfEntity, DxfLayer, DxfPoint } from "./write.js";

/** Saves the drawing as a .dxf file. Call it from a click. */
export async function downloadDxf(filename: string, drawing: DxfDrawing) {
  const name = filename.toLowerCase().endsWith(".dxf") ? filename : `${filename}.dxf`;
  await download(name, writeDxf(drawing), "application/dxf");
}
