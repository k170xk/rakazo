/**
 * Table-cell filling and direct cell editing for Word documents.
 * Reference forms, questionnaires and engineering tables use "Label | blank" rows and rating grids
 * rather than {{placeholders}}.
 */

import { firstElement } from "./word-paragraphs.mjs";

const NESTED_TR_RE = /<w:tr(?=[\s>])/;
const NESTED_TBL_RE = /<w:tbl(?=[\s>])/;

function closeOf(xml, from, tag) {
  const open = new RegExp(`<w:${tag}(?=[\\s>/])`, "g");
  const close = `</w:${tag}>`;
  const selfClose = xml.slice(from, xml.indexOf(">", from) + 1);
  if (selfClose.endsWith("/>")) return from + selfClose.length;
  let depth = 0;
  let i = from;
  while (i < xml.length) {
    open.lastIndex = i;
    const o = open.exec(xml);
    const c = xml.indexOf(close, i);
    if (c < 0) return xml.length;
    if (o && o.index < c) {
      const gt = xml.indexOf(">", o.index);
      if (xml[gt - 1] !== "/") depth += 1;
      i = gt + 1;
    } else {
      depth -= 1;
      i = c + close.length;
      if (depth === 0) return i;
    }
  }
  return xml.length;
}

function outermost(xml, tag) {
  const out = [];
  const re = new RegExp(`<w:${tag}(?=[\\s>/])`, "g");
  let i = 0;
  for (;;) {
    re.lastIndex = i;
    const m = re.exec(xml);
    if (!m) break;
    const end = closeOf(xml, m.index, tag);
    out.push({ from: m.index, to: end, xml: xml.slice(m.index, end) });
    i = end;
  }
  return out;
}

function textOf(xml) {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
    .map((m) =>
      m[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'"),
    )
    .join("");
}

function esc(text) {
  return String(text)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Straightens apostrophes and quotes, drops one trailing colon, and ignores case and spacing. */
export function labelKey(text) {
  return String(text ?? "")
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/:$/, "")
    .trim()
    .toLowerCase();
}

function writeCell(tc, text) {
  const tcPr = firstElement(tc, "tcPr");
  const p = /<w:p(?=[\s>])[\s\S]*?<\/w:p>/.exec(tc)?.[0] ?? "";
  const pPr = firstElement(p, "pPr");
  const firstRun = /<w:r(?=[\s>])[^>]*>([\s\S]*?)<\/w:r>/.exec(p)?.[1] ?? "";
  const rPr = firstElement(firstRun, "rPr") || firstElement(pPr, "rPr");
  const lines = String(text ?? "").split(/\r?\n/);
  const paragraphs = lines.map((line) => {
    const run = line
      ? `<w:r>${rPr}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`
      : "";
    return `<w:p>${pPr}${run}</w:p>`;
  });
  return `<w:tc>${tcPr}${paragraphs.join("")}</w:tc>`;
}

function directRowsOfTable(tblXml) {
  const openEnd = tblXml.indexOf(">") + 1;
  const inner = tblXml.slice(openEnd, -"</w:tbl>".length);
  return {
    openTag: tblXml.slice(0, openEnd),
    inner,
    rows: outermost(inner, "tr"),
  };
}

/**
 * Writes each field into the empty cell beside a matching label cell.
 * - For a 2-column "Label | blank" row, writes the value into the blank cell.
 * - For a multi-column rating/tick grid (e.g. "Skill | Excellent | Very Good | Good | Fair | Poor"),
 *   when the value matches a column header above, writes "✓" in that matching column.
 * - Leaves cells that already have text untouched.
 */
export function fillLabelledTableCells(xml, fields) {
  const wanted = new Map();
  for (const [name, value] of Object.entries(fields ?? {})) {
    if (value === null || value === undefined || !String(value).trim()) continue;
    const key = labelKey(name);
    if (key) wanted.set(key, { name, value: String(value) });
  }
  const filled = [];

  const walkTables = (source) => {
    let current = source;
    const tables = outermost(current, "tbl");
    let offset = 0;
    for (const tbl of tables) {
      const from = tbl.from + offset;
      const to = tbl.to + offset;
      const updated = fillOneTable(current.slice(from, to));
      if (updated !== current.slice(from, to)) {
        current = current.slice(0, from) + updated + current.slice(to);
        offset += updated.length - (to - from);
      }
    }
    return current;
  };

  const fillOneTable = (tblXml) => {
    let { openTag, inner } = directRowsOfTable(tblXml);
    let guard = 0;
    while (wanted.size && guard++ < 400) {
      let changed = false;
      let headerCols = null;
      const rows = outermost(inner, "tr");
      for (const row of rows) {
        const cells = outermost(row.xml, "tc");
        // Recurse into any nested tables inside cells first.
        let nestedChanged = false;
        let rowXml = row.xml;
        let cellOffset = 0;
        for (const cell of cells) {
          const cFrom = cell.from + cellOffset;
          const cTo = cell.to + cellOffset;
          const cXml = rowXml.slice(cFrom, cTo);
          if (NESTED_TBL_RE.test(cXml)) {
            const nextCell = walkTables(cXml);
            if (nextCell !== cXml) {
              rowXml = rowXml.slice(0, cFrom) + nextCell + rowXml.slice(cTo);
              cellOffset += nextCell.length - (cTo - cFrom);
              nestedChanged = true;
            }
          }
        }
        if (nestedChanged) {
          inner = inner.slice(0, row.from) + rowXml + inner.slice(row.to);
          changed = true;
          break;
        }

        const texts = cells.map((c) => textOf(c.xml));
        // Track a multi-column header row (e.g. "Please tick | Excellent | Very Good | Good | Fair | Poor").
        if (
          cells.length > 2 &&
          texts.slice(1).filter((t) => t.trim()).length >= 2
        ) {
          headerCols = texts.map((t) => labelKey(t));
          continue;
        }

        for (let i = 0; i < cells.length - 1; i++) {
          if (NESTED_TBL_RE.test(cells[i].xml) || NESTED_TBL_RE.test(cells[i + 1].xml)) {
            continue;
          }
          const field = wanted.get(labelKey(texts[i]));
          if (!field) continue;

          // Rating/checkbox grid: match the value against the column headers above.
          let targetIdx = i + 1;
          let cellValue = field.value;
          if (
            i === 0 &&
            cells.length > 2 &&
            headerCols &&
            headerCols.length === cells.length
          ) {
            const valKey = labelKey(field.value);
            const colMatch = headerCols.findIndex((h, idx) => idx > 0 && h === valKey);
            if (colMatch > 0) {
              targetIdx = colMatch;
              cellValue = "✓";
            }
          }

          if (texts[targetIdx].trim()) continue;
          const answer = writeCell(cells[targetIdx].xml, cellValue);
          const rowNext =
            row.xml.slice(0, cells[targetIdx].from) +
            answer +
            row.xml.slice(cells[targetIdx].to);
          inner = inner.slice(0, row.from) + rowNext + inner.slice(row.to);
          filled.push(field.name);
          wanted.delete(labelKey(field.name));
          changed = true;
          break;
        }
        if (changed) break;
      }
      if (!changed) break;
    }
    return `${openTag}${inner}</w:tbl>`;
  };

  // Fallback for fragments passed directly in unit tests without an enclosing <w:tbl>.
  if (!NESTED_TBL_RE.test(xml) && NESTED_TR_RE.test(xml)) {
    const wrapped = fillOneTable(`<w:tbl>${xml}</w:tbl>`);
    return {
      xml: wrapped.slice("<w:tbl>".length, -"</w:tbl>".length),
      filled,
    };
  }

  return { xml: walkTables(xml), filled };
}

/**
 * Sets one table cell directly, either by (table, row, column) indices (0-based) or by matching a
 * row's label cell (with optional 1-based `occurrence` for repeated labels like "Comments", and
 * optional `column` index or header name). Overwrites existing cell text.
 */
export function setTableCell(xml, op) {
  const text = String(op.text ?? op.value ?? "");
  const tables = outermost(xml, "tbl");
  if (!tables.length) {
    return { xml, updated: false, reason: "Document has no tables." };
  }

  // Mode 1: explicit (table, row, column) coordinates.
  if (typeof op.row === "number") {
    const tIdx = typeof op.table === "number" ? op.table : 0;
    const colIdx = typeof op.column === "number" ? op.column : typeof op.col === "number" ? op.col : 1;
    const tbl = tables[tIdx];
    if (!tbl) {
      return { xml, updated: false, reason: `Table ${tIdx} not found (document has ${tables.length}).` };
    }
    const { openTag, inner, rows } = directRowsOfTable(tbl.xml);
    const row = rows[op.row];
    if (!row) {
      return { xml, updated: false, reason: `Row ${op.row} not found in table ${tIdx} (has ${rows.length} rows).` };
    }
    const cells = outermost(row.xml, "tc");
    const cell = cells[colIdx];
    if (!cell) {
      return { xml, updated: false, reason: `Column ${colIdx} not found in row ${op.row} (has ${cells.length} cells).` };
    }
    const answer = writeCell(cell.xml, text);
    const nextRow = row.xml.slice(0, cell.from) + answer + row.xml.slice(cell.to);
    const nextInner = inner.slice(0, row.from) + nextRow + inner.slice(row.to);
    const nextXml = xml.slice(0, tbl.from) + openTag + nextInner + "</w:tbl>" + xml.slice(tbl.to);
    return {
      xml: nextXml,
      updated: true,
      summary: `Set table ${tIdx} row ${op.row} col ${colIdx}`,
    };
  }

  // Mode 2: match by label (with optional occurrence and column index or column header name).
  const targetLabel = labelKey(op.label ?? op.find ?? "");
  if (!targetLabel) {
    return {
      xml,
      updated: false,
      reason: 'set_table_cell needs either "row" and "column", or "label".',
    };
  }
  const wantedOcc = typeof op.occurrence === "number" && op.occurrence >= 1 ? Math.floor(op.occurrence) : 1;
  const colSpec = op.column ?? op.col;
  let seen = 0;

  for (let tIdx = 0; tIdx < tables.length; tIdx++) {
    const tbl = tables[tIdx];
    const { openTag, inner, rows } = directRowsOfTable(tbl.xml);
    let headerCols = null;
    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const row = rows[rIdx];
      const cells = outermost(row.xml, "tc");
      const texts = cells.map((c) => textOf(c.xml));
      if (cells.length > 2 && texts.slice(1).filter((t) => t.trim()).length >= 2) {
        headerCols = texts.map((t) => labelKey(t));
      }
      const matchIdx = texts.findIndex((t, idx) => idx < cells.length - 1 && labelKey(t) === targetLabel);
      if (matchIdx < 0) continue;
      seen += 1;
      if (seen !== wantedOcc) continue;

      let targetCol = matchIdx + 1;
      let cellText = text;
      if (typeof colSpec === "number") {
        targetCol = colSpec;
      } else if (typeof colSpec === "string" && headerCols && headerCols.length === cells.length) {
        const byHeader = headerCols.findIndex((h) => h === labelKey(colSpec));
        if (byHeader >= 0) targetCol = byHeader;
      } else if (
        matchIdx === 0 &&
        cells.length > 2 &&
        headerCols &&
        headerCols.length === cells.length
      ) {
        const byVal = headerCols.findIndex((h, idx) => idx > 0 && h === labelKey(text));
        if (byVal > 0) {
          targetCol = byVal;
          cellText = "✓";
        }
      }

      const cell = cells[targetCol];
      if (!cell) {
        return {
          xml,
          updated: false,
          reason: `Column ${targetCol} not found for label ${JSON.stringify(op.label ?? op.find)}.`,
        };
      }
      const answer = writeCell(cell.xml, cellText);
      const nextRow = row.xml.slice(0, cell.from) + answer + row.xml.slice(cell.to);
      const nextInner = inner.slice(0, row.from) + nextRow + inner.slice(row.to);
      const nextXml = xml.slice(0, tbl.from) + openTag + nextInner + "</w:tbl>" + xml.slice(tbl.to);
      return {
        xml: nextXml,
        updated: true,
        summary: `Set cell beside "${op.label ?? op.find}" (table ${tIdx}, row ${rIdx}, col ${targetCol})`,
      };
    }
  }

  return {
    xml,
    updated: false,
    reason: `Table label not found: ${JSON.stringify(op.label ?? op.find)} (occurrence ${wantedOcc}).`,
  };
}

/**
 * Fills Word Content Controls (`<w:sdt>`) whose `<w:tag w:val="..."/>` or `<w:alias w:val="..."/>`
 * matches a field key. Supports text controls and `<w14:checkbox>` controls.
 */
export function fillContentControls(xml, fields) {
  if (!xml.includes("<w:sdt")) return { xml, filled: [] };
  const wanted = new Map();
  for (const [name, value] of Object.entries(fields ?? {})) {
    if (value === null || value === undefined || String(value) === "") continue;
    const key = labelKey(name);
    if (key) wanted.set(key, { name, value });
  }
  if (!wanted.size) return { xml, filled: [] };
  const filled = [];
  const sdts = outermost(xml, "sdt");
  let out = "";
  let last = 0;
  for (const sdt of sdts) {
    out += xml.slice(last, sdt.from);
    last = sdt.to;
    const pr = firstElement(sdt.xml, "sdtPr");
    const content = firstElement(sdt.xml, "sdtContent");
    const tagVal = /<w:tag\b[^>]*w:val="([^"]*)"/.exec(pr)?.[1] ?? "";
    const aliasVal = /<w:alias\b[^>]*w:val="([^"]*)"/.exec(pr)?.[1] ?? "";
    const match = wanted.get(labelKey(tagVal)) ?? wanted.get(labelKey(aliasVal));
    if (!match || !content) {
      // Recurse into nested content controls inside this sdtContent if any
      if (content && content.includes("<w:sdt")) {
        const innerStart = sdt.xml.indexOf(content);
        const innerContent = content.slice("<w:sdtContent>".length, -"</w:sdtContent>".length);
        const sub = fillContentControls(innerContent, fields);
        if (sub.filled.length) {
          filled.push(...sub.filled);
          out +=
            sdt.xml.slice(0, innerStart) +
            `<w:sdtContent>${sub.xml}</w:sdtContent>` +
            sdt.xml.slice(innerStart + content.length);
          continue;
        }
      }
      out += sdt.xml;
      continue;
    }

    let nextSdt = sdt.xml;
    const isCheckbox = /<w14:checkbox\b/.test(pr);
    if (isCheckbox) {
      const checked = /^(?:true|yes|1|checked|x|✓|☑)$/i.test(String(match.value).trim());
      nextSdt = nextSdt.replace(
        /<w14:checked\b[^>]*w14:val="[01]"[^>]*\/>/,
        `<w14:checked w14:val="${checked ? "1" : "0"}"/>`,
      );
      const glyph = checked ? "☒" : "☐";
      const updatedContent = content.replace(
        /<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/,
        `<w:t>${glyph}</w:t>`,
      );
      nextSdt = nextSdt.replace(content, updatedContent);
      filled.push(match.name);
      out += nextSdt;
      continue;
    }

    // Text content control: preserve pPr/rPr and replace text inside <w:sdtContent>
    const strVal = String(match.value);
    const hasPara = /<w:p(?=[\s>])/.test(content);
    let updatedContent;
    if (hasPara) {
      const p = /<w:p(?=[\s>])[\s\S]*?<\/w:p>/.exec(content)?.[0] ?? "";
      const pPr = firstElement(p, "pPr");
      const firstRun = /<w:r(?=[\s>])[^>]*>([\s\S]*?)<\/w:r>/.exec(p)?.[1] ?? "";
      const rPr = firstElement(firstRun, "rPr") || firstElement(pPr, "rPr");
      const lines = strVal.split(/\r?\n/);
      const paras = lines
        .map((line) => `<w:p>${pPr}${line ? `<w:r>${rPr}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>` : ""}</w:p>`)
        .join("");
      updatedContent = `<w:sdtContent>${paras}</w:sdtContent>`;
    } else {
      const firstRun = /<w:r(?=[\s>])[^>]*>([\s\S]*?)<\/w:r>/.exec(content)?.[1] ?? "";
      const rPr = firstElement(firstRun, "rPr");
      updatedContent = `<w:sdtContent><w:r>${rPr}<w:t xml:space="preserve">${esc(strVal)}</w:t></w:r></w:sdtContent>`;
    }
    // Remove <w:showingPlcHdr/> if present so Word doesn't treat the filled value as placeholder
    nextSdt = nextSdt
      .replace(/<w:showingPlcHdr\s*\/>/g, "")
      .replace(content, updatedContent);
    filled.push(match.name);
    out += nextSdt;
  }
  out += xml.slice(last);
  return { xml: out, filled };
}

/**
 * Adds a row to a Word table by cloning the template row's formatting/borders/widths.
 * Supports `{ table?: 0, cells: [...], after_row?: N }`.
 */
export function addTableRow(xml, op) {
  const values = Array.isArray(op.cells) ? op.cells : Array.isArray(op.values) ? op.values : null;
  if (!values?.length) {
    return { xml, updated: false, reason: 'add_table_row needs "cells", a non-empty list of cell strings.' };
  }
  const tables = outermost(xml, "tbl");
  if (!tables.length) return { xml, updated: false, reason: "Document has no tables." };
  const tIdx = typeof op.table === "number" ? op.table : 0;
  const tbl = tables[tIdx];
  if (!tbl) {
    return { xml, updated: false, reason: `Table ${tIdx} not found (document has ${tables.length}).` };
  }
  const { openTag, inner, rows } = directRowsOfTable(tbl.xml);
  if (!rows.length) return { xml, updated: false, reason: `Table ${tIdx} has no rows to clone.` };
  const afterIdx =
    typeof op.after_row === "number"
      ? Math.max(0, Math.min(op.after_row, rows.length - 1))
      : rows.length - 1;
  const templateRow = rows[afterIdx];
  const cells = outermost(templateRow.xml, "tc");
  if (!cells.length) return { xml, updated: false, reason: `Template row ${afterIdx} has no cells.` };
  // Build new row from template row, stripping any <w:tblHeader/> so cloned header rows don't repeat as headers
  let newRow = templateRow.xml.replace(/<w:tblHeader\b[^>]*\/>/g, "");
  const newCells = outermost(newRow, "tc");
  let built = "";
  let last = 0;
  for (let i = 0; i < newCells.length; i += 1) {
    built += newRow.slice(last, newCells[i].from);
    last = newCells[i].to;
    const val = i < values.length ? String(values[i] ?? "") : "";
    built += writeCell(newCells[i].xml, val);
  }
  built += newRow.slice(last);
  const nextInner = inner.slice(0, templateRow.to) + built + inner.slice(templateRow.to);
  const nextXml = xml.slice(0, tbl.from) + openTag + nextInner + "</w:tbl>" + xml.slice(tbl.to);
  return {
    xml: nextXml,
    updated: true,
    summary: `Added row after row ${afterIdx} in table ${tIdx} (${newCells.length} cells)`,
  };
}

/**
 * Deletes one row from a Word table by `{ table?: 0, row: N }` or `{ label: "...", occurrence?: 1 }`.
 * Refuses to delete the last remaining row (Word treats an empty table as corrupt).
 */
export function deleteTableRow(xml, op) {
  const tables = outermost(xml, "tbl");
  if (!tables.length) return { xml, updated: false, reason: "Document has no tables." };

  if (typeof op.row === "number") {
    const tIdx = typeof op.table === "number" ? op.table : 0;
    const tbl = tables[tIdx];
    if (!tbl) {
      return { xml, updated: false, reason: `Table ${tIdx} not found (document has ${tables.length}).` };
    }
    const { openTag, inner, rows } = directRowsOfTable(tbl.xml);
    if (rows.length <= 1) {
      return { xml, updated: false, reason: `Cannot delete the only remaining row in table ${tIdx}.` };
    }
    const row = rows[op.row];
    if (!row) {
      return { xml, updated: false, reason: `Row ${op.row} not found in table ${tIdx} (has ${rows.length} rows).` };
    }
    const nextInner = inner.slice(0, row.from) + inner.slice(row.to);
    const nextXml = xml.slice(0, tbl.from) + openTag + nextInner + "</w:tbl>" + xml.slice(tbl.to);
    return {
      xml: nextXml,
      updated: true,
      summary: `Deleted row ${op.row} from table ${tIdx}`,
    };
  }

  const targetLabel = labelKey(op.label ?? op.find ?? "");
  if (!targetLabel) {
    return { xml, updated: false, reason: 'delete_table_row needs either "row" or "label".' };
  }
  const wantedOcc = typeof op.occurrence === "number" && op.occurrence >= 1 ? Math.floor(op.occurrence) : 1;
  let seen = 0;
  for (let tIdx = 0; tIdx < tables.length; tIdx += 1) {
    const tbl = tables[tIdx];
    const { openTag, inner, rows } = directRowsOfTable(tbl.xml);
    for (let rIdx = 0; rIdx < rows.length; rIdx += 1) {
      const cells = outermost(rows[rIdx].xml, "tc");
      const matched = cells.some((c) => labelKey(textOf(c.xml)) === targetLabel);
      if (!matched) continue;
      seen += 1;
      if (seen !== wantedOcc) continue;
      if (rows.length <= 1) {
        return { xml, updated: false, reason: `Cannot delete the only remaining row in table ${tIdx}.` };
      }
      const nextInner = inner.slice(0, rows[rIdx].from) + inner.slice(rows[rIdx].to);
      const nextXml = xml.slice(0, tbl.from) + openTag + nextInner + "</w:tbl>" + xml.slice(tbl.to);
      return {
        xml: nextXml,
        updated: true,
        summary: `Deleted row matching "${op.label ?? op.find}" (table ${tIdx}, row ${rIdx})`,
      };
    }
  }
  return {
    xml,
    updated: false,
    reason: `Table row matching ${JSON.stringify(op.label ?? op.find)} not found.`,
  };
}
