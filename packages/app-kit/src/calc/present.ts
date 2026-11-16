import type { PdfBlock, PdfDocument } from "../pdf/model.js";
import type { TableSchema } from "../schema.js";
import type { LayoutBlock, LayoutField, LayoutSection, SheetLayout } from "./layout.js";
import { cellIsRead, liveLabel, statusTone } from "./layout.js";
import type { CalcModel, CellValueJson } from "./model.js";

/**
 * Presentation choices for a calculator app that are pure functions of the model and layout, kept
 * apart from the components so they can be tested: which sheets become pages, how headings and
 * labels read, how side-by-side columns on a sheet stay side by side, what a printed calculation
 * holds, and which remembered inputs still apply after the workbook changes.
 */

const SMALL_WORDS = new Set(
  "A AN AND AS AT BY FOR IN OF ON OR PER THE TO WITH ARE IS NOT ALL BOX TOP END".split(" "),
);

/** All-capital text reads as sentence case; short capitals (EN, SLS) and symbols stay as written. */
export function tidyText(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const letters = flat.replace(/[^\p{L}]/gu, "");
  const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
  const firstWord = flat.split(" ")[0] ?? "";
  const shouty =
    letters.length >= 4 &&
    (upper / letters.length >= 0.7 ||
      (firstWord.replace(/[^\p{L}]/gu, "").length >= 4 && firstWord === firstWord.toUpperCase()));
  if (!shouty) return flat;
  const words = flat
    .split(" ")
    .map((word) => {
      const bare = word.replace(/[^\p{L}]/gu, "");
      return word === word.toUpperCase() && (bare.length >= 4 || SMALL_WORDS.has(bare))
        ? word.toLowerCase()
        : word;
    })
    .join(" ");
  const first = words.search(/\p{L}/u);
  return first < 0
    ? words
    : words.slice(0, first) + words.charAt(first).toUpperCase() + words.slice(first + 1);
}

/** The sheets an app shows, in workbook order: the visible ones with something on them. */
export function visibleSheets(model: CalcModel): number[] {
  return model.sheets.flatMap((sheet, index) =>
    !sheet.hidden && !sheet.external && sheet.cells.length ? [index] : [],
  );
}

/** Visible sheets holding inputs: each becomes a page of the app. */
export function formSheets(model: CalcModel): number[] {
  const withInputs = new Set(model.inputs.map((input) => input.sheet));
  return visibleSheets(model).filter((index) => withInputs.has(index));
}

const HELPER_NAME =
  /^(refs?|references?|defs?|defaults?|gra|grafs?|graphs?|chart ?data|lookups?|nos)$/i;
const TITLE_BLOCK = /^(project|client|job\s*(no|number|ref)?|made\s*by|checked)\b/i;

const titled = (model: CalcModel, index: number) =>
  model.sheets[index]!.cells.some(
    ([row, , cell]) =>
      row < 12 &&
      cell.f === undefined &&
      typeof cell.v === "string" &&
      TITLE_BLOCK.test(cell.v.trim()),
  );

/**
 * A sheet serving the others rather than the person using the app: references, defaults, the
 * data behind charts, or one whose open cells mostly feed nothing (lookup tables left unlocked).
 */
export function helperSheet(model: CalcModel, index: number): boolean {
  const sheet = model.sheets[index];
  if (!sheet) return false;
  if (HELPER_NAME.test(sheet.name.trim())) return true;
  const inputs = model.inputs.filter((input) => input.sheet === index);
  if (inputs.length < 20 || titled(model, index)) return false;
  const read = inputs.filter((input) => cellIsRead(model, index, input.row, input.col)).length;
  return read < inputs.length / 4;
}

/**
 * Sheets that become pages of their own: the form sheets a person works in, leaving helper sheets
 * to the full calculation; every form sheet when all of them look like helpers, else the first shown.
 */
export function pageSheets(model: CalcModel, max = 8): number[] {
  const forms = formSheets(model);
  const primary = forms.filter((index) => !helperSheet(model, index));
  const pages = (primary.length ? primary : forms).slice(0, max);
  if (pages.length) return pages;
  const first = visibleSheets(model)[0];
  return first === undefined ? [] : [first];
}

/** Every sheet with something on it, visible ones first, for a view that leaves nothing out. */
export function detailSheets(model: CalcModel): number[] {
  const shown = visibleSheets(model);
  const rest = model.sheets.flatMap((sheet, index) =>
    !sheet.external && sheet.cells.length && !shown.includes(index) ? [index] : [],
  );
  return [...shown, ...rest];
}

const layoutAddresses = (layout: SheetLayout) => {
  const seen = new Set<string>(layout.ignored);
  for (const section of layout.sections)
    for (const block of section.blocks) {
      if (block.kind === "fields") for (const field of block.fields) seen.add(field.address);
      if (block.kind === "table")
        for (const row of block.table.rows)
          for (const cell of row.cells) if (cell) seen.add(cell.address);
    }
  return seen;
};

/**
 * What a key result is called on its own. A figure from a table is named by its row and column
 * ("qEQP/qRd · Combo 1"), since its column heading alone says little.
 */
export function resultLabel(layout: SheetLayout, field: LayoutField): string {
  let row = field.row;
  for (const section of layout.sections)
    for (const block of section.blocks)
      if (!row && block.kind === "table")
        row = block.table.rows.find((item) =>
          item.cells.some((cell) => cell?.address === field.address),
        )?.label;
  return row ? `${tidyText(row)} · ${tidyText(field.label)}` : tidyText(field.label);
}

/**
 * A sheet's inputs the layout did not place, so the page can still offer them. Given the model,
 * only those some formula reads: an open cell nothing reads changes no result.
 */
export function looseInputs<
  T extends { address: string; sheet: number; row?: number; col?: number; label?: string },
>(layout: SheetLayout, inputs: readonly T[], model?: CalcModel): T[] {
  const placed = layoutAddresses(layout);
  const area = model?.sheets[layout.sheet]?.printArea;
  const outside = (input: T) =>
    !!area &&
    input.row !== undefined &&
    input.col !== undefined &&
    (input.row < area[0] || input.row > area[2] || input.col < area[1] || input.col > area[3]);
  const left = inputs.filter(
    (input) =>
      input.sheet === layout.sheet &&
      !placed.has(input.address) &&
      (!model ||
        input.row === undefined ||
        input.col === undefined ||
        cellIsRead(model, input.sheet, input.row, input.col)),
  );
  // Beside the printed sheet, an unnamed switch or a block of figures a macro fills is workbook
  // plumbing rather than a question for the user; the full calculation still shows it.
  const beside = left.filter(outside);
  const many = beside.length > MAX_LOOSE_BESIDE;
  return left.filter((input) => !outside(input) || (!many && !!input.label));
}

const MAX_LOOSE_BESIDE = 12;

/**
 * The sections, cut to fields and table rows whose label (or section title) holds every word of
 * the query, in any order; a section whose title matches keeps everything.
 */
export function filterSections(sections: LayoutSection[], query: string): LayoutSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return sections;
  const matches = (...texts: Array<string | undefined>) => {
    const hay = texts.filter(Boolean).join(" ").toLowerCase();
    return words.every((word) => hay.includes(word));
  };
  return sections.flatMap((section) => {
    if (matches(section.title)) return [section];
    const blocks = section.blocks.flatMap((block): LayoutBlock[] => {
      if (block.kind === "fields") {
        const fields = block.fields.filter((field) =>
          matches(section.title, field.label, field.row, field.unit),
        );
        return fields.length ? [{ kind: "fields", fields }] : [];
      }
      if (block.kind === "table") {
        const rows = block.table.rows.filter((row) =>
          matches(section.title, row.label, ...block.table.columns),
        );
        return rows.length ? [{ kind: "table", table: { ...block.table, rows } }] : [];
      }
      return [];
    });
    return blocks.length ? [{ ...section, blocks }] : [];
  });
}

const columnOf = (address: string) => {
  const letters = /!?\$?([A-Za-z]{1,3})\$?\d+$/.exec(address)?.[1]?.toUpperCase() ?? "A";
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
};

/**
 * Fields that sit in side-by-side columns on the sheet (an X and a Y direction, a left and a right
 * column) as those columns, so the app keeps them apart. One lane when the sheet has one column.
 */
export function fieldLanes(fields: LayoutField[], max = 3): LayoutField[][] {
  const cols = [...new Set(fields.map((field) => columnOf(field.address)))].sort((a, b) => a - b);
  const starts: number[] = [];
  for (const col of cols)
    if (!starts.length || col - cols[cols.indexOf(col) - 1]! >= 2) starts.push(col);
  if (starts.length < 2 || starts.length > max) return [fields];
  const lanes = starts.map(() => [] as LayoutField[]);
  for (const field of fields) {
    const col = columnOf(field.address);
    let lane = 0;
    for (let index = 0; index < starts.length; index++) if (col >= starts[index]!) lane = index;
    lanes[lane]!.push(field);
  }
  return lanes.some((lane) => lane.length < 2) ? [fields] : lanes;
}

/**
 * Where a calculator remembers each person's inputs: one row per person and model, private to
 * them (the owner can see everyone's), so the values they last typed come back next time.
 */
export const SAVED_INPUTS_SCHEMA: TableSchema = {
  name: "calc_inputs",
  label: "Saved inputs",
  personal: true,
  columns: [
    { key: "model", label: "Calculation", type: "text" },
    { key: "values", label: "Inputs", type: "longtext" },
  ],
};

/** What a remembered input holds: a cell value as plain JSON. */
export type SavedValue = Exclude<CellValueJson, { e: string }>;

/**
 * The remembered inputs that still apply: only addresses that are inputs of the current model, so a
 * workbook updated with a different layout drops the rest instead of writing into formulas.
 */
export function restorableInputs(
  saved: unknown,
  inputs: ReadonlySet<string>,
): Array<[string, SavedValue]> {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return [];
  return Object.entries(saved as Record<string, unknown>).filter(
    (entry): entry is [string, SavedValue] =>
      inputs.has(entry[0]) &&
      (entry[1] === null ||
        typeof entry[1] === "string" ||
        typeof entry[1] === "boolean" ||
        (typeof entry[1] === "number" && Number.isFinite(entry[1]))),
  );
}

/** Reads remembered inputs kept as JSON text, ignoring anything unreadable. */
export function readSavedInputs(text: unknown): Record<string, unknown> {
  if (typeof text !== "string" || !text) return {};
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const shown = (field: LayoutField, text: (address: string) => string) =>
  [text(field.address), field.unit].filter(Boolean).join(" ") || "—";

const named = (field: LayoutField, text: (address: string) => string) =>
  tidyText(
    field.labelAddress
      ? text(field.labelAddress) || field.label
      : liveLabel(field.label, field.live, text),
  );

/**
 * A sheet's inputs and results as a printed calculation, read through `text` (a cell as Excel
 * shows it) so the paper says what the screen says.
 */
export function calcReport(
  layout: SheetLayout,
  text: (address: string) => string,
  heading: { title: string; reference?: string },
): PdfDocument {
  const blocks: PdfBlock[] = [];
  const project = layout.sections.find((section) => section.role === "project");
  if (project) {
    for (const block of project.blocks)
      if (block.kind === "note") {
        const line = block.address ? text(block.address) : (block.text ?? "");
        if (line.trim() && !statusTone(line)) blocks.push({ type: "text", text: tidyText(line) });
      }
    const facts = project.blocks
      .flatMap((block) => (block.kind === "fields" ? block.fields : []))
      .filter((field) => !field.row)
      .map((field) => ({ label: named(field, text), value: shown(field, text) }));
    if (facts.length) blocks.push({ type: "facts", items: facts });
  }
  if (layout.key.length) {
    blocks.push({
      type: "stats",
      items: layout.key.map((field) => {
        const tone = statusTone(text(field.address));
        return {
          label: field.labelAddress
            ? named(field, text)
            : liveLabel(resultLabel(layout, field), field.live, text),
          value: shown(field, text),
          ...(tone ? { tone } : {}),
        };
      }),
    });
  }
  for (const section of layout.sections) {
    if (section === project) continue;
    const parts: PdfBlock[] = [];
    for (const block of section.blocks) {
      if (block.kind === "fields") {
        const rows = block.fields.map((field) => [
          named(field, text),
          shown(field, text),
          field.hintAddress ? text(field.hintAddress) : (field.hint ?? ""),
        ]);
        if (!section.title) {
          parts.push({
            type: "facts",
            items: rows.map(([label, value]) => ({ label: label!, value: value! })),
          });
        } else {
          parts.push({
            type: "table",
            columns: ["", { label: "Value", align: "right" }, ""],
            rows,
          });
        }
      } else if (block.kind === "table") {
        parts.push({
          type: "table",
          columns: [
            "",
            ...block.table.columns.map((label) => ({
              label: tidyText(liveLabel(label, block.table.live, text)),
              align: "right" as const,
            })),
            "",
          ],
          rows: block.table.rows.map((row) => [
            tidyText(liveLabel(row.label, row.live, text)),
            ...row.cells.map((cell) => (cell ? text(cell.address) || "—" : "")),
            row.hintAddress ? text(row.hintAddress) : (row.hint ?? ""),
          ]),
        });
      } else {
        const note = block.address ? text(block.address) : (block.text ?? "");
        if (note.trim())
          parts.push({ type: "text", text: note, size: "small", muted: !block.strong });
      }
    }
    if (!parts.length) continue;
    if (section.title)
      blocks.push({
        type: "subheading",
        text: tidyText(liveLabel(section.title, section.live, text)),
      });
    blocks.push(...parts);
  }
  const footer = layout.footer
    .map((block) =>
      block.kind === "note" ? (block.address ? text(block.address) : (block.text ?? "")) : "",
    )
    .filter((line, index, all) => line.trim() && all.indexOf(line) === index);
  if (footer.length)
    blocks.push({
      type: "text",
      text: footer.map(tidyText).join(" · "),
      size: "small",
      muted: true,
    });
  return {
    title: heading.title,
    kind: "CALCULATION",
    ...(heading.reference ? { reference: heading.reference } : {}),
    blocks,
  };
}

const trimZeros = (text: string) => (text.includes(".") ? text.replace(/\.?0+$/, "") : text);

function scientific(value: number, room: number): string {
  for (let digits = Math.max(0, room - 6); digits >= 0; digits--) {
    const text = value
      .toExponential(digits)
      .replace(/\.?0+e/, "e")
      .replace(/e([+-])(\d)$/, "e$10$2")
      .toUpperCase();
    if (text.length <= room || digits === 0) return text;
  }
  return value.toExponential(0).toUpperCase();
}

/**
 * A number in Excel's General format as a cell `chars` characters wide shows it: as many decimals as
 * fit (never more than 11 characters), switching to scientific notation for very large or small
 * figures.
 */
export function generalText(value: number, chars = 11): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return "0";
  const room = Math.max(5, Math.min(11, Math.floor(chars)));
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const intDigits = abs >= 1 ? Math.floor(Math.log10(abs)) + 1 : 1;
  if (abs >= 1e11 || abs < 1e-5 || intDigits > room - sign.length)
    return sign + scientific(abs, room - sign.length);
  for (let decimals = Math.max(0, room - sign.length - intDigits - 1); decimals >= 0; decimals--) {
    const text = trimZeros(abs.toFixed(decimals));
    if (text.length <= room - sign.length && Number(text) !== 0) return sign + text;
  }
  return sign + scientific(abs, room - sign.length);
}

/** Significant figures a General-format result keeps in an app (whole-number digits are kept). */
export const DISPLAY_FIGURES = 4;

/**
 * A General-format result as an app shows it: Excel's cell display, rounded to four significant
 * figures (never dropping whole-number digits), so 0.2997480423 reads 0.2997 and 123456.7 reads
 * 123457.
 */
export function displayNumber(value: number, chars = 11): string {
  if (!Number.isFinite(value) || value === 0) return generalText(value, chars);
  const abs = Math.abs(value);
  const intDigits = abs >= 1 ? Math.floor(Math.log10(abs)) + 1 : 0;
  const rounded = Number(value.toPrecision(Math.min(15, Math.max(DISPLAY_FIGURES, intDigits))));
  return generalText(rounded, chars);
}

/** Round axis values from just below a range to just above it, about `count` steps apart. */
export function axisTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return [];
  if (min === max) return min === 0 ? [0, 1] : axisTicks(Math.min(0, min), Math.max(0, max), count);
  const raw = (max - min) / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw * (1 - 1e-9)) ?? raw;
  const first = Math.floor(min / step + 1e-9);
  const last = Math.ceil(max / step - 1e-9);
  const ticks: number[] = [];
  for (let index = first; index <= last; index++)
    ticks.push(Number((index * step).toPrecision(12)));
  return ticks;
}

/**
 * The points a chart series draws, split where a value is missing: Excel leaves a gap at a blank
 * cell, which is how a sheet draws several separate lines (outlines, columns) in one series.
 */
export function seriesSegments(
  xs: readonly unknown[],
  ys: readonly unknown[],
  indexed: boolean,
): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  ys.forEach((y, index) => {
    const x = indexed ? index + 1 : xs[index];
    if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y))
      current.push([x, y]);
    else if (current.length) {
      out.push(current);
      current = [];
    }
  });
  if (current.length) out.push(current);
  return out;
}

/**
 * One line for every verdict on a sheet together: the verdict itself when there is one, else how
 * many checks fail or need attention, or that all of them pass.
 */
export function checkSummary(
  texts: readonly string[],
  counted = false,
): { tone: "success" | "danger" | "warning"; text: string } | null {
  const verdicts = texts
    .map((text) => ({ text: text.trim(), tone: statusTone(text) }))
    .filter(
      (item): item is { text: string; tone: "success" | "danger" | "warning" } => !!item.tone,
    );
  if (!verdicts.length) return null;
  const only = verdicts.length === 1 ? verdicts[0]! : null;
  // One bare "OK" beside a figure says nothing on its own as the page's verdict.
  if (only && (!counted || only.text.split(/\s+/).length >= 2)) return only;
  if (only)
    return {
      tone: only.tone,
      text: { success: "Check passes", danger: "Check fails", warning: "Check needs attention" }[
        only.tone
      ],
    };
  const total = verdicts.length;
  const failing = verdicts.filter((item) => item.tone === "danger").length;
  if (failing) return { tone: "danger", text: `${failing} of ${total} checks fail` };
  const warning = verdicts.filter((item) => item.tone === "warning").length;
  if (warning) return { tone: "warning", text: `${warning} of ${total} checks need attention` };
  return { tone: "success", text: `All ${total} checks pass` };
}
