import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { auditAppCraft, buildApp } from "../build/index.js";
import { checkSchema } from "../schema.js";
import {
  addExtras,
  calculatorApp,
  importCalculator,
  isCalculator,
  SAVED_INPUTS_SCHEMA,
  scaffoldCalculator,
} from "./calculator.js";
import { parseArea } from "./extras.js";
import { importWorkbook } from "./workbook.js";

function xlsx(rows: unknown[][], name = "Beam"): Uint8Array {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

const beam = () =>
  xlsx([
    ["Span", 6, "m"],
    ["Load", 2, "kN/m"],
    ["Moment", { t: "n", f: "B2*B1^2/8", v: 9 }, "kNm"],
  ]);

describe("calculator import", () => {
  it("compiles a workbook, checks it against its saved results and keeps the model", async () => {
    const calc = (await importCalculator(beam(), "beam.xlsx"))!;
    expect(calc.verification.passed).toBe(true);
    expect(calc.report[0]).toBe("All 1 formula results match the values Excel saved.");
    expect(calc.model.inputs.map((input) => [input.label, input.unit])).toEqual([
      ["Span", "m"],
      ["Load", "kN/m"],
    ]);
    expect(JSON.parse(gunzipSync(calc.gzip).toString("utf8"))).toEqual(calc.model);
  });

  it("keeps each sheet's print area and reports charts only while they are not drawn", async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ["Span", 6, "m"],
        ["Load", 2, "kN/m"],
        ["Moment", { t: "n", f: "B2*B1^2/8", v: 9 }, "kNm"],
      ]),
      "Beam",
    );
    book.Workbook = { Names: [{ Name: "_xlnm.Print_Area", Sheet: 0, Ref: "Beam!$A$2:$C$3" }] };
    const bytes = new Uint8Array(
      XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer,
    );
    const calc = (await importCalculator(bytes, "beam.xlsx"))!;
    expect(calc.model.sheets[0]!.printArea).toEqual([1, 0, 2, 2]);
    expect(calc.model.charts).toBeUndefined();
    const model = structuredClone(calc.model);
    model.unsupported.push('"Beam" has 1 chart, which are not redrawn.');
    addExtras(model, bytes);
    expect(model.unsupported).toContain('"Beam" has 1 chart, which are not redrawn.');
  });

  it("reads a print area of several ranges as the span they cover together", () => {
    expect(parseArea("Beam!$A$1:$J$60,Beam!$L$1:$T$58")).toEqual([0, 0, 59, 19]);
    expect(parseArea("'My sheet'!$B$2:$D$4")).toEqual([1, 1, 3, 3]);
    expect(parseArea("#REF!")).toBeNull();
  });

  it("tells calculators from tables of records", async () => {
    expect(isCalculator((await importCalculator(beam(), "beam.xlsx"))!.model, null)).toBe(true);
    const jobs = xlsx(
      [
        ["Job", "Name", "Fee"],
        ...Array.from({ length: 40 }, (_, n) => [`J${n}`, `Project ${n}`, 1000 + n]),
        ["Total", "", { t: "n", f: "SUM(C2:C41)", v: 40780 }],
      ],
      "Jobs",
    );
    expect(await importCalculator(jobs, "jobs.xlsx", importWorkbook(jobs))).toBeNull();
  });

  it("scaffolds an app that builds with the calculation kit", async () => {
    const calc = (await importCalculator(beam(), "beam.xlsx"))!;
    const files = scaffoldCalculator("Beam", calc.model, "model-id", "beam.xlsx");
    expect(files["App.tsx"]).toContain('const MODEL = "model-id";');
    expect(files["App.tsx"]).toContain('<CalcForm calc={calc} sheet="Beam" />');
    expect(files["App.tsx"]).toContain("<CalcDetails calc={calc} />");
    const built = await buildApp(files, { title: "Beam" });
    expect(built.ok).toBe(true);
    expect(auditAppCraft(files, { isNew: true, totalRows: 0 })).toEqual([]);
  }, 30_000);

  it("keeps each person's inputs in a personal table made with the app", async () => {
    const calc = (await importCalculator(beam(), "beam.xlsx"))!;
    const app = calculatorApp("Beam", calc.model, "model-id");
    expect(app.tables).toEqual([{ schema: SAVED_INPUTS_SCHEMA, rows: [] }]);
    expect(SAVED_INPUTS_SCHEMA.personal).toBe(true);
    expect(checkSchema(SAVED_INPUTS_SCHEMA).ok).toBe(true);
  });
});
