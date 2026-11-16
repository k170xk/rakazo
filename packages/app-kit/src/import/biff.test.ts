import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { readBiffCharts, readBiffPrintAreas } from "./biff.js";
import { parseArea } from "./extras.js";

const record = (type: number, body: number[]) => [
  type & 0xff,
  type >> 8,
  body.length & 0xff,
  body.length >> 8,
  ...body,
];
const u16 = (n: number) => [n & 0xff, n >> 8];
const u32 = (n: number) => [...u16(n & 0xffff), ...u16(n >>> 16)];
const bof = (kind: number) =>
  record(0x0809, [...u16(0x0600), ...u16(kind), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const eof = () => record(0x000a, []);
const area3d = (r1: number, r2: number, c1: number, c2: number) => [
  0x3b,
  ...u16(0),
  ...u16(r1),
  ...u16(r2),
  ...u16(c1),
  ...u16(c2),
];
const brai = (id: number, rgce: number[]) =>
  record(0x1051, [id, 2, ...u16(0), ...u16(0), ...u16(rgce.length), ...rgce]);
const text = (value: string) => [value.length, 0, ...[...value].map((c) => c.charCodeAt(0))];

/** A one-sheet .xls holding a scatter chart of B2:B6 against A2:A6, both axes hidden. */
function workbook(): Uint8Array {
  const anchor = [
    ...u16(0),
    ...u16(0xf010),
    ...u32(18),
    ...u16(0),
    ...u16(3),
    0,
    0,
    ...u16(1),
    0,
    0,
    ...u16(9),
    0,
    0,
    ...u16(15),
    0,
    0,
  ];
  const chart = [
    ...bof(0x0020),
    ...record(0x101b, [...u16(100), ...u16(1), ...u16(0)]),
    ...record(0x1003, [...u16(1), ...u16(1), ...u16(5), ...u16(5), ...u16(1), ...u16(0)]),
    ...record(0x1033, []),
    ...brai(0, []),
    ...brai(1, area3d(1, 5, 1, 1)),
    ...brai(2, area3d(1, 5, 0, 0)),
    ...record(0x100d, [...u16(0), ...text("Wall")]),
    ...record(0x1034, []),
    ...record(0x101d, [...u16(0), ...Array(16).fill(0)]),
    ...record(0x101e, [2, 0, 0, 1, ...Array(26).fill(0)]),
    ...record(0x101d, [...u16(1), ...Array(16).fill(0)]),
    ...record(0x101e, [2, 0, 0, 1, ...Array(26).fill(0)]),
    ...eof(),
  ];
  const sheetName = text("Plot");
  const globalsWithout = (offset: number) => [
    ...bof(0x0005),
    ...record(0x0085, [...u32(offset), 0, 0, ...sheetName]),
    ...record(0x0017, [...u16(1), ...u16(0), ...u16(0), ...u16(0)]),
    ...eof(),
  ];
  const offset = globalsWithout(0).length;
  const stream = [
    ...globalsWithout(offset),
    ...bof(0x0010),
    ...record(0x00ec, anchor),
    ...chart,
    ...eof(),
  ];
  const cfb = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(cfb, "/Workbook", new Uint8Array(stream));
  return new Uint8Array(XLSX.CFB.write(cfb, { type: "array" }) as ArrayLike<number>);
}

describe("legacy .xls charts", () => {
  it("reads an embedded chart's type, series ranges, name, place and hidden axes", () => {
    expect(readBiffCharts(workbook())).toEqual([
      {
        sheet: 0,
        kind: "scatter",
        anchor: [1, 3, 15, 9],
        drawing: true,
        series: [
          { y: "Plot!$B$2:$B$6", x: "Plot!$A$2:$A$6", name: "Wall", line: true, marker: true },
        ],
      },
    ]);
  });

  it("finds no charts in files that are not BIFF workbooks", () => {
    expect(readBiffCharts(new Uint8Array([0x50, 0x4b, 3, 4]))).toEqual([]);
  });
});

describe("legacy .xls print areas", () => {
  it("keeps every range of a print area printing several", () => {
    const rgce = [0x29, ...u16(22), ...area3d(1, 40, 1, 9), ...area3d(59, 117, 1, 9), 0x10];
    const name = record(0x0018, [
      ...u16(0x20),
      0,
      1,
      ...u16(rgce.length),
      ...u16(0),
      ...u16(1),
      0,
      0,
      0,
      0,
      0,
      0x06,
      ...rgce,
    ]);
    const stream = [
      ...bof(0x0005),
      ...record(0x0085, [...u32(0), 0, 0, ...text("Design")]),
      ...record(0x0017, [...u16(1), ...u16(0), ...u16(0), ...u16(0)]),
      ...name,
      ...eof(),
    ];
    const cfb = XLSX.CFB.utils.cfb_new();
    XLSX.CFB.utils.cfb_add(cfb, "/Workbook", new Uint8Array(stream));
    const bytes = new Uint8Array(XLSX.CFB.write(cfb, { type: "array" }) as ArrayLike<number>);
    const areas = readBiffPrintAreas(bytes);
    expect(areas).toEqual([{ sheet: 0, ref: "Design!$B$2:$J$41,Design!$B$60:$J$118" }]);
    expect(parseArea(areas[0]!.ref)).toEqual([1, 1, 117, 9]);
  });
});
