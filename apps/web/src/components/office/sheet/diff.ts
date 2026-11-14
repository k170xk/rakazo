import { cellRef } from "./address";

/** A cell as the history compares it: what it shows, and its formula without the `=`. */
export type SheetCellSnapshot = { value: string; formula: string | null };

/** Every sheet's non-empty cells, keyed by row and column. */
export type WorkbookSnapshot = {
  sheets: { name: string; cells: Map<string, SheetCellSnapshot> }[];
};

export type CellChange = {
  ref: string;
  row: number;
  col: number;
  before: SheetCellSnapshot | null;
  after: SheetCellSnapshot | null;
};

export type SheetDiffGroup = {
  sheet: string;
  status: "added" | "removed" | "changed";
  /** Changed cells in reading order, at most CELL_CHANGES_MAX per sheet. */
  cells: CellChange[];
  /** How many cells changed on this sheet in all. */
  total: number;
};

export type WorkbookDiff = { groups: SheetDiffGroup[]; cells: number };

/** Beyond this many changed cells on one sheet, the rest are counted, not listed. */
export const CELL_CHANGES_MAX = 300;

const key = (row: number, col: number) => `${row}:${col}`;

/** Each worksheet's cells with their shown values and formulas. */
export async function readWorkbookSnapshot(bytes: Uint8Array): Promise<WorkbookSnapshot> {
  const [{ iterWorksheets }, { cellView, openWorkbook, rawInput }] = await Promise.all([
    import("@office-kit/xlsx/workbook"),
    import("./workbook"),
  ]);
  const wb = await openWorkbook(bytes);
  const sheets: WorkbookSnapshot["sheets"] = [];
  for (const ws of iterWorksheets(wb)) {
    const cells = new Map<string, SheetCellSnapshot>();
    for (const [row, cols] of ws.rows) {
      for (const [col, cell] of cols) {
        const raw = rawInput(wb, cell);
        const value = cellView(wb, cell).text;
        if (!raw && !value) continue;
        cells.set(key(row, col), {
          value,
          formula: raw.startsWith("=") ? raw.slice(1) : null,
        });
      }
    }
    sheets.push({ name: ws.title, cells });
  }
  return { sheets };
}

function same(a: SheetCellSnapshot | undefined, b: SheetCellSnapshot | undefined): boolean {
  return (a?.value ?? "") === (b?.value ?? "") && (a?.formula ?? null) === (b?.formula ?? null);
}

/** Changed cells, old and new, grouped by sheet in the newer version's tab order. */
export function diffWorkbook(
  before: WorkbookSnapshot | null,
  after: WorkbookSnapshot,
): WorkbookDiff {
  const old = new Map((before?.sheets ?? []).map((sheet) => [sheet.name, sheet.cells]));
  const names = [
    ...after.sheets.map((sheet) => sheet.name),
    ...(before?.sheets ?? [])
      .map((sheet) => sheet.name)
      .filter((name) => !after.sheets.some((s) => s.name === name)),
  ];
  const fresh = new Map(after.sheets.map((sheet) => [sheet.name, sheet.cells]));
  const groups: SheetDiffGroup[] = [];
  let total = 0;
  for (const name of names) {
    const a = old.get(name);
    const b = fresh.get(name);
    const keys = new Set([...(a?.keys() ?? []), ...(b?.keys() ?? [])]);
    const changed: CellChange[] = [];
    for (const k of keys) {
      const was = a?.get(k);
      const now = b?.get(k);
      if (same(was, now)) continue;
      const [row, col] = k.split(":").map(Number) as [number, number];
      changed.push({
        ref: cellRef({ row, col }),
        row,
        col,
        before: was ?? null,
        after: now ?? null,
      });
    }
    if (changed.length === 0 && a && b) continue;
    changed.sort((x, y) => x.row - y.row || x.col - y.col);
    total += changed.length;
    groups.push({
      sheet: name,
      status: !a ? "added" : !b ? "removed" : "changed",
      cells: changed.slice(0, CELL_CHANGES_MAX),
      total: changed.length,
    });
  }
  return { groups, cells: total };
}
