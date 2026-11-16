import type { NumberStyle } from "../eng/format.js";
import { numberParts } from "../eng/format.js";

/** A number as LaTeX by the same rules as fmt: 1.5 \times 10^{-6} outside the plain range. */
export function texNum(x: number, style: NumberStyle = {}): string {
  const { text, exponent } = numberParts(x, { ...style, group: style.group === undefined ? undefined : "{,}" });
  const body = text.replace("∞", "\\infty").replace("–", "\\text{–}");
  return exponent === undefined ? body : `${body} \\times 10^{${exponent}}`;
}

const SUPER: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-" };

/** A unit as upright LaTeX: "kN/m^2" → \mathrm{kN/m^{2}}, "kgCO2e" keeps CO₂ as a subscript. */
export function texUnit(unit: string): string {
  if (!unit) return "";
  const body = unit
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (run) => `^${[...run].map((char) => SUPER[char]).join("")}`)
    .replace(/CO2/g, "CO\u0000")
    .replace(/\^\(?(-?\d+(?:\.\d+)?)\)?/g, "^{$1}")
    .replace(/([A-Za-zµμΩ)])(-?\d+)/g, "$1^{$2}")
    .replace(/\u0000/g, "_2")
    .replace(/\s*[·⋅*]\s*|\s+/g, "\\cdot ")
    .replace(/[µμ]/g, "\\mu ")
    .replace(/Ω/g, "\\Omega ")
    .replace(/%/g, "\\%")
    .replace(/°/g, "{}^{\\circ}");
  return `\\mathrm{${body}}`;
}

/** A value with its unit as LaTeX, with a thin space between: 12.5\,\mathrm{kN}. */
export function texQty(x: number, unit = "", style: NumberStyle = {}): string {
  const number = texNum(x, style);
  if (!unit) return number;
  return unit === "%" || unit === "°" ? `${number}${texUnit(unit)}` : `${number}\\,${texUnit(unit)}`;
}

const GREEK = new Set(
  "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega".split(" "),
);
/** Commands whose argument is words, not symbols to substitute. */
const VERBATIM = new Set(["text", "mathrm", "operatorname", "textrm", "textit", "textbf", "mathit", "mathbf", "label", "begin", "end"]);

type Kind = "value" | "symbol" | "close" | "other";

/**
 * Substitutes numbers into a symbolic LaTeX formula: subst("\\frac{w L^2}{8}", {w: 12.5, L: 6})
 * gives \frac{12.5 \times 6^2}{8}. Keys are symbols as written (L, f_{ck}, \gamma_c); adjacent
 * values get \times, and negative values are bracketed.
 */
export function subst(latex: string, values: Record<string, number>, style: NumberStyle = {}): string {
  let out = "";
  let previous = "other" as Kind;
  let i = 0;
  const emit = (text: string, kind: Kind) => {
    if (text.startsWith(" \\times ")) out = out.trimEnd();
    out += text;
    if (text.trim()) previous = kind;
  };
  const symbolAt = (at: number) => /^(\\[A-Za-z]+|[A-Za-z])(?:_(?:\{[^{}]*\}|[A-Za-z0-9]))?('*)/.exec(latex.slice(at));
  while (i < latex.length) {
    const rest = latex.slice(i);
    const verbatim = /^\\([A-Za-z]+)\s*\{[^{}]*\}/.exec(rest);
    if (verbatim && VERBATIM.has(verbatim[1]!)) {
      emit(verbatim[0], verbatim[1] === "text" || verbatim[1] === "mathrm" ? "symbol" : "other");
      i += verbatim[0].length;
      continue;
    }
    const symbol = symbolAt(i);
    if (symbol) {
      const name = symbol[0];
      const head = symbol[1]!;
      const isCommand = head.startsWith("\\");
      if (Object.hasOwn(values, name)) {
        const value = values[name]!;
        const number = texNum(value, style);
        const text = value < 0 || number.includes("\\times") ? `\\left(${number}\\right)` : number;
        const times = previous === "value" || previous === "symbol" || previous === "close" ? " \\times " : "";
        emit(`${times}${text}`, "value");
      } else if (isCommand && !GREEK.has(head.slice(1))) {
        emit(name, "other");
      } else {
        emit(name, "symbol");
      }
      i += name.length;
      continue;
    }
    const char = latex[i]!;
    if (/\d|\./.test(char)) {
      const number = /^\d*\.?\d+/.exec(rest)?.[0] ?? char;
      const times = previous === "value" || previous === "close" ? " \\times " : "";
      emit(`${times}${number}`, "value");
      i += number.length;
      continue;
    }
    emit(char, char === "}" || char === ")" || char === "]" ? "close" : "other");
    if (char === "^" || char === "_") {
      // A power or subscript belongs to what came before: keep it attached.
      const power = /^(\{[^{}]*\}|[A-Za-z0-9])/.exec(latex.slice(i + 1));
      if (power) {
        out += power[0];
        i += power[0].length;
        previous = "close";
      }
    }
    i += 1;
  }
  return out;
}
