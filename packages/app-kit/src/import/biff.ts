import * as XLSX from "xlsx";
import type { ChartSeriesSpec, ChartSpec } from "../calc/model.js";
import { address, quoteSheet } from "../calc/model.js";

/**
 * Charts embedded in a legacy .xls workbook. BIFF8 keeps each one as a chart substream inside its
 * sheet's substream: series records with the formulas of the ranges they plot, the chart group's
 * type, its axes and title, and before it a drawing record whose client anchor places it on the
 * sheet.
 */

const BOF = 0x0809;
const EOF = 0x000a;
const BOUNDSHEET = 0x0085;
const EXTERNSHEET = 0x0017;
const MSODRAWING = 0x00ec;
const SERIES = 0x1003;
const DATAFORMAT = 0x1006;
const LINEFORMAT = 0x1007;
const MARKERFORMAT = 0x1009;
const SERIESTEXT = 0x100d;
const BAR = 0x1017;
const LINE = 0x1018;
const PIE = 0x1019;
const AREA = 0x101a;
const SCATTER = 0x101b;
const AXIS = 0x101d;
const TICK = 0x101e;
const TEXT = 0x1025;
const OBJECTLINK = 0x1027;
const BEGIN = 0x1033;
const END = 0x1034;
const BRAI = 0x1051;
const AXISLINEFORMAT = 0x1021;

const CHART_STREAM = 0x0020;
const WORKSHEET = 0x0010;

type Draft = {
  kind?: ChartSpec["kind"];
  stacked?: boolean;
  title?: string;
  series: Array<Partial<ChartSeriesSpec> & { values?: string }>;
  /** Each axis: whether its labels and its line are hidden, as a drawing to scale has them. */
  axes: Array<{ labels: boolean; line: boolean }>;
};

function workbookStream(bytes: Uint8Array): Uint8Array | null {
  if (bytes[0] !== 0xd0 || bytes[1] !== 0xcf) return null;
  try {
    const cfb = XLSX.CFB.read(bytes, { type: "array" });
    const entry = XLSX.CFB.find(cfb, "/Workbook") ?? XLSX.CFB.find(cfb, "/Book");
    const content = entry?.content as Uint8Array | number[] | undefined;
    if (!content) return null;
    return content instanceof Uint8Array ? content : new Uint8Array(content);
  } catch {
    return null;
  }
}

/** A short BIFF string: its length, a flag for two-byte characters, then the characters. */
function biffString(data: DataView, at: number, length: number): string {
  if (at >= data.byteLength) return "";
  const wide = data.getUint8(at) & 1;
  let out = "";
  for (let i = 0, p = at + 1; i < length && p < data.byteLength; i++, p += wide ? 2 : 1)
    out += String.fromCharCode(wide ? data.getUint16(p, true) : data.getUint8(p));
  return out;
}

/** The ranges a chart formula names (Area3d and Ref3d tokens), as A1 references. */
function formulaRanges(
  data: DataView,
  at: number,
  size: number,
  sheetOf: (ixti: number) => string | undefined,
): string[] {
  const out: string[] = [];
  const end = Math.min(data.byteLength, at + size);
  let p = at;
  while (p < end) {
    const ptg = data.getUint8(p);
    const base = ptg & 0x9f;
    if (base === 0x1b && p + 11 <= end) {
      const sheet = sheetOf(data.getUint16(p + 1, true));
      const r1 = data.getUint16(p + 3, true);
      const r2 = data.getUint16(p + 5, true);
      const c1 = data.getUint16(p + 7, true) & 0x3fff;
      const c2 = data.getUint16(p + 9, true) & 0x3fff;
      if (sheet !== undefined) out.push(`${quoteSheet(sheet)}!${abs(r1, c1)}:${abs(r2, c2)}`);
      p += 11;
    } else if (base === 0x1a && p + 7 <= end) {
      const sheet = sheetOf(data.getUint16(p + 1, true));
      const r = data.getUint16(p + 3, true);
      const c = data.getUint16(p + 5, true) & 0x3fff;
      if (sheet !== undefined) out.push(`${quoteSheet(sheet)}!${abs(r, c)}`);
      p += 7;
    } else if (base === 0x06) p += 7;
    else if (base === 0x09) p += 3;
    else if (ptg === 0x10 || ptg === 0x15) p += 1;
    else break;
  }
  return out;
}

const abs = (row: number, col: number) => address(row, col).replace(/^([A-Z]+)(\d+)$/, "$$$1$$$2");

const joined = (ranges: string[]) => (ranges.length > 1 ? `(${ranges.join(",")})` : ranges[0]);

/** The last client anchor (top-left and bottom-right cells) in a drawing record. */
function clientAnchor(data: DataView): ChartSpec["anchor"] | null {
  let found: ChartSpec["anchor"] | null = null;
  for (let p = 0; p + 26 <= data.byteLength; p++) {
    if (data.getUint16(p + 2, true) !== 0xf010 || data.getUint32(p + 4, true) !== 18) continue;
    const at = p + 8;
    found = [
      data.getUint16(at + 6, true),
      data.getUint16(at + 2, true),
      data.getUint16(at + 14, true),
      data.getUint16(at + 10, true),
    ];
  }
  return found;
}

function finish(draft: Draft, sheet: number, anchor: ChartSpec["anchor"]): ChartSpec | null {
  const kind = draft.kind;
  if (!kind) return null;
  const series = draft.series.flatMap((item): ChartSeriesSpec[] => {
    if (!item.values) return [];
    const spec: ChartSeriesSpec = { y: item.values };
    if (item.x) spec.x = item.x;
    if (item.nameRef) spec.nameRef = item.nameRef;
    else if (item.name) spec.name = item.name;
    if (kind === "scatter" || kind === "line") {
      spec.line = item.line ?? true;
      spec.marker = item.marker ?? true;
    }
    return [spec];
  });
  if (!series.length) return null;
  const spec: ChartSpec = { sheet, kind, anchor, series };
  if (draft.title) spec.title = draft.title;
  if (draft.stacked) spec.stacked = true;
  if (kind !== "pie" && draft.axes.length && draft.axes.every((axis) => !axis.labels || !axis.line))
    spec.drawing = true;
  return spec;
}

/** Every chart embedded on the sheets of a BIFF8 (.xls) workbook, in sheet order. */
export function readBiffCharts(bytes: Uint8Array): ChartSpec[] {
  const stream = workbookStream(bytes);
  if (!stream) return [];
  const data = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const sheets: Array<{ offset: number; name: string }> = [];
  const xti: number[] = [];
  const charts: ChartSpec[] = [];
  const stack: number[] = [];
  let sheet = -1;
  let started = false;
  let anchor: ChartSpec["anchor"] | null = null;
  let draft: Draft | null = null;
  let depth = 0;
  let seriesDepth = -1;
  let textDepth = -1;
  let pendingText: string | undefined;
  let wholeSeries = false;
  let axisLine = false;
  const sheetOf = (ixti: number) => sheets[xti[ixti] ?? -1]?.name;

  for (let p = 0; p + 4 <= data.byteLength; ) {
    const type = data.getUint16(p, true);
    const size = data.getUint16(p + 2, true);
    const at = p + 4;
    const body = new DataView(
      stream.buffer,
      stream.byteOffset + at,
      Math.min(size, data.byteLength - at),
    );
    p = at + size;
    if (type === BOF) {
      const kind = body.byteLength >= 4 ? body.getUint16(2, true) : 0;
      // The first substream holds the workbook globals; each later top-level one is a sheet.
      if (!stack.length && started) {
        sheet = sheets.findIndex((item) => item.offset === at - 4);
        anchor = null;
      }
      started = true;
      stack.push(kind);
      if (kind === CHART_STREAM && stack.length === 2 && stack[0] === WORKSHEET) {
        draft = { series: [], axes: [] };
        axisLine = false;
        depth = 0;
        seriesDepth = -1;
        textDepth = -1;
      }
      continue;
    }
    if (type === EOF) {
      const kind = stack.pop();
      if (kind === CHART_STREAM && draft) {
        const spec = sheet >= 0 && anchor ? finish(draft, sheet, anchor) : null;
        if (spec) charts.push(spec);
        draft = null;
      }
      continue;
    }
    if (stack.length === 1 && sheet < 0) {
      if (type === BOUNDSHEET && body.byteLength >= 8) {
        const length = body.getUint8(6);
        sheets.push({ offset: body.getUint32(0, true), name: biffString(body, 7, length) });
      } else if (type === EXTERNSHEET && body.byteLength >= 2) {
        const count = body.getUint16(0, true);
        for (let i = 0; i < count && 2 + i * 6 + 6 <= body.byteLength; i++)
          xti.push(body.getUint16(2 + i * 6 + 2, true));
      }
      continue;
    }
    if (stack.length === 1 && type === MSODRAWING) {
      const found = clientAnchor(body);
      if (found) anchor = found;
      continue;
    }
    if (!draft) continue;
    const current = draft.series[draft.series.length - 1];
    switch (type) {
      case BEGIN:
        depth++;
        break;
      case END:
        depth--;
        if (depth === seriesDepth) seriesDepth = -1;
        if (depth === textDepth) {
          textDepth = -1;
          pendingText = undefined;
        }
        break;
      case SERIES:
        draft.series.push({});
        seriesDepth = depth;
        break;
      case TEXT:
        textDepth = depth;
        pendingText = undefined;
        break;
      case OBJECTLINK:
        if (textDepth >= 0 && body.getUint16(0, true) === 1 && pendingText)
          draft.title = pendingText.replace(/\s+/g, " ").trim() || undefined;
        break;
      case SERIESTEXT: {
        const text = biffString(body, 3, body.getUint8(2));
        if (textDepth >= 0) pendingText = text;
        else if (seriesDepth >= 0 && current) current.name = text.trim() || undefined;
        break;
      }
      case BRAI: {
        if (seriesDepth < 0 || !current || textDepth >= 0 || body.byteLength < 8) break;
        const id = body.getUint8(0);
        const ranges =
          body.getUint8(1) === 2 ? formulaRanges(body, 8, body.getUint16(6, true), sheetOf) : [];
        const ref = joined(ranges);
        if (!ref) break;
        if (id === 0) current.nameRef = ref;
        else if (id === 1) current.values = ref;
        else if (id === 2) current.x = ref;
        break;
      }
      case DATAFORMAT:
        wholeSeries = body.getUint16(0, true) === 0xffff;
        break;
      case LINEFORMAT:
        if (axisLine) {
          const axis = draft.axes[draft.axes.length - 1];
          if (axis && body.byteLength >= 6 && body.getUint16(4, true) === 5) axis.line = false;
          axisLine = false;
        } else if (seriesDepth >= 0 && current && wholeSeries && body.byteLength >= 10)
          current.line = (body.getUint16(8, true) & 1) === 1 || body.getUint16(4, true) !== 5;
        break;
      case MARKERFORMAT:
        if (seriesDepth >= 0 && current && wholeSeries && body.byteLength >= 12)
          current.marker = (body.getUint16(10, true) & 1) === 1 || body.getUint16(8, true) !== 0;
        break;
      case BAR:
        if (!draft.kind && body.byteLength >= 6) {
          const flags = body.getUint16(4, true);
          draft.kind = flags & 1 ? "bar" : "column";
          if (flags & 2) draft.stacked = true;
        }
        break;
      case LINE:
      case AREA:
        if (!draft.kind) {
          draft.kind = type === LINE ? "line" : "area";
          if (body.byteLength >= 2 && body.getUint16(0, true) & 1) draft.stacked = true;
        }
        break;
      case PIE:
        draft.kind ??= "pie";
        break;
      case SCATTER:
        draft.kind ??= "scatter";
        break;
      case AXIS:
        draft.axes.push({ labels: true, line: true });
        break;
      case TICK: {
        const axis = draft.axes[draft.axes.length - 1];
        if (axis && body.byteLength >= 3 && body.getUint8(2) === 0) axis.labels = false;
        break;
      }
      case AXISLINEFORMAT:
        axisLine = body.getUint16(0, true) === 0;
        break;
    }
  }
  return charts;
}

const NAME = 0x0018;
const BUILTIN_PRINT_AREA = 0x06;

/**
 * Each sheet's print area in a BIFF8 (.xls) workbook, as A1 references: every range of a name
 * printing several areas, which other readers cut to one.
 */
export function readBiffPrintAreas(bytes: Uint8Array): Array<{ sheet: number; ref: string }> {
  const stream = workbookStream(bytes);
  if (!stream) return [];
  const data = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const sheets: string[] = [];
  const xti: number[] = [];
  const names: Array<{ sheet: number; body: DataView; at: number; size: number }> = [];
  for (let p = 0, started = false; p + 4 <= data.byteLength; ) {
    const type = data.getUint16(p, true);
    const size = data.getUint16(p + 2, true);
    const at = p + 4;
    const body = new DataView(
      stream.buffer,
      stream.byteOffset + at,
      Math.min(size, data.byteLength - at),
    );
    p = at + size;
    if (type === BOF) {
      if (started) break;
      started = true;
    } else if (type === EOF) break;
    else if (type === BOUNDSHEET && body.byteLength >= 8)
      sheets.push(biffString(body, 7, body.getUint8(6)));
    else if (type === EXTERNSHEET && body.byteLength >= 2) {
      const count = body.getUint16(0, true);
      for (let i = 0; i < count && 2 + i * 6 + 6 <= body.byteLength; i++)
        xti.push(body.getUint16(2 + i * 6 + 2, true));
    } else if (type === NAME && body.byteLength >= 16) {
      const builtin = (body.getUint16(0, true) & 0x20) !== 0;
      const length = body.getUint8(3);
      const formula = body.getUint16(4, true);
      const itab = body.getUint16(8, true);
      if (!builtin || itab === 0 || length !== 1) continue;
      const wide = body.getUint8(14) & 1;
      if ((wide ? body.getUint16(15, true) : body.getUint8(15)) !== BUILTIN_PRINT_AREA) continue;
      names.push({ sheet: itab - 1, body, at: 15 + (wide ? 2 : 1), size: formula });
    }
  }
  return names.flatMap(({ sheet, body, at, size }) => {
    const ranges = formulaRanges(body, at, size, (ixti) => sheets[xti[ixti] ?? -1]);
    return ranges.length ? [{ sheet, ref: ranges.join(",") }] : [];
  });
}
