import type { CalcModel, CellSpec, CellStyle, ChartSpec, InputSpec } from "./model.js";
import { address, quoteSheet } from "./model.js";

/**
 * How a calculating sheet reads as an app: its headings become sections, label-value-unit runs
 * become fields, values under a row of column headings become tables, and results the sheet
 * stresses (verdicts, utilisation ratios, bold figures, a results heading) become key results. It
 * is derived from the model alone and only names cells; every figure shown still comes from the
 * engine.
 */

export type LayoutField = {
  /** "Sheet!B3". */
  address: string;
  label: string;
  /** In a table, the row's label (the column's is `label`); for a key result, what tells it apart. */
  row?: string;
  /** A label the sheet calculates, shown from this cell. */
  labelAddress?: string;
  /** Parts of `label` and `row` the sheet calculates ("SPAN 2"), shown from their cells. */
  live?: LabelSource[];
  unit?: string;
  /** Text after the value, a description before its label, or a calculated remark beside it. */
  hint?: string;
  hintAddress?: string;
  input: boolean;
  /** The sheet sets it in bold. */
  strong?: boolean;
  /** Its label reads as a design effect over a resistance (utilisation, unity check). */
  ratio?: boolean;
  /** It holds a verdict (OK, FAIL, VALID DESIGN…) rather than a figure. */
  status?: boolean;
  /** The code clause, equation or table it follows ("Equation (6.7)"), shown as a badge. */
  reference?: string;
};

/** A calculated part of a label: the text it was saved with and the cell that gives it now. */
export type LabelSource = { text: string; address: string; from: string };

export type LayoutTable = {
  columns: string[];
  /** Headings over runs of columns (Column 1, Column 2 over their DEAD, IMPOSED, WIND). */
  groups?: Array<{ label: string; span: number }>;
  /** Calculated parts of column and group headings. */
  live?: LabelSource[];
  rows: Array<{
    label: string;
    live?: LabelSource[];
    cells: Array<LayoutField | null>;
    hintAddress?: string;
    hint?: string;
    reference?: string;
  }>;
};

export type LayoutBlock =
  | { kind: "fields"; fields: LayoutField[] }
  | { kind: "table"; table: LayoutTable }
  | { kind: "note"; text?: string; address?: string; strong?: boolean };

export type LayoutSection = {
  title: string;
  /** Calculated parts of the title. */
  live?: LabelSource[];
  /** `project`: the sheet's title block (project, client, made by…), its notes the design's title. */
  role?: "project";
  blocks: LayoutBlock[];
  inputs: number;
  outputs: number;
};

export type LayoutChart = ChartSpec & {
  caption?: string;
  /** The section it sits beside on the sheet, by index into `sections`. */
  section?: number;
};

export type SheetLayout = {
  sheet: number;
  name: string;
  sections: LayoutSection[];
  charts: LayoutChart[];
  /** The sheet's own overall verdicts (a STATUS cell, a bold verdict), most prominent first. */
  statuses: string[];
  /** Every verdict on the sheet, overall or not, in reading order. */
  checks: string[];
  /** Figures worth a card at the top: utilisation ratios, a results section, bold results. */
  key: LayoutField[];
  /** Where the sheet came from and its version and copyright, for a line at the foot of the page. */
  footer: LayoutBlock[];
  /** Open cells left off the page as gaps in the form rather than settings. */
  ignored?: string[];
  inputs: number;
  outputs: number;
};

type Token = {
  row: number;
  col: number;
  cell: CellSpec | undefined;
  style: CellStyle | undefined;
  input: InputSpec | undefined;
  kind: "value" | "text" | "dynamic";
  text: string;
};

type Area = [number, number, number, number];

const key = (row: number, col: number) => row * 16384 + col;
const LABEL_REACH = 3;
const MAX_LABEL_REACH = 9;
const HEADER_REACH = 8;
const MAX_FIELDS = 800;
const MAX_KEY = 4;
/** A row named for two entries side by side: "a1 & b1". */
const PAIR_NAME = /^(\p{L}[\p{L}\d,]{0,5}) & (\p{L}[\p{L}\d,]{0,5})$/u;

const UNIT =
  /^(\(?(mm|cm|m|km|in|ft|m[²³234]|mm[²³234]|cm[²³234]|kn|n|knm|kn\.?m|nm|mpa|gpa|kpa|pa|psi|kg|t|tonnes?|kn\/m[²³23]?|n\/mm[²³23]?|kg\/m[²³23]|mm[²2]\/m|kn\/m\/m|knm\/m|deg|degrees?|°|rad|%|‰|s|sec|mins?|hrs?|hours?|days?|years?|yrs?|no\.?|nr|€|£|\$|eur|gbp|kw|w|kwh|l|litres?|m\/s|km\/h|°c|deg c|k|hz|ratio|μstrain|microstrain)\)?)$/i;
/** "mm4 106" as sheets write mm⁴ × 10⁶. */
const SCALED_UNIT = /^(mm|cm|m)([234²³⁴])\s*(?:x\s*)?10([3-9]|1[0-2])$/i;
const SUPERSCRIPT: Record<string, string> = {
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "0": "⁰",
  "1": "¹",
};

/** Short text after a figure that reads as its unit: a known one, or a compound like kN/m² or (mm). */
export function isUnit(text: string): boolean {
  const trimmed = text.trim();
  if (/^n\/?a$/i.test(trimmed)) return false;
  return (
    UNIT.test(trimmed) ||
    SCALED_UNIT.test(trimmed) ||
    (/^\(?[a-zµ°%][\w²³°/.·\-^]{0,9}\)?$/i.test(trimmed) && /[/²³]|^\(.*\)$/.test(trimmed))
  );
}

const REFERENCE_WORD =
  /^(cl(ause)?|equn?|eqn?|equation|exp(ression)?|table|fig(ure)?|annex|section|app(endix)?)\.?\s*\(?[A-Z]?\d+(\.\d+)*[A-Za-z]?\)?(\s*\(\w+\))?$/i;

/**
 * Text citing the design code beside a figure: a clause, equation, table or figure ("cl 6.2.2",
 * "equation (6.7)", "Table 3.8"), or a bracketed or dotted clause number ("(6.10b)", "6.2.1 (8)").
 */
export function isReference(text: string): boolean {
  let bare = text.replace(/\s+/g, " ").trim();
  let bracketed = false;
  while (/^\(.*\)$/.test(bare) && !/^\([^)]*\)\s*\(/.test(bare)) {
    bare = bare.slice(1, -1).trim();
    bracketed = true;
  }
  bare = bare
    .replace(/^see\s+/i, "")
    .replace(/^(BS\s*)?EN\s*\d{3,5}(-\d+)*(:\s*\d{4})?\s*[-,]?\s*/i, "");
  if (!bare || bare.length > 30) return false;
  if (REFERENCE_WORD.test(bare)) return true;
  return /^[A-Z]?\d+(\.\d+)+[a-z]?(\s*\(\w+\))?$/.test(bare) && (bracketed || /\..*\./.test(bare));
}

/** A reference as a badge reads it: without the brackets around it. */
export function tidyReference(text: string): string {
  let bare = text.replace(/\s+/g, " ").trim();
  while (/^\(.*\)$/.test(bare) && !/^\([^)]*\)\s*\(/.test(bare)) bare = bare.slice(1, -1).trim();
  bare = bare.replace(/^see\s+/i, "").replace(/\s+-\s+/, " ");
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

/** A unit as it reads best: "mm4 106" → "×10⁶ mm⁴"; anything else as written. */
export function tidyUnit(text: string): string {
  const trimmed = text.trim();
  const scaled = SCALED_UNIT.exec(trimmed);
  if (!scaled) return trimmed;
  const power = (digits: string) => [...digits].map((d) => SUPERSCRIPT[d] ?? d).join("");
  const unitPower = scaled[2]!.replace(/[²³⁴]/, (s) => ({ "²": "2", "³": "3", "⁴": "4" })[s]!);
  return `×10${power(scaled[3]!)} ${scaled[1]}${power(unitPower)}`;
}

const DANGER =
  /\b(fail(s|ed|ure)?|not ok|not valid|invalid|inadequate|unsatisfactory|exceed(s|ed)?|unsafe|no good|overstressed|not adequate|not acceptable|redesign)\b|✗|✘/i;
const SUCCESS =
  /^\s*(ok|okay|pass(es|ed)?|adequate|satisfactory|valid|safe|acceptable|compl(ies|iant))\b|valid design|^\s*√\s*$|✓|✔/i;
const WARNING = /\b(warning|caution|marginal|check|review|attention)\b/i;

/** How a verdict reads: success (OK, PASS, VALID DESIGN), danger (FAIL, NOT OK) or warning. */
export function statusTone(text: string): "success" | "danger" | "warning" | null {
  if (!text.trim()) return null;
  if (DANGER.test(text)) return "danger";
  if (SUCCESS.test(text)) return "success";
  if (WARNING.test(text)) return "warning";
  return null;
}

/** A verdict is short: a sentence that happens to contain "check" is a note. */
/** Words a heading a formula writes under a chart uses: "Mx Diagram (1.35G+1.05Q)". */
const CHART_WORDS = /\b(diagram|chart|graph|plot|elevation|section|profile)\b/i;

const isVerdict = (text: string) => text.trim().length <= 60 && statusTone(text) !== null;

const RATIO_WORDS = /\b(utili[sz]ation|util|unity|efficiency|interaction ratio|u\.?f\.?)\b/i;
/** An effect over a resistance or limit: vEd/vRd,c, qEQP/qRd, As,req/As,prov, M/Mlim. */
const RATIO_FORM =
  /^\(?\s*[\p{L}][\p{L}\p{N},.'′ ]{0,12}\s*\/\s*\(?\s*[\p{L}]{0,4}[\s,]*(rd|rk|r,d|lim|max|allow|perm|prov|cap|res|ult|crit|adm)/iu;
const FORMULA_TEXT = /[()[\]+*^√=]|\b(tan|sin|cos|min|max|sqrt|log)\s*[([]/i;

/** Whether a label reads as a utilisation: an effect over a resistance, or named as one. */
export function isRatioLabel(label: string): boolean {
  const text = label.trim();
  if (!text) return false;
  if (RATIO_WORDS.test(text)) return true;
  return RATIO_FORM.test(text) && !FORMULA_TEXT.test(text.replace(/^\(|\)$/g, ""));
}

const STATUS_LABEL = /\b(status|checks?|result|verdict|adequacy|ok\?|outcome)\b/i;
const RESULT_TITLE = /\b(results?|calculated|summary|conclusions?|outputs?|final|answers?)\b/i;
const TITLE_WORDS =
  /^(project|client|location|job( no| number)?|made by|checked|date|page|revision|rev|ref|by|calc(ulation)? by|sheet)$/i;
/** The labels of a calculation sheet's title block. */
const TITLE_FIELD =
  /^(project( no\.?| title)?|client|location|job( no\.?| number| ref\.?)?|made by|checked( by)?|date|page( no\.?)?|revision|rev\.?|calc(ulation)? (by|no\.?)|drawn by|designed by|approved( by)?|sheet no\.?)$/i;
const TITLE_ORDER = [
  /^project/i,
  /^client/i,
  /^location/i,
  /^job/i,
  /^page|^sheet/i,
  /^(made|drawn|designed|calc)/i,
  /^date/i,
  /^check/i,
  /^(rev|approved)/i,
];
/** Where a sheet came from, its version and copyright: true of every copy, so not part of the design. */
const BOILERPLATE =
  /\boriginated from\b|©|\bcopyright\b|\(c\)\s*(19|20)\d\d|^\s*v\s?\d+(\.\d+)+\s*$|\bv\s?\d+(\.\d+)*\s+on\s+cd\b/i;
/** Words a cell holds as a choice, never as what names one. */
const OPTION_WORD = /^(yes|no|y|n|true|false|on|off|def|default|n\/a|none|-+|\?+)$/i;

/** Text that is boilerplate (where the sheet came from, its version or copyright). */
export function isBoilerplate(text: string): boolean {
  return BOILERPLATE.test(text.replace(/\s+/g, " "));
}

/** The words every choice starts with ("β Using Factors =", "β Calculating =" → "β"), or null. */
export function optionsPrefix(options: ReadonlyArray<string | number> | undefined): string | null {
  const texts = (options ?? []).filter((item): item is string => typeof item === "string");
  if (texts.length < 2 || new Set(texts).size < 2) return null;
  const words = texts.map((text) => text.trim().split(/\s+/));
  const common: string[] = [];
  for (let index = 0; words.every((list) => index < list.length - 1); index++) {
    const word = words[0]![index]!;
    if (!words.every((list) => list[index] === word)) break;
    common.push(word);
  }
  const prefix = cleanLabel(common.join(" "));
  if (meaningful(prefix) && !OPTION_WORD.test(prefix) && prefix.length <= 30) return prefix;
  // "USE CODE Veff/Vt FACTORS" | "INPUT ACTUAL Veff": the one term every choice names.
  const terms = texts.map((text) => text.split(/[\s/]+/).filter((term) => /\p{L}{2}/u.test(term)));
  const shared = terms[0]!.filter(
    (term) => !STOP_WORD.test(term) && terms.every((list) => list.includes(term)),
  );
  return shared.length === 1 && !OPTION_WORD.test(shared[0]!) ? shared[0]! : null;
}

const countsBars = (text: string) => /^(no|nr)\.?$/i.test(cleanLabel(text));

const STOP_WORD = /^(the|an?|of|to|and|or|in|on|for|with|by|at|is|use)$/i;

/** "ENTER DATA IN BLUE CELLS ONLY." or "Red messages indicate entry errors.": instructions, not names. */
export function isInstruction(text: string): boolean {
  const flat = cleanLabel(text);
  const words = flat.split(/\s+/).length;
  if (words < 3 || /^\S+\s*=/.test(flat)) return false;
  return (/[.!]$/.test(flat) && shouty(flat)) || /^(enter|press|click|select|type)\b/i.test(flat);
}

/** "  L = " → "L"; "fck:" → "fck". */
export function cleanLabel(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[\s=:≈~,]+$/u, "")
    .trim();
}

const meaningful = (text: string) => /[\p{L}\p{N}]/u.test(text);

const letters = (text: string) => text.replace(/[^\p{L}]/gu, "");
const shouty = (text: string) => {
  const all = letters(text);
  return all.length >= 4 && all.replace(/[^\p{Lu}]/gu, "").length / all.length >= 0.7;
};

function hiddenText(style: CellStyle | undefined) {
  if (!style?.color) return false;
  const color = style.color.toLowerCase();
  return color === (style.fill ?? "#ffffff").toLowerCase();
}

const hasContent = (cell: CellSpec | undefined) =>
  !!cell &&
  (cell.f !== undefined ||
    (cell.v !== undefined && cell.v !== null && !(typeof cell.v === "string" && !cell.v.trim())));

/** The columns of the sheet's face: the band of filled cells most of its content sits in. */
function faceColumns(
  cells: Array<[number, number, CellSpec]>,
  styles: CellStyle[],
  hiddenRows: Set<number>,
): ((col: number) => boolean) | null {
  const filled = new Map<number, number>();
  const texts = new Map<number, number>();
  let shown = 0;
  let painted = 0;
  for (const [row, col, cell] of cells) {
    if (hiddenRows.has(row) || !hasContent(cell)) continue;
    shown += 1;
    if (typeof cell.v === "string") texts.set(col, (texts.get(col) ?? 0) + 1);
    if (cell.s !== undefined && styles[cell.s]?.fill) {
      painted += 1;
      filled.set(col, (filled.get(col) ?? 0) + 1);
    }
  }
  if (!shown || painted / shown < 0.3) return null;
  const cols = [...filled.keys()].sort((a, b) => a - b);
  const bands: Array<{ from: number; to: number; count: number }> = [];
  for (const col of cols) {
    const last = bands[bands.length - 1];
    if (last && col - last.to <= 2) {
      last.to = col;
      last.count += filled.get(col)!;
    } else bands.push({ from: col, to: col, count: filled.get(col)! });
  }
  const best = bands.reduce((a, b) => (b.count > a.count ? b : a));
  // Unpainted labels just left of the painted cells name them.
  let from = best.from;
  while ((texts.get(from - 1) ?? 0) >= 3 || (texts.get(from - 2) ?? 0) >= 3)
    from -= (texts.get(from - 1) ?? 0) >= 3 ? 1 : 2;
  return (col) => col >= from && col <= best.to;
}

/**
 * The part of a sheet laid out for reading: its print area, taller where the sheet's inputs sit
 * above or below it in the same columns (a workbook printing only its second page still shows its
 * first, where people type).
 */
export function readingArea(area: Area, inputs: Array<{ row: number; col: number }>): Area {
  let [r1, , r2] = area;
  const [, c1, , c2] = area;
  for (const input of inputs) {
    if (input.col < c1 || input.col > c2) continue;
    r1 = Math.min(r1, input.row);
    r2 = Math.max(r2, input.row);
  }
  return [r1, c1, r2, c2];
}

/**
 * Where a sheet laid out as pages side by side (each with the same title block) starts its next
 * page: the column the first rows' labels repeat at, or null.
 */
const columnIndex = (letters: string) =>
  [...letters].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
const REFERENCE =
  /(?<![\w$.'])(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.~]*))!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?(?![\w(])/g;

/** Every cell a reference text covers, as sheet:row:col keys; huge ranges are skipped. */
function referencedCells(text: string, own: number, sheets: Map<string, number>): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(REFERENCE)) {
    const name = match[1]?.replace(/''/g, "'") ?? match[2];
    const sheet = name === undefined ? own : sheets.get(name);
    if (sheet === undefined) continue;
    const c1 = columnIndex(match[3]!);
    const r1 = Number(match[4]) - 1;
    const c2 = match[5] ? columnIndex(match[5]) : c1;
    const r2 = match[6] ? Number(match[6]) - 1 : r1;
    if ((r2 - r1 + 1) * (c2 - c1 + 1) > 2000) continue;
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(`${sheet}:${r}:${c}`);
  }
  return out;
}

const readCache = new WeakMap<CalcModel, Array<[number, number, number, number, number]>>();
/** Whether any formula reads a cell, directly or (unless `direct`) through a range. */
export function cellIsRead(
  model: CalcModel,
  sheet: number,
  row: number,
  col: number,
  direct = false,
): boolean {
  let ranges = readCache.get(model);
  if (!ranges) {
    const names = new Map(model.sheets.map((item, index) => [item.name, index]));
    const found: Array<[number, number, number, number, number]> = [];
    model.sheets.forEach((item, index) => {
      for (const [, , cell] of item.cells) {
        if (cell.f === undefined) continue;
        for (const match of (model.formulas[cell.f]?.text ?? "").matchAll(REFERENCE)) {
          const name = match[1]?.replace(/''/g, "'") ?? match[2];
          const at = name === undefined ? index : names.get(name);
          if (at === undefined) continue;
          const c1 = columnIndex(match[3]!);
          const r1 = Number(match[4]) - 1;
          found.push([
            at,
            r1,
            c1,
            match[6] ? Number(match[6]) - 1 : r1,
            match[5] ? columnIndex(match[5]) : c1,
          ]);
        }
      }
    });
    readCache.set(model, found);
    ranges = found;
  }
  return ranges.some(
    ([at, r1, c1, r2, c2]) =>
      at === sheet &&
      row >= r1 &&
      row <= r2 &&
      col >= c1 &&
      col <= c2 &&
      (!direct || (r1 === r2 && c1 === c2)),
  );
}

const chartOnlyCache = new WeakMap<CalcModel, Set<string>>();
/**
 * Formula cells whose results reach nothing but charts (sheet:row:col keys): every cell that
 * reads them, however indirectly, ends in a chart's plotted range.
 */
export function chartOnlyCells(model: CalcModel): Set<string> {
  const cached = chartOnlyCache.get(model);
  if (cached) return cached;
  const sheets = new Map(model.sheets.map((sheet, index) => [sheet.name, index]));
  const feed = new Set<string>();
  for (const chart of model.charts ?? [])
    for (const series of chart.series)
      for (const ref of [series.x, series.y])
        if (ref) for (const cell of referencedCells(ref, chart.sheet, sheets)) feed.add(cell);
  const readers = new Map<string, string[]>();
  const formulaCells = new Set<string>();
  if (feed.size)
    model.sheets.forEach((sheet, index) => {
      for (const [row, col, cell] of sheet.cells) {
        if (cell.f === undefined) continue;
        const self = `${index}:${row}:${col}`;
        formulaCells.add(self);
        for (const read of new Set(
          referencedCells(model.formulas[cell.f]?.text ?? "", index, sheets),
        )) {
          const list = readers.get(read);
          if (list) list.push(self);
          else readers.set(read, [self]);
        }
      }
    });
  const state = new Map<string, boolean | null>();
  const only = (cell: string, depth: number): boolean => {
    const known = state.get(cell);
    if (known !== undefined) return known === true;
    if (depth > 400) return false;
    state.set(cell, null);
    const list = readers.get(cell) ?? [];
    const result = list.length ? list.every((reader) => only(reader, depth + 1)) : feed.has(cell);
    state.set(cell, result);
    return result;
  };
  const out = new Set<string>();
  for (const cell of formulaCells) if (only(cell, 0)) out.add(cell);
  chartOnlyCache.set(model, out);
  return out;
}

/** The caption a label formula shows in its other mode: Dlow for IF(Y2="to D","Dlow",""). */
export function switchedLabel(formula: string): string | null {
  for (const match of formula.matchAll(/(=|<>)?\s*"([^"]*)"/g)) {
    if (match[1]) continue;
    const text = cleanLabel(match[2] ?? "");
    if (text && /\p{L}/u.test(text) && text.length <= 30) return text;
  }
  return null;
}

/** Column ranges split at empty columns, when each side holds a table of its own. */
export function columnBands(
  tokens: Array<{ col: number; kind: string }>,
  from: number,
  to: number,
): Array<[number, number]> {
  const count = new Map<number, number>();
  const texts = new Map<number, number>();
  for (const token of tokens) {
    count.set(token.col, (count.get(token.col) ?? 0) + 1);
    if (token.kind === "text") texts.set(token.col, (texts.get(token.col) ?? 0) + 1);
  }
  const bands: Array<[number, number]> = [];
  let start = -1;
  for (let c = from; c <= to + 1; c++) {
    if (c <= to && count.get(c)) {
      if (start < 0) start = c;
    } else if (start >= 0) {
      bands.push([start, c - 1]);
      start = -1;
    }
  }
  const size = ([c1, c2]: [number, number], map: Map<number, number>) => {
    let total = 0;
    for (let c = c1; c <= c2; c++) total += map.get(c) ?? 0;
    return total;
  };
  const merged: Array<[number, number]> = [];
  for (const band of bands) {
    const last = merged[merged.length - 1];
    if (last && (size(band, count) < 12 || !size(band, texts) || size(last, count) < 12))
      last[1] = band[1];
    else merged.push([...band]);
  }
  return merged;
}

export function repeatedPageColumn(
  rows: Array<Array<{ col: number; text: string }>>,
  from: number,
): number | null {
  const offsets = new Map<number, number>();
  for (const tokens of rows) {
    const texts = tokens.filter((token) => meaningful(token.text) && token.col >= from);
    for (const first of texts) {
      const label = cleanLabel(first.text).toLowerCase();
      if (label.length < 3) continue;
      for (const other of texts) {
        if (other.col <= first.col + 3 || cleanLabel(other.text).toLowerCase() !== label) continue;
        const offset = other.col - first.col;
        offsets.set(offset, (offsets.get(offset) ?? 0) + 1);
      }
    }
  }
  const best = [...offsets].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  if (!best || best[1] < 2) return null;
  const left = Math.min(
    ...rows.flatMap((tokens) => tokens.filter((t) => t.col >= from).map((t) => t.col)),
  );
  return left + best[0];
}

/** "Usage: " & X1 → "Usage": the text a formula puts before a cell is what the cell is. */
export function labelFromFormula(formula: string, ref: string): string | null {
  const escaped = ref.replace(/\$/g, "").replace(/([A-Z]+)(\d+)/i, "\\$?$1\\$?$2");
  const match = new RegExp(`"([^"]*\\p{L}[^"]*)"\\s*&\\s*${escaped}(?![0-9])`, "iu").exec(formula);
  if (!match) return null;
  const label = cleanLabel(match[1]!.replace(/[(\-–,]+\s*$/, ""));
  return label.length >= 2 && label.length <= 40 ? label : null;
}

/** The sections, fields, tables and charts a sheet shows as an app. */
export function sheetLayout(model: CalcModel, sheet: number): SheetLayout {
  const spec = model.sheets[sheet];
  const name = spec?.name ?? "";
  const empty: SheetLayout = {
    sheet,
    name,
    sections: [],
    charts: [],
    statuses: [],
    checks: [],
    key: [],
    footer: [],
    inputs: 0,
    outputs: 0,
  };
  if (!spec) return empty;
  const prefix = `${quoteSheet(name)}!`;
  const at = (row: number, col: number) => `${prefix}${address(row, col)}`;
  const hiddenRows = new Set(spec.hiddenRows ?? []);
  const hiddenCols = new Set(spec.hiddenCols ?? []);
  const sheetInputs = model.inputs.filter((input) => input.sheet === sheet);
  const inputs = new Map(sheetInputs.map((input) => [key(input.row, input.col), input]));
  const allCells = new Map(spec.cells.map(([row, col, cell]) => [key(row, col), cell]));
  const covered = new Set<number>();
  for (const [r1, c1, r2, c2] of spec.merges ?? [])
    for (let r = r1; r <= r2; r++)
      for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) covered.add(key(r, c));
  const area = spec.printArea ? readingArea(spec.printArea, sheetInputs) : undefined;
  const inArea = area
    ? (row: number, col: number) =>
        row >= area[0] && row <= area[2] && col >= area[1] && col <= area[3]
    : null;
  const filledCols = area ? null : faceColumns(spec.cells, model.styles, hiddenRows);
  const inFace = inArea ?? (filledCols ? (_row: number, col: number) => filledCols(col) : null);

  const tokenAt = new Map<number, Token>();
  const aside: InputSpec[] = [];
  for (const [row, col, cell] of spec.cells) {
    if (hiddenRows.has(row) || hiddenCols.has(col) || covered.has(key(row, col))) continue;
    const input = inputs.get(key(row, col));
    if (!hasContent(cell) && !input) continue;
    if (inFace && !inFace(row, col)) {
      if (input) aside.push(input);
      continue;
    }
    const style = cell.s === undefined ? undefined : model.styles[cell.s];
    if (!input && hiddenText(style)) continue;
    const saved = cell.v;
    const text = typeof saved === "string" ? saved : "";
    let kind: Token["kind"];
    if (input) kind = "value";
    else if (cell.f !== undefined) kind = typeof saved === "string" ? "dynamic" : "value";
    else if (typeof saved === "string") kind = /^n\/a$/i.test(saved.trim()) ? "value" : "text";
    else if (typeof saved === "number" || typeof saved === "boolean") kind = "value";
    else continue;
    if (kind !== "value" && !input && !meaningful(text) && cleanLabel(text) !== "%") continue;
    tokenAt.set(key(row, col), { row, col, cell, style, input, kind, text });
  }
  const tokens = [...tokenAt.values()].sort((a, b) => a.row - b.row || a.col - b.col);

  // Bold marks a key result only where most results are not bold; the same for bold labels.
  const results = tokens.filter((token) => token.kind !== "text" && !token.input);
  const boldStands =
    results.filter((token) => token.style?.bold).length <= Math.max(4, results.length * 0.3);
  const labelTexts = tokens.filter((token) => token.kind === "text");
  const boldLabelsStand =
    labelTexts.filter((token) => token.style?.bold).length <= Math.max(4, labelTexts.length * 0.2);
  // Workbooks saved without fonts (legacy files) mark headings in capitals instead.
  const bolded = tokens.some((token) => token.style?.bold);

  // What cells hold rather than what names them: an input's value, a formula's result.
  const valueTexts = new Set<string>();
  for (const [row, col, cell] of spec.cells)
    if (typeof cell.v === "string" && (cell.f !== undefined || inputs.has(key(row, col))))
      valueTexts.add(cleanLabel(cell.v).toLowerCase());
  /** Whether text may name an input: not a value, a choice, boilerplate or a unit. */
  const namesInput = (
    text: string | undefined,
    input?: InputSpec,
    beside = false,
  ): text is string => {
    if (!text) return false;
    const label = cleanLabel(text);
    return (
      meaningful(label) &&
      label.length <= 40 &&
      !OPTION_WORD.test(label) &&
      !isUnit(label) &&
      !isBoilerplate(label) &&
      (beside || !valueTexts.has(label.toLowerCase())) &&
      !(input?.options ?? []).some((option) => String(option).trim() === label)
    );
  };
  /** Plain text on the sheet (not an input or a formula's result), or null. */
  const staticText = (row: number, col: number): string | null => {
    const cell = allCells.get(key(row, col));
    if (inputs.has(key(row, col)) || cell?.f !== undefined || typeof cell?.v !== "string")
      return null;
    return meaningful(cell.v) ? cell.v : null;
  };
  const headingCount = (row: number) => {
    let count = 0;
    for (let c = 0; c < spec.cols; c++) if (staticText(row, c)) count++;
    return count;
  };
  /** Choices listed above a choice cell ("USE CODE FACTORS" / "INPUT ACTUAL") are not its name. */
  const listedAbove = (row: number, col: number) => {
    const current = allCells.get(key(row, col))?.v;
    return [1, 2, 3].some((step) => {
      const text = row >= step ? staticText(row - step, col) : null;
      return typeof current === "string" && text?.trim() === current.trim();
    });
  };
  /** Text on the sheet near a cell, for an input the face does not label. */
  const nearbyLabel = (input: InputSpec): string | null => {
    const { row, col } = input;
    for (let c = col - 1; c >= Math.max(0, col - 6); c--) {
      const cell = allCells.get(key(row, c));
      if (cell?.f !== undefined && !inputs.has(key(row, c)) && !cell.v) {
        const label = switchedLabel(model.formulas[cell.f]?.text ?? "");
        if (label && namesInput(label, input)) return label;
        if (label && isUnit(cleanLabel(label))) continue;
      }
      if (inputs.has(key(row, c)) || cell?.f !== undefined) break;
      const text = staticText(row, c);
      // Plain text right beside an input ("B | mm | 500") names it even if another cell holds "B".
      if (text) {
        if (namesInput(text, input, c >= col - 2)) return cleanLabel(text);
        if (!isUnit(cleanLabel(text))) break;
        continue;
      }
      if (cell && hasContent(cell)) break;
    }
    for (let r = row - 1; !listedAbove(row, col) && r >= Math.max(0, row - 2); r--) {
      const cell = allCells.get(key(r, col));
      if (inputs.has(key(r, col))) break;
      const text = staticText(r, col);
      if (text && namesInput(text, input) && cleanLabel(text).length <= 30) return cleanLabel(text);
      if (cell && hasContent(cell)) break;
    }
    // A question beside a choice ("Allow drained passive resistance?") is what it answers.
    for (let r = row - 1; r <= row + 2; r++)
      for (let c = col - 4; c <= col + 1; c++) {
        if (c < 0 || r < 0) continue;
        const text = staticText(r, c);
        if (text && /\?\s*$/.test(text) && text.length <= 80 && namesInput(text, input))
          return cleanLabel(text);
      }
    const ref = address(row, col);
    for (const [, , cell] of spec.cells) {
      if (cell.f === undefined) continue;
      const label = labelFromFormula(model.formulas[cell.f]?.text ?? "", ref);
      if (label && namesInput(label, input)) return label;
    }
    return null;
  };
  /** Whether the cell left of an input labels it, so its column is not one of unlabelled values. */
  const labelledInput = (row: number, col: number) => {
    const beside = col > 0 ? staticText(row, col - 1) : null;
    if (beside && !isUnit(cleanLabel(beside))) return true;
    const before = beside && col > 1 ? staticText(row, col - 2) : null;
    return !!before && !isUnit(cleanLabel(before));
  };
  /** The heading text at the top of a column of values, past the inputs and figures under it. */
  const headerAbove = (row: number, col: number): string | null => {
    let gap = 0;
    for (let r = row - 1; r >= Math.max(0, row - 40); r--) {
      if (inputs.has(key(r, col))) {
        if (labelledInput(r, col)) return null;
        continue;
      }
      const cell = allCells.get(key(r, col));
      if (!cell || !hasContent(cell)) {
        if (++gap > 1) return null;
        continue;
      }
      if (typeof cell.v !== "string") continue;
      const label = cleanLabel(cell.v);
      // "Bar Ø | No | Area": in a row of column headings "No" counts bars, it is not a choice.
      if (countsBars(label) && headingCount(r) >= 3) return "Number";
      if (!meaningful(label) || OPTION_WORD.test(label)) continue;
      if (cell.f !== undefined) return null;
      return label.length <= 30 && !isUnit(label) ? label : null;
    }
    return null;
  };
  /** The label of a cell a formula reading the input stands for: Lz for IF(I16="Def",…,I16). */
  const consumerLabel = (input: InputSpec): string | null => {
    const col = address(input.row, input.col).replace(/\d+$/, "");
    const reads = new RegExp(`(?<![A-Z$!:.])\\$?${col}\\$?${input.row + 1}(?![0-9:(])`, "i");
    for (const [row, c, cell] of spec.cells) {
      if (cell.f === undefined || inputs.has(key(row, c))) continue;
      const text = model.formulas[cell.f]?.text ?? "";
      if (text.length > 80 || !reads.test(text)) continue;
      for (let left = c - 1; left >= Math.max(0, c - 4); left--) {
        const label = staticText(row, left);
        if (!label) {
          if (hasContent(allCells.get(key(row, left)))) break;
          continue;
        }
        if (/^[\s=:≈]*$/.test(label.replace(/[^\p{L}\p{N}=:]/gu, ""))) continue;
        if (namesInput(label, input) && cleanLabel(label).length <= 30) return cleanLabel(label);
        break;
      }
    }
    return null;
  };
  /** A bold whole number in a heading row of sizes ("Ø | 12 | 16 | 20"). */
  const boldSize = (row: number, col: number) => {
    const cell = allCells.get(key(row, col));
    return (
      typeof cell?.v === "number" &&
      Number.isInteger(cell.v) &&
      cell.s !== undefined &&
      !!model.styles[cell.s]?.bold
    );
  };
  const unsaid: Token[] = [];
  /** A calculated bar type ("B", "H", or blank on an unused layer) between a bar count and its Ø. */
  const failed = (cell: CellSpec | undefined) =>
    cell?.f !== undefined && typeof cell.v === "object" && cell.v !== null && "e" in cell.v;
  const barType = (row: number, col: number) => {
    const cell = allCells.get(key(row, col));
    return (
      failed(cell) ||
      (cell?.f !== undefined && typeof cell.v === "string" && /^[A-Z]?$/.test(cell.v.trim()))
    );
  };
  const barSlot = (row: number, col: number) => {
    const count = allCells.get(key(row, col - 2));
    return barType(row, col - 1) && typeof count?.v === "number";
  };
  /**
   * "TOP STEEL | Layer 1 | 3 | B | [12] | 3 | B | [16]" under LEFT, CENTRE…: a bar's Ø entered
   * after its count and type, named by its row and column ("Top steel · Layer 1 · Left Ø").
   */
  const barLabel = (row: number, col: number): string | null => {
    if (!barSlot(row, col) || !(barSlot(row, col - 3) || barSlot(row, col + 3))) return null;
    let start = col;
    while (barSlot(row, start - 3)) start -= 3;
    const names: Array<{ col: number; text: string }> = [];
    for (let c = 0; c < start - 2; c++) {
      const cell = allCells.get(key(row, c));
      if (typeof cell?.v !== "string" || inputs.has(key(row, c))) continue;
      if (meaningful(cell.v)) names.push({ col: c, text: tidyTitle(cell.v) });
      else if (cell.f !== undefined) {
        // A name the sheet leaves blank until it applies ("Layer 2"), shown when it does.
        const said = new Set(
          [...(model.formulas[cell.f]?.text ?? "").matchAll(/"((?:[^"]|"")*)"/g)]
            .map((m) => m[1]!)
            .filter(Boolean),
        );
        const [only] = said;
        if (said.size !== 1 || !meaningful(only!)) continue;
        names.push({ col: c, text: only! });
        unsaid.push({
          row,
          col: c,
          cell,
          style: undefined,
          input: undefined,
          kind: "dynamic",
          text: only!,
        });
      }
    }
    const first = names[0]?.col ?? start - 2;
    for (let r = row - 1; r >= Math.max(0, row - 3) && first > 0; r--) {
      const parent = [...Array(first).keys()].map((c) => staticText(r, c)).find(Boolean);
      if (parent) {
        names.unshift({ col: 0, text: tidyTitle(parent) });
        break;
      }
    }
    let head: string | null = null;
    for (let r = row - 1; r >= Math.max(0, row - 20) && !head; r--) {
      const text = staticText(r, col - 1);
      if (text && !isUnit(cleanLabel(text))) head = cleanLabel(text);
    }
    if (!head || head.length > 16 || !names.length) return null;
    return `${names.map((name) => name.text).join(" · ")} · ${tidyTitle(head)} Ø`;
  };
  /** The nearest row of column headings above, two rows deep where it is ("End | Supports"). */
  const headingAbove = (row: number, col: number): string | null => {
    const heading = (r: number) => {
      const text = r >= 0 && headingCount(r) >= 3 ? staticText(r, col) : null;
      return text && !isUnit(cleanLabel(text)) ? cleanLabel(text) : null;
    };
    for (let r = row - 1; r >= Math.max(0, row - 30); r--) {
      // A page's title block (Checked, Job No…) ends the search.
      for (let c = 0; c < spec.cols; c++)
        if (TITLE_FIELD.test(cleanLabel(staticText(r, c) ?? ""))) return null;
      const name = heading(r);
      if (!name) continue;
      const upper = heading(r - 1);
      const joined = tidyTitle(upper ? `${upper} ${name}` : name);
      return joined.length <= 30 ? joined : null;
    }
    return null;
  };
  /** "Ø | 12 | 16 | 20" in bold atop a column of figures: the column reads as "Ø 16". */
  const sizeHeader = (row: number, col: number): string | null => {
    for (let r = row - 1, gaps = 0; r >= Math.max(0, row - 60); r--) {
      if (!hasContent(allCells.get(key(r, col)))) {
        if (++gaps > 1) return null;
        continue;
      }
      if (!boldSize(r, col) || !(boldSize(r, col - 1) || boldSize(r, col + 1))) continue;
      for (let c = col - 1; c >= Math.max(0, col - 16); c--) {
        const head = staticText(r, c);
        if (head === null) continue;
        const name = cleanLabel(head);
        return meaningful(name) && name.length <= 12
          ? `${name} ${allCells.get(key(r, col))!.v}`
          : null;
      }
      return null;
    }
    return null;
  };
  /** "SUPPORT No | 1 | 2 | 3" above a grid: the column reads as "Support 3". */
  const numberedHeader = (row: number, col: number): string | null => {
    for (let r = row - 1; r >= Math.max(0, row - 8); r--) {
      const cell = allCells.get(key(r, col));
      let n = typeof cell?.v === "number" && Number.isInteger(cell.v) ? cell.v : null;
      // "SUPPORT No | 1 | 2 | … | ''": a formula hiding a number past the last one in use.
      if (n === null && cell?.f !== undefined && typeof cell.v === "string" && !cell.v.trim())
        for (let c = col - 1; c >= Math.max(0, col - 6); c--) {
          const before = allCells.get(key(r, c));
          if (typeof before?.v === "number" && Number.isInteger(before.v)) {
            n = before.v + (col - c);
            break;
          }
          if (before?.f === undefined) break;
        }
      if (n === null) continue;
      for (let c = col - 1; c >= Math.max(0, col - 12); c--) {
        const head = staticText(r, c);
        if (!head) continue;
        const name = cleanLabel(head).replace(/\s*\b(no|nr|number)\.?$/i, "");
        if (!/\b(no|nr|number)\.?\s*$/i.test(cleanLabel(head)) || !meaningful(name)) return null;
        return `${tidyTitle(name)} ${n}`;
      }
      return null;
    }
    return null;
  };
  // Labelled fields by row, so an unlabelled input in a grid reads as its row and column.
  const rowFields = new Map<number, Array<{ col: number; label: string; equation?: boolean }>>();
  let unnamed = 0;
  const inputLabel = (input: InputSpec) => {
    const found =
      nearbyLabel(input) ?? (namesInput(input.label, input) ? cleanLabel(input.label) : null);
    if (found && !isInstruction(found)) return { label: found };
    const choice = (text: string | null) =>
      text && (input.options ?? []).some((option) => cleanLabel(String(option)) === text)
        ? null
        : text;
    const header = listedAbove(input.row, input.col)
      ? null
      : choice(headerAbove(input.row, input.col));
    const before = (rowFields.get(input.row) ?? []).filter((item) => item.col < input.col);
    const nearest = before[before.length - 1];
    const rowName = nearest && input.col - nearest.col <= 4 ? nearest.label : before[0]?.label;
    // "γs = 1.15 | 500" under "h": an equation is complete, so it names no column beside it.
    const gridRow =
      !before.find((item) => item.label === rowName)?.equation ||
      !!before[0]?.equation ||
      !!(before[0] && headerAbove(input.row, before[0].col));
    const numbered = numberedHeader(input.row, input.col);
    if (numbered) return { label: rowName ? `${rowName} · ${numbered}` : numbered };
    const first = rowName ? PAIR_NAME.exec(rowName) : null;
    if (header && first && headingAbove(input.row, input.col) === tidyTitle(header))
      return { label: `${header} · ${first[1]}` };
    if (header)
      return {
        label: rowName && gridRow && rowName !== header ? `${rowName} · ${header}` : header,
      };
    const size = sizeHeader(input.row, input.col);
    if (size) return { label: rowName ? `${rowName} · ${size}` : size };
    const pairs = input.col > 0 && hasContent(allCells.get(key(input.row, input.col - 1)));
    // "a1 & b1" over two entries per heading: the second is b1 under its neighbour's heading.
    const pair =
      (pairs || inputs.has(key(input.row, input.col - 1))) && rowName
        ? PAIR_NAME.exec(rowName)
        : null;
    const pairHead = pair ? headingAbove(input.row, input.col - 1) : null;
    if (pair && pairHead) return { label: `${pairHead} · ${pair[2]}` };
    const pairHeader = pairs ? headerAbove(input.row, input.col - 1) : null;
    if (pairHeader)
      return {
        label: `${rowName && rowName !== pairHeader ? `${rowName} · ` : ""}${pairHeader} (2nd)`,
      };
    const listed = listedAbove(input.row, input.col)
      ? [1, 2, 3].flatMap((step) => {
          const text = input.row >= step ? staticText(input.row - step, input.col) : null;
          return text ? [text] : [];
        })
      : undefined;
    const named = optionsPrefix(listed) ?? consumerLabel(input) ?? optionsPrefix(input.options);
    if (named) return { label: named };
    const far =
      hasContent(allCells.get(key(input.row, input.col))) ||
      cellIsRead(model, sheet, input.row, input.col, true)
        ? headingAbove(input.row, input.col)
        : null;
    if (far) return { label: rowName && rowName !== far ? `${rowName} · ${far}` : far };
    unnamed += 1;
    return { label: `Setting ${unnamed}`, hint: `Cell ${address(input.row, input.col)}` };
  };

  const sections: LayoutSection[] = [];
  const sectionRows: Array<{ from: number; to: number; c1: number; c2: number }> = [];
  let section: LayoutSection = { title: "", blocks: [], inputs: 0, outputs: 0 };
  let span = { from: Number.POSITIVE_INFINITY, to: -1, c1: 0, c2: 0 };
  const overall: string[] = [];
  const checks: string[] = [];
  let fieldCount = 0;
  const startSection = (title: string) => {
    if (section.blocks.length || section.title) {
      sections.push(section);
      sectionRows.push(span);
    }
    section = { title, blocks: [], inputs: 0, outputs: 0 };
    span = { from: Number.POSITIVE_INFINITY, to: -1, c1: span.c1, c2: span.c2 };
  };
  const touch = (row: number) => {
    span.from = Math.min(span.from, row);
    span.to = Math.max(span.to, row);
  };
  const pushFields = (fields: LayoutField[]) => {
    if (!fields.length) return;
    const last = section.blocks[section.blocks.length - 1];
    if (last?.kind === "fields") last.fields.push(...fields);
    else section.blocks.push({ kind: "fields", fields });
  };
  const count = (field: LayoutField, tabled = false) => {
    fieldCount += 1;
    if (field.input) section.inputs += 1;
    else section.outputs += 1;
    if (field.status) {
      checks.push(field.address);
      if (!tabled && (STATUS_LABEL.test(field.label) || field.strong)) overall.push(field.address);
    }
    if (field.hintAddress && isVerdict(textAt(field.hintAddress))) checks.push(field.hintAddress);
  };
  const textAt = (cellAddress: string) =>
    tokens.find((token) => at(token.row, token.col) === cellAddress)?.text ?? "";
  const valueAt = (cellAddress: string) =>
    tokens.find((token) => at(token.row, token.col) === cellAddress)?.cell?.v;
  /**
   * "CASE | NEd | MEd | CASE | NEd | MEd" with each case's number in its first column: side-by-side
   * copies of a list of cases, read as one row per case ("Case 2").
   */
  const unrollCases = (table: LayoutTable): LayoutTable => {
    const { columns } = table;
    const id = columns[0];
    if (!id || !/^(case|load ?case|lc|combination|combo|comb|ref)$/i.test(id)) return table;
    const period = columns.indexOf(id, 1);
    if (period < 2 || columns.length % period) return table;
    if (columns.some((column, index) => column !== columns[index % period])) return table;
    const rows: LayoutTable["rows"] = [];
    for (let copy = 0; copy < columns.length / period; copy++)
      for (const row of table.rows) {
        const cells = row.cells.slice(copy * period, (copy + 1) * period);
        const name = cells[0] && !cells[0].input ? valueAt(cells[0].address) : undefined;
        const figures = cells.slice(1);
        if (name === undefined || name === "" || typeof name === "boolean") {
          if (figures.some(Boolean)) return table;
          continue;
        }
        const label = `${tidyTitle(id)} ${name}`;
        rows.push({ label, cells: figures.map((cell) => (cell ? { ...cell, row: label } : null)) });
      }
    const order = (label: string) => Number(label.slice(label.lastIndexOf(" ") + 1));
    if (rows.every((row) => Number.isFinite(order(row.label))))
      rows.sort((a, b) => order(a.label) - order(b.label));
    return rows.length >= 2 ? { columns: columns.slice(1, period), rows } : table;
  };

  const claimed = new Set<Token>();
  const projectFields: LayoutField[] = [];
  const projectLines: LayoutBlock[] = [];
  const footer: LayoutBlock[] = [];
  const isTitleLabel = (token: Token) =>
    token.kind === "text" && TITLE_FIELD.test(cleanLabel(token.text));
  /**
   * A calculation sheet's title block (Project, Client, Location; Made by, Date, Page over their
   * entries; Checked, Revision, Job No), its title lines and where it came from, claimed whole so
   * none of it mixes with the design. A later page's copy gives only its own entries.
   */
  const readTitleBlock = (c1: number, c2: number, top: number, page: number) => {
    const within = tokens.filter((t) => t.col >= c1 && t.col <= c2 && t.row < top + 10);
    // "Location" again lower in the same column heads the design (LOCATION: from grid…), not the block.
    const labels = within
      .filter(isTitleLabel)
      .filter(
        (label, index, list) =>
          !list
            .slice(0, index)
            .some(
              (other) =>
                cleanLabel(other.text).toLowerCase() === cleanLabel(label.text).toLowerCase() &&
                Math.abs(other.col - label.col) <= 2,
            ),
      );
    if (labels.length < 3) return;
    const end = Math.max(...labels.map((t) => t.row)) + 1;
    const block = within.filter((t) => t.row <= end);
    // A second page's title block beside the first starts where its labels repeat.
    const firstCol = new Map<string, number>();
    let second = Number.POSITIVE_INFINITY;
    for (const label of labels) {
      const text = cleanLabel(label.text).toLowerCase();
      const seen = firstCol.get(text);
      if (seen === undefined) firstCol.set(text, label.col);
      else if (label.col > seen + 2) second = Math.min(second, label.col);
    }
    const pageOf = (token: Token) => page + (token.col >= second ? 1 : 0);
    const found: Array<{ label: string; token: Token }> = [];
    for (const label of labels) {
      claimed.add(label);
      const row = block.filter((t) => t.row === label.row);
      const right = row[row.indexOf(label) + 1];
      const below = block.find((t) => t.row === label.row + 1 && t.col === label.col);
      const value =
        right && !isTitleLabel(right) && right.col - label.col <= 6 && !claimed.has(right)
          ? right
          : below && !isTitleLabel(below) && !claimed.has(below)
            ? below
            : undefined;
      if (!value || isBoilerplate(value.text)) continue;
      claimed.add(value);
      // A copied title block shows 0 where the first sheet's entry is blank.
      if (!value.input && value.cell?.f !== undefined && value.cell.v === 0) continue;
      found.push({ label: cleanLabel(label.text), token: value });
    }
    const firstRow = Math.min(...labels.map((t) => t.row));
    const firstValue = found.find((item) => item.token.row === firstRow)?.token.col ?? c1;
    for (const token of block) {
      if (claimed.has(token)) continue;
      claimed.add(token);
      const where = at(token.row, token.col);
      if (pageOf(token) > page) {
        if (token.input) found.push({ label: inputLabel(token.input).label, token });
        continue;
      }
      if (token.kind === "dynamic" && isVerdict(token.text)) {
        checks.push(where);
        overall.push(where);
      } else if (isBoilerplate(token.text)) {
        if (page === 0)
          footer.push(
            token.kind === "dynamic"
              ? { kind: "note", address: where }
              : { kind: "note", text: cleanLabel(token.text) },
          );
      } else if (
        token.row === firstRow &&
        token.col > firstValue &&
        !found.some((item) => item.label === "Company")
      ) {
        found.push({ label: "Company", token });
      } else if (token.input) {
        found.push({ label: inputLabel(token.input).label, token });
      } else if (token.kind !== "value" && page === 0) {
        projectLines.push(
          token.kind === "dynamic"
            ? { kind: "note", address: where, strong: true }
            : { kind: "note", text: cleanLabel(token.text), strong: true },
        );
      }
    }
    const rank = (label: string) => {
      const index = TITLE_ORDER.findIndex((pattern) => pattern.test(label));
      return index < 0 ? TITLE_ORDER.length : index;
    };
    found.sort((a, b) => rank(a.label) - rank(b.label));
    for (const { label, token } of found) {
      const on = pageOf(token);
      if (on > 0 && !token.input) continue;
      projectFields.push({
        address: at(token.row, token.col),
        label,
        input: !!token.input,
        ...(on > 0 ? { row: `Page ${on + 1}` } : {}),
      });
    }
  };

  /** Lays out one page-wide band of the sheet, its rows in reading order. */
  const layoutPanel = (c1: number, c2: number, skipRows: Set<number>) => {
    span.c1 = c1;
    span.c2 = c2;
    const rows = new Map<number, Token[]>();
    const placed = new Set<Token>();
    for (const token of tokens) {
      if (token.col < c1 || token.col > c2 || claimed.has(token)) continue;
      if (skipRows.has(token.row) && !token.input) continue;
      const list = rows.get(token.row) ?? [];
      list.push(token);
      rows.set(token.row, list);
      placed.add(token);
    }
    const order = [...rows.keys()].sort((a, b) => a - b);
    const here = (row: number, col: number) => {
      const token = col >= c1 && col <= c2 ? tokenAt.get(key(row, col)) : undefined;
      return token && placed.has(token) ? token : undefined;
    };

    // "SUPPORT No | 1 | 2 | 3": a row numbering the columns below it, named "Support 1"…
    const ordinal = (token: Token) => {
      const v = token.cell?.v;
      return typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1000 ? v : null;
    };
    const numbered = new Map<number, string>();
    for (const row of order) {
      const list = rows.get(row)!;
      const name = list[0]?.kind === "text" ? cleanLabel(list[0].text) : "";
      if (!name || list.length < 3) continue;
      const figures = list.slice(1).filter((token) => ordinal(token) !== null);
      if (figures.length < 2 || figures.length < list.length - 3) continue;
      const counting =
        figures.length >= 3 && figures.every((token, index) => ordinal(token) === index + 1);
      // A bold run of rising sizes under a symbol heads its columns: Ø 12, 16, 20…
      const sizes =
        figures.length >= 3 &&
        name.length <= 12 &&
        figures[2]!.col === figures[0]!.col + 2 &&
        figures.every(
          (token, index) =>
            token.style?.bold &&
            (index === 0 ||
              (token.col === figures[index - 1]!.col + 1
                ? ordinal(token)! > ordinal(figures[index - 1]!)!
                : ordinal(token) === ordinal(figures[0]!))),
        );
      if (!/\b(no|nr|number)\.?$/i.test(name) && !counting && !sizes) continue;
      const kind = tidyTitle(name.replace(/\s*\b(no|nr|number)\.?$/i, ""));
      if (meaningful(kind)) numbered.set(row, kind);
    }
    const headerName = (header: Token) =>
      numbered.has(header.row)
        ? `${numbered.get(header.row)} ${ordinal(header)}`
        : countsBars(header.text)
          ? "Number"
          : cleanLabel(header.text);

    // The column most rows start in: headings sit there.
    const starts = new Map<number, number>();
    for (const row of order) {
      const first = rows.get(row)![0]!.col;
      starts.set(first, (starts.get(first) ?? 0) + 1);
    }
    const margin = [...starts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? c1;

    /** How far right a label may name a value: further for long text that runs over empty cells. */
    const reachOf = (token: Token) =>
      Math.min(MAX_LABEL_REACH, LABEL_REACH + Math.floor(cleanLabel(token.text).length / 9));

    const nextIn = (token: Token) => {
      const list = rows.get(token.row)!;
      return list[list.indexOf(token) + 1];
    };

    /** Whether a text token labels the value right after it in its row. */
    const labelsNext = (token: Token) => {
      const next = nextIn(token);
      return !!next && next.kind === "value" && next.col - token.col <= reachOf(token);
    };
    /** Whether text names the figure or calculated text right after it. */
    const namesNext = (token: Token) => {
      const next = nextIn(token);
      return !!next && next.kind !== "text" && next.col - token.col <= reachOf(token);
    };
    /** Text right after a figure in its row is that figure's unit or remark, not a heading. */
    const trailsValue = (token: Token) => {
      const list = rows.get(token.row)!;
      const before = list[list.indexOf(token) - 1];
      return !!before && before.kind !== "text" && token.col - before.col <= 2;
    };
    /** Text heading a column of labels, each naming the figure beside it (Axial, Mx, My…). */
    const labelColumn = (token: Token) =>
      labelsNext(token) &&
      [1, 2, 3].some((step) => {
        const below = here(token.row + step, token.col);
        return below?.kind === "text" && labelsNext(below);
      });

    /** The heading over a value's column: text above it, past other values, that labels nothing in its own row. */
    const columnHeader = (row: number, col: number): Token | null => {
      let broken = false;
      for (let r = row - 1, gaps = 0, run = 0; r >= 0 && row - r <= HEADER_REACH + run; r--) {
        if (hiddenRows.has(r)) continue;
        const above = here(r, col);
        if (!above || skipRows.has(r)) {
          broken = true;
          if (++gaps > 2) return null;
          continue;
        }
        if (numbered.has(r) && ordinal(above) !== null) return broken ? null : above;
        // Down an unbroken column of figures the heading may sit far above.
        if (above.kind === "value") {
          run = Math.min(run + 1, 60);
          gaps = 0;
          continue;
        }
        if (
          above.kind === "text" &&
          OPTION_WORD.test(cleanLabel(above.text)) &&
          !(countsBars(above.text) && headingCount(above.row) >= 3)
        )
          continue;
        if (
          above.kind === "text" &&
          !labelsNext(above) &&
          !trailsValue(above) &&
          cleanLabel(above.text) &&
          (meaningful(above.text) ||
            (isUnit(cleanLabel(above.text)) && headingCount(above.row) >= 3))
        )
          return above;
        return null;
      }
      return null;
    };

    /** A row of column headings sits right above this text, so the text is a figure, not a label. */
    const underHeading = (token: Token) => {
      const above = here(token.row - 1, token.col);
      if (above?.kind !== "text" || labelsNext(above)) return false;
      if (rows.get(token.row)?.[0] === token || rows.get(above.row)?.[0] === above) return false;
      return headingRun(above);
    };

    /** Whether a text sits in a run of two or more headings with no figure among them. */
    const headingRun = (token: Token) => {
      const list = rows.get(token.row)!;
      let from = list.indexOf(token);
      let to = from;
      while (from > 0 && list[from]!.col - list[from - 1]!.col <= LABEL_REACH) from--;
      while (to < list.length - 1 && list[to + 1]!.col - list[to]!.col <= LABEL_REACH) to++;
      const run = list.slice(from, to + 1);
      return run.length >= 2 && run.every((item) => item.kind === "text");
    };

    /** Text in a row of figures under a row of headings (a title block's Made by, Date, Page). */
    const figureUnderHeading = (token: Token, next: Token | undefined) =>
      underHeading(token) &&
      !labelColumn(token) &&
      (!next || next.kind === "text" || underHeading(next));

    // Label and value columns that pair up in other rows: text in such a value column is a figure.
    const pairs = new Map<string, number[]>();
    for (const row of order)
      for (const token of rows.get(row)!) {
        if (token.kind === "value" || !labelsNext(token) || underHeading(token)) continue;
        const next = nextIn(token)!;
        const pair = `${token.col}:${next.col}`;
        pairs.set(pair, [...(pairs.get(pair) ?? []), row]);
      }
    const labelsFigure = (token: Token) => {
      const list = rows.get(token.row) ?? [];
      const next = list[list.indexOf(token) + 1];
      return !!next && next.kind !== "text" && next.col - token.col <= reachOf(token);
    };
    const pairedText = (label: Token, value: Token) =>
      value.kind === "text" &&
      !labelsFigure(value) &&
      !isUnit(cleanLabel(label.text)) &&
      !isUnit(cleanLabel(value.text)) &&
      !/[=:]\s*$/.test(value.text) &&
      ![label, value].some(
        (token) =>
          columnUse.has(key(token.row, token.col)) || !!here(token.row + 1, token.col)?.input,
      ) &&
      !!pairs.get(`${label.col}:${value.col}`)?.some((row) => Math.abs(row - label.row) <= 4);

    // Text cells serving as column headings are not notes.
    // "STATUS" over a cell showing VALID DESIGN captions the verdict, not the field beside it.
    const captionsVerdict = (token: Token) => {
      const below = here(token.row + 1, token.col);
      return (
        below?.kind === "dynamic" &&
        isVerdict(below.text) &&
        (!!token.style?.bold || /\b(status|check|verdict|result)\b/i.test(token.text))
      );
    };
    // "REBAR | Ø" over "Tension | [32]" heads the table below rather than describing the field beside it.
    const headsColumn = (token: Token) => {
      const below = here(token.row + 1, token.col);
      if (below?.input) return true;
      const right = here(token.row, token.col + 1);
      return below?.kind === "text" && !!right && !!here(right.row + 1, right.col)?.input;
    };
    const columnUse = new Set<number>();
    for (const row of order)
      for (const token of rows.get(row)!) {
        if (token.kind === "text" || (token.kind === "dynamic" && !isVerdict(token.text))) continue;
        const list = rows.get(row)!;
        const before = list[list.indexOf(token) - 1];
        if (before && before.kind !== "value" && token.col - before.col <= reachOf(before))
          continue;
        const header = columnHeader(row, token.col);
        if (header) columnUse.add(key(header.row, header.col));
      }

    type ParsedField = LayoutField & { header: Token | null; left: boolean; line: number };
    type RowParse = { fields: ParsedField[]; notes: LayoutBlock[] };

    const parseRow = (rowTokens: Token[]): RowParse => {
      const out: RowParse = { fields: [], notes: [] };
      let label: Token | null = null;
      let description: string | null = null;
      let describedBy: string | null = null;
      let unitBefore: string | null = null;
      let loose: Token | null = null;
      let previous: ParsedField | null = null;
      let previousCol = -1;
      const besidePrevious = (token: Token) => !!previous && !label && token.col - previousCol <= 2;
      const staticField = (token: Token, labelText: string) => {
        const field: ParsedField = {
          address: at(token.row, token.col),
          label: labelText,
          input: false,
          header: null,
          left: true,
          line: token.row,
        };
        out.fields.push(field);
        previous = field;
        previousCol = token.col;
      };
      for (let i = 0; i < rowTokens.length; i++) {
        let token = rowTokens[i]!;
        const next = rowTokens[i + 1];
        const near = !!next && next.col - token.col <= reachOf(token);
        const nextIsValue = near && next.kind === "value";
        if (token.kind === "text") {
          let text = token.text.trim();
          if (!label && figureUnderHeading(token, next)) {
            staticField(token, cleanLabel(here(token.row - 1, token.col)!.text));
            continue;
          }
          if (!label && next?.kind === "text" && near && pairedText(token, next)) {
            label = token;
            continue;
          }
          if (label && pairedText(label, token)) {
            staticField(token, cleanLabel(label.text));
            label = null;
            continue;
          }
          const after = rowTokens[i + 2];
          if (
            near &&
            next.kind === "text" &&
            isUnit(cleanLabel(next.text)) &&
            !isUnit(text) &&
            after &&
            after.kind !== "text" &&
            after.col - next.col <= reachOf(next)
          ) {
            label = null;
            loose = token;
            continue;
          }
          const unitOfLoose = !!loose && rowTokens[i - 1] === loose && nextIsValue;
          if (previous && besidePrevious(token) && !previous.unit && !unitOfLoose) {
            if (isUnit(text)) {
              previous.unit = tidyUnit(text);
              previousCol = token.col;
              continue;
            }
            // One cell holding a unit then the next label: "kN   At".
            const split = /^(\S+)\s+(.*\p{L}.*)$/u.exec(text);
            if (split && isUnit(split[1]!) && (nextIsValue || (near && next.kind === "dynamic"))) {
              previous.unit = tidyUnit(split[1]!);
              text = split[2]!;
              token = { ...token, text };
            }
          }
          if (nextIsValue || (near && next.kind === "dynamic")) {
            // "fck | N/mm² | 32": the unit sits between the label and the figure.
            if (
              isUnit(text) &&
              loose &&
              rowTokens[i - 1] === loose &&
              token.col - loose.col <= reachOf(loose)
            ) {
              label = loose;
              unitBefore = tidyUnit(text);
            } else label = token;
            loose = null;
            continue;
          }
          if (
            previous &&
            besidePrevious(token) &&
            text.length <= 40 &&
            !columnUse.has(key(token.row, token.col)) &&
            !captionsVerdict(token) &&
            !headsColumn(token)
          ) {
            previous.hint = previous.hint ? `${previous.hint} ${text}` : text;
            previousCol = token.col;
            continue;
          }
          if (
            near &&
            next.kind === "text" &&
            !isUnit(cleanLabel(next.text)) &&
            (text.length >= 8 ? labelsNext(next) : i === 0 && namesNext(next)) &&
            !isBoilerplate(text) &&
            !(rowTokens[i - 1] && columnUse.has(key(token.row, rowTokens[i - 1]!.col)))
          ) {
            description = text.replace(/\s+/g, " ");
            continue;
          }
          if (label && pairedText(label, token)) continue;
          label = null;
          if (text.length >= 12 && !columnUse.has(key(token.row, token.col)) && !/=\s*$/.test(text))
            out.notes.push({
              kind: "note",
              text: text.replace(/\s+/g, " "),
              ...(token.style?.bold ? { strong: true } : {}),
            });
          else loose = token;
          continue;
        }
        loose = null;
        if (token.kind === "dynamic") {
          // A clause reference a formula writes before a label ("6.2.2 (1)" | "k =" | …).
          if (
            !label &&
            i === 0 &&
            near &&
            next.kind === "text" &&
            namesNext(next) &&
            !isVerdict(token.text)
          ) {
            describedBy = at(token.row, token.col);
            continue;
          }
          if (!label && figureUnderHeading(token, next)) {
            staticField(token, cleanLabel(here(token.row - 1, token.col)!.text));
            continue;
          }
          if (nextIsValue && !label) {
            label = token;
            continue;
          }
          const head = columnHeader(token.row, token.col);
          const tabled = !!head && !!previous?.header && head.row === previous.header.row;
          const verdict = isVerdict(token.text);
          const ownHeading = verdict && !!head && !tabled && !label;
          const sameRowVerdict = verdict && !label && rowTokens[i - 1]?.col === previousCol;
          if (
            previous &&
            (besidePrevious(token) || sameRowVerdict) &&
            !tabled &&
            !ownHeading &&
            !previous.input
          ) {
            previous.hintAddress = at(token.row, token.col);
            if (verdict) checks.push(previous.hintAddress);
            previousCol = token.col;
            continue;
          }
          if (!label && !tabled && !ownHeading) {
            const strong = !!token.style?.bold;
            const where = at(token.row, token.col);
            if (verdict) {
              checks.push(where);
              if (strong) overall.push(where);
            }
            out.notes.push({ kind: "note", address: where, ...(strong ? { strong } : {}) });
            continue;
          }
        }
        // A value, or calculated text a label names.
        const bar = token.input
          ? barLabel(token.row, token.col)
          : inputs.has(key(token.row, token.col + 2))
            ? (barLabel(token.row, token.col + 2)?.replace(/ Ø$/, " No.") ?? null)
            : null;
        if (bar) {
          label = null;
          description = null;
        }
        const header = label ? null : columnHeader(token.row, token.col);
        const rowItems = (rowFields.get(token.row) ?? []).filter((item) => item.col < token.col);
        const rowName =
          rowItems[rowItems.length - 1]?.equation &&
          !rowItems[0]!.equation &&
          !columnHeader(token.row, rowItems[0]!.col)
            ? undefined
            : rowItems[0]?.label;
        const headerText = header ? headerName(header) : "";
        const pairName = token.input && rowName ? PAIR_NAME.exec(rowName) : null;
        const pairLabel = token.input && label ? PAIR_NAME.exec(cleanLabel(label.text)) : null;
        const pairHeading = pairLabel ? headingAbove(token.row, token.col) : null;
        const labelText = bar
          ? bar
          : pairLabel && pairHeading
            ? `${pairHeading} · ${pairLabel[1]}`
            : label
              ? cleanLabel(label.text)
              : pairName && headerText
                ? `${headerText} · ${pairName[1]}`
                : rowName && headerText && rowName !== headerText
                  ? `${rowName} · ${headerText}`
                  : headerText;
        const isInput = !!token.input;
        if (
          !labelText &&
          !isInput &&
          !(boldStands && token.style?.bold) &&
          label?.kind !== "dynamic"
        ) {
          label = null;
          continue;
        }
        previousCol = token.col;
        const field: ParsedField = {
          address: at(token.row, token.col),
          label: labelText,
          input: isInput,
          header: label ? columnHeader(token.row, token.col) : header,
          left: !!label,
          line: token.row,
        };
        if (!labelText && isInput) {
          const named = inputLabel(token.input!);
          field.label = named.label;
          if (named.hint) field.hint = named.hint;
        } else if (label && labelText && !isUnit(labelText)) {
          const list = rowFields.get(token.row) ?? [];
          list.push({
            col: token.col,
            label: pairLabel ? cleanLabel(label.text) : labelText,
            ...(/=\s*$/.test(label.text) ? { equation: true } : {}),
          });
          rowFields.set(token.row, list);
        }
        if (description) {
          field.hint = description;
          description = null;
        }
        if (describedBy) {
          field.hintAddress = describedBy;
          describedBy = null;
        }
        if (unitBefore) {
          field.unit = unitBefore;
          unitBefore = null;
        }
        if (label?.kind === "dynamic") field.labelAddress = at(label.row, label.col);
        if (
          !isInput &&
          ((boldStands && token.style?.bold) ||
            (boldLabelsStand && label?.kind === "text" && label.style?.bold))
        )
          field.strong = true;
        const saved = token.cell?.v;
        const named = label?.kind === "dynamic" ? cleanLabel(label.text) : labelText;
        if (
          !isInput &&
          typeof saved === "number" &&
          saved >= 0 &&
          saved <= 2 &&
          isRatioLabel(named)
        )
          field.ratio = true;
        if (
          !isInput &&
          token.kind === "dynamic" &&
          (isVerdict(token.text) ||
            (STATUS_LABEL.test(named) && token.text.length <= 120 && !!statusTone(token.text)))
        )
          field.status = true;
        if (!field.labelAddress) {
          const split = splitFormulaLabel(field.label);
          if (split) {
            field.label = split.label;
            field.hint = field.hint ? `${split.formula} · ${field.hint}` : split.formula;
          }
          const trailing = trailingUnit(field.label);
          if (trailing && !field.unit) {
            field.label = trailing.label;
            field.unit = trailing.unit;
          }
          // "Axial ↔ | … | ↕": a bare direction continues the quantity before it.
          const stem = previous && /^(\p{L}[^↔↕]*?)\s*[↔↕]$/u.exec(previous.label);
          if (stem && /^[↔↕]$/.test(field.label)) field.label = `${stem[1]} ${field.label}`;
        }
        out.fields.push(field);
        previous = field;
        label = null;
      }
      return out;
    };

    let table = null as {
      header: number;
      rows: Array<RowParse["fields"]>;
      side: RowParse["fields"];
    } | null;
    const emitFields = (fields: RowParse["fields"]) => {
      pushFields(
        fields.map(({ header: _header, left: _left, line: _line, ...field }) => {
          count(field);
          return field;
        }),
      );
    };
    /** Headings over runs of columns: merged text above them, or text left of each run. */
    const columnGroups = (
      headerRow: number,
      columnList: number[],
      names: string[],
      captionRow = headerRow,
    ) => {
      const above = (rows.get(headerRow - 1) ?? []).filter(
        (t) =>
          t.kind === "text" &&
          t.col >= columnList[0]! &&
          t.col <= columnList[columnList.length - 1]!,
      );
      if (new Set(names).size === names.length && above.length < 2) return undefined;
      const labels = columnList.map((col) => {
        for (const [r1, m1, , m2] of spec.merges ?? [])
          if (r1 === headerRow - 1 && m1 <= col && m2 >= col) {
            const text = here(r1, m1);
            if (text?.kind === "text") return cleanLabel(text.text);
          }
        // Copies of a table under one row of headings are each captioned on the row above them.
        for (const row of new Set([captionRow, headerRow])) {
          const left = (rows.get(row) ?? []).filter(
            (t) => t.col < col && t.kind === "text" && !columnList.includes(t.col),
          );
          if (left.length) return cleanLabel(left[left.length - 1]!.text);
        }
        const over = (rows.get(headerRow - 1) ?? []).filter(
          (t) => t.kind === "text" && t.col >= columnList[0]! && t.col <= col,
        );
        return over.length ? cleanLabel(over[over.length - 1]!.text) : "";
      });
      if (labels.some((label) => !label)) return undefined;
      const groups: Array<{ label: string; span: number }> = [];
      for (const label of labels) {
        const last = groups[groups.length - 1];
        if (last?.label === label) last.span += 1;
        else groups.push({ label, span: 1 });
      }
      return groups.length >= 2 && new Set(groups.map((g) => g.label)).size === groups.length
        ? groups
        : undefined;
    };
    const flushTable = () => {
      if (!table) return;
      const groups = table.rows;
      const side = table.side;
      const cols = new Map<number, string>();
      for (const fields of groups)
        for (const field of fields)
          if (field.header) cols.set(field.header.col, headerName(field.header));
      if (groups.length >= 2 && cols.size >= 2) {
        const columnList = [...cols.keys()].sort((a, b) => a - b);
        let columns = columnList.map((col) => cols.get(col)!);
        const firstLine = Math.min(...groups.flatMap((fields) => fields.map((f) => f.line)));
        const spans = columnGroups(table.header, columnList, columns, firstLine - 1);
        // "Dead | Imposed" over "Load | Load": a heading split over two rows reads as one.
        const distinct = (list: string[]) =>
          new Set((spans ? list.slice(0, spans[0]!.span) : list).map((name) => name.toLowerCase()))
            .size === (spans ? spans[0]!.span : list.length);
        if (!distinct(columns)) {
          const joined = columnList.map((col, index) => {
            const upper = here(table!.header - 1, col);
            const lower = columns[index]!;
            if (upper?.kind !== "text") return lower;
            const top = cleanLabel(upper.text);
            return top.toLowerCase().includes(lower.toLowerCase()) ? top : `${top} ${lower}`;
          });
          const kinds = (list: string[]) => new Set(list.map((name) => name.toLowerCase())).size;
          const raised = columnList.filter(
            (col) => here(table!.header - 1, col)?.kind === "text",
          ).length;
          if (
            raised >= Math.max(2, columnList.length * 0.75) &&
            (distinct(joined) || kinds(joined) > kinds(columns))
          ) {
            columns = joined;
            for (const [index, col] of columnList.entries()) cols.set(col, joined[index]!);
          }
        }
        if (spans && section.title && spans[0]!.label === tidyTitle(section.title))
          section.title = spans.map((group) => group.label).join(" & ");
        section.blocks.push({
          kind: "table",
          table: unrollCases({
            columns,
            ...(spans ? { groups: spans } : {}),
            rows: groups.map((fields) => {
              const last = fields[fields.length - 1]!;
              const rowLabel =
                fields.find((field) => field.left)?.label ??
                rowFields.get(fields[0]!.line)?.[0]?.label ??
                "";
              const cells = columnList.map((col) => {
                const field = fields.find((item) => item.header?.col === col);
                if (!field) return null;
                const {
                  header: _header,
                  left: _left,
                  line: _line,
                  hint: _hint,
                  hintAddress: _at,
                  ...plain
                } = field;
                const cell: LayoutField = { ...plain, label: cols.get(col)! };
                if (rowLabel) cell.row = rowLabel;
                count(cell, true);
                return cell;
              });
              if (last.hintAddress && isVerdict(textAt(last.hintAddress)))
                checks.push(last.hintAddress);
              return {
                label: rowLabel,
                cells,
                ...(last.hint ? { hint: last.hint } : {}),
                ...(last.hintAddress ? { hintAddress: last.hintAddress } : {}),
              };
            }),
          }),
        });
        emitFields(side);
      } else {
        emitFields(side);
        for (const fields of groups) emitFields(fields);
      }
      table = null;
    };
    /** Where a row's run of figures under one row of headings starts (a table beside fields), or -1. */
    const tableStart = (fields: RowParse["fields"]) => {
      if (!fields.length) return -1;
      const headerOf = (field: ParsedField) => field.header?.row ?? -1;
      let from = fields.length - 1;
      const row = headerOf(fields[from]!);
      if (row < 0) return -1;
      // Side-by-side copies of one table repeat its row labels: "Axial | 1 | 2   Axial | 1 | 2".
      const repeated = (field: ParsedField) =>
        field.left &&
        fields.some((other) => other !== field && other.left && other.label === field.label);
      while (
        from > 0 &&
        headerOf(fields[from - 1]!) === row &&
        (!fields[from]!.left || repeated(fields[from]!))
      )
        from--;
      return fields.length - from >= 2 || from === 0 ? from : -1;
    };
    /** A row of headings only, each over figures below: the table's columns, not content. */
    const headerRow = (list: Token[]) =>
      list.length >= 2 &&
      list.every((token) => token.kind === "text" && !labelsNext(token)) &&
      list.some((token) => columnUse.has(key(token.row, token.col))) &&
      list.every((token) => [1, 2].some((step) => here(token.row + step, token.col)));

    const isHeading = (first: Token, second: Token | undefined) => {
      if (first.kind !== "text" || first.col > margin || letters(first.text).length < 3)
        return false;
      if (!(bolded ? first.style?.bold : shouty(first.text))) return false;
      if (!second || second.col - first.col > reachOf(first) || second.kind === "text") return true;
      return second.kind === "dynamic" && shouty(first.text);
    };
    /** "BASE | COLUMN 1 | COLUMN 2" over a grid of "label = value" pairs: one group of fields per caption. */
    const captionRow = (list: Token[], afterHeading: boolean) =>
      list.length >= (afterHeading ? 1 : 2) &&
      list.every((token) => {
        if (token.kind !== "text" || labelsNext(token)) return false;
        const below = here(token.row + 1, token.col);
        return below?.kind === "text" && labelsNext(below);
      });
    let captions: { cols: Array<{ col: number; title: string }>; buckets: ParsedField[][] } | null =
      null;
    const flushCaptions = () => {
      if (!captions) return;
      const run = captions;
      captions = null;
      run.buckets.forEach((fields, index) => {
        if (!fields.length) return;
        const title = run.cols[index - 1]?.title;
        if (title) section.blocks.push({ kind: "note", text: title, strong: true });
        emitFields(fields);
      });
    };
    let deferred: LayoutBlock[] = [];
    const flushNotes = () => {
      section.blocks.push(...deferred);
      deferred = [];
    };

    let skipped = false;
    for (const row of order) {
      let rowTokens = rows.get(row)!;
      // Past the cap only headings and rows with something to enter are still read.
      if (
        fieldCount >= MAX_FIELDS &&
        !rowTokens.some((token) => token.input) &&
        !isHeading(rowTokens[0]!, rowTokens[1])
      ) {
        skipped = true;
        continue;
      }
      let afterHeading = false;
      if (isHeading(rowTokens[0]!, rowTokens[1])) {
        flushCaptions();
        flushTable();
        flushNotes();
        const title = cleanLabel(rowTokens[0]!.text);
        if (!section.blocks.length && section.title)
          section.title = skipped ? title : `${section.title} · ${title}`;
        else startSection(title);
        skipped = false;
        touch(row);
        rowTokens = rowTokens.slice(1);
        if (!rowTokens.length) continue;
        if (fieldCount >= MAX_FIELDS && !rowTokens.some((token) => token.input)) continue;
        afterHeading = true;
      }
      touch(row);
      if (!table && captionRow(rowTokens, afterHeading)) {
        flushCaptions();
        flushNotes();
        captions = {
          cols: rowTokens.map((token) => ({ col: token.col, title: tidyTitle(token.text) })),
          buckets: rowTokens.map(() => []).concat([[]]),
        };
        continue;
      }
      if (headerRow(rowTokens) || numbered.has(row)) continue;
      const parsed = parseRow(rowTokens);
      const start = tableStart(parsed.fields);
      if (captions) {
        if (parsed.fields.length && start < 0 && !parsed.fields.every((field) => field.status)) {
          for (const field of parsed.fields) {
            const col = columnOf(field.address) - 1;
            const index = captions.cols.filter((caption) => caption.col < col).length;
            captions.buckets[index]!.push(field);
          }
          deferred.push(...parsed.notes);
          continue;
        }
        flushCaptions();
      }
      const figures = start >= 0 ? parsed.fields.slice(start) : [];
      const beside = start >= 0 ? parsed.fields.slice(0, start) : parsed.fields;
      const headedBy = figures.length ? figures[0]!.header!.row : -1;
      const known = new Set(table?.rows.flat().map((field) => field.header?.col));
      const fits = figures.every((field) => known.has(field.header?.col));
      if (figures.length && table?.header === headedBy && (fits || table.rows.length < 2)) {
        table.rows.push(figures);
        table.side.push(...beside);
      } else {
        flushTable();
        flushNotes();
        if (figures.length && (beside.length === 0 || figures.length >= 2))
          table = { header: headedBy, rows: [figures], side: beside };
        else emitFields(parsed.fields);
      }
      if (table) deferred.push(...parsed.notes);
      else section.blocks.push(...parsed.notes);
    }
    flushCaptions();
    flushTable();
    flushNotes();
  };

  // Pages side by side, each opening with the same title block, read one after the other.
  const faceCols = tokens.map((token) => token.col);
  let from = area ? area[1] : faceCols.length ? Math.min(...faceCols) : 0;
  const to = area ? area[3] : faceCols.length ? Math.max(...faceCols) : 0;
  const top = tokens.length ? tokens[0]!.row : 0;
  const topRows: Array<Array<{ col: number; text: string }>> = [];
  for (let r = top; r < top + 8; r++)
    topRows.push(tokens.filter((t) => t.row === r && t.kind === "text"));
  const panels: Array<[number, number]> = [];
  for (let guard = 0; guard < 4; guard++) {
    const split = repeatedPageColumn(topRows, from);
    if (split === null || split <= from || split > to) break;
    panels.push([from, split - 1]);
    from = split;
  }
  panels.push([from, to]);
  const bands = !area && panels.length === 1 ? columnBands(tokens, from, to) : [];

  let firstHeading = Number.POSITIVE_INFINITY;
  if (bands.length > 1)
    bands.forEach(([c1, c2], index) => {
      if (index > 0) startSection("");
      if (index === 0) readTitleBlock(c1, c2, top, 0);
      layoutPanel(c1, c2, new Set());
    });
  else
    panels.forEach(([c1, c2], index) => {
      let skip = new Set<number>();
      if (index > 0) {
        // A later page's own title block repeats the first page's; its rows are skipped.
        const firstBody = tokens.find(
          (t) => t.col >= c1 && t.col <= c2 && t.row >= firstHeading && t.kind === "text",
        );
        const end = Number.isFinite(firstHeading) ? firstHeading : (firstBody?.row ?? top);
        skip = new Set(Array.from({ length: Math.max(0, end - top) }, (_, i) => top + i));
        startSection(`Page ${index + 1}`);
      }
      readTitleBlock(c1, c2, top, index);
      layoutPanel(c1, c2, skip);
      if (index === 0) {
        const headed = sections.find((item) => item.title);
        const first = headed ? sectionRows[sections.indexOf(headed)]?.from : undefined;
        firstHeading = first ?? (section.title ? span.from : Number.POSITIVE_INFINITY);
      }
    });

  // Off-page inputs nothing names are macro scratch cells, left at their saved values.
  const named = aside
    .map((input) => ({ input, named: inputLabel(input) }))
    .filter((item) => !item.named.hint?.startsWith("Cell "));
  if (named.length) {
    startSection("More settings");
    pushFields(
      named.map(({ input, named }) => {
        const field: LayoutField = {
          address: at(input.row, input.col),
          label: named.label,
          input: true,
          ...(named.hint ? { hint: named.hint } : {}),
          ...(input.unit ? { unit: input.unit } : {}),
        };
        count(field);
        return field;
      }),
    );
  }
  startSection("");

  // A first section without a heading that holds the title block reads as the project's details.
  const kept: LayoutSection[] = [];
  const keptRows: typeof sectionRows = [];
  sections.forEach((item, index) => {
    if (!item.blocks.length) return;
    kept.push(item);
    keptRows.push(sectionRows[index]!);
  });
  // Where the sheet came from, its version and copyright go to the foot of the page.
  const blockText = (block: LayoutBlock) =>
    block.kind === "note" ? (block.address ? textAt(block.address) : (block.text ?? "")) : "";
  for (const item of kept) {
    item.blocks = item.blocks.flatMap((block): LayoutBlock[] => {
      if (block.kind === "note") {
        if (!isBoilerplate(blockText(block))) return [block];
        footer.push(block);
        return [];
      }
      if (block.kind !== "fields") return [block];
      const fields = block.fields.flatMap((field): LayoutField[] => {
        if (!field.input && (isBoilerplate(field.label) || isBoilerplate(textAt(field.address)))) {
          if (isBoilerplate(field.label)) footer.push({ kind: "note", text: field.label });
          if (isBoilerplate(textAt(field.address)))
            footer.push({ kind: "note", address: field.address });
          return [];
        }
        const hinted = field.hintAddress ? textAt(field.hintAddress) : (field.hint ?? "");
        if (!isBoilerplate(hinted)) return [field];
        const { hint: _hint, hintAddress: _at, ...rest } = field;
        return [rest];
      });
      return fields.length ? [{ ...block, fields }] : [];
    });
  }
  for (let index = kept.length - 1; index >= 0; index--)
    if (!kept[index]!.blocks.length) {
      kept.splice(index, 1);
      keptRows.splice(index, 1);
    }

  // Headings and short notes before anything to enter or read are the design's title lines.
  while (kept.length > 1) {
    const lead = kept[0]!;
    const lines = lead.blocks.filter((block) => block.kind === "note");
    if (
      lines.length !== lead.blocks.length ||
      lines.length > 3 ||
      lines.some((block) => blockText(block).length > 100) ||
      /^Page \d+$/.test(lead.title)
    )
      break;
    if (lead.title) projectLines.push({ kind: "note", text: lead.title, strong: true });
    projectLines.push(...lines);
    kept.shift();
    keptRows.shift();
  }
  if (projectFields.length || projectLines.length) {
    kept.unshift({
      title: projectFields.length ? "Project details" : "",
      role: "project",
      blocks: [
        ...projectLines,
        ...(projectFields.length ? [{ kind: "fields" as const, fields: projectFields }] : []),
      ],
      inputs: projectFields.filter((field) => field.input).length,
      outputs: projectFields.filter((field) => !field.input).length,
    });
    keptRows.unshift({ from: top, to: top, c1: panels[0]![0], c2: panels[0]![1] });
  } else {
    const opening = kept[0];
    const labels = (opening?.title ? [] : (opening?.blocks ?? [])).flatMap((block) =>
      block.kind === "fields" ? block.fields.map((field) => field.label) : [],
    );
    if (opening && labels.filter((label) => TITLE_WORDS.test(cleanLabel(label))).length >= 2) {
      opening.title = "Project details";
      opening.role = "project";
    }
  }

  const captionCells = new Set<string>();
  const captionTexts = new Set<string>();
  const headings = new Set(
    sections.flatMap((item) => item.title.split(" · ").map((part) => part.toLowerCase())),
  );
  // A caption is not a title-block entry, nor the heading over a column of figures.
  const projectCells = new Set(projectFields.map((field) => field.address));
  const charts: LayoutChart[] = (model.charts ?? [])
    .filter((chart) => chart.sheet === sheet)
    .map((chart) => {
      const [r1, c1, r2, c2] = chart.anchor;
      const caption = [r2, r2 + 1, r1 - 1, r1 - 2]
        .flatMap((row) =>
          tokens.filter(
            (t) =>
              t.row === row &&
              (t.kind === "text" || (t.kind === "dynamic" && CHART_WORDS.test(t.text))) &&
              t.col >= c1 &&
              t.col <= c2,
          ),
        )
        .find(
          (token) =>
            cleanLabel(token.text).length >= 3 &&
            !(token.row >= r2 - 1 && headings.has(cleanLabel(token.text).toLowerCase())) &&
            !projectCells.has(at(token.row, token.col)) &&
            !tokenAt.get(key(token.row + 1, token.col))?.cell?.f &&
            tokenAt.get(key(token.row + 1, token.col))?.kind !== "value" &&
            !isUnit(token.text) &&
            !isUnit(token.text.trim().split(/\s+/)[0] ?? "") &&
            /^[^a-z]/.test(cleanLabel(token.text)) &&
            !/^see\b|[=:]\s*-?\s*$|\s=\s/i.test(token.text.trim()) &&
            !isReference(token.text) &&
            !captionCells.has(at(token.row, token.col)) &&
            !captionTexts.has(cleanLabel(token.text)) &&
            !(model.charts ?? []).some(
              (other) => other.sheet === sheet && other.title === cleanLabel(token.text),
            ) &&
            (/\S\s+\S/.test(cleanLabel(token.text)) ||
              /^[A-Z][a-z]{5,}$/.test(cleanLabel(token.text)) ||
              (!!token.style?.bold && cleanLabel(token.text).length > 6)) &&
            !/\.xls[xmb]?\b|^(rev(ision)?|originated|printed|date)\b/i.test(token.text.trim()) &&
            letters(token.text).toLowerCase() !== letters(spec.name).toLowerCase() &&
            !tokens.some(
              (t) =>
                t.row === token.row &&
                t.col > token.col &&
                t.col <= token.col + 3 &&
                (t.input ||
                  (token.kind === "text" && t.kind !== "text" && typeof t.cell?.v === "number")),
            ),
        );
      if (caption) {
        captionCells.add(at(caption.row, caption.col));
        captionTexts.add(cleanLabel(caption.text));
      }
      const out: LayoutChart = caption ? { ...chart, caption: cleanLabel(caption.text) } : chart;
      const middle = (r1 + r2) / 2;
      const within = keptRows.findIndex(
        (rows) => middle >= rows.from && middle <= rows.to + 1 && c1 <= rows.c2 && c2 >= rows.c1,
      );
      const nearest = keptRows.reduce<number>(
        (best, rows, index) =>
          rows.from <= r1 && (best < 0 || rows.from >= keptRows[best]!.from) ? index : best,
        -1,
      );
      const section = within >= 0 ? within : nearest;
      if (section >= 0) out.section = section;
      return out;
    });

  // A grid of figures that only feeds a chart is drawn by the chart, not listed.
  const chartOnly = chartOnlyCells(model);
  const feedsChart = (field: LayoutField) => {
    if (field.input || !field.address.startsWith(prefix)) return false;
    const local = field.address.slice(prefix.length);
    const match = /^([A-Z]+)(\d+)$/.exec(local);
    return !!match && chartOnly.has(`${sheet}:${Number(match[2]) - 1}:${columnIndex(match[1]!)}`);
  };
  // A chart key on the sheet: the series name beside a sample mark ("B" in a symbol font).
  const legendMark = (field: LayoutField) => {
    const said = textAt(field.address);
    return !!said && cleanLabel(said).length <= 2;
  };
  // An unnamed, empty entry cell nothing reads is a stray unlocked cell, not a setting.
  const idle = (field: LayoutField) => {
    if (!field.input || !field.hint?.startsWith("Cell ") || !field.address.startsWith(prefix))
      return false;
    const match = /^([A-Z]+)(\d+)$/.exec(field.address.slice(prefix.length));
    if (!match) return false;
    const row = Number(match[2]) - 1;
    const col = columnIndex(match[1]!);
    if (hasContent(allCells.get(key(row, col)))) return false;
    // Alone on an otherwise blank row, it is a gap in the form, whatever formula strays onto it.
    const alone = !spec.cells.some(
      ([r, c, cell]) => r === row && c !== col && hasContent(cell) && (!inArea || inArea(r, c)),
    );
    // Read only as part of a range (MIN(D37:L37) checking bar sizes), a blank needs no entry.
    if (alone || !cellIsRead(model, sheet, row, col, true)) return true;
    // A second layer whose name a formula leaves blank until it is used: "Layer 2" over [ ].
    const first = spec.cells
      .filter(
        ([r, c, cell]) =>
          r === row &&
          c < col &&
          (!inArea || inArea(r, c)) &&
          (cell.f !== undefined || hasContent(cell)),
      )
      .sort((a, b) => a[1] - b[1])[0];
    const name = first?.[2];
    return (
      !!name &&
      name.f !== undefined &&
      (name.v === "" || (typeof name.v === "object" && name.v !== null))
    );
  };
  const ignored: string[] = [];
  const dropIdle = (field: LayoutField) => {
    if (!idle(field)) return false;
    ignored.push(field.address);
    return true;
  };
  // A chart's caption is shown with the chart, not again as a note or a result.
  for (const item of kept) {
    item.blocks = item.blocks.flatMap((block): LayoutBlock[] => {
      if (
        chartOnly.size &&
        block.kind === "table" &&
        block.table.rows.every((r) => r.cells.every((cell) => !cell || feedsChart(cell)))
      )
        return [];
      if (block.kind === "note") {
        // Grid letters beside a drawing ("A", "B") mean nothing on their own.
        const said = block.text ?? (block.address ? textAt(block.address) : "");
        if (cleanLabel(said).length <= 2 && !isVerdict(said)) return [];
        const caption =
          (block.address && captionCells.has(block.address)) ||
          (block.text && captionTexts.has(cleanLabel(block.text)));
        return caption ? [] : [block];
      }
      if (block.kind !== "fields") return [block];
      const fields = block.fields
        .filter(
          (field) =>
            !captionCells.has(field.address) &&
            !feedsChart(field) &&
            !dropIdle(field) &&
            !(!field.input && captionTexts.has(cleanLabel(field.label)) && legendMark(field)),
        )
        .map((field) => {
          if (!field.hint || !captionTexts.has(cleanLabel(field.hint))) return field;
          const { hint: _caption, ...rest } = field;
          return rest;
        });
      return fields.length ? [{ ...block, fields }] : [];
    });
  }

  // A code reference beside a figure is a badge on it, not a remark; a reference on a line of
  // its own belongs to the figure above it.
  for (const item of kept) {
    let last: { reference?: string } | null = null;
    item.blocks = item.blocks.flatMap((block): LayoutBlock[] => {
      if (block.kind === "note") {
        const said = block.text ?? "";
        if (said && isReference(said) && last && !last.reference) {
          last.reference = tidyReference(said);
          return [];
        }
        return [block];
      }
      if (block.kind === "fields") {
        block.fields = block.fields.map((field) => {
          if (!field.hint || !isReference(field.hint)) return field;
          const { hint, ...rest } = field;
          return { ...rest, reference: tidyReference(hint) };
        });
        last = block.fields[block.fields.length - 1] ?? last;
      } else {
        block.table.rows = block.table.rows.map((row) => {
          if (!row.hint || !isReference(row.hint)) return row;
          const { hint, ...rest } = row;
          return { ...rest, reference: tidyReference(hint) };
        });
        last = block.table.rows[block.table.rows.length - 1] ?? last;
      }
      return [block];
    });
  }

  // Names the sheet calculates ("SPAN 2", "outside") follow their cells, unless the same words
  // are written nearer.
  const calculated = new Map<string, Token[]>();
  const written = new Map<string, Token[]>();
  for (const token of [...tokens, ...unsaid]) {
    if (token.input || token.kind === "value") continue;
    const said = cleanLabel(token.text).toLowerCase();
    const into = token.kind === "dynamic" ? calculated : written;
    if (said) into.set(said, [...(into.get(said) ?? []), token]);
  }
  const reach = (token: Token, row: number, col: number) =>
    Math.abs(row - token.row) +
    Math.abs(col - token.col) +
    (token.row > row || token.col > col ? 100 : 0);
  const nearest = (list: Token[] | undefined, row: number, col: number) =>
    list?.reduce((best, token) => (reach(token, row, col) < reach(best, row, col) ? token : best));
  const sourcesOf = (texts: string[], [row, col]: [number, number]) => {
    const out: LabelSource[] = [];
    const sourceOf = (part: string) => {
      const said = cleanLabel(part).toLowerCase();
      const source = said ? nearest(calculated.get(said), row, col) : undefined;
      const other = said ? nearest(written.get(said), row, col) : undefined;
      return source && !(other && reach(other, row, col) <= reach(source, row, col))
        ? source
        : undefined;
    };
    for (const text of texts)
      for (const part of labelParts(text, (piece) => !!sourceOf(piece))) {
        const source = sourceOf(part);
        if (!source || out.some((item) => item.text === part)) continue;
        out.push({
          text: part,
          address: at(source.row, source.col),
          from: cleanLabel(source.text),
        });
      }
    return out.length ? out : undefined;
  };
  const bindField = (field: LayoutField) => {
    if (field.labelAddress || field.live) return;
    const live = sourcesOf([field.label, field.row ?? ""], cellOf(field.address));
    if (live) field.live = live;
  };
  for (const item of kept) {
    let first: [number, number] | null = null;
    for (const block of item.blocks) {
      if (block.kind === "fields") {
        block.fields.forEach(bindField);
        first ??= block.fields[0] ? cellOf(block.fields[0].address) : null;
      } else if (block.kind === "table") {
        const { table } = block;
        const columnCell = (index: number) => {
          const cell = table.rows.find((row) => row.cells[index])?.cells[index];
          return cell ? cellOf(cell.address) : null;
        };
        const live: LabelSource[] = [];
        table.columns.forEach((column, index) => {
          const spot = columnCell(index);
          live.push(...((spot && sourcesOf([column], spot)) ?? []));
        });
        let from = 0;
        for (const group of table.groups ?? []) {
          const spot = columnCell(from);
          from += group.span;
          live.push(...((spot && sourcesOf([group.label], spot)) ?? []));
        }
        if (live.length) table.live = live;
        for (const row of table.rows) {
          const cell = row.cells.find((item) => item);
          if (!cell) continue;
          const sources = sourcesOf([row.label], cellOf(cell.address));
          if (sources) row.live = sources;
          for (const item of row.cells) {
            if (!item) continue;
            bindField(item);
            const fresh = sources?.filter(
              (source) => !item.live?.some((known) => known.text === source.text),
            );
            if (fresh?.length && !item.labelAddress) item.live = [...(item.live ?? []), ...fresh];
          }
          first ??= cellOf(cell.address);
        }
      }
    }
    const title = first && item.title ? sourcesOf([item.title], first) : undefined;
    if (title) item.live = title;
  }

  const allFields = kept.flatMap((item) =>
    item.blocks.flatMap((block) =>
      block.kind === "fields"
        ? block.fields
        : block.kind === "table"
          ? block.table.rows.flatMap((r) => r.cells.filter((c): c is LayoutField => !!c))
          : [],
    ),
  );
  const outputs = allFields.filter((field) => !field.input);
  const projectAddresses = new Set(projectFields.map((field) => field.address));
  const seenFooter = new Set<string>();
  let keyFields = keyResults(
    outputs.filter(
      (field) =>
        columnOf(field.address) - 1 <= panels[0]![1] &&
        !projectAddresses.has(field.address) &&
        !legendMark(field),
    ),
    resultFigures(kept),
    kept,
    new Set(
      tokens.filter((t) => t.kind === "dynamic" && isVerdict(t.text)).map((t) => at(t.row, t.col)),
    ),
  );
  if (!keyFields.length) keyFields = statedResults(kept, model, allCells, prefix);
  keyFields.forEach(bindField);
  return {
    sheet,
    name,
    sections: kept,
    charts,
    statuses: [...new Set(overall)],
    checks: [...new Set(checks)],
    key: keyFields,
    footer: footer.filter((block) => {
      const id = block.kind === "note" ? (block.address ?? `"${block.text}`) : "";
      if (seenFooter.has(id)) return false;
      seenFooter.add(id);
      return true;
    }),
    inputs: allFields.length - outputs.length,
    outputs: outputs.length,
    ...(ignored.length ? { ignored } : {}),
  };
}

/**
 * For a sheet whose results are sentences (PROVIDE 2 legs H10 @ 250), the bold ones a results
 * section states, named by that section; a formula that only repeats another cell is not one.
 */
function statedResults(
  sections: LayoutSection[],
  model: CalcModel,
  cells: Map<number, CellSpec>,
  prefix: string,
): LayoutField[] {
  const out: LayoutField[] = [];
  for (const section of sections) {
    const titled = RESULT_TITLE.test(section.title);
    for (const block of section.blocks) {
      if (block.kind !== "note" || !block.address) continue;
      const place = /([A-Z]+)(\d+)$/.exec(block.address);
      if (!place) continue;
      const col = columnOf(block.address) - 1;
      const cell = cells.get(key(Number(place[2]) - 1, col));
      const formula = cell?.f === undefined ? "" : (model.formulas[cell.f]?.text ?? "");
      const saved = typeof cell?.v === "string" ? cell.v : "";
      if (!(titled && block.strong) && !/^\s*provide\b/i.test(saved)) continue;
      if (!formula || /^\$?[A-Z]{1,3}\$?\d+$/i.test(formula.trim()) || isVerdict(saved)) continue;
      if (!block.address.startsWith(prefix)) continue;
      out.push({ address: block.address, label: tidyTitle(section.title), input: false });
    }
  }
  return out.slice(0, 2);
}

const tidyTitle = (title: string) => {
  const flat = cleanLabel(title);
  return shouty(flat) ? flat.charAt(0) + flat.slice(1).toLowerCase() : flat;
};

const MAX_RESULT_FIGURES = 6;

/** What a short section headed as results holds (CALCULATED CRACK WIDTH, RESULTS, SUMMARY). */
function resultFigures(sections: LayoutSection[]): Set<string> {
  const out = new Set<string>();
  for (const section of sections) {
    if (!RESULT_TITLE.test(section.title) || section.outputs > MAX_RESULT_FIGURES) continue;
    for (const block of section.blocks)
      if (block.kind === "fields")
        for (const field of block.fields) if (!field.input) out.add(field.address);
  }
  return out;
}

/** "VRd,c = CRd,c k (100ρ fck)^⅓ bw d" → "VRd,c", with the working kept as its hint. */
export function splitFormulaLabel(label: string): { label: string; formula: string } | null {
  const index = label.indexOf("=");
  if (index <= 0 || /[<>!≤≥]/.test(label[index - 1]!) || /\?\s*$/.test(label)) return null;
  const left = cleanLabel(label.slice(0, index));
  const right = label.slice(index + 1).trim();
  if (!left || left.length > 28 || !meaningful(left) || !right || !meaningful(right)) return null;
  if (!/[()[\]+\-*/^√·∙×]|\d/.test(right)) return null;
  return { label: left, formula: `= ${right}` };
}

/** "RC Density kN/m3" → "RC Density" in kN/m3; one-letter units (s, t, N) stay part of a label. */
export function trailingUnit(label: string): { label: string; unit: string } | null {
  const arrow = /^(.*?)\s*([↔↕])\s*(\S+)$/u.exec(label.trim());
  if (arrow && isUnit(arrow[3]!) && arrow[3]!.length >= 2)
    return { label: cleanLabel(`${arrow[1]} ${arrow[2]}`), unit: tidyUnit(arrow[3]!) };
  const match = /^(.*\p{L}.*?)\s+(\(?[^\s()]+\)?)$/u.exec(label.trim());
  if (!match) return null;
  const unit = match[2]!;
  const bare = unit.replace(/[()]/g, "");
  if (bare.length < 2 || /^(no|nr)\.?$/i.test(bare) || !isUnit(unit) || !meaningful(match[1]!))
    return null;
  return { label: cleanLabel(match[1]!).replace(/\s*·$/, ""), unit: tidyUnit(bare) };
}

/**
 * The figures for cards at the top: utilisations first, then what a results section holds, then
 * results the sheet sets in bold. Verdicts have their own banner, and a figure needs a name; two
 * cards with the same name are told apart by what heads their column.
 */
function keyResults(
  outputs: LayoutField[],
  results: Set<string>,
  sections: LayoutSection[],
  verdicts: Set<string> = new Set(),
): LayoutField[] {
  const named = outputs.filter(
    (field) =>
      !field.status &&
      meaningful(field.label) &&
      (field.ratio || !isUnit(field.label.replace(/^\//, ""))) &&
      !/\b(no|nr)\.?$/i.test(field.label) &&
      !/^(support|span|case)\s+\d+$/i.test(field.label),
  );
  // "Factor of Safety, Pr / P = 2.21  > 1.50  OK": a figure the sheet checks is a result.
  const checked = (field: LayoutField) =>
    !!field.hintAddress &&
    verdicts.has(field.hintAddress) &&
    `${field.row ?? ""}${field.label}`.length <= 40 &&
    !field.label.includes("=");
  const ranked = [
    ...named.filter((field) => field.ratio),
    ...named.filter((field) => !field.ratio && checked(field)),
    ...named.filter((field) => !field.ratio && results.has(field.address)),
    ...named.filter((field) => !field.ratio && !results.has(field.address) && field.strong),
  ];
  const picked = [...new Map(ranked.map((field) => [field.address, field])).values()].slice(
    0,
    MAX_KEY,
  );
  const counts = new Map<string, number>();
  for (const field of picked) counts.set(field.label, (counts.get(field.label) ?? 0) + 1);
  return picked.map((field) => {
    if (field.row || (counts.get(field.label) ?? 0) < 2) return { ...field };
    const context = columnContext(field, sections);
    return context && context.length <= 24 ? { ...field, row: context } : { ...field };
  });
}

const columnOf = (cellAddress: string) =>
  [...(/([A-Z]+)\d+$/.exec(cellAddress)?.[1] ?? "A")].reduce(
    (n, ch) => n * 26 + ch.charCodeAt(0) - 64,
    0,
  );

/** "Sheet!C5" → [4, 2]. */
const cellOf = (cellAddress: string): [number, number] => [
  Number(/(\d+)$/.exec(cellAddress)?.[1] ?? 1) - 1,
  columnOf(cellAddress) - 1,
];

/** How labels join their parts, outermost first: "SPAN 2 · H", "Span 1 & Span 2". */
const LABEL_JOINS = [" · ", " & "];

/** A label's parts, each whole where it can be and split further where it cannot. */
function labelParts(text: string, keep: (part: string) => boolean, depth = 0): string[] {
  if (keep(text) || depth >= LABEL_JOINS.length) return [text];
  return text.split(LABEL_JOINS[depth]!).flatMap((piece) => labelParts(piece, keep, depth + 1));
}

/** A label with each calculated part as its cell reads now; parts that now read blank drop out. */
export function liveLabel(
  label: string,
  live: LabelSource[] | undefined,
  read: (address: string) => string,
): string {
  if (!live?.length) return label;
  const join = (text: string, depth: number): string => {
    const source = live.find((item) => item.text === text);
    if (source) {
      const now = cleanLabel(read(source.address));
      if (now === source.from) return text;
      return source.text === source.from ? now : tidyTitle(now);
    }
    if (depth >= LABEL_JOINS.length) return text;
    const glue = LABEL_JOINS[depth]!;
    return text
      .split(glue)
      .map((piece) => join(piece, depth + 1))
      .filter(Boolean)
      .join(glue);
  };
  return join(label, 0) || label;
}

/** The first other field above a field in its column and section: "Mxx" for a "Provide" under it. */
function columnContext(field: LayoutField, sections: LayoutSection[]): string | null {
  for (const section of sections)
    for (const block of section.blocks) {
      if (block.kind !== "fields" || !block.fields.includes(field)) continue;
      const col = columnOf(field.address);
      const above = block.fields.find(
        (other) =>
          other !== field &&
          columnOf(other.address) === col &&
          other.label !== field.label &&
          meaningful(other.label),
      );
      return above?.label ?? null;
    }
  return null;
}
