import type { ErrorCode } from "./values.js";

/**
 * A workbook compiled for calculation: what every cell holds, every formula once (with the cell it
 * was written in, so its relative references shift the way Excel shifts them), names, tables,
 * cached external values, and which cells are the inputs a person may change. It is plain JSON so
 * it can live in an app's files and be checked again later against the original workbook.
 */

export type CellValueJson = number | string | boolean | { e: ErrorCode } | null;

export type CellSpec = {
  /** The value Excel saved for the cell (for a formula, the result it last calculated). */
  v?: CellValueJson;
  /** Index into `formulas`. */
  f?: number;
  /** An array formula's range, bottom-right corner (zero-based), held on its top-left cell. */
  a?: [number, number];
  /** The array formula is a dynamic one that spills to whatever size its result is. */
  d?: true;
  /** Index into `formats` (Excel number format codes). */
  z?: number;
  /** Index into `styles`. */
  s?: number;
};

export type SheetSpec = {
  name: string;
  hidden?: boolean;
  /** Used area, zero-based inclusive. */
  rows: number;
  cols: number;
  /** Column widths in characters and row heights in points, where the workbook sets them. */
  colWidths?: Array<number | null>;
  rowHeights?: Array<number | null>;
  hiddenCols?: number[];
  hiddenRows?: number[];
  merges?: Array<[number, number, number, number]>;
  protected?: boolean;
  /** Cells as [row, col, spec]. */
  cells: Array<[number, number, CellSpec]>;
  /** Pictures and charts on the sheet the app cannot draw from cells alone. */
  drawings?: number;
  /** Values cached from another workbook, named "[n]Sheet" as formulas refer to it. */
  external?: true;
  /** The print area, zero-based inclusive: the part of the sheet laid out for people to read. */
  printArea?: [number, number, number, number];
};

export type CellStyle = {
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  color?: string;
  fill?: string;
  size?: number;
  align?: "left" | "center" | "right" | "justify";
  valign?: "top" | "middle" | "bottom";
  wrap?: true;
  indent?: number;
  rotate?: number;
  border?: { t?: string; r?: string; b?: string; l?: string };
  /** The cell is unlocked: on a protected sheet that is how a workbook marks what people type. */
  unlocked?: true;
  hidden?: true;
};

export type InputSpec = {
  sheet: number;
  row: number;
  col: number;
  /** The nearest label to its left or above, for screens and test reports. */
  label?: string;
  kind: "number" | "text" | "boolean" | "date" | "choice";
  /** Choices from a list validation, as they stood when the workbook was saved. */
  options?: Array<string | number>;
  /** The list validation's source when it is a range or formula, so choices can follow other inputs. */
  optionsFormula?: string;
  /** Short text beside the cell (mm, kN/m²…). */
  unit?: string;
  /** The cell's comment or validation prompt. */
  help?: string;
  min?: number;
  max?: number;
  integer?: boolean;
  /** Why the compiler took this cell for an input. */
  why: "unlocked" | "validation" | "constant";
};

export type NameSpec = { name: string; sheet?: number; formula: string; hidden?: true };

export type TableSpec = {
  name: string;
  sheet: number;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  header: boolean;
  totals: boolean;
  columns: string[];
};

/** A series of a workbook chart, its data as the references the chart reads. */
export type ChartSeriesSpec = {
  /** The series name as text, or a reference to the cell holding it. */
  name?: string;
  nameRef?: string;
  /** Categories (bar, line) or x values (scatter). */
  x?: string;
  y: string;
  /** Drawn with a line between points (scatter and line charts). */
  line?: boolean;
  marker?: boolean;
};

/** A chart drawn on a sheet, redrawn by the app from the cells it plots. */
export type ChartSpec = {
  sheet: number;
  kind: "bar" | "column" | "line" | "area" | "scatter" | "pie";
  title?: string;
  /** Top-left and bottom-right cells it covers, zero-based. */
  anchor: [number, number, number, number];
  series: ChartSeriesSpec[];
  stacked?: boolean;
  /** Both axes hidden: a drawing to scale rather than a graph. */
  drawing?: boolean;
  xTitle?: string;
  yTitle?: string;
  /** Number format codes of the axes, as Excel shows their labels. */
  xFormat?: string;
  yFormat?: string;
};

export type CalcModel = {
  version: 1;
  /** `application` is the program that last saved the file; only Excel's saved results are Excel's. */
  source: {
    fileName: string;
    sha256: string;
    application?: string;
    /** That program's version (16.0300; 11.9999 is Excel 2003), which decides the rules its saved results follow. */
    appVersion?: string;
    /** Excel calculated the saved results (it writes a calculation chain; generators and other apps do not). */
    excelCalculated?: boolean;
    /** Folder and book part of CELL("filename") (`C:\\Work\\[Pads.xlsm]`), from a result Excel saved. */
    bookPath?: string;
  };
  date1904: boolean;
  /** How dates typed as text are read, as the computer that last calculated the workbook read them. */
  dateOrder?: "mdy" | "dmy";
  iterate?: { count: number; delta: number };
  /**
   * The file says iterative calculation is off. Excel then leaves cells in a circular reference,
   * and every cell that depends on them, at the values they last had (0 for new ones).
   */
  iterationOff?: true;
  sheets: SheetSpec[];
  formulas: Array<{ text: string; row: number; col: number }>;
  formats: string[];
  styles: CellStyle[];
  names: NameSpec[];
  tables: TableSpec[];
  /** External workbook values Excel cached, by "[book]Sheet!A1"; they stay as saved. */
  externals: Record<string, CellValueJson>;
  inputs: InputSpec[];
  /** Workbook features the model cannot carry, each named for the import report. */
  unsupported: string[];
  charts?: ChartSpec[];
};

export const address = (row: number, col: number) => `${columnName(col)}${row + 1}`;

export function columnName(col: number): string {
  let name = "";
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/** "Sheet!B3" or "'My sheet'!B3" into its parts, zero-based. */
export function parseAddress(
  text: string,
  sheetIndex: (name: string) => number,
  defaultSheet = 0,
): { sheet: number; row: number; col: number } | null {
  const match = /^(?:(?:'((?:[^']|'')+)'|([^!]+))!)?\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(text.trim());
  if (!match) return null;
  const name = match[1]?.replace(/''/g, "'") ?? match[2];
  const sheet = name === undefined ? defaultSheet : sheetIndex(name);
  if (sheet < 0) return null;
  const col =
    match[3]!
      .toUpperCase()
      .split("")
      .reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return { sheet, row: Number(match[4]) - 1, col };
}

export const quoteSheet = (name: string) =>
  /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name)
    ? name
    : `'${name.replace(/'/g, "''")}'`;
