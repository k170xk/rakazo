import { Engine, fromJson } from "./engine.js";
import { formatValue } from "./format.js";
import type { CalcModel, CellValueJson } from "./model.js";
import { address } from "./model.js";
import { functionsIn } from "./parse.js";
import { printFormula } from "./print.js";
import type { Scalar } from "./values.js";
import { round15, XlError } from "./values.js";

/**
 * The import gate: calculate every formula from the values saved in the workbook and compare each
 * result with the one Excel saved beside it. A workbook passes only when every formula cell agrees
 * to Excel's 15 significant digits (text, logicals and errors exactly). Cells whose results Excel
 * itself would change on reopening (RAND and what depends on it) are listed apart, not hidden.
 */

export type Mismatch = {
  sheet: string;
  cell: string;
  formula: string;
  expected: CellValueJson;
  actual: CellValueJson;
  /** The formula's result from Excel's own saved values for the cells it reads. */
  replayed: CellValueJson;
};

export type Verification = {
  /** Formula cells compared, including every cell of array formulas. */
  checked: number;
  matched: number;
  /**
   * Results that differ from Excel's only in digits beyond the 15th passed down from earlier cells:
   * the formula itself replays exactly, and the value shows the same in the cell's number format.
   */
  drift: number;
  /** The largest relative difference among drift results. */
  maxDrift: number;
  mismatches: Mismatch[];
  /** Mismatches in cells that depend on a function outside Excel (VBA, add-ins): expected, not engine faults. */
  blocked: number;
  /** Cells left out of the comparison, with the reason. */
  skipped: Array<{ sheet: string; cell: string; reason: string }>;
  circular: string[];
  missingFunctions: string[];
  /** The date-time TODAY() and NOW() were pinned to (taken from the workbook's own saved results). */
  now: number | null;
  /** The older Excel version whose rules the saved results were checked with, if not the current ones. */
  rules?: number;
  passed: boolean;
};

const VOLATILE_RANDOM = new Set(["RAND", "RANDBETWEEN", "RANDARRAY"]);
const CLOCK = new Set(["TODAY", "NOW"]);

export type VerifyOptions = { now?: number; maxMismatches?: number };

/**
 * Verifies, and when dates typed as text are involved and the first reading disagrees, tries the
 * other day/month order too: the saved results show which regional setting the workbook was
 * calculated with, and the model keeps that one.
 */
export function verifyModel(model: CalcModel, options: VerifyOptions = {}): Verification {
  const first = verifyOnce(model, options);
  if (first.passed || !hasTextDates(model)) return first;
  const original = model.dateOrder;
  model.dateOrder = original === "dmy" ? "mdy" : "dmy";
  const second = verifyOnce(model, options);
  const wrong = (v: Verification) => v.checked - v.matched;
  if (wrong(second) < wrong(first)) return second;
  model.dateOrder = original;
  return first;
}

/** The rules of the Excel that saved the results, when it is older than the ones the engine follows. */
function savedRules(model: CalcModel): number | undefined {
  const major = Number.parseInt(model.source.appVersion ?? "", 10);
  return model.source.excelCalculated && major >= 9 && major < 14 ? major : undefined;
}

function hasTextDates(model: CalcModel): boolean {
  return model.sheets.some((sheet) =>
    sheet.cells.some(
      ([, , cell]) =>
        typeof cell.v === "string" && /^\s*\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/.test(cell.v),
    ),
  );
}

function verifyOnce(model: CalcModel, options: VerifyOptions): Verification {
  const engine = new Engine(model);
  const sheetNames = model.sheets.map((s) => s.name);

  // Pin the clock to what the workbook last calculated, read from a cell holding just TODAY() or NOW().
  let now = options.now ?? null;
  const random: Array<[number, number, number]> = [];
  const custom: Array<[number, number, number]> = [];
  const clock: Array<[number, number, number]> = [];
  model.sheets.forEach((sheet, s) => {
    for (const [row, col, cell] of sheet.cells) {
      if (cell.f === undefined) continue;
      const node = engine.formulaNode(cell.f);
      const fns = functionsIn(node);
      if ([...fns].some((f) => VOLATILE_RANDOM.has(f))) random.push([s, row, col]);
      if ([...fns].some((f) => CLOCK.has(f))) clock.push([s, row, col]);
      if ([...fns].some((f) => engine.missingFunctions.has(f)) || node.k === "err")
        custom.push([s, row, col]);
      if (
        now === null &&
        node.k === "fn" &&
        CLOCK.has(node.name) &&
        node.args.length === 0 &&
        typeof cell.v === "number"
      )
        now = cell.v;
    }
  });
  const randomCells = new Set(engine.dependentsOf(random).map(([s, r, c]) => `${s}:${r}:${c}`));
  const customCells = new Set(engine.dependentsOf(custom).map(([s, r, c]) => `${s}:${r}:${c}`));
  const clockCells =
    now === null
      ? new Set(engine.dependentsOf(clock).map(([s, r, c]) => `${s}:${r}:${c}`))
      : new Set<string>();

  const rules = savedRules(model);
  engine.calculate({ now: now ?? undefined, seed: 1, rules });
  const replay = new Engine(model);
  replay.calculate({ now: now ?? undefined, seed: 1, replay: true, rules });
  let drift = 0;
  let maxDrift = 0;

  const mismatches: Mismatch[] = [];
  const skipped: Verification["skipped"] = [];
  let checked = 0;
  let matched = 0;
  const limit = options.maxMismatches ?? 500;
  let mismatchCount = 0;
  let blocked = 0;

  model.sheets.forEach((sheet, s) => {
    if (sheet.external) return;
    const saved = new Map<string, CellValueJson | undefined>();
    for (const [row, col, cell] of sheet.cells) saved.set(`${row}:${col}`, cell.v);
    for (const [row, col, cell] of sheet.cells) {
      if (cell.f === undefined) continue;
      const formula = () => printFormula(engine.formulaNode(cell.f!), row, col, sheetNames);
      const id = `${s}:${row}:${col}`;
      const cellsOfFormula: Array<[number, number]> = [];
      if (cell.a && !cell.d) {
        for (let r = row; r <= cell.a[0]; r++)
          for (let c = col; c <= cell.a[1]; c++) cellsOfFormula.push([r, c]);
      } else cellsOfFormula.push([row, col]);
      for (const [r, c] of cellsOfFormula) {
        const at = address(r, c);
        if (randomCells.has(id)) {
          skipped.push({
            sheet: sheet.name,
            cell: at,
            reason: "Depends on RAND, which Excel recalculates on every change.",
          });
          continue;
        }
        if (clockCells.has(id)) {
          skipped.push({
            sheet: sheet.name,
            cell: at,
            reason: "Depends on the date, and the workbook saved no plain TODAY() to pin it.",
          });
          continue;
        }
        const expected = saved.get(`${r}:${c}`);
        if (expected === undefined) {
          skipped.push({
            sheet: sheet.name,
            cell: at,
            reason: "Excel saved no result for this cell.",
          });
          continue;
        }
        checked++;
        const actual = engine.cellValue(s, r, c);
        const excel = fromJson(expected);
        if (same(excel, actual)) {
          matched++;
          continue;
        }
        if (customCells.has(id)) {
          blocked++;
          continue;
        }
        const replayed = replay.result(s, r, c);
        const format = cell.z !== undefined ? (model.formats[cell.z] ?? "General") : "General";
        if (
          same(excel, replayed) &&
          formatValue(excel, format).text === formatValue(actual, format).text
        ) {
          matched++;
          drift++;
          if (typeof excel === "number" && typeof actual === "number" && excel !== 0)
            maxDrift = Math.max(maxDrift, Math.abs((actual - excel) / excel));
          continue;
        }
        mismatchCount++;
        if (mismatches.length < limit)
          mismatches.push({
            sheet: sheet.name,
            cell: at,
            formula: formula(),
            expected,
            actual: toJsonValue(actual),
            replayed: toJsonValue(replayed),
          });
      }
    }
  });

  const missingFunctions = [...engine.missingFunctions].sort();
  return {
    checked,
    matched,
    drift,
    maxDrift,
    mismatches,
    blocked,
    skipped,
    circular: model.iterate ? [] : engine.circular,
    missingFunctions,
    now,
    ...(rules ? { rules } : {}),
    passed: mismatchCount === 0 && blocked === 0 && missingFunctions.length === 0,
  };
}

/** Excel's own equality for saved results: numbers to 15 significant digits, the rest exactly. */
export function same(expected: Scalar, actual: Scalar): boolean {
  if (expected === actual) return true;
  if (typeof expected === "number" && typeof actual === "number") {
    if (round15(expected) === round15(actual)) return true;
    // A result Excel saved as 0 that differs only by rounding noise below its 15 digits.
    return Math.abs(expected - actual) <= Math.abs(expected) * 1e-15;
  }
  if (expected instanceof XlError && actual instanceof XlError)
    return expected.code === actual.code;
  // A formula that returns an empty cell is saved as an empty string by some writers and as 0 by Excel.
  if ((expected === "" && actual === null) || (expected === null && actual === "")) return true;
  if (expected === 0 && actual === null) return true;
  return false;
}

function toJsonValue(value: Scalar): CellValueJson {
  if (value instanceof XlError) return { e: value.code };
  return value;
}

/** A short, readable account of a verification for import reports. */
export function describeVerification(result: Verification): string[] {
  const lines: string[] = [];
  if (result.passed) {
    lines.push(
      `All ${result.checked.toLocaleString("en-GB")} formula results match the values Excel saved.`,
    );
    if (result.drift)
      lines.push(
        `${result.drift.toLocaleString("en-GB")} of them differ only beyond the 15th digit, carried from earlier cells (largest ${result.maxDrift.toExponential(1)}); each formula replays exactly and shows the same.`,
      );
  } else {
    const failed = result.checked - result.matched - result.blocked;
    lines.push(
      `${failed.toLocaleString("en-GB")} of ${result.checked.toLocaleString("en-GB")} formula results differ from the values Excel saved.`,
    );
    for (const m of result.mismatches.slice(0, 20))
      lines.push(
        `${m.sheet}!${m.cell} ${m.formula}: Excel ${show(m.expected)}, here ${show(m.actual)} (from Excel's inputs ${show(m.replayed)})`,
      );
    if (result.mismatches.length > 20) lines.push(`…and ${result.mismatches.length - 20} more.`);
  }
  if (result.blocked)
    lines.push(
      `${result.blocked.toLocaleString("en-GB")} results depend on functions Excel itself does not have (VBA or add-ins).`,
    );
  for (const name of result.missingFunctions) lines.push(`Not calculated: ${name}.`);
  if (result.skipped.length)
    lines.push(`${result.skipped.length} cells not compared (random or date-dependent).`);
  if (result.circular.length)
    lines.push(`Circular references: ${result.circular.slice(0, 10).join(", ")}.`);
  if (result.rules)
    lines.push(
      `Saved by Excel ${EXCEL_YEARS[result.rules] ?? result.rules}, so checked with its rules; the app follows current Excel, where CEILING and FLOOR of a negative number with a positive step round instead of giving #NUM!.`,
    );
  return lines;
}

const EXCEL_YEARS: Record<number, string> = { 9: "2000", 10: "2002", 11: "2003", 12: "2007" };

function show(value: CellValueJson): string {
  if (value === null) return "(empty)";
  if (typeof value === "object") return value.e;
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}
