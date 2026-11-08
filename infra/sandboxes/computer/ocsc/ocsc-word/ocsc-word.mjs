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
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { infographicXml, wordStyle } from "./docx-infographic.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = process.env.OCSC_WORD_TEMPLATES || join(HERE, "templates");
const WORKSPACE =
  process.env.WORKSPACE_DIR || process.env.HOME || process.cwd();
const DEFAULT_TEMPLATE = "OCSCReport";
/** Built-in templates that were replaced, so specs naming them still work. */
const REPLACED_TEMPLATES = { ocscreportv1: DEFAULT_TEMPLATE };
const BRAND_GREEN = "77C043";
const HEADING_FONT = "Arial";
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

class UsageError extends Error {}

const MAX_IMAGE_BYTES = 25 * 1048576;

/** An https image, fetched with curl so the computer's egress proxy applies. */
function download(url, label) {
  const dir = mkdtempSync(join(tmpdir(), "ocsc-word-"));
  const file = join(dir, "image");
  try {
    execFileSync(
      "curl",
      [
        "-fsSL",
        "--proto",
        "=https",
        "--max-time",
        "120",
        "--retry",
        "2",
        "--max-filesize",
        String(MAX_IMAGE_BYTES),
        "-o",
        file,
        url,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    return readFileSync(file);
  } catch (error) {
    const reason = String(error?.stderr || error?.message || error)
      .trim()
      .split("\n")
      .pop();
    throw new UsageError(`${label}: could not download ${url} (${reason}).`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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
  const asked = wanted.replace(TEMPLATE_EXT, "");
  const name = REPLACED_TEMPLATES[asked.toLowerCase()] ?? asked;
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

/** OCSC's offices, for a back cover's address (templates/offices.json). */
function offices() {
  try {
    const list = JSON.parse(
      readFileSync(join(TEMPLATE_DIR, "offices.json"), "utf8"),
    );
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function officeNames() {
  return offices()
    .map((o) => o.office)
    .join(", ");
}

function resolveOffice(value) {
  const want = norm(value)
    .replace(/\b(ocsc|office)\b/g, "")
    .trim();
  const hit = offices().find((o) =>
    [o.office, ...(o.aliases ?? [])].some((n) => norm(n) === want),
  );
  if (!hit)
    throw new UsageError(
      `Unknown office ${JSON.stringify(value)}. OCSC offices: ${officeNames()}.`,
    );
  return hit;
}

function today() {
  return new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const FIELD_RE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;
const HEADING_NUMBER = /^\s*\d+(\.\d+)*\.?\s+/;

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

  hasStyle(id) {
    return Boolean(this.styles?.includes(`w:styleId="${id}"`));
  }

  /** The template numbers its headings itself, so typed numbers would show twice. */
  numberedHeadings() {
    const style =
      /<w:style [^>]*w:styleId="Heading1"[^>]*>[\s\S]*?<\/w:style>/.exec(
        this.styles ?? "",
      )?.[0];
    return Boolean(style?.includes("<w:numPr>"));
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
    if (typeof path !== "string" || !path.trim())
      throw new UsageError("An image path or https URL is required.");
    this.images ??= new Map();
    if (this.images.has(path)) return this.images.get(path);
    let bytes;
    if (/^https:\/\//i.test(path)) bytes = download(path, "image");
    else if (/^[a-z]+:/i.test(path))
      throw new UsageError(`Images are workspace paths or https URLs: ${path}`);
    else {
      const { full } = inWorkspace(path, "image path");
      if (!existsSync(full)) throw new UsageError(`Image not found: ${path}`);
      bytes = readFileSync(full);
    }
    const size = imageSize(bytes);
    const ext = bytes.readUInt32BE(0) === 0x89504e47 ? ".png" : ".jpg";
    if (!size)
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
    const image = { rid, ...size };
    this.images.set(path, image);
    return image;
  }

  /** A run holding a picture `cx` EMU wide, with an id no other drawing in the document uses. */
  pictureRun(img, cx, name) {
    this.drawingId ??= Math.max(
      1000,
      ...[...this.xml.matchAll(/<wp:docPr\b[^>]*?\bid="(\d+)"/g)].map((m) =>
        Number(m[1]),
      ),
    );
    this.drawingId += 1;
    const id = this.drawingId;
    const cy = Math.round((cx * img.h) / img.w);
    return (
      `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/>` +
      `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${img.rid}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
      `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
    );
  }

  infographicBlock(block, n) {
    const source = block.image ?? block.visual;
    const label = `Block ${n} (infographic)`;
    if (typeof source !== "string" || !source.trim())
      throw new UsageError(
        `${label} needs "image": the infographic's https URL or a workspace PNG/JPEG.`,
      );
    try {
      const style = wordStyle(block, this.lastInfographic);
      this.lastInfographic = style;
      const img = this.addImage(source.trim());
      return infographicXml(block, style, {
        runs,
        label,
        picture: (cx) =>
          this.pictureRun(img, cx, block.caption || "Infographic"),
      });
    } catch (error) {
      throw error instanceof UsageError ? error : new UsageError(error.message);
    }
  }

  imageBlock(block, n) {
    const source = block.path ?? block.image;
    const img = this.addImage(source);
    const widthCm = Math.min(Number(block.width_cm) || 15, 16);
    const name = basename(String(source).split("?")[0]) || `Picture ${n}`;
    let out = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${this.pictureRun(img, Math.round(widthCm * 360000), name)}</w:p>`;
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
            const text = this.numberedHeadings()
              ? String(b.text ?? "").replace(HEADING_NUMBER, "")
              : b.text;
            return para(text, { style: `Heading${level}` });
          }
          case "paragraph":
            return para(b.text, {
              align: b.align,
              style: this.hasStyle("Body") ? "Body" : undefined,
            });
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
          case "infographic":
            return this.infographicBlock(b, n);
          case "pagebreak":
            return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
          default:
            throw new UsageError(
              `Block ${n} has unknown type ${JSON.stringify(b?.type)}. Use heading, paragraph, bullets, numbered, table, image, infographic or pagebreak.`,
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

  /** The section break closing the content before a back cover, or null when there is no back cover. */
  contentEnd(els) {
    const back = els.findIndex((e) =>
      e.xml.includes('w:val="BackCoverAddress"'),
    );
    if (back < 0) return null;
    return (
      els
        .slice(0, back)
        .reverse()
        .find((e) => e.tag === "p" && e.xml.includes("<w:sectPr")) ?? null
    );
  }

  /** Adds body XML at the end of the content: before the back cover, or before the final section. */
  insertBeforeSectPr(xml) {
    const els = this.elements();
    const sect =
      this.contentEnd(els) ??
      [...els].reverse().find((e) => e.tag === "sectPr");
    const at = sect ? sect.from : this.xml.lastIndexOf("</w:body>");
    this.xml = this.xml.slice(0, at) + xml + this.xml.slice(at);
  }

  /** The heading element, and where its section ends. */
  section(heading) {
    const els = this.elements();
    const wants = [norm(heading), norm(heading).replace(HEADING_NUMBER, "")];
    const idx = els.findIndex((e) => e.level && wants.includes(norm(e.text)));
    const loose =
      idx >= 0
        ? idx
        : els.findIndex(
            (e) => e.level && wants.some((w) => w && norm(e.text).includes(w)),
          );
    if (loose < 0) {
      const found = els.filter((e) => e.level).map((e) => e.text);
      throw new UsageError(
        `Heading not found: ${JSON.stringify(heading)}. Headings in this document: ${JSON.stringify(found)}`,
      );
    }
    const h = els[loose];
    const stop = this.contentEnd(els);
    const end = els
      .slice(loose + 1)
      .find(
        (e) =>
          e === stop || e.tag === "sectPr" || (e.level && e.level <= h.level),
      );
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
      headerFiles.set(
        name,
        fitBanner(next, title || current.title, subtitle || current.subtitle),
      );
    }
    if (title) this.meta.title = title;
    if (subtitle) this.meta.subtitle = subtitle;
    return changed;
  }

  /** Writes an office's name, address, phone and contacts in the back cover; false when there is none. */
  setOffice(office) {
    const pPr = (p) => /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p ?? "")?.[0] ?? "";
    const rPr = (p) =>
      /<w:r(?:\s[^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/.exec(p ?? "")?.[1] ?? "";
    const line = (from, text) =>
      `<w:p>${pPr(from)}<w:r>${rPr(from)}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
    let found = false;
    // The text box is written twice, for Word and for older readers; both are rewritten.
    this.xml = this.xml.replace(
      /(<w:txbxContent\b[^>]*>)([\s\S]*?)(<\/w:txbxContent>)/g,
      (box, open, inner, close) => {
        if (!inner.includes('w:val="BackCoverAddress"')) return box;
        found = true;
        const paras = inner.match(PARA_RE) ?? [];
        const styled = paras.filter((p) =>
          p.includes('w:val="BackCoverAddress"'),
        );
        const plain = styled[1] ?? styled[0];
        const contact =
          paras.find(
            (p) =>
              !p.includes('w:val="BackCoverAddress"') && /\S/.test(textOf(p)),
          ) ?? plain;
        const contacts = [
          office.email && `E: ${office.email}`,
          office.web && `W: ${office.web}`,
        ].filter(Boolean);
        return (
          open +
          line(styled[0], office.label || `${office.office} Office`) +
          [
            ...(office.lines ?? []),
            ...(office.phone ? [`T: ${office.phone}`] : []),
          ]
            .map((l) => line(plain, l))
            .join("") +
          (contacts.length ? line(contact, contacts.join(" | ")) : "") +
          close
        );
      },
    );
    if (found) this.meta.office = office.office;
    return found;
  }

  /**
   * Adds a row to the Document Control table with the next revision (or `code`) and today's date,
   * and puts the same revision and date in the job row, on the cover and in the footers.
   */
  async addRevision({ code, author } = {}) {
    const els = this.elements();
    const table = els.find(
      (e) =>
        e.tag === "tbl" &&
        e.text.includes("Authorised") &&
        e.text.includes("Issue Date"),
    );
    if (!table) return null;
    const rows = childrenOf(table.xml, "tr");
    const head = rows.findIndex((r) => textOf(r.xml).includes("Authorised"));
    const last = rows[rows.length - 1];
    if (head < 0 || head === rows.length - 1) return null;
    const labels = childrenOf(rows[head].xml, "tc").map((c) =>
      norm(textOf(c.xml)),
    );
    const cells = childrenOf(last.xml, "tc");
    if (cells.length !== labels.length) return null;
    const col = (label) => labels.findIndex((l) => l.startsWith(label));
    const from = textOf(cells[0].xml).trim();
    const to = code ? String(code).trim() : nextRevision(from);
    if (!from || from.includes("{{") || !to || to === from) return null;
    const oldDate = textOf(cells[col("issue")]?.xml ?? "").trim();
    const date = today();
    const values = new Map([
      [0, to],
      [col("issue"), date],
      [col("checked"), ""],
      [col("authorised"), ""],
      ...(author ? [[col("author"), String(author)]] : []),
    ]);
    values.delete(-1);
    const row =
      last.xml.slice(0, cells[0].from) +
      cells
        .map((c, i) => (values.has(i) ? cellText(c.xml, values.get(i)) : c.xml))
        .join("") +
      last.xml.slice(cells[cells.length - 1].to);

    // The job row under the vertical labels carries the current revision too.
    const jobLabels = childrenOf(rows[0].xml, "tc").map((c) =>
      norm(textOf(c.xml)),
    );
    const jobCells = rows[1] ? childrenOf(rows[1].xml, "tc") : [];
    const revCol = jobLabels.indexOf("revision");
    const jobRow =
      head > 1 && revCol >= 0 && jobCells.length === jobLabels.length
        ? rows[1].xml.slice(0, jobCells[0].from) +
          jobCells
            .map((c, i) => (i === revCol ? cellText(c.xml, to) : c.xml))
            .join("") +
          rows[1].xml.slice(jobCells[jobCells.length - 1].to)
        : null;

    const tableXml =
      table.xml.slice(0, rows[0].from) +
      rows.map((r, i) => (i === 1 && jobRow ? jobRow : r.xml)).join("") +
      row +
      table.xml.slice(last.to);
    this.xml =
      this.xml.slice(0, table.from) + tableXml + this.xml.slice(table.to);

    // The cover's date, which comes before the table so its position is unchanged.
    const cover = els.find(
      (e) => e.tag === "tbl" && e.from < table.from && e.text.includes(oldDate),
    );
    if (cover && oldDate)
      this.xml =
        this.xml.slice(0, cover.from) +
        swapText(cover.xml, [oldDate], date, () => {}) +
        this.xml.slice(cover.to);
    for (const [name, xml] of await this.headerFooterFiles()) {
      if (!name.includes("footer")) continue;
      let next = swapText(xml, [from], to, () => {});
      if (oldDate) next = swapText(next, [oldDate], date, () => {});
      this.zip.file(name, next);
    }
    return { from, to, date };
  }

  /**
   * Keeps headings and table text left-aligned when body text is justified, and keeps an introduction written
   * before the first chapter on that chapter's page rather than alone on a page of its own.
   */
  tidyLayout() {
    if (this.styles)
      this.styles = this.styles.replace(
        /<w:style [^>]*w:styleId="(?:Heading[1-9]|TOCHeading)"[^>]*>[\s\S]*?<\/w:style>/g,
        (s) =>
          s.includes("<w:pPr>")
            ? s.replace(
                /<w:pPr>([\s\S]*?)<\/w:pPr>/,
                (_, inner) => `<w:pPr>${withJc(inner)}</w:pPr>`,
              )
            : s.replace(
                /(<w:rPr>|<\/w:style>)/,
                '<w:pPr><w:jc w:val="left"/></w:pPr>$1',
              ),
      );
    const toc = /<w:instrText[^>]*>\s*TOC\b/.exec(this.xml);
    if (!toc) return;
    const els = this.elements();
    const stop = this.contentEnd(els);
    const brk = els.findIndex(
      (e) => e.from > toc.index && e.tag === "p" && e.xml.includes("<w:sectPr"),
    );
    if (brk < 0) return;
    let lead = false;
    for (const e of els.slice(brk + 1)) {
      if (e === stop || e.tag === "sectPr" || e.xml.includes("<w:sectPr"))
        break;
      if (e.level === 1) {
        if (lead && !e.xml.includes("<w:pageBreakBefore")) {
          const p = e.xml.replace(
            /(<w:pStyle [^>]*\/>(?:<w:keepNext[^>]*\/>)?(?:<w:keepLines[^>]*\/>)?)/,
            '$1<w:pageBreakBefore w:val="0"/>',
          );
          this.xml = this.xml.slice(0, e.from) + p + this.xml.slice(e.to);
        }
        break;
      }
      if (e.tag === "tbl" || e.text.trim() || /<w:drawing|<w:pict/.test(e.xml))
        lead = true;
    }
    // Table text without an alignment of its own inherits the body's justification.
    const all = this.elements();
    const end = this.contentEnd(all);
    const tables = all.filter(
      (e) =>
        e.tag === "tbl" && e.from > toc.index && (!end || e.from < end.from),
    );
    for (const t of tables.reverse()) {
      const xml = t.xml.replace(PARA_RE, (p) => {
        if (p.includes("<w:jc ")) return p;
        const q = p.replace("<w:pPr/>", "<w:pPr></w:pPr>");
        return q.includes("<w:pPr>")
          ? q.replace(
              /<w:pPr>([\s\S]*?)<\/w:pPr>/,
              (_, pPr) => `<w:pPr>${withJc(pPr)}</w:pPr>`,
            )
          : q.replace(
              /(<w:p(?=[\s>])[^>]*>)/,
              '$1<w:pPr><w:jc w:val="left"/></w:pPr>',
            );
      });
      this.xml = this.xml.slice(0, t.from) + xml + this.xml.slice(t.to);
    }
  }

  /**
   * The page each heading after `fromOffset` lands on, counting the content's pages from 1. An
   * estimate from line lengths, picture and table sizes; updating the table in Word makes it exact.
   */
  headingPages(fromOffset) {
    const els = this.elements();
    const stop = this.contentEnd(els);
    const sect =
      /<w:sectPr\b[\s\S]*?<\/w:sectPr>/.exec(
        stop?.xml ?? this.xml.slice(this.xml.lastIndexOf("<w:sectPr")),
      )?.[0] ?? "";
    const num = (re, fallback) => Number(re.exec(sect)?.[1] ?? fallback);
    const avail =
      num(/<w:pgSz [^>]*w:h="(\d+)"/, 16838) -
      num(/<w:pgMar [^>]*w:top="(\d+)"/, 1440) -
      num(/<w:pgMar [^>]*w:bottom="(\d+)"/, 1440);
    const width =
      num(/<w:pgSz [^>]*w:w="(\d+)"/, 11906) -
      num(/<w:pgMar [^>]*w:left="(\d+)"/, 1440) -
      num(/<w:pgMar [^>]*w:right="(\d+)"/, 1440);
    const styles = this.styles ?? "";
    const styleXml = (id) =>
      new RegExp(
        `<w:style [^>]*w:styleId="${id}"[^>]*>[\\s\\S]*?</w:style>`,
      ).exec(styles)?.[0] ?? "";
    // Sizes in twips: half-points x 10. Word's own default is 10 pt.
    const defaults =
      /<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/.exec(styles)?.[0] ?? "";
    const size =
      Number(
        /<w:sz w:val="(\d+)"/.exec(styleXml("Normal"))?.[1] ??
          /<w:sz w:val="(\d+)"/.exec(defaults)?.[1] ??
          20,
      ) * 10;
    const spacing =
      Number(
        /w:line="(\d+)" w:lineRule="auto"/.exec(styleXml("Normal"))?.[1] ?? 240,
      ) / 240;
    const line = size * 1.15 * spacing;
    const lines = (text, w, sz = size) =>
      Math.max(1, Math.ceil((text.length * sz * 0.45) / Math.max(w, 1)));
    const pictures = (xml) =>
      [...xml.matchAll(/<wp:extent cx="\d+" cy="(\d+)"/g)].reduce(
        (sum, m) => sum + Number(m[1]) / 635,
        0,
      );
    const breaksBefore = (level) =>
      /<w:pageBreakBefore\/>/.test(styleXml(`Heading${level}`));
    const pPrDefault =
      /<w:pPrDefault>[\s\S]*?<\/w:pPrDefault>/.exec(styles)?.[0] ?? "";
    // The paragraph's own properties, then its style and the styles it is based on, then the defaults.
    const chain = (pPr, id) => {
      const out = [pPr];
      for (let s = id, n = 0; s && n < 6; n += 1) {
        const x = styleXml(s);
        if (!x) break;
        out.push(x);
        s = /<w:basedOn w:val="([^"]+)"/.exec(x)?.[1];
      }
      if (!out.includes(styleXml("Normal"))) out.push(styleXml("Normal"));
      return [...out, pPrDefault];
    };
    const first = (re, xmls) => {
      for (const x of xmls) {
        const m = re.exec(x);
        if (m) return Number(m[1]);
      }
      return null;
    };
    let trailing = 0;
    const paragraph = (xml, w) => {
      const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(xml)?.[0] ?? "";
      const props = chain(
        pPr,
        /<w:pStyle w:val="([^"]+)"/.exec(pPr)?.[1] ?? "Normal",
      );
      // The size of the run holding most of the text.
      const main = childrenOf(xml, "r").reduce(
        (best, r) =>
          textOf(r.xml).length > textOf(best).length ? r.xml : best,
        "",
      );
      const sz =
        (first(/<w:sz w:val="(\d+)"/, [main]) ??
          first(/<w:sz w:val="(\d+)"/, props.slice(1)) ??
          size / 10) * 10;
      const ls = first(
        /<w:spacing [^>]*w:line="(\d+)" w:lineRule="auto"/,
        props,
      );
      const contextual = props.some((x) =>
        x.includes("<w:contextualSpacing/>"),
      );
      const text = textOf(xml).trim();
      trailing = contextual
        ? 0
        : (first(/<w:spacing [^>]*w:after="(\d+)"/, props) ?? 0);
      return (
        pictures(xml) +
        (text || !pictures(xml)
          ? lines(text, w, sz) * sz * 1.15 * ((ls ?? 240) / 240)
          : 0) +
        (contextual
          ? 0
          : (first(/<w:spacing [^>]*w:before="(\d+)"/, props) ?? 0)) +
        trailing
      );
    };
    const height = (e) => {
      if (e.tag === "tbl") {
        const tblMar =
          /<w:tblCellMar>[\s\S]*?<\/w:tblCellMar>/.exec(e.xml)?.[0] ?? "";
        const grid = [...e.xml.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) =>
          Number(m[1]),
        );
        // A cell merged down over several rows counts once, against the rows it spans.
        let merged = 0;
        let spanned = 0;
        const rows = childrenOf(e.xml, "tr").reduce((sum, row) => {
          const cells = childrenOf(row.xml, "tc");
          const heights = cells.map((c, i) => {
            const cellW =
              Number(/<w:tcW w:w="(\d+)" w:type="dxa"/.exec(c.xml)?.[1] ?? 0) ||
              grid[i] ||
              width / Math.max(cells.length, 1);
            const mar =
              /<w:tcMar>[\s\S]*?<\/w:tcMar>/.exec(c.xml)?.[0] ?? tblMar;
            const edge = (side) =>
              Number(new RegExp(`<w:${side} w:w="(\\d+)"`).exec(mar)?.[1] ?? 0);
            const h =
              edge("top") +
              edge("bottom") +
              childrenOf(c.xml, "p").reduce(
                (t, p) =>
                  t +
                  paragraph(
                    p.xml,
                    cellW - (edge("left") || 100) - (edge("right") || 100),
                  ),
                0,
              );
            if (/<w:vMerge w:val="restart"\/>/.test(c.xml)) {
              merged = Math.max(merged, h);
              return 0;
            }
            return /<w:vMerge\/>|<w:vMerge w:val="continue"\/>/.test(c.xml)
              ? 0
              : h;
          });
          const h = Math.max(line, ...heights) + 80;
          spanned += h;
          return sum + h;
        }, 200);
        trailing = 0;
        return rows + Math.max(0, merged - spanned);
      }
      trailing = 0;
      if (e.level) return line * 2.5;
      return paragraph(e.xml, width);
    };
    const pages = new Map();
    let page = 1;
    let used = 0;
    for (const e of els) {
      if (e.from < fromOffset || e.tag === "sdt") continue;
      if (e === stop || e.tag === "sectPr") break;
      if (e.xml.includes("<w:sectPr")) continue;
      if (/<w:br w:type="page"\/>/.test(e.xml) && !textOf(e.xml).trim()) {
        page += 1;
        used = 0;
        continue;
      }
      if (
        e.level &&
        used > 0 &&
        breaksBefore(e.level) &&
        !/<w:pageBreakBefore w:val="(?:0|false)"\/>/.test(e.xml)
      ) {
        page += 1;
        used = 0;
      }
      if (e.level) pages.set(e.from, page);
      used += height(e);
      // Word drops the space after the last paragraph on a page.
      while (used - trailing > avail) {
        page += 1;
        used -= avail;
      }
    }
    return pages;
  }

  /** Writes a Table of Contents' entries and their page numbers from the headings. */
  async refreshToc() {
    const instr = /<w:instrText[^>]*>\s*TOC\b([^<]*)<\/w:instrText>/.exec(
      this.xml,
    );
    if (!instr) return false;
    const range = /\\o\s+"(\d)-(\d)"/.exec(instr[1]);
    const [lo, hi] = range ? [Number(range[1]), Number(range[2])] : [1, 3];
    const before = this.xml.slice(0, instr.index);
    const start = Math.max(
      before.lastIndexOf("<w:p>"),
      before.lastIndexOf("<w:p "),
    );
    if (start < 0) return false;
    // The field runs from the TOC paragraph to the paragraph holding its end.
    let depth = 0;
    let at = start;
    let firstPara = null;
    let lastPara = null;
    while (at < this.xml.length) {
      const end = closeOf(this.xml, at, "p");
      const p = this.xml.slice(at, end);
      firstPara ??= p;
      for (const m of p.matchAll(/w:fldCharType="(begin|end)"/g))
        depth += m[1] === "begin" ? 1 : -1;
      if (depth <= 0) {
        lastPara = { p, end };
        break;
      }
      const next = /<w:p[\s>]/.exec(this.xml.slice(end));
      if (!next) return false;
      at = end + next.index;
    }
    if (!lastPara) return false;
    const begin = firstPara.lastIndexOf(
      'w:fldCharType="begin"',
      firstPara.search(/<w:instrText[^>]*>\s*TOC\b/),
    );
    const sep = firstPara.indexOf('w:fldCharType="separate"', begin);
    if (begin < 0 || sep < 0) return false;
    const runStart = Math.max(
      firstPara.lastIndexOf("<w:r>", begin),
      firstPara.lastIndexOf("<w:r ", begin),
    );
    const fieldStart = firstPara.slice(
      runStart,
      firstPara.indexOf("</w:r>", sep) + "</w:r>".length,
    );

    const numbered = this.numberedHeadings();
    const pages = this.headingPages(lastPara.end);
    const counters = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const entries = [];
    for (const e of this.elements()) {
      if (!e.level || e.from < lastPara.end) continue;
      const text = e.text.trim();
      if (!text) continue;
      counters[e.level - 1] += 1;
      counters.fill(0, e.level);
      if (e.level < lo || e.level > hi) continue;
      const number = numbered ? counters.slice(0, e.level).join(".") : "";
      entries.push({
        style: `TOC${e.level}`,
        runs:
          (number ? `<w:r><w:t>${number}</w:t></w:r><w:r><w:tab/></w:r>` : "") +
          `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r>` +
          (pages.has(e.from)
            ? `<w:r><w:tab/></w:r><w:r><w:t>${pages.get(e.from)}</w:t></w:r>`
            : ""),
      });
    }
    const para = (style, inner) =>
      `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${inner}</w:p>`;
    const [first, ...rest] = entries;
    const xml =
      para(first?.style ?? `TOC${lo}`, fieldStart + (first?.runs ?? "")) +
      rest.map((e) => para(e.style, e.runs)).join("") +
      `<w:p>${/<w:pPr>[\s\S]*?<\/w:pPr>/.exec(lastPara.p)?.[0] ?? ""}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
    this.xml = this.xml.slice(0, start) + xml + this.xml.slice(lastPara.end);

    const settings = this.zip.file("word/settings.xml");
    if (settings) {
      // Asking Word to update fields on opening makes it warn about "fields that may refer to other files".
      const s = await settings.async("string");
      if (s.includes("<w:updateFields"))
        this.zip.file(
          "word/settings.xml",
          s.replace(/<w:updateFields\b[^>]*\/>/g, ""),
        );
    }
    return true;
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

/** Paragraph properties made left-aligned, with the alignment where Word's element order needs it. */
function withJc(pPr) {
  const rest = pPr.replace(/<w:jc [^>]*\/>/g, "");
  const at = rest.search(
    /<w:(?:textDirection|textAlignment|textboxTightWrap|outlineLvl|divId|cnfStyle|rPr|sectPr|pPrChange)\b/,
  );
  const i = at < 0 ? rest.length : at;
  return `${rest.slice(0, i)}<w:jc w:val="left"/>${rest.slice(i)}`;
}

/**
 * Left-aligns the banner's title and subtitle and sizes the title to fit the banner on one line.
 * The banner fits about 39 characters at its full 20 pt.
 */
function fitBanner(xml, title, subtitle) {
  return xml.replace(
    /(<w:txbxContent\b[^>]*>)([\s\S]*?)(<\/w:txbxContent>)/g,
    (box, open, inner, close) =>
      open +
      inner.replace(PARA_RE, (p) => {
        const text = textOf(p).trim();
        if (!text || (text !== title && text !== subtitle)) return p;
        let out = /<w:pPr>/.test(p)
          ? p.replace(
              /<w:pPr>([\s\S]*?)<\/w:pPr>/,
              (_, pPr) => `<w:pPr>${withJc(pPr)}</w:pPr>`,
            )
          : p.replace(
              /(<w:p(?=[\s>])[^>]*>)/,
              '$1<w:pPr><w:jc w:val="left"/></w:pPr>',
            );
        if (text === title) {
          const fit = Math.max(
            24,
            Math.min(40, Math.floor((40 * 39) / text.length)),
          );
          out = out.replace(/<w:(sz|szCs) w:val="(\d+)"\/>/g, (m, tag, v) =>
            Number(v) >= 24 && Number(v) <= 40
              ? `<w:${tag} w:val="${fit}"/>`
              : m,
          );
        }
        return out;
      }) +
      close,
  );
}
// Rakazo sets OCSC_AUTHOR to the name of the person whose request this is.
const AUTHOR =
  process.env.OCSC_AUTHOR?.trim() ||
  process.env.OCSC_WORD_AUTHOR?.trim() ||
  "OCSC Bot";

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

/** The top-level `tag` children inside one element's XML, with offsets into that XML. */
function childrenOf(xml, tag) {
  const out = [];
  const re = new RegExp(`<w:${tag}(?=[\\s>/])`, "g");
  let i = xml.indexOf(">") + 1;
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

/** A table cell holding just `text`, keeping the cell's and its first run's formatting. */
function cellText(tc, text) {
  const tcPr = /<w:tcPr>[\s\S]*?<\/w:tcPr>/.exec(tc)?.[0] ?? "";
  const p = /<w:p[\s>][\s\S]*?<\/w:p>/.exec(tc)?.[0] ?? "";
  const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p)?.[0] ?? "";
  const firstRun = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/.exec(p)?.[1];
  const rPr =
    firstRun !== undefined
      ? (/<w:rPr\/>|<w:rPr>[\s\S]*?<\/w:rPr>/.exec(firstRun)?.[0] ?? "")
      : (/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(pPr)?.[0] ?? "");
  const run = text
    ? `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`
    : "";
  return `<w:tc>${tcPr}<w:p>${pPr}${run}</w:p></w:tc>`;
}

/** P01 -> P02, C09 -> C10, A -> B; null when the code has no number or letter to step. */
function nextRevision(code) {
  const digits = /^(.*?)(\d+)$/.exec(code);
  if (digits)
    return (
      digits[1] + String(Number(digits[2]) + 1).padStart(digits[2].length, "0")
    );
  const letter = /^(.*?)([A-Ya-y])$/.exec(code);
  if (letter)
    return letter[1] + String.fromCharCode(letter[2].charCodeAt(0) + 1);
  return null;
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
    let numbered = false;
    let backCover = false;
    try {
      const doc = await Doc.open(readFileSync(t.file));
      fields = await templateFields(doc);
      numbered = doc.numberedHeadings();
      backCover = doc.xml.includes('w:val="BackCoverAddress"');
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
      numbered_headings: numbered,
      ...(backCover
        ? { office: manifest.office === "required" ? "required" : "optional" }
        : {}),
    });
  }
  return {
    ok: true,
    templates: listTemplates(),
    default: DEFAULT_TEMPLATE,
    offices: offices().map((o) => o.office),
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
  const officeName = spec.office ?? spec.fields?.office;
  const backCover = doc.xml.includes('w:val="BackCoverAddress"');
  if (!officeName && backCover && manifest.office === "required")
    throw new UsageError(
      `This template ends with an OCSC office's address on its back cover. Ask the person which office the document is from (${officeNames()}), then put it in the spec as "office".`,
    );
  const office = officeName && backCover ? resolveOffice(officeName) : null;
  if (office) doc.setOffice(office);
  if (typeof manifest.title_placeholder === "string")
    doc.placeholders.title = manifest.title_placeholder;
  if (typeof manifest.subtitle_placeholder === "string")
    doc.placeholders.subtitle = manifest.subtitle_placeholder;
  doc.ensureStyles();
  const fields = {
    ...(manifest.defaults && typeof manifest.defaults === "object"
      ? manifest.defaults
      : {}),
    date: today(),
    ...(spec.title ? { document_title: spec.title } : {}),
    ...(spec.fields && typeof spec.fields === "object" ? spec.fields : {}),
  };
  const known = (k) =>
    typeof fields[k] === "string" && fields[k].trim() ? fields[k].trim() : "";
  const subtitle =
    spec.subtitle ||
    [known("project_number"), known("project_name")]
      .filter(Boolean)
      .join(": ") ||
    known("client_name") ||
    "O’Connor Sutton Cronin & Associates";
  const headers = await doc.headerFiles();
  await doc.setBanner(spec.title, subtitle, headers);
  for (const [n, x] of headers) doc.zip.file(n, x);
  const parts = await doc.headerFooterFiles();
  const filled = (await doc.fillFields(fields, parts)).filter(
    (f) => spec.fields && Object.hasOwn(spec.fields, f),
  );
  for (const [n, x] of parts) doc.zip.file(n, x);

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
  doc.tidyLayout();
  await doc.refreshToc();
  await doc.save(out.full);
  const unfilled = (await templateFields(doc)).filter((f) => f !== "content");
  return {
    ok: true,
    template: template.name,
    ...(office ? { office: office.office } : {}),
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
        const before = (await doc.banner()).title;
        let c = await doc.setBanner(
          op.op === "set_title" ? op.text : null,
          op.op === "set_subtitle" ? op.text : null,
          headers,
        );
        // A report template shows the title on its cover and in its footers rather than a banner.
        if (
          op.op === "set_title" &&
          op.text &&
          before !== doc.placeholders.title
        ) {
          c += doc.replaceText(before, String(op.text), true, rev);
          for (const [name, xml] of await doc.headerFooterFiles()) {
            if (!name.includes("footer")) continue;
            doc.zip.file(
              name,
              swapText(xml, [before], String(op.text), (k) => {
                c += k;
              }),
            );
          }
        }
        report.push({ op: op.op, changed: c });
        break;
      }
      case "set_office": {
        if (!doc.setOffice(resolveOffice(op.office)))
          throw new UsageError(
            `Edit ${n}: this document has no OCSC back cover to put an office's address on.`,
          );
        report.push({
          op: op.op,
          office: doc.meta.office,
          summary: `Back cover address set to the ${doc.meta.office} office`,
        });
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
          `Edit ${n} has unknown op ${JSON.stringify(op?.op)}. Use set_title, set_subtitle, set_office, replace_text, fill_fields, append, insert_after_heading, add_to_section, replace_section or delete_section.`,
        );
    }
  }
  const banner = await doc.banner();
  for (const [n, x] of headers)
    doc.zip.file(n, fitBanner(x, banner.title, banner.subtitle));
  // P01 is written when the document is made; later revisions only when the spec asks for one.
  const options = Array.isArray(spec) ? {} : spec;
  const revision =
    o.clean || !options.revision
      ? null
      : await doc.addRevision({
          code: typeof options.revision === "string" ? options.revision : null,
          author: typeof options.author === "string" ? options.author : null,
        });
  if (revision)
    report.push({
      op: "revision",
      ...revision,
      summary: `Revision ${revision.from} → ${revision.to}, dated ${revision.date}, added to Document Control`,
    });
  doc.tidyLayout();
  await doc.refreshToc();
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
