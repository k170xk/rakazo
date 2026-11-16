import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { compileWorkbook } from "./compile.js";

/** A BIFF8 record: type, length, body. */
function record(type: number, body: number[]): number[] {
  return [type & 0xff, type >> 8, body.length & 0xff, body.length >> 8, ...body];
}

const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number) => [...u16(n & 0xffff), ...u16(n >>> 16)];
/** XLUnicodeString with one-byte characters. */
const unicode = (text: string) => [
  ...u16(text.length),
  0,
  ...[...text].map((c) => c.charCodeAt(0)),
];
const empty = () => unicode("\0");

/** A DV record: rule flags, formula tokens, and cells as [row, col] (zero-based). */
function dv(flags: number, formula1: number[], formula2: number[], cells: Array<[number, number]>) {
  return record(0x01be, [
    ...u32(flags),
    ...empty(),
    ...empty(),
    ...unicode("Pick one"),
    ...empty(),
    ...u16(formula1.length),
    0,
    0,
    ...formula1,
    ...u16(formula2.length),
    0,
    0,
    ...formula2,
    ...u16(cells.length),
    ...cells.flatMap(([r, c]) => [...u16(r), ...u16(r), ...u16(c), ...u16(c)]),
  ]);
}

/** A one-sheet .xls written by SheetJS, with the given records added before the sheet's EOF. */
function legacyWorkbook(rows: unknown[][], extra: number[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  const bytes = XLSX.write(wb, { bookType: "biff8", type: "array" }) as ArrayBuffer;
  const cfb = XLSX.CFB.read(new Uint8Array(bytes), { type: "array" });
  const entry = XLSX.CFB.find(cfb, "Workbook")!;
  const stream = new Uint8Array(entry.content as ArrayLike<number>);
  // The sheet substream is last, so its EOF is the stream's final record and no offsets move.
  const end = stream.length - 4;
  const content = new Uint8Array([...stream.slice(0, end), ...extra, ...stream.slice(end)]);
  XLSX.CFB.utils.cfb_add(cfb, "/Workbook", content);
  return new Uint8Array(XLSX.CFB.write(cfb, { type: "array" }) as ArrayLike<number>);
}

describe("legacy .xls data validation", () => {
  it("reads list, range and number rules into inputs", async () => {
    const list = [0x17, 5, 0, ..."a\0b\0c".split("").map((c) => c.charCodeAt(0))];
    const area = [0x25, ...u16(0), ...u16(2), ...u16(3), ...u16(3)];
    const bytes = legacyWorkbook(
      [
        ["Kind", "a", "=B1", "x"],
        ["Size", 2, "=B2", "y"],
        ["Count", 3, "=B3", "z"],
      ].map((row) => row.map((v) => (typeof v === "string" && v.startsWith("=") ? 0 : v))),
      [
        ...dv(0x03 | 0x80 | 0x40000, list, [], [[0, 1]]),
        ...dv(0x03, area, [], [[1, 1]]),
        ...dv(0x01 | (6 << 20), [0x1e, ...u16(1)], [], [[2, 1]]),
      ],
    );
    const { model } = await compileWorkbook(bytes, "book.xls");
    const at = (row: number) => model.inputs.find((i) => i.row === row && i.col === 1);
    expect(at(0)).toMatchObject({ kind: "choice", options: ["a", "b", "c"], help: "Pick one" });
    expect(at(1)).toMatchObject({
      kind: "choice",
      optionsFormula: "$D$1:$D$3",
      options: ["x", "y", "z"],
    });
    expect(at(2)).toMatchObject({ kind: "number", integer: true, min: 1 });
    expect(at(2)?.max).toBeUndefined();
  });
});
