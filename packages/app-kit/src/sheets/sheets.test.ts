import { describe, expect, it } from "vitest";
import { frameRows, parseCsv, toCsv } from "./csv.js";
import { readSheets, writeSheets } from "./excel.js";

describe("CSV", () => {
  it("keeps commas, quotes and line breaks inside a cell", () => {
    const rows = [
      ["job", "note"],
      ["26/014", 'He said "hold"'],
      ["26/015", "line one\nline two"],
    ];
    const text = toCsv(rows);
    expect(parseCsv(text)).toEqual(rows);
  });

  it("turns a Python DataFrame into a sheet", () => {
    expect(frameRows({ columns: ["span", "moment"], data: [[6, 112.5], [8, null]] })).toEqual([
      ["span", "moment"],
      ["6", "112.5"],
      ["8", ""],
    ]);
  });
});

describe("Excel", () => {
  it("writes a workbook and reads the same cells back", () => {
    const sheets = [
      {
        name: "Loads",
        rows: [
          ["level", "dead", "live", "ok"],
          ["Ground", 120, 45.5, true],
          ["First", null, 30, false],
        ],
      },
    ];
    const read = readSheets(writeSheets(sheets));
    expect(read).toEqual([
      {
        name: "Loads",
        rows: [
          ["level", "dead", "live", "ok"],
          ["Ground", 120, 45.5, true],
          ["First", null, 30, false],
        ],
      },
    ]);
  });
});
