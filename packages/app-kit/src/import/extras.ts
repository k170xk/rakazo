import * as XLSX from "xlsx";
import type { ChartSeriesSpec, ChartSpec } from "../calc/model.js";
import type { XmlNode } from "../calc/xml.js";
import { child, childrenNamed, descendants, parseXml, textOf } from "../calc/xml.js";
import { readBiffCharts, readBiffPrintAreas } from "./biff.js";

/**
 * What a calculator app needs from a workbook beyond its cells: the charts drawn on its sheets, as
 * the cell ranges they plot, and each sheet's print area, the part of it laid out for people to
 * read. Legacy .xls files keep their charts as BIFF records, read by readBiffCharts.
 */

type Zip = ReturnType<typeof XLSX.CFB.read>;

const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b;

function openZip(bytes: Uint8Array): Zip | null {
  if (!isZip(bytes)) return null;
  try {
    return XLSX.CFB.read(bytes, { type: "array" });
  } catch {
    return null;
  }
}

const colNumber = (letters: string) =>
  letters
    .toUpperCase()
    .split("")
    .reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** The first area of a print area reference ("Sheet!$B$2:$K$54", whole columns or rows too). */
export function parseArea(ref: string): [number, number, number, number] | null {
  // A print area of several ranges prints them in turn; together they span their bounding box.
  let union: [number, number, number, number] | null = null;
  for (const part of ref.split(",")) {
    const area = oneArea(part);
    if (!area) continue;
    union = union
      ? [
          Math.min(union[0], area[0]),
          Math.min(union[1], area[1]),
          Math.max(union[2], area[2]),
          Math.max(union[3], area[3]),
        ]
      : area;
  }
  return union;
}

function oneArea(ref: string): [number, number, number, number] | null {
  const area = ref.trim().replace(/^.*!/, "").replace(/\$/g, "");
  const cells = /^([A-Z]{1,3})(\d+):([A-Z]{1,3})(\d+)$/i.exec(area);
  if (cells)
    return [Number(cells[2]) - 1, colNumber(cells[1]!), Number(cells[4]) - 1, colNumber(cells[3]!)];
  const cols = /^([A-Z]{1,3}):([A-Z]{1,3})$/i.exec(area);
  if (cols) return [0, colNumber(cols[1]!), 1_048_575, colNumber(cols[2]!)];
  const rows = /^(\d+):(\d+)$/.exec(area);
  if (rows) return [Number(rows[1]) - 1, 0, Number(rows[2]) - 1, 16_383];
  return null;
}

/** Each sheet's print area, by sheet index. */
export function readPrintAreas(bytes: Uint8Array): Map<number, [number, number, number, number]> {
  const areas = new Map<number, [number, number, number, number]>();
  const zip = openZip(bytes);
  const names: Array<{ sheet: number; ref: string }> = [];
  if (zip) {
    const workbook = readXml(zip, "xl/workbook.xml");
    for (const node of childrenNamed(
      child(child(workbook ?? undefined, "workbook"), "definedNames"),
      "definedName",
    ))
      if (node.attrs.name === "_xlnm.Print_Area" && node.attrs.localSheetId !== undefined)
        names.push({ sheet: Number(node.attrs.localSheetId), ref: textOf(node) });
  } else {
    names.push(...readBiffPrintAreas(bytes));
    if (names.length) return collect(names, areas);
    try {
      const book = XLSX.read(bytes, { type: "array", sheetRows: 1, cellFormula: false });
      for (const name of book.Workbook?.Names ?? [])
        if (name.Name === "_xlnm.Print_Area" && name.Sheet !== undefined && name.Ref)
          names.push({ sheet: name.Sheet, ref: name.Ref });
    } catch {
      return areas;
    }
  }
  return collect(names, areas);
}

function collect(
  names: Array<{ sheet: number; ref: string }>,
  areas: Map<number, [number, number, number, number]>,
) {
  for (const { sheet, ref } of names) {
    const area = parseArea(ref);
    if (area) areas.set(sheet, area);
  }
  return areas;
}

const KINDS: Record<string, ChartSpec["kind"]> = {
  barChart: "bar",
  bar3DChart: "bar",
  lineChart: "line",
  line3DChart: "line",
  areaChart: "area",
  area3DChart: "area",
  scatterChart: "scatter",
  pieChart: "pie",
  pie3DChart: "pie",
  doughnutChart: "pie",
};

function readXml(zip: Zip, path: string): XmlNode | null {
  const entry = XLSX.CFB.find(zip, `/${path}`);
  const content = entry?.content as Uint8Array | number[] | undefined;
  if (!content) return null;
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  return parseXml(new TextDecoder("utf-8").decode(bytes));
}

function resolvePath(dir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = dir ? dir.split("/") : [];
  for (const piece of target.split("/")) {
    if (piece === "..") parts.pop();
    else if (piece !== ".") parts.push(piece);
  }
  return parts.join("/");
}

function relationships(zip: Zip, part: string): Map<string, { target: string; type: string }> {
  const slash = part.lastIndexOf("/");
  const dir = part.slice(0, slash);
  const rels = readXml(zip, `${dir}/_rels/${part.slice(slash + 1)}.rels`);
  const out = new Map<string, { target: string; type: string }>();
  if (!rels) return out;
  for (const rel of descendants(rels, "Relationship")) {
    if (rel.attrs.TargetMode === "External") continue;
    out.set(rel.attrs.Id ?? "", {
      target: resolvePath(dir, rel.attrs.Target ?? ""),
      type: rel.attrs.Type ?? "",
    });
  }
  return out;
}

const val = (node: XmlNode | undefined) => node?.attrs.val;
const refOf = (node: XmlNode | undefined) => {
  const ref = node && (child(node, "numRef") ?? child(node, "strRef"));
  const text = textOf(child(ref, "f")).trim();
  return text || undefined;
};
const titleOf = (node: XmlNode | undefined) => {
  if (!node) return undefined;
  const text = descendants(node, "t")
    .map((t) => t.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
};

function readSeries(node: XmlNode, kind: ChartSpec["kind"]): ChartSeriesSpec | null {
  const scatter = kind === "scatter";
  const y = refOf(child(node, scatter ? "yVal" : "val"));
  if (!y) return null;
  const x = refOf(child(node, scatter ? "xVal" : "cat"));
  const tx = child(node, "tx");
  const nameRef = refOf(tx);
  const name = nameRef ? undefined : textOf(child(tx, "v")).trim() || undefined;
  const line = child(child(node, "spPr"), "ln");
  const series: ChartSeriesSpec = { y };
  if (x) series.x = x;
  if (nameRef) series.nameRef = nameRef;
  if (name) series.name = name;
  if (scatter || kind === "line") {
    series.line = !child(line, "noFill");
    series.marker = val(child(child(node, "marker"), "symbol")) !== "none";
  }
  return series;
}

function readChart(xml: XmlNode, sheet: number, anchor: ChartSpec["anchor"]): ChartSpec | null {
  const chart = child(child(xml, "chartSpace"), "chart");
  const plot = child(chart, "plotArea");
  if (!plot) return null;
  const groups = plot.children.filter((node) => KINDS[node.name]);
  const first = groups[0];
  if (!first) return null;
  let kind = KINDS[first.name]!;
  if (kind === "bar" && val(child(first, "barDir")) === "col") kind = "column";
  const series = groups.flatMap((group) =>
    childrenNamed(group, "ser")
      .map((node) => readSeries(node, kind))
      .filter((item): item is ChartSeriesSpec => item !== null),
  );
  if (!series.length) return null;
  const axes = plot.children.filter((node) => node.name === "valAx" || node.name === "catAx");
  const horizontal = (node: XmlNode) => ["b", "t"].includes(val(child(node, "axPos")) ?? "b");
  const xAxis =
    kind === "bar"
      ? axes.find((node) => node.name === "catAx")
      : kind === "scatter"
        ? axes.find(horizontal)
        : axes.find((node) => node.name === "catAx");
  const yAxis = axes.find((node) => node !== xAxis && node.name === "valAx");
  const hidden = (node: XmlNode | undefined) => !node || val(child(node, "delete")) === "1";
  const spec: ChartSpec = { sheet, kind, anchor, series };
  const title =
    val(child(chart, "autoTitleDeleted")) === "1" ? undefined : titleOf(child(chart, "title"));
  if (title) spec.title = title;
  const grouping = val(child(first, "grouping"));
  if (grouping === "stacked" || grouping === "percentStacked") spec.stacked = true;
  if (kind !== "pie" && axes.length && axes.every(hidden)) spec.drawing = true;
  const xTitle = titleOf(child(xAxis, "title"));
  const yTitle = titleOf(child(yAxis, "title"));
  if (xTitle) spec.xTitle = xTitle;
  if (yTitle) spec.yTitle = yTitle;
  const xFormat = child(xAxis, "numFmt")?.attrs.formatCode;
  const yFormat = child(yAxis, "numFmt")?.attrs.formatCode;
  if (xFormat && xFormat !== "General") spec.xFormat = xFormat;
  if (yFormat && yFormat !== "General") spec.yFormat = yFormat;
  return spec;
}

const cellOf = (node: XmlNode | undefined): [number, number] => [
  Number(textOf(child(node, "row")) || 0),
  Number(textOf(child(node, "col")) || 0),
];

/** Every chart on the workbook's sheets, in sheet order; none for files that are not zipped XML. */
export function readCharts(bytes: Uint8Array): ChartSpec[] {
  const zip = openZip(bytes);
  if (!zip) return readBiffCharts(bytes);
  const workbook = readXml(zip, "xl/workbook.xml");
  if (!workbook) return [];
  const rels = relationships(zip, "xl/workbook.xml");
  const charts: ChartSpec[] = [];
  childrenNamed(child(child(workbook, "workbook"), "sheets"), "sheet").forEach((node, sheet) => {
    const part = rels.get(node.attrs["r:id"] ?? "")?.target;
    if (!part) return;
    for (const rel of relationships(zip, part).values()) {
      if (!rel.type.endsWith("/drawing")) continue;
      const drawing = readXml(zip, rel.target);
      if (!drawing) continue;
      const drawingRels = relationships(zip, rel.target);
      const anchors = [
        ...descendants(drawing, "twoCellAnchor"),
        ...descendants(drawing, "oneCellAnchor"),
      ];
      for (const anchor of anchors) {
        const [r1, c1] = cellOf(child(anchor, "from"));
        const to = child(anchor, "to");
        const [r2, c2] = to ? cellOf(to) : [r1 + 15, c1 + 7];
        for (const ref of descendants(anchor, "chart")) {
          const target = drawingRels.get(ref.attrs["r:id"] ?? "");
          if (!target?.type.endsWith("/chart")) continue;
          const xml = readXml(zip, target.target);
          const spec = xml && readChart(xml, sheet, [r1, c1, r2, c2]);
          if (spec) charts.push(spec);
        }
      }
    }
  });
  return charts;
}
