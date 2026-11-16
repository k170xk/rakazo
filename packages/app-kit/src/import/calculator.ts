import { gzipSync } from "node:zlib";
import { compileWorkbook } from "../calc/compile.js";
import type { CalcModel } from "../calc/model.js";
import { pageSheets, SAVED_INPUTS_SCHEMA, tidyText } from "../calc/present.js";
import type { Verification } from "../calc/verify.js";
import { describeVerification, verifyModel } from "../calc/verify.js";
import type { TableSchema } from "../schema.js";
import { readCharts, readPrintAreas } from "./extras.js";
import type { WorkbookImport } from "./workbook.js";
import { checkWorkbookSize } from "./workbook.js";

/**
 * A workbook that calculates becomes an app that calculates the same way: the workbook is compiled
 * to a model of its cells and formulas, every formula is checked against the result Excel saved,
 * and the app recalculates that model in the browser as people change the inputs.
 */

export type CalculatorImport = {
  model: CalcModel;
  /** The model as the app keeps it. */
  gzip: Uint8Array;
  verification: Verification;
  report: string[];
};

export const MAX_CALCULATOR_SHEETS = 40;

/**
 * Compiles and checks a workbook. Given what the table importer found, it returns null when the
 * workbook is tables of records rather than a calculator; without it the workbook is taken as one.
 */
export async function importCalculator(
  bytes: Uint8Array,
  fileName: string,
  data?: WorkbookImport | null,
): Promise<CalculatorImport | null> {
  checkWorkbookSize(bytes);
  let compiled: Awaited<ReturnType<typeof compileWorkbook>>;
  try {
    compiled = await compileWorkbook(bytes, fileName);
  } catch {
    throw new Error("That file could not be read as a spreadsheet (xlsx, xlsm or xls).");
  }
  const { model, warnings } = compiled;
  if (data !== undefined && !isCalculator(model, data)) return null;
  addExtras(model, bytes);
  const verification = verifyModel(model);
  const report = [
    ...describeVerification(verification),
    `${model.inputs.length.toLocaleString("en-GB")} inputs, ${model.formulas.length.toLocaleString("en-GB")} distinct formulas.`,
    ...model.unsupported.map((note) => `Note: ${note}`),
    ...warnings,
  ];
  if (!model.source.excelCalculated)
    report.push(
      "The workbook was last saved by another program, so its saved results may not be Excel's.",
    );
  return { model, gzip: new Uint8Array(gzipSync(JSON.stringify(model))), verification, report };
}

export { SAVED_INPUTS_SCHEMA };

const NOT_REDRAWN = /^"(.+)" has (\d+) charts?, which are not redrawn\.$/;

/**
 * Adds the workbook's charts and print areas to its model, and drops the report's note about a
 * sheet's charts once the app redraws every one of them.
 */
export function addExtras(model: CalcModel, bytes: Uint8Array) {
  const charts = readCharts(bytes).filter((chart) => model.sheets[chart.sheet]);
  if (charts.length) model.charts = charts;
  else delete model.charts;
  for (const [sheet, area] of readPrintAreas(bytes)) {
    const spec = model.sheets[sheet];
    if (spec && !spec.external) spec.printArea = area;
  }
  model.unsupported = model.unsupported.filter((note) => {
    const match = NOT_REDRAWN.exec(note);
    if (!match) return true;
    const sheet = model.sheets.findIndex((spec) => spec.name === match[1]);
    const drawn = charts.filter((chart) => chart.sheet === sheet).length;
    return drawn < Number(match[2]);
  });
}

const formulaCells = (model: CalcModel) =>
  model.sheets.reduce(
    (n, sheet) => n + sheet.cells.filter(([, , cell]) => cell.f !== undefined).length,
    0,
  );

/**
 * Whether a workbook is a calculator rather than tables of records: it declares its inputs by
 * protecting the sheets around them, it has no table to import, or its formulas are a sizeable
 * share of what the tables would hold (a list of records carries few).
 */
export function isCalculator(model: CalcModel, data: WorkbookImport | null): boolean {
  const formulas = formulaCells(model);
  if (!formulas || !model.inputs.length) return false;
  if (!data?.tables.length) return true;
  if (model.inputs.some((input) => input.why === "unlocked")) return true;
  const cells = data.tables.reduce(
    (n, table) => n + table.rows.length * table.schema.columns.length,
    0,
  );
  return formulas >= 20 && formulas >= cells * 0.05;
}

/** The sheets an app shows, in workbook order: the visible ones with something on them. */
export function shownSheets(model: CalcModel): string[] {
  return model.sheets
    .filter((sheet) => !sheet.hidden && !sheet.external && sheet.cells.length)
    .map((sheet) => sheet.name)
    .slice(0, MAX_CALCULATOR_SHEETS);
}

const str = (text: string) => JSON.stringify(text);

const MAX_CALCULATOR_PAGES = 8;

/**
 * App.tsx for a calculator: a page per sheet with inputs, presented as the app reads it (sections,
 * typed fields, results and verdicts), and a page with every sheet, as the app reads it or as the
 * workbook lays it out.
 */
export function scaffoldCalculator(
  title: string,
  model: CalcModel,
  modelAssetId: string,
  source?: string,
): Record<string, string> {
  const pages = pageSheets(model, MAX_CALCULATOR_PAGES).map((index) => {
    const name = model.sheets[index]!.name;
    const inputs = model.inputs.filter((input) => input.sheet === index).length;
    return `        {
          id: ${str(`sheet-${index + 1}`)},
          label: ${str(tidyText(name))},
          icon: <Calculator />,${inputs ? `\n          count: ${inputs},` : ""}
          render: () => <CalcForm calc={calc} sheet=${str(name)} />,
        },`;
  });
  pages.push(`        {
          id: "details",
          label: "Full calculation",
          icon: <FileSpreadsheet />,
          render: () => <CalcDetails calc={calc} />,
        },`);
  const app = `import { AppShell, Button, Theme } from "@ocsc/ui";
import { CalcDetails, CalcForm, useCalc } from "@ocsc/calc";
import { Calculator, FileSpreadsheet, RotateCcw } from "lucide-react";

/** The workbook's calculation, kept with the app; it recalculates with Excel's own formulas. */
const MODEL = ${str(modelAssetId)};

export default function App() {
  const calc = useCalc(MODEL);
  return (
    <>
      <Theme preset="crisp" density="comfortable" />
      <AppShell
        title=${str(title)}
        subtitle=${str(source ? `From ${source}` : "Calculator")}
        wide
        commands
        actions={
          calc.changed ? (
            <Button size="sm" variant="outline" onClick={calc.reset}>
              <RotateCcw />
              Reset to workbook
            </Button>
          ) : null
        }
        pages={[
${pages.join("\n")}
        ]}
      />
    </>
  );
}
`;
  return { "App.tsx": app };
}

/** The app file holding a workbook's calculation. */
export const calculationName = (fileName: string) => `${fileName.slice(0, 180)} calculation`;

/** What a new calculator app is made of: its source and the table that remembers each person's inputs. */
export function calculatorApp(
  title: string,
  model: CalcModel,
  modelAssetId: string,
  source?: string,
): { files: Record<string, string>; tables: Array<{ schema: TableSchema; rows: [] }> } {
  return {
    files: scaffoldCalculator(title, model, modelAssetId, source),
    tables: [{ schema: SAVED_INPUTS_SCHEMA, rows: [] }],
  };
}
