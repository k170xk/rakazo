#!/usr/bin/env node
/**
 * OCSC Excel: build, read and edit Excel workbooks on a Bot's computer.
 *
 *   ocsc-xlsx new  --spec book.json --out outputs/Costs.xlsx
 *   ocsc-xlsx read --in outputs/Costs.xlsx [--sheet Summary] [--range A1:K40 | --from 41]
 *   ocsc-xlsx edit --in outputs/Costs.xlsx --spec edits.json [--out outputs/Costs-v2.xlsx]
 *
 * book.json:
 *   { "sheets": [ { "name": "Summary",
 *                   "columns": [ { "header": "Item", "width": 30 }, { "header": "Cost", "format": "£#,##0.00" } ],
 *                   "rows": [ [ "Steel", 1200 ], [ "Total", { "formula": "SUM(B2:B2)" } ] ],
 *                   "total_row": true } ] }
 * total_row sums the columns marked "total": true, or the last number column when none is.
 * A cell is text, a number, true/false, null, { "formula": "..." } (no leading =) or { "date": "2026-10-22" }.
 *
 * edits.json: { "edits": [ { "op": "set", "sheet": "Summary", "cell": "B3", "value": 950 }, ... ] }
 *   ops: set, set_range, append_rows, insert_rows, delete_rows, add_sheet, delete_sheet, rename_sheet, set_column
 *
 * Every command prints one JSON object. `new` and `edit` include `link`, a markdown link the Bot
 * pastes into its reply so the person gets a download card.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { cellText, evaluateFormulas, showOnScreen } from "./screen.mjs";

const WORKSPACE =
  process.env.WORKSPACE_DIR || process.env.HOME || process.cwd();
const BRAND_GREEN = "FF77C043";
const MAX_INPUT_BYTES = 40 * 1024 * 1024;

class UsageError extends Error {}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true;
    else {
      out[a.slice(2)] = next;
      i += 1;
    }
  }
  return out;
}

function inWorkspace(p, label) {
  if (typeof p !== "string" || !p.trim())
    throw new UsageError(`${label} is required.`);
  const full = isAbsolute(p) ? resolve(p) : resolve(WORKSPACE, p);
  const rel = relative(WORKSPACE, full);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new UsageError(
      `${label} must be inside the workspace (${WORKSPACE}).`,
    );
  }
  return { full, rel: rel.split("\\").join("/") };
}

function downloadLink(rel) {
  const name = basename(rel);
  const bot = process.env.COMPUTER_BOT_ID;
  if (!bot) return { name, path: rel };
  const url = `/api/computers/${encodeURIComponent(bot)}/files/download?path=${encodeURIComponent(rel)}`;
  return { name, path: rel, url, link: `[${name}](${url})` };
}

function readSpec(p) {
  const { full, rel } = inWorkspace(p, "--spec");
  if (!existsSync(full)) throw new UsageError(`${rel} does not exist.`);
  try {
    return JSON.parse(readFileSync(full, "utf8"));
  } catch (error) {
    throw new UsageError(`${rel} is not valid JSON: ${error.message}`);
  }
}

async function openBook(p) {
  const src = inWorkspace(p, "--in");
  if (!existsSync(src.full)) throw new UsageError(`${src.rel} does not exist.`);
  if (/\.xls$/i.test(src.full))
    throw new UsageError(
      `${src.rel} is an old Excel 97-2003 file. Ask the person to save it as .xlsx (File > Save As) and upload that.`,
    );
  if (!/\.xls[xm]$/i.test(src.full))
    throw new UsageError("--in must be an .xlsx file.");
  if (statSync(src.full).size > MAX_INPUT_BYTES)
    throw new UsageError(`${src.rel} is larger than 40 MB.`);
  const book = new ExcelJS.Workbook();
  let lost = [];
  try {
    const bytes = readFileSync(src.full);
    await book.xlsx.load(bytes);
    lost = await unkeptParts(bytes);
  } catch (error) {
    throw new UsageError(
      `${src.rel} could not be opened as an Excel workbook: ${error.message}`,
    );
  }
  return { src, book, lost };
}

/** Parts of a workbook that ExcelJS drops when it saves an edited copy. */
async function unkeptParts(bytes) {
  const names = Object.keys((await JSZip.loadAsync(bytes)).files);
  const count = (re) => names.filter((n) => re.test(n)).length;
  return [
    [count(/^xl\/charts\/chart\d*\.xml$/i), "chart"],
    [count(/^xl\/pivotTables\/[^/]+\.xml$/i), "pivot table"],
    [count(/^xl\/slicers\/[^/]+\.xml$/i), "slicer"],
    [count(/^xl\/vbaProject\.bin$/i), "macro project"],
  ]
    .filter(([n]) => n > 0)
    .map(([n, what]) => `${n} ${what}${n === 1 ? "" : "s"}`);
}

function lostWarning(lost) {
  return `This workbook has ${lost.join(", ")}, which an edited copy will not keep. Tell the person before sending an edited copy.`;
}

function outFile(p) {
  const out = inWorkspace(p, "--out");
  if (!/\.xlsx$/i.test(out.full))
    throw new UsageError("--out must end in .xlsx");
  mkdirSync(dirname(out.full), { recursive: true });
  return out;
}

// ---------- cells ----------

function toValue(v, where) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    return v;
  if (typeof v === "object" && typeof v.formula === "string") {
    return { formula: v.formula.replace(/^=/, "") };
  }
  if (typeof v === "object" && typeof v.date === "string") {
    const d = new Date(v.date);
    if (Number.isNaN(d.getTime()))
      throw new UsageError(
        `${where}: ${JSON.stringify(v.date)} is not a date.`,
      );
    return d;
  }
  throw new UsageError(
    `${where}: a cell must be text, a number, true/false, null, {"formula": "..."} or {"date": "YYYY-MM-DD"}.`,
  );
}

function setCell(cell, value, format, where) {
  cell.value = toValue(value, where);
  if (format) cell.numFmt = format;
  else if (cell.value instanceof Date && !cell.numFmt)
    cell.numFmt = "dd/mm/yyyy";
}

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: BRAND_GREEN },
    };
    cell.alignment = { vertical: "middle" };
  });
}

function columnIndex(ref, where) {
  if (typeof ref === "number" && ref >= 1) return ref;
  if (typeof ref === "string" && /^[A-Za-z]{1,3}$/.test(ref)) {
    return ref
      .toUpperCase()
      .split("")
      .reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  }
  throw new UsageError(
    `${where}: column must be a letter like "C" or a number.`,
  );
}

function address(ref, where) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(String(ref ?? ""));
  if (!m)
    throw new UsageError(
      `${where}: ${JSON.stringify(ref)} is not a cell like "B4".`,
    );
  return { col: columnIndex(m[1], where), row: Number(m[2]) };
}

function sheetOf(book, name, where) {
  if (name === undefined && book.worksheets.length === 1)
    return book.worksheets[0];
  const wanted = String(name ?? "").trim().toLowerCase();
  const sheet =
    typeof name === "number"
      ? book.worksheets[name - 1]
      : (book.getWorksheet(String(name ?? "")) ??
        book.worksheets.find((s) => s.name.trim().toLowerCase() === wanted));
  if (!sheet) {
    throw new UsageError(
      `${where}: there is no sheet ${JSON.stringify(name)}. Sheets: ${book.worksheets.map((s) => s.name).join(", ")}.`,
    );
  }
  return sheet;
}

function fillSheet(sheet, spec, where) {
  const columns = Array.isArray(spec.columns) ? spec.columns : [];
  const formats = [];
  columns.forEach((col, i) => {
    const c = typeof col === "string" ? { header: col } : col || {};
    const column = sheet.getColumn(i + 1);
    column.width =
      c.width ?? Math.min(60, Math.max(10, String(c.header ?? "").length + 4));
    if (c.format) formats[i] = c.format;
  });
  let r = 0;
  if (columns.length) {
    r = 1;
    const header = sheet.getRow(1);
    columns.forEach((col, i) => {
      header.getCell(i + 1).value =
        typeof col === "string" ? col : (col?.header ?? "");
    });
    styleHeader(header);
    sheet.views = [{ state: "frozen", ySplit: 1 }];
  }
  const rows = Array.isArray(spec.rows) ? spec.rows : [];
  rows.forEach((values, n) => {
    if (!Array.isArray(values))
      throw new UsageError(`${where} row ${n + 1} must be a list of cells.`);
    const row = sheet.getRow(r + n + 1);
    values.forEach((v, i) => {
      setCell(row.getCell(i + 1), v, formats[i], `${where} row ${n + 1}`);
    });
  });
  if (spec.total_row && rows.length && columns.length) {
    const last = r + rows.length;
    const row = sheet.getRow(last + 1);
    row.getCell(1).value = "Total";
    // Only the columns marked `"total": true`, or the last number column when none is: summing every
    // number column adds up rates and quantities that mean nothing added.
    const numeric = columns
      .map((_, i) => i)
      .filter(
        (i) =>
          i > 0 &&
          rows.some(
            (values) => typeof values[i] === "number" || values[i]?.formula,
          ),
      );
    const marked = numeric.filter((i) => columns[i]?.total === true);
    const totalled = marked.length ? marked : numeric.slice(-1);
    columns.forEach((_, i) => {
      if (!totalled.includes(i)) return;
      const letter = sheet.getColumn(i + 1).letter;
      setCell(
        row.getCell(i + 1),
        { formula: `SUM(${letter}2:${letter}${last})` },
        formats[i],
        where,
      );
    });
    row.font = { bold: true };
    row.eachCell((cell) => {
      cell.border = { top: { style: "thin", color: { argb: BRAND_GREEN } } };
    });
  }
  if (columns.length && rows.length) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };
  }
}

// ---------- formulas ----------

const REF =
  /(?<![A-Za-z0-9_!$.:])(\$?[A-Za-z]{1,3}\$?)(\d+)(?::(\$?[A-Za-z]{1,3}\$?)(\d+))?(?![\d(A-Za-z_])/g;

/**
 * Keep this sheet's formulas pointing at the same cells after rows move, as Excel does. A range
 * ending just above inserted rows grows over them when the formula sits below them, which is a total
 * picking up the line items added above it. Returns how many references now point at removed rows.
 */
function shiftRows(sheet, { at, inserted = 0, removed = 0 }) {
  let broken = 0;
  const moveRow = (r) => {
    if (inserted) return r >= at ? r + inserted : r;
    if (r >= at + removed) return r - removed;
    return r >= at ? null : r;
  };
  sheet.eachRow({ includeEmpty: false }, (row) => {
    if (inserted && row.number >= at && row.number < at + inserted) return;
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      if (!v || typeof v !== "object" || typeof v.formula !== "string") return;
      const formula = v.formula.replace(REF, (_, c1, r1, c2, r2) => {
        const a = Number(r1);
        if (c2 === undefined) {
          const moved = moveRow(a);
          if (moved === null) {
            broken += 1;
            return "#REF!";
          }
          return `${c1}${moved}`;
        }
        const b = Number(r2);
        let start = moveRow(a);
        let end = moveRow(b);
        if (inserted && b === at - 1 && row.number >= at + inserted) {
          end = b + inserted;
        }
        if (removed) {
          start ??= at;
          end ??= at - 1;
          if (start > end) {
            broken += 1;
            return "#REF!";
          }
        }
        return `${c1}${start}:${c2}${end}`;
      });
      cell.value = { formula };
    });
  });
  return broken;
}

/**
 * Works out the common formulas (arithmetic, SUM, AVERAGE, MIN, MAX, COUNT, ROUND, ABS over cells and
 * ranges on the same sheet) so the file opens with values and the preview shows numbers. Anything else
 * is left for Excel, which recalculates every formula when the file opens.
 */
async function save(book, out) {
  const formulas = evaluateFormulas(book);
  book.calcProperties = {
    ...(book.calcProperties || {}),
    fullCalcOnLoad: true,
  };
  book.creator ||= "OCSC";
  book.modified = new Date();
  await book.xlsx.writeFile(out.full);
  return formulas;
}

function describe(formulas) {
  return formulas.left
    ? {
        formulas: formulas.computed + formulas.left,
        note: `${formulas.left} formula(s) will calculate when the file is opened in Excel.`,
      }
    : formulas.computed
      ? { formulas: formulas.computed }
      : {};
}

// ---------- commands ----------

async function cmdNew(o) {
  const spec = readSpec(o.spec);
  const out = outFile(o.out);
  const sheets =
    Array.isArray(spec.sheets) && spec.sheets.length ? spec.sheets : null;
  if (!sheets)
    throw new UsageError(
      'The spec needs "sheets": [ { "name": "...", "columns": [...], "rows": [[...]] } ].',
    );
  const book = new ExcelJS.Workbook();
  if (spec.title) book.title = String(spec.title);
  const names = new Set();
  sheets.forEach((s, n) => {
    const name = String(s?.name || `Sheet${n + 1}`).slice(0, 31);
    if (names.has(name.toLowerCase()))
      throw new UsageError(`Two sheets are called ${JSON.stringify(name)}.`);
    names.add(name.toLowerCase());
    fillSheet(book.addWorksheet(name), s, `Sheet ${JSON.stringify(name)}`);
  });
  const formulas = await save(book, out);
  return {
    ok: true,
    sheets: book.worksheets.map((s) => s.name),
    ...describe(formulas),
    ...downloadLink(out.rel),
  };
}

/** Tool results reach the assistant cut at 12,000 characters, so a read stays under that. */
const READ_BUDGET = 10_000;
const READ_MAX_COLUMNS = 200;

function formulaOf(cell) {
  const v = cell.value;
  if (!v || typeof v !== "object" || !("formula" in v || "sharedFormula" in v))
    return null;
  return cell.formula || v.formula || null;
}

function columnName(n) {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26))
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/** The rows and columns one read covers: --range, or --from and --rows, else the whole sheet. */
function readArea(o, sheet) {
  const lastCol = Math.min(Math.max(sheet.columnCount, 1), READ_MAX_COLUMNS);
  if (typeof o.range === "string") {
    const [a, b = a] = o.range.split(":");
    const start = address(a, "--range");
    const end = address(b, "--range");
    return {
      r1: Math.min(start.row, end.row),
      r2: Math.max(start.row, end.row),
      c1: Math.min(start.col, end.col),
      c2: Math.min(Math.max(start.col, end.col), start.col + READ_MAX_COLUMNS - 1),
    };
  }
  const r1 = Math.max(Number(o.from) || 1, 1);
  const rows = Math.min(Math.max(Number(o.rows) || 2000, 1), 2000);
  return { r1, r2: Math.min(sheet.rowCount, r1 + rows - 1), c1: 1, c2: lastCol };
}

/**
 * Non-empty cells by row and column letter, so edits can name cells directly. A merged range
 * shows once, at its top-left cell; a formula shows as "=FORMULA" or "=FORMULA → value".
 */
function readCells(sheet, area, budget) {
  const rows = {};
  let used = 0;
  for (let r = area.r1; r <= area.r2; r += 1) {
    const row = sheet.getRow(r);
    const cells = {};
    for (let c = area.c1; c <= area.c2; c += 1) {
      const cell = row.getCell(c);
      if (cell.isMerged && cell.master !== cell) continue;
      const shown = cellText(cell);
      const formula = formulaOf(cell);
      const text = formula
        ? shown && !shown.startsWith("=")
          ? `=${formula} → ${shown}`
          : `=${formula}`
        : shown;
      if (text !== "") cells[columnName(c)] = text;
    }
    if (!Object.keys(cells).length) continue;
    const size = JSON.stringify({ [r]: cells }).length;
    if (used + size > budget && used > 0) return { rows, used, next: r };
    rows[r] = cells;
    used += size;
  }
  return { rows, used, next: null };
}

function mergedRanges(sheet, fromRow, toRow) {
  return Object.values(sheet._merges ?? {})
    .filter((m) => m?.range && m.top <= toRow && m.bottom >= fromRow)
    .sort((a, b) => a.top - b.top || a.left - b.left)
    .map((m) => m.range);
}

async function cmdRead(o) {
  const { src, book, lost } = await openBook(o.in);
  evaluateFormulas(book, { shared: true });
  const named = o.sheet !== undefined && o.sheet !== true;
  const wanted = named ? [sheetOf(book, o.sheet, "--sheet")] : book.worksheets;
  let budget = READ_BUDGET;
  const sheets = [];
  const unread = [];
  for (const sheet of wanted) {
    if (budget < 500) {
      unread.push(sheet.name);
      continue;
    }
    const area = readArea(o, sheet);
    const { rows, used, next } = readCells(sheet, area, budget);
    budget -= used;
    const merged = mergedRanges(sheet, area.r1, next ? next - 1 : area.r2);
    const sheetOption = `--sheet ${JSON.stringify(sheet.name)}`;
    sheets.push({
      name: sheet.name,
      size: `${sheet.rowCount} rows x ${sheet.columnCount} columns`,
      ...(merged.length ? { merged: merged.slice(0, 60) } : {}),
      rows,
      ...(next
        ? {
            more: `Rows ${next} to ${area.r2} were not shown. Read them with: ocsc-xlsx read --in ${src.rel} ${sheetOption} --from ${next}`,
          }
        : {}),
    });
    if (next) {
      for (const rest of wanted.slice(wanted.indexOf(sheet) + 1)) unread.push(rest.name);
      break;
    }
  }
  return {
    ok: true,
    file: src.rel,
    workbook: book.worksheets.map((s) => `${s.name} (${s.rowCount} rows x ${s.columnCount} columns)`),
    sheets,
    ...(unread.length
      ? { unread: `Not read yet: ${unread.join(", ")}. Read one with --sheet "<name>".` }
      : {}),
    ...(lost.length ? { warning: lostWarning(lost) } : {}),
  };
}

async function cmdEdit(o) {
  const { src, book, lost } = await openBook(o.in);
  const spec = readSpec(o.spec);
  const edits = Array.isArray(spec) ? spec : Array.isArray(spec.edits) ? spec.edits : null;
  if (!edits?.length)
    throw new UsageError(
      'The spec needs "edits": [ { "op": "set", "sheet": "...", "cell": "B4", "value": 1 } ].',
    );
  const report = [];
  edits.forEach((e, index) => {
    const where = `Edit ${index + 1} (${e?.op})`;
    switch (e?.op) {
      case "set": {
        const sheet = sheetOf(book, e.sheet, where);
        const { col, row } = address(e.cell, where);
        setCell(sheet.getRow(row).getCell(col), e.value, e.format, where);
        report.push(`${sheet.name}!${e.cell} set`);
        break;
      }
      case "set_range": {
        const sheet = sheetOf(book, e.sheet, where);
        const { col, row } = address(e.start, where);
        if (!Array.isArray(e.values))
          throw new UsageError(`${where}: values must be a list of rows.`);
        e.values.forEach((values, r) => {
          if (!Array.isArray(values))
            throw new UsageError(`${where}: row ${r + 1} must be a list.`);
          values.forEach((v, c) => {
            setCell(sheet.getRow(row + r).getCell(col + c), v, e.format, where);
          });
        });
        report.push(
          `${sheet.name}!${e.start} filled ${e.values.length} row(s)`,
        );
        break;
      }
      case "append_rows": {
        const sheet = sheetOf(book, e.sheet, where);
        if (!Array.isArray(e.rows))
          throw new UsageError(`${where}: rows must be a list of rows.`);
        const start = sheet.actualRowCount ? sheet.lastRow.number + 1 : 1;
        e.rows.forEach((values, r) => {
          const row = sheet.getRow(start + r);
          values.forEach((v, c) => {
            const format = sheet
              .getRow(Math.max(start - 1, 1))
              .getCell(c + 1).numFmt;
            setCell(
              row.getCell(c + 1),
              v,
              e.format || (start > 2 ? format : undefined),
              where,
            );
          });
        });
        report.push(
          `${sheet.name}: ${e.rows.length} row(s) added at row ${start}`,
        );
        break;
      }
      case "insert_rows": {
        const sheet = sheetOf(book, e.sheet, where);
        if (!Number.isInteger(e.at) || e.at < 1)
          throw new UsageError(`${where}: at must be a row number.`);
        if (!Array.isArray(e.rows))
          throw new UsageError(`${where}: rows must be a list of rows.`);
        const inserted = e.rows.map((values) =>
          values.map((v) => toValue(v, where)),
        );
        // Formulas in the new rows are written for their own rows already, so they are not shifted.
        sheet.insertRows(
          e.at,
          inserted.map(() => []),
          "i",
        );
        shiftRows(sheet, { at: e.at, inserted: inserted.length });
        inserted.forEach((values, r) => {
          values.forEach((v, c) => {
            setCell(sheet.getRow(e.at + r).getCell(c + 1), v, e.format, where);
          });
        });
        report.push(
          `${sheet.name}: ${inserted.length} row(s) inserted at row ${e.at}; formulas below were moved and totals ending just above now include them.`,
        );
        break;
      }
      case "delete_rows": {
        const sheet = sheetOf(book, e.sheet, where);
        e.from ??= e.row ?? e.at;
        if (!Number.isInteger(e.from) || e.from < 1)
          throw new UsageError(`${where}: from must be a row number.`);
        const count = Number.isInteger(e.count) && e.count > 0 ? e.count : 1;
        sheet.spliceRows(e.from, count);
        const broken = shiftRows(sheet, { at: e.from, removed: count });
        report.push(
          `${sheet.name}: ${count} row(s) removed from row ${e.from}${broken ? `; ${broken} formula(s) referred to a removed cell and now show #REF!` : ""}.`,
        );
        break;
      }
      case "add_sheet": {
        const name = String(e.name || "").slice(0, 31);
        if (!name) throw new UsageError(`${where}: name is required.`);
        if (book.getWorksheet(name))
          throw new UsageError(
            `${where}: there is already a sheet called ${JSON.stringify(name)}.`,
          );
        fillSheet(book.addWorksheet(name), e, where);
        report.push(`sheet ${name} added`);
        break;
      }
      case "delete_sheet": {
        const sheet = sheetOf(book, e.sheet, where);
        if (book.worksheets.length === 1)
          throw new UsageError(
            `${where}: a workbook must keep at least one sheet.`,
          );
        book.removeWorksheet(sheet.id);
        report.push(`sheet ${sheet.name} removed`);
        break;
      }
      case "rename_sheet": {
        const sheet = sheetOf(book, e.sheet, where);
        const name = String(e.name || "").slice(0, 31);
        if (!name) throw new UsageError(`${where}: name is required.`);
        report.push(`sheet ${sheet.name} renamed to ${name}`);
        sheet.name = name;
        break;
      }
      case "set_column": {
        const sheet = sheetOf(book, e.sheet, where);
        const column = sheet.getColumn(columnIndex(e.column, where));
        if (e.width) column.width = Number(e.width);
        if (e.format) {
          column.eachCell({ includeEmpty: false }, (cell, row) => {
            if (row > 1 || typeof cell.value === "number")
              cell.numFmt = e.format;
          });
        }
        if (e.header !== undefined) {
          sheet.getRow(1).getCell(column.number).value = e.header;
          styleHeader(sheet.getRow(1));
        }
        report.push(`${sheet.name} column ${column.letter} updated`);
        break;
      }
      default:
        throw new UsageError(
          `${where}: op must be set, set_range, append_rows, insert_rows, delete_rows, add_sheet, delete_sheet, rename_sheet or set_column.`,
        );
    }
  });
  const out = o.out ? outFile(o.out) : src;
  const formulas = await save(book, out);
  return {
    ok: true,
    edits: report,
    ...describe(formulas),
    ...(lost.length ? { warning: lostWarning(lost) } : {}),
    ...downloadLink(out.rel),
  };
}

const USAGE = `ocsc-xlsx new --spec book.json --out outputs/X.xlsx
ocsc-xlsx read --in X.xlsx [--sheet NAME] [--range A1:K40 | --from ROW [--rows N]]
ocsc-xlsx edit --in X.xlsx --spec edits.json [--out outputs/Y.xlsx]
read lists non-empty cells by row and column letter; a long sheet is read in parts, each ending with the command for the next part.
edits.json: {"edits":[{"op":"set","sheet":"Summary","cell":"B3","value":950}]}
ops: set {sheet,cell,value,format?}, set_range {sheet,start,values:[[...]]}, append_rows {sheet,rows:[[...]]},
insert_rows {sheet,at,rows:[[...]]}, delete_rows {sheet,from,count?}, add_sheet {name,columns?,rows?},
delete_sheet {sheet}, rename_sheet {sheet,name}, set_column {sheet,column,width?,format?}
A value is text, a number, true/false, null, {"formula":"SUM(B2:B9)"} or {"date":"2026-10-22"}.`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const o = args(rest);
  if (!command || command === "help" || command === "--help" || o.help) {
    process.stdout.write(`${JSON.stringify({ ok: true, usage: USAGE }, null, 2)}\n`);
    return;
  }
  try {
    let result;
    if (command === "new") result = await cmdNew(o);
    else if (command === "read") result = await cmdRead(o);
    else if (command === "edit") result = await cmdEdit(o);
    else throw new UsageError(`Usage:\n${USAGE}`);
    if (command !== "read")
      Object.assign(
        result,
        await showOnScreen(resolve(WORKSPACE, result.path), result.path),
      );
    process.stdout.write(
      command === "read"
        ? `${JSON.stringify(result).replace(/,"(\d+)":\{/g, ',\n"$1":{')}\n`
        : `${JSON.stringify(result, null, 2)}\n`,
    );
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: error instanceof UsageError ? error.message : String(error?.stack || error) }, null, 2)}\n`,
    );
    process.exit(1);
  }
}

main();
