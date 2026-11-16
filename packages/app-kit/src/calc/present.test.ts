import { describe, expect, it } from "vitest";
import type { LayoutField, LayoutSection, SheetLayout } from "./layout.js";
import type { CalcModel, SheetSpec } from "./model.js";
import {
  axisTicks,
  calcReport,
  checkSummary,
  detailSheets,
  displayNumber,
  fieldLanes,
  filterSections,
  formSheets,
  generalText,
  helperSheet,
  looseInputs,
  pageSheets,
  readSavedInputs,
  restorableInputs,
  seriesSegments,
  tidyText,
} from "./present.js";

const field = (address: string, label: string, extra: Partial<LayoutField> = {}): LayoutField => ({
  address,
  label,
  input: false,
  ...extra,
});

const sheet = (name: string, extra: Partial<SheetSpec> = {}): SheetSpec => ({
  name,
  rows: 1,
  cols: 1,
  cells: [[0, 0, { v: name }]],
  ...extra,
});

const model = (sheets: SheetSpec[], inputSheets: number[]): CalcModel => ({
  version: 1,
  source: { fileName: "x.xlsx", sha256: "" },
  date1904: false,
  sheets,
  formulas: [],
  formats: [],
  styles: [],
  names: [],
  tables: [],
  externals: {},
  inputs: inputSheets.map((index) => ({
    sheet: index,
    row: 0,
    col: 1,
    kind: "number",
    why: "unlocked",
  })),
  unsupported: [],
});

describe("calculator presentation", () => {
  it("reads shouting headings as sentence case and leaves short capitals alone", () => {
    expect(tidyText("COLUMN REACTIONS")).toBe("Column reactions");
    expect(tidyText("PUNCHING SHEAR TO EN 1992")).toBe("Punching shear to EN 1992");
    expect(tidyText("Bearing pressure (SLS)")).toBe("Bearing pressure (SLS)");
    expect(tidyText("  fck  ")).toBe("fck");
  });

  it("makes a page of each visible sheet with inputs and keeps every sheet for the details", () => {
    const book = model(
      [
        sheet("Cover"),
        sheet("Design"),
        sheet("Lookup", { hidden: true }),
        sheet("Empty", { cells: [] }),
      ],
      [1, 2],
    );
    expect(formSheets(book)).toEqual([1]);
    expect(detailSheets(book)).toEqual([0, 1, 2]);
  });

  it("keeps side-by-side columns of a sheet apart", () => {
    const fields = [
      field("S!B3", "Lx"),
      field("S!B4", "Mx"),
      field("S!F3", "Ly"),
      field("S!F4", "My"),
    ];
    expect(fieldLanes(fields).map((lane) => lane.map((item) => item.label))).toEqual([
      ["Lx", "Mx"],
      ["Ly", "My"],
    ]);
    expect(fieldLanes([field("S!B3", "a"), field("S!C4", "b")])).toHaveLength(1);
    expect(fieldLanes([...fields, field("S!F5", "Vy")]).length).toBe(2);
  });

  it("restores only remembered inputs the model still has, as plain values", () => {
    const saved = readSavedInputs(
      JSON.stringify({ "S!B3": 4, "S!B4": "C32/40", "Old!A1": 2, "S!B5": { e: "#N/A" } }),
    );
    expect(restorableInputs(saved, new Set(["S!B3", "S!B4", "S!B5"]))).toEqual([
      ["S!B3", 4],
      ["S!B4", "C32/40"],
    ]);
    expect(readSavedInputs("not json")).toEqual({});
    expect(readSavedInputs("[1]")).toEqual({});
  });

  it("offers the sheet's inputs the layout left out", () => {
    const layout = {
      sheet: 0,
      sections: [
        {
          title: "",
          blocks: [{ kind: "fields", fields: [field("S!B3", "Span", { input: true })] }],
        },
      ],
    } as unknown as SheetLayout;
    const inputs = [
      { address: "S!B3", sheet: 0 },
      { address: "S!X1", sheet: 0 },
      { address: "T!B3", sheet: 1 },
    ];
    expect(looseInputs(layout, inputs)).toEqual([{ address: "S!X1", sheet: 0 }]);
  });

  it("offers only left-out inputs a formula reads, and no unnamed switch beside the printed sheet", () => {
    const book = model([sheet("S", { printArea: [0, 0, 9, 4] })], []);
    book.sheets[0]!.cells.push([5, 0, { v: 0, f: 0 }]);
    book.formulas.push({ text: "C3+C4+X1", row: 5, col: 0 });
    const layout = { sheet: 0, sections: [], ignored: ["S!C4"] } as unknown as SheetLayout;
    const inputs = [
      { address: "S!C3", sheet: 0, row: 2, col: 2 },
      { address: "S!C4", sheet: 0, row: 3, col: 2 },
      { address: "S!C5", sheet: 0, row: 4, col: 2 },
      { address: "S!X1", sheet: 0, row: 0, col: 23 },
    ];
    expect(looseInputs(layout, inputs, book).map((input) => input.address)).toEqual(["S!C3"]);
  });

  it("leaves helper sheets out of the pages but keeps them in the details", () => {
    const lookup = sheet("Bars", {
      cells: Array.from({ length: 24 }, (_, row): SheetSpec["cells"][number] => [
        row,
        1,
        { v: row },
      ]),
    });
    const book = model([sheet("Design"), sheet("Refs"), lookup], [0, 1]);
    book.inputs.push(
      ...Array.from({ length: 24 }, (_, row) => ({
        sheet: 2,
        row,
        col: 1,
        kind: "number" as const,
        why: "unlocked" as const,
      })),
    );
    expect(helperSheet(book, 1)).toBe(true);
    expect(helperSheet(book, 2)).toBe(true);
    expect(helperSheet(book, 0)).toBe(false);
    expect(pageSheets(book)).toEqual([0]);
    expect(detailSheets(book)).toEqual([0, 1, 2]);
    expect(pageSheets(model([sheet("Refs")], [0]))).toEqual([0]);
  });

  it("filters sections by every word of a search, in any order", () => {
    const sections: LayoutSection[] = [
      {
        title: "Materials",
        blocks: [
          { kind: "fields", fields: [field("S!B3", "Concrete strength"), field("S!B4", "Cover")] },
        ],
        inputs: 0,
        outputs: 2,
      },
      {
        title: "Punching shear",
        blocks: [{ kind: "fields", fields: [field("S!B9", "Shear stress")] }],
        inputs: 0,
        outputs: 1,
      },
    ];
    expect(filterSections(sections, "strength concrete")).toEqual([
      {
        ...sections[0],
        blocks: [{ kind: "fields", fields: [field("S!B3", "Concrete strength")] }],
      },
    ]);
    expect(filterSections(sections, "punching")).toEqual([sections[1]]);
    expect(filterSections(sections, "  ")).toBe(sections);
  });

  it("prints a sheet's verdicts, sections and tables as the screen shows them", () => {
    const layout: SheetLayout = {
      sheet: 0,
      name: "PAD",
      sections: [
        {
          title: "BEARING",
          blocks: [
            { kind: "fields", fields: [field("S!B3", "Pressure", { unit: "kN/m²" })] },
            {
              kind: "table",
              table: {
                columns: ["DEAD", "WIND"],
                rows: [{ label: "Fz", cells: [field("S!C5", "DEAD"), null] }],
              },
            },
          ],
          inputs: 0,
          outputs: 2,
        },
      ],
      charts: [],
      statuses: ["S!B9"],
      checks: ["S!B9"],
      key: [field("S!B9", "STATUS", { status: true })],
      footer: [],
      inputs: 0,
      outputs: 3,
    };
    const text = (address: string) =>
      ({ "S!B3": "152", "S!C5": "40.0", "S!B9": "VALID DESIGN" })[address] ?? "";
    const doc = calcReport(layout, text, { title: "Pad", reference: "pad.xlsx" });
    expect(doc.blocks).toEqual([
      { type: "stats", items: [{ label: "Status", value: "VALID DESIGN", tone: "success" }] },
      { type: "subheading", text: "Bearing" },
      {
        type: "table",
        columns: ["", { label: "Value", align: "right" }, ""],
        rows: [["Pressure", "152 kN/m²", ""]],
      },
      {
        type: "table",
        columns: ["", { label: "Dead", align: "right" }, { label: "Wind", align: "right" }, ""],
        rows: [["Fz", "40.0", "", ""]],
      },
    ]);
    expect(doc).toMatchObject({ title: "Pad", reference: "pad.xlsx", kind: "CALCULATION" });
  });

  it("prints labels a formula makes as that formula reads now", () => {
    const span = { text: "Span 2", address: "S!A4", from: "SPAN 2" };
    const layout: SheetLayout = {
      sheet: 0,
      name: "PAD",
      sections: [
        {
          title: "Span 2",
          live: [{ ...span, address: "S!A2" }],
          blocks: [
            {
              kind: "fields",
              fields: [{ ...field("S!B4", "Span 2 · Moment", { unit: "kNm" }), live: [span] }],
            },
          ],
          inputs: 0,
          outputs: 1,
        },
      ],
      charts: [],
      statuses: [],
      checks: [],
      key: [],
      footer: [],
      inputs: 0,
      outputs: 1,
    };
    const text = (address: string) =>
      ({ "S!A2": "SPAN 3", "S!A4": "SPAN 5", "S!B4": "61.7" })[address] ?? "";
    const doc = calcReport(layout, text, { title: "Pad" });
    expect(doc.blocks).toEqual([
      { type: "subheading", text: "Span 3" },
      {
        type: "table",
        columns: ["", { label: "Value", align: "right" }, ""],
        rows: [["Span 5 · Moment", "61.7 kNm", ""]],
      },
    ]);
  });

  it("shows General numbers as a cell of their width does, rounded in the app", () => {
    expect(generalText(1 / 3, 8.43)).toBe("0.333333");
    expect(generalText(1 / 3)).toBe("0.333333333");
    expect(generalText(-2.5, 8)).toBe("-2.5");
    expect(generalText(123456789, 8)).toBe("1.23E+08");
    expect(generalText(0.0000012345)).toBe("1.2345E-06");
    expect(generalText(42)).toBe("42");
    expect(displayNumber(0.2997480423)).toBe("0.2997");
    expect(displayNumber(123456.7)).toBe("123457");
    expect(displayNumber(12.34567)).toBe("12.35");
    expect(displayNumber(1500)).toBe("1500");
    expect(displayNumber(-0.000123456)).toBe("-0.0001235");
  });

  it("picks round axis values covering a range", () => {
    expect(axisTicks(0, 3.3, 4)).toEqual([0, 1, 2, 3, 4]);
    expect(axisTicks(-19.5, 0, 5)).toEqual([-20, -15, -10, -5, 0]);
    expect(axisTicks(2, 2)).toEqual([0, 0.5, 1, 1.5, 2]);
  });

  it("breaks a series where a cell is blank, as Excel leaves a gap", () => {
    expect(seriesSegments([0, 0, null, 1, 1], [0, 2, null, 0, 2], false)).toEqual([
      [
        [0, 0],
        [0, 2],
      ],
      [
        [1, 0],
        [1, 2],
      ],
    ]);
    expect(seriesSegments([], [5, 6], true)).toEqual([
      [
        [1, 5],
        [2, 6],
      ],
    ]);
  });

  it("sums up a sheet's checks in one line", () => {
    expect(checkSummary(["OK", "OK", "Note"])).toEqual({
      tone: "success",
      text: "All 2 checks pass",
    });
    expect(checkSummary(["OK", "FAIL", "NOT OK"])).toEqual({
      tone: "danger",
      text: "2 of 3 checks fail",
    });
    expect(checkSummary(["VALID DESIGN"])).toEqual({ tone: "success", text: "VALID DESIGN" });
    expect(checkSummary(["OK"], true)).toEqual({ tone: "success", text: "Check passes" });
    expect(checkSummary(["NOT OK"], true)).toEqual({ tone: "danger", text: "NOT OK" });
    expect(checkSummary(["", "n/a"])).toBeNull();
  });
});
