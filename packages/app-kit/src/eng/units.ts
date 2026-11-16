/**
 * Units with dimensional analysis. A unit is a factor to SI, a dimension vector and (for °C and °F
 * only) an offset. Strings parse as products and quotients: "kN/m^2", "N/mm²", "W/(m·K)", "kNm",
 * "m3/s", "kgCO2e/m2". Carbon (CO2e) is its own dimension so kgCO2e never converts to kg.
 */

const BASES = ["kg", "m", "s", "A", "K", "mol", "cd", "CO2e"] as const;
export type Dimension = readonly number[];

export type Unit = { factor: number; dim: Dimension; offset?: number };

const dim = (...powers: number[]): Dimension => BASES.map((_, i) => powers[i] ?? 0);
const NONE = dim();
const MASS = dim(1);
const LENGTH = dim(0, 1);
const TIME = dim(0, 0, 1);
const CURRENT = dim(0, 0, 0, 1);
const TEMPERATURE = dim(0, 0, 0, 0, 1);
const FORCE = dim(1, 1, -2);
const PRESSURE = dim(1, -1, -2);
const ENERGY = dim(1, 2, -2);
const POWER = dim(1, 2, -3);
const VOLTAGE = dim(1, 2, -3, -1);
const CARBON = dim(0, 0, 0, 0, 0, 0, 0, 1);

/** Units that take SI prefixes (k, M, m, µ ...), by symbol. */
const PREFIXABLE: Record<string, Unit> = {
  m: { factor: 1, dim: LENGTH },
  g: { factor: 1e-3, dim: MASS },
  s: { factor: 1, dim: TIME },
  A: { factor: 1, dim: CURRENT },
  K: { factor: 1, dim: TEMPERATURE },
  mol: { factor: 1, dim: dim(0, 0, 0, 0, 0, 1) },
  cd: { factor: 1, dim: dim(0, 0, 0, 0, 0, 0, 1) },
  N: { factor: 1, dim: FORCE },
  Pa: { factor: 1, dim: PRESSURE },
  J: { factor: 1, dim: ENERGY },
  W: { factor: 1, dim: POWER },
  Wh: { factor: 3600, dim: ENERGY },
  VA: { factor: 1, dim: POWER },
  var: { factor: 1, dim: POWER },
  V: { factor: 1, dim: VOLTAGE },
  Ω: { factor: 1, dim: dim(1, 2, -3, -2) },
  ohm: { factor: 1, dim: dim(1, 2, -3, -2) },
  S: { factor: 1, dim: dim(-1, -2, 3, 2) },
  C: { factor: 1, dim: dim(0, 0, 1, 1) },
  F: { factor: 1, dim: dim(-1, -2, 4, 2) },
  H: { factor: 1, dim: dim(1, 2, -2, -2) },
  T: { factor: 1, dim: dim(1, 0, -2, -1) },
  Wb: { factor: 1, dim: dim(1, 2, -2, -1) },
  Hz: { factor: 1, dim: dim(0, 0, -1) },
  L: { factor: 1e-3, dim: dim(0, 3) },
  l: { factor: 1e-3, dim: dim(0, 3) },
  t: { factor: 1e3, dim: MASS },
  bar: { factor: 1e5, dim: PRESSURE },
  gCO2e: { factor: 1e-3, dim: CARBON },
  tCO2e: { factor: 1e3, dim: CARBON },
  eV: { factor: 1.602176634e-19, dim: ENERGY },
};

const PREFIX: Record<string, number> = {
  p: 1e-12,
  n: 1e-9,
  µ: 1e-6,
  μ: 1e-6,
  u: 1e-6,
  m: 1e-3,
  c: 1e-2,
  d: 1e-1,
  h: 1e2,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
};

const LBF = 4.4482216152605;
const INCH = 0.0254;
const FOOT = 0.3048;

/** Whole symbols, matched before prefixes: "min" is minutes, not milli-inches. */
const NAMED: Record<string, Unit> = {
  "": { factor: 1, dim: NONE },
  "%": { factor: 0.01, dim: NONE },
  "‰": { factor: 0.001, dim: NONE },
  rad: { factor: 1, dim: NONE },
  deg: { factor: Math.PI / 180, dim: NONE },
  "°": { factor: Math.PI / 180, dim: NONE },
  min: { factor: 60, dim: TIME },
  h: { factor: 3600, dim: TIME },
  hr: { factor: 3600, dim: TIME },
  day: { factor: 86400, dim: TIME },
  d: { factor: 86400, dim: TIME },
  yr: { factor: 31557600, dim: TIME },
  ha: { factor: 1e4, dim: dim(0, 2) },
  "°C": { factor: 1, dim: TEMPERATURE, offset: 273.15 },
  degC: { factor: 1, dim: TEMPERATURE, offset: 273.15 },
  "°F": { factor: 5 / 9, dim: TEMPERATURE, offset: (459.67 * 5) / 9 },
  degF: { factor: 5 / 9, dim: TEMPERATURE, offset: (459.67 * 5) / 9 },
  in: { factor: INCH, dim: LENGTH },
  ft: { factor: FOOT, dim: LENGTH },
  yd: { factor: 0.9144, dim: LENGTH },
  mi: { factor: 1609.344, dim: LENGTH },
  lb: { factor: 0.45359237, dim: MASS },
  lbf: { factor: LBF, dim: FORCE },
  kip: { factor: 1000 * LBF, dim: FORCE },
  psi: { factor: LBF / INCH ** 2, dim: PRESSURE },
  ksi: { factor: (1000 * LBF) / INCH ** 2, dim: PRESSURE },
  psf: { factor: LBF / FOOT ** 2, dim: PRESSURE },
  gal: { factor: 4.54609e-3, dim: dim(0, 3) },
  usgal: { factor: 3.785411784e-3, dim: dim(0, 3) },
  hp: { factor: 745.69987158227, dim: POWER },
  BTU: { factor: 1055.05585262, dim: ENERGY },
  kgCO2e: { factor: 1, dim: CARBON },
  kgCO2: { factor: 1, dim: CARBON },
  tCO2: { factor: 1e3, dim: CARBON },
  kgf: { factor: 9.80665, dim: FORCE },
  atm: { factor: 101325, dim: PRESSURE },
  mH2O: { factor: 9806.65, dim: PRESSURE },
  mmHg: { factor: 133.322387415, dim: PRESSURE },
  kNm: { factor: 1e3, dim: ENERGY },
  Nm: { factor: 1, dim: ENERGY },
  MNm: { factor: 1e6, dim: ENERGY },
  Nmm: { factor: 1e-3, dim: ENERGY },
  kNmm: { factor: 1, dim: ENERGY },
  rpm: { factor: 1 / 60, dim: dim(0, 0, -1) },
};

const sameDim = (a: Dimension, b: Dimension) =>
  a.every((power, i) => Math.abs(power - (b[i] ?? 0)) < 1e-12);
const combine = (a: Dimension, b: Dimension, sign: number) =>
  a.map((power, i) => power + sign * (b[i] ?? 0));

function atom(symbol: string): Unit | null {
  const named = NAMED[symbol];
  if (named) return named;
  const plain = PREFIXABLE[symbol];
  if (plain) return plain;
  for (const [prefix, factor] of Object.entries(PREFIX)) {
    if (!symbol.startsWith(prefix)) continue;
    const base = PREFIXABLE[symbol.slice(prefix.length)];
    if (base && symbol.length > prefix.length)
      return { factor: factor * base.factor, dim: base.dim };
  }
  if (symbol.startsWith("da") && PREFIXABLE[symbol.slice(2)]) {
    const base = PREFIXABLE[symbol.slice(2)]!;
    return { factor: 10 * base.factor, dim: base.dim };
  }
  return null;
}

const SUPER: Record<string, string> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "⁻": "-",
};

/** One factor such as "mm^4", "m²", "s-1" or "kgCO2e": the symbol and its power. */
function factorOf(text: string): Unit {
  const normal = text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]/g, (char) => `${SUPER[char]}`);
  if (atom(normal)) return atom(normal)!;
  const match = /^(.+?)\^?\(?(-?\d+(?:\.\d+)?)\)?$/.exec(normal);
  if (match) {
    const base = atom(match[1]!);
    const power = Number(match[2]);
    if (base) {
      if (base.offset)
        throw new Error(
          `${match[1]} cannot be raised to a power; use K for temperature differences.`,
        );
      return { factor: base.factor ** power, dim: base.dim.map((p) => p * power) };
    }
  }
  // Written together, as in W/m2K: each symbol with its power.
  const pieces = normal.match(/[^\d-]+-?\d*/g);
  if (pieces && pieces.length > 1 && pieces.join("") === normal) {
    return pieces
      .map(factorOf)
      .reduce((a, b) => ({ factor: a.factor * b.factor, dim: combine(a.dim, b.dim, 1) }));
  }
  throw new Error(`Unknown unit "${text}".`);
}

type Token =
  | { kind: "unit"; unit: Unit }
  | { kind: "op"; op: "*" | "/" }
  | { kind: "open" }
  | { kind: "close"; power: number };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const source = text.trim();
  let i = 0;
  while (i < source.length) {
    const char = source[i]!;
    if (
      char === " " ||
      char === "*" ||
      char === "·" ||
      char === "⋅" ||
      char === "×" ||
      char === "."
    ) {
      tokens.push({ kind: "op", op: "*" });
      i += 1;
    } else if (char === "/") {
      tokens.push({ kind: "op", op: "/" });
      i += 1;
    } else if (char === "(") {
      tokens.push({ kind: "open" });
      i += 1;
    } else if (char === ")") {
      const power = /^\)(?:\^?(-?\d+)|([²³⁴]))/.exec(source.slice(i));
      const value = power ? Number(power[1] ?? SUPER[power[2]!]) : 1;
      tokens.push({ kind: "close", power: value });
      i += power ? power[0].length : 1;
    } else {
      const word =
        /^[^\s*·⋅×/()]+?(?=[\s*·⋅×/()]|\.(?!\d)|$)/.exec(source.slice(i))?.[0] ?? source.slice(i);
      tokens.push({ kind: "unit", unit: factorOf(word) });
      i += word.length;
    }
  }
  return tokens;
}

function parseTokens(tokens: Token[], start: number): { unit: Unit; next: number } {
  let factor = 1;
  let powers: Dimension = NONE;
  let offset: number | undefined;
  let count = 0;
  let divide = false;
  let i = start;
  const apply = (unit: Unit) => {
    count += 1;
    if (unit.offset) offset = unit.offset;
    factor = divide ? factor / unit.factor : factor * unit.factor;
    powers = combine(powers, unit.dim, divide ? -1 : 1);
    divide = false;
  };
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (token.kind === "close") break;
    if (token.kind === "op") {
      if (token.op === "/") divide = true;
      i += 1;
    } else if (token.kind === "open") {
      const inner = parseTokens(tokens, i + 1);
      const close = tokens[inner.next];
      if (close?.kind !== "close") throw new Error("Unbalanced brackets in unit.");
      apply({
        factor: inner.unit.factor ** close.power,
        dim: inner.unit.dim.map((p) => p * close.power),
      });
      i = inner.next + 1;
    } else {
      apply(token.unit);
      i += 1;
    }
  }
  if (offset !== undefined && count > 1)
    throw new Error("°C and °F only convert on their own; use K inside compound units.");
  return { unit: { factor, dim: powers, ...(offset !== undefined ? { offset } : {}) }, next: i };
}

const cache = new Map<string, Unit>();

/** Parses a unit string; throws on unknown symbols. */
export function unit(text: string): Unit {
  const cached = cache.get(text);
  if (cached) return cached;
  const tokens = tokenize(text.replace(/^1\//, "/"));
  const parsed = parseTokens(tokens, 0);
  if (parsed.next !== tokens.length) throw new Error(`Unbalanced brackets in unit "${text}".`);
  cache.set(text, parsed.unit);
  return parsed.unit;
}

/** The unit's dimension as text, e.g. "kg·m·s⁻²" for kN. */
export function dimensionOf(text: string): string {
  const powers = unit(text).dim;
  const parts = BASES.flatMap((base, i) =>
    powers[i] ? [powers[i] === 1 ? base : `${base}^${powers[i]}`] : [],
  );
  return parts.join("·") || "1";
}

/** Whether two units measure the same quantity (kNm and J do; kN and kg do not). */
export function compatible(a: string, b: string): boolean {
  return sameDim(unit(a).dim, unit(b).dim);
}

/** Round-off from factors like 0.3048 is dropped at 15 significant digits, as Excel shows numbers. */
const clean = (x: number) => (Number.isFinite(x) && x !== 0 ? Number(x.toPrecision(15)) : x);

/** Converts a value between compatible units; throws when the dimensions differ. */
export function convert(value: number, from: string, to: string): number {
  const a = unit(from);
  const b = unit(to);
  if (!sameDim(a.dim, b.dim)) {
    throw new Error(`Cannot convert ${from} (${dimensionOf(from)}) to ${to} (${dimensionOf(to)}).`);
  }
  const si = value * a.factor + (a.offset ?? 0);
  return clean((si - (b.offset ?? 0)) / b.factor);
}

/**
 * A physical quantity held in SI. Arithmetic keeps the dimension, and adding or comparing
 * mismatched quantities throws, so a wrong formula fails loudly instead of returning a number.
 */
export class Quantity {
  constructor(
    readonly si: number,
    readonly dim: Dimension,
  ) {}

  /** The value in a unit of the same dimension. */
  to(target: string): number {
    const b = unit(target);
    if (!sameDim(this.dim, b.dim))
      throw new Error(`A quantity of ${this.dimension} cannot be shown in ${target}.`);
    return clean((this.si - (b.offset ?? 0)) / b.factor);
  }

  get dimension(): string {
    return (
      BASES.flatMap((base, i) =>
        this.dim[i] ? [this.dim[i] === 1 ? base : `${base}^${this.dim[i]}`] : [],
      ).join("·") || "1"
    );
  }

  is(target: string): boolean {
    return sameDim(this.dim, unit(target).dim);
  }

  private same(other: Quantity, verb: string) {
    if (!sameDim(this.dim, other.dim))
      throw new Error(`Cannot ${verb} ${other.dimension} and ${this.dimension}.`);
  }

  add(other: Quantity) {
    this.same(other, "add");
    return new Quantity(this.si + other.si, this.dim);
  }

  sub(other: Quantity) {
    this.same(other, "subtract");
    return new Quantity(this.si - other.si, this.dim);
  }

  mul(other: Quantity | number) {
    return typeof other === "number"
      ? new Quantity(this.si * other, this.dim)
      : new Quantity(this.si * other.si, combine(this.dim, other.dim, 1));
  }

  div(other: Quantity | number) {
    return typeof other === "number"
      ? new Quantity(this.si / other, this.dim)
      : new Quantity(this.si / other.si, combine(this.dim, other.dim, -1));
  }

  pow(power: number) {
    return new Quantity(
      this.si ** power,
      this.dim.map((p) => p * power),
    );
  }

  sqrt() {
    return this.pow(0.5);
  }

  /** Compares with another quantity of the same dimension: negative, zero or positive. */
  compare(other: Quantity) {
    this.same(other, "compare");
    return this.si - other.si;
  }
}

/** A quantity from a value and unit: q(12, "kN/m").mul(q(6, "m")).to("kN"). Temperatures convert as absolute values. */
export function q(value: number, unitText = ""): Quantity {
  const u = unit(unitText);
  return new Quantity(value * u.factor + (u.offset ?? 0), u.dim);
}
