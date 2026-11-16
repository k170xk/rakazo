const GREEK: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
};

const SYMBOLS: Record<string, [unicode: string, latin: string]> = {
  times: ["×", "×"],
  cdot: ["·", "·"],
  div: ["÷", "÷"],
  pm: ["±", "±"],
  mp: ["∓", "-/+"],
  le: ["≤", "<="],
  leq: ["≤", "<="],
  ge: ["≥", ">="],
  geq: ["≥", ">="],
  ne: ["≠", "!="],
  neq: ["≠", "!="],
  approx: ["≈", "~"],
  simeq: ["≃", "~"],
  equiv: ["≡", "="],
  infty: ["∞", "inf"],
  circ: ["°", "°"],
  degree: ["°", "°"],
  partial: ["∂", "d"],
  sum: ["Σ", "sum "],
  int: ["∫", "integral "],
  rightarrow: ["→", "->"],
  to: ["→", "->"],
  Rightarrow: ["⇒", "=>"],
  leftarrow: ["←", "<-"],
  ldots: ["…", "..."],
  dots: ["…", "..."],
  cdots: ["⋯", "..."],
  max: ["max", "max"],
  min: ["min", "min"],
  log: ["log", "log"],
  ln: ["ln", "ln"],
  exp: ["exp", "exp"],
  sin: ["sin", "sin"],
  cos: ["cos", "cos"],
  tan: ["tan", "tan"],
  arctan: ["arctan", "arctan"],
  "%": ["%", "%"],
  "{": ["{", "{"],
  "}": ["}", "}"],
  _: ["_", "_"],
  "&": ["&", "&"],
  "#": ["#", "#"],
  $: ["$", "$"],
};

const SPACES: Record<string, string> = { ",": " ", ";": " ", ":": " ", "!": "", " ": " ", quad: "  ", qquad: "  " };
const VERBATIM = new Set(["text", "mathrm", "textrm", "mathit", "mathbf", "boldsymbol", "mathsf", "operatorname", "textbf", "textit", "mathbb", "mathcal", "bar", "hat", "overline", "vec", "tilde", "dot"]);
const SUPER: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", "+": "⁺", n: "ⁿ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };

export type TexTextOptions = {
  /** Only Latin-1 characters (what the PDF reports print): Greek letters spelled out, ≤ as <=. */
  latin?: boolean;
};

/**
 * Readable plain text for a LaTeX formula, for PDF reports, CSV and screen readers:
 * "M_{Ed} = \\frac{w L^2}{8}" reads "M_Ed = w L²/8".
 */
export function texText(latex: string, options: TexTextOptions = {}): string {
  const latin = options.latin ?? false;
  let i = 0;

  const simple = (text: string) => /^[\p{L}\p{N}.,°²³⁰-⁹·]+$/u.test(text);
  const wrap = (text: string) => (simple(text) ? text : `(${text})`);

  const script = (text: string, map: Record<string, string>, mark: string) => {
    const chars = [...text];
    if (chars.length > 0 && chars.every((c) => map[c] !== undefined)) {
      if (!latin) return chars.map((c) => map[c]).join("");
      if (mark === "^" && (text === "2" || text === "3")) return map[text]!;
    }
    return `${mark}${chars.length > 1 && !simple(text) ? `(${text})` : text}`;
  };

  const skipSpace = () => {
    while (latex[i] === " ") i++;
  };

  const command = (): string => {
    i++;
    let name = latex[i] ?? "";
    if (/[a-zA-Z]/.test(name)) {
      const match = /^[a-zA-Z]+/.exec(latex.slice(i))!;
      name = match[0];
    }
    i += name.length;
    if (name === "\\") return "\n";
    if (name in SPACES) return SPACES[name]!;
    if (name === "frac" || name === "dfrac" || name === "tfrac") {
      const top = argument();
      const bottom = argument();
      return `${wrap(top)}/${wrap(bottom)}`;
    }
    if (name === "sqrt") {
      skipSpace();
      let degree = "";
      if (latex[i] === "[") {
        const close = latex.indexOf("]", i);
        degree = latex.slice(i + 1, close < 0 ? latex.length : close);
        i = close < 0 ? latex.length : close + 1;
      }
      const body = argument();
      if (latin) return degree ? `(${body})^(1/${degree})` : `sqrt(${body})`;
      return `${degree ? script(degree, SUPER, "^") : ""}√${wrap(body)}`;
    }
    if (VERBATIM.has(name)) return argument();
    if (name === "begin" || name === "end") {
      argument();
      return "";
    }
    if (name === "left" || name === "right" || name === "bigl" || name === "bigr" || name === "big" || name === "Big") {
      skipSpace();
      if (latex[i] === "\\") return command();
      const delimiter = latex[i] ?? "";
      i++;
      return delimiter === "." ? "" : delimiter;
    }
    const greek = GREEK[name];
    if (greek !== undefined) return latin ? (name === "mu" ? "µ" : name) : greek;
    const symbol = SYMBOLS[name];
    if (symbol) return latin ? symbol[1] : symbol[0];
    return name;
  };

  const argument = (): string => {
    skipSpace();
    const ch = latex[i];
    if (ch === undefined) return "";
    if (ch === "{") {
      i++;
      return group(true);
    }
    if (ch === "\\") return command();
    i++;
    return ch;
  };

  const group = (closing: boolean): string => {
    let out = "";
    while (i < latex.length) {
      const ch = latex[i]!;
      if (ch === "}" && closing) {
        i++;
        return out;
      }
      if (ch === "{") {
        i++;
        out += group(true);
      } else if (ch === "\\") out += command();
      else if (ch === "^") {
        i++;
        out += script(argument(), SUPER, "^");
      } else if (ch === "_") {
        i++;
        out += script(argument(), SUB, "_");
      } else if (ch === "&") i++;
      else if (ch === "~") {
        out += " ";
        i++;
      } else {
        out += ch;
        i++;
      }
    }
    return out;
  };

  const text = group(false);
  const tidied = text
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]+/g, " ")
        .replace(/\( /g, "(")
        .replace(/ \)/g, ")")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
  return latin ? tidied.replace(/[^\n\u0020-\u00ff]/g, "") : tidied;
}
