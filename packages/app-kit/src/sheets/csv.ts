/** One cell of a sheet an app builds or reads. */
export type Cell = string | number | boolean | null;

export type Sheet = { name: string; rows: Cell[][] };

const NEEDS_QUOTES = /[",\n\r]/;

function quote(value: Cell | undefined): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : String(value);
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows as a CSV file, with a header row when the caller puts one first. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<Cell | undefined>>): string {
  return rows.map((row) => row.map(quote).join(",")).join("\r\n");
}

/** CSV text as rows. Quoted commas, quotes and line breaks stay inside the cell. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** A pandas DataFrame, as @ocsc/python returns it, into rows with the column names first. */
export function frameRows(frame: { columns: string[]; data: unknown[][] }): string[][] {
  return [
    frame.columns.map(String),
    ...frame.data.map((row) => row.map((value) => (value === null || value === undefined ? "" : String(value)))),
  ];
}
