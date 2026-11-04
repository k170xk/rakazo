#!/usr/bin/env node
/**
 * OCSC Word: build and edit branded Word documents on a Bot's computer.
 *
 *   ocsc-word templates
 *   ocsc-word new  --spec spec.json --out outputs/Report.docx [--template OCSCReportV1]
 *   ocsc-word read --in outputs/Report.docx
 *   ocsc-word edit --in outputs/Report.docx --spec edits.json [--out outputs/Report-v2.docx]
 *
 * Every command prints one JSON object. `new` and `edit` include `link`, a markdown link the Bot
 * pastes into its reply so the person gets a download card.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
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
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = process.env.OCSC_WORD_TEMPLATES || join(HERE, "templates");
const WORKSPACE =
  process.env.WORKSPACE_DIR || process.env.HOME || process.cwd();
const DEFAULT_TEMPLATE = "OCSCReportV1";
const BRAND_GREEN = "77C043";
const HEADING_FONT = "Arial";
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

class UsageError extends Error {}

// ---------- small helpers ----------

function esc(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unesc(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else {
        out[key] = next;
        i += 1;
      }
    } else out._.push(a);
  }
  return out;
}

/** A path inside the workspace. Absolute paths and escapes are refused. */
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

function readSpec(path) {
  const { full } = inWorkspace(path, "--spec");
  try {
    return JSON.parse(readFileSync(full, "utf8"));
  } catch (error) {
    throw new UsageError(`Could not read ${path} as JSON: ${error.message}`);
  }
}

function downloadLink(rel) {
  const name = basename(rel);
  const bot = process.env.COMPUTER_BOT_ID;
  if (!bot) return { name, path: rel };
  const url = `/api/computers/${encodeURIComponent(bot)}/files/download?path=${encodeURIComponent(rel)}`;
  return { name, path: rel, url, link: `[${name}](${url})` };
}

const TEMPLATE_EXT = /\.(docx|dotx)$/i;
const WORKSPACE_TEMPLATE_DIR = join(WORKSPACE, "templates");

/** Built-in templates, then any the Bot or a person saved in the workspace's templates/ folder. */
function templateFiles() {
  const found = [];
  for (const [dir, source] of [
    [TEMPLATE_DIR, "built-in"],
    [WORKSPACE_TEMPLATE_DIR, "workspace"],
  ]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) {
      if (!TEMPLATE_EXT.test(f)) continue;
      const name = f.replace(TEMPLATE_EXT, "");
      if (found.some((t) => t.name === name)) continue;
      found.push({ name, source, file: join(dir, f) });
    }
  }
  return found;
}

function listTemplates() {
  return templateFiles().map((t) => t.name);
}

/** The optional `<template>.json` beside a template: description, fields, banner wording. */
function manifestFor(file) {
  const path = file.replace(TEMPLATE_EXT, ".json");
  if (!existsSync(path)) return {};
  try {
    const m = JSON.parse(readFileSync(path, "utf8"));
    return m && typeof m === "object" ? m : {};
  } catch {
    return {};
  }
}

/** A template by name, or a .docx / .dotx anywhere in the workspace (for example uploads/X.docx). */
function resolveTemplate(value) {
  const wanted =
    typeof value === "string" && value.trim() ? value.trim() : DEFAULT_TEMPLATE;
  if (
    wanted.includes("/") ||
    (TEMPLATE_EXT.test(wanted) && existsSync(resolve(WORKSPACE, wanted)))
  ) {
    const path = inWorkspace(wanted, "--template");
    if (!TEMPLATE_EXT.test(path.full))
      throw new UsageError("--template must be a .docx or .dotx file.");
    if (!existsSync(path.full))
      throw new UsageError(`Template not found: ${path.rel}`);
    return {
      name: basename(path.full).replace(TEMPLATE_EXT, ""),
      source: "file",
      file: path.full,
      path: path.rel,
    };
  }
  const name = wanted.replace(TEMPLATE_EXT, "");
  if (!/^[A-Za-z0-9 _-]+$/.test(name))
    throw new UsageError(
      "Template names are letters, digits, spaces, - and _.",
    );
  const hit = templateFiles().find(
    (t) => t.name.toLowerCase() === name.toLowerCase(),
  );
  if (!hit)
    throw new UsageError(
      `Unknown template ${name}. Available: ${listTemplates().join(", ")}. A .docx in the workspace can be used by its path, for example --template uploads/Template.docx`,
    );
  return hit;
}

const FIELD_RE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

/** The {{fields}} a template asks for, across its body, headers and footers. */
async function templateFields(doc) {
  const names = new Set();
  const parts = [doc.xml, ...(await doc.headerFooterFiles()).values()];
  for (const xml of parts) {
    for (const p of xml.match(PARA_RE) ?? []) {
      for (const m of textOf(p).matchAll(FIELD_RE)) names.add(m[1]);
    }
  }
  return [...names];
}

// ---------- inline text: **bold**, *italic* ----------

function runs(text, base = "") {
  const parts = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m;
  const s = String(text ?? "");
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push({ t: s.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("**")) parts.push({ t: tok.slice(2, -2), b: true });
    else parts.push({ t: tok.slice(1, -1), i: true });
    last = m.index + tok.length;
  }
  if (last < s.length) parts.push({ t: s.slice(last) });
  if (!parts.length) parts.push({ t: "" });
  return parts
    .map((p) => {
      const rpr = `${base}${p.b ? "<w:b/>" : ""}${p.i ? "<w:i/>" : ""}`;
      const lines = p.t.split("\n");
      return lines
        .map(
          (line, idx) =>
            `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}${idx ? "<w:br/>" : ""}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`,
        )
        .join("");
    })
    .join("");
}

function para(text, { style, numId, ilvl = 0, align, base } = {}) {
  const ppr = [
    style ? `<w:pStyle w:val="${style}"/>` : "",
    numId
      ? `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`
      : "",
    align ? `<w:jc w:val="${align}"/>` : "",
  ].join("");
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${runs(text, base)}</w:p>`;
}

// ---------- document parts ----------

class Doc {
  static async open(buffer) {
    const doc = new Doc();
    doc.zip = await JSZip.loadAsync(buffer);
    doc.xml = await doc.zip.file("word/document.xml").async("string");
    doc.styles =
      (await doc.zip.file("word/styles.xml")?.async("string")) ?? null;
    doc.numbering =
      (await doc.zip.file("word/numbering.xml")?.async("string")) ?? null;
    doc.rels = await doc.zip
      .file("word/_rels/document.xml.rels")
      .async("string");
    doc.types = await doc.zip.file("[Content_Types].xml").async("string");
    // A Word template (.dotx) is a document with a different content type; Word opens either.
    doc.types = doc.types.replace(
      "wordprocessingml.template.main+xml",
      "wordprocessingml.document.main+xml",
    );
    doc.bulletNum = null;
    doc.meta = {};
    doc.placeholders = { title: "OCSC Report", subtitle: "Report Subtitle" };
    return doc;
  }

  ensureStyles() {
    if (!this.styles) return;
    const wanted = [
      ["Heading1", "heading 1", 0, 32, 360, 120],
      ["Heading2", "heading 2", 1, 26, 280, 100],
      ["Heading3", "heading 3", 2, 22, 220, 80],
    ];
    let add = "";
    for (const [id, name, level, size, before, after] of wanted) {
      if (this.styles.includes(`w:styleId="${id}"`)) continue;
      add +=
        `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>` +
        `<w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
        `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="${after}"/><w:outlineLvl w:val="${level}"/></w:pPr>` +
        `<w:rPr><w:rFonts w:ascii="${HEADING_FONT}" w:hAnsi="${HEADING_FONT}" w:cs="${HEADING_FONT}"/><w:b/><w:color w:val="${BRAND_GREEN}"/>` +
        `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
    }
    if (!this.styles.includes('w:styleId="Caption"')) {
      add +=
        `<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
        `<w:pPr><w:spacing w:after="200"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/><w:sz w:val="18"/></w:rPr></w:style>`;
    }
    if (add)
      this.styles = this.styles.replace("</w:styles>", `${add}</w:styles>`);
  }

  ensureNumbering() {
    if (this.numbering) return;
    this.numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${W_NS}"></w:numbering>`;
    this.zip.file("word/numbering.xml", this.numbering);
    if (!this.rels.includes("numbering.xml")) {
      this.rels = this.rels.replace(
        "</Relationships>",
        `<Relationship Id="${this.newRelId()}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`,
      );
    }
    if (!this.types.includes("/word/numbering.xml")) {
      this.types = this.types.replace(
        "</Types>",
        `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`,
      );
    }
  }

  nextId(attr) {
    const ids = [
      ...this.numbering.matchAll(new RegExp(`${attr}="(\\d+)"`, "g")),
    ].map((m) => Number(m[1]));
    return (ids.length ? Math.max(...ids) : 0) + 1;
  }

  /** A new list. Bullets share one definition; each numbered list restarts at 1. */
  listNum(kind) {
    this.ensureNumbering();
    if (kind === "bullet" && this.bulletNum) return this.bulletNum;
    const abs = this.nextId("w:abstractNumId");
    const lvls = [0, 1, 2]
      .map((l) => {
        const fmt =
          kind === "bullet"
            ? "bullet"
            : ["decimal", "lowerLetter", "lowerRoman"][l];
        const txt =
          kind === "bullet" ? ["\u2022", "\u2013", "\u25AA"][l] : `%${l + 1}.`;
        return (
          `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${txt}"/><w:lvlJc w:val="left"/>` +
          `<w:pPr><w:ind w:left="${720 + l * 360}" w:hanging="360"/></w:pPr>` +
          (kind === "bullet"
            ? `<w:rPr><w:color w:val="${BRAND_GREEN}"/></w:rPr>`
            : "") +
          `</w:lvl>`
        );
      })
      .join("");
    const absXml = `<w:abstractNum w:abstractNumId="${abs}"><w:multiLevelType w:val="hybridMultilevel"/>${lvls}</w:abstractNum>`;
    const firstNum = this.numbering.indexOf("<w:num ");
    this.numbering =
      firstNum >= 0
        ? this.numbering.slice(0, firstNum) +
          absXml +
          this.numbering.slice(firstNum)
        : this.numbering.replace("</w:numbering>", `${absXml}</w:numbering>`);
    const num = this.nextId("w:numId");
    this.numbering = this.numbering.replace(
      "</w:numbering>",
      `<w:num w:numId="${num}"><w:abstractNumId w:val="${abs}"/></w:num></w:numbering>`,
    );
    if (kind === "bullet") this.bulletNum = num;
    return num;
  }

  newRelId() {
    const ids = [...this.rels.matchAll(/Id="rId(\d+)"/g)].map((m) =>
      Number(m[1]),
    );
    return `rId${(ids.length ? Math.max(...ids) : 0) + 1}`;
  }

  addImage(path) {
    const { full } = inWorkspace(path, "image path");
    if (!existsSync(full)) throw new UsageError(`Image not found: ${path}`);
    const bytes = readFileSync(full);
    const ext = extname(full).toLowerCase().replace(".jpeg", ".jpg");
    const size = imageSize(bytes);
    if (!size || ![".png", ".jpg"].includes(ext))
      throw new UsageError(`Only PNG and JPEG images are supported: ${path}`);
    const existing = Object.keys(this.zip.files).filter((f) =>
      f.startsWith("word/media/"),
    ).length;
    const target = `media/ocsc-image${existing + 1}${ext}`;
    this.zip.file(`word/${target}`, bytes);
    const rid = this.newRelId();
    this.rels = this.rels.replace(
      "</Relationships>",
      `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/></Relationships>`,
    );
    const mime = ext === ".png" ? "image/png" : "image/jpeg";
    const extKey = ext.slice(1);
    if (!new RegExp(`Extension="${extKey}"`, "i").test(this.types)) {
      this.types = this.types.replace(
        "<Override",
        `<Default Extension="${extKey}" ContentType="${mime}"/><Override`,
      );
    }
    return { rid, ...size };
  }

  imageBlock(block, n) {
    const img = this.addImage(block.path);
    const widthCm = Math.min(Number(block.width_cm) || 15, 16);
    const cx = Math.round(widthCm * 360000);
    const cy = Math.round((cx * img.h) / img.w);
    const id = 1000 + n;
    const drawing =
      `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/>` +
      `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(basename(block.path))}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${img.rid}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
      `</a:graphicData></a:graphic></wp:inline></w:drawing>`;
    let out = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r>${drawing}</w:r></w:p>`;
    if (block.caption)
      out += para(block.caption, { style: "Caption", align: "center" });
    return out;
  }

  tableBlock(block) {
    const header = Array.isArray(block.header) ? block.header : [];
    const rows = Array.isArray(block.rows) ? block.rows : [];
    const cols = Math.max(
      header.length,
      ...rows.map((r) => (Array.isArray(r) ? r.length : 0)),
      1,
    );
    const width = 9026;
    const colW = Math.floor(width / cols);
    const cell = (text, head) =>
      `<w:tc><w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/>${head ? `<w:shd w:val="clear" w:color="auto" w:fill="${BRAND_GREEN}"/>` : ""}</w:tcPr>` +
      `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr>${runs(text, head ? '<w:b/><w:color w:val="FFFFFF"/>' : "")}</w:p></w:tc>`;
    const row = (cells, head) =>
      `<w:tr>${head ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${Array.from({ length: cols }, (_, i) => cell(cells[i] ?? "", head)).join("")}</w:tr>`;
    const border = `w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"`;
    let out =
      `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblBorders><w:top ${border}/><w:left ${border}/><w:bottom ${border}/><w:right ${border}/><w:insideH ${border}/><w:insideV ${border}/></w:tblBorders>` +
      `<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
      `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${colW}"/>`).join("")}</w:tblGrid>` +
      (header.length ? row(header, true) : "") +
      rows.map((r) => row(Array.isArray(r) ? r : [r], false)).join("") +
      `</w:tbl>`;
    out += block.caption ? para(block.caption, { style: "Caption" }) : "<w:p/>";
    return out;
  }

  blocks(list) {
    if (!Array.isArray(list)) throw new UsageError("blocks must be a list.");
    let n = 0;
    return list
      .map((b) => {
        n += 1;
        switch (b?.type) {
          case "heading": {
            const level = Math.min(Math.max(Number(b.level) || 1, 1), 3);
            return para(b.text, { style: `Heading${level}` });
          }
          case "paragraph":
            return para(b.text, { align: b.align });
          case "bullets":
          case "numbered": {
            const num = this.listNum(
              b.type === "bullets" ? "bullet" : "number",
            );
            return (b.items ?? [])
              .map((item) =>
                typeof item === "object" && item
                  ? para(item.text, {
                      numId: num,
                      ilvl: Math.min(Number(item.level) || 0, 2),
                      style: "ListParagraph",
                    })
                  : para(item, { numId: num, style: "ListParagraph" }),
              )
              .join("");
          }
          case "table":
            return this.tableBlock(b);
          case "image":
            return this.imageBlock(b, n);
          case "pagebreak":
            return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
          default:
            throw new UsageError(
              `Block ${n} has unknown type ${JSON.stringify(b?.type)}. Use heading, paragraph, bullets, numbered, table, image or pagebreak.`,
            );
        }
      })
      .join("");
  }

  /** Body paragraphs and tables as top-level elements, with their text and heading level. */
  elements() {
    const body = this.xml.match(/<w:body>([\s\S]*)<\/w:body>/);
    if (!body) throw new Error("This file has no document body.");
    const start = this.xml.indexOf("<w:body>") + "<w:body>".length;
    const inner = body[1];
    const out = [];
    let i = 0;
    while (i < inner.length) {
      const m = /<w:(p|tbl|sectPr|sdt)\b/.exec(inner.slice(i));
      if (!m) break;
      const tag = m[1];
      const from = i + m.index;
      const end = closeOf(inner, from, tag);
      const xml = inner.slice(from, end);
      const style =
        /<w:pStyle w:val="([^"]+)"/.exec(tag === "p" ? xml : "")?.[1] ?? "";
      const level = /^Heading([1-9])$/.exec(style)?.[1];
      out.push({
        tag,
        from: start + from,
        to: start + end,
        xml,
        text: textOf(xml),
        level: level ? Number(level) : 0,
      });
      i = end;
    }
    return out;
  }

  insertBeforeSectPr(xml) {
    const els = this.elements();
    const sect = [...els].reverse().find((e) => e.tag === "sectPr");
    const at = sect ? sect.from : this.xml.lastIndexOf("</w:body>");
    this.xml = this.xml.slice(0, at) + xml + this.xml.slice(at);
  }

  /** The heading element, and where its section ends. */
  section(heading) {
    const els = this.elements();
    const want = norm(heading);
    const idx = els.findIndex((e) => e.level && norm(e.text) === want);
    const loose =
      idx >= 0
        ? idx
        : els.findIndex((e) => e.level && norm(e.text).includes(want));
    if (loose < 0) {
      const found = els.filter((e) => e.level).map((e) => e.text);
      throw new UsageError(
        `Heading not found: ${JSON.stringify(heading)}. Headings in this document: ${JSON.stringify(found)}`,
      );
    }
    const h = els[loose];
    const end = els
      .slice(loose + 1)
      .find((e) => e.tag === "sectPr" || (e.level && e.level <= h.level));
    return {
      start: h.from,
      bodyStart: h.to,
      end: end ? end.from : els[els.length - 1].to,
    };
  }

  replaceText(find, replacement, all = true, rev = null) {
    let count = 0;
    this.xml = this.xml.replace(PARA_RE, (p) => {
      if (!all && count) return p;
      const t = textOf(p);
      if (!t.includes(find)) return p;
      const hits = t.split(find).length - 1;
      count += all ? hits : 1;
      const next = all
        ? t.split(find).join(replacement)
        : t.replace(find, replacement);
      if (rev) return rev.replaceInParagraph(p, find, replacement, all, next);
      // Within one paragraph, text split across runs is joined, edited, and put back in the first run.
      return rewriteParagraphText(p, next);
    });
    return count;
  }

  /** Fills {{field}} placeholders in the body, headers and footers. Formatting is kept where a placeholder sits in one run. */
  async fillFields(fields, parts) {
    const filled = new Set();
    const known = (k) =>
      Object.hasOwn(fields, k) && fields[k] !== null && fields[k] !== undefined;
    const fill = (xml) =>
      xml
        .replace(
          /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g,
          (m, open, t, close) => {
            const text = unesc(t);
            if (!text.includes("{{")) return m;
            const next = text.replace(FIELD_RE, (ph, k) =>
              known(k) ? (filled.add(k), String(fields[k])) : ph,
            );
            return next === text
              ? m
              : `${open.includes("xml:space") ? open : open.replace("<w:t", '<w:t xml:space="preserve"')}${esc(next)}${close}`;
          },
        )
        .replace(PARA_RE, (p) => {
          const text = textOf(p);
          if (![...text.matchAll(FIELD_RE)].some((m) => known(m[1]))) return p;
          return rewriteParagraphText(
            p,
            text.replace(FIELD_RE, (ph, k) =>
              known(k) ? (filled.add(k), String(fields[k])) : ph,
            ),
          );
        });
    this.xml = fill(this.xml);
    for (const [name, xml] of parts) parts.set(name, fill(xml));
    return [...filled];
  }

  /** The banner's current wording, kept in the document properties so a later edit can find it. */
  async banner() {
    const c = (await this.zip.file("docProps/core.xml")?.async("string")) ?? "";
    const read = (tag) => {
      const v = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(c)?.[1];
      return v ? unesc(v) : null;
    };
    return {
      title: read("dc:title") || this.placeholders.title,
      subtitle: read("dc:subject") || this.placeholders.subtitle,
    };
  }

  async setBanner(title, subtitle, headerFiles) {
    const current = await this.banner();
    let changed = 0;
    for (const [name, xml] of headerFiles) {
      let next = xml;
      if (title)
        next = swapText(
          next,
          [current.title, this.placeholders.title],
          title,
          (n) => (changed += n),
        );
      if (subtitle)
        next = swapText(
          next,
          [current.subtitle, this.placeholders.subtitle],
          subtitle,
          (n) => (changed += n),
        );
      headerFiles.set(name, next);
    }
    if (title) this.meta.title = title;
    if (subtitle) this.meta.subtitle = subtitle;
    return changed;
  }

  async save(outFull) {
    this.zip.file("word/document.xml", this.xml);
    if (this.styles) this.zip.file("word/styles.xml", this.styles);
    if (this.numbering) this.zip.file("word/numbering.xml", this.numbering);
    this.zip.file("word/_rels/document.xml.rels", this.rels);
    this.zip.file("[Content_Types].xml", this.types);
    const core = this.zip.file("docProps/core.xml");
    if (core) {
      let c = await core.async("string");
      const put = (tag, value) => {
        if (!value) return;
        c = new RegExp(`<${tag}>`).test(c)
          ? c.replace(
              new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`),
              `<${tag}>${esc(value)}</${tag}>`,
            )
          : c.replace(
              "</cp:coreProperties>",
              `<${tag}>${esc(value)}</${tag}></cp:coreProperties>`,
            );
      };
      put("dc:title", this.meta.title);
      put("dc:subject", this.meta.subtitle);
      c = c.replace(
        /<dcterms:modified([^>]*)>[^<]*<\/dcterms:modified>/,
        `<dcterms:modified$1>${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:modified>`,
      );
      this.zip.file("docProps/core.xml", c);
    }
    mkdirSync(dirname(outFull), { recursive: true });
    writeFileSync(
      outFull,
      await this.zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
      }),
    );
  }

  async headerFiles() {
    const map = new Map();
    for (const name of Object.keys(this.zip.files)) {
      if (/^word\/header\d*\.xml$/.test(name))
        map.set(name, await this.zip.file(name).async("string"));
    }
    return map;
  }

  async headerFooterFiles() {
    const map = new Map();
    for (const name of Object.keys(this.zip.files)) {
      if (/^word\/(header|footer)\d*\.xml$/.test(name))
        map.set(name, await this.zip.file(name).async("string"));
    }
    return map;
  }
}

// ---------- tracked changes ----------

/** A paragraph that is not self-closing, through its close. */
const PARA_RE = /<w:p(?=[\s>])[^>]*(?<!\/)>[\s\S]*?<\/w:p>/g;
const AUTHOR = process.env.OCSC_WORD_AUTHOR || "OCSC Bot";

/** Applies fn to each run, skipping the inside of any `skip` element (for example runs already deleted). */
function mapRuns(xml, fn, skip = []) {
  const re = new RegExp(`<w:(r|${skip.join("|") || "\\u0000"})(?=[\\s>])`, "g");
  let out = "";
  let i = 0;
  for (;;) {
    re.lastIndex = i;
    const m = re.exec(xml);
    if (!m) break;
    const end = closeOf(xml, m.index, m[1]);
    out += xml.slice(i, m.index);
    const el = xml.slice(m.index, end);
    out += m[1] === "r" ? fn(el) : el;
    i = end;
  }
  return out + xml.slice(i);
}

/** Applies fn to each top-level paragraph or table in a run of body XML. */
function mapBlocks(xml, fn) {
  const re = /<w:(p|tbl|sdt)(?=[\s>/])/g;
  let out = "";
  let i = 0;
  for (;;) {
    re.lastIndex = i;
    const m = re.exec(xml);
    if (!m) break;
    const end = closeOf(xml, m.index, m[1]);
    out += xml.slice(i, m.index) + fn(xml.slice(m.index, end), m[1]);
    i = end;
  }
  return out + xml.slice(i);
}

/** Puts a revision marker on a paragraph's mark, where Word records an inserted or deleted paragraph. */
function markParagraph(p, kind, marker) {
  if (/^<w:p(?=[\s/])[^>]*\/>$/.test(p))
    return `<w:p><w:pPr><w:rPr>${marker}</w:rPr></w:pPr></w:p>`;
  const open = p.indexOf(">") + 1;
  const head = p.slice(0, open);
  let rest = p.slice(open);
  rest = rest.replace(/^<w:pPr\s*\/>/, "<w:pPr></w:pPr>");
  if (!rest.startsWith("<w:pPr"))
    return `${head}<w:pPr><w:rPr>${marker}</w:rPr></w:pPr>${rest}`;
  const pprEnd = rest.indexOf("</w:pPr>");
  if (pprEnd < 0) return p;
  let ppr = rest.slice(0, pprEnd);
  const changeAt = ppr.search(/<w:pPrChange(?=[\s>])/);
  const own = changeAt >= 0 ? ppr.slice(0, changeAt) : ppr;
  if (new RegExp(`<w:${kind}(?=[\\s/>])`).test(own)) return p;
  const rprAt = own.indexOf("<w:rPr>");
  if (rprAt >= 0) {
    let at = rprAt + "<w:rPr>".length;
    const ins = /^<w:ins(?=[\s/])[^>]*\/>/.exec(ppr.slice(at));
    if (kind === "del" && ins) at += ins[0].length;
    ppr = ppr.slice(0, at) + marker + ppr.slice(at);
  } else {
    const at = own.search(/<w:sectPr(?=[\s>])/);
    const where = at >= 0 ? at : own.length;
    ppr = `${ppr.slice(0, where)}<w:rPr>${marker}</w:rPr>${ppr.slice(where)}`;
  }
  return head + ppr + rest.slice(pprEnd);
}

function markRows(tbl, kind, marker) {
  return tbl.replace(
    /(<w:tr(?=[\s>])[^>]*>)(?:<w:trPr>([\s\S]*?)<\/w:trPr>|<w:trPr\/>)?/g,
    (m, open, inner) => {
      if (inner !== undefined) {
        if (new RegExp(`<w:${kind}(?=[\\s/>])`).test(inner)) return m;
        return `${open}<w:trPr>${inner}${marker}</w:trPr>`;
      }
      return `${open}<w:trPr>${marker}</w:trPr>`;
    },
  );
}

const toDeletedText = (run) =>
  /<w:txbxContent/.test(run)
    ? run
    : run
        .replace(/<w:t(?=[\s>])/g, "<w:delText")
        .replace(/<\/w:t>/g, "</w:delText>")
        .replace(/<w:instrText(?=[\s>])/g, "<w:delInstrText")
        .replace(/<\/w:instrText>/g, "</w:delInstrText>");

/** Records edits as Word tracked changes, so the person sees exactly what the Bot changed. */
class Revisions {
  constructor(xml) {
    let max = 0;
    for (const m of xml.matchAll(/w:id="(\d+)"/g))
      max = Math.max(max, Number(m[1]));
    this.id = max + 1;
    this.date = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  }

  attrs() {
    return `w:id="${this.id++}" w:author="${esc(AUTHOR)}" w:date="${this.date}"`;
  }

  marker(kind) {
    return `<w:${kind} ${this.attrs()}/>`;
  }

  inserted(xml) {
    return mapBlocks(xml, (el, tag) => {
      const body = mapRuns(el, (r) => `<w:ins ${this.attrs()}>${r}</w:ins>`);
      if (tag === "p") return markParagraph(body, "ins", this.marker("ins"));
      if (tag === "tbl") return markRows(body, "ins", this.marker("ins"));
      return body;
    });
  }

  deleted(xml) {
    return mapBlocks(xml, (el, tag) => {
      const body = mapRuns(
        el,
        (r) =>
          /<w:delText|<w:delInstrText/.test(r)
            ? r
            : `<w:del ${this.attrs()}>${toDeletedText(r)}</w:del>`,
        ["del"],
      );
      if (tag === "p") return markParagraph(body, "del", this.marker("del"));
      if (tag === "tbl") return markRows(body, "del", this.marker("del"));
      return body;
    });
  }

  /**
   * Where the words sit in one run, only they are struck through and the new words inserted beside
   * them, keeping the run's formatting. Otherwise the paragraph's old text is struck and the new
   * text inserted after it.
   */
  replaceInParagraph(p, find, replacement, all, nextText) {
    let done = 0;
    let missed = false;
    const hits = textOf(p).split(find).length - 1;
    const precise = mapRuns(
      p,
      (r) => {
        const m =
          /^<w:r(?=[\s>])[^>]*>(<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t(?:\s[^>]*)?>([^<]*)<\/w:t><\/w:r>$/.exec(
            r,
          );
        const text = m ? unesc(m[2]) : textOf(r);
        if (!text.includes(find)) return r;
        if (!all && done) return r;
        if (!m) {
          missed = true;
          return r;
        }
        const rpr = m[1] ?? "";
        const at = text.indexOf(find);
        const pieces = all
          ? text.split(find)
          : [text.slice(0, at), text.slice(at + find.length)];
        const plain = (t) =>
          t ? `<w:r>${rpr}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>` : "";
        let s = "";
        pieces.forEach((piece, i) => {
          s += plain(piece);
          if (i === pieces.length - 1) return;
          s += `<w:del ${this.attrs()}><w:r>${rpr}<w:delText xml:space="preserve">${esc(find)}</w:delText></w:r></w:del>`;
          if (replacement)
            s += `<w:ins ${this.attrs()}><w:r>${rpr}<w:t xml:space="preserve">${esc(replacement)}</w:t></w:r></w:ins>`;
          done += 1;
        });
        return s;
      },
      ["del"],
    );
    if (!missed && (all ? done === hits : done === 1)) return precise;
    // Split across runs: strike the paragraph's text and insert the new wording after it.
    const rpr =
      /<w:r(?=[\s>])[^>]*>(<w:rPr>[\s\S]*?<\/w:rPr>)/.exec(p)?.[1] ?? "";
    const struck = mapRuns(
      p,
      (r) =>
        /<w:t[\s>]/.test(r)
          ? `<w:del ${this.attrs()}>${toDeletedText(r)}</w:del>`
          : r,
      ["del"],
    );
    const close = struck.lastIndexOf("</w:p>");
    return `${struck.slice(0, close)}<w:ins ${this.attrs()}><w:r>${rpr}<w:t xml:space="preserve">${esc(nextText)}</w:t></w:r></w:ins>${struck.slice(close)}`;
  }
}

/** Removes every element named tag, with its content. */
function removeElements(xml, tag) {
  const re = new RegExp(`<w:${tag}(?=[\\s>/])`, "g");
  let out = "";
  let i = 0;
  for (;;) {
    re.lastIndex = i;
    const m = re.exec(xml);
    if (!m) break;
    out += xml.slice(i, m.index);
    i = closeOf(xml, m.index, tag);
  }
  return out + xml.slice(i);
}

function unwrap(xml, tag) {
  return xml
    .replace(new RegExp(`<w:${tag}(?=[\\s/])[^>]*\\/>`, "g"), "")
    .replace(new RegExp(`<w:${tag}(?=[\\s>])[^>]*>`, "g"), "")
    .replace(new RegExp(`</w:${tag}>`, "g"), "");
}

/** Accepts every tracked change: deletions go, insertions stay, and the markers are removed. */
function acceptAll(xml) {
  const deletedMark =
    /<w:pPr>(?:(?!<\/w:pPr>)[\s\S])*?<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*?<w:del(?=[\s/])/;
  let out = xml.replace(/<w:tr(?=[\s>])[^>]*>[\s\S]*?<\/w:tr>/g, (row) =>
    /^<w:tr[^>]*><w:trPr>(?:(?!<\/w:trPr>)[\s\S])*<w:del(?=[\s/])/.test(row)
      ? ""
      : row,
  );
  out = mapBlocks(out, (el, tag) => {
    if (tag !== "p" || !deletedMark.test(el)) return el;
    const left = removeElements(removeElements(el, "del"), "moveFrom");
    return /<w:t[\s>]|<w:drawing|<w:pict|<w:object/.test(left) ? el : "";
  });
  out = removeElements(out, "del");
  out = removeElements(out, "moveFrom");
  for (const t of [
    "rPrChange",
    "pPrChange",
    "sectPrChange",
    "tblPrChange",
    "tblPrExChange",
    "trPrChange",
    "tcPrChange",
    "tblGridChange",
    "numberingChange",
  ]) {
    out = removeElements(out, t);
  }
  for (const t of [
    "moveFromRangeStart",
    "moveFromRangeEnd",
    "moveToRangeStart",
    "moveToRangeEnd",
  ]) {
    out = out.replace(new RegExp(`<w:${t}(?=[\\s/])[^>]*\\/>`, "g"), "");
  }
  out = unwrap(out, "ins");
  out = unwrap(out, "moveTo");
  return out
    .replace(/<w:rPr><\/w:rPr>/g, "")
    .replace(/<w:trPr><\/w:trPr>/g, "");
}

/** The tracked changes in a document, as text the Bot can show in the chat. */
function listChanges(xml, limit = 200) {
  const changes = [];
  const re = /<w:(ins|del)(?=[\s>])([^>]*?)(?<!\/)>/g;
  for (const m of xml.matchAll(re)) {
    if (changes.length >= limit) break;
    const end = closeOf(xml, m.index, m[1]);
    const inner = xml.slice(m.index, end);
    const text =
      m[1] === "ins"
        ? textOf(removeElements(inner, "del"))
        : [...inner.matchAll(/<w:delText(?:\s[^>]*)?>([^<]*)<\/w:delText>/g)]
            .map((d) => unesc(d[1]))
            .join("");
    if (!text.trim()) continue;
    const author = /w:author="([^"]*)"/.exec(m[2])?.[1];
    const last = changes.at(-1);
    const type = m[1] === "ins" ? "inserted" : "deleted";
    if (
      last &&
      last.type === type &&
      last.author === (author ? unesc(author) : undefined) &&
      last._end === m.index
    ) {
      last.text += text;
      last._end = end;
      continue;
    }
    changes.push({
      type,
      text,
      author: author ? unesc(author) : undefined,
      _end: end,
    });
  }
  return changes.map(({ _end, text, ...c }) => ({
    ...c,
    text: text.length > 400 ? `${text.slice(0, 400)}…` : text,
  }));
}

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

function textOf(xml) {
  return [
    ...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g),
  ]
    .map((m) =>
      m[1] !== undefined ? unesc(m[1]) : m[0] === "<w:tab/>" ? "\t" : "\n",
    )
    .join("");
}

function norm(s) {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function rewriteParagraphText(p, text) {
  let first = true;
  return p.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (r) => {
    if (!/<w:t[\s>]/.test(r)) return r;
    if (!first) return "";
    first = false;
    const rpr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(r)?.[0] ?? "";
    return `<w:r>${rpr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  });
}

function swapText(xml, finds, replacement, count) {
  let next = xml;
  for (const f of finds) {
    const e = esc(f);
    const n = next.split(`>${e}<`).length - 1;
    if (n) {
      next = next.split(`>${e}<`).join(`>${esc(replacement)}<`);
      count(n);
    }
  }
  return next;
}

function imageSize(b) {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47)
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker)
      ) {
        return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

// ---------- commands ----------

async function cmdTemplates() {
  const details = [];
  for (const t of templateFiles()) {
    const manifest = manifestFor(t.file);
    let fields = [];
    try {
      fields = await templateFields(await Doc.open(readFileSync(t.file)));
    } catch {
      // A template that will not open is still listed, so the person can be told it is broken.
    }
    details.push({
      name: t.name,
      source: t.source,
      ...(typeof manifest.description === "string"
        ? { description: manifest.description }
        : {}),
      fields,
      ...(manifest.fields && typeof manifest.fields === "object"
        ? { field_notes: manifest.fields }
        : {}),
    });
  }
  return {
    ok: true,
    templates: listTemplates(),
    default: DEFAULT_TEMPLATE,
    details,
  };
}

async function cmdNew(o) {
  const template = resolveTemplate(o.template);
  const manifest = manifestFor(template.file);
  const spec = readSpec(o.spec);
  const out = inWorkspace(o.out, "--out");
  if (!out.full.toLowerCase().endsWith(".docx"))
    throw new UsageError("--out must end in .docx");
  if (existsSync(out.full) && !o.overwrite)
    throw new UsageError(
      `${out.rel} already exists. Choose a new name, or pass --overwrite.`,
    );

  const doc = await Doc.open(readFileSync(template.file));
  if (typeof manifest.title_placeholder === "string")
    doc.placeholders.title = manifest.title_placeholder;
  if (typeof manifest.subtitle_placeholder === "string")
    doc.placeholders.subtitle = manifest.subtitle_placeholder;
  doc.ensureStyles();
  const headers = await doc.headerFiles();
  await doc.setBanner(spec.title, spec.subtitle, headers);
  for (const [n, x] of headers) doc.zip.file(n, x);

  let filled = [];
  if (spec.fields && typeof spec.fields === "object") {
    const parts = await doc.headerFooterFiles();
    filled = await doc.fillFields(spec.fields, parts);
    for (const [n, x] of parts) doc.zip.file(n, x);
  }

  const content = doc
    .elements()
    .find(
      (e) => e.tag === "p" && /^\{\{\s*content\s*\}\}$/.test(e.text.trim()),
    );
  const blocks = doc.blocks(spec.blocks ?? []);
  if (content) {
    doc.xml =
      doc.xml.slice(0, content.from) + blocks + doc.xml.slice(content.to);
  } else {
    // The built-in template's own empty first paragraph is dropped so content starts at the top of the page.
    const first = doc.elements()[0];
    if (
      template.source === "built-in" &&
      first &&
      first.tag === "p" &&
      !first.text.trim() &&
      !/<w:drawing|<w:pict/.test(first.xml)
    ) {
      doc.xml = doc.xml.slice(0, first.from) + doc.xml.slice(first.to);
    }
    doc.insertBeforeSectPr(blocks);
  }
  await doc.save(out.full);
  const unfilled = (await templateFields(doc)).filter((f) => f !== "content");
  return {
    ok: true,
    template: template.name,
    ...(filled.length ? { filled } : {}),
    ...(unfilled.length
      ? {
          unfilled,
          note: "These {{fields}} are still in the document. Fill them with an edit (fill_fields) once you know the values.",
        }
      : {}),
    ...downloadLink(out.rel),
  };
}

function outlineOf(doc) {
  const outline = [];
  for (const e of doc.elements()) {
    if (e.tag === "sectPr") continue;
    if (e.tag === "tbl") {
      const rows = [...e.xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((r) =>
        [...r[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((c) =>
          textOf(c[0]).trim(),
        ),
      );
      outline.push({ table: rows });
    } else if (e.level && e.text.trim())
      outline.push({ heading: e.text.trim(), level: e.level });
    else if (e.text.trim()) outline.push({ text: e.text.trim() });
  }
  return outline;
}

async function openIn(value, label = "--in") {
  const src = inWorkspace(value, label);
  if (!existsSync(src.full)) throw new UsageError(`Not found: ${src.rel}`);
  return { src, doc: await Doc.open(readFileSync(src.full)) };
}

async function cmdRead(o) {
  const { src, doc } = await openIn(o.in);
  const { title, subtitle } = await doc.banner();
  const outline = outlineOf(doc);
  const changes = listChanges(doc.xml);
  return {
    ok: true,
    path: src.rel,
    title,
    subtitle,
    outline,
    ...(changes.length
      ? {
          tracked_changes: changes,
          note: "The outline shows the text as it reads with these changes accepted.",
        }
      : {}),
  };
}

async function cmdEdit(o) {
  const src = inWorkspace(o.in, "--in");
  if (!existsSync(src.full)) throw new UsageError(`Not found: ${src.rel}`);
  const out = o.out ? inWorkspace(o.out, "--out") : src;
  if (!out.full.toLowerCase().endsWith(".docx"))
    throw new UsageError("--out must end in .docx");
  const spec = readSpec(o.spec);
  const ops = Array.isArray(spec) ? spec : spec.edits;
  if (!Array.isArray(ops) || !ops.length)
    throw new UsageError(
      'The spec must be a list of edits, or { "edits": [...] }.',
    );

  const doc = await Doc.open(readFileSync(src.full));
  doc.ensureStyles();
  const headers = await doc.headerFiles();
  // Tracked by default, so the person sees every change in Word; --clean edits silently.
  const rev = o.clean ? null : new Revisions(doc.xml);
  const added = (xml) => (rev ? rev.inserted(xml) : xml);
  const report = [];
  for (const [i, op] of ops.entries()) {
    const n = i + 1;
    switch (op?.op) {
      case "set_title":
      case "set_subtitle": {
        const c = await doc.setBanner(
          op.op === "set_title" ? op.text : null,
          op.op === "set_subtitle" ? op.text : null,
          headers,
        );
        report.push({ op: op.op, changed: c });
        break;
      }
      case "replace_text": {
        if (!op.find)
          throw new UsageError(`Edit ${n}: replace_text needs "find".`);
        const c = doc.replaceText(
          String(op.find),
          String(op.replace ?? ""),
          op.all !== false,
          rev,
        );
        if (!c)
          throw new UsageError(
            `Edit ${n}: text not found: ${JSON.stringify(op.find)}. Run "ocsc-word read" to see the exact wording.`,
          );
        report.push({
          op: op.op,
          changed: c,
          summary: `Replaced "${clip(op.find)}" with "${clip(op.replace ?? "")}" (${c}×)`,
        });
        break;
      }
      case "fill_fields": {
        if (!op.fields || typeof op.fields !== "object")
          throw new UsageError(
            `Edit ${n}: fill_fields needs "fields", an object of name to value.`,
          );
        const filled = [];
        for (const [k, v] of Object.entries(op.fields)) {
          if (v === null || v === undefined) continue;
          for (const ph of [`{{${k}}}`, `{{ ${k} }}`]) {
            if (doc.replaceText(ph, String(v), true, rev)) filled.push(k);
          }
        }
        const parts = await doc.headerFooterFiles();
        const inHeaders = await withXml(doc, parts, () =>
          doc.fillFields(op.fields, parts),
        );
        report.push({
          op: op.op,
          filled: [...new Set([...filled, ...inHeaders])],
          summary: `Filled ${[...new Set([...filled, ...inHeaders])].join(", ") || "nothing"}`,
        });
        break;
      }
      case "append":
        doc.insertBeforeSectPr(added(doc.blocks(op.blocks)));
        report.push({
          op: op.op,
          blocks: op.blocks.length,
          summary: `Added ${op.blocks.length} block(s) at the end`,
        });
        break;
      case "insert_after_heading":
      case "add_to_section": {
        const s = doc.section(op.heading);
        const at = op.op === "insert_after_heading" ? s.bodyStart : s.end;
        doc.xml =
          doc.xml.slice(0, at) +
          added(doc.blocks(op.blocks)) +
          doc.xml.slice(at);
        report.push({
          op: op.op,
          heading: op.heading,
          summary: `Added to "${clip(op.heading)}"`,
        });
        break;
      }
      case "replace_section": {
        const s = doc.section(op.heading);
        const old = doc.xml.slice(s.bodyStart, s.end);
        const next = doc.blocks(op.blocks);
        doc.xml =
          doc.xml.slice(0, s.bodyStart) +
          (rev ? rev.deleted(old) + rev.inserted(next) : next) +
          doc.xml.slice(s.end);
        report.push({
          op: op.op,
          heading: op.heading,
          summary: `Rewrote "${clip(op.heading)}"`,
        });
        break;
      }
      case "delete_section": {
        const s = doc.section(op.heading);
        doc.xml =
          doc.xml.slice(0, s.start) +
          (rev ? rev.deleted(doc.xml.slice(s.start, s.end)) : "") +
          doc.xml.slice(s.end);
        report.push({
          op: op.op,
          heading: op.heading,
          summary: `Deleted "${clip(op.heading)}"`,
        });
        break;
      }
      default:
        throw new UsageError(
          `Edit ${n} has unknown op ${JSON.stringify(op?.op)}. Use set_title, set_subtitle, replace_text, fill_fields, append, insert_after_heading, add_to_section, replace_section or delete_section.`,
        );
    }
  }
  for (const [n, x] of headers) doc.zip.file(n, x);
  await doc.save(out.full);
  return { ok: true, tracked: !!rev, edits: report, ...downloadLink(out.rel) };
}

/** Header and footer fields only: the body was already filled, tracked, by replace_text. */
async function withXml(doc, parts, fill) {
  const body = doc.xml;
  const filled = await fill();
  doc.xml = body;
  for (const [n, x] of parts) doc.zip.file(n, x);
  return filled;
}

function clip(text, max = 60) {
  const s = String(text ?? "").replace(/\s+/g, " ");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

async function cmdAccept(o) {
  const { src, doc } = await openIn(o.in);
  const out = o.out ? inWorkspace(o.out, "--out") : src;
  if (!out.full.toLowerCase().endsWith(".docx"))
    throw new UsageError("--out must end in .docx");
  const before = listChanges(doc.xml, 100000).length;
  doc.xml = acceptAll(doc.xml);
  for (const [n, x] of await doc.headerFooterFiles())
    doc.zip.file(n, acceptAll(x));
  await doc.save(out.full);
  return { ok: true, accepted: before, ...downloadLink(out.rel) };
}

const outlineKey = (item) =>
  item.heading !== undefined
    ? `${"#".repeat(item.level)} ${item.heading}`
    : item.table
      ? item.table.map((r) => `| ${r.join(" | ")} |`).join("\n")
      : item.text;

/** What changed between two versions, section by section, for the Bot to describe in the chat. */
async function cmdCompare(o) {
  const a = await openIn(o.old, "--old");
  const b = await openIn(o.new, "--new");
  const x = outlineOf(a.doc).map(outlineKey);
  const y = outlineOf(b.doc).map(outlineKey);
  if (x.length * y.length > 25_000_000)
    throw new UsageError(
      "These documents are too long to compare item by item.",
    );
  const lcs = Array.from(
    { length: x.length + 1 },
    () => new Uint32Array(y.length + 1),
  );
  for (let i = x.length - 1; i >= 0; i -= 1) {
    for (let j = y.length - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        x[i] === y[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const diff = [];
  let i = 0;
  let j = 0;
  let unchanged = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      unchanged += 1;
      i += 1;
      j += 1;
    } else if (
      j < y.length &&
      (i >= x.length || lcs[i][j + 1] >= lcs[i + 1][j])
    ) {
      diff.push({ added: y[j] });
      j += 1;
    } else {
      diff.push({ removed: x[i] });
      i += 1;
    }
  }
  return {
    ok: true,
    old: a.src.rel,
    new: b.src.rel,
    unchanged,
    changes: diff.slice(0, 300),
    ...(diff.length > 300 ? { more: diff.length - 300 } : {}),
  };
}

async function main() {
  const o = args(process.argv.slice(2));
  const cmd = o._[0];
  switch (cmd) {
    case "templates":
      return cmdTemplates();
    case "new":
      return cmdNew(o);
    case "read":
      return cmdRead(o);
    case "edit":
      return cmdEdit(o);
    case "accept":
      return cmdAccept(o);
    case "compare":
      return cmdCompare(o);
    default:
      throw new UsageError(
        "Usage: ocsc-word templates | new --spec s.json --out outputs/X.docx [--template NAME|uploads/T.docx] | read --in X.docx | edit --in X.docx --spec e.json [--out Y.docx] [--clean] | accept --in X.docx [--out Y.docx] | compare --old A.docx --new B.docx",
      );
  }
}

async function shown(result) {
  if (
    !result?.ok ||
    !result.path ||
    !["new", "edit", "accept"].includes(process.argv[2])
  )
    return result;
  try {
    const { showOnScreen } = await import("./screen.mjs");
    return {
      ...result,
      ...(await showOnScreen(resolve(WORKSPACE, result.path), result.path)),
    };
  } catch {
    return result;
  }
}

main()
  .then(shown)
  .then(
    (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    },
    (error) => {
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: error instanceof UsageError ? error.message : String(error?.stack || error) }, null, 2)}\n`,
      );
      process.exit(1);
    },
  );
