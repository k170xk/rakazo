#!/usr/bin/env node
/**
 * OCSC Excel: build, read and edit Excel workbooks on a Bot's computer.
 *
 *   ocsc-xlsx new  --spec book.json --out outputs/Costs.xlsx
 *   ocsc-xlsx read --in outputs/Costs.xlsx [--sheet Summary] [--rows 200]
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
import { cellText, showOnScreen } from "./screen.mjs";

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
  if (!/\.xlsx$/i.test(src.full))
    throw new UsageError("--in must be an .xlsx file.");
  if (statSync(src.full).size > MAX_INPUT_BYTES)
    throw new UsageError(`${src.rel} is larger than 40 MB.`);
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.readFile(src.full);
  } catch (error) {
    throw new UsageError(
      `${src.rel} could not be opened as an Excel workbook: ${error.message}`,
    );
  }
  return { src, book };
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
  const sheet =
    typeof name === "number"
      ? book.worksheets[name - 1]
      : book.getWorksheet(String(name ?? ""));
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
function evaluateFormulas(book) {
  let computed = 0;
  let left = 0;
  for (const sheet of book.worksheets) {
    const memo = new Map();
    const valueAt = (col, row, stack) => {
      const key = `${col}:${row}`;
      if (memo.has(key)) return memo.get(key);
      if (stack.has(key)) throw new Error("circular");
      const cell = sheet.getRow(row).getCell(col);
      const v = cell.value;
      let out;
      if (v && typeof v === "object" && "formula" in v) {
        stack.add(key);
        out = evaluate(v.formula, stack);
        stack.delete(key);
      } else if (v && typeof v === "object" && "result" in v) out = v.result;
      else out = v;
      memo.set(key, out);
      return out;
    };
    const evaluate = (formula, stack) => {
      const tokens =
        String(formula).match(
          /\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|[A-Za-z]+(?=\()|\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|[-+*/^(),%]|\S/g,
        ) || [];
      let i = 0;
      const peek = () => tokens[i];
      const take = () => tokens[i++];
      const cellRef = (t) => {
        const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(t);
        return {
          col: columnIndex(m[1].toUpperCase(), "formula"),
          row: Number(m[2]),
        };
      };
      const rangeValues = (t) => {
        const [a, b] = t.split(":").map(cellRef);
        const out = [];
        for (
          let r = Math.min(a.row, b.row);
          r <= Math.max(a.row, b.row);
          r += 1
        ) {
          for (
            let c = Math.min(a.col, b.col);
            c <= Math.max(a.col, b.col);
            c += 1
          )
            out.push(valueAt(c, r, stack));
        }
        if (out.length > 200000) throw new Error("range too large");
        return out;
      };
      const num = (v) => {
        if (typeof v === "number") return v;
        if (v === null || v === undefined || v === "") return 0;
        if (typeof v === "boolean") return v ? 1 : 0;
        throw new Error("not a number");
      };
      const FUNCS = {
        SUM: (xs) =>
          xs.filter((x) => typeof x === "number").reduce((a, b) => a + b, 0),
        AVERAGE: (xs) => {
          const n = xs.filter((x) => typeof x === "number");
          if (!n.length) throw new Error("no values");
          return n.reduce((a, b) => a + b, 0) / n.length;
        },
        MIN: (xs) => Math.min(...xs.filter((x) => typeof x === "number")),
        MAX: (xs) => Math.max(...xs.filter((x) => typeof x === "number")),
        COUNT: (xs) => xs.filter((x) => typeof x === "number").length,
        ROUND: (xs) => {
          const f = 10 ** num(xs[1] ?? 0);
          return Math.round(num(xs[0]) * f) / f;
        },
        ABS: (xs) => Math.abs(num(xs[0])),
      };
      const primary = () => {
        const t = take();
        if (t === undefined) throw new Error("end");
        if (t === "(") {
          const v = expr();
          if (take() !== ")") throw new Error("paren");
          return v;
        }
        if (t === "-") return -num(primary());
        if (t === "+") return num(primary());
        if (/^\d/.test(t)) return Number(t);
        if (/^[A-Za-z]+$/.test(t) && peek() === "(") {
          const fn = FUNCS[t.toUpperCase()];
          if (!fn) throw new Error("function");
          take();
          const xs = [];
          if (peek() !== ")") {
            for (;;) {
              if (/:/.test(peek() ?? "")) xs.push(...rangeValues(take()));
              else xs.push(expr());
              if (peek() === ",") take();
              else break;
            }
          }
          if (take() !== ")") throw new Error("paren");
          return fn(xs);
        }
        if (/^\$?[A-Za-z]{1,3}\$?\d+$/.test(t)) {
          const { col, row } = cellRef(t);
          return num(valueAt(col, row, stack));
        }
        throw new Error("token");
      };
      const postfix = () => {
        let v = primary();
        while (peek() === "%") {
          take();
          v = num(v) / 100;
        }
        return v;
      };
      const power = () => {
        let v = postfix();
        while (peek() === "^") {
          take();
          v = num(v) ** num(postfix());
        }
        return v;
      };
      const term = () => {
        let v = power();
        while (peek() === "*" || peek() === "/") {
          const op = take();
          const r = num(power());
          if (op === "/" && r === 0) throw new Error("div0");
          v = op === "*" ? num(v) * r : num(v) / r;
        }
        return v;
      };
      const expr = () => {
        let v = term();
        while (peek() === "+" || peek() === "-") {
          const op = take();
          const r = num(term());
          v = op === "+" ? num(v) + r : num(v) - r;
        }
        return v;
      };
      const v = expr();
      if (i !== tokens.length) throw new Error("trailing");
      return v;
    };
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        if (!v || typeof v !== "object" || !("formula" in v) || v.sharedFormula)
          return;
        try {
          const result = evaluate(v.formula, new Set());
          if (typeof result === "number" && Number.isFinite(result)) {
            cell.value = { formula: v.formula, result };
            computed += 1;
            return;
          }
        } catch {}
        left += 1;
      });
    });
  }
  return { computed, left };
}

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

async function cmdRead(o) {
  const { src, book } = await openBook(o.in);
  const limit = Math.min(Math.max(Number(o.rows) || 200, 1), 2000);
  const wanted =
    o.sheet === undefined || o.sheet === true
      ? book.worksheets
      : [sheetOf(book, o.sheet, "--sheet")];
  return {
    ok: true,
    file: src.rel,
    sheets: wanted.map((sheet) => {
      const rows = [];
      const formulas = {};
      for (let r = 1; r <= Math.min(sheet.rowCount, limit); r += 1) {
        const row = sheet.getRow(r);
        const values = [];
        for (let c = 1; c <= Math.min(sheet.columnCount, 60); c += 1) {
          const cell = row.getCell(c);
          values.push(cellText(cell));
          if (
            cell.value &&
            typeof cell.value === "object" &&
            "formula" in cell.value
          ) {
            formulas[cell.address] = `=${cell.value.formula}`;
          }
        }
        while (values.length && values[values.length - 1] === "") values.pop();
        rows.push(values);
      }
      return {
        name: sheet.name,
        size: `${sheet.rowCount} rows x ${sheet.columnCount} columns`,
        rows,
        ...(Object.keys(formulas).length ? { formulas } : {}),
        ...(sheet.rowCount > limit
          ? { more_rows: sheet.rowCount - limit }
          : {}),
      };
    }),
  };
}

async function cmdEdit(o) {
  const { src, book } = await openBook(o.in);
  const spec = readSpec(o.spec);
  const edits = Array.isArray(spec.edits) ? spec.edits : null;
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
    ...downloadLink(out.rel),
  };
}

const USAGE = `ocsc-xlsx new --spec book.json --out outputs/X.xlsx
ocsc-xlsx read --in outputs/X.xlsx [--sheet NAME] [--rows 200]
ocsc-xlsx edit --in outputs/X.xlsx --spec edits.json [--out outputs/Y.xlsx]`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const o = args(rest);
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
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: error instanceof UsageError ? error.message : String(error?.stack || error) }, null, 2)}\n`,
    );
    process.exit(1);
  }
}

main();
