import type { Context } from "../engine.js";
import { formatValue } from "../format.js";
import type { Scalar, Value } from "../values.js";
import { Matrix, NA, NUM, parseNumber, toText, VALUE, XlError } from "../values.js";
import type { Fn } from "./helpers.js";
import {
  bool,
  check,
  elementwise,
  evaluate,
  flat,
  hasWildcard,
  int,
  num,
  roundDecimal,
  scalar,
  text,
  wildcard,
} from "./helpers.js";

/**
 * CHAR and CODE for one code page, which Excel takes from the system it runs on: Windows-1252 in
 * Windows Excel, Mac Roman in Mac Excel (where CHAR(157) is "ù").
 */
function codePage(label: string): { CHAR: Fn; CODE: Fn } {
  const decoder = new TextDecoder(label);
  const chars = Array.from({ length: 256 }, (_, i) => decoder.decode(Uint8Array.of(i)));
  const codes = new Map(chars.map((ch, i) => [ch, i]));
  return {
    CHAR: scalar(([x]) => {
      const n = int(x ?? null);
      if (n < 1 || n > 255) return VALUE;
      return chars[n]!;
    }),
    CODE: scalar(([x]) => {
      const s = text(x ?? "");
      if (!s) return VALUE;
      return codes.get(s[0]!) ?? 63;
    }),
  };
}
const WINDOWS = codePage("windows-1252");
const MAC = codePage("macintosh");

/** The workbook's code page: Mac Roman when Mac Excel saved it, so its saved results agree. */
const pageOf = (ctx: Context) =>
  /macintosh/i.test(ctx.engine.model.source.application ?? "") ? MAC : WINDOWS;

const arg = (items: Array<Scalar | undefined>, index: number, fallback: Scalar): Scalar =>
  items[index] === undefined ? fallback : items[index]!;

/** FIXED's text: rounded to `decimals` (negative rounds left of the point), grouped unless told not to. */
export function fixed(value: number, decimals: number, noCommas: boolean): string {
  const places = Math.trunc(decimals);
  const rounded = roundDecimal(value, places, "half");
  const format = `${noCommas ? "0" : "#,##0"}${places > 0 ? `.${"0".repeat(Math.min(places, 127))}` : ""}`;
  return formatValue(rounded, format).text;
}

export const TEXT_FNS: Record<string, Fn> = {
  LEN: scalar(([x]) => text(x ?? "").length),
  LEFT: scalar((items) => {
    const s = text(arg(items, 0, ""));
    const n = int(arg(items, 1, 1));
    if (n < 0) return VALUE;
    return [...s].slice(0, n).join("");
  }),
  RIGHT: scalar((items) => {
    const s = text(arg(items, 0, ""));
    const n = int(arg(items, 1, 1));
    if (n < 0) return VALUE;
    const chars = [...s];
    return n === 0 ? "" : chars.slice(-n).join("");
  }),
  MID: scalar((items) => {
    const s = text(arg(items, 0, ""));
    const start = int(arg(items, 1, null));
    const n = int(arg(items, 2, null));
    if (start < 1 || n < 0) return VALUE;
    return [...s].slice(start - 1, start - 1 + n).join("");
  }),
  UPPER: scalar(([x]) => text(x ?? "").toUpperCase()),
  LOWER: scalar(([x]) => text(x ?? "").toLowerCase()),
  PROPER: scalar(([x]) =>
    text(x ?? "")
      .toLowerCase()
      .replace(
        /(^|[^\p{L}])(\p{L})/gu,
        (_, before: string, letter: string) => before + letter.toUpperCase(),
      ),
  ),
  TRIM: scalar(([x]) =>
    text(x ?? "")
      .replace(/ +/g, " ")
      .replace(/^ | $/g, ""),
  ),
  // biome-ignore lint/suspicious/noControlCharactersInRegex: CLEAN removes exactly the first 32 ASCII codes
  CLEAN: scalar(([x]) => text(x ?? "").replace(/[\x00-\x1f]/g, "")),
  REPT: scalar((items) => {
    const s = text(arg(items, 0, ""));
    const n = int(arg(items, 1, null));
    if (n < 0 || s.length * n > 32767) return VALUE;
    return s.repeat(n);
  }),
  EXACT: scalar((items) => text(arg(items, 0, "")) === text(arg(items, 1, ""))),
  CHAR: elementwise((args, ctx) => pageOf(ctx).CHAR(args, ctx)),
  CODE: elementwise((args, ctx) => pageOf(ctx).CODE(args, ctx)),
  UNICHAR: scalar(([x]) => {
    const n = int(x ?? null);
    if (n < 1 || n > 0x10ffff) return VALUE;
    return String.fromCodePoint(n);
  }),
  UNICODE: scalar(([x]) => {
    const s = text(x ?? "");
    if (!s) return VALUE;
    return s.codePointAt(0)!;
  }),
  FIND: scalar((items) => find(items, true)),
  FINDB: scalar((items) => find(items, true)),
  SEARCH: scalar((items) => find(items, false)),
  SEARCHB: scalar((items) => find(items, false)),
  SUBSTITUTE: scalar((items) => {
    const s = text(arg(items, 0, ""));
    const from = text(arg(items, 1, ""));
    const to = text(arg(items, 2, ""));
    if (!from) return s;
    if (items[3] === undefined) return s.split(from).join(to);
    if (typeof items[3] === "boolean") return VALUE;
    const instance = int(items[3]);
    if (instance < 1) return VALUE;
    let at = -1;
    for (let i = 0; i < instance; i++) {
      at = s.indexOf(from, at + 1);
      if (at < 0) return s;
    }
    return s.slice(0, at) + to + s.slice(at + from.length);
  }),
  REPLACE: scalar((items) => {
    const s = text(arg(items, 0, ""));
    const start = int(arg(items, 1, null));
    const n = int(arg(items, 2, null));
    const insert = text(arg(items, 3, ""));
    if (start < 1 || n < 0) return VALUE;
    return s.slice(0, start - 1) + insert + s.slice(start - 1 + n);
  }),
  CONCATENATE: scalar((items) => {
    let out = "";
    for (const item of items) {
      if (item instanceof XlError) return item;
      out += text(item ?? "");
    }
    return out;
  }),
  CONCAT: (args, ctx) => {
    let out = "";
    for (const a of args) {
      if (a.k === "missing") continue;
      for (const item of flat(evaluate(a, ctx), ctx)) {
        if (item instanceof XlError) return item;
        out += text(item);
      }
    }
    return out.length > 32767 ? VALUE : out;
  },
  TEXTJOIN: (args, ctx) => {
    const delimiter = text(check(ctx.engine.toScalar(evaluate(args[0]!, ctx), ctx)));
    const ignoreEmpty = bool(check(ctx.engine.toScalar(evaluate(args[1]!, ctx), ctx)));
    const parts: string[] = [];
    for (const a of args.slice(2)) {
      if (a.k === "missing") {
        if (!ignoreEmpty) parts.push("");
        continue;
      }
      for (const item of flat(evaluate(a, ctx), ctx)) {
        if (item instanceof XlError) return item;
        const s = text(item);
        if (ignoreEmpty && s === "") continue;
        parts.push(s);
      }
    }
    const out = parts.join(delimiter);
    return out.length > 32767 ? VALUE : out;
  },
  VALUE: scalar(([x]) => {
    if (x instanceof XlError) return x;
    if (typeof x === "number") return x;
    if (x === null || x === undefined) return 0;
    if (typeof x === "boolean") return VALUE;
    const parsed = parseNumber(x);
    return parsed === null ? VALUE : parsed;
  }),
  NUMBERVALUE: scalar((items) => {
    const value = arg(items, 0, "");
    if (value instanceof XlError) return value;
    if (typeof value === "number") return value;
    // An omitted separator is the usual one, unless the other argument already took it.
    const given = (index: number) =>
      items[index] === undefined ? undefined : (text(items[index]!)[0] ?? "");
    let decimal = given(1);
    let group = given(2);
    decimal ??= group === "." ? "," : ".";
    group ??= decimal === "," ? "." : ",";
    if (!decimal || !group || decimal === group) return VALUE;
    return numberValue(text(value), decimal, group);
  }),
  TEXT: scalar((items) => {
    const value = arg(items, 0, null);
    if (value instanceof XlError) return value;
    const format = text(arg(items, 1, ""));
    let subject: Scalar = value;
    if (typeof value === "string") {
      const parsed = parseNumber(value);
      if (parsed !== null) subject = parsed;
    }
    if (subject === null) subject = 0;
    const formatted = formatValue(subject, format);
    return formatted.invalid ? VALUE : formatted.text;
  }),
  FIXED: scalarOpt((items) => {
    const value = num(arg(items, 0, null));
    const decimals = items[1] === undefined ? 2 : num(items[1]);
    const noCommas = items[2] === undefined ? false : bool(items[2]);
    if (decimals > 127) return VALUE;
    return fixed(value, decimals, noCommas);
  }),
  DOLLAR: scalar((items) => {
    const value = num(arg(items, 0, null));
    const decimals = items[1] === undefined ? 2 : Math.trunc(num(items[1]!));
    const rounded = roundDecimal(value, decimals, "half");
    const body = `$#,##0${decimals > 0 ? `.${"0".repeat(decimals)}` : ""}`;
    return formatValue(rounded, `${body};(${body})`).text;
  }),
  TEXTBEFORE: textAround(true),
  TEXTAFTER: textAround(false),
  VALUETOTEXT: scalar((items) => {
    const value = arg(items, 0, null);
    const strict = textFormat(items[1]);
    if (value instanceof XlError) return value.code;
    if (typeof value === "string") return strict === 1 ? `"${value.replace(/"/g, '""')}"` : value;
    return check(toText(value));
  }),
  ARRAYTOTEXT: (args, ctx) => {
    const value = evaluate(args[0]!, ctx);
    const strict = textFormat(
      args[1] && args[1].k !== "missing"
        ? check(ctx.engine.toScalar(evaluate(args[1], ctx), ctx))
        : null,
    );
    const matrix = ctx.engine.toMatrix(value, ctx);
    // "{}" is not an array Excel can write, so a lone empty cell has no strict form.
    if (strict === 1 && matrix.rows * matrix.cols === 1 && matrix.data[0] === null) return VALUE;
    const show = (item: Scalar) =>
      item instanceof XlError
        ? item.code
        : typeof item === "string"
          ? strict === 1
            ? `"${item.replace(/"/g, '""')}"`
            : item
          : check(toText(item));
    if (strict !== 1) return matrix.data.map(show).join(", ");
    const rows: string[] = [];
    for (let r = 0; r < matrix.rows; r++) {
      const row: string[] = [];
      for (let c = 0; c < matrix.cols; c++) row.push(show(matrix.get(r, c)));
      rows.push(row.join(","));
    }
    return `{${rows.join(";")}}`;
  },
  ARABIC: scalar(([x]) => {
    const s = text(x ?? "").trim();
    if (s.length > 255) return VALUE;
    const negative = s.startsWith("-");
    // Excel reads loosely: each numeral adds, or subtracts while a larger one follows it.
    let total = 0;
    let previous = 0;
    let adding = true;
    for (const ch of [...(negative ? s.slice(1) : s).toUpperCase()].reverse()) {
      const value = ROMAN[ch];
      if (!value) return VALUE;
      if (value !== previous) adding = value > previous;
      previous = value;
      total += adding ? value : -value;
    }
    return negative ? -total : total;
  }),
  DECIMAL: scalar((items) => {
    const s = text(arg(items, 0, "")).trim();
    const radix = int(arg(items, 1, null));
    if (s.length > 255) return VALUE;
    if (radix < 2 || radix > 36) return NUM;
    let value = 0;
    for (const ch of s.toUpperCase()) {
      const digit = parseInt(ch, 36);
      if (Number.isNaN(digit) || digit >= radix) return NUM;
      value = value * radix + digit;
    }
    return Number.isFinite(value) ? value : NUM;
  }),
  ASC: scalar(([x]) => halfWidth(text(x ?? ""))),
  BAHTTEXT: scalar(([x]) => bahtText(num(x ?? null))),
  REGEXTEST: scalar((items) => regex(items, 1, 2).test(text(arg(items, 0, "")))),
  REGEXEXTRACT: (args, ctx) => {
    const values = args.map((a) => (a.k === "missing" ? null : evaluate(a, ctx)));
    const results: Matrix[] = [];
    const lifted = ctx.engine.liftN(values, ctx, (items) => {
      try {
        const result = regexExtract(items);
        if (result instanceof Matrix) {
          results.push(result);
          return result.get(0, 0);
        }
        return result;
      } catch (error) {
        if (error instanceof XlError) return error;
        throw error;
      }
    });
    // One subject spills all its matches; across an array each cell keeps its first.
    return !(lifted instanceof Matrix) && results.length === 1 ? results[0]! : lifted;
  },
  REGEXREPLACE: scalar((items) => {
    const subject = text(arg(items, 0, ""));
    const re = regex(items, 1, 4, "g");
    const replacement = text(arg(items, 2, ""));
    const occurrence = items[3] === undefined || items[3] === null ? 0 : int(items[3]);
    const matches = [...subject.matchAll(re)];
    const chosen =
      occurrence === 0
        ? matches
        : [matches[occurrence > 0 ? occurrence - 1 : matches.length + occurrence]].filter(Boolean);
    let out = "";
    let last = 0;
    for (const match of chosen as RegExpExecArray[]) {
      out += subject.slice(last, match.index) + substitute(replacement, match);
      last = match.index + match[0].length;
    }
    return out + subject.slice(last);
  }),
};

// In a single-byte language the byte functions count characters, as test.xlsx's LENB("山田太郎ciao") = 8 shows.
for (const name of ["LEFT", "LEN", "MID", "RIGHT", "REPLACE"])
  TEXT_FNS[`${name}B`] = TEXT_FNS[name]!;

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

/** ASC: full-width ASCII, ideographic space and katakana to their half-width forms. */
function halfWidth(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xff01 && code <= 0xff5e) out += String.fromCharCode(code - 0xfee0);
    else if (code === 0x3000) out += " ";
    else if (HALF_KANA.has(ch)) out += HALF_KANA.get(ch);
    else {
      const [base, mark] = ch.normalize("NFD");
      const half = base && HALF_KANA.get(base);
      out +=
        half && (mark === "\u3099" || mark === "\u309a")
          ? half + (mark === "\u3099" ? "\uff9e" : "\uff9f")
          : ch;
    }
  }
  return out;
}

const HALF_KANA = new Map<string, string>();
for (let code = 0xff61; code <= 0xff9f; code++) {
  const half = String.fromCharCode(code);
  HALF_KANA.set(half.normalize("NFKC"), half);
}
HALF_KANA.set("\u309b", "\uff9e");
HALF_KANA.set("\u309c", "\uff9f");

const THAI_DIGITS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];

/** Thai words for 1–999999: สิบ alone for ten, ยี่สิบ for twenty, เอ็ด for a final one after higher digits. */
function thaiBlock(value: number): string {
  let out = "";
  const units: Array<[number, string]> = [
    [100000, "แสน"],
    [10000, "หมื่น"],
    [1000, "พัน"],
    [100, "ร้อย"],
  ];
  for (const [unit, word] of units) {
    if (value >= unit) {
      out += THAI_DIGITS[Math.floor(value / unit)]! + word;
      value %= unit;
    }
  }
  if (value >= 10) {
    const tens = Math.floor(value / 10);
    out += `${tens === 2 ? "ยี่" : tens === 1 ? "" : THAI_DIGITS[tens]!}สิบ`;
    value %= 10;
  }
  if (value === 1 && out) out += "เอ็ด";
  else if (value > 0) out += THAI_DIGITS[value]!;
  return out;
}

/** BAHTTEXT: the amount in Thai words, baht in blocks of a million (ล้าน), then satang or ถ้วน. */
function bahtText(value: number): string {
  const satangTotal = Math.round(Math.abs(roundDecimal(value, 2, "half")) * 100);
  const satang = satangTotal % 100;
  let baht = Math.round((satangTotal - satang) / 100);
  let out = "";
  if (baht === 0 && satang === 0) out = THAI_DIGITS[0]!;
  while (baht > 0) {
    const block = baht % 1e6;
    baht = Math.round((baht - block) / 1e6);
    out = (baht > 0 ? "ล้าน" : "") + (block ? thaiBlock(block) : "") + out;
  }
  if (out) out += "บาท";
  out += satang ? `${thaiBlock(satang)}สตางค์` : "ถ้วน";
  return value < 0 && satangTotal ? `ลบ${out}` : out;
}

/** REGEXEXTRACT: the first match (mode 0), every match (1) or the first match's groups (2), across a row. */
function regexExtract(items: Scalar[]): Scalar | Matrix {
  const subject = text(arg(items, 0, ""));
  const mode = items[2] === undefined || items[2] === null ? 0 : int(items[2]);
  if (mode < 0 || mode > 2) return VALUE;
  const re = regex(items, 1, 3, "g");
  const matches = [...subject.matchAll(re)];
  if (!matches.length) return NA;
  if (mode === 0) return matches[0]![0];
  if (mode === 1)
    return new Matrix(
      1,
      matches.length,
      matches.map((m) => m[0]),
    );
  const groups = matches[0]!.slice(1);
  if (!groups.length) return VALUE;
  return new Matrix(
    1,
    groups.length,
    groups.map((g) => g ?? NA),
  );
}

/** The pattern argument at `index` as a JS RegExp, case-insensitive when the argument at `caseIndex` is 1. */
function regex(items: Scalar[], index: number, caseIndex: number, flags = ""): RegExp {
  const pattern = text(arg(items, index, ""));
  const sensitivity =
    items[caseIndex] === undefined || items[caseIndex] === null ? 0 : int(items[caseIndex]!);
  if (sensitivity !== 0 && sensitivity !== 1) throw VALUE;
  const translated = pcre(pattern);
  try {
    return new RegExp(
      translated.source,
      `${flags}u${translated.flags}${sensitivity ? "i" : ""}`.replace(/(.)(?=.*\1)/g, ""),
    );
  } catch {
    throw VALUE;
  }
}

/** PCRE2 replacement text: $n, ${n}, ${name} and $$; any other $ is literal. */
function substitute(replacement: string, match: RegExpExecArray): string {
  return replacement.replace(
    /\$(?:\$|(\d+)|\{(\w+)\})/g,
    (whole, number?: string, braced?: string) => {
      if (whole === "$$") return "$";
      const key = number ?? braced!;
      const value = /^\d+$/.test(key) ? match[Number(key)] : match.groups?.[key];
      return value ?? "";
    },
  );
}

const POSIX: Record<string, string> = {
  alpha: "a-zA-Z",
  digit: "0-9",
  alnum: "a-zA-Z0-9",
  upper: "A-Z",
  lower: "a-z",
  space: "\\t\\n\\v\\f\\r ",
  blank: " \\t",
  xdigit: "0-9A-Fa-f",
  word: "\\w",
  cntrl: "\\x00-\\x1f\\x7f",
  print: "\\x20-\\x7e",
  graph: "\\x21-\\x7e",
  punct: "!-\\/:-@\\[-`{-~",
  ascii: "\\x00-\\x7f",
};
const HORIZONTAL = "\\t \\xa0\\u1680\\u180e\\u2000-\\u200a\\u202f\\u205f\\u3000";
const VERTICAL = "\\n\\v\\f\\r\\x85\\u2028\\u2029";

/**
 * A PCRE2 pattern (what Excel's REGEX functions use) rewritten for a JS "u" RegExp: PCRE-only
 * escapes (\A \z \Z \h \v \R \N \Q…\E \x{…} \e), POSIX classes, other group-name spellings,
 * $ before a final newline, . not matching only \n, and leading (?imsx-like) flags. Constructs JS
 * cannot express (possessive quantifiers, atomic groups, \K, \G, recursion, conditionals, verbs,
 * flags after the start) make the pattern unusable, which the functions report as #VALUE!.
 */
function pcre(pattern: string): { source: string; flags: string } {
  let flags = "";
  let i = 0;
  const lead = /^\(\?([imsn]+)\)/.exec(pattern);
  if (lead) {
    flags = lead[1]!.replace("n", "");
    i = lead[0].length;
  }
  const dotAll = flags.includes("s");
  const multiline = flags.includes("m");
  let out = "";
  let inClass = false;
  let classStart = false;
  let quantified = false;
  const unsupported = () => {
    throw VALUE;
  };
  const escapeLiteral = (ch: string) =>
    /[\^$\\.*+?()[\]{}|/]/.test(ch) || (inClass && ch === "-") ? `\\${ch}` : ch;
  for (; i < pattern.length; i++) {
    const ch = pattern[i]!;
    const afterQuantifier: boolean = quantified;
    quantified = false;
    if (ch === "\\") {
      const next = pattern[i + 1];
      if (next === undefined) unsupported();
      i++;
      if (next === "Q") {
        const end = pattern.indexOf("\\E", i + 1);
        const literal = pattern.slice(i + 1, end < 0 ? pattern.length : end);
        out += [...literal].map(escapeLiteral).join("");
        i = end < 0 ? pattern.length : end + 1;
        continue;
      }
      if (next === "E") continue;
      if (next === "x" && pattern[i + 1] === "{") {
        const end = pattern.indexOf("}", i);
        out += `\\u{${pattern.slice(i + 2, end)}}`;
        i = end;
        continue;
      }
      if (next === "o" && pattern[i + 1] === "{") {
        const end = pattern.indexOf("}", i);
        out += `\\u{${parseInt(pattern.slice(i + 2, end), 8).toString(16)}}`;
        i = end;
        continue;
      }
      if (inClass) {
        if (next === "h") out += HORIZONTAL;
        else if (next === "v") out += VERTICAL;
        else if (next === "e") out += "\\x1b";
        else if (next === "a") out += "\\x07";
        else if (/[dDwWsStnrfbpPuxc0-7]/.test(next!)) out += `\\${next}`;
        else if (/[A-Za-z]/.test(next!)) unsupported();
        else out += escapeLiteral(next!);
        continue;
      }
      if (next === "A") out += "^";
      else if (next === "z") out += "$";
      else if (next === "Z") out += "(?=\\n?$)";
      else if (next === "h") out += `[${HORIZONTAL}]`;
      else if (next === "H") out += `[^${HORIZONTAL}]`;
      else if (next === "v") out += `[${VERTICAL}]`;
      else if (next === "V") out += `[^${VERTICAL}]`;
      else if (next === "R") out += `(?:\\r\\n|[${VERTICAL}])`;
      else if (next === "N") out += "[^\\n]";
      else if (next === "e") out += "\\x1b";
      else if (next === "a") out += "\\x07";
      else if (next === "g" || next === "k") {
        const ref = /^[gk](?:\{(-?\w+)\}|<(\w+)>|'(\w+)'|(-?\d+))/.exec(pattern.slice(i));
        if (!ref) unsupported();
        const name = ref![1] ?? ref![2] ?? ref![3] ?? ref![4]!;
        if (name.startsWith("-")) {
          const opened = (out.match(/\((?!\?[:=!]|\?<[=!])/g) ?? []).length;
          out += `\\${opened + 1 + Number(name)}`;
        } else out += /^\d+$/.test(name) ? `\\${name}` : `\\k<${name}>`;
        i += ref![0].length - 1;
      } else if (/[KGXCLlUu]/.test(next!)) unsupported();
      else if (/[A-Za-z0-9]/.test(next!)) out += `\\${next}`;
      else out += escapeLiteral(next!);
      continue;
    }
    if (inClass) {
      if (ch === "]" && !classStart) inClass = false;
      if (ch === "[" && pattern[i + 1] === ":") {
        const end = pattern.indexOf(":]", i + 2);
        const name = end < 0 ? "" : pattern.slice(i + 2, end);
        if (!POSIX[name]) unsupported();
        out += POSIX[name];
        i = end + 1;
        classStart = false;
        continue;
      }
      out += ch === "]" && classStart ? "\\]" : ch === "[" ? "\\[" : ch;
      if (!(ch === "^" && classStart && out.endsWith("[^"))) classStart = false;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      classStart = true;
      out += "[";
      if (pattern[i + 1] === "^") {
        out += "^";
        i++;
      }
      continue;
    }
    if (ch === "(") {
      const rest = pattern.slice(i);
      const named = /^\((?:\?P?<(\w+)>|\?'(\w+)')/.exec(rest);
      const comment = /^\(\?#[^)]*\)/.exec(rest);
      if (comment) {
        i += comment[0].length - 1;
        continue;
      }
      if (named) {
        out += `(?<${named[1] ?? named[2]}>`;
        i += named[0].length - 1;
        continue;
      }
      const backref = /^\(\?P=(\w+)\)/.exec(rest);
      if (backref) {
        out += `\\k<${backref[1]}>`;
        i += backref[0].length - 1;
        continue;
      }
      if (rest[1] === "?" && !/^\(\?(?::|=|!|<=|<!)/.test(rest)) unsupported();
      if (rest[1] === "*") unsupported();
      out += "(";
      continue;
    }
    if (ch === "*" || ch === "+" || ch === "?") {
      // A + after a quantifier makes it possessive, which JS has no form for; ? makes it lazy.
      if (afterQuantifier && ch === "+") unsupported();
      out += ch;
      quantified = !afterQuantifier;
      continue;
    }
    if (ch === "{") {
      const quantifier = /^\{\d+(?:,\d*)?\}/.exec(pattern.slice(i));
      if (quantifier) {
        out += quantifier[0];
        i += quantifier[0].length - 1;
        quantified = true;
      } else out += "\\{";
      continue;
    }
    if (ch === "}" || ch === "]") out += `\\${ch}`;
    else if (ch === ".") out += dotAll ? "[\\s\\S]" : "[^\\n]";
    else if (ch === "$") out += multiline ? "(?=\\n|$)" : "(?=\\n?$)";
    else if (ch === "^") out += multiline ? "(?<=^|\\n)" : "^";
    else if (ch === "/") out += "\\/";
    else out += ch;
  }
  if (inClass) unsupported();
  return { source: out, flags: flags.includes("i") ? "i" : "" };
}

function find(items: Scalar[], caseSensitive: boolean): Scalar {
  const needle = text(arg(items, 0, ""));
  const haystack = text(arg(items, 1, ""));
  const start = items[2] === undefined ? 1 : int(items[2]!);
  if (start < 1 || start > haystack.length + 1) return VALUE;
  if (caseSensitive) {
    const at = haystack.indexOf(needle, start - 1);
    return at < 0 ? VALUE : at + 1;
  }
  if (!needle) return start;
  if (hasWildcard(needle) || needle.includes("~")) {
    const source = wildcard(needle).source.slice(1, -1);
    const re = new RegExp(source, "i");
    const match = re.exec(haystack.slice(start - 1));
    return match ? match.index + start : VALUE;
  }
  const at = haystack.toLowerCase().indexOf(needle.toLowerCase(), start - 1);
  return at < 0 ? VALUE : at + 1;
}

/** VALUETOTEXT/ARRAYTOTEXT's format: 0 concise or 1 strict, anything else #VALUE!. */
function textFormat(value: Scalar | undefined): 0 | 1 {
  if (value === undefined || value === null) return 0;
  const n = Math.trunc(num(value));
  if (n !== 0 && n !== 1) throw VALUE;
  return n;
}

/**
 * TEXTBEFORE and TEXTAFTER. The delimiter may be an array (any of them counts); the other
 * arguments apply cell by cell. Matches do not overlap, counted from the end for a negative
 * instance, and match_end lets the end (or, counting back, the start) of the text count as one.
 */
function textAround(before: boolean): Fn {
  return elementwise((args, ctx) => {
    const delimiterArg = args[1];
    const delimiters: Scalar[] =
      !delimiterArg || delimiterArg.k === "missing"
        ? [""]
        : flat(ctx.engine.toMatrix(evaluate(delimiterArg, ctx), ctx), ctx);
    const values = args.map((a, i) =>
      i === 1 || a.k === "missing" ? undefined : evaluate(a, ctx),
    );
    return ctx.engine.liftN(values as Value[], ctx, (items) => {
      try {
        return around(items as Array<Scalar | undefined>, delimiters.map(text), before);
      } catch (error) {
        if (error instanceof XlError) return error;
        throw error;
      }
    });
  });
}

function around(items: Array<Scalar | undefined>, delimiters: string[], before: boolean): Scalar {
  const s = text(items[0] ?? "");
  const instance = items[2] === undefined ? 1 : int(items[2]);
  const mode = items[3] === undefined ? 0 : int(items[3]);
  const matchEnd = items[4] === undefined ? false : bool(items[4]);
  if (mode !== 0 && mode !== 1) return VALUE;
  if (instance === 0 || Math.abs(instance) > s.length) return VALUE;
  const fold = (x: string) => (mode === 1 ? x.toLowerCase() : x);
  const hay = fold(s);
  const needles = delimiters.map(fold);
  let found: [number, number] | null = null;
  if (instance > 0) {
    let from = 0;
    for (let n = 0; n < instance; n++) {
      found = null;
      for (const needle of needles) {
        const at = hay.indexOf(needle, from);
        if (at >= 0 && (!found || at < found[0] || (at === found[0] && needle.length > found[1])))
          found = [at, needle.length];
      }
      if (!found) {
        found = matchEnd && n === instance - 1 && from <= s.length ? [s.length, 0] : null;
        break;
      }
      from = found[0] + Math.max(found[1], 1);
    }
  } else {
    let to = s.length;
    for (let n = 0; n < -instance; n++) {
      found = null;
      for (const needle of needles) {
        if (needle.length > to) continue;
        const at = hay.lastIndexOf(needle, to - needle.length);
        if (at >= 0 && (!found || at > found[0] || (at === found[0] && needle.length > found[1])))
          found = [at, needle.length];
      }
      if (!found) {
        found = matchEnd && n === -instance - 1 ? [0, 0] : null;
        break;
      }
      to = found[0] - (found[1] ? 0 : 1);
    }
  }
  if (!found) return items[5] === undefined ? NA : items[5];
  return before ? s.slice(0, found[0]) : s.slice(found[0] + found[1]);
}

/** NUMBERVALUE's reading: spaces ignored, group marks only before the decimal mark, then % and brackets. */
function numberValue(input: string, decimal: string, group: string): Scalar {
  let s = input.replace(/\s/g, "");
  if (!s) return 0;
  let percent = 0;
  const percents = () => {
    while (s.endsWith("%")) {
      percent++;
      s = s.slice(0, -1);
    }
  };
  let negative = false;
  percents();
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
    percents();
  } else if (s[0] === "-" || s[0] === "+") {
    negative = s[0] === "-";
    s = s.slice(1);
  }
  let whole = "";
  let fraction = "";
  let pointSeen = false;
  let i = 0;
  for (; i < s.length; i++) {
    const ch = s[i]!;
    if (ch >= "0" && ch <= "9") {
      if (pointSeen) fraction += ch;
      else whole += ch;
    } else if (ch === decimal && !pointSeen) pointSeen = true;
    else if (ch !== group || pointSeen) break;
  }
  if (!whole && !fraction) return VALUE;
  const exponent = /^(?:[eE]([-+]?\d+))?$/.exec(s.slice(i));
  if (!exponent) return VALUE;
  const value = Number(`${whole || "0"}.${fraction || "0"}e${exponent[1] ?? 0}`) / 100 ** percent;
  if (!Number.isFinite(value)) return NUM;
  return negative ? -value : value;
}

/** Like scalar(), but an argument left empty (=F(a,,b)) arrives as undefined, as if omitted. */
function scalarOpt(impl: (items: Array<Scalar | undefined>) => Scalar): Fn {
  return elementwise((args, ctx) => {
    const values = args.map((a) => (a.k === "missing" ? undefined : evaluate(a, ctx)));
    return ctx.engine.liftN(values as Value[], ctx, (items) => {
      try {
        return impl(items);
      } catch (error) {
        if (error instanceof XlError) return error;
        throw error;
      }
    });
  });
}
