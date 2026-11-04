#!/usr/bin/env node
/**
 * Show a workspace file on the Bot's computer screen.
 *
 *   ocsc-show outputs/Report.docx
 *
 * The file is rendered here into one self-contained page (Word, Excel, CSV, PowerPoint, PDF, images,
 * videos and text), written to the workspace's .openbot/screen folder, and the computer puts it on screen in
 * a viewer tab. The computer loads the page inside a sandboxed frame with no network access, so a
 * document can be drawn by script but cannot reach anything.
 *
 * The document tools call `showOnScreen` after every create and edit, so a person watching sees each
 * change as it is made.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE =
  process.env.WORKSPACE_DIR || process.env.HOME || process.cwd();
const SCREEN_DIR = join(WORKSPACE, ".openbot", "screen");
const MAX_INPUT_BYTES = 40 * 1024 * 1024;
const MAX_SHEET_ROWS = 1000;
const MAX_SHEET_COLS = 40;
const MAX_PDF_PAGES = 60;

export class ScreenError extends Error {}

// ---------- helpers ----------

export function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function unesc(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");
}

function lib(path) {
  return readFileSync(join(HERE, "node_modules", path));
}

/** A library as base64, so no byte of it can close the script element it travels in. */
function libBase64(path) {
  return lib(path).toString("base64");
}

export function workspaceFile(p) {
  if (typeof p !== "string" || !p.trim())
    throw new ScreenError("A file path is required.");
  const full = isAbsolute(p) ? resolve(p) : resolve(WORKSPACE, p);
  const rel = relative(WORKSPACE, full);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new ScreenError(
      `The file must be inside the workspace (${WORKSPACE}).`,
    );
  }
  if (!existsSync(full)) throw new ScreenError(`${rel} does not exist.`);
  const size = statSync(full).size;
  if (size > MAX_INPUT_BYTES)
    throw new ScreenError(`${rel} is larger than 40 MB, too large to preview.`);
  return { full, rel: rel.split("\\").join("/") };
}

const KINDS = {
  docx: "Word",
  docm: "Word",
  dotx: "Word",
  xlsx: "Excel",
  xlsm: "Excel",
  csv: "CSV",
  pptx: "PowerPoint",
  pdf: "PDF",
  png: "Image",
  jpg: "Image",
  jpeg: "Image",
  gif: "Image",
  webp: "Image",
  svg: "Image",
  mp4: "Video",
  webm: "Video",
  txt: "Text",
  md: "Text",
  json: "Text",
  log: "Text",
  xml: "Text",
  html: "Web page",
  htm: "Web page",
};

export function kindOf(name) {
  return KINDS[extname(name).slice(1).toLowerCase()] ?? null;
}

const STYLE = `
:root{color-scheme:light}
*{box-sizing:border-box}
html,body{margin:0;background:#e9ecef;font:14px/1.45 Arial,Helvetica,sans-serif;color:#1f2328}
.ob-bar{position:sticky;top:0;z-index:10;display:flex;gap:10px;align-items:center;padding:8px 16px;background:#1f2328;color:#fff;font-size:13px}
.ob-bar b{font-weight:600}
.ob-kind{background:#77c043;color:#102a0a;border-radius:4px;padding:1px 7px;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.ob-time{margin-left:auto;opacity:.75}
.ob-main{padding:20px}
.ob-note{max-width:900px;margin:0 auto 12px;color:#57606a;font-size:12px}
.ob-error{max-width:900px;margin:40px auto;padding:16px;background:#fff;border-left:4px solid #c62828}
.ob-sheet{margin:0 auto 28px;max-width:100%;overflow:auto;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.15)}
.ob-sheet h2{margin:0;padding:8px 12px;font-size:14px;background:#f6f8fa;border-bottom:1px solid #d0d7de;position:sticky;left:0}
table.ob-grid{border-collapse:collapse;font-size:12px}
.ob-grid th{background:#f6f8fa;color:#57606a;font-weight:400;border:1px solid #d0d7de;padding:2px 6px;position:sticky;top:0}
.ob-grid td{border:1px solid #e1e4e8;padding:2px 6px;white-space:nowrap;max-width:420px;overflow:hidden;text-overflow:ellipsis}
.ob-grid td.n{text-align:right}
.ob-grid th.r{position:sticky;left:0;z-index:1}
.ob-slide{width:min(1100px,100%);aspect-ratio:16/9;margin:0 auto 22px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.2);position:relative;overflow:hidden}
.ob-slide img.full{width:100%;height:100%;object-fit:contain;display:block}
.ob-slide .num{position:absolute;right:8px;bottom:6px;background:rgba(0,0,0,.55);color:#fff;font-size:11px;padding:1px 6px;border-radius:3px}
.ob-slide .text{padding:28px 36px;font-size:18px}
.ob-slide .text p{margin:0 0 8px}
.ob-slide .thumbs img{max-height:180px;margin:4px}
.ob-page{display:block;margin:0 auto 18px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.2);max-width:100%}
.ob-image{display:block;margin:0 auto;max-width:100%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.2)}
pre.ob-text{max-width:1000px;margin:0 auto;padding:20px;background:#fff;white-space:pre-wrap;word-break:break-word;font:13px/1.5 Menlo,Consolas,monospace;box-shadow:0 1px 3px rgba(0,0,0,.15)}
iframe.ob-html{display:block;width:100%;max-width:1100px;height:calc(100vh - 90px);margin:0 auto;border:0;background:#fff}
.docx-wrapper{background:transparent!important;padding:0!important}
.docx-wrapper>section.docx{box-shadow:0 2px 6px rgba(0,0,0,.2);margin-bottom:22px!important}
.docx ins{color:#1a7f37;text-decoration:underline;background:#e6ffec}
.docx del{color:#c62828;text-decoration:line-through;background:#ffebe9}
@media print{.ob-bar,.ob-note{display:none}.ob-main{padding:0}html,body{background:#fff}.ob-sheet,.ob-slide,.ob-page,.ob-image,.docx-wrapper>section.docx{box-shadow:none!important}.ob-slide,.ob-page,.docx-wrapper>section.docx{break-after:page;margin:0!important}}
`;

function page({ name, kind, body, script = "", note = "", ready = true }) {
  const time = new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Europe/London",
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(name)}</title><style>${STYLE}</style></head>
<body${ready ? ' data-ready="1"' : ""}><div class="ob-bar"><span class="ob-kind">${escapeHtml(kind)}</span><b>${escapeHtml(name)}</b><span class="ob-time">Updated ${time}</span></div>
<main class="ob-main" id="ob-main">${note ? `<p class="ob-note">${escapeHtml(note)}</p>` : ""}${body}</main>${script}</body></html>`;
}

// ---------- renderers ----------

function renderDocx(bytes, changes = true) {
  const script = `<script>${lib("jszip/dist/jszip.min.js")}</script><script>${lib("docx-preview/dist/docx-preview.min.js")}</script>
<script>
(function(){
  var host=document.getElementById("ob-doc");
  function bleed(){
    // Full-width header and footer artwork is anchored to the page edge in Word; the renderer places
    // it inside the margins instead, which pushes it off the page and leaves the banner's text boxes
    // over white paper.
    document.querySelectorAll("section.docx").forEach(function(sec){
      sec.style.position="relative";sec.style.overflow="hidden";
      var width=sec.getBoundingClientRect().width;
      sec.querySelectorAll("header img, footer img").forEach(function(img){
        var size=img.getBoundingClientRect();
        if(size.width<width*0.95)return;
        var box=img.parentElement,footer=!!img.closest("footer");
        box.style.position="absolute";box.style.float="none";box.style.left="0";box.style.zIndex="0";
        box.style.width=size.width+"px";box.style.height=size.height+"px";
        if(footer){box.style.top="auto";box.style.bottom="0";}else{box.style.top="0";}
      });
    });
  }
  function done(){try{bleed();}catch(e){}document.body.dataset.ready="1";}
  try{
    var raw=atob("${bytes.toString("base64")}"),buf=new Uint8Array(raw.length);
    for(var i=0;i<raw.length;i++)buf[i]=raw.charCodeAt(i);
    docx.renderAsync(new Blob([buf]),host,null,{inWrapper:true,renderChanges:${changes},renderHeaders:true,renderFooters:true,renderFootnotes:true,renderEndnotes:true,useBase64URL:true,experimental:true,ignoreLastRenderedPageBreak:true})
      .then(done,function(e){host.innerHTML="";var p=document.createElement("div");p.className="ob-error";p.textContent="This document could not be drawn: "+(e&&e.message||e);host.appendChild(p);done();});
  }catch(e){host.textContent="This document could not be drawn: "+e.message;done();}
})();
</script>`;
  return {
    body: '<div id="ob-doc"></div>',
    script,
    ready: false,
    note: changes
      ? "Tracked changes show as green insertions and red deletions."
      : "",
  };
}

function columnName(n) {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26))
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

function formatNumber(value, numFmt) {
  if (!Number.isFinite(value)) return String(value);
  if (numFmt && /%/.test(numFmt))
    return `${(value * 100).toFixed((numFmt.split(".")[1] || "").replace(/[^0]/g, "").length)}%`;
  const decimals = numFmt && /\.(0+)/.exec(numFmt)?.[1].length;
  const grouped = numFmt ? /#,##/.test(numFmt) : false;
  const prefix =
    numFmt && /£/.test(numFmt)
      ? "£"
      : numFmt && /€/.test(numFmt)
        ? "€"
        : numFmt && /\$/.test(numFmt)
          ? "$"
          : "";
  if (decimals !== undefined && decimals !== null) {
    return (
      prefix +
      value.toLocaleString("en-GB", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: grouped,
      })
    );
  }
  if (grouped || prefix)
    return prefix + value.toLocaleString("en-GB", { maximumFractionDigits: 2 });
  return String(Math.round(value * 1e10) / 1e10);
}

export function cellText(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return formatNumber(v, cell.numFmt);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "object") {
    if ("formula" in v || "sharedFormula" in v) {
      const result = v.result;
      if (result === undefined || result === null)
        return `=${v.formula ?? v.sharedFormula}`;
      if (typeof result === "object" && result?.error)
        return String(result.error);
      if (result instanceof Date) return result.toISOString().slice(0, 10);
      return typeof result === "number"
        ? formatNumber(result, cell.numFmt)
        : String(result);
    }
    if (Array.isArray(v.richText))
      return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text);
    if ("error" in v) return String(v.error);
  }
  return String(v);
}

function argbCss(argb) {
  return typeof argb === "string" && /^[0-9a-f]{8}$/i.test(argb)
    ? `#${argb.slice(2)}`
    : null;
}

async function renderXlsx(full) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(full);
  const parts = [];
  let trimmed = false;
  for (const sheet of workbook.worksheets.slice(0, 12)) {
    const rows = Math.min(sheet.rowCount, MAX_SHEET_ROWS);
    const cols = Math.min(Math.max(sheet.columnCount, 1), MAX_SHEET_COLS);
    if (sheet.rowCount > rows || sheet.columnCount > cols) trimmed = true;
    const head = ['<tr><th class="r"></th>'];
    for (let c = 1; c <= cols; c += 1) {
      const width = sheet.getColumn(c).width;
      head.push(
        `<th style="min-width:${Math.round((width || 9) * 7)}px">${columnName(c)}</th>`,
      );
    }
    head.push("</tr>");
    const body = [];
    for (let r = 1; r <= rows; r += 1) {
      const row = sheet.getRow(r);
      const cells = [`<th class="r">${r}</th>`];
      for (let c = 1; c <= cols; c += 1) {
        const cell = row.getCell(c);
        const style = [];
        const font = cell.font || {};
        if (font.bold) style.push("font-weight:700");
        if (font.italic) style.push("font-style:italic");
        const color = argbCss(font.color?.argb);
        if (color) style.push(`color:${color}`);
        const fill =
          cell.fill?.type === "pattern"
            ? argbCss(cell.fill.fgColor?.argb)
            : null;
        if (fill) style.push(`background:${fill}`);
        const align = cell.alignment?.horizontal;
        if (align === "center" || align === "right" || align === "left")
          style.push(`text-align:${align}`);
        const raw = cell.value;
        const numeric =
          typeof raw === "number" ||
          (raw && typeof raw === "object" && typeof raw.result === "number");
        cells.push(
          `<td${numeric ? ' class="n"' : ""}${style.length ? ` style="${style.join(";")}"` : ""}>${escapeHtml(cellText(cell))}</td>`,
        );
      }
      body.push(`<tr>${cells.join("")}</tr>`);
    }
    parts.push(
      `<section class="ob-sheet"><h2>${escapeHtml(sheet.name)}</h2><table class="ob-grid"><thead>${head.join("")}</thead><tbody>${body.join("")}</tbody></table></section>`,
    );
  }
  if (parts.length === 0)
    parts.push('<div class="ob-error">This workbook has no sheets.</div>');
  return {
    body: parts.join(""),
    note: trimmed
      ? `Showing up to ${MAX_SHEET_ROWS} rows and ${MAX_SHEET_COLS} columns per sheet. Formulas show their last calculated value, or the formula until Excel calculates it.`
      : "Formulas show their last calculated value, or the formula until Excel calculates it.",
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (rows.length >= MAX_SHEET_ROWS) break;
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function renderCsv(bytes, name) {
  const rows = parseCsv(bytes.toString("utf8"));
  const cols = Math.min(
    Math.max(0, ...rows.map((r) => r.length)),
    MAX_SHEET_COLS,
  );
  const head = ['<tr><th class="r"></th>'];
  for (let c = 1; c <= cols; c += 1) head.push(`<th>${columnName(c)}</th>`);
  const body = rows.map(
    (row, r) =>
      `<tr><th class="r">${r + 1}</th>${row
        .slice(0, cols)
        .map(
          (value) =>
            `<td${/^-?[\d,.]+%?$/.test(value.trim()) ? ' class="n"' : ""}>${escapeHtml(value)}</td>`,
        )
        .join("")}</tr>`,
  );
  return {
    body: `<section class="ob-sheet"><h2>${escapeHtml(name)}</h2><table class="ob-grid"><thead>${head.join("")}</tr></thead><tbody>${body.join("")}</tbody></table></section>`,
  };
}

function attr(xml, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(xml);
  return match ? unesc(match[1]) : "";
}

function rels(xml) {
  const out = new Map();
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    out.set(attr(match[0], "Id"), {
      target: attr(match[0], "Target"),
      type: attr(match[0], "Type"),
    });
  }
  return out;
}

function resolvePart(from, target) {
  const parts = dirname(from).split("/");
  for (const piece of target.split("/")) {
    if (piece === "..") parts.pop();
    else if (piece !== ".") parts.push(piece);
  }
  return parts.join("/");
}

const IMAGE_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

async function renderPptx(bytes) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  const presentation =
    (await zip.file("ppt/presentation.xml")?.async("string")) ?? "";
  const map = rels(
    (await zip.file("ppt/_rels/presentation.xml.rels")?.async("string")) ?? "",
  );
  const slides = [];
  let number = 0;
  for (const id of presentation.matchAll(/<p:sldId\b[^>]*>/g)) {
    const target = map.get(attr(id[0], "r:id"))?.target;
    if (!target) continue;
    number += 1;
    const part = resolvePart("ppt/presentation.xml", target);
    const xml = (await zip.file(part)?.async("string")) ?? "";
    const slideRels = rels(
      (await zip
        .file(resolvePart(part, `_rels/${basename(part)}.rels`))
        ?.async("string")) ?? "",
    );
    const images = [];
    for (const blip of xml.matchAll(/<a:blip\b[^>]*r:embed="([^"]+)"/g)) {
      const media = slideRels.get(blip[1])?.target;
      if (!media) continue;
      const path = resolvePart(part, media);
      const type = IMAGE_TYPES[extname(path).slice(1).toLowerCase()];
      const data = type ? await zip.file(path)?.async("base64") : null;
      if (data) images.push(`data:${type};base64,${data}`);
    }
    const paragraphs = [];
    for (const para of xml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)) {
      const text = [...para[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
        .map((t) => unesc(t[1]))
        .join("");
      if (text.trim()) paragraphs.push(text);
    }
    if (images.length === 1 && paragraphs.length === 0) {
      slides.push(
        `<div class="ob-slide"><img class="full" alt="Slide ${number}" src="${images[0]}"><span class="num">${number}</span></div>`,
      );
    } else {
      slides.push(
        `<div class="ob-slide"><div class="text">${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}<div class="thumbs">${images
          .map((src) => `<img alt="" src="${src}">`)
          .join("")}</div></div><span class="num">${number}</span></div>`,
      );
    }
  }
  return {
    body:
      slides.join("") ||
      '<div class="ob-error">This presentation has no slides.</div>',
    note: `${number} slide${number === 1 ? "" : "s"}, 16:9.`,
  };
}

function renderPdf(bytes) {
  const script = `<script>
(function(){
  var main=document.getElementById("ob-doc");
  function done(){document.body.dataset.ready="1";}
  function fail(e){var p=document.createElement("div");p.className="ob-error";p.textContent="This PDF could not be drawn: "+(e&&e.message||e);main.appendChild(p);done();}
  function blob(b64,type){var raw=atob(b64),buf=new Uint8Array(raw.length);for(var i=0;i<raw.length;i++)buf[i]=raw.charCodeAt(i);return new Blob([buf],{type:type});}
  try{
    var lib=URL.createObjectURL(blob("${libBase64("pdfjs-dist/build/pdf.min.mjs")}","text/javascript"));
    var worker=URL.createObjectURL(blob("${libBase64("pdfjs-dist/build/pdf.worker.min.mjs")}","text/javascript"));
    var data=blob("${bytes.toString("base64")}","application/pdf");
    import(lib).then(function(pdfjs){
      pdfjs.GlobalWorkerOptions.workerSrc=worker;
      return data.arrayBuffer().then(function(buf){return pdfjs.getDocument({data:new Uint8Array(buf),isEvalSupported:false}).promise;});
    }).then(function(doc){
      var count=Math.min(doc.numPages,${MAX_PDF_PAGES}),chain=Promise.resolve();
      for(var n=1;n<=count;n++)(function(n){chain=chain.then(function(){return doc.getPage(n).then(function(pg){
        var base=pg.getViewport({scale:1}),scale=Math.min(2,1100/base.width),vp=pg.getViewport({scale:scale*(window.devicePixelRatio||1)});
        var c=document.createElement("canvas");c.className="ob-page";c.width=vp.width;c.height=vp.height;c.style.width=(base.width*scale)+"px";
        main.appendChild(c);return pg.render({canvasContext:c.getContext("2d"),viewport:vp}).promise;});});})(n);
      return chain;
    }).then(done,fail);
  }catch(e){fail(e);}
})();
</script>`;
  return { body: '<div id="ob-doc"></div>', script, ready: false };
}

function renderImage(bytes, name) {
  const ext = extname(name).slice(1).toLowerCase();
  const type = ext === "svg" ? "image/svg+xml" : IMAGE_TYPES[ext];
  return {
    body: `<img class="ob-image" alt="${escapeHtml(name)}" src="data:${type};base64,${bytes.toString("base64")}">`,
  };
}

function renderVideo(bytes, name) {
  const type =
    extname(name).toLowerCase() === ".webm" ? "video/webm" : "video/mp4";
  return {
    body: `<video class="ob-image" controls autoplay muted loop playsinline src="data:${type};base64,${bytes.toString("base64")}"></video>`,
  };
}

function renderText(bytes) {
  const text = bytes.toString("utf8");
  const shown = text.length > 400_000 ? `${text.slice(0, 400_000)}\n…` : text;
  return { body: `<pre class="ob-text">${escapeHtml(shown)}</pre>` };
}

function renderHtml(bytes) {
  // A frame with no permissions at all: the page is drawn, nothing in it runs.
  return {
    body: `<iframe class="ob-html" sandbox="" srcdoc="${escapeHtml(bytes.toString("utf8"))}"></iframe>`,
  };
}

/** One self-contained preview page for a workspace file. */
export async function renderPreview(
  full,
  name = basename(full),
  { changes = true } = {},
) {
  const kind = kindOf(name);
  if (!kind)
    throw new ScreenError(
      `${name} cannot be previewed. Word, Excel, CSV, PowerPoint, PDF, images, videos and text can.`,
    );
  const bytes = readFileSync(full);
  const ext = extname(name).slice(1).toLowerCase();
  let part;
  try {
    if (kind === "Word") part = renderDocx(bytes, changes);
    else if (kind === "Excel") part = await renderXlsx(full);
    else if (kind === "CSV") part = renderCsv(bytes, name);
    else if (kind === "PowerPoint") part = await renderPptx(bytes);
    else if (kind === "PDF") part = renderPdf(bytes);
    else if (kind === "Image") part = renderImage(bytes, name);
    else if (kind === "Video") part = renderVideo(bytes, name);
    else if (kind === "Web page") part = renderHtml(bytes);
    else part = renderText(bytes);
  } catch (error) {
    part = {
      body: `<div class="ob-error">${escapeHtml(`This ${kind} file could not be read: ${error.message}`)}</div>`,
    };
  }
  return { kind, ext, html: page({ name, kind, ...part }) };
}

// ---------- the screen request ----------

function clean(keep) {
  for (const f of readdirSync(SCREEN_DIR)) {
    if (!/^(view|result)-[0-9a-f-]{36}\.(html|json)$/.test(f)) continue;
    if (keep.some((id) => f.includes(id))) continue;
    rmSync(join(SCREEN_DIR, f), { force: true });
  }
}

/**
 * Ask the computer to show a file. `auto` is a document tool showing its own output: the computer
 * skips it when nobody is watching rather than starting a browser for it.
 */
export async function requestShow(
  full,
  rel,
  { auto = false, waitMs = 0 } = {},
) {
  // OCSC_SCREEN_OPEN names a browser that opens the preview itself, with no computer agent
  // watching request.json. Opening a tab after every save would bury the person's own tabs.
  const opener = process.env.OCSC_SCREEN_OPEN;
  if (opener && auto) return { kind: kindOf(rel), shown: false };
  const { kind, html } = await renderPreview(full, basename(rel));
  mkdirSync(SCREEN_DIR, { recursive: true });
  const id = randomUUID();
  const view = join(SCREEN_DIR, `view-${id}.html`);
  writeFileSync(view, html);
  if (opener) {
    clean([id]);
    const child = spawn(opener, [pathToFileURL(view).href], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {});
    child.unref();
    return { kind, shown: true };
  }
  let previous = null;
  try {
    previous = JSON.parse(
      readFileSync(join(SCREEN_DIR, "request.json"), "utf8"),
    ).id;
  } catch {}
  const request = {
    id,
    file: rel,
    name: basename(rel),
    kind,
    auto,
    at: Date.now(),
  };
  writeFileSync(join(SCREEN_DIR, "request.json.tmp"), JSON.stringify(request));
  renameSync(
    join(SCREEN_DIR, "request.json.tmp"),
    join(SCREEN_DIR, "request.json"),
  );
  clean([id, previous].filter(Boolean));
  if (!waitMs) return { requested: true, kind };
  const resultFile = join(SCREEN_DIR, `result-${id}.json`);
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    if (existsSync(resultFile)) {
      try {
        return { kind, ...JSON.parse(readFileSync(resultFile, "utf8")) };
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return {
    kind,
    shown: false,
    reason:
      "The computer did not answer in time. The preview may still appear.",
  };
}

/** What a document tool adds to its output after saving a file. Never fails the tool. */
export async function showOnScreen(full, rel) {
  try {
    const result = await requestShow(full, rel, { auto: true });
    if (result.shown === false) return {};
    return { screen: "Shown on the computer screen when someone is watching." };
  } catch {
    return {};
  }
}

export async function main() {
  const target = process.argv[2];
  try {
    if (!target || target.startsWith("--"))
      throw new ScreenError("Usage: ocsc-show <workspace file>");
    const { full, rel } = workspaceFile(target);
    const result = await requestShow(full, rel, { waitMs: 30_000 });
    process.stdout.write(
      `${JSON.stringify({ ok: result.shown !== false, file: rel, ...result }, null, 2)}\n`,
    );
    if (result.shown === false) process.exit(1);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: error instanceof ScreenError ? error.message : String(error?.stack || error) }, null, 2)}\n`,
    );
    process.exit(1);
  }
}
