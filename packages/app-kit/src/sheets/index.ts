import { download, downloadBytes } from "../sdk/index.js";
import { frameRows, parseCsv, toCsv, type Cell, type Sheet } from "./csv.js";
import { readSheets, writeSheets } from "./excel.js";

export { frameRows, parseCsv, toCsv } from "./csv.js";
export { readSheets, writeSheets } from "./excel.js";
export type { Cell, Sheet } from "./csv.js";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Saves rows as a .csv file. Call it from a click. */
export async function downloadCsv(filename: string, rows: ReadonlyArray<ReadonlyArray<Cell | undefined>>) {
  const name = filename.toLowerCase().endsWith(".csv") ? filename : `${filename}.csv`;
  await download(name, toCsv(rows), "text/csv");
}

/** Saves sheets as an .xlsx file. Call it from a click. */
export async function downloadWorkbook(filename: string, sheets: Sheet[]) {
  const name = filename.toLowerCase().endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  await downloadBytes(name, XLSX, writeSheets(sheets));
}
