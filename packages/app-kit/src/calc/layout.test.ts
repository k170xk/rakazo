import { describe, expect, it } from "vitest";
import {
  chartOnlyCells,
  cleanLabel,
  columnBands,
  isBoilerplate,
  isInstruction,
  isRatioLabel,
  isReference,
  labelFromFormula,
  liveLabel,
  optionsPrefix,
  readingArea,
  repeatedPageColumn,
  sheetLayout,
  splitFormulaLabel,
  statusTone,
  switchedLabel,
  tidyReference,
  tidyUnit,
  trailingUnit,
} from "./layout.js";
import type { CalcModel, CellSpec, InputSpec } from "./model.js";

type Cell = [number, number, CellSpec];

const text = (row: number, col: number, v: string): Cell => [row, col, { v }];
const value = (row: number, col: number, v: number | string, f: number): Cell => [
  row,
  col,
  { v, f },
];
const input = (row: number, col: number, kind: InputSpec["kind"] = "number"): InputSpec => ({
  sheet: 0,
  row,
  col,
  kind,
  why: "unlocked",
});

function book(cells: Cell[], inputs: InputSpec[], printArea?: [number, number, number, number]) {
  const formulas = cells
    .filter(([, , cell]) => cell.f !== undefined)
    .map(([row, col]) => ({ text: "1", row, col }));
  let next = 0;
  for (const [, , cell] of cells) if (cell.f !== undefined) cell.f = next++;
  const model: CalcModel = {
    version: 1,
    source: { fileName: "pad.xlsx", sha256: "" },
    date1904: false,
    sheets: [
      {
        name: "Design",
        rows: 20,
        cols: 12,
        cells,
        ...(printArea ? { printArea } : {}),
      },
    ],
    formulas,
    formats: [],
    styles: [],
    names: [],
    tables: [],
    externals: {},
    inputs,
    unsupported: [],
  };
  return model;
}

describe("calculator layout heuristics", () => {
  it("tells verdicts from ordinary words", () => {
    expect(statusTone("OK")).toBe("success");
    expect(statusTone("VALID DESIGN")).toBe("success");
    expect(statusTone("FAIL")).toBe("danger");
    expect(statusTone("NG NEER & Partners")).toBeNull();
    expect(statusTone("Yes")).toBeNull();
  });

  it("marks ratios of an effect to a resistance but not formula text", () => {
    expect(isRatioLabel("vEd/vRd,c")).toBe(true);
    expect(isRatioLabel("Utilisation")).toBe(true);
    expect(isRatioLabel("bh/tan")).toBe(false);
    expect(isRatioLabel("VRd,c = (CRd,c k(100ρ1 fck)^0.333) bw d")).toBe(false);
  });

  it("splits formula text and trailing units off labels", () => {
    expect(splitFormulaLabel("VRd,c = (CRd,c k(100ρ1 fck)^0.333 + k1σcp) bw d")).toEqual({
      label: "VRd,c",
      formula: "= (CRd,c k(100ρ1 fck)^0.333 + k1σcp) bw d",
    });
    expect(splitFormulaLabel("Stmax<= 2d ?")).toBeNull();
    expect(trailingUnit("RC Density kN/m3")).toEqual({ label: "RC Density", unit: "kN/m3" });
    expect(trailingUnit("Job No")).toBeNull();
    expect(tidyUnit("mm4 106")).toBe("×10⁶ mm⁴");
    expect(cleanLabel(" Made by ,")).toBe("Made by");
  });

  it("names a cell from the text a formula joins to it", () => {
    expect(labelFromFormula('"Usage: "&X1', "X1")).toBe("Usage");
    expect(labelFromFormula('"Usage: "&$X$1', "X1")).toBe("Usage");
    expect(labelFromFormula('"Usage: "&X12', "X1")).toBeNull();
  });

  it("reads a print area down to the inputs in its columns", () => {
    expect(
      readingArea(
        [42, 1, 99, 10],
        [
          { row: 3, col: 2 },
          { row: 5, col: 14 },
        ],
      ),
    ).toEqual([3, 1, 99, 10]);
  });

  it("finds the next page of a sheet printed as pages side by side", () => {
    const title = (col: number) => [
      { col, text: "Project" },
      { col: col + 4, text: "Made by" },
    ];
    expect(
      repeatedPageColumn(
        [
          [...title(1), ...title(12)],
          [...title(1), ...title(12)],
        ],
        0,
      ),
    ).toBe(12);
    expect(repeatedPageColumn([title(1)], 0)).toBeNull();
  });

  it("lays out a sheet: title block, labelled inputs, ratio, verdict and settings outside", () => {
    const model = book(
      [
        text(0, 0, "Project"),
        [0, 1, { v: "Pad F1" }],
        text(1, 0, "Made by"),
        [1, 1, { v: "RMW" }],
        text(3, 0, "LOADS"),
        text(4, 0, "Axial load"),
        [4, 1, { v: 500 }],
        text(4, 2, "kN"),
        text(5, 0, "Bearing capacity"),
        value(5, 1, 600, 0),
        text(5, 2, "kN"),
        text(6, 0, "qEd/qRd"),
        value(6, 1, 0.83, 0),
        text(7, 0, "Bearing status"),
        value(7, 1, "OK", 0),
        text(4, 8, "Factor"),
        [4, 9, { v: 1.5 }],
        text(2, 11, "UK"),
        [3, 11, { v: 1.15 }],
        [4, 11, { v: 1.5 }],
      ],
      [
        input(0, 1, "text"),
        input(1, 1, "text"),
        input(4, 1),
        input(4, 9),
        input(3, 11),
        input(4, 11),
      ],
      [0, 0, 8, 3],
    );
    const layout = sheetLayout(model, 0);
    const fields = layout.sections.flatMap((section) =>
      section.blocks.flatMap((block) => (block.kind === "fields" ? block.fields : [])),
    );
    const byAddress = new Map(fields.map((field) => [field.address, field]));
    expect(byAddress.get("Design!B1")?.label).toBe("Project");
    expect(byAddress.get("Design!B5")).toMatchObject({
      label: "Axial load",
      unit: "kN",
      input: true,
    });
    expect(byAddress.get("Design!B7")?.ratio).toBe(true);
    expect(layout.statuses).toEqual(["Design!B8"]);
    expect(layout.checks).toContain("Design!B8");
    expect(layout.key.map((field) => field.address)).toContain("Design!B7");
    expect(layout.key.map((field) => field.address)).not.toContain("Design!B8");
    const aside = layout.sections.find((section) => section.title === "More settings");
    const asideFields = aside?.blocks.flatMap((block) =>
      block.kind === "fields" ? block.fields : [],
    );
    expect(asideFields?.map((field) => field.label)).toEqual(["Factor", "UK", "Axial load · UK"]);
  });

  it("tells credits and option words from labels", () => {
    expect(isBoilerplate("Originated from TCC13.xlsm")).toBe(true);
    expect(isBoilerplate(" v4.40   © 2003-22 TCC")).toBe(true);
    expect(isBoilerplate("v on CD © 2003-00 TCC")).toBe(true);
    expect(isBoilerplate("Bearing capacity")).toBe(false);
    expect(optionsPrefix(["β Using Factors =", "β Calculating ="])).toBe("β");
    expect(optionsPrefix(["Yes", "No"])).toBeNull();
    expect(optionsPrefix(["USE CODE Veff/Vt FACTORS", "INPUT ACTUAL Veff"])).toBe("Veff");
    expect(isInstruction(" RED MESSAGES INDICATE ENTRY ERRORS.")).toBe(true);
    expect(isInstruction("Enter data in blue cells")).toBe(true);
    expect(isInstruction("Overburden depth")).toBe(false);
    expect(isInstruction("2 = No span moment redistribution.")).toBe(false);
    expect(statusTone("√")).toBe("success");
    expect(statusTone("√(L1/L2)")).toBeNull();
  });

  it("names a cell from the caption its label formula shows in the other mode", () => {
    expect(switchedLabel('IF(Y2="to D","Dlow","")')).toBe("Dlow");
    expect(switchedLabel('IF($Y$2="to EC2","","Internal Corner Xd")')).toBe("Internal Corner Xd");
    expect(switchedLabel('IF(A1>0,"","")')).toBeNull();
  });

  it("keeps a direction arrow with its label and the unit apart", () => {
    expect(trailingUnit("Axial ↔kN/m")).toEqual({ label: "Axial ↔", unit: "kN/m" });
  });

  it("splits a reference sheet at an empty column only between two tables", () => {
    const cells = (from: number, to: number, rows: number) =>
      Array.from({ length: rows * (to - from + 1) }, (_, i) => ({
        col: from + (i % (to - from + 1)),
        kind: i % 3 ? "value" : "text",
      }));
    expect(columnBands([...cells(1, 4, 6), ...cells(6, 7, 8)], 1, 7)).toEqual([
      [1, 4],
      [6, 7],
    ]);
    expect(columnBands([...cells(1, 4, 6), { col: 6, kind: "value" }], 1, 6)).toEqual([[1, 6]]);
  });

  it("finds the helper cells whose results only reach a chart", () => {
    const model = book(
      [[0, 0, { v: 2 }], value(0, 1, 4, 0), value(0, 2, 8, 0), value(1, 1, 5, 0)],
      [input(0, 0)],
    );
    model.formulas = [
      { text: "A1*2", row: 0, col: 1 },
      { text: "B1*2", row: 0, col: 2 },
      { text: "A1+3", row: 1, col: 1 },
    ];
    model.charts = [
      { sheet: 0, kind: "scatter", anchor: [3, 0, 10, 5], series: [{ y: "Design!$C$1" }] },
    ];
    const only = chartOnlyCells(model);
    expect(only.has("0:0:1")).toBe(true);
    expect(only.has("0:0:2")).toBe(true);
    expect(only.has("0:1:1")).toBe(false);
  });

  it("reads a title block as the project's details, with credits in the footer", () => {
    const model = book(
      [
        text(0, 0, "Project"),
        [0, 1, { v: "Spreadsheets" }],
        [0, 5, { v: "The Concrete Centre" }],
        text(1, 0, "Client"),
        [1, 1, { v: "Advisory Group" }],
        text(1, 4, "Made by"),
        text(1, 6, "Date"),
        [2, 4, { v: "ra" }],
        [2, 6, { v: "1 Aug 22" }],
        text(3, 0, "Originated from TCC81.xlsm"),
        text(5, 0, "LOADS"),
        text(6, 0, "Axial load"),
        [6, 1, { v: 500 }],
        text(6, 2, "kN"),
      ],
      [
        input(0, 1, "text"),
        input(0, 5, "text"),
        input(1, 1, "text"),
        input(2, 4, "text"),
        input(6, 1),
      ],
      [0, 0, 8, 7],
    );
    const layout = sheetLayout(model, 0);
    const project = layout.sections[0]!;
    expect(project).toMatchObject({ title: "Project details", role: "project" });
    const labels = project.blocks.flatMap((block) =>
      block.kind === "fields" ? block.fields.map((field) => [field.label, field.address]) : [],
    );
    expect(labels).toEqual([
      ["Project", "Design!B1"],
      ["Client", "Design!B2"],
      ["Made by", "Design!E3"],
      ["Date", "Design!G3"],
      ["Company", "Design!F1"],
    ]);
    expect(layout.footer).toEqual([{ kind: "note", text: "Originated from TCC81.xlsm" }]);
    expect(layout.sections.some((section) => section.title === "LOADS")).toBe(true);
  });

  it("heads a table's repeated columns with the group each belongs to", () => {
    const model = book(
      [
        text(0, 0, "REACTIONS"),
        text(1, 1, "Column 1"),
        text(1, 4, "Column 2"),
        text(2, 1, "DEAD"),
        text(2, 2, "IMPOSED"),
        text(2, 4, "DEAD"),
        text(2, 5, "IMPOSED"),
        text(3, 0, "Axial"),
        [3, 1, { v: 100 }],
        [3, 2, { v: 50 }],
        [3, 4, { v: 120 }],
        [3, 5, { v: 60 }],
        text(4, 0, "Moment"),
        [4, 1, { v: 10 }],
        [4, 2, { v: 5 }],
        [4, 4, { v: 12 }],
        [4, 5, { v: 6 }],
      ],
      [
        input(3, 1),
        input(3, 2),
        input(3, 4),
        input(3, 5),
        input(4, 1),
        input(4, 2),
        input(4, 4),
        input(4, 5),
      ],
      [0, 0, 6, 6],
    );
    const layout = sheetLayout(model, 0);
    const table = layout.sections
      .flatMap((section) => section.blocks)
      .find((block) => block.kind === "table");
    expect(table?.kind === "table" && table.table.columns).toEqual([
      "DEAD",
      "IMPOSED",
      "DEAD",
      "IMPOSED",
    ]);
    expect(table?.kind === "table" && table.table.groups).toEqual([
      { label: "Column 1", span: 2 },
      { label: "Column 2", span: 2 },
    ]);
    expect(table?.kind === "table" && table.table.rows.map((row) => row.label)).toEqual([
      "Axial",
      "Moment",
    ]);
  });

  it("names columns from a numbered row and keeps side-by-side copies of a table together", () => {
    const model = book(
      [
        text(0, 0, "MOMENTS"),
        text(1, 0, "SUPPORT No"),
        [1, 1, { v: 1 }],
        [1, 2, { v: 2 }],
        [1, 3, { v: 3 }],
        text(2, 0, "Elastic M"),
        value(2, 1, 10, 0),
        value(2, 2, 20, 0),
        value(2, 3, 30, 0),
        text(3, 0, "Redistributed M"),
        value(3, 1, 9, 0),
        value(3, 2, 18, 0),
        value(3, 3, 27, 0),
        text(11, 0, "REACTIONS"),
        text(12, 0, "Column 1"),
        text(12, 1, "DEAD"),
        text(12, 2, "IMPOSED"),
        text(12, 4, "Column 2"),
        text(12, 5, "DEAD"),
        text(12, 6, "IMPOSED"),
        text(13, 0, "Axial"),
        [13, 1, { v: 100 }],
        [13, 2, { v: 50 }],
        text(13, 4, "Axial"),
        [13, 5, { v: 120 }],
        [13, 6, { v: 60 }],
        text(14, 0, "Moment"),
        [14, 1, { v: 10 }],
        [14, 2, { v: 5 }],
        text(14, 4, "Moment"),
        [14, 5, { v: 12 }],
        [14, 6, { v: 6 }],
      ],
      [
        input(13, 1),
        input(13, 2),
        input(13, 5),
        input(13, 6),
        input(14, 1),
        input(14, 2),
        input(14, 5),
        input(14, 6),
      ],
      [0, 0, 15, 7],
    );
    const tables = sheetLayout(model, 0)
      .sections.flatMap((section) => section.blocks)
      .flatMap((block) => (block.kind === "table" ? [block.table] : []));
    expect(tables[0]?.columns).toEqual(["Support 1", "Support 2", "Support 3"]);
    expect(tables[0]?.rows.map((row) => row.label)).toEqual(["Elastic M", "Redistributed M"]);
    expect(tables[1]?.columns).toEqual(["DEAD", "IMPOSED", "DEAD", "IMPOSED"]);
    expect(tables[1]?.groups).toEqual([
      { label: "Column 1", span: 2 },
      { label: "Column 2", span: 2 },
    ]);
  });

  it("groups a grid of labelled inputs under the caption over each pair of columns", () => {
    const model = book(
      [
        text(0, 0, "DIMENSIONS"),
        text(1, 0, "BASE"),
        text(1, 2, "COLUMN 1"),
        text(1, 4, "COLUMN 2"),
        text(2, 0, "L ="),
        [2, 1, { v: 5000 }],
        text(2, 2, "h1 ="),
        [2, 3, { v: 250 }],
        text(2, 4, "h2 ="),
        [2, 5, { v: 250 }],
        text(3, 0, "B ="),
        [3, 1, { v: 1000 }],
        text(3, 2, "b1 ="),
        [3, 3, { v: 670 }],
        text(3, 4, "b2 ="),
        [3, 5, { v: 670 }],
      ],
      [input(2, 1), input(2, 3), input(2, 5), input(3, 1), input(3, 3), input(3, 5)],
      [0, 0, 4, 6],
    );
    const blocks = sheetLayout(model, 0).sections.flatMap((section) => section.blocks);
    expect(
      blocks.map((block) =>
        block.kind === "note"
          ? `# ${block.text}`
          : block.kind === "fields"
            ? block.fields.map((field) => field.label).join(",")
            : block.kind,
      ),
    ).toEqual(["L,B", "# Column 1", "h1,b1", "# Column 2", "h2,b2"]);
  });

  it("reads a unit between a label and its input as the unit, and N/A as a value", () => {
    const model = book(
      [
        text(0, 0, "MATERIALS"),
        text(1, 0, "fcu"),
        text(1, 1, "N/mm2"),
        [1, 2, { v: 40 }],
        text(2, 0, "fyv"),
        text(2, 1, "N/mm2"),
        [2, 2, { v: 500 }],
        text(3, 0, "C mm"),
        text(3, 1, "N/A"),
      ],
      [input(1, 2), input(2, 2)],
      [0, 0, 4, 3],
    );
    const fields = sheetLayout(model, 0).sections.flatMap((section) =>
      section.blocks.flatMap((block) => (block.kind === "fields" ? block.fields : [])),
    );
    expect(fields.map((field) => [field.label, field.unit, field.input])).toEqual([
      ["fcu", "N/mm2", true],
      ["fyv", "N/mm2", true],
      ["C", "mm", false],
    ]);
  });

  it("tells clause and equation references from ordinary notes", () => {
    for (const ref of [
      "Equn (9.1N)",
      "cl 6.2.2",
      "(Table 2.2)",
      "Exp. (6.47)",
      "(9.2.2)",
      "see EN 1990 - Table A1.1",
    ])
      expect(isReference(ref)).toBe(true);
    for (const note of ["applied pressures", "Table", "Span 2", "OK", "6.2"])
      expect(isReference(note)).toBe(false);
    expect(tidyReference("(equn 6.2)")).toBe("Equn 6.2");
    expect(tidyReference("see EN 1990 - Table A1.1")).toBe("EN 1990 Table A1.1");
  });

  it("shows a clause reference beside a figure as its reference, not its hint", () => {
    const model = book(
      [
        text(0, 0, "SHEAR"),
        text(1, 0, "VRd,c"),
        value(1, 1, 120, 0),
        text(1, 2, "kN"),
        text(1, 3, "Equn (6.2a)"),
      ],
      [],
      [0, 0, 3, 4],
    );
    const fields = sheetLayout(model, 0).sections.flatMap((section) =>
      section.blocks.flatMap((block) => (block.kind === "fields" ? block.fields : [])),
    );
    expect(fields[0]).toMatchObject({ label: "VRd,c", unit: "kN", reference: "Equn (6.2a)" });
    expect(fields[0]?.hint).toBeUndefined();
  });

  it("unrolls load cases laid side by side into one row per case", () => {
    const model = book(
      [
        text(0, 0, "COLUMN LOADS"),
        ...["Case", "NEd", "MEd", "Case", "NEd", "MEd"].map((name, col) => text(1, col, name)),
        value(2, 0, 1, 0),
        [2, 1, { v: 900 }],
        [2, 2, { v: 40 }],
        value(2, 3, 3, 0),
        [2, 4, { v: 700 }],
        [2, 5, { v: 60 }],
        value(3, 0, 2, 0),
        [3, 1, { v: 800 }],
        [3, 2, { v: 50 }],
        value(3, 3, 4, 0),
        [3, 4, { v: 600 }],
        [3, 5, { v: 70 }],
      ],
      [1, 2, 4, 5].flatMap((col) => [input(2, col), input(3, col)]),
      [0, 0, 4, 6],
    );
    const tables = sheetLayout(model, 0).sections.flatMap((section) =>
      section.blocks.flatMap((block) => (block.kind === "table" ? [block.table] : [])),
    );
    expect(tables).toHaveLength(1);
    expect(tables[0]!.columns).toEqual(["NEd", "MEd"]);
    expect(tables[0]!.rows.map((row) => [row.label, row.cells[0]?.address])).toEqual([
      ["Case 1", "Design!B3"],
      ["Case 2", "Design!B4"],
      ["Case 3", "Design!E3"],
      ["Case 4", "Design!E4"],
    ]);
  });

  it("names repeated column headings by the heading line above them", () => {
    const cells: Cell[] = [text(0, 0, "LOADING")];
    const inputs: InputSpec[] = [];
    for (const base of [0, 3]) {
      cells.push(text(1, base + 1, "Dead"), text(1, base + 2, "Imposed"));
      cells.push(
        text(2, base, `Span ${base ? 2 : 1}`),
        text(2, base + 1, "Load"),
        text(2, base + 2, "Load"),
      );
      for (const [row, name] of [
        [3, "UDL"],
        [4, "PL"],
      ] as const) {
        cells.push(
          text(row, base, name),
          [row, base + 1, { v: row + base + 0.5 }],
          [row, base + 2, { v: row + base + 0.25 }],
        );
        inputs.push(input(row, base + 1), input(row, base + 2));
      }
    }
    cells.push(text(6, 0, "Total"), value(6, 1, 20, 0));
    const tables = sheetLayout(book(cells, inputs, [0, 0, 7, 6]), 0).sections.flatMap((section) =>
      section.blocks.flatMap((block) => (block.kind === "table" ? [block.table] : [])),
    );
    expect(tables[0]?.columns).toEqual(["Dead Load", "Imposed Load", "Dead Load", "Imposed Load"]);
    expect(tables[0]?.groups?.map((group) => group.label)).toEqual(["Span 1", "Span 2"]);
  });

  it("drops an empty unnamed input standing alone on a row and records it as ignored", () => {
    const model = book(
      [
        text(0, 0, "DATA"),
        text(1, 0, "Span"),
        [1, 1, { v: 6 }],
        text(1, 2, "m"),
        [3, 3, {}],
        value(5, 0, 6, 0),
      ],
      [input(1, 1), input(3, 3)],
      [0, 0, 6, 4],
    );
    model.formulas[0]!.text = "B2+D4";
    const layout = sheetLayout(model, 0);
    const fields = layout.sections.flatMap((section) =>
      section.blocks.flatMap((block) => (block.kind === "fields" ? block.fields : [])),
    );
    expect(fields.map((field) => field.address)).not.toContain("Design!D4");
    expect(layout.ignored).toEqual(["Design!D4"]);
  });

  it("shows a calculated part of a label as its cell reads now", () => {
    const span = { text: "Span 2", address: "Design!A3", from: "SPAN 2" };
    const layer = { text: "Layer 2", address: "Design!C4", from: "Layer 2" };
    const cells: Record<string, string> = { "Design!A3": "SPAN 2", "Design!C4": "" };
    const read = (address: string) => cells[address] ?? "";
    expect(liveLabel("Span 2 · H", [span], read)).toBe("Span 2 · H");
    cells["Design!A3"] = "SPAN 4";
    expect(liveLabel("Span 2 · H", [span], read)).toBe("Span 4 · H");
    expect(liveLabel("Top steel · Layer 2 · Left Ø", [layer], read)).toBe("Top steel · Left Ø");
    cells["Design!C4"] = "Layer 2";
    expect(liveLabel("Top steel · Layer 2 · Left Ø", [layer], read)).toBe(
      "Top steel · Layer 2 · Left Ø",
    );
    const both = { text: "σcz & σcy", address: "Design!B2", from: "σcz & σcy" };
    cells["Design!B2"] = "σcx";
    expect(liveLabel("σcz & σcy · ZTop", [both], read)).toBe("σcx · ZTop");
  });

  it("names table rows a formula labels from that formula's cell", () => {
    const model = book(
      [
        text(0, 0, "LOADS"),
        text(1, 1, "Dead"),
        text(1, 2, "Imposed"),
        value(2, 0, "SPAN 1", 0),
        [2, 1, { v: 5 }],
        [2, 2, { v: 7 }],
        value(3, 0, "SPAN 2", 1),
        [3, 1, { v: 9 }],
        [3, 2, { v: 11 }],
      ],
      [input(2, 1), input(2, 2), input(3, 1), input(3, 2)],
    );
    const layout = sheetLayout(model, 0);
    const rows = layout.sections.flatMap((section) =>
      section.blocks.flatMap((block) => (block.kind === "table" ? block.table.rows : [])),
    );
    expect(rows.map((row) => row.label)).toEqual(["SPAN 1", "SPAN 2"]);
    expect(rows[1]?.live).toEqual([{ text: "SPAN 2", address: "Design!A4", from: "SPAN 2" }]);
    expect(rows[1]?.cells[1]?.live).toEqual(rows[1]?.live);
  });

  it("names a bar's Ø by its layer and column, and a layer shown only when used", () => {
    const model = book(
      [
        text(0, 3, "LEFT"),
        text(0, 6, "RIGHT"),
        text(1, 0, "TOP STEEL"),
        text(1, 1, "Layer 1"),
        value(1, 2, 3, 0),
        value(1, 3, "B", 1),
        [1, 4, { v: 12 }],
        value(1, 5, 2, 2),
        value(1, 6, "B", 3),
        [1, 7, { v: 16 }],
        value(2, 1, "", 4),
        value(2, 2, 0, 5),
        value(2, 3, "", 6),
        [2, 4, {}],
        value(2, 5, 0, 7),
        value(2, 6, "", 8),
        [2, 7, {}],
      ],
      [input(1, 4), input(1, 7), input(2, 4), input(2, 7)],
    );
    model.formulas[4]!.text = 'IF(E3="","","Layer 2")';
    model.formulas[0]!.text = "E2+E3+H2+H3";
    const layout = sheetLayout(model, 0);
    const fields = layout.sections.flatMap((section) =>
      section.blocks.flatMap((block) => (block.kind === "fields" ? block.fields : [])),
    );
    const named = (address: string) => fields.find((field) => field.address === address);
    expect(named("Design!E2")?.label).toBe("Top steel · Layer 1 · Left Ø");
    expect(named("Design!H2")?.label).toBe("Top steel · Layer 1 · Right Ø");
    expect(named("Design!C2")?.label).toBe("Top steel · Layer 1 · Left No.");
    const second = named("Design!E3");
    expect(second?.label).toBe("Top steel · Layer 2 · Left Ø");
    expect(liveLabel(second!.label, second!.live, () => "")).toBe("Top steel · Left Ø");
  });
});
