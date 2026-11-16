import type { CSSProperties } from "react";
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { readAsset, useTable } from "../sdk/index.js";
import { cn } from "../ui/cn.js";
import { Engine } from "./engine.js";
import { formatValue } from "./format.js";
import type { CalcModel, CellSpec, CellStyle, InputSpec } from "./model.js";
import { address, parseAddress, quoteSheet } from "./model.js";
import {
  displayNumber,
  generalText,
  readSavedInputs,
  restorableInputs,
  SAVED_INPUTS_SCHEMA,
} from "./present.js";
import type { Scalar } from "./values.js";
import { parseNumber, XlError } from "./values.js";

export {
  CalcChart,
  CalcDetails,
  CalcField,
  CalcForm,
  CalcPrintButton,
  CalcResult,
  CalcStatus,
  CalcSummary,
  calcLabel,
  useCalcLayout,
} from "./views.js";

/**
 * `@ocsc/calc`: an app made from an Excel workbook calculates with the workbook's own formulas.
 * The model the import compiled (and checked against Excel's saved results) is kept as an app
 * file; `useCalc` loads it and calculates again whenever an input changes, and remembers each
 * person's inputs for next time. `CalcForm` presents a sheet as an app page (sections, fields,
 * results, verdicts); `CalcSheet` shows it as the workbook lays it out.
 */

export type CalcInput = InputSpec & {
  /** "Sheet!B3", as `value`, `text` and `set` take it. */
  address: string;
  sheetName: string;
};

export type Calc = {
  status: "loading" | "ready" | "error";
  error: string | null;
  model: CalcModel | null;
  inputs: CalcInput[];
  /** Counts calculations, so effects can follow results. */
  revision: number;
  /** A cell's current result. */
  value: (address: string) => Scalar;
  /** The same by position: sheet index and zero-based row and column. */
  cellValue: (sheet: number, row: number, col: number) => Scalar;
  /** A cell's result as Excel shows it, in the cell's number format (General fits the column). */
  text: (address: string) => string;
  /** A result as the app shows it: `text`, with General-format figures to four significant figures. */
  display: (address: string) => string;
  /** Sets an input; text is read the way Excel reads what is typed (numbers, 5%, TRUE, dates). */
  set: (address: string, value: string | number | boolean | null) => void;
  /** Choices for a list input, following other inputs when the list is a formula. */
  options: (input: CalcInput) => Array<string | number>;
  /** An input's value as the workbook was saved, before anyone changed it. */
  initial: (address: string) => Scalar;
  /** The values of a range ("Sheet!B3:B20"), row by row, as charts read them. */
  range: (reference: string) => Scalar[];
  /** Puts every input back to the value the workbook was saved with. */
  reset: () => void;
  /** Some input differs from the saved workbook. */
  changed: boolean;
};

type Loaded = {
  model: CalcModel;
  engine: Engine;
  cells: Array<Map<number, CellSpec>>;
  inputs: CalcInput[];
  saved: Map<string, Scalar>;
};

const key = (row: number, col: number) => row * 16384 + col;
const loads = new Map<string, Promise<Loaded>>();

async function gunzip(bytes: Uint8Array): Promise<string> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes);
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/** A compiled model ready to calculate. */
export function prepareModel(model: CalcModel): Loaded {
  const engine = new Engine(model);
  engine.calculate();
  const cells = model.sheets.map(
    (sheet) => new Map(sheet.cells.map(([row, col, cell]) => [key(row, col), cell])),
  );
  const inputs = model.inputs.map((input) => {
    const sheetName = model.sheets[input.sheet]?.name ?? "";
    return {
      ...input,
      sheetName,
      address: `${quoteSheet(sheetName)}!${address(input.row, input.col)}`,
    };
  });
  const saved = new Map(
    inputs.map((input) => [input.address, engine.cellValue(input.sheet, input.row, input.col)]),
  );
  return { model, engine, cells, inputs, saved };
}

function load(assetId: string): Promise<Loaded> {
  let promise = loads.get(assetId);
  if (!promise) {
    promise = readAsset(assetId)
      .then(gunzip)
      .then((text) => prepareModel(JSON.parse(text) as CalcModel));
    loads.set(assetId, promise);
    promise.catch(() => loads.delete(assetId));
  }
  return promise;
}

/** What a person typed, as Excel would store it in a cell. */
/** A chart reference of several ranges, "(Gra!$A$1:$E$1,Gra!$A$3:$E$3)", as its ranges in order. */
export function referenceParts(reference: string): string[] {
  const text = reference.trim();
  if (!text.startsWith("(") || !text.endsWith(")")) return [text];
  const parts: string[] = [];
  let quoted = false;
  let current = "";
  for (const char of text.slice(1, -1)) {
    if (char === "'") quoted = !quoted;
    if (char === "," && !quoted) {
      parts.push(current.trim());
      current = "";
    } else current += char;
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
}

export function entryValue(raw: string | number | boolean | null): Scalar {
  if (typeof raw !== "string") return raw;
  const text = raw.trim();
  if (!text) return null;
  if (/^true$/i.test(text)) return true;
  if (/^false$/i.test(text)) return false;
  const number = parseNumber(text);
  return number === null ? raw : number;
}

/** A workbook's calculation, loaded from the app file the import kept. */
export function useCalc(assetId: string): Calc {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    load(assetId).then(
      (value) => !cancelled && setLoaded(value),
      (problem: unknown) =>
        !cancelled &&
        setError(
          problem instanceof Error ? problem.message : "The calculation could not be loaded.",
        ),
    );
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  const locate = useCallback(
    (text: string) =>
      loaded ? parseAddress(text, (name) => loaded.engine.sheetIndex(name)) : null,
    [loaded],
  );
  const cellValue = useCallback(
    (sheet: number, row: number, col: number): Scalar =>
      loaded ? loaded.engine.cellValue(sheet, row, col) : null,
    [loaded],
  );
  const value = useCallback(
    (text: string): Scalar => {
      const at = locate(text);
      return at && loaded ? loaded.engine.cellValue(at.sheet, at.row, at.col) : null;
    },
    [loaded, locate],
  );
  const shown = useCallback(
    (cellAddress: string, rounded: boolean) => {
      const at = locate(cellAddress);
      if (!at || !loaded) return "";
      const spec = loaded.cells[at.sheet]?.get(key(at.row, at.col));
      const format =
        spec?.z === undefined ? "General" : (loaded.model.formats[spec.z] ?? "General");
      const value = loaded.engine.cellValue(at.sheet, at.row, at.col);
      if (typeof value === "number" && /^\s*general\s*$/i.test(format)) {
        const chars = cellChars(loaded.model, at.sheet, at.row, at.col);
        return rounded ? displayNumber(value, chars) : generalText(value, chars);
      }
      return formatValue(value, format).text;
    },
    [loaded, locate],
  );
  const text = useCallback((cellAddress: string) => shown(cellAddress, false), [shown]);
  const display = useCallback((cellAddress: string) => shown(cellAddress, true), [shown]);
  const remember = useRememberedInputs(assetId, loaded, setRevision);
  const set = useCallback(
    (cellAddress: string, raw: string | number | boolean | null) => {
      const at = locate(cellAddress);
      if (!at || !loaded) return;
      loaded.engine.set(at.sheet, at.row, at.col, entryValue(raw));
      loaded.engine.calculate();
      setRevision((n) => n + 1);
      remember();
    },
    [loaded, locate, remember],
  );
  const reset = useCallback(() => {
    if (!loaded) return;
    for (const input of loaded.inputs)
      loaded.engine.set(input.sheet, input.row, input.col, loaded.saved.get(input.address) ?? null);
    loaded.engine.calculate();
    setRevision((n) => n + 1);
    remember();
  }, [loaded, remember]);
  const initial = useCallback(
    (cellAddress: string): Scalar => {
      const at = locate(cellAddress);
      const input =
        at &&
        loaded?.inputs.find(
          (item) => item.sheet === at.sheet && item.row === at.row && item.col === at.col,
        );
      return input ? (loaded?.saved.get(input.address) ?? null) : null;
    },
    [loaded, locate],
  );
  const range = useCallback(
    (reference: string): Scalar[] => {
      if (!loaded || !reference) return [];
      return referenceParts(reference.replace(/^=/, "")).flatMap((part) => {
        try {
          return loaded.engine.evaluateFormula(part, 0, 0, 0);
        } catch {
          return [];
        }
      });
    },
    [loaded],
  );
  const options = useCallback(
    (input: CalcInput): Array<string | number> => {
      if (!loaded || !input.optionsFormula) return input.options ?? [];
      try {
        const listed = loaded.engine.evaluateFormula(
          input.optionsFormula,
          input.sheet,
          input.row,
          input.col,
        );
        return listed
          .filter(
            (item): item is string | number => typeof item === "string" || typeof item === "number",
          )
          .filter((item) => item !== "");
      } catch {
        return input.options ?? [];
      }
    },
    [loaded],
  );
  const changed = useMemo(
    () =>
      !!loaded?.inputs.some(
        (input) =>
          !sameValue(
            loaded.engine.cellValue(input.sheet, input.row, input.col),
            loaded.saved.get(input.address) ?? null,
          ),
      ),
    [loaded, revision],
  );
  return {
    status: error ? "error" : loaded ? "ready" : "loading",
    error,
    model: loaded?.model ?? null,
    inputs: loaded?.inputs ?? [],
    revision,
    value,
    cellValue,
    text,
    display,
    set,
    options,
    initial,
    range,
    reset,
    changed,
  };
}

const DEFAULT_COLUMN = 8.43;

/** How many characters a cell shows: its column's width, or its merged columns' together. */
export function cellChars(model: CalcModel, sheet: number, row: number, col: number): number {
  const spec = model.sheets[sheet];
  if (!spec) return 11;
  const merge = spec.merges?.find(
    ([r1, c1, r2, c2]) => row >= r1 && row <= r2 && col === c1 && c2 >= c1,
  );
  let width = 0;
  for (let c = col; c <= (merge ? merge[3] : col); c++)
    width += spec.colWidths?.[c] ?? DEFAULT_COLUMN;
  return width;
}

const SAVE_DELAY = 800;

/**
 * Puts back the inputs this person last used (once, when the model loads) and returns a call that
 * remembers the current ones shortly after a change. Viewers who cannot add rows keep their
 * changes for the visit only.
 */
function useRememberedInputs(
  assetId: string,
  loaded: Loaded | null,
  setRevision: (update: (n: number) => number) => void,
): () => void {
  const table = useTable<{ model?: string; values?: string }>(SAVED_INPUTS_SCHEMA.name);
  const mine = table.rows.find((row) => row._mine === true && row.model === assetId);
  const latest = useRef({ table, mine, loaded });
  latest.current = { table, mine, loaded };
  const restored = useRef<Loaded | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!loaded || restored.current === loaded || (table.schema && table.loading)) return;
    restored.current = loaded;
    if (!mine) return;
    const byAddress = new Map(loaded.inputs.map((input) => [input.address, input]));
    const values = restorableInputs(readSavedInputs(mine.values), new Set(byAddress.keys()));
    if (!values.length) return;
    for (const [at, value] of values) {
      const input = byAddress.get(at)!;
      loaded.engine.set(input.sheet, input.row, input.col, value);
    }
    loaded.engine.calculate();
    setRevision((n) => n + 1);
  }, [loaded, mine, table.schema, table.loading, setRevision]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const { table, mine, loaded } = latest.current;
      if (!loaded || !table.schema) return;
      const changed: Record<string, Scalar> = {};
      for (const input of loaded.inputs) {
        const now = loaded.engine.cellValue(input.sheet, input.row, input.col);
        if (now instanceof XlError) continue;
        if (!sameValue(now, loaded.saved.get(input.address) ?? null)) changed[input.address] = now;
      }
      const values = JSON.stringify(changed);
      if (mine && (mine.values ?? "{}") === values) return;
      const write = mine
        ? table.canEditRow(mine)
          ? table.update(mine._id, { values })
          : null
        : table.canAdd && values !== "{}"
          ? table.insert({ model: assetId, values })
          : null;
      write?.catch(() => {});
    }, SAVE_DELAY);
  }, [assetId]);
}

const sameValue = (a: Scalar, b: Scalar) =>
  a instanceof XlError || b instanceof XlError
    ? a instanceof XlError && b instanceof XlError && a.code === b.code
    : a === b;

// -----------------------------------------------------------------------------------------------
// Sheet view

const BORDER: Record<string, string> = {
  thin: "1px solid",
  hair: "1px solid",
  medium: "2px solid",
  thick: "3px solid",
  double: "3px double",
  dashed: "1px dashed",
  dotted: "1px dotted",
  mediumDashed: "2px dashed",
  dashDot: "1px dashed",
  dashDotDot: "1px dotted",
  mediumDashDot: "2px dashed",
  mediumDashDotDot: "2px dotted",
  slantDashDot: "2px dashed",
};

const edge = (spec: string | undefined) => {
  if (!spec) return undefined;
  const [kind = "thin", color = "#000000"] = spec.split(" ");
  return `${BORDER[kind] ?? "1px solid"} ${color}`;
};

function cellStyle(style: CellStyle | undefined, value: Scalar): CSSProperties {
  const align =
    style?.align ??
    (typeof value === "number"
      ? "right"
      : typeof value === "boolean" || value instanceof XlError
        ? "center"
        : "left");
  return {
    fontWeight: style?.bold ? 700 : undefined,
    fontStyle: style?.italic ? "italic" : undefined,
    textDecoration:
      [style?.underline && "underline", style?.strike && "line-through"]
        .filter(Boolean)
        .join(" ") || undefined,
    color: style?.color,
    backgroundColor: style?.fill,
    fontSize: style?.size ? `${style.size}pt` : undefined,
    textAlign: align,
    verticalAlign: style?.valign ?? "bottom",
    whiteSpace: style?.wrap ? "pre-wrap" : "pre",
    paddingLeft: style?.indent ? `${style.indent * 9 + 2}px` : undefined,
    borderTop: edge(style?.border?.t),
    borderRight: edge(style?.border?.r),
    borderBottom: edge(style?.border?.b),
    borderLeft: edge(style?.border?.l),
  };
}

type Shown = {
  col: number;
  text: string;
  style: CSSProperties;
  colSpan?: number;
  rowSpan?: number;
  input?: CalcInput;
};

/** Column widths are in characters of the default font; rows are in points. */
const columnPx = (width: number | null | undefined) => Math.round((width ?? 8.43) * 7 + 5);
const rowPx = (height: number | null | undefined) => Math.round(((height ?? 15) * 4) / 3);

/** A sheet laid out as the workbook shows it, its input cells editable. */
export function CalcSheet({
  calc,
  sheet,
  className,
}: {
  calc: Calc;
  sheet: string;
  className?: string;
}) {
  const model = calc.model;
  const index = model ? model.sheets.findIndex((spec) => spec.name === sheet) : -1;
  const spec = index >= 0 ? model?.sheets[index] : undefined;

  const layout = useMemo(() => {
    if (!model || !spec) return null;
    const hiddenRows = new Set(spec.hiddenRows ?? []);
    const hiddenCols = new Set(spec.hiddenCols ?? []);
    const cells = new Map(spec.cells.map(([row, col, cell]) => [key(row, col), cell]));
    let lastRow = 0;
    let lastCol = 0;
    for (const [row, col] of spec.cells) {
      lastRow = Math.max(lastRow, row);
      lastCol = Math.max(lastCol, col);
    }
    const rows = Array.from({ length: lastRow + 1 }, (_, row) => row).filter(
      (row) => !hiddenRows.has(row),
    );
    const cols = Array.from({ length: lastCol + 1 }, (_, col) => col).filter(
      (col) => !hiddenCols.has(col),
    );
    const covered = new Set<number>();
    const spans = new Map<number, { colSpan: number; rowSpan: number }>();
    for (const [r1, c1, r2, c2] of spec.merges ?? []) {
      for (let r = r1; r <= r2; r++)
        for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) covered.add(key(r, c));
      spans.set(key(r1, c1), {
        rowSpan: rows.filter((r) => r >= r1 && r <= r2).length,
        colSpan: cols.filter((c) => c >= c1 && c <= c2).length,
      });
    }
    const inputs = new Map(
      calc.inputs
        .filter((input) => input.sheet === index)
        .map((input) => [key(input.row, input.col), input]),
    );
    return { rows, cols, cells, covered, spans, inputs };
  }, [model, spec, index, calc.inputs]);

  if (calc.status === "error") return <p className="text-sm text-destructive">{calc.error}</p>;
  if (!model || !layout) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  return (
    <div
      className={cn(
        "overflow-auto rounded-xl border border-border bg-white text-black shadow-sm",
        className,
      )}
    >
      <table
        className="border-collapse"
        style={{ tableLayout: "fixed", fontFamily: "Calibri, Arial, sans-serif", fontSize: "11pt" }}
      >
        <colgroup>
          {layout.cols.map((col) => (
            <col key={col} style={{ width: columnPx(spec?.colWidths?.[col]) }} />
          ))}
        </colgroup>
        <tbody>
          {layout.rows.map((row) => {
            const shown: Shown[] = [];
            for (const col of layout.cols) {
              const k = key(row, col);
              if (layout.covered.has(k)) continue;
              const cell = layout.cells.get(k);
              const value = calc.cellValue(index, row, col);
              const format = cell?.z === undefined ? "General" : model.formats[cell.z];
              const formatted = formatValue(value, format);
              const style = cellStyle(
                cell?.s === undefined ? undefined : model.styles[cell.s],
                value,
              );
              if (formatted.color) style.color = formatted.color;
              shown.push({
                col,
                text: formatted.text,
                style,
                ...layout.spans.get(k),
                input: layout.inputs.get(k),
              });
            }
            return (
              <SheetRow
                key={row}
                height={rowPx(spec?.rowHeights?.[row])}
                cells={shown}
                signature={shown
                  .map(
                    (cell) =>
                      `${cell.text}\u0000${cell.style.color ?? ""}${cell.input?.optionsFormula ? `\u0000${calc.options(cell.input).join("\u0002")}` : ""}`,
                  )
                  .join("\u0001")}
                calc={calc}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const SheetRow = memo(
  function SheetRow({
    height,
    cells,
    calc,
  }: {
    height: number;
    cells: Shown[];
    signature: string;
    calc: Calc;
  }) {
    return (
      <tr style={{ height }}>
        {cells.map((cell) => (
          <td
            key={cell.col}
            colSpan={cell.colSpan}
            rowSpan={cell.rowSpan}
            style={{
              ...cell.style,
              overflow: cell.input ? "hidden" : "visible",
              padding: cell.input ? 0 : undefined,
            }}
            className="px-1 leading-tight"
          >
            {cell.input ? <CellEntry input={cell.input} text={cell.text} calc={calc} /> : cell.text}
          </td>
        ))}
      </tr>
    );
  },
  (a, b) => a.signature === b.signature && a.height === b.height && a.calc.set === b.calc.set,
);

function CellEntry({ input, text, calc }: { input: CalcInput; text: string; calc: Calc }) {
  const options = input.kind === "choice" ? calc.options(input) : null;
  const tint =
    "bg-amber-50 outline outline-1 outline-amber-300 focus:outline-2 focus:outline-amber-500";
  if (options?.length) {
    return (
      <select
        aria-label={input.label ?? input.address}
        value={String(calc.value(input.address) ?? "")}
        onChange={(event) => calc.set(input.address, matchOption(options, event.target.value))}
        className={cn("h-full w-full px-1", tint)}
      >
        {options.map((option) => (
          <option key={String(option)} value={String(option)}>
            {String(option)}
          </option>
        ))}
      </select>
    );
  }
  return (
    <TypedEntry input={input} text={text} calc={calc} className={cn("h-full w-full px-1", tint)} />
  );
}

export const matchOption = (options: Array<string | number>, chosen: string) =>
  options.find((option) => String(option) === chosen) ?? chosen;

/** A text box that keeps what is typed until Enter or leaving it, then calculates. */
export function TypedEntry({
  id,
  input,
  text,
  calc,
  className,
}: {
  id?: string;
  input: CalcInput;
  text: string;
  calc: Calc;
  className?: string;
}) {
  const [draft, setDraftState] = useState<string | null>(null);
  const typed = useRef<string | null>(null);
  const setDraft = (value: string | null) => {
    typed.current = value;
    setDraftState(value);
  };
  const commit = () => {
    const value = typed.current;
    setDraft(null);
    if (value !== null && value !== text) calc.set(input.address, value);
  };
  return (
    <input
      id={id}
      aria-label={id ? undefined : (input.label ?? input.address)}
      title={input.help}
      inputMode={input.kind === "number" ? "decimal" : undefined}
      value={draft ?? text}
      onFocus={() => {
        const current = calc.value(input.address);
        setDraft(
          current === null
            ? ""
            : typeof current === "number" && input.kind !== "date"
              ? String(current)
              : text,
        );
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
      className={className}
      style={{ textAlign: input.kind === "number" ? "right" : "left", font: "inherit" }}
    />
  );
}

/** The inputs as a form, labelled from the sheet: handier than the grid on a phone. */
export function CalcInputs({
  calc,
  sheet,
  className,
}: {
  calc: Calc;
  sheet?: string;
  className?: string;
}) {
  const inputs = calc.inputs.filter((input) => !sheet || input.sheetName === sheet);
  const formId = useId();
  if (calc.status !== "ready") return null;
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2", className)}>
      {inputs.map((input, index) => {
        const options = input.kind === "choice" ? calc.options(input) : null;
        const id = `${formId}-${index}`;
        const field =
          "h-10 w-full rounded-lg border border-input bg-background px-3 text-base sm:text-sm";
        return (
          <div key={input.address} className="flex flex-col gap-1 text-sm">
            <label htmlFor={id} className="font-medium text-foreground">
              {input.label ?? input.address}
              {input.unit ? (
                <span className="ml-1 font-normal text-muted-foreground">({input.unit})</span>
              ) : null}
            </label>
            {options?.length ? (
              <select
                id={id}
                value={String(calc.value(input.address) ?? "")}
                onChange={(event) =>
                  calc.set(input.address, matchOption(options, event.target.value))
                }
                className={field}
              >
                {options.map((option) => (
                  <option key={String(option)} value={String(option)}>
                    {String(option)}
                  </option>
                ))}
              </select>
            ) : (
              <TypedEntry
                id={id}
                input={input}
                text={calc.text(input.address)}
                calc={calc}
                className={field}
              />
            )}
            {input.help ? (
              <span className="text-xs text-muted-foreground">{input.help}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
