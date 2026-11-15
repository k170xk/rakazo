/**
 * What ExcelJS drops when it saves a workbook: charts, drawings, pivot tables, slicers and macros.
 * These are copied back from the file that was opened, and a new chart is written as its own parts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import JSZip from "jszip";
import { cellRange } from "./format-edits.mjs";

const MACRO = "application/vnd.ms-excel.sheet.macroEnabled.main+xml";
const SHEET_MAIN = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const CHART_TYPE = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";
const DRAWING_TYPE = "application/vnd.openxmlformats-officedocument.drawing+xml";
const DRAWING_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";
const CHART_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";
const VBA_REL = "http://schemas.microsoft.com/office/2006/relationships/vbaProject";
const EXTRA_REL = /drawing|chart|pivot|table|vml|comment|printerSettings|vba|slicer|ctrlProp|activeX/i;

function esc(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function columnLetter(n) {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function quoteSheet(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function abs(col, row) {
  return `$${columnLetter(col)}$${row}`;
}

function emptyRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
}

function ensureRel(relsXml, type, target, preferredId) {
  const xml = relsXml || emptyRels();
  const existing = [...xml.matchAll(/<Relationship\b[^>]*\/>/g)]
    .map((m) => m[0])
    .find((tag) => tag.includes(`Target="${target}"`) && tag.includes(`Type="${type}"`));
  if (existing) return { xml, id: /\bId="([^"]+)"/.exec(existing)?.[1] };
  const ids = [...xml.matchAll(/\bId="rId(\d+)"/g)].map((m) => Number(m[1]));
  const preferred = preferredId && !xml.includes(`Id="${preferredId}"`) ? preferredId : null;
  const id = preferred ?? `rId${Math.max(0, ...ids) + 1}`;
  return {
    xml: xml.replace("</Relationships>", `<Relationship Id="${id}" Type="${type}" Target="${target}"/></Relationships>`),
    id,
  };
}

function resolveTarget(sourcePart, target) {
  if (target.startsWith("/")) return target.slice(1);
  const dir = sourcePart.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "..") dir.pop();
    else if (part !== ".") dir.push(part);
  }
  return dir.join("/");
}

async function copyPart(src, out, name, copied) {
  if (!name || name.endsWith("/") || out.files[name] || !src.files[name] || src.files[name].dir) return;
  out.file(name, await src.files[name].async("uint8array"));
  copied.push(name);
  const rels = name.replace(/([^/]+)$/, "_rels/$1.rels");
  if (!src.files[rels]) return;
  await copyPart(src, out, rels, copied);
  const text = await src.file(rels).async("string");
  for (const tag of text.match(/<Relationship\b[^>]*\/>/g) ?? []) {
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    if (target && !/^https?:/i.test(target)) await copyPart(src, out, resolveTarget(name, target), copied);
  }
}

async function mergeContentTypes(src, out, copied) {
  const srcTypes = await src.file("[Content_Types].xml")?.async("string");
  let types = await out.file("[Content_Types].xml")?.async("string");
  if (!srcTypes || !types) return;
  for (const name of copied) {
    const part = `/${name}`;
    const override = new RegExp(`<Override\\b[^>]*PartName="${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*/>`).exec(
      srcTypes,
    )?.[0];
    if (override && !types.includes(`PartName="${part}"`)) types = types.replace("</Types>", `${override}</Types>`);
  }
  out.file("[Content_Types].xml", types);
}

async function copyMissingRels(src, out, relsPath, sourcePart, copied) {
  const original = await src.file(relsPath)?.async("string");
  if (!original) return;
  let current = (await out.file(relsPath)?.async("string")) ?? emptyRels();
  for (const tag of original.match(/<Relationship\b[^>]*\/>/g) ?? []) {
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    const type = /\bType="([^"]+)"/.exec(tag)?.[1];
    if (!target || !type || !EXTRA_REL.test(`${type} ${target}`)) continue;
    if (current.includes(`Target="${target}"`)) continue;
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const added = ensureRel(current, type, target, id);
    current = added.xml;
    await copyPart(src, out, resolveTarget(sourcePart, target), copied);
  }
  out.file(relsPath, current);
}

function putBack(xml, tag) {
  if (!tag || xml.includes(tag.slice(0, Math.min(tag.indexOf(" "), 24)))) return xml;
  const name = /<(\w+)/.exec(tag)?.[1];
  if (name && new RegExp(`<${name}\\b`).test(xml)) return xml;
  return xml.replace("</worksheet>", `${tag}</worksheet>`);
}

/** Copies charts, drawings, pivot tables, slicers and macros back onto an ExcelJS save. */
export async function restoreOfficeParts(originalBytes, savedBytes) {
  const src = await JSZip.loadAsync(originalBytes);
  const out = await JSZip.loadAsync(savedBytes);
  const copied = [];
  await copyMissingRels(src, out, "xl/_rels/workbook.xml.rels", "xl/workbook.xml", copied);
  const originalBook = await src.file("xl/workbook.xml")?.async("string");
  let book = await out.file("xl/workbook.xml")?.async("string");
  const caches = originalBook && /<pivotCaches\b[\s\S]*?<\/pivotCaches>/.exec(originalBook)?.[0];
  if (caches && book && !book.includes("<pivotCaches")) {
    out.file("xl/workbook.xml", book.replace("</workbook>", `${caches}</workbook>`));
  }
  for (const name of Object.keys(src.files)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
    const relsPath = name.replace("xl/worksheets/", "xl/worksheets/_rels/") + ".rels";
    await copyMissingRels(src, out, relsPath, name, copied);
    const original = await src.file(name).async("string");
    let current = await out.file(name)?.async("string");
    if (!current) continue;
    for (const element of ["drawing", "legacyDrawing", "picture", "tableParts"]) {
      const block =
        element === "tableParts"
          ? /<tableParts\b[\s\S]*?<\/tableParts>/.exec(original)?.[0]
          : new RegExp(`<${element}\\b[^>]*/>`).exec(original)?.[0];
      current = putBack(current, block);
    }
    out.file(name, current);
  }
  const srcTypes = await src.file("[Content_Types].xml")?.async("string");
  if (srcTypes?.includes(MACRO) && src.files["xl/vbaProject.bin"]) {
    await copyPart(src, out, "xl/vbaProject.bin", copied);
    let types = await out.file("[Content_Types].xml").async("string");
    if (types.includes(SHEET_MAIN)) types = types.replace(SHEET_MAIN, MACRO);
    out.file("[Content_Types].xml", types);
    const rels = await out.file("xl/_rels/workbook.xml.rels").async("string");
    const added = ensureRel(rels, VBA_REL, "vbaProject.bin");
    out.file("xl/_rels/workbook.xml.rels", added.xml);
  }
  await mergeContentTypes(src, out, copied);
  const kept = [];
  if (copied.some((n) => n.startsWith("xl/charts/"))) kept.push("chart");
  if (copied.some((n) => n.startsWith("xl/pivot"))) kept.push("pivot table");
  if (copied.some((n) => n.startsWith("xl/slicers/"))) kept.push("slicer");
  if (copied.includes("xl/vbaProject.bin")) kept.push("macro project");
  return { buffer: await out.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), kept };
}

function chartBody(type, series) {
  const ax = `<c:axId val="10"/><c:axId val="20"/>`;
  const axes = `<c:catAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorTickMark val="out"/><c:tickLblPos val="nextTo"/><c:crossAx val="20"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:majorTickMark val="out"/><c:tickLblPos val="nextTo"/><c:crossAx val="10"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
  if (type === "pie") return `<c:pieChart><c:varyColors val="1"/>${series}</c:pieChart>`;
  if (type === "line") return `<c:lineChart><c:grouping val="standard"/>${series}${ax}</c:lineChart>${axes}`;
  const dir = type === "bar" ? "bar" : "col";
  return `<c:barChart><c:barDir val="${dir}"/><c:grouping val="clustered"/>${series}${ax}</c:barChart>${axes}`;
}

function chartXml({ type, title, sheet, area }) {
  const quoted = quoteSheet(sheet);
  const series = [];
  for (let col = area.c1 + 1, i = 0; col <= area.c2; col += 1, i += 1) {
    const name = `${quoted}!${abs(col, area.r1)}`;
    const cats = `${quoted}!${abs(area.c1, area.r1 + 1)}:${abs(area.c1, area.r2)}`;
    const vals = `${quoted}!${abs(col, area.r1 + 1)}:${abs(col, area.r2)}`;
    series.push(
      `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>${name}</c:f></c:strRef></c:tx><c:cat><c:strRef><c:f>${cats}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${vals}</c:f></c:numRef></c:val></c:ser>`,
    );
  }
  const heading = title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`
    : `<c:autoTitleDeleted val="1"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:chart>${heading}<c:plotArea><c:layout/>${chartBody(type, series.join(""))}</c:plotArea><c:legend><c:legendPos val="b"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;
}

function anchorXml(chartId, at, area) {
  const start = at ? cellRange(at) : null;
  const col = start ? start.c1 - 1 : area.c2;
  const row = start ? start.r1 - 1 : 1;
  return `<xdr:twoCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${col + 8}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row + 15}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${chartId}" name="Chart ${chartId}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdChart${chartId}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
}

async function sheetFile(zip, sheetName) {
  const workbook = await zip.file("xl/workbook.xml")?.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!workbook || !rels) throw new Error("This workbook has no sheet list.");
  const tags = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]);
  const wanted = String(sheetName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = tags.find((item) => new RegExp(`\\bname="${wanted}"`).test(item)) ?? (tags.length === 1 ? tags[0] : null);
  if (!tag) throw new Error(`There is no sheet ${JSON.stringify(sheetName)}.`);
  const rid = /\br:id="([^"]+)"/.exec(tag)?.[1];
  const rel = [...rels.matchAll(/<Relationship\b[^>]*\/>/g)].map((m) => m[0]).find((item) => item.includes(`Id="${rid}"`));
  const target = /\bTarget="([^"]+)"/.exec(rel ?? "")?.[1];
  if (!target) throw new Error(`Sheet ${sheetName} has no worksheet file.`);
  return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\//, "")}`;
}

function ensureOverride(types, part, contentType) {
  const name = part.startsWith("/") ? part : `/${part}`;
  if (types.includes(`PartName="${name}"`)) return types;
  return types.replace("</Types>", `<Override PartName="${name}" ContentType="${contentType}"/></Types>`);
}

/** Adds column, bar, line or pie charts. The range's first column is the categories and its first row the series names. */
export async function addCharts(bytes, charts) {
  const zip = await JSZip.loadAsync(bytes);
  let chartNo = 1 + Math.max(0, ...Object.keys(zip.files).map((n) => Number(/^xl\/charts\/chart(\d+)\.xml$/.exec(n)?.[1] ?? 0)));
  for (const chart of charts) {
    const type = String(chart.type || "column").toLowerCase();
    if (!["column", "bar", "line", "pie"].includes(type))
      throw new Error(`Chart type ${JSON.stringify(chart.type)} must be column, bar, line or pie.`);
    const area = cellRange(chart.range);
    if (!area || area.c2 <= area.c1 || area.r2 <= area.r1)
      throw new Error(`Chart range ${JSON.stringify(chart.range)} needs a category column and at least one row of numbers, such as A1:B6.`);
    const sheetPath = await sheetFile(zip, chart.sheet);
    const relsPath = sheetPath.replace("xl/worksheets/", "xl/worksheets/_rels/") + ".rels";
    let sheet = await zip.file(sheetPath).async("string");
    let rels = (await zip.file(relsPath)?.async("string")) ?? emptyRels();
    const drawingTag = /<drawing\b[^>]*\/>/.exec(sheet)?.[0];
    let drawingPath;
    if (drawingTag) {
      const rid = /\br:id="([^"]+)"/.exec(drawingTag)?.[1];
      const rel = [...rels.matchAll(/<Relationship\b[^>]*\/>/g)].map((m) => m[0]).find((item) => item.includes(`Id="${rid}"`));
      const target = /\bTarget="([^"]+)"/.exec(rel ?? "")?.[1];
      drawingPath = target ? resolveTarget(sheetPath, target) : null;
    }
    if (!drawingPath) {
      const n = 1 + Math.max(0, ...Object.keys(zip.files).map((name) => Number(/^xl\/drawings\/drawing(\d+)\.xml$/.exec(name)?.[1] ?? 0)));
      drawingPath = `xl/drawings/drawing${n}.xml`;
      const added = ensureRel(rels, DRAWING_REL, `../drawings/drawing${n}.xml`);
      rels = added.xml;
      zip.file(relsPath, rels);
      sheet = sheet.includes("<drawing ")
        ? sheet
        : sheet.replace("</worksheet>", `<drawing r:id="${added.id}"/></worksheet>`);
      zip.file(sheetPath, sheet);
      zip.file(
        drawingPath,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"></xdr:wsDr>`,
      );
    }
    const drawingRels = drawingPath.replace("xl/drawings/", "xl/drawings/_rels/") + ".rels";
    const chartRels = ensureRel(
      (await zip.file(drawingRels)?.async("string")) ?? emptyRels(),
      CHART_REL,
      `../charts/chart${chartNo}.xml`,
    );
    zip.file(drawingRels, chartRels.xml);
    let drawing = await zip.file(drawingPath).async("string");
    const frame = anchorXml(chartNo, chart.at, area).replace(`r:id="rIdChart${chartNo}"`, `r:id="${chartRels.id}"`);
    drawing = drawing.replace("</xdr:wsDr>", `${frame}</xdr:wsDr>`);
    zip.file(drawingPath, drawing);
    zip.file("xl/charts/" + `chart${chartNo}.xml`, chartXml({ type, title: chart.title, sheet: chart.sheet, area }));
    let types = await zip.file("[Content_Types].xml").async("string");
    types = ensureOverride(types, drawingPath, DRAWING_TYPE);
    types = ensureOverride(types, `xl/charts/chart${chartNo}.xml`, CHART_TYPE);
    zip.file("[Content_Types].xml", types);
    chartNo += 1;
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Writes the saved workbook back with its charts, pivots and macros, plus any new charts. */
export async function finishWorkbook(originalBytes, savedPath, charts) {
  let bytes = readFileSync(savedPath);
  let kept = [];
  if (originalBytes) {
    const restored = await restoreOfficeParts(originalBytes, bytes);
    bytes = restored.buffer;
    kept = restored.kept;
  }
  if (charts?.length) bytes = await addCharts(bytes, charts);
  writeFileSync(savedPath, bytes);
  return { kept };
}
