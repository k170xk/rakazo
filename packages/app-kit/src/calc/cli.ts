import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { compileWorkbook } from "./compile.js";
import { Engine, toJson } from "./engine.js";
import type { CalcModel, CellValueJson } from "./model.js";
import { address } from "./model.js";
import { makeScenarios } from "./scenarios.js";
import { describeVerification, verifyModel } from "./verify.js";

/**
 * Command line for the Excel fidelity harness.
 *
 *   tsx cli.ts compile <workbook> <model.json>     compile a workbook
 *   tsx cli.ts verify <workbook|model.json> [--json] recalculate and compare with Excel's saved results
 *   tsx cli.ts run <model.json> <scenarios.json>     calculate scenarios: [{ id, inputs: { "Sheet!A1": v } }]
 *                                                   and print { id: { "Sheet!A1": value } } for every formula cell
 *   tsx cli.ts scenarios <workbook|model.json> <count> [seed]  print seeded input scenarios as JSON
 */

async function load(path: string): Promise<CalcModel> {
  if (path.endsWith(".json")) return JSON.parse(readFileSync(path, "utf8")) as CalcModel;
  const { model, warnings } = await compileWorkbook(
    new Uint8Array(readFileSync(path)),
    basename(path),
  );
  for (const warning of warnings) process.stderr.write(`${warning}\n`);
  return model;
}

type Scenario = { id: string; inputs: Record<string, CellValueJson>; now?: number; seed?: number };

function runScenarios(model: CalcModel, scenarios: Scenario[]) {
  const out: Record<string, Record<string, CellValueJson>> = {};
  for (const scenario of scenarios) {
    const engine = new Engine(model);
    for (const [at, value] of Object.entries(scenario.inputs)) {
      const v = value !== null && typeof value === "object" ? null : value;
      engine.setByAddress(at, v);
    }
    engine.calculate({ now: scenario.now, seed: scenario.seed ?? 1 });
    const results: Record<string, CellValueJson> = {};
    model.sheets.forEach((sheet, s) => {
      if (sheet.external) return;
      for (const [row, col, cell] of sheet.cells) {
        if (cell.f === undefined) continue;
        const last = cell.a && !cell.d ? cell.a : [row, col];
        for (let r = row; r <= last[0]!; r++)
          for (let c = col; c <= last[1]!; c++)
            results[`${sheet.name}!${address(r, c)}`] = toJson(engine.cellValue(s, r, c));
      }
    });
    out[scenario.id] = results;
  }
  return out;
}

async function main() {
  const [command, a, b, ...rest] = process.argv.slice(2);
  if (command === "compile" && a && b) {
    const model = await load(a);
    writeFileSync(b, JSON.stringify(model));
    process.stdout.write(`${model.formulas.length} formulas, ${model.inputs.length} inputs\n`);
    return;
  }
  if (command === "verify" && a) {
    const model = await load(a);
    const result = verifyModel(model, { maxMismatches: 100000 });
    if (b === "--json" || rest.includes("--json"))
      process.stdout.write(
        `${JSON.stringify({ ...result, unsupported: model.unsupported, inputs: model.inputs, application: model.source.application ?? "", excel: !!model.source.excelCalculated })}\n`,
      );
    else {
      for (const line of describeVerification(result)) process.stdout.write(`${line}\n`);
      for (const line of model.unsupported) process.stdout.write(`Note: ${line}\n`);
    }
    process.exitCode = result.passed ? 0 : 1;
    return;
  }
  if (command === "run" && a && b) {
    const model = await load(a);
    const scenarios = JSON.parse(readFileSync(b, "utf8")) as Scenario[];
    process.stdout.write(JSON.stringify(runScenarios(model, scenarios)));
    return;
  }
  if (command === "scenarios" && a && b) {
    const model = await load(a);
    process.stdout.write(
      JSON.stringify(makeScenarios(model, Number(b), rest[0] ? Number(rest[0]) : 1)),
    );
    return;
  }
  process.stderr.write(
    "Usage: cli.ts compile <workbook> <model.json> | verify <file> [--json] | run <model.json> <scenarios.json> | scenarios <file> <count> [seed]\n",
  );
  process.exitCode = 2;
}

void main();
