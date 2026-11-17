/**
 * Writes an ASCII DXF (AutoCAD R12, AC1009) that CAD software opens. Coordinates are drawing
 * units; millimetres is the default for OCSC drawings. The file is plain text, so an app
 * downloads it through the host with no extra library.
 */

export type DxfPoint = { x: number; y: number; z?: number };

export type DxfEntity =
  | { type: "point"; layer?: string; at: DxfPoint }
  | { type: "line"; layer?: string; from: DxfPoint; to: DxfPoint }
  | { type: "polyline"; layer?: string; points: DxfPoint[]; closed?: boolean }
  | { type: "circle"; layer?: string; center: DxfPoint; radius: number }
  | { type: "arc"; layer?: string; center: DxfPoint; radius: number; start: number; end: number }
  | { type: "text"; layer?: string; at: DxfPoint; text: string; height: number; rotation?: number };

export type DxfLayer = { name: string; color?: number };

export type DxfDrawing = {
  /** 4 = millimetres, 6 = metres, 0 = unitless. */
  units?: "mm" | "m" | "unitless";
  layers?: DxfLayer[];
  entities: DxfEntity[];
};

const UNITS = { unitless: 0, mm: 4, m: 6 } as const;

function finite(value: number, what: string): string {
  if (!Number.isFinite(value)) throw new Error(`A DXF ${what} must be a finite number.`);
  const rounded = Math.round(value * 1e8) / 1e8;
  return String(rounded);
}

function layerName(name: string | undefined): string {
  const cleaned = (name ?? "0").replace(/[<>/\\":;?*|=]/g, "-").trim().slice(0, 255);
  return cleaned || "0";
}

function colorIndex(color: number | undefined): number {
  if (color === undefined) return 7;
  const index = Math.round(color);
  if (index < 1 || index > 255) throw new Error("A DXF layer colour is an AutoCAD index from 1 to 255.");
  return index;
}

function textValue(text: string): string {
  return text.replace(/[\r\n]/g, " ").slice(0, 2000);
}

function pair(code: number, value: string | number): string {
  return `${code}\r\n${value}\r\n`;
}

function point(x: number, y: number, z: number | undefined, xCode: number): string {
  return (
    pair(xCode, finite(x, "coordinate")) +
    pair(xCode + 10, finite(y, "coordinate")) +
    pair(xCode + 20, finite(z ?? 0, "coordinate"))
  );
}

function entity(item: DxfEntity): string {
  const layer = layerName(item.layer);
  const head = (name: string) => pair(0, name) + pair(8, layer);
  switch (item.type) {
    case "point":
      return head("POINT") + point(item.at.x, item.at.y, item.at.z, 10);
    case "line":
      return (
        head("LINE") +
        point(item.from.x, item.from.y, item.from.z, 10) +
        point(item.to.x, item.to.y, item.to.z, 11)
      );
    case "circle":
      if (!(item.radius > 0)) throw new Error("A DXF circle needs a radius above zero.");
      return head("CIRCLE") + point(item.center.x, item.center.y, item.center.z, 10) + pair(40, finite(item.radius, "radius"));
    case "arc":
      if (!(item.radius > 0)) throw new Error("A DXF arc needs a radius above zero.");
      return (
        head("ARC") +
        point(item.center.x, item.center.y, item.center.z, 10) +
        pair(40, finite(item.radius, "radius")) +
        pair(50, finite(item.start, "angle")) +
        pair(51, finite(item.end, "angle"))
      );
    case "text":
      if (!(item.height > 0)) throw new Error("DXF text needs a height above zero.");
      return (
        head("TEXT") +
        point(item.at.x, item.at.y, item.at.z, 10) +
        pair(40, finite(item.height, "text height")) +
        pair(1, textValue(item.text)) +
        pair(50, finite(item.rotation ?? 0, "angle"))
      );
    case "polyline": {
      if (item.points.length < 2) throw new Error("A DXF polyline needs at least two points.");
      let body = head("POLYLINE") + pair(66, 1) + pair(70, item.closed ? 1 : 0) + pair(10, 0) + pair(20, 0) + pair(30, 0);
      for (const vertex of item.points) {
        body += pair(0, "VERTEX") + pair(8, layer) + point(vertex.x, vertex.y, vertex.z, 10);
      }
      return body + pair(0, "SEQEND") + pair(8, layer);
    }
    default: {
      const never: never = item;
      return never;
    }
  }
}

/** The drawing as an ASCII DXF file. */
export function writeDxf(drawing: DxfDrawing): string {
  const units = UNITS[drawing.units ?? "mm"];
  const used = new Map<string, number>();
  used.set("0", 7);
  for (const layer of drawing.layers ?? []) used.set(layerName(layer.name), colorIndex(layer.color));
  for (const item of drawing.entities) used.set(layerName(item.layer), used.get(layerName(item.layer)) ?? 7);

  let tables = pair(0, "TABLE") + pair(2, "LAYER") + pair(70, used.size);
  for (const [name, color] of used) {
    tables += pair(0, "LAYER") + pair(2, name) + pair(70, 0) + pair(62, color) + pair(6, "CONTINUOUS");
  }
  tables += pair(0, "ENDTAB");

  const entities = drawing.entities.map(entity).join("");
  return (
    pair(0, "SECTION") +
    pair(2, "HEADER") +
    pair(9, "$ACADVER") +
    pair(1, "AC1009") +
    pair(9, "$INSUNITS") +
    pair(70, units) +
    pair(0, "ENDSEC") +
    pair(0, "SECTION") +
    pair(2, "TABLES") +
    tables +
    pair(0, "ENDSEC") +
    pair(0, "SECTION") +
    pair(2, "ENTITIES") +
    entities +
    pair(0, "ENDSEC") +
    pair(0, "EOF")
  );
}
