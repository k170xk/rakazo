/**
 * Reads and edits any .pptx at the package level, so decks the person uploads can be changed as
 * well as OCSC decks: text is changed in place keeping its formatting, slides are added (drawn by
 * pptx-native.mjs in a scratch deck and moved across with their pictures, charts and notes),
 * replaced, removed, moved and duplicated, and every slide that changed gets a review comment
 * from the person who asked (OCSC_AUTHOR). PowerPoint has no tracked changes, so the comments are how a person reviews
 * what changed.
 */
import { basename, dirname, posix } from "node:path";
import JSZip from "jszip";

export const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const REL = {
  slide: `${NS_R}/slide`,
  slideLayout: `${NS_R}/slideLayout`,
  notesSlide: `${NS_R}/notesSlide`,
  notesMaster: `${NS_R}/notesMaster`,
  comments: `${NS_R}/comments`,
  commentAuthors: `${NS_R}/commentAuthors`,
  image: `${NS_R}/image`,
  theme: `${NS_R}/theme`,
};
export const CT = {
  slide: "application/vnd.openxmlformats-officedocument.presentationml.slide+xml",
  notesSlide: "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml",
  comments: "application/vnd.openxmlformats-officedocument.presentationml.comments+xml",
  commentAuthors: "application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml",
};
const MEDIA_TYPES = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  gif: "image/gif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  svg: "image/svg+xml",
  emf: "image/x-emf",
  wmf: "image/x-wmf",
};
// Rakazo sets OCSC_AUTHOR to the name of the person whose request this is.
const AUTHOR = process.env.OCSC_AUTHOR?.trim() || "OCSC Bot";
const SLIDE_LIMIT = 60;

function initialsOf(name) {
  const letters = name
    .split(/\s+/)
    .map((word) => [...word][0] ?? "")
    .filter(Boolean);
  return (letters.length > 1 ? letters[0] + letters[letters.length - 1] : letters[0] ?? "")
    .toUpperCase()
    .slice(0, 4);
}

// ---------- xml helpers ----------

export function attr(xml, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(xml);
  return match ? unesc(match[1]) : "";
}

export function unesc(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");
}

export function esc(text) {
  return String(text)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function parseRels(xml) {
  const out = [];
  for (const match of (xml ?? "").matchAll(/<Relationship\b[^>]*\/?>/g)) {
    out.push({
      id: attr(match[0], "Id"),
      type: attr(match[0], "Type"),
      target: attr(match[0], "Target"),
      external: attr(match[0], "TargetMode") === "External",
    });
  }
  return out;
}

function relsXml(rels) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels
    .map(
      (r) =>
        `<Relationship Id="${esc(r.id)}" Type="${esc(r.type)}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`,
    )
    .join("")}</Relationships>`;
}

export function relsPathOf(part) {
  return `${dirname(part)}/_rels/${basename(part)}.rels`;
}

export function resolvePart(from, target) {
  if (target.startsWith("/")) return target.slice(1);
  return posix.normalize(posix.join(posix.dirname(from), target));
}

export function relativeTarget(from, to) {
  return posix.relative(posix.dirname(from), to);
}

export function nextRelId(rels) {
  let n = 1;
  const used = new Set(rels.map((r) => r.id));
  while (used.has(`rId${n}`)) n += 1;
  return `rId${n}`;
}

/** Paragraph text: runs, fields and line breaks, unescaped. */
export function paragraphText(para) {
  let text = "";
  for (const piece of para.matchAll(
    /<a:(?:r|fld)\b[^>]*>[\s\S]*?<\/a:(?:r|fld)>|<a:br\b[^>]*\/>/g,
  )) {
    if (piece[0].startsWith("<a:br")) text += "\n";
    else text += [...piece[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => unesc(t[1])).join("");
  }
  return text;
}

function bodyParagraphs(xml) {
  return [...xml.matchAll(/<a:p>[\s\S]*?<\/a:p>|<a:p\/>/g)].map((p) => paragraphText(p[0]));
}

export const SHAPE = /<p:sp\b[^>]*>[\s\S]*?<\/p:sp>/g;

// ---------- the package ----------

export class Deck {
  constructor(zip) {
    this.zip = zip;
  }

  static async load(bytes) {
    let zip;
    try {
      zip = await JSZip.loadAsync(bytes);
    } catch {
      throw new Error(
        "this is not a PowerPoint (.pptx) file. A .ppt or .key file must be saved as .pptx first.",
      );
    }
    const deck = new Deck(zip);
    deck.presentation = await deck.text("ppt/presentation.xml");
    if (!deck.presentation) throw new Error("this is not a PowerPoint (.pptx) file.");
    deck.presRels = parseRels(await deck.text("ppt/_rels/presentation.xml.rels"));
    deck.types = await deck.text("[Content_Types].xml");
    return deck;
  }

  async text(part) {
    return (await this.zip.file(part)?.async("string")) ?? null;
  }

  has(part) {
    return this.zip.file(part) !== null;
  }

  write(part, content) {
    this.zip.file(part, content);
  }

  remove(part) {
    this.zip.remove(part);
    this.types = this.types.replace(
      new RegExp(
        `<Override\\b[^>]*PartName="/${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*/>`,
      ),
      "",
    );
  }

  async rels(part) {
    return parseRels(await this.text(relsPathOf(part)));
  }

  writeRels(part, rels) {
    this.write(relsPathOf(part), relsXml(rels));
  }

  override(part, type) {
    if (!this.types.includes(`PartName="/${part}"`))
      this.types = this.types.replace(
        "</Types>",
        `<Override PartName="/${part}" ContentType="${type}"/></Types>`,
      );
  }

  defaultType(ext) {
    const lower = ext.toLowerCase();
    if (new RegExp(`Extension="${lower}"`, "i").test(this.types)) return;
    const type = MEDIA_TYPES[lower] ?? "application/octet-stream";
    this.types = this.types.replace(
      /(<Types\b[^>]*>)/,
      `$1<Default Extension="${lower}" ContentType="${type}"/>`,
    );
  }

  /** Slides in show order: `{ id, rid, part }`. */
  slides() {
    const out = [];
    for (const match of this.presentation.matchAll(/<p:sldId\b[^>]*\/>/g)) {
      const rid = attr(match[0], "r:id");
      const rel = this.presRels.find((r) => r.id === rid);
      if (rel)
        out.push({
          id: attr(match[0], "id"),
          rid,
          part: resolvePart("ppt/presentation.xml", rel.target),
        });
    }
    return out;
  }

  setSlides(list) {
    const xml = list.map((s) => `<p:sldId id="${s.id}" r:id="${s.rid}"/>`).join("");
    if (/<p:sldIdLst\b[^>]*\/>/.test(this.presentation))
      this.presentation = this.presentation.replace(
        /<p:sldIdLst\b[^>]*\/>/,
        `<p:sldIdLst>${xml}</p:sldIdLst>`,
      );
    else if (/<p:sldIdLst>/.test(this.presentation))
      this.presentation = this.presentation.replace(
        /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
        `<p:sldIdLst>${xml}</p:sldIdLst>`,
      );
    else
      this.presentation = this.presentation.replace(
        /(<\/p:sldMasterIdLst>|<\/p:notesMasterIdLst>)(?![\s\S]*<\/p:(?:sldMasterIdLst|notesMasterIdLst)>)/,
        `$1<p:sldIdLst>${xml}</p:sldIdLst>`,
      );
  }

  /** A part name not yet used, such as ppt/slides/slide12.xml. */
  freeName(dir, stem, ext) {
    let n = 1;
    while (this.has(`${dir}/${stem}${n}.${ext}`)) n += 1;
    return `${dir}/${stem}${n}.${ext}`;
  }

  slideSize() {
    const size = /<p:sldSz\b[^>]*\/>/.exec(this.presentation)?.[0] ?? "";
    return { cx: Number(attr(size, "cx")) || 12192000, cy: Number(attr(size, "cy")) || 6858000 };
  }

  /** Registers a slide part at `index` in the show. */
  addSlideToShow(part, index) {
    const rid = nextRelId(this.presRels);
    this.presRels.push({
      id: rid,
      type: REL.slide,
      target: relativeTarget("ppt/presentation.xml", part),
    });
    const list = this.slides();
    const id = Math.max(255, ...list.map((s) => Number(s.id) || 0)) + 1;
    list.splice(index, 0, { id: String(id), rid, part });
    this.setSlides(list);
  }

  async dropSlide(index) {
    const list = this.slides();
    const [gone] = list.splice(index, 1);
    this.setSlides(list);
    this.presRels = this.presRels.filter((r) => r.id !== gone.rid);
    for (const rel of await this.rels(gone.part)) {
      if (rel.type === REL.notesSlide || rel.type === REL.comments) {
        const target = resolvePart(gone.part, rel.target);
        this.remove(target);
        this.zip.remove(relsPathOf(target));
      }
    }
    this.remove(gone.part);
    this.zip.remove(relsPathOf(gone.part));
  }

  /** The layout new slides use: a blank one when the deck has it. */
  async blankLayout() {
    const layouts = Object.keys(this.zip.files).filter((n) =>
      /^ppt\/slideLayouts\/[^/]+\.xml$/.test(n),
    );
    let fallback = null;
    for (const name of layouts.sort()) {
      const xml = (await this.text(name)) ?? "";
      if (/<p:sldLayout\b[^>]*\btype="blank"/.test(xml)) return name;
      if (/<p:cSld\b[^>]*name="[^"]*blank/i.test(xml)) fallback ??= name;
    }
    return fallback ?? layouts.sort()[0];
  }

  notesMasterPart() {
    const rel = this.presRels.find((r) => r.type === REL.notesMaster);
    return rel ? resolvePart("ppt/presentation.xml", rel.target) : null;
  }

  async save() {
    this.write("ppt/presentation.xml", this.presentation);
    this.write("ppt/_rels/presentation.xml.rels", relsXml(this.presRels));
    this.write("[Content_Types].xml", this.types);
    return this.zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  }
}

/** Copies parts from one package into another under free names, following their relationships. */
class Copier {
  constructor(source, target, mapped) {
    this.source = source;
    this.target = target;
    this.mapped = mapped;
    this.done = new Map();
  }

  sourceType(part) {
    const match = new RegExp(
      `<Override\\b[^>]*PartName="/${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*ContentType="([^"]*)"`,
    ).exec(this.source.types);
    return match?.[1] ?? null;
  }

  async copy(part, scale) {
    if (this.done.has(part)) return this.done.get(part);
    const dir = dirname(part);
    const file = basename(part);
    const ext = file.includes(".") ? file.split(".").pop() : "bin";
    const stem = file.replace(/\.[^.]+$/, "").replace(/[^A-Za-z]/g, "") || "part";
    const name = this.target.freeName(
      dir,
      /^ppt\/(media|embeddings)$/.test(dir) ? `ocsc-${stem}` : stem,
      ext,
    );
    this.done.set(part, name);
    this.target.write(name, "");
    let content = await this.source.zip.file(part)?.async(ext === "xml" ? "string" : "nodebuffer");
    if (content === undefined)
      throw new Error(`the new slide refers to ${part}, which is missing.`);
    if (typeof content === "string" && scale && /\/(slides|charts)\//.test(`/${part}`))
      content = scaleXml(content, scale);
    this.target.write(name, content);
    const type = this.sourceType(part);
    if (type) this.target.override(name, type);
    else this.target.defaultType(ext);
    const rels = await this.source.rels(part);
    if (rels.length > 0) {
      const out = [];
      for (const rel of rels) {
        if (rel.external) {
          out.push(rel);
          continue;
        }
        const from = resolvePart(part, rel.target);
        let to = this.mapped(rel, from, name);
        if (to === undefined) to = await this.copy(from, scale);
        if (to === null) continue;
        out.push({ ...rel, target: relativeTarget(name, to) });
      }
      this.target.writeRels(name, out);
    }
    return name;
  }
}

function scaleXml(xml, { sx, sy }) {
  if (sx === 1 && sy === 1) return xml;
  const sc = (v, s) => String(Math.round(Number(v) * s));
  return xml
    .replace(
      /<a:(off|chOff)\b([^>]*)\bx="(-?\d+)"([^>]*)\by="(-?\d+)"/g,
      (_, tag, a, x, b, y) => `<a:${tag}${a}x="${sc(x, sx)}"${b}y="${sc(y, sy)}"`,
    )
    .replace(
      /<a:(ext|chExt)\b([^>]*)\bcx="(\d+)"([^>]*)\bcy="(\d+)"/g,
      (_, tag, a, x, b, y) => `<a:${tag}${a}cx="${sc(x, sx)}"${b}cy="${sc(y, sy)}"`,
    )
    .replace(
      /<p:ext\b([^>]*)\bcx="(\d+)"([^>]*)\bcy="(\d+)"/g,
      (_, a, x, b, y) => `<p:ext${a}cx="${sc(x, sx)}"${b}cy="${sc(y, sy)}"`,
    );
}

// ---------- reading ----------

export function shapeInfo(sp) {
  const nv = /<p:cNvPr\b[^>]*>/.exec(sp)?.[0] ?? "";
  const ph = /<p:ph\b[^>]*\/?>/.exec(sp)?.[0];
  return {
    shape: Number(attr(nv, "id")),
    name: attr(nv, "name"),
    placeholder: ph ? attr(ph, "type") || "body" : null,
  };
}

function titleOf(xml) {
  for (const sp of xml.matchAll(SHAPE)) {
    const info = shapeInfo(sp[0]);
    if (info.placeholder === "title" || info.placeholder === "ctrTitle")
      return bodyParagraphs(sp[0]).join(" ").trim();
  }
  for (const pic of xml.matchAll(/<p:cNvPr\b[^>]*>/g)) {
    const descr = attr(pic[0], "descr");
    if (descr) return descr;
  }
  for (const sp of xml.matchAll(SHAPE)) {
    const text = bodyParagraphs(sp[0]).join(" ").trim();
    if (text) return text;
  }
  return "";
}

async function notesOf(deck, part) {
  for (const rel of await deck.rels(part)) {
    if (rel.type !== REL.notesSlide) continue;
    const xml = (await deck.text(resolvePart(part, rel.target))) ?? "";
    const paragraphs = [];
    for (const sp of xml.matchAll(SHAPE)) {
      if (!/<p:ph\b[^>]*type="body"/.test(sp[0])) continue;
      paragraphs.push(...bodyParagraphs(sp[0]));
    }
    return paragraphs.join("\n").trim();
  }
  return "";
}

async function commentsOf(deck, part) {
  const out = [];
  for (const rel of await deck.rels(part)) {
    if (!/\/comments$/.test(rel.type)) continue;
    const xml = (await deck.text(resolvePart(part, rel.target))) ?? "";
    for (const text of xml.matchAll(/<p(?:188)?:text>([\s\S]*?)<\/p(?:188)?:text>/g))
      out.push(unesc(text[1].replace(/<[^>]+>/g, "")).trim());
    for (const text of xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)) out.push(unesc(text[1]).trim());
  }
  return out.filter(Boolean);
}

/** Every slide's title, text boxes (with the shape number edits use), tables, pictures, notes and comments. */
export async function readDeck(bytes) {
  const deck = await Deck.load(bytes);
  const { cx, cy } = deck.slideSize();
  const slides = [];
  for (const [index, slide] of deck.slides().entries()) {
    const xml = (await deck.text(slide.part)) ?? "";
    const rels = await deck.rels(slide.part);
    const texts = [];
    for (const sp of xml.matchAll(SHAPE)) {
      if (!/<p:txBody>/.test(sp[0])) continue;
      const text = bodyParagraphs(sp[0]).join("\n").trim();
      if (!text) continue;
      texts.push({ ...shapeInfo(sp[0]), text });
    }
    const tables = [...xml.matchAll(/<a:tbl>[\s\S]*?<\/a:tbl>/g)].map((tbl) =>
      [...tbl[0].matchAll(/<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g)].map((tr) =>
        [...tr[0].matchAll(/<a:tc\b[^>]*>[\s\S]*?<\/a:tc>|<a:tc\b[^>]*\/>/g)].map((tc) =>
          bodyParagraphs(tc[0]).join("\n").trim(),
        ),
      ),
    );
    const pictures = [...xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)].map((pic, i) => {
      const nv = /<p:cNvPr\b[^>]*>/.exec(pic[0])?.[0] ?? "";
      const ext = /<a:ext\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(pic[0]);
      return {
        picture: i + 1,
        name: attr(nv, "name"),
        description: attr(nv, "descr"),
        video: /<a:videoFile\b|<p14:media\b/.test(pic[0]),
        size: ext
          ? `${Math.round((Number(ext[1]) / cx) * 100)}% x ${Math.round((Number(ext[2]) / cy) * 100)}% of the slide`
          : undefined,
      };
    });
    slides.push({
      slide: index + 1,
      title: titleOf(xml),
      texts,
      ...(tables.length ? { tables } : {}),
      pictures,
      charts: rels.filter((r) => /\/chart$/.test(r.type)).length,
      notes: await notesOf(deck, slide.part),
      comments: await commentsOf(deck, slide.part),
    });
  }
  return {
    aspect:
      Math.abs(cx / cy - 16 / 9) < 0.01
        ? "16:9"
        : Math.abs(cx / cy - 4 / 3) < 0.01
          ? "4:3"
          : "other",
    slides,
  };
}

// ---------- editing text ----------

/** Replaces `find` with `replace` in one paragraph, across runs, keeping each run's formatting. */
function replaceInParagraph(para, find, replace) {
  const runs = [...para.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)].map((m) => {
    const t = /<a:t>([\s\S]*?)<\/a:t>|<a:t\/>/.exec(m[1]);
    return { whole: m[0], index: m.index, text: t?.[1] !== undefined ? unesc(t[1]) : "" };
  });
  const full = runs.map((r) => r.text).join("");
  if (!find || !full.includes(find)) return { para, count: 0 };
  const texts = runs.map((r) => r.text);
  let count = 0;
  let from = full.length;
  while (from >= 0) {
    const at = full.lastIndexOf(find, from);
    if (at === -1) break;
    count += 1;
    const end = at + find.length;
    let pos = 0;
    let first = -1;
    for (let i = 0; i < texts.length; i += 1) {
      const start = pos;
      const stop = pos + runs[i].text.length;
      pos = stop;
      if (stop <= at || start >= end) continue;
      const cutFrom = Math.max(at - start, 0);
      const cutTo = Math.min(end - start, runs[i].text.length);
      const current = texts[i];
      // `texts` may already be shorter than the original run when an earlier match edited it;
      // matches are applied right to left so earlier offsets stay valid.
      texts[i] = current.slice(0, cutFrom) + (first === -1 ? replace : "") + current.slice(cutTo);
      if (first === -1) first = i;
    }
    from = at - find.length;
  }
  let out = "";
  let last = 0;
  for (const [i, run] of runs.entries()) {
    out += para.slice(last, run.index);
    last = run.index + run.whole.length;
    if (texts[i] === "" && runs[i].text !== "") continue;
    out += run.whole.replace(/<a:t>[\s\S]*?<\/a:t>|<a:t\/>/, `<a:t>${esc(texts[i])}</a:t>`);
  }
  out += para.slice(last);
  return { para: out, count };
}

function replaceText(xml, find, replace) {
  let count = 0;
  const out = xml.replace(/<a:p>[\s\S]*?<\/a:p>/g, (para) => {
    const result = replaceInParagraph(para, find, replace);
    count += result.count;
    return result.para;
  });
  return { xml: out, count };
}

/** New paragraphs for a text box, styled like its first paragraph and run. */
function paragraphsLike(body, lines) {
  const firstPara = /<a:p>[\s\S]*?<\/a:p>/.exec(body)?.[0] ?? "<a:p></a:p>";
  const pPr = /<a:pPr\b[^>]*\/>|<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/.exec(firstPara)?.[0] ?? "";
  const rPr =
    (/<a:r>([\s\S]*?)<\/a:r>/.exec(body)?.[1] ?? "").match(
      /<a:rPr\b[^>]*\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/,
    )?.[0] ?? "";
  const end =
    /<a:endParaRPr\b[^>]*\/>|<a:endParaRPr\b[^>]*>[\s\S]*?<\/a:endParaRPr>/.exec(firstPara)?.[0] ??
    "";
  return lines
    .map((line) => {
      const level =
        typeof line === "object" && Number(line?.level) > 0 ? Math.min(Number(line.level), 8) : 0;
      const text = typeof line === "object" ? String(line?.text ?? "") : String(line);
      const base = pPr.replace(/\slvl="\d+"/, "");
      const para = level
        ? base
          ? base.replace(/<a:pPr\b/, `<a:pPr lvl="${level}"`)
          : `<a:pPr lvl="${level}"/>`
        : base;
      return `<a:p>${para}${text ? `<a:r>${rPr}<a:t>${esc(text)}</a:t></a:r>` : ""}${end}</a:p>`;
    })
    .join("");
}

export function setShapeText(xml, shapeId, lines) {
  let found = false;
  const out = xml.replace(SHAPE, (sp) => {
    if (found || shapeInfo(sp).shape !== shapeId) return sp;
    found = true;
    if (!/<p:txBody>/.test(sp)) return sp;
    return sp.replace(
      /(<p:txBody>[\s\S]*?)(<a:p>[\s\S]*<\/a:p>|<a:p\/>)([\s\S]*?<\/p:txBody>)/,
      (_, head, body, tail) => `${head}${paragraphsLike(body, lines)}${tail}`,
    );
  });
  return { xml: out, found };
}

function titleShapeId(xml) {
  for (const sp of xml.matchAll(SHAPE)) {
    const info = shapeInfo(sp[0]);
    if (info.placeholder === "title" || info.placeholder === "ctrTitle") return info.shape;
  }
  return null;
}

// ---------- notes and comments ----------

export async function setNotes(deck, part, notes) {
  const rels = await deck.rels(part);
  const rel = rels.find((r) => r.type === REL.notesSlide);
  const lines = String(notes).replace(/\r\n?/g, "\n").split("\n");
  if (rel) {
    const target = resolvePart(part, rel.target);
    const xml = (await deck.text(target)) ?? "";
    let done = false;
    const out = xml.replace(SHAPE, (sp) => {
      if (done || !/<p:ph\b[^>]*type="body"/.test(sp)) return sp;
      done = true;
      if (!/<p:txBody>/.test(sp))
        return sp.replace(
          "</p:sp>",
          `<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphsLike("", lines)}</p:txBody></p:sp>`,
        );
      return sp.replace(
        /(<p:txBody>[\s\S]*?)(<a:p>[\s\S]*<\/a:p>|<a:p\/>)([\s\S]*?<\/p:txBody>)/,
        (_, head, body, tail) => `${head}${paragraphsLike(body, lines)}${tail}`,
      );
    });
    if (done) {
      deck.write(target, out);
      return true;
    }
  }
  const master = deck.notesMasterPart();
  if (!master) return false;
  const name = deck.freeName("ppt/notesSlides", "notesSlide", "xml");
  deck.write(
    name,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${NS_R}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphsLike("", lines)}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`,
  );
  deck.override(name, CT.notesSlide);
  deck.writeRels(name, [
    { id: "rId1", type: REL.notesMaster, target: relativeTarget(name, master) },
    { id: "rId2", type: REL.slide, target: relativeTarget(name, part) },
  ]);
  rels.push({ id: nextRelId(rels), type: REL.notesSlide, target: relativeTarget(part, name) });
  deck.writeRels(part, rels);
  return true;
}

async function addComment(deck, part, text, when) {
  const authorsPart = "ppt/commentAuthors.xml";
  let authors = await deck.text(authorsPart);
  if (!authors) {
    authors = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:cmAuthorLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${NS_R}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"></p:cmAuthorLst>`;
    deck.presRels.push({
      id: nextRelId(deck.presRels),
      type: REL.commentAuthors,
      target: "commentAuthors.xml",
    });
    deck.override(authorsPart, CT.commentAuthors);
  }
  let author = [...authors.matchAll(/<p:cmAuthor\b[^>]*\/?>/g)].find(
    (m) => attr(m[0], "name") === AUTHOR,
  )?.[0];
  if (!author) {
    const ids = [...authors.matchAll(/<p:cmAuthor\b[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1]));
    const id = Math.max(-1, ...ids) + 1;
    author = `<p:cmAuthor id="${id}" name="${esc(AUTHOR)}" initials="${esc(initialsOf(AUTHOR))}" lastIdx="0" clrIdx="${id % 8}"/>`;
    authors = authors.replace("</p:cmAuthorLst>", `${author}</p:cmAuthorLst>`);
  }
  const authorId = attr(author, "id");
  const idx = Number(attr(author, "lastIdx") || "0") + 1;
  authors = authors.replace(author, author.replace(/lastIdx="\d+"/, `lastIdx="${idx}"`));
  deck.write(authorsPart, authors);
  const rels = await deck.rels(part);
  const existing = rels.find((r) => r.type === REL.comments);
  const comment = `<p:cm authorId="${authorId}" dt="${when}" idx="${idx}"><p:pos x="10" y="10"/><p:text>${esc(text)}</p:text></p:cm>`;
  if (existing) {
    const target = resolvePart(part, existing.target);
    const xml = (await deck.text(target)) ?? "";
    deck.write(target, xml.replace("</p:cmLst>", `${comment}</p:cmLst>`));
    return;
  }
  const name = deck.freeName("ppt/comments", "comment", "xml");
  deck.write(
    name,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:cmLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${NS_R}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">${comment}</p:cmLst>`,
  );
  deck.override(name, CT.comments);
  rels.push({ id: nextRelId(rels), type: REL.comments, target: relativeTarget(part, name) });
  deck.writeRels(part, rels);
}

// ---------- slides from a scratch deck ----------

/**
 * Moves the slides of a freshly built deck into `deck` at `index`; returns their part names.
 * They go on a blank layout with the master's graphics hidden, unless `layout` names a layout to
 * use and `keepMaster` keeps the master's footer and logo showing behind them.
 */
export async function transplant(
  deck,
  scratchBytes,
  index,
  { layout: chosen, keepMaster = false } = {},
) {
  const scratch = await Deck.load(scratchBytes);
  const layout = chosen ?? (await deck.blankLayout());
  const target = deck.slideSize();
  const source = scratch.slideSize();
  const scale = { sx: target.cx / source.cx, sy: target.cy / source.cy };
  let notesMaster = deck.notesMasterPart();
  const added = [];
  for (const [offset, slide] of scratch.slides().entries()) {
    let newSlide = null;
    const copier = new Copier(scratch, deck, (rel) => {
      if (rel.type === REL.slideLayout) return layout;
      if (rel.type === REL.slide) return newSlide;
      if (rel.type === REL.notesMaster) return notesMaster ?? undefined;
      if (rel.type === REL.comments) return null;
      return undefined;
    });
    if (!notesMaster) {
      const scratchMaster = scratch.notesMasterPart();
      if (scratchMaster) {
        notesMaster = await copier.copy(scratchMaster);
        const rid = nextRelId(deck.presRels);
        deck.presRels.push({
          id: rid,
          type: REL.notesMaster,
          target: relativeTarget("ppt/presentation.xml", notesMaster),
        });
        deck.presentation = deck.presentation.replace(
          /(<\/p:sldMasterIdLst>)/,
          `$1<p:notesMasterIdLst><p:notesMasterId r:id="${rid}"/></p:notesMasterIdLst>`,
        );
      }
    }
    newSlide = deck.freeName("ppt/slides", "slide", "xml");
    copier.done.set(slide.part, newSlide);
    deck.write(newSlide, "");
    let xml = scaleXml((await scratch.text(slide.part)) ?? "", scale);
    if (!keepMaster) xml = xml.replace(/<p:sld\b(?![^>]*showMasterSp)/, '<p:sld showMasterSp="0"');
    deck.write(newSlide, xml);
    deck.override(newSlide, CT.slide);
    const out = [];
    for (const rel of await scratch.rels(slide.part)) {
      if (rel.external) {
        out.push(rel);
        continue;
      }
      const from = resolvePart(slide.part, rel.target);
      let to = copier.mapped(rel, from);
      if (to === undefined) to = await copier.copy(from, scale);
      if (to === null) continue;
      out.push({ ...rel, target: relativeTarget(newSlide, to) });
    }
    deck.writeRels(newSlide, out);
    deck.addSlideToShow(newSlide, index + offset);
    added.push(newSlide);
  }
  return added;
}

export async function duplicateSlide(deck, index, at) {
  const slide = deck.slides()[index];
  const copier = new Copier(deck, deck, (rel, from) => {
    if (rel.type === REL.slide) return copier.done.get(slide.part);
    if (rel.type === REL.comments) return null;
    if (rel.type === REL.notesSlide) return undefined;
    if (
      /\/(chart|chartUserShapes|package|diagramData|diagramLayout|diagramQuickStyle|diagramColors|diagramDrawing)$/.test(
        rel.type,
      )
    )
      return undefined;
    // Pictures, media, layouts and masters are shared between the two slides.
    return from;
  });
  const copy = await copier.copy(slide.part);
  deck.addSlideToShow(copy, at);
  return copy;
}

// ---------- pictures ----------

async function replacePicture(deck, part, which, image) {
  const xml = (await deck.text(part)) ?? "";
  const pics = [...xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)];
  const pick =
    typeof which === "number" || /^\d+$/.test(String(which ?? ""))
      ? pics[Number(which) - 1]
      : pics.find((p) => attr(/<p:cNvPr\b[^>]*>/.exec(p[0])?.[0] ?? "", "name") === which);
  if (!pick) return false;
  const rels = await deck.rels(part);
  const name = deck.freeName("ppt/media", "ocsc-image", image.type === "jpeg" ? "jpeg" : "png");
  deck.write(name, image.bytes);
  deck.defaultType(image.type === "jpeg" ? "jpeg" : "png");
  const rid = nextRelId(rels);
  rels.push({ id: rid, type: REL.image, target: relativeTarget(part, name) });
  deck.writeRels(part, rels);
  const ext = /<a:ext\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(pick[0]);
  let pic = pick[0].replace(/(<a:blip\b[^>]*?)r:embed="[^"]*"/, `$1r:embed="${rid}"`);
  if (ext) {
    // Crop the new picture to fill the old frame, as "cover" does.
    const box = Number(ext[2]) / Number(ext[1]);
    const ratio = image.height / image.width;
    let crop = "";
    if (ratio > box) {
      const t = Math.round(1e5 * 0.5 * (1 - box / ratio));
      crop = `<a:srcRect t="${t}" b="${t}"/>`;
    } else if (ratio < box) {
      const l = Math.round(1e5 * 0.5 * (1 - ratio / box));
      crop = `<a:srcRect l="${l}" r="${l}"/>`;
    }
    pic = pic
      .replace(/<a:srcRect\b[^>]*\/>/, "")
      .replace(/(<\/a:blip>|<a:blip\b[^>]*\/>)/, `$1${crop}`);
  }
  deck.write(part, xml.replace(pick[0], pic));
  return true;
}

// ---------- applying edits ----------

function position(value, count, label, allowEnd = false) {
  const n = Number(value);
  const max = allowEnd ? count + 1 : count;
  if (!Number.isInteger(n) || n < 1 || n > max)
    throw new Error(`${label} must be a slide number from 1 to ${max}.`);
  return n - 1;
}

const short = (text, max = 60) => {
  const clean = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

/**
 * Applies edits in order; each sees the deck as the edits before it left it.
 * `buildSlides(items)` returns the bytes of a scratch deck holding `items` as OCSC slides.
 * `insertSlide(deck, item, index)` may add the slide itself (from the deck's own layouts) and
 * return its part, or return null to have it drawn by `buildSlides`.
 */
export async function applyEdits(
  bytes,
  edits,
  { clean, buildSlides, replacementImages, insertSlide },
) {
  const deck = await Deck.load(bytes);
  const summary = [];
  // Review notes per slide part, written as comments once every edit is done.
  const review = new Map();
  const note = (part, text) => {
    if (!review.has(part)) review.set(part, []);
    review.get(part).push(text);
  };
  for (const [index, edit] of edits.entries()) {
    const label = `Edit ${index + 1}`;
    const list = deck.slides();
    const slideAt = (value, name = "slide") =>
      list[position(value, list.length, `${label} ${name}`)];
    switch (edit?.op) {
      case "replace_text": {
        const find = String(edit.find ?? "");
        if (!find) throw new Error(`${label}: "find" is required.`);
        const replace = String(edit.replace ?? "");
        const targets = edit.slide === undefined ? list : [slideAt(edit.slide)];
        let total = 0;
        for (const slide of targets) {
          const xml = (await deck.text(slide.part)) ?? "";
          const result = replaceText(xml, find, replace);
          if (result.count === 0) continue;
          deck.write(slide.part, result.xml);
          total += result.count;
          note(slide.part, `Changed "${short(find)}" to "${short(replace)}".`);
        }
        if (total === 0)
          throw new Error(
            `${label}: "${short(find)}" was not found${edit.slide ? ` on slide ${edit.slide}` : ""}. Copy the exact words from ocsc-pptx read.`,
          );
        summary.push(
          `Changed "${short(find)}" to "${short(replace)}" (${total} place${total === 1 ? "" : "s"}).`,
        );
        break;
      }
      case "set_text":
      case "title": {
        const slide = slideAt(edit.slide);
        const xml = (await deck.text(slide.part)) ?? "";
        const shape = edit.op === "title" ? titleShapeId(xml) : Number(edit.shape);
        if (!Number.isInteger(shape))
          throw new Error(
            `${label}: ${edit.op === "title" ? "this slide has no title box; use set_text with a shape number from ocsc-pptx read" : '"shape" must be a shape number from ocsc-pptx read'}.`,
          );
        const lines =
          edit.op === "title"
            ? [String(edit.title ?? "")]
            : Array.isArray(edit.paragraphs)
              ? edit.paragraphs
              : Array.isArray(edit.bullets)
                ? edit.bullets
                : String(edit.text ?? "").split("\n");
        const result = setShapeText(xml, shape, lines);
        if (!result.found)
          throw new Error(
            `${label}: slide ${edit.slide} has no text box ${shape}. Use a shape number from ocsc-pptx read.`,
          );
        deck.write(slide.part, result.xml);
        const what = edit.op === "title" ? "the title" : `text box ${shape}`;
        note(slide.part, `Rewrote ${what}.`);
        summary.push(`Rewrote ${what} on slide ${list.indexOf(slide) + 1}.`);
        break;
      }
      case "notes": {
        const slide = slideAt(edit.slide);
        if (!(await setNotes(deck, slide.part, edit.notes ?? "")))
          throw new Error(
            `${label}: this deck has no speaker notes page, so notes cannot be added.`,
          );
        summary.push(`Updated the speaker notes on slide ${list.indexOf(slide) + 1}.`);
        break;
      }
      case "replace_image": {
        const slide = slideAt(edit.slide);
        const image = replacementImages.get(index);
        if (!(await replacePicture(deck, slide.part, edit.picture ?? 1, image)))
          throw new Error(
            `${label}: slide ${edit.slide} has no picture ${edit.picture ?? 1}. Use a picture number from ocsc-pptx read.`,
          );
        note(slide.part, `Replaced picture ${edit.picture ?? 1}.`);
        summary.push(`Replaced picture ${edit.picture ?? 1} on slide ${list.indexOf(slide) + 1}.`);
        break;
      }
      case "insert":
      case "replace": {
        if (edit.op === "insert" && list.length >= SLIDE_LIMIT)
          throw new Error(`${label}: a deck can hold at most ${SLIDE_LIMIT} slides.`);
        const at =
          edit.op === "insert"
            ? edit.at === undefined
              ? list.length
              : position(edit.at, list.length, `${label} at`, true)
            : position(edit.slide, list.length, `${label} slide`);
        const { op, at: _at, slide: _slide, ...fields } = edit;
        if (edit.op === "replace") await deck.dropSlide(at);
        let part = insertSlide ? await insertSlide(deck, { ...fields, __label: label }, at) : null;
        if (!part)
          [part] = await transplant(deck, await buildSlides([{ ...fields, __label: label }]), at);
        note(part, edit.op === "insert" ? "Added this slide." : "Rebuilt this slide.");
        summary.push(
          edit.op === "insert"
            ? `Inserted a new slide at position ${at + 1}.`
            : `Rebuilt slide ${at + 1}.`,
        );
        break;
      }
      case "duplicate": {
        const from = position(edit.slide, list.length, `${label} slide`);
        const to =
          edit.to === undefined ? from + 1 : position(edit.to, list.length, `${label} to`, true);
        const part = await duplicateSlide(deck, from, to);
        note(part, `Copied from slide ${from + 1}.`);
        summary.push(`Copied slide ${from + 1} to position ${to + 1}.`);
        break;
      }
      case "remove": {
        const at = position(edit.slide, list.length, `${label} slide`);
        if (list.length === 1) throw new Error(`${label}: a deck must keep at least one slide.`);
        const title = titleOf((await deck.text(list[at].part)) ?? "");
        review.delete(list[at].part);
        await deck.dropSlide(at);
        summary.push(`Removed slide ${at + 1}${title ? ` ("${short(title, 50)}")` : ""}.`);
        break;
      }
      case "move": {
        const from = position(edit.from, list.length, `${label} from`);
        const to = position(edit.to, list.length, `${label} to`);
        const order = [...list];
        const [moved] = order.splice(from, 1);
        order.splice(to, 0, moved);
        deck.setSlides(order);
        note(moved.part, `Moved from position ${from + 1} to ${to + 1}.`);
        summary.push(`Moved slide ${from + 1} to position ${to + 1}.`);
        break;
      }
      default:
        throw new Error(
          `${label}: op must be replace_text, set_text, title, notes, replace_image, insert, replace, duplicate, remove or move.`,
        );
    }
  }
  let comments = 0;
  if (!clean) {
    const when = new Date().toISOString().replace("Z", "");
    for (const slide of deck.slides()) {
      const notes = review.get(slide.part);
      if (!notes) continue;
      await addComment(deck, slide.part, notes.join(" "), when);
      comments += 1;
    }
  }
  return { bytes: await deck.save(), slides: deck.slides().length, summary, comments };
}
