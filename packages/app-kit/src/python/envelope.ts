import type { PythonPackage } from "./runtime.js";
import { PYTHON_PACKAGES } from "./runtime.js";

export type PythonVersions = { python: string; runtime: string; packages: Record<string, string> };

/**
 * A calculation's answer with what it ran on. key hashes code, inputs and versions (the cache key);
 * hash adds the outputs, so two runs agree exactly when their hashes do.
 */
export type PythonResult<T = Record<string, unknown>> = {
  outputs: T;
  stdout: string;
  stderr: string;
  versions: PythonVersions;
  key: string;
  hash: string;
};

/** A calculation that raised; message names the calc.py line. */
export class PythonError extends Error {
  constructor(
    message: string,
    readonly stdout = "",
    readonly stderr = "",
  ) {
    super(message);
    this.name = "PythonError";
  }
}

export const PYTHON_OUT_OF_MEMORY =
  "This device ran out of memory for the calculation. Close other tabs or apps and try again, or use a computer.";

/** The engine's own words when the browser would not give it memory (not Python's MemoryError). */
const ENGINE_OUT_OF_MEMORY =
  /out of memory|\bOOM\b|Cannot enlarge memory|Array buffer allocation failed|could not allocate|WebAssembly\.Memory|memory access out of bounds/i;

/** Whether a worker failure means the device ran short of memory, so the interpreter must restart. */
export function isOutOfMemory(message: string): boolean {
  return ENGINE_OUT_OF_MEMORY.test(message) && !/^\S+\.py line \d+:/.test(message);
}

/** The hosted packages a calculation imports, in pinned order. */
export function pythonPackages(code: string): PythonPackage[] {
  const names = new Set<string>();
  for (const line of code.split("\n")) {
    const from = /^\s*from\s+([A-Za-z_]\w*)/.exec(line);
    if (from) names.add(from[1]!);
    const imported = /^\s*import\s+(.+)$/.exec(line);
    if (imported) {
      for (const part of imported[1]!.split(",")) {
        const name = /^\s*([A-Za-z_]\w*)/.exec(part)?.[1];
        if (name) names.add(name);
      }
    }
  }
  return PYTHON_PACKAGES.filter((name) => names.has(name));
}

const NONDETERMINISTIC: Array<[RegExp, string]> = [
  [
    /\b(?:time\.(?:time|time_ns|perf_counter|monotonic|process_time)|datetime\.(?:now|utcnow|today)|date\.today)\s*\(/,
    "reads the clock",
  ],
  [
    /\b(?:os\.urandom|SystemRandom|uuid\.uuid[14])\b|^\s*(?:import|from)\s+secrets\b/,
    "uses unseeded randomness",
  ],
  [
    /\bdefault_rng\(\s*\)|\bRandomState\(\s*\)/,
    "makes a random generator without a seed; pass one, e.g. default_rng(0)",
  ],
  [
    /^\s*(?:import|from)\s+(?:js|pyodide|urllib|http|socket|requests|ssl|subprocess|threading|multiprocessing|asyncio)\b/,
    "reaches outside the calculation",
  ],
];

/**
 * The first thing in Python source that would make its answer change from run to run, or null.
 * Calculations must be pure functions of their inputs, so these are refused, not warned about.
 */
export function pythonProblem(code: string, file = "calc.py"): string | null {
  const lines = code.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (/^\s*#/.test(line)) continue;
    for (const [pattern, reason] of NONDETERMINISTIC) {
      if (pattern.test(line)) {
        return `${file} line ${index + 1} ${reason}; a calculation must give the same answer for the same inputs.`;
      }
    }
  }
  return null;
}

/** A value as JSON Python reads back exactly: non-finite numbers travel as {"$float": "inf"}. */
export function toPythonJson(value: unknown, at = "inputs"): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    return { $float: Number.isNaN(value) ? "nan" : value > 0 ? "inf" : "-inf" };
  }
  if (value instanceof Date) return value.toISOString();
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<number>, (item, index) =>
      toPythonJson(item, `${at}[${index}]`),
    );
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      item === undefined ? null : toPythonJson(item, `${at}[${index}]`),
    );
  }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = toPythonJson(item, `${at}.${key}`);
    }
    return out;
  }
  throw new TypeError(
    `${at} can't be passed to Python; pass numbers, text, booleans, lists or plain objects.`,
  );
}

/** The request a run is known by: the same code and inputs always make the same text. */
export function pythonRequest(code: string, inputs: Record<string, unknown>): string {
  return JSON.stringify({ code, inputs: toPythonJson(inputs), packages: pythonPackages(code) });
}

function revive(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    const special = (value as { $float?: unknown }).$float;
    if (keys.length === 1 && typeof special === "string") {
      return special === "nan"
        ? Number.NaN
        : special === "inf"
          ? Number.POSITIVE_INFINITY
          : Number.NEGATIVE_INFINITY;
    }
  }
  return value;
}

/** The runner's envelope as a result, or a PythonError when the calculation raised. */
export function readPythonResult<T = Record<string, unknown>>(text: string): PythonResult<T> {
  const envelope = JSON.parse(text, revive) as PythonResult<T> & { error?: string };
  if (typeof envelope.error === "string") {
    throw new PythonError(envelope.error, envelope.stdout, envelope.stderr);
  }
  return envelope;
}
