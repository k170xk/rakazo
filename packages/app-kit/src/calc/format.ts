import type { Scalar } from "./values.js";
import { dateFromSerial, numberToText, XlError } from "./values.js";

/**
 * Excel number formats ("0.00", "#,##0", "0%", "d-mmm-yy", "[h]:mm", "# ?/?", "€#,##0;[Red]-€#,##0")
 * applied to a value, giving the text Excel shows in a cell and the text TEXT() returns. Colours
 * come back separately so a screen can paint them.
 */

/** `invalid` marks a format Excel rejects, where TEXT() gives #VALUE!. */
export type Formatted = { text: string; color?: string; invalid?: true };

const INVALID: Formatted = { text: "#VALUE!", invalid: true };

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Excel's built-in format ids, for workbooks that refer to them by number. */
export const BUILTIN_FORMATS: Record<number, string> = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  12: "# ?/?",
  13: "# ??/??",
  14: "m/d/yyyy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yyyy h:mm",
  37: "#,##0 ;(#,##0)",
  38: "#,##0 ;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mmss.0",
  48: "##0.0E+0",
  49: "@",
};

type Section = { body: string; condition?: { op: string; value: number }; color?: string };

const cache = new Map<string, Section[]>();

function splitSections(format: string): Section[] {
  const cached = cache.get(format);
  if (cached) return cached;
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < format.length; i++) {
    const ch = format[i]!;
    if (ch === '"') {
      const end = format.indexOf('"', i + 1);
      const stop = end < 0 ? format.length : end;
      current += format.slice(i, stop + 1);
      i = stop;
    } else if (ch === "\\" || ch === "_" || ch === "*") {
      current += format.slice(i, i + 2);
      i++;
    } else if (ch === "[") {
      const end = format.indexOf("]", i);
      const stop = end < 0 ? format.length : end;
      current += format.slice(i, stop + 1);
      i = stop;
    } else if (ch === ";") {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  const sections = parts.map((part) => {
    const section: Section = { body: part };
    section.body = part.replace(/\[([^\]]*)\]/g, (whole, inner: string) => {
      const condition = /^(<=|>=|<>|<|>|=)\s*(-?[\d.]+(?:E[-+]?\d+)?)$/i.exec(inner);
      if (condition) {
        section.condition = { op: condition[1]!, value: Number(condition[2]) };
        return "";
      }
      if (/^(black|white|red|green|blue|yellow|magenta|cyan|color\s*\d+)$/i.test(inner)) {
        section.color = inner.toLowerCase();
        return "";
      }
      if (inner.startsWith("$")) {
        const symbol = inner.slice(1).split("-")[0] ?? "";
        return symbol ? `"${symbol}"` : "";
      }
      if (/^[hms]+$/i.test(inner)) return whole;
      return "";
    });
    return section;
  });
  cache.set(format, sections);
  return sections;
}

function test(op: string, value: number, against: number): boolean {
  switch (op) {
    case "<":
      return value < against;
    case "<=":
      return value <= against;
    case ">":
      return value > against;
    case ">=":
      return value >= against;
    case "=":
      return value === against;
    case "<>":
      return value !== against;
  }
  return false;
}

const isDateFormat = (body: string) => {
  const stripped = body.replace(/"[^"]*"|\\.|_.|\*./g, "");
  return (
    /[dyhs]|\[[hms]+\]|AM\/PM|A\/P/i.test(stripped) ||
    (/m/i.test(stripped) && !/[0#?]/.test(stripped))
  );
};

/** General: up to 11 characters wide, the way a default-width cell shows a number. */
function general(value: number): string {
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e11 || abs < 1e-9) {
    let text = value.toExponential(5).replace(/\.?0+e/, "e");
    text = text.replace(/e([+-])(\d)$/, "e$10$2");
    return text.toUpperCase();
  }
  const digits = Math.max(0, 10 - Math.max(0, Math.floor(Math.log10(abs))));
  const rounded = Number(value.toFixed(Math.min(digits, 10)));
  const text = numberToText(rounded);
  return text.length > 11 + (value < 0 ? 1 : 0)
    ? numberToText(Number(value.toPrecision(10)))
    : text;
}

export function formatValue(value: Scalar, format = "General"): Formatted {
  if (value === null) return { text: "" };
  if (value instanceof XlError) return { text: value.code };
  if (typeof value === "boolean") return { text: value ? "TRUE" : "FALSE" };
  if (!quotesClosed(format)) return INVALID;
  const sections = splitSections(format || "General");
  if (typeof value === "string") {
    const textSection =
      sections[3] ??
      (sections.length === 1 && sections[0]!.body.includes("@") ? sections[0] : undefined);
    if (!textSection) return { text: value };
    return { text: literal(textSection.body, value), color: textSection.color };
  }
  let section = sections[0]!;
  let number = value;
  let signed = true;
  const conditional = sections.some((s) => s.condition);
  if (conditional) {
    const match = sections.find((s, i) =>
      s.condition
        ? test(s.condition.op, value, s.condition.value)
        : i === sections.findIndex((x) => !x.condition),
    );
    section = match ?? sections[sections.length - 1]!;
    signed = !section.condition || section.condition.value >= 0 || value >= 0;
    if (section.condition && value < 0) number = Math.abs(value);
  } else if (value < 0 && sections.length >= 2 && sections[1]!.body !== "") {
    section = sections[1]!;
    number = -value;
    signed = false;
  } else if (value === 0 && sections.length >= 3) {
    section = sections[2]!;
  }
  if (!conditional && value < 0 && sections.length >= 2) signed = false;
  const body = section.body;
  if (/^\s*general\s*$/i.test(body) || body.trim() === "") {
    if (body.trim() === "" && sections.length > 1) return { text: "", color: section.color };
    return { text: general(signed ? number : Math.abs(number)), color: section.color };
  }
  if (isDateFormat(body)) return { text: formatDate(number, body), color: section.color };
  let text = formatNumber(number, body);
  if (text === null) return INVALID;
  if (signed && number < 0 && !text.startsWith("-")) text = `-${text.replace(/^-/, "")}`;
  return { text, color: section.color };
}

function quotesClosed(format: string): boolean {
  for (let i = 0; i < format.length; i++) {
    const ch = format[i];
    if (ch === "\\" || ch === "_" || ch === "*") i++;
    else if (ch === '"') {
      const end = format.indexOf('"', i + 1);
      if (end < 0) return false;
      i = end;
    }
  }
  return true;
}

/** A section's literal text around '@' for text values. */
function literal(body: string, value: string): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === "@") out += value;
    else if (ch === '"') {
      const end = body.indexOf('"', i + 1);
      out += body.slice(i + 1, end < 0 ? body.length : end);
      i = end < 0 ? body.length : end;
    } else if (ch === "\\") out += body[++i] ?? "";
    else if (ch === "_") {
      out += " ";
      i++;
    } else if (ch === "*") i++;
    else out += ch;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Numbers

type Token = { kind: "ph" | "lit" | "dot" | "comma" | "pct" | "exp" | "slash"; text: string };

/** A number section's tokens, or null when Excel rejects the format (TEXT gives #VALUE!). */
function numberTokens(body: string, value: number): Token[] | null {
  const tokens: Token[] = [];
  let seenDot = false;
  let seenExp = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    const prev = tokens[tokens.length - 1];
    if (ch === '"') {
      const end = body.indexOf('"', i + 1);
      if (end < 0) return null;
      tokens.push({ kind: "lit", text: body.slice(i + 1, end) });
      i = end;
    } else if (ch === "\\") tokens.push({ kind: "lit", text: body[++i] ?? "" });
    else if (ch === "_") {
      tokens.push({ kind: "lit", text: " " });
      i++;
    } else if (ch === "*") i++;
    else if (ch === "0" || ch === "#" || ch === "?") tokens.push({ kind: "ph", text: ch });
    else if (ch === ".") {
      if (seenExp) return null;
      // Only the first point is the decimal point; later ones are shown as typed.
      tokens.push({ kind: seenDot ? "lit" : "dot", text: "." });
      seenDot = true;
    } else if (ch === ",") {
      // A comma straight after a digit place groups thousands (or scales); anywhere else it is shown.
      tokens.push({
        kind: prev?.kind === "ph" || prev?.kind === "comma" ? "comma" : "lit",
        text: ",",
      });
    } else if (ch === "%") tokens.push({ kind: "pct", text: "%" });
    else if ((ch === "E" || ch === "e") && (body[i + 1] === "+" || body[i + 1] === "-")) {
      if (seenExp) return null;
      seenExp = true;
      tokens.push({ kind: "exp", text: body.slice(i, i + 2) });
      i++;
    } else if (ch === "/") tokens.push({ kind: "slash", text: "/" });
    else if (ch === "@") tokens.push({ kind: "lit", text: String(value) });
    else tokens.push({ kind: "lit", text: ch });
  }
  return tokens;
}

function formatNumber(value: number, body: string): string | null {
  const tokens = numberTokens(body, value);
  if (!tokens) return null;
  let scaled = value;
  for (const token of tokens) if (token.kind === "pct") scaled *= 100;
  const slash = tokens.findIndex((t) => t.kind === "slash");
  if (slash >= 0) return formatFraction(scaled, tokens, slash);
  const expAt = tokens.findIndex((t) => t.kind === "exp");
  const dotAt = tokens.findIndex((t) => t.kind === "dot");
  const mantissaEnd = expAt >= 0 ? expAt : tokens.length;
  const intTokens = tokens.slice(0, dotAt >= 0 && dotAt < mantissaEnd ? dotAt : mantissaEnd);
  const fracTokens = dotAt >= 0 && dotAt < mantissaEnd ? tokens.slice(dotAt + 1, mantissaEnd) : [];
  // Grouping commas have a digit place after them; trailing ones divide by 1000 each.
  let grouping = false;
  for (const list of [intTokens, fracTokens]) {
    list.forEach((t, i) => {
      if (t.kind !== "comma") return;
      if (list.slice(i + 1).some((x) => x.kind === "ph")) grouping ||= list === intTokens;
      else scaled /= 1000;
    });
  }
  const fracPh = fracTokens.filter((t) => t.kind === "ph").length;
  let exponentText = "";
  if (expAt >= 0) {
    const intPh = intTokens.filter((t) => t.kind === "ph").length || 1;
    let exponent = scaled === 0 ? 0 : Math.floor(Math.log10(Math.abs(scaled)));
    // Engineering style: the exponent is a multiple of the integer digit count when that is > 1.
    if (intPh > 1) exponent = Math.floor(exponent / intPh) * intPh;
    let mantissa = scaled / 10 ** exponent;
    const roundedMantissa = Number(mantissa.toFixed(fracPh));
    if (Math.abs(roundedMantissa) >= 10 ** intPh) {
      exponent += intPh;
      mantissa = scaled / 10 ** exponent;
    }
    scaled = mantissa;
    const expTokens = tokens.slice(expAt + 1);
    const expDigits = Math.max(
      1,
      expTokens.filter((t) => t.kind === "ph" && t.text === "0").length,
    );
    const sign = exponent < 0 ? "-" : tokens[expAt]!.text[1] === "+" ? "+" : "";
    exponentText = `${tokens[expAt]!.text[0]}${sign}${String(Math.abs(exponent)).padStart(expDigits, "0")}`;
    for (const t of expTokens) if (t.kind === "lit" || t.kind === "pct") exponentText += t.text;
  }
  const negative = scaled < 0;
  const [whole, fracDigits = ""] = roundHalfAway(Math.abs(scaled), fracPh).split(".") as [
    string,
    string?,
  ];
  const intDigits = whole === "0" ? "" : whole;
  // Fraction places: 0 always shows its digit, # and ? only up to the last significant digit
  // (? pads with a space).
  const lastSignificant = fracDigits.search(/0*$/) - 1;
  let frac = "";
  let fracIndex = 0;
  for (const token of fracTokens) {
    if (token.kind === "ph") {
      const digit = fracDigits[fracIndex] ?? "0";
      frac +=
        token.text === "0" || fracIndex <= lastSignificant ? digit : token.text === "?" ? " " : "";
      fracIndex++;
    } else if (token.kind === "lit" || token.kind === "pct") frac += token.text;
  }
  // Integer places, filled from the right: the first takes any extra digits, the rest one each.
  // Literals keep their places among the digits; grouping commas follow each digit worth 10^3k.
  const places = intTokens.filter((t) => t.kind === "ph").map((t) => t.text);
  const count = places.length;
  const len = intDigits.length;
  const mark = (place: number) => (grouping && place > 0 && place % 3 === 0 ? "," : "");
  const shown = places.map((ph, j) => {
    const place = count - 1 - j;
    if (j === 0 && len > count) {
      let run = "";
      for (let k = 0; k <= len - count; k++) run += intDigits[k]! + mark(len - 1 - k);
      return run;
    }
    if (place < len) return intDigits[len - 1 - place]! + mark(place);
    return ph === "0" ? `0${mark(place)}` : ph === "?" ? " " : "";
  });
  let intOut = "";
  let next = 0;
  for (const token of intTokens) {
    if (token.kind === "ph") intOut += shown[next++];
    else if (token.kind === "lit" || token.kind === "pct") intOut += token.text;
  }
  let out = intOut + (dotAt >= 0 && dotAt < mantissaEnd ? "." : "") + frac + exponentText;
  if (negative) out = `-${out}`;
  return out;
}

/** A non-negative number to `places` decimals, half away from zero on its 15-digit value. */
function roundHalfAway(value: number, places: number): string {
  const [mantissa, exp] = value.toExponential(14).split("e") as [string, string];
  const digits = mantissa.replace(".", "");
  const exponent = Number(exp);
  const keep = exponent + 1 + places;
  if (keep < 0) return places ? `0.${"0".repeat(places)}` : "0";
  let kept = BigInt(digits.slice(0, keep).padEnd(keep, "0") || "0");
  if (Number(digits[keep] ?? 0) >= 5) kept += 1n;
  let text = kept.toString();
  if (places === 0) return text;
  text = text.padStart(places + 1, "0");
  return `${text.slice(0, -places)}.${text.slice(-places)}`;
}

function formatFraction(
  value: number,
  tokens: Array<{ kind: string; text: string }>,
  slash: number,
): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const denominatorTokens = tokens
    .slice(slash + 1)
    .filter((t) => t.kind === "ph" || /\d/.test(t.text));
  const fixedDenominator = denominatorTokens.map((t) => t.text).join("");
  const before = tokens.slice(0, slash);
  // "# ?/?" has a whole-number part; "?/?" does not.
  const spaceAt = before.map((t) => t.text).lastIndexOf(" ");
  const hasWhole = spaceAt > 0 && before.slice(0, spaceAt).some((t) => t.kind === "ph");
  const whole = hasWhole ? Math.floor(abs) : 0;
  const frac = abs - whole;
  let numerator: number;
  let denominator: number;
  if (/^\d+$/.test(fixedDenominator)) {
    denominator = Number(fixedDenominator);
    numerator = Math.round(frac * denominator);
  } else {
    const maxDenominator = 10 ** Math.max(1, denominatorTokens.length) - 1;
    [numerator, denominator] = bestFraction(frac, maxDenominator);
  }
  const width = denominatorTokens.length;
  let wholeText = hasWhole ? String(whole) : "";
  if (numerator === denominator && hasWhole) {
    wholeText = String(whole + 1);
    numerator = 0;
  }
  const sign = negative ? "-" : "";
  if (numerator === 0) {
    if (hasWhole) return `${sign}${wholeText || "0"}${" ".repeat(width * 2 + 2)}`;
    return `${sign}0/${denominator}`;
  }
  const fraction = `${String(numerator).padStart(width, " ")}/${String(denominator).padEnd(width, " ")}`;
  return hasWhole
    ? `${sign}${whole === 0 ? "" : wholeText} ${fraction}`.replace(/^(-?) /, "$1")
    : `${sign}${fraction}`;
}

function bestFraction(x: number, maxDenominator: number): [number, number] {
  let best: [number, number] = [0, 1];
  let error = x;
  for (let d = 1; d <= maxDenominator; d++) {
    const n = Math.round(x * d);
    const e = Math.abs(x - n / d);
    if (e < error - 1e-15) {
      best = [n, d];
      error = e;
      if (e === 0) break;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Dates and times

function formatDate(serial: number, body: string): string {
  const day = dateFromSerial(serial);
  const timeOfDay = serial - Math.floor(serial);
  let totalSeconds = Math.round(timeOfDay * 86400 * 1000) / 1000;
  const hasAmPm = /AM\/PM|A\/P/i.test(body);
  const fractional = /s\.0+/i.exec(body);
  const fractionDigits = fractional ? fractional[0].length - 2 : 0;
  if (!fractionDigits) totalSeconds = Math.round(totalSeconds);
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const subsecond = totalSeconds - Math.floor(totalSeconds);
  const weekday = (((Math.floor(serial) + 6) % 7) + 7) % 7;
  const tokens: string[] = [];
  const re = /"[^"]*"|\\.|_.|\*.|\[h+\]|\[m+\]|\[s+\]|AM\/PM|A\/P|y+|m+|d+|h+|s+(?:\.0+)?|./gi;
  for (const match of body.matchAll(re)) tokens.push(match[0]);
  const out: string[] = [];
  const isMinute = (index: number) => {
    for (let j = index - 1; j >= 0; j--) {
      const t = tokens[j]!.toLowerCase();
      if (/^h+$|^\[h+\]$/.test(t)) return true;
      if (/^[dymsa]/.test(t) && !/^\s$/.test(t)) break;
    }
    for (let j = index + 1; j < tokens.length; j++) {
      const t = tokens[j]!.toLowerCase();
      if (/^s+/.test(t) || /^\[s+\]$/.test(t)) return true;
      if (/^[dymh]/.test(t)) break;
    }
    return false;
  };
  tokens.forEach((token, index) => {
    const lower = token.toLowerCase();
    if (token.startsWith('"')) out.push(token.slice(1, -1));
    else if (token.startsWith("\\")) out.push(token.slice(1));
    else if (token.startsWith("_")) out.push(" ");
    else if (token.startsWith("*")) out.push("");
    else if (/^\[h+\]$/.test(lower))
      out.push(String(Math.floor(serial * 24 + 1e-9)).padStart(lower.length - 2, "0"));
    else if (/^\[m+\]$/.test(lower))
      out.push(String(Math.floor(serial * 1440 + 1e-9)).padStart(lower.length - 2, "0"));
    else if (/^\[s+\]$/.test(lower))
      out.push(String(Math.round(serial * 86400)).padStart(lower.length - 2, "0"));
    else if (lower === "am/pm")
      out.push(hours < 12 ? (token[0] === "a" ? "am" : "AM") : token[0] === "a" ? "pm" : "PM");
    else if (lower === "a/p")
      out.push(hours < 12 ? (token[0] === "a" ? "a" : "A") : token[0] === "a" ? "p" : "P");
    else if (/^y+$/.test(lower))
      out.push(lower.length <= 2 ? String(day.year % 100).padStart(2, "0") : String(day.year));
    else if (/^m+$/.test(lower)) {
      if (lower.length <= 2 && isMinute(index))
        out.push(lower.length === 2 ? String(minutes).padStart(2, "0") : String(minutes));
      else if (lower.length === 1) out.push(String(day.month));
      else if (lower.length === 2) out.push(String(day.month).padStart(2, "0"));
      else if (lower.length === 3) out.push(MONTHS[day.month - 1]!.slice(0, 3));
      else if (lower.length === 5) out.push(MONTHS[day.month - 1]![0]!);
      else out.push(MONTHS[day.month - 1]!);
    } else if (/^d+$/.test(lower)) {
      if (lower.length === 1) out.push(String(day.day));
      else if (lower.length === 2) out.push(String(day.day).padStart(2, "0"));
      else if (lower.length === 3) out.push(DAYS[weekday]!.slice(0, 3));
      else out.push(DAYS[weekday]!);
    } else if (/^h+$/.test(lower)) {
      const h = hasAmPm ? hours % 12 || 12 : hours;
      out.push(lower.length >= 2 ? String(h).padStart(2, "0") : String(h));
    } else if (/^s+/.test(lower)) {
      const base = lower.split(".")[0]!;
      let text = base.length >= 2 ? String(seconds).padStart(2, "0") : String(seconds);
      if (fractionDigits) text += `.${subsecond.toFixed(fractionDigits).slice(2)}`;
      out.push(text);
    } else out.push(token);
  });
  return out.join("");
}
