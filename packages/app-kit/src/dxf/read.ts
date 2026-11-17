import type { DxfDrawing, DxfEntity, DxfPoint } from "./write.js";

/**
 * Reads the entities this kit writes, plus the same entity types from other ASCII DXF files:
 * POINT, LINE, CIRCLE, ARC, TEXT and POLYLINE with VERTEX. Other entities are skipped.
 */

type Group = { code: number; value: string };

function groups(text: string): Group[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  const out: Group[] = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index]?.trim());
    if (!Number.isInteger(code)) continue;
    out.push({ code, value: lines[index + 1] ?? "" });
  }
  return out;
}

function numberAt(fields: Map<number, string>, code: number): number {
  const value = Number(fields.get(code));
  return Number.isFinite(value) ? value : 0;
}

function pointAt(fields: Map<number, string>, code: number): DxfPoint {
  const point: DxfPoint = { x: numberAt(fields, code), y: numberAt(fields, code + 10) };
  const z = numberAt(fields, code + 20);
  if (z) point.z = z;
  return point;
}

function collect(start: number, all: Group[]): { fields: Map<number, string>; next: number } {
  const fields = new Map<number, string>();
  let index = start;
  while (index < all.length && all[index]?.code !== 0) {
    const group = all[index]!;
    if (!fields.has(group.code)) fields.set(group.code, group.value.trim());
    index += 1;
  }
  return { fields, next: index };
}

/** Entities and units from an ASCII DXF file. */
export function parseDxf(text: string): DxfDrawing {
  const all = groups(text);
  const entities: DxfEntity[] = [];
  let units: DxfDrawing["units"] = "unitless";
  let inEntities = false;
  let section = "";

  for (let index = 0; index < all.length; index += 1) {
    const group = all[index]!;
    if (group.code !== 0) {
      if (section === "HEADER" && group.code === 9 && group.value.trim() === "$INSUNITS") {
        const value = Number(all[index + 1]?.value);
        units = value === 4 ? "mm" : value === 6 ? "m" : "unitless";
      }
      continue;
    }
    const name = group.value.trim().toUpperCase();
    if (name === "SECTION") {
      section = all[index + 1]?.code === 2 ? (all[index + 1]?.value.trim().toUpperCase() ?? "") : "";
      inEntities = section === "ENTITIES";
      continue;
    }
    if (name === "ENDSEC") {
      inEntities = false;
      section = "";
      continue;
    }
    if (!inEntities || name === "SEQEND") continue;
    const { fields, next } = collect(index + 1, all);
    const storedLayer = fields.get(8);
    const layer = storedLayer && storedLayer !== "0" ? storedLayer : undefined;
    if (name === "POINT") entities.push({ type: "point", layer, at: pointAt(fields, 10) });
    else if (name === "LINE") entities.push({ type: "line", layer, from: pointAt(fields, 10), to: pointAt(fields, 11) });
    else if (name === "CIRCLE") entities.push({ type: "circle", layer, center: pointAt(fields, 10), radius: numberAt(fields, 40) });
    else if (name === "ARC") {
      entities.push({
        type: "arc",
        layer,
        center: pointAt(fields, 10),
        radius: numberAt(fields, 40),
        start: numberAt(fields, 50),
        end: numberAt(fields, 51),
      });
    } else if (name === "TEXT") {
      entities.push({
        type: "text",
        layer,
        at: pointAt(fields, 10),
        text: fields.get(1) ?? "",
        height: numberAt(fields, 40),
        ...(numberAt(fields, 50) ? { rotation: numberAt(fields, 50) } : {}),
      });
    } else if (name === "POLYLINE") {
      const points: DxfPoint[] = [];
      let cursor = next;
      while (cursor < all.length && all[cursor]?.value.trim().toUpperCase() !== "SEQEND") {
        if (all[cursor]?.code === 0 && all[cursor]?.value.trim().toUpperCase() === "VERTEX") {
          const vertex = collect(cursor + 1, all);
          points.push(pointAt(vertex.fields, 10));
          cursor = vertex.next;
        } else cursor += 1;
      }
      entities.push({ type: "polyline", layer, points, closed: numberAt(fields, 70) === 1 });
      index = cursor;
      continue;
    }
    index = next - 1;
  }
  return { units, entities };
}
