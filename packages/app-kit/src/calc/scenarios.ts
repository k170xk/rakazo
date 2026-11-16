import type { CalcModel, CellValueJson, InputSpec } from "./model.js";
import { address } from "./model.js";

export type Scenario = { id: string; inputs: Record<string, CellValueJson> };

/** A small seeded generator, so the same seed always gives the same scenarios. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const decimals = (x: number) => {
  const text = String(x);
  const e = /e-(\d+)$/.exec(text);
  if (e) return Number(e[1]);
  return text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;
};

/** A different value for one input that its validation would accept. */
function vary(input: InputSpec, current: CellValueJson, next: () => number): CellValueJson {
  if (input.kind === "choice" && input.options?.length)
    return input.options[Math.floor(next() * input.options.length)]!;
  if (input.kind === "boolean") return next() < 0.5;
  if (input.kind === "text") return current;
  const base = typeof current === "number" ? current : 0;
  if (input.kind === "date") return Math.max(1, Math.round(base + (next() - 0.5) * 730));
  let value: number;
  if (input.min !== undefined && input.max !== undefined)
    value = input.min + next() * (input.max - input.min);
  else if (base === 0) value = [0, 1, 2, 5, 10, 100][Math.floor(next() * 6)]!;
  else value = base * (0.5 + next());
  if (input.min !== undefined) value = Math.max(input.min, value);
  if (input.max !== undefined) value = Math.min(input.max, value);
  if (input.integer) return Math.round(value);
  const places = Math.min(6, Math.max(decimals(base), Math.abs(base) < 10 ? 2 : 0));
  return Number(value.toFixed(places));
}

/**
 * Input sets for testing a calculator beyond the values it was saved with: the first is the
 * workbook as saved, each later one changes a random half of the inputs. Every scenario lists all
 * inputs so another calculator can apply it without knowing the saved values.
 */
export function makeScenarios(model: CalcModel, count: number, seed = 1): Scenario[] {
  const next = random(seed);
  const saved = model.inputs.map((input) => {
    const cell = model.sheets[input.sheet]!.cells.find(
      ([r, c]) => r === input.row && c === input.col,
    );
    return cell ? (cell[2].v ?? null) : null;
  });
  const key = (input: InputSpec) =>
    `${model.sheets[input.sheet]!.name}!${address(input.row, input.col)}`;
  const out: Scenario[] = [];
  for (let n = 0; n < count; n++) {
    const inputs: Record<string, CellValueJson> = {};
    model.inputs.forEach((input, i) => {
      inputs[key(input)] = n > 0 && next() < 0.5 ? vary(input, saved[i]!, next) : saved[i]!;
    });
    out.push({ id: n === 0 ? "saved" : `s${n}`, inputs });
  }
  return out;
}
