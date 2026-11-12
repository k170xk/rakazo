/**
 * The shape of an app's data. Each app keeps rows in named tables; a table's columns say how a
 * value is shown, edited and checked, so the same schema drives imported spreadsheets, forms,
 * the Studio data grid and what the server accepts.
 */

export const COLUMN_TYPES = [
  "text",
  "longtext",
  "number",
  "currency",
  "percent",
  "date",
  "boolean",
  "enum",
  "email",
  "url",
  "person",
  "relation",
  "image",
] as const;

export type ColumnType = (typeof COLUMN_TYPES)[number];

/** How many pictures one image cell keeps; its value is their ids joined by commas. */
export const MAX_IMAGES_PER_CELL = 12;
const ASSET_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** The picture ids an image cell holds, in order. */
export function imageIds(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return list
    .map((item) => String(item).trim())
    .filter((item) => ASSET_ID.test(item))
    .slice(0, MAX_IMAGES_PER_CELL);
}

export type ColumnOption = { value: string; tone?: Tone };

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

export type Column = {
  key: string;
  label: string;
  type: ColumnType;
  /** enum: the allowed values, in order, each optionally with a tone for its badge. */
  options?: ColumnOption[];
  /** currency: ISO code, EUR by default. */
  currency?: string;
  /** relation: the table whose key this column holds. */
  relation?: string;
  /**
   * A value worked out from other columns of the same row, such as "qty * rate". Only column
   * keys, numbers, + - * / and parentheses are allowed; it is read only.
   */
  formula?: string;
  required?: boolean;
  /** Shown in lists and forms only when true or unset. */
  hidden?: boolean;
};

export type TableSchema = {
  name: string;
  label: string;
  /** The column whose value identifies a row (job number, reference); rows also have _id. */
  key?: string;
  /** The column used as a row's title. */
  title?: string;
  columns: Column[];
};

export type Row = { _id: string; _updatedAt?: string } & Record<string, unknown>;

export const TABLE_NAME = /^[a-z][a-z0-9_]{0,39}$/;
export const COLUMN_KEY = /^[a-z][a-z0-9_]{0,59}$/;
export const MAX_TABLES = 30;
export const MAX_COLUMNS = 120;
export const MAX_ROWS_PER_TABLE = 20_000;
export const MAX_ROW_BYTES = 32_000;

const FORMULA_TOKENS = /^\s*(?:[a-z][a-z0-9_]*|\d+(?:\.\d+)?|[-+*/()])\s*/;

/** Splits a formula into tokens, or null when it holds anything but keys, numbers and + - * / ( ). */
export function formulaTokens(formula: string): string[] | null {
  const tokens: string[] = [];
  let rest = formula;
  while (rest.trim()) {
    const match = FORMULA_TOKENS.exec(rest);
    if (!match) return null;
    tokens.push(match[0].trim());
    rest = rest.slice(match[0].length);
  }
  return tokens.length ? tokens : null;
}

/** Evaluates a formula over a row with a tiny recursive parser, never eval. */
export function evaluateFormula(formula: string, row: Record<string, unknown>): number | null {
  const tokens = formulaTokens(formula);
  if (!tokens) return null;
  let at = 0;
  const peek = () => tokens[at];
  const value = (): number => {
    const token = tokens[at++];
    if (token === "(") {
      const inner = sum();
      at++;
      return inner;
    }
    if (token === "-") return -value();
    if (token === undefined) return Number.NaN;
    if (/^\d/.test(token)) return Number(token);
    const raw = row[token];
    const number = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(number) ? number : 0;
  };
  const product = (): number => {
    let left = value();
    while (peek() === "*" || peek() === "/") {
      const op = tokens[at++];
      const right = value();
      left = op === "*" ? left * right : right === 0 ? Number.NaN : left / right;
    }
    return left;
  };
  const sum = (): number => {
    let left = product();
    while (peek() === "+" || peek() === "-") {
      const op = tokens[at++];
      const right = product();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };
  const result = sum();
  return at === tokens.length && Number.isFinite(result) ? Math.round(result * 1e6) / 1e6 : null;
}

/** A row with its formula columns filled in. */
export function withFormulas<T extends Record<string, unknown>>(schema: TableSchema, row: T): T {
  const formulas = schema.columns.filter((column) => column.formula);
  if (!formulas.length) return row;
  const next: Record<string, unknown> = { ...row };
  for (const column of formulas) next[column.key] = evaluateFormula(column.formula!, next);
  return next as T;
}

/** The checked table schema, or the first problem found. */
export function checkSchema(
  value: unknown,
): { ok: true; schema: TableSchema } | { ok: false; error: string } {
  if (!value || typeof value !== "object")
    return { ok: false, error: "A table needs a schema object." };
  const schema = value as Partial<TableSchema>;
  if (typeof schema.name !== "string" || !TABLE_NAME.test(schema.name)) {
    return {
      ok: false,
      error: "Table names are lower case letters, digits and _ (e.g. projects).",
    };
  }
  if (!Array.isArray(schema.columns) || schema.columns.length === 0) {
    return { ok: false, error: `Table ${schema.name} needs columns.` };
  }
  if (schema.columns.length > MAX_COLUMNS) {
    return { ok: false, error: `Table ${schema.name} has more than ${MAX_COLUMNS} columns.` };
  }
  const keys = new Set<string>();
  const columns: Column[] = [];
  for (const raw of schema.columns as Partial<Column>[]) {
    if (typeof raw?.key !== "string" || !COLUMN_KEY.test(raw.key)) {
      return {
        ok: false,
        error: `Column keys in ${schema.name} are lower case letters, digits and _.`,
      };
    }
    if (keys.has(raw.key))
      return { ok: false, error: `Column ${raw.key} appears twice in ${schema.name}.` };
    keys.add(raw.key);
    const type = (COLUMN_TYPES as readonly string[]).includes(raw.type ?? "") ? raw.type! : "text";
    const column: Column = {
      key: raw.key,
      label:
        typeof raw.label === "string" && raw.label.trim() ? raw.label.trim().slice(0, 80) : raw.key,
      type,
    };
    if (type === "enum") {
      const options = Array.isArray(raw.options) ? raw.options : [];
      column.options = options
        .filter((option) => option && typeof option.value === "string")
        .slice(0, 50)
        .map((option) => ({
          value: option.value.slice(0, 80),
          ...(option.tone ? { tone: option.tone } : {}),
        }));
    }
    if (type === "currency")
      column.currency =
        typeof raw.currency === "string" ? raw.currency.slice(0, 3).toUpperCase() : "EUR";
    if (type === "relation" && typeof raw.relation === "string") column.relation = raw.relation;
    if (typeof raw.formula === "string" && raw.formula.trim()) {
      if (!formulaTokens(raw.formula)) {
        return {
          ok: false,
          error: `Column ${raw.key}: formulas use column keys, numbers and + - * / ( ) only.`,
        };
      }
      column.formula = raw.formula.trim();
    }
    if (raw.required) column.required = true;
    if (raw.hidden) column.hidden = true;
    columns.push(column);
  }
  for (const column of columns) {
    for (const token of column.formula ? formulaTokens(column.formula)! : []) {
      if (/^[a-z]/.test(token) && !keys.has(token)) {
        return {
          ok: false,
          error: `Column ${column.key}: formula uses ${token}, which is not a column.`,
        };
      }
    }
  }
  return {
    ok: true,
    schema: {
      name: schema.name,
      label:
        typeof schema.label === "string" && schema.label.trim()
          ? schema.label.trim().slice(0, 80)
          : schema.name,
      columns,
      ...(schema.key && keys.has(schema.key) ? { key: schema.key } : {}),
      ...(schema.title && keys.has(schema.title) ? { title: schema.title } : {}),
    },
  };
}

/** A value made to fit its column, or an error naming the column. */
export function coerceValue(
  column: Column,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (value === null || value === undefined || value === "") {
    return column.required && !column.formula
      ? { ok: false, error: `${column.label} is required.` }
      : { ok: true, value: null };
  }
  switch (column.type) {
    case "number":
    case "currency":
    case "percent": {
      const number =
        typeof value === "number" ? value : Number(String(value).replace(/[,\s€£$%]/g, ""));
      return Number.isFinite(number)
        ? { ok: true, value: number }
        : { ok: false, error: `${column.label} must be a number.` };
    }
    case "boolean":
      if (typeof value === "boolean") return { ok: true, value };
      if (/^(yes|y|true|1|done|✓|x)$/i.test(String(value).trim())) return { ok: true, value: true };
      if (/^(no|n|false|0)$/i.test(String(value).trim())) return { ok: true, value: false };
      return { ok: false, error: `${column.label} must be yes or no.` };
    case "date": {
      const text = String(value).trim();
      const iso = /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
      if (iso && !Number.isNaN(Date.parse(iso))) return { ok: true, value: iso };
      const parsed = Date.parse(text);
      return Number.isNaN(parsed)
        ? { ok: false, error: `${column.label} must be a date (YYYY-MM-DD).` }
        : { ok: true, value: new Date(parsed).toISOString().slice(0, 10) };
    }
    case "image": {
      const ids = imageIds(value);
      return ids.length
        ? { ok: true, value: ids.join(",") }
        : { ok: false, error: `${column.label} must hold pictures added in the app.` };
    }
    case "enum": {
      const text = String(value).trim().slice(0, 80);
      const option = column.options?.find(
        (choice) => choice.value.toLowerCase() === text.toLowerCase(),
      );
      return { ok: true, value: option?.value ?? text };
    }
    default: {
      const text = typeof value === "string" ? value : String(value);
      return { ok: true, value: text.slice(0, column.type === "longtext" ? 20_000 : 2_000) };
    }
  }
}

/** A row checked against its table: unknown keys dropped, values coerced, formulas filled. */
export function coerceRow(
  schema: TableSchema,
  input: Record<string, unknown>,
  { partial = false }: { partial?: boolean } = {},
): { ok: true; row: Record<string, unknown> } | { ok: false; error: string } {
  const row: Record<string, unknown> = {};
  for (const column of schema.columns) {
    if (column.formula) continue;
    if (partial && !(column.key in input)) continue;
    const result = coerceValue(column, input[column.key]);
    if (!result.ok) return result;
    row[column.key] = result.value;
  }
  const size = JSON.stringify(row).length;
  if (size > MAX_ROW_BYTES) return { ok: false, error: "That row is too large to save." };
  return { ok: true, row };
}

const CURRENCY_FORMATS = new Map<string, Intl.NumberFormat>();

/** A value as text for its column, the way lists and cards show it. */
export function formatValue(column: Pick<Column, "type" | "currency">, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  switch (column.type) {
    case "currency": {
      const code = column.currency ?? "EUR";
      let format = CURRENCY_FORMATS.get(code);
      if (!format) {
        try {
          format = new Intl.NumberFormat("en-IE", {
            style: "currency",
            currency: code,
            maximumFractionDigits: 0,
          });
        } catch {
          format = new Intl.NumberFormat("en-IE", { maximumFractionDigits: 0 });
        }
        CURRENCY_FORMATS.set(code, format);
      }
      return format.format(Number(value));
    }
    case "percent": {
      const number = Number(value);
      return `${(Math.abs(number) <= 1.5 ? number * 100 : number).toLocaleString("en-IE", { maximumFractionDigits: 1 })}%`;
    }
    case "number":
      return Number(value).toLocaleString("en-IE", { maximumFractionDigits: 2 });
    case "date": {
      const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
      return Number.isNaN(date.getTime())
        ? String(value)
        : date.toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
    }
    case "boolean":
      return value ? "Yes" : "No";
    case "image": {
      const count = imageIds(value).length;
      return count ? `${count} ${count === 1 ? "photo" : "photos"}` : "";
    }
    default:
      return String(value);
  }
}
