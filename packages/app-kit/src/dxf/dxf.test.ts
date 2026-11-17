import { describe, expect, it } from "vitest";
import { buildApp } from "../build/index.js";
import { parseDxf } from "./read.js";
import { writeDxf, type DxfDrawing } from "./write.js";

const drawing: DxfDrawing = {
  units: "mm",
  layers: [{ name: "GRID", color: 8 }, { name: "WALLS", color: 1 }],
  entities: [
    { type: "line", layer: "GRID", from: { x: 0, y: 0 }, to: { x: 6000, y: 0 } },
    {
      type: "polyline",
      layer: "WALLS",
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 6000, y: 0 },
        { x: 6000, y: 4000 },
        { x: 0, y: 4000 },
      ],
    },
    { type: "circle", layer: "GRID", center: { x: 3000, y: 2000 }, radius: 150 },
    { type: "arc", layer: "GRID", center: { x: 0, y: 0 }, radius: 500, start: 0, end: 90 },
    { type: "text", layer: "GRID", at: { x: 100, y: 100 }, text: "Grid A", height: 250 },
    { type: "point", at: { x: 1, y: 2, z: 3 } },
  ],
};

describe("DXF", () => {
  it("writes a millimetre R12 file and reads the same entities back", () => {
    const file = writeDxf(drawing);
    expect(file).toContain("AC1009");
    expect(file).toContain("$INSUNITS");
    const read = parseDxf(file);
    expect(read.units).toBe("mm");
    expect(read.entities).toEqual(drawing.entities);
  });

  it("bundles inside an app", async () => {
    const built = await buildApp({
      "App.tsx": `import { writeDxf } from "@ocsc/dxf";
import { AppShell, Theme } from "@ocsc/ui";
export default function App() {
  const file = writeDxf({ entities: [{ type: "line", from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }] });
  return <><Theme preset="evolve" /><AppShell title="Grid"><p>{file.slice(0, 3)}</p></AppShell></>;
}`,
    });
    expect(built.ok ? [] : built.errors).toEqual([]);
  });

  it("refuses a circle with no radius and a line with a bad coordinate", () => {
    expect(() => writeDxf({ entities: [{ type: "circle", center: { x: 0, y: 0 }, radius: 0 }] })).toThrow(/radius/);
    expect(() =>
      writeDxf({ entities: [{ type: "line", from: { x: Number.NaN, y: 0 }, to: { x: 1, y: 1 } }] }),
    ).toThrow(/finite/);
  });
});
