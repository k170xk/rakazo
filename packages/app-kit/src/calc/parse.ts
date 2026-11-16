import type { ErrorCode, Value } from "./values.js";
import { ERRORS } from "./values.js";

/**
 * Excel formulas as stored in a workbook file (English names, commas between arguments) parsed
 * into a tree. References keep Excel's relative/absolute meaning: a relative row or column is held
 * as an offset from the cell the formula was written in, so one parsed tree serves every cell a
 * formula was filled or shared into, exactly as Excel shifts it.
 */

export type RefNode = {
  k: "ref";
  /** Sheet index; -1 for the sheet the formula is on. `sheet2` is the far end of a 3D range. */
  sheet: number;
  sheet2?: number;
  /** Rows and columns are zero-based; relative ones are offsets from the formula's own cell. */
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  ar1: boolean;
  ac1: boolean;
  ar2: boolean;
  ac2: boolean;
  /** Whole columns (A:C) or whole rows (2:5). */
  span?: "cols" | "rows";
};

export type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "err"; v: ErrorCode }
  | RefNode
  | { k: "name"; name: string; sheet: number }
  | { k: "fn"; name: string; args: Node[] }
  /** `paren`: written inside its own brackets, which stops Excel's near-zero adjustment of a final + or -. */
  | { k: "bin"; op: string; a: Node; b: Node; paren?: true }
  | { k: "un"; op: "-" | "+" | "%"; a: Node }
  | { k: "array"; rows: Node[][] }
  | { k: "missing" }
  | { k: "table"; table: string; columns: [string, string] | null; items: string[] }
  | { k: "external"; book: string; sheet: string; ref: string }
  /** An argument Excel evaluates as an array even outside array formulas (set by the engine). */
  | { k: "inarray"; a: Node }
  /** An argument already evaluated, handed on to a function. */
  | { k: "value"; v: Value };

export type ParseContext = {
  /** Zero-based position of the cell the formula belongs to. */
  row: number;
  col: number;
  /** Sheet index by name (case-insensitive), or -1 when there is no such sheet. */
  sheetIndex: (name: string) => number;
};

export class FormulaSyntaxError extends Error {}

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "err"; v: ErrorCode }
  | { t: "ref"; text: string; sheet: string | null; book: string | null }
  | { t: "word"; v: string; sheet: string | null; book: string | null }
  | { t: "fn"; v: string }
  | { t: "op"; v: string }
  | { t: "(" }
  | { t: ")" }
  | { t: "{" }
  | { t: "}" }
  | { t: "," }
  | { t: ";" }
  | { t: "table"; v: string }
  | { t: "space" };

const CELL = String.raw`\$?[A-Za-z]{1,3}\$?\d+`;
const COL = String.raw`\$?[A-Za-z]{1,3}`;
const ROW = String.raw`\$?\d+`;
const REF_BODY = new RegExp(
  `^(?:${CELL}(?::${CELL})?|${COL}:${COL}|${ROW}:${ROW})(?![A-Za-z0-9_.(\\[\u00a1-\uffff])`,
);
/** A name or function: Excel takes any letter, including Greek and accented ones (γRC, Øp, Δc). */
const WORD = /^[A-Za-z_\\\u00a1-\uffff][A-Za-z0-9_.\\?\u00a1-\uffff]*/;
const SHEET_BARE =
  /^((?:\[[^\]]+\])?[A-Za-z0-9_.\u00a0-\uffff]+(?::[A-Za-z0-9_.\u00a0-\uffff]+)?)!/;

function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  const s = formula;
  const push = (token: Token) => tokens.push(token);
  while (at < s.length) {
    const ch = s[at]!;
    if (/\s/.test(ch)) {
      while (at < s.length && /\s/.test(s[at]!)) at++;
      push({ t: "space" });
      continue;
    }
    if (ch === '"') {
      let text = "";
      at++;
      for (;;) {
        if (at >= s.length) throw new FormulaSyntaxError("Unclosed text in a formula.");
        if (s[at] === '"') {
          if (s[at + 1] === '"') {
            text += '"';
            at += 2;
            continue;
          }
          at++;
          break;
        }
        text += s[at++];
      }
      push({ t: "str", v: text });
      continue;
    }
    if (ch === "#") {
      const error = ERRORS.find((code) => s.slice(at, at + code.length).toUpperCase() === code);
      if (!error) throw new FormulaSyntaxError(`Unknown error value at "${s.slice(at, at + 8)}".`);
      at += error.length;
      push({ t: "err", v: error });
      continue;
    }
    // A sheet prefix, quoted or bare, ahead of a reference or a name.
    let sheet: string | null = null;
    let book: string | null = null;
    if (ch === "'") {
      let name = "";
      let p = at + 1;
      for (;;) {
        if (p >= s.length) throw new FormulaSyntaxError("Unclosed sheet name in a formula.");
        if (s[p] === "'") {
          if (s[p + 1] === "'") {
            name += "'";
            p += 2;
            continue;
          }
          p++;
          break;
        }
        name += s[p++];
      }
      if (s[p] !== "!") throw new FormulaSyntaxError("A quoted sheet name must be followed by !.");
      at = p + 1;
      sheet = name;
    } else {
      const match = SHEET_BARE.exec(s.slice(at));
      if (match && !/^\d+(\.\d+)?$/.test(match[1]!)) {
        sheet = match[1]!;
        at += match[0].length;
      }
    }
    if (sheet !== null) {
      const bookMatch = /^\[([^\]]+)\](.*)$/.exec(sheet);
      if (bookMatch) {
        book = bookMatch[1]!;
        sheet = bookMatch[2]!;
      }
      if (s[at] === "#") {
        const error = ERRORS.find((code) => s.slice(at, at + code.length).toUpperCase() === code);
        if (error) {
          at += error.length;
          push({ t: "err", v: error });
          continue;
        }
      }
      const body = REF_BODY.exec(s.slice(at));
      if (body) {
        at += body[0].length;
        push({ t: "ref", text: body[0], sheet, book });
        continue;
      }
      const word = WORD.exec(s.slice(at));
      if (word) {
        at += word[0].length;
        push({ t: "word", v: word[0], sheet, book });
        continue;
      }
      throw new FormulaSyntaxError(`Expected a reference after ${sheet}!.`);
    }
    const body = REF_BODY.exec(s.slice(at));
    if (
      body &&
      inGrid(body[0]) &&
      !(tokens.length && isOperandEnd(tokens[tokens.length - 1]!) && /^\d/.test(body[0]))
    ) {
      // "1:2" could be rows or a number; rows only where an operand can start.
      at += body[0].length;
      push({ t: "ref", text: body[0], sheet: null, book: null });
      continue;
    }
    const number = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(s.slice(at));
    if (number) {
      at += number[0].length;
      push({ t: "num", v: Number(number[0]) });
      continue;
    }
    const word = WORD.exec(s.slice(at));
    if (word) {
      at += word[0].length;
      if (s[at] === "(") {
        push({ t: "fn", v: word[0] });
        continue;
      }
      if (s[at] === "[") {
        const end = matchBracket(s, at);
        push({ t: "table", v: word[0] + s.slice(at, end + 1) });
        at = end + 1;
        continue;
      }
      push({ t: "word", v: word[0], sheet: null, book: null });
      continue;
    }
    if (ch === "[") {
      const end = matchBracket(s, at);
      push({ t: "table", v: s.slice(at, end + 1) });
      at = end + 1;
      continue;
    }
    const two = s.slice(at, at + 2);
    if (two === "<>" || two === "<=" || two === ">=") {
      push({ t: "op", v: two });
      at += 2;
      continue;
    }
    if ("+-*/^&=<>%:@".includes(ch)) {
      push({ t: "op", v: ch });
      at++;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === "{" || ch === "}" || ch === "," || ch === ";") {
      push({ t: ch } as Token);
      at++;
      continue;
    }
    throw new FormulaSyntaxError(`Unexpected "${ch}" in a formula.`);
  }
  return tokens;
}

/** A name such as TAX2019 reads as a name, not a cell, when its column lies beyond XFD. */
function inGrid(text: string): boolean {
  for (const part of text.split(":")) {
    const match = /^\$?([A-Za-z]{1,3})?\$?(\d+)?$/.exec(part);
    if (!match) return false;
    if (match[1] && colNumber(match[1]) > MAX_COL) return false;
    if (match[2] && (Number(match[2]) < 1 || Number(match[2]) - 1 > MAX_ROW)) return false;
  }
  return true;
}

function matchBracket(s: string, at: number): number {
  let depth = 0;
  for (let p = at; p < s.length; p++) {
    if (s[p] === "'") {
      p++;
      continue;
    }
    if (s[p] === "[") depth++;
    if (s[p] === "]") {
      depth--;
      if (depth === 0) return p;
    }
  }
  throw new FormulaSyntaxError("Unclosed [ in a formula.");
}

function isOperandEnd(token: Token): boolean {
  return (
    token.t === "num" ||
    token.t === "str" ||
    token.t === "err" ||
    token.t === "ref" ||
    token.t === "word" ||
    token.t === "table" ||
    token.t === ")" ||
    token.t === "}" ||
    (token.t === "op" && token.v === "%")
  );
}

function isRefStart(token: Token | undefined): boolean {
  return (
    !!token && (token.t === "ref" || token.t === "word" || token.t === "fn" || token.t === "(")
  );
}

/** Whitespace is Excel's intersection operator only between two reference operands. */
function resolveSpaces(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.t !== "space") {
      out.push(token);
      continue;
    }
    const prev = out[out.length - 1];
    const next = tokens[i + 1];
    if (
      prev &&
      (prev.t === "ref" || prev.t === ")" || prev.t === "word") &&
      isRefStart(next) &&
      next?.t !== "("
    ) {
      out.push({ t: "op", v: " " });
    }
  }
  return out;
}

const colNumber = (letters: string) =>
  letters
    .toUpperCase()
    .split("")
    .reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export const MAX_ROW = 1_048_575;
export const MAX_COL = 16_383;

function refNode(
  text: string,
  sheet: number,
  sheet2: number | undefined,
  ctx: ParseContext,
): RefNode {
  const [first, second = first] = text.split(":") as [string, string?];
  const end = second ?? first;
  const cell = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/;
  const a = cell.exec(first);
  const b = cell.exec(end);
  const node: RefNode = {
    k: "ref",
    sheet,
    r1: 0,
    c1: 0,
    r2: 0,
    c2: 0,
    ar1: true,
    ac1: true,
    ar2: true,
    ac2: true,
  };
  if (sheet2 !== undefined && sheet2 !== sheet) node.sheet2 = sheet2;
  const setRow = (key: "1" | "2", abs: boolean, row: number) => {
    node[`ar${key}`] = abs;
    node[`r${key}`] = abs ? row : row - ctx.row;
  };
  const setCol = (key: "1" | "2", abs: boolean, col: number) => {
    node[`ac${key}`] = abs;
    node[`c${key}`] = abs ? col : col - ctx.col;
  };
  if (a && b) {
    setRow("1", a[3] === "$", Number(a[4]) - 1);
    setCol("1", a[1] === "$", colNumber(a[2]!));
    setRow("2", b[3] === "$", Number(b[4]) - 1);
    setCol("2", b[1] === "$", colNumber(b[2]!));
    return node;
  }
  const colOnly = /^(\$?)([A-Za-z]{1,3})$/;
  const ca = colOnly.exec(first);
  const cb = colOnly.exec(end);
  if (ca && cb) {
    node.span = "cols";
    setCol("1", ca[1] === "$", colNumber(ca[2]!));
    setCol("2", cb[1] === "$", colNumber(cb[2]!));
    node.r2 = MAX_ROW;
    return node;
  }
  const rowOnly = /^(\$?)(\d+)$/;
  const ra = rowOnly.exec(first);
  const rb = rowOnly.exec(end);
  if (ra && rb) {
    node.span = "rows";
    setRow("1", ra[1] === "$", Number(ra[2]) - 1);
    setRow("2", rb[1] === "$", Number(rb[2]) - 1);
    node.c2 = MAX_COL;
    return node;
  }
  throw new FormulaSyntaxError(`"${text}" is not a reference.`);
}

/** The function name of an immediate LAMBDA call: its first argument is the LAMBDA. */
export const CALL = "\u0000CALL";

const PREFIXES = /^(?:_xlfn\.|_xlws\.|_xlpm\.|_xludf\.)+/i;

/** A function name as Excel knows it, without the file format's version prefixes. */
export const functionName = (raw: string) => raw.replace(PREFIXES, "").toUpperCase();

export function parseFormula(formula: string, ctx: ParseContext): Node {
  const tokens = resolveSpaces(tokenize(formula.replace(/^=/, "")));
  let at = 0;
  const peek = () => tokens[at];
  const next = () => tokens[at++];
  const expectOp = (type: Token["t"]) => {
    const token = next();
    if (!token || token.t !== type) throw new FormulaSyntaxError(`Expected ${type} in a formula.`);
  };

  const sheetOf = (
    name: string | null,
    book: string | null,
  ): { sheet: number; sheet2?: number } => {
    if (name === null) return { sheet: -1 };
    if (book !== null) return { sheet: -2 };
    const [first, last] = name.split(":") as [string, string?];
    const sheet = ctx.sheetIndex(first);
    if (sheet < 0) return { sheet: -2 };
    if (last === undefined) return { sheet };
    const sheet2 = ctx.sheetIndex(last);
    return sheet2 < 0 ? { sheet: -2 } : { sheet, sheet2 };
  };

  const BINARY: Record<string, number> = {
    "=": 1,
    "<>": 1,
    "<": 1,
    ">": 1,
    "<=": 1,
    ">=": 1,
    "&": 2,
    "+": 3,
    "-": 3,
    "*": 4,
    "/": 4,
    "^": 5,
    " ": 8,
    ":": 9,
  };

  const primary = (): Node => {
    const token = next();
    if (!token) throw new FormulaSyntaxError("The formula ends too early.");
    switch (token.t) {
      case "num":
        return { k: "num", v: token.v };
      case "str":
        return { k: "str", v: token.v };
      case "err":
        return { k: "err", v: token.v };
      case "ref": {
        if (token.book !== null) {
          return { k: "external", book: token.book, sheet: token.sheet ?? "", ref: token.text };
        }
        const { sheet, sheet2 } = sheetOf(token.sheet, token.book);
        if (sheet === -2) return { k: "err", v: "#REF!" };
        return refNode(token.text, sheet, sheet2, ctx);
      }
      case "word": {
        const upper = token.v.toUpperCase();
        if (token.sheet === null && (upper === "TRUE" || upper === "FALSE")) {
          return { k: "bool", v: upper === "TRUE" };
        }
        if (token.book !== null) {
          return { k: "external", book: token.book, sheet: token.sheet ?? "", ref: token.v };
        }
        const { sheet } = sheetOf(token.sheet, null);
        return { k: "name", name: token.v.replace(PREFIXES, ""), sheet };
      }
      case "table":
        return tableNode(token.v);
      case "fn": {
        expectOp("(");
        const args: Node[] = [];
        if (peek()?.t === ")") {
          next();
        } else {
          for (;;) {
            const p = peek();
            if (p?.t === "," || p?.t === ")") args.push({ k: "missing" });
            else args.push(expression(0));
            const sep = next();
            if (sep?.t === ")") break;
            if (sep?.t !== ",") throw new FormulaSyntaxError(`Expected , or ) in ${token.v}(…).`);
          }
        }
        let call: Node = { k: "fn", name: functionName(token.v), args };
        // LAMBDA(x, x + 1)(2) calls the function it just made.
        while (
          call.k === "fn" &&
          (call.name === "LAMBDA" || call.name === CALL) &&
          peek()?.t === "("
        ) {
          next();
          const callArgs: Node[] = [call];
          if (peek()?.t === ")") next();
          else
            for (;;) {
              const p = peek();
              callArgs.push(p?.t === "," || p?.t === ")" ? { k: "missing" } : expression(0));
              const sep = next();
              if (sep?.t === ")") break;
              if (sep?.t !== ",") throw new FormulaSyntaxError("Expected , or ) in a LAMBDA call.");
            }
          call = { k: "fn", name: CALL, args: callArgs };
        }
        return call;
      }
      case "(": {
        const inner = expression(0, true);
        expectOp(")");
        return inner.k === "bin" && !inner.paren ? { ...inner, paren: true } : inner;
      }
      case "{": {
        const rows: Node[][] = [[]];
        for (;;) {
          let sign = 1;
          let item = next();
          while (item?.t === "op" && (item.v === "-" || item.v === "+")) {
            if (item.v === "-") sign = -sign;
            item = next();
          }
          if (!item) throw new FormulaSyntaxError("Unclosed array constant.");
          if (item.t === "num") rows[rows.length - 1]!.push({ k: "num", v: sign * item.v });
          else if (item.t === "str") rows[rows.length - 1]!.push({ k: "str", v: item.v });
          else if (item.t === "err") rows[rows.length - 1]!.push({ k: "err", v: item.v });
          else if (item.t === "word" && /^(TRUE|FALSE)$/i.test(item.v))
            rows[rows.length - 1]!.push({ k: "bool", v: /^TRUE$/i.test(item.v) });
          else
            throw new FormulaSyntaxError(
              "Array constants hold only numbers, text, logicals and errors.",
            );
          const sep = next();
          if (sep?.t === "}") break;
          if (sep?.t === ",") continue;
          if (sep?.t === ";") {
            rows.push([]);
            continue;
          }
          throw new FormulaSyntaxError("Expected , ; or } in an array constant.");
        }
        return { k: "array", rows };
      }
      case "op": {
        if (token.v === "-" || token.v === "+") {
          // Negation binds tighter than ^ in Excel: -2^2 is 4.
          const operand = expression(6);
          return { k: "un", op: token.v, a: operand };
        }
        if (token.v === "@") return expression(7);
        throw new FormulaSyntaxError(`Unexpected ${token.v} in a formula.`);
      }
      default:
        throw new FormulaSyntaxError("Unexpected symbol in a formula.");
    }
  };

  const expression = (minPrec: number, inParens = false): Node => {
    let left = primary();
    for (;;) {
      const token = peek();
      if (!token) break;
      if (token.t === "op" && token.v === "%") {
        next();
        left = { k: "un", op: "%", a: left };
        continue;
      }
      if (inParens && token.t === "," && minPrec === 0) {
        // (A1,B2) inside brackets is the union operator.
        next();
        const right = expression(1, true);
        left = { k: "bin", op: ",", a: left, b: right };
        continue;
      }
      if (token.t !== "op") break;
      const prec = BINARY[token.v];
      if (prec === undefined || prec <= minPrec) break;
      next();
      // ^ is left-associative in Excel: 2^3^2 is 64.
      const right = expression(prec);
      left = { k: "bin", op: token.v, a: left, b: right };
    }
    return left;
  };

  if (!tokens.length) throw new FormulaSyntaxError("The formula is empty.");
  const tree = expression(0);
  if (at < tokens.length)
    throw new FormulaSyntaxError("Unexpected text after the end of a formula.");
  return tree;
}

/** Table[Column], Table[[#This Row],[A]:[B]], Table[#All], [@Column] as one structured reference. */
function tableNode(text: string): Node {
  const open = text.indexOf("[");
  const table = text.slice(0, open);
  const inner = text.slice(open + 1, -1);
  const items: string[] = [];
  let columns: [string, string] | null = null;
  const unquote = (value: string) => value.replace(/'(.)/g, "$1");
  if (!inner.includes("[")) {
    if (inner.startsWith("@")) {
      items.push("#This Row");
      if (inner.length > 1) columns = [unquote(inner.slice(1)), unquote(inner.slice(1))];
    } else if (inner.startsWith("#")) items.push(inner);
    else if (inner) columns = [unquote(inner), unquote(inner)];
    return { k: "table", table, columns, items };
  }
  const parts = inner.match(/\[(?:[^\]']|'.)*\]|@|:/g) ?? [];
  const names: string[] = [];
  let range = false;
  for (const part of parts) {
    if (part === ":") {
      range = true;
      continue;
    }
    if (part === "@") {
      items.push("#This Row");
      continue;
    }
    const value = unquote(part.slice(1, -1));
    if (value.startsWith("#")) items.push(value);
    else names.push(value);
  }
  if (names.length) columns = [names[0]!, range ? names[names.length - 1]! : names[0]!];
  return { k: "table", table, columns, items };
}

/** Every function a parsed formula calls, for checking them against the library before trusting it. */
export function functionsIn(node: Node, out = new Set<string>()): Set<string> {
  switch (node.k) {
    case "fn":
      out.add(node.name);
      for (const arg of node.args) functionsIn(arg, out);
      break;
    case "bin":
      functionsIn(node.a, out);
      functionsIn(node.b, out);
      break;
    case "un":
    case "inarray":
      functionsIn(node.a, out);
      break;
  }
  return out;
}
