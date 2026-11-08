/**
 * Decks built on a company PowerPoint template: every slide uses one of the template's own
 * layouts, so its master footer, logo, page number, fonts and colours come through untouched,
 * and text and pictures go into the layout's placeholders (pictures crop to the placeholder's
 * shape, so circles, cubes and triangles stay as designed). Company slides kept in the template,
 * such as the board organograms, are copied in by name. Slides the template has no layout for
 * (charts, tables, timelines, freeform designs) are drawn natively and placed on the template's
 * plain content layout with its heading placeholders filled.
 */
import { existsSync } from "node:fs";
import {
  attr,
  CT,
  Deck,
  duplicateSlide,
  esc,
  NS_R,
  nextRelId,
  paragraphText,
  parseRels,
  REL,
  relativeTarget,
  relsPathOf,
  resolvePart,
  SHAPE,
  setNotes,
  setShapeText,
  shapeInfo,
  transplant,
} from "./pptx-package.mjs";

export const OCSC_TEMPLATE =
  process.env.OCSC_PPTX_TEMPLATE || "/opt/ocsc-word/templates/ocsc-company.pptx";

const EMU = 914400;
const NS = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${NS_R}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;
const GREEN = "76BF43";

/** Friendly names for the OCSC template's layouts. Other templates are used by their layout names. */
export const TEMPLATE_LAYOUTS = {
  cover: "OCSC Cover Page",
  divider: "Title Topic Divider Page",
  about_title: "About Us Title Page",
  text: "Text Only Option 3",
  text_2col: "Text Only Option 2",
  text_3col: "Text Only Option 1",
  text_photo: "Text + 1 Photo",
  text_image: "Text + 1 Image",
  text_box_photo: "Text + Box Shape Photo",
  text_3photos: "Text + 3 box Photos",
  text_3cubes: "Text + 3 box style photos",
  text_4photos: "Text + 4 Photos",
  text_5photos: "Text + 5 square Photo Inserts",
  text_graphic_1: "Text + Graphic 1",
  text_graphic_2: "Text + Graphic 2",
  text_graphic_3: "Text + Graphic 3",
  text_graphic_4: "Text + Graphic 4",
  text_graphic_5: "Text + Graphic 5",
  text_graphic_6: "Text + Graphic 6",
  photo: "1 Photo Insert",
  photo_large: "Large photo Insert",
  photos_3: "3 Photo Inserts",
  photos_5: "5 Photo Insert",
  photos_5_triangles: "5 Triangle Photo Insert",
  photos_8: "8 Photo Insert",
  photos_8_circles: "8 Photo Circle Insert",
  infographic_1: "Infographic Style 1",
  infographic_2: "Infographic Style 2",
  infographic_3: "Infographic Style 3",
  infographic_4: "Infographic Style 4",
  infographic_5: "Infographic Style 5",
  infographic_6: "Infographic Style 6",
  infographic_7: "Infographic Style 7",
  infographic_8: "Infographic Style 8",
  plain: "Text Only Slide",
  thank_you: "Thank You Slide",
};

/** Older slide layouts that have a template equivalent. */
const LAYOUT_ALIASES = { title: "cover", section: "divider", bullets: "text", split: "text_photo" };

/** Company slides kept in the OCSC template, found by the words on them. */
export const COMPANY_SLIDES = {
  company_structure: {
    label: "Company structure chart",
    match: (s) => s.layout === "Company Structure",
  },
  organogram_civil_structural: {
    label: "Board and directors: Civil & Structural",
    match: (s) =>
      /Organogram/.test(s.text) && /Civil &amp; Structural|Civil & Structural/.test(s.text),
  },
  organogram_mechanical_electrical: {
    label: "Board and directors: Mechanical & Electrical",
    match: (s) =>
      /Organogram/.test(s.text) &&
      /Mechanical &amp; Electrical|Mechanical & Electrical/.test(s.text),
  },
  organogram_environmental: {
    label: "Board and directors: Environmental",
    match: (s) => /Organogram/.test(s.text) && /Environmental/.test(s.text),
  },
  about: {
    label: "About OCSC: history and offices",
    match: (s) => /ABOUT OCSC/i.test(s.text) && /Our Offices/.test(s.text),
  },
  services: {
    label: "Services and sectors",
    match: (s) => /Services &amp; Sectors|Services & Sectors/.test(s.text),
  },
};

const NATIVE = new Set([
  "columns",
  "stats",
  "quote",
  "gallery",
  "infographics",
  "chart",
  "table",
  "timeline",
  "motion",
  "custom",
]);

const str = (value, max = 4000) =>
  typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\r\n?/g, "\n").slice(0, max)
    : "";

// ---------- reading a layout ----------

function boxOf(xml) {
  const m = /<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>\s*<a:ext cx="(\d+)" cy="(\d+)"/.exec(xml);
  return m ? { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) } : null;
}

function firstSize(sp) {
  const m =
    /<a:lvl1pPr\b[\s\S]*?<a:defRPr\b[^>]*\bsz="(\d+)"/.exec(sp) ??
    /<a:(?:rPr|endParaRPr)\b[^>]*\bsz="(\d+)"/.exec(sp);
  return m ? Number(m[1]) : 0;
}

/** The placeholders of a layout with the part each plays: heading, pictures, points and so on. */
export function analyseLayout(xml) {
  const phs = [];
  for (const m of xml.matchAll(SHAPE)) {
    const sp = m[0];
    const ph = /<p:ph\b[^>]*\/?>/.exec(sp)?.[0];
    if (!ph) continue;
    const type = attr(ph, "type") || "body";
    if (["dt", "ftr", "sldNum", "hdr"].includes(type)) continue;
    phs.push({
      ph: ph.replace(/\s*hasCustomPrompt="1"/, "").replace(/\/?>$/, "/>"),
      type,
      idx: Number(attr(ph, "idx")) || 0,
      name: attr(/<p:cNvPr\b[^>]*>/.exec(sp)?.[0] ?? "", "name"),
      box: boxOf(sp),
      size: firstSize(sp),
      bold: /\bb="1"/.test(sp),
      caps: /cap="all"/.test(sp),
      prompt: [...sp.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)]
        .map((p) => paragraphText(p[0]))
        .join(" ")
        .trim(),
    });
  }
  const roles = {
    title: null,
    subtitle: null,
    heading: null,
    subheading: null,
    fields: {},
    body: [],
    pictures: [],
    logo: null,
    icons: [],
    points: [],
    extra: [],
  };
  const rest = [];
  for (const p of phs) {
    if (p.type === "title" || p.type === "ctrTitle") roles.title = p;
    else if (p.type === "subTitle") roles.subtitle = p;
    else if (p.type === "pic" && /logo/i.test(p.prompt)) roles.logo = p;
    else if (p.type === "pic") roles.pictures.push(p);
    else if (p.type === "clipArt") roles.icons.push(p);
    else if (p.type === "body" && /^[A-Za-z][A-Za-z ]{1,24}:$/.test(p.prompt))
      roles.fields[p.prompt.slice(0, -1).trim().toLowerCase().replace(/\s+/g, "_")] = p;
    else rest.push(p);
  }
  const header = rest
    .filter((p) => p.box && p.box.y < 1.1 * EMU && p.box.h < 0.45 * EMU)
    .sort((a, b) => b.size - a.size || Number(b.bold) - Number(a.bold));
  if (header[0]) roles.heading = header[0];
  if (header[1]) roles.subheading = header[1];
  const others = rest.filter((p) => !header.slice(0, 2).includes(p));
  const big = others.filter((p) => !p.box || p.box.h >= 1.5 * EMU);
  roles.body = big.sort((a, b) => (a.box?.x ?? 0) - (b.box?.x ?? 0));
  const small = others.filter((p) => !big.includes(p));
  const used = new Set();
  const titles = small.filter((p) => p.caps || p.bold).sort((a, b) => a.idx - b.idx);
  for (const t of titles) {
    const text = small
      .filter((p) => p !== t && !titles.includes(p) && !used.has(p) && p.box && t.box)
      .map((p) => ({ p, dy: p.box.y - t.box.y, dx: Math.abs(p.box.x - t.box.x) }))
      .filter((c) => c.dy > 0 && c.dy < 0.8 * EMU && c.dx < 0.6 * EMU)
      .sort((a, b) => a.dy - b.dy)[0]?.p;
    if (!text) continue;
    used.add(text);
    roles.points.push({ title: t, text });
  }
  const paired = new Set(roles.points.map((pt) => pt.title));
  roles.extra = small.filter((p) => !paired.has(p) && !used.has(p));
  const rows = (a, b) =>
    Math.abs((a.box?.y ?? 0) - (b.box?.y ?? 0)) < 0.3 * EMU
      ? (a.box?.x ?? 0) - (b.box?.x ?? 0)
      : (a.box?.y ?? 0) - (b.box?.y ?? 0);
  roles.pictures.sort(rows);
  roles.icons.sort((a, b) => a.idx - b.idx);
  return roles;
}

/** What a layout can hold, for the bot: `{ heading, pictures, points, ... }`. */
function slotsOf(roles) {
  const out = {};
  if (roles.title) out.title = true;
  if (roles.subtitle) out.subtitle = true;
  if (roles.heading) out.heading = true;
  if (roles.subheading) out.subheading = true;
  for (const f of Object.keys(roles.fields)) out[f] = true;
  if (roles.logo) out.logo = true;
  if (roles.body.length) out.body = roles.body.length;
  if (roles.pictures.length) out.images = roles.pictures.length;
  if (roles.points.length) out.points = roles.points.length;
  if (roles.icons.length) out.icons = roles.icons.length;
  if (roles.extra.length) out.centre = roles.extra.length;
  return out;
}

// ---------- the template deck ----------

async function layoutsOf(deck) {
  const out = [];
  for (const name of Object.keys(deck.zip.files).filter((n) =>
    /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n),
  )) {
    const xml = (await deck.text(name)) ?? "";
    out.push({
      part: name,
      name: attr(/<p:cSld\b[^>]*>/.exec(xml)?.[0] ?? "", "name").trim(),
      xml,
    });
  }
  return out.sort(
    (a, b) => Number(/(\d+)\.xml$/.exec(a.part)[1]) - Number(/(\d+)\.xml$/.exec(b.part)[1]),
  );
}

async function slideFacts(deck) {
  const out = [];
  for (const slide of deck.slides()) {
    const xml = (await deck.text(slide.part)) ?? "";
    const layoutRel = (await deck.rels(slide.part)).find((r) => r.type === REL.slideLayout);
    const layoutXml = layoutRel
      ? ((await deck.text(resolvePart(slide.part, layoutRel.target))) ?? "")
      : "";
    out.push({
      ...slide,
      layout: attr(/<p:cSld\b[^>]*>/.exec(layoutXml)?.[0] ?? "", "name").trim(),
      text: [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(" "),
    });
  }
  return out;
}

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The template layout a slide asks for, or null when it is drawn natively. */
export function findLayout(layouts, item) {
  const named = str(item?.template_layout, 200);
  if (named) {
    const hit = layouts.find((l) => norm(l.name) === norm(named));
    if (!hit)
      throw new Error(
        `template_layout "${named}" is not in this template. Its layouts are: ${layouts.map((l) => l.name).join(", ")}.`,
      );
    return hit;
  }
  const key = LAYOUT_ALIASES[item?.layout] ?? item?.layout;
  if (key === "agenda" || NATIVE.has(key) || key === undefined) return null;
  const wanted = TEMPLATE_LAYOUTS[key];
  if (!wanted) return null;
  return layouts.find((l) => norm(l.name) === norm(wanted)) ?? null;
}

// ---------- writing a slide ----------

/** Paragraphs for a placeholder: strings (with **bold**), `{ text, level, bold }`, or bullets. */
function paragraphs(lines, { bullets = false } = {}) {
  return lines
    .map((line) => {
      const text = typeof line === "object" && line !== null ? str(line.text) : str(line);
      const level =
        typeof line === "object" && Number(line?.level) > 0 ? Math.min(Number(line.level), 4) : 0;
      const bold = typeof line === "object" && line?.bold === true;
      const bulleted = bullets && !(typeof line === "object" && line?.bullet === false);
      const ppr = bulleted
        ? `<a:pPr marL="${228600 * (level + 1)}" indent="-228600"${level ? ` lvl="${level}"` : ""}><a:buClr><a:srgbClr val="${GREEN}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="${level ? "–" : "•"}"/></a:pPr>`
        : level
          ? `<a:pPr lvl="${level}"/>`
          : "";
      const runs = text
        .split(/(\*\*[^*]+\*\*)/)
        .filter(Boolean)
        .map((part) => {
          const strong = bold || /^\*\*[^*]+\*\*$/.test(part);
          const t = strong && part.startsWith("**") ? part.slice(2, -2) : part;
          return `<a:r><a:rPr lang="en-GB"${strong ? ' b="1"' : ""} dirty="0"/><a:t>${esc(t)}</a:t></a:r>`;
        })
        .join("");
      return `<a:p>${ppr}${runs}</a:p>`;
    })
    .join("");
}

function linesOf(value) {
  if (Array.isArray(value)) return value;
  const text = str(value);
  return text ? text.split("\n") : [];
}

function textShape(id, p, lines, opts) {
  if (lines.length === 0) return "";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(p.name || `Placeholder ${id}`)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${p.ph}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs(lines, opts)}</p:txBody></p:sp>`;
}

/** Crop (cover) or pad (contain) a picture to a box, as an a:srcRect. */
function srcRect(img, box, fit) {
  if (!box || !img.width || !img.height) return "";
  const B = box.w / box.h;
  const I = img.width / img.height;
  if (Math.abs(B - I) < 0.005) return "";
  const v = (n) => Math.round(n * 100000);
  if (fit === "contain") {
    if (I > B) {
      const t = v(-(I / B - 1) / 2);
      return `<a:srcRect t="${t}" b="${t}"/>`;
    }
    const l = v(-(B / I - 1) / 2);
    return `<a:srcRect l="${l}" r="${l}"/>`;
  }
  if (I > B) {
    const l = v((1 - B / I) / 2);
    return `<a:srcRect l="${l}" r="${l}"/>`;
  }
  const t = v((1 - I / B) / 2);
  return `<a:srcRect t="${t}" b="${t}"/>`;
}

/** A box on the 1920x1080 grid, in slide units. */
function gridBox(el, size) {
  const sx = size.cx / 1920;
  const sy = size.cy / 1080;
  return {
    x: Math.round((Number(el.x) || 0) * sx),
    y: Math.round((Number(el.y) || 0) * sy),
    w: Math.round((Number(el.w) || 600) * sx),
    h: Math.round((Number(el.h) || 400) * sy),
  };
}

class SlideWriter {
  constructor(deck, part) {
    this.deck = deck;
    this.part = part;
    this.rels = [];
    this.id = 2;
    this.shapes = [];
  }

  nextId() {
    this.id += 1;
    return this.id;
  }

  media(img) {
    const ext = img.type === "jpeg" ? "jpeg" : "png";
    const name = this.deck.freeName("ppt/media", "ocsc-image", ext);
    this.deck.write(name, img.bytes);
    this.deck.defaultType(ext);
    const id = nextRelId([{ id: "rId1" }, ...this.rels]);
    this.rels.push({ id, type: REL.image, target: relativeTarget(this.part, name) });
    return id;
  }

  text(p, value, opts) {
    if (!p) return;
    this.shapes.push(textShape(this.nextId(), p, linesOf(value), opts));
  }

  placeholderPicture(p, img, { fit = "cover", alt = "" } = {}) {
    const rid = this.media(img);
    const id = this.nextId();
    this.shapes.push(
      `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"${alt ? ` descr="${esc(alt)}"` : ""}/><p:cNvPicPr><a:picLocks noGrp="1" noChangeAspect="1"/></p:cNvPicPr><p:nvPr>${p.ph}</p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/>${srcRect(img, p.box, fit)}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr/></p:pic>`,
    );
  }

  /** A picture anywhere on the slide, on the 1920x1080 grid. */
  freePicture(img, el, size) {
    const box = gridBox(el, size);
    const rid = this.media(img);
    const id = this.nextId();
    this.shapes.push(
      `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"${el.alt ? ` descr="${esc(str(el.alt, 300))}"` : ""}/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/>${srcRect(img, box, el.fit === "cover" ? "cover" : "contain")}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.w}" cy="${box.h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`,
    );
  }

  /** A text box anywhere on the slide, on the 1920x1080 grid, in the template's body style. */
  freeText(lines, el, size, { bullets = false } = {}) {
    if (lines.length === 0) return;
    const box = gridBox(el, size);
    const id = this.nextId();
    const level = (n, sz) =>
      `<a:lvl${n}pPr><a:spcBef><a:spcPts val="1000"/></a:spcBef><a:defRPr sz="${sz}"><a:solidFill><a:srgbClr val="414042"/></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:defRPr></a:lvl${n}pPr>`;
    this.shapes.push(
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.w}" cy="${box.h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"><a:normAutofit/></a:bodyPr><a:lstStyle>${level(1, 1800)}${level(2, 1600)}${level(3, 1400)}</a:lstStyle>${paragraphs(lines, { bullets })}</p:txBody></p:sp>`,
    );
  }

  save(layoutPart) {
    this.deck.write(
      this.part,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${this.shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    );
    this.deck.override(this.part, CT.slide);
    this.deck.writeRels(this.part, [
      { id: "rId1", type: REL.slideLayout, target: relativeTarget(this.part, layoutPart) },
      ...this.rels,
    ]);
  }
}

const imageList = (item) => {
  const list = Array.isArray(item.images) ? item.images : item.image ? [item.image] : [];
  return list.map((e) => (typeof e === "string" ? { image: e } : (e ?? {})));
};

/** Every picture a template slide refers to, as `{ source, label }`. */
export function templateImageSources(item, label) {
  const out = [];
  const add = (source, where) => {
    if (typeof source === "string" && source.trim())
      out.push({ source: source.trim(), label: `${label} ${where}` });
  };
  if (!item || typeof item !== "object") return out;
  for (const [i, e] of imageList(item).entries()) add(e.image, `image ${i + 1}`);
  add(item.logo, "logo");
  for (const [i, p] of (Array.isArray(item.points) ? item.points : []).entries())
    add(p?.icon, `point ${i + 1} icon`);
  for (const [i, icon] of (Array.isArray(item.icons) ? item.icons : []).entries())
    add(icon, `icon ${i + 1}`);
  for (const [i, el] of (Array.isArray(item.overlay) ? item.overlay : []).entries())
    add(el?.image, `overlay ${i + 1}`);
  return out;
}

/** Writes one slide on a template layout at `index`; returns its part. */
async function layoutSlide(deck, layout, item, index, images, label) {
  const roles = analyseLayout(layout.xml);
  const part = deck.freeName("ppt/slides", "slide", "xml");
  deck.write(part, "");
  const w = new SlideWriter(deck, part);
  const img = (source, where) => {
    const found = typeof source === "string" ? images.get(source.trim()) : null;
    if (!found) throw new Error(`${label}: ${where} could not be loaded.`);
    return found;
  };
  const fits = (count, slots, what) => {
    if (count > slots)
      throw new Error(
        `${label}: the "${layout.name}" layout has ${slots === 0 ? "no" : `only ${slots}`} ${what} space${slots === 1 ? "" : "s"}, but ${count} were given. Pick another layout or use "overlay" for extra pictures.`,
      );
  };

  if (roles.title) w.text(roles.title, item.title);
  if (roles.subtitle) w.text(roles.subtitle, item.subtitle ?? item.kicker);
  w.text(roles.heading, item.heading ?? (roles.title ? undefined : item.title));
  w.text(
    roles.subheading,
    item.subheading ?? (roles.subtitle ? undefined : (item.subtitle ?? item.kicker)),
  );
  for (const [field, p] of Object.entries(roles.fields))
    if (item[field] !== undefined) w.text(p, `${p.prompt} ${str(item[field], 300)}`);

  const columns = Array.isArray(item.columns) ? item.columns : null;
  const bodies = columns ?? [item.bullets ?? item.body ?? item.text].filter((v) => v !== undefined);
  if (item.__textBox) {
    if (bodies[0] !== undefined)
      w.freeText(linesOf(bodies[0]), item.__textBox, deck.slideSize(), {
        bullets: Array.isArray(item.bullets),
      });
    bodies.length = 0;
  }
  fits(bodies.length, roles.body.length, "text column");
  for (const [i, body] of bodies.entries()) {
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const lines = [
        ...(body.heading ? [{ text: str(body.heading, 200), bold: true, bullet: false }] : []),
        ...linesOf(body.text).map((text) => ({ text, bullet: false })),
        ...(Array.isArray(body.bullets) ? body.bullets : []),
      ];
      w.text(roles.body[i], lines, { bullets: Array.isArray(body.bullets) });
    } else {
      // A list is bullets, except "body" given as a list, which is plain paragraphs.
      const bullets =
        Array.isArray(body) && (columns !== null || (i === 0 && Array.isArray(item.bullets)));
      w.text(roles.body[i], body, { bullets });
    }
  }

  const pictures = imageList(item);
  fits(pictures.length, roles.pictures.length, "picture");
  for (const [i, e] of pictures.entries())
    w.placeholderPicture(roles.pictures[i], img(e.image, `image ${i + 1}`), {
      fit: e.fit === "contain" ? "contain" : item.fit === "contain" ? "contain" : "cover",
      alt: str(e.alt ?? e.caption, 300),
    });
  if (item.logo && roles.logo)
    w.placeholderPicture(roles.logo, img(item.logo, "logo"), {
      fit: "contain",
      alt: "Client logo",
    });

  const points = Array.isArray(item.points) ? item.points : [];
  fits(points.length, roles.points.length, "point");
  const icons = Array.isArray(item.icons) ? item.icons : points.map((p) => p?.icon).filter(Boolean);
  fits(icons.length, roles.icons.length, "icon");
  for (const [i, point] of points.entries()) {
    w.text(roles.points[i].title, typeof point === "string" ? point : point?.title);
    w.text(roles.points[i].text, typeof point === "object" ? point?.text : undefined);
  }
  for (const [i, icon] of icons.entries())
    w.placeholderPicture(roles.icons[i], img(icon, `icon ${i + 1}`), { fit: "contain" });
  if (item.centre ?? item.center) w.text(roles.extra[0], item.centre ?? item.center);

  for (const [i, el] of (Array.isArray(item.overlay) ? item.overlay : []).entries())
    w.freePicture(img(el?.image, `overlay ${i + 1}`), el ?? {}, deck.slideSize());
  w.save(layout.part);
  deck.addSlideToShow(part, index);
  return part;
}

/** Agenda rows: one column up to this many, then two columns. */
const AGENDA_COLUMN_ROWS = 8;
const AGENDA_MAX_ITEMS = 14;
const AGENDA_SPACE = { top: 0.85 * EMU, bottom: 6.65 * EMU, right: 0.6 * EMU };
/** Space between a topic's top and its sub-header, a little more than the template's own. */
const AGENDA_SUB_DROP = 0.31 * EMU;
/** Two columns start left of the template's single column, clear of the "Presentation agenda" title. */
const AGENDA_TWO_COLUMN_X = 5.2 * EMU;

/** Lines an upper-case bold Arial topic wraps to in `width` EMU (a cautious estimate). */
function agendaLines(text, width, sizePt) {
  const perLine = Math.max(1, Math.floor(width / ((0.65 * sizePt * EMU) / 72)));
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const need = used === 0 ? word.length : used + 1 + word.length;
    if (need <= perLine) used = need;
    else {
      lines += 1;
      used = word.length;
    }
  }
  return lines;
}

function placeShape(sp, id, box) {
  return sp
    .replace(/(<p:cNvPr\b[^>]*?\bid=")\d+"/, `$1${id}"`)
    .replace(/(<p:cNvPr\b[^>]*?\bname=")[^"]*"/, `$1Agenda ${id}"`)
    .replace(
      /<a:off x="-?\d+" y="-?\d+"\s*\/>\s*<a:ext cx="\d+" cy="\d+"\s*\/>/,
      `<a:off x="${Math.round(box.x)}" y="${Math.round(box.y)}"/><a:ext cx="${Math.round(box.w)}" cy="${Math.round(box.h)}"/>`,
    );
}

/**
 * The agenda: the template's agenda slide with its rows rebuilt from the template's own circle,
 * number, topic, sub-header and connector, so any number of items keeps the template's look.
 */
async function agendaSlide(deck, facts, item, index, label) {
  const source = facts.find((s) => /agenda/i.test(s.layout));
  if (!source) throw new Error(`${label}: this template has no agenda slide.`);
  const items = (Array.isArray(item.items) ? item.items : []).map((e) =>
    typeof e === "string" ? { title: e } : (e ?? {}),
  );
  if (items.length === 0 || items.length > AGENDA_MAX_ITEMS)
    throw new Error(
      `${label}: an agenda takes 1 to ${AGENDA_MAX_ITEMS} items; split a longer one over two agenda slides.`,
    );
  const at = deck.slides().findIndex((s) => s.part === source.part);
  const part = await duplicateSlide(deck, at, index);
  let xml = (await deck.text(part)) ?? "";
  const right = [...xml.matchAll(/<p:(sp|cxnSp)\b[^>]*>[\s\S]*?<\/p:\1>/g)]
    .map((m) => ({
      sp: m[0],
      box: boxOf(m[0]),
      text: [...m[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join(""),
    }))
    .filter((s) => s.box && s.box.x >= 5.5 * EMU);
  const byY = (a, b) => a.box.y - b.box.y;
  const ovals = right.filter((s) => /prst="ellipse"/.test(s.sp)).sort(byY);
  const number = right.filter((s) => /^\d+$/.test(s.text.trim())).sort(byY)[0];
  const topic = right.filter((s) => /^TOPIC /.test(s.text)).sort(byY)[0];
  const sub = right.filter((s) => /Insert Sub Header/i.test(s.text)).sort(byY)[0];
  const line = right.find((s) => s.sp.startsWith("<p:cxnSp"));
  if (!ovals.length || !number || !topic)
    throw new Error(`${label}: the agenda slide's topics could not be found.`);
  for (const s of right) xml = xml.replace(s.sp, "");

  const oval = ovals[0].box;
  const last = ovals[ovals.length - 1].box;
  const templatePitch = ovals.length > 1 ? (last.y - oval.y) / (ovals.length - 1) : 0.955 * EMU;
  const centre = (oval.y + last.y + last.h) / 2;
  const columns = items.length > AGENDA_COLUMN_ROWS ? 2 : 1;
  const rows = Math.ceil(items.length / columns);
  const room = AGENDA_SPACE.bottom - AGENDA_SPACE.top - oval.h;
  const pitch = rows > 1 ? Math.min(templatePitch, room / (rows - 1)) : templatePitch;
  const top = Math.max(AGENDA_SPACE.top, centre - ((rows - 1) * pitch + oval.h) / 2);
  const left = columns > 1 ? Math.min(oval.x, AGENDA_TWO_COLUMN_X) : oval.x;
  const columnWidth = (deck.slideSize().cx - AGENDA_SPACE.right - left) / columns;
  const topicDx = topic.box.x - oval.x;
  const textWidth = columnWidth - topicDx - (columns > 1 ? 0.15 * EMU : 0);

  let id = Math.max(
    0,
    ...[...xml.matchAll(/<p:cNvPr\b[^>]*?\bid="(\d+)"/g)].map((m) => Number(m[1])),
  );
  const added = [];
  for (const [i, entry] of items.entries()) {
    const column = Math.floor(i / rows);
    const row = i % rows;
    const x = left + column * columnWidth;
    const y = top + row * pitch;
    if (line && row < rows - 1 && i + 1 < items.length)
      added.push(
        placeShape(line.sp, ++id, { x: x + oval.w / 2, y: y + oval.h, w: 0, h: pitch - oval.h }),
      );
    added.push(placeShape(ovals[0].sp, ++id, { ...oval, x, y }));
    let numberSp = placeShape(number.sp, ++id, {
      ...number.box,
      x: x + (number.box.x - oval.x),
      y: y + (number.box.y - oval.y),
    });
    numberSp = setShapeText(numberSp, id, [String(i + 1).padStart(2, "0")]).xml;
    added.push(numberSp);
    const topicY = y + (topic.box.y - oval.y);
    let topicSp = placeShape(topic.sp, ++id, {
      x: x + topicDx,
      y: topicY,
      w: textWidth,
      h: topic.box.h,
    });
    const size = columns > 1 ? 12 : 14;
    if (columns > 1) topicSp = topicSp.replace(/\bsz="1400"/g, 'sz="1200"');
    const title = str(entry.title, 120).toUpperCase();
    topicSp = setShapeText(topicSp, id, [title]).xml;
    const extraLines = agendaLines(title, textWidth, size) - 1;
    added.push(topicSp);
    if (sub && str(entry.text).trim()) {
      let subSp = placeShape(sub.sp, ++id, {
        x: x + topicDx,
        y: topicY + AGENDA_SUB_DROP + (extraLines * 1.1 * size * EMU) / 72,
        w: textWidth,
        h: sub.box.h,
      });
      subSp = setShapeText(subSp, id, [str(entry.text, 200)]).xml;
      added.push(subSp);
    }
  }
  xml = xml.replace("</p:spTree>", `${added.join("")}</p:spTree>`);
  deck.write(part, xml);
  return part;
}

/** Content drawn natively, placed on the template's plain layout with its heading filled in. */
async function nativeSlide(deck, layouts, item, index, buildSlides) {
  const plain =
    layouts.find((l) => norm(l.name) === norm(TEMPLATE_LAYOUTS.plain)) ??
    layouts.find((l) => analyseLayout(l.xml).heading);
  if (!plain) return null;
  const roles = analyseLayout(plain.xml);
  const { title, subtitle, kicker, heading, subheading, ...rest } = item;
  const [part] = await transplant(
    deck,
    await buildSlides([{ ...rest, title: "", __frame: "template" }]),
    index,
    { layout: plain.part, keepMaster: true },
  );
  let xml = (await deck.text(part)) ?? "";
  const header = [
    textShape(9001, roles.heading ?? {}, linesOf(heading ?? title)),
    textShape(9002, roles.subheading ?? {}, linesOf(subheading ?? subtitle ?? kicker)),
  ]
    .filter((s, i) => (i === 0 ? roles.heading : roles.subheading) && s)
    .join("");
  xml = xml.replace(/(<p:grpSpPr\b[\s\S]*?<\/p:grpSpPr>|<p:grpSpPr\/>)/, `$1${header}`);
  deck.write(part, xml);
  return part;
}

// ---------- tidying the package ----------

async function removeSlide(deck, slide) {
  deck.setSlides(deck.slides().filter((s) => s.part !== slide.part));
  deck.presRels = deck.presRels.filter((r) => r.id !== slide.rid);
  deck.remove(slide.part);
  deck.zip.remove(relsPathOf(slide.part));
}

/** Deletes every part nothing refers to any more, such as the pictures of removed sample slides. */
async function dropUnused(deck) {
  await deck.save();
  const keep = new Set([
    "[Content_Types].xml",
    "_rels/.rels",
    "ppt/presentation.xml",
    "ppt/_rels/presentation.xml.rels",
  ]);
  const queue = [];
  for (const r of parseRels(await deck.text("_rels/.rels")))
    if (!r.external) queue.push(resolvePart("", r.target));
  for (const r of deck.presRels)
    if (!r.external) queue.push(resolvePart("ppt/presentation.xml", r.target));
  while (queue.length) {
    const part = queue.pop();
    if (keep.has(part)) continue;
    keep.add(part);
    const rels = relsPathOf(part);
    if (!deck.has(rels)) continue;
    keep.add(rels);
    for (const r of parseRels(await deck.text(rels)))
      if (!r.external) queue.push(resolvePart(part, r.target));
  }
  for (const name of Object.keys(deck.zip.files)) {
    if (deck.zip.files[name].dir || keep.has(name)) continue;
    if (name.includes("/_rels/") && keep.has(name.replace("/_rels/", "/").replace(/\.rels$/, "")))
      continue;
    deck.remove(name);
  }
}

/** Makes sure speaker notes can be written, borrowing a notes page from a scratch deck when the template has none. */
async function ensureNotesMaster(deck, buildSlides) {
  if (deck.notesMasterPart()) return;
  const [part] = await transplant(
    deck,
    await buildSlides([{ layout: "bullets", title: "notes", notes: "notes", __frame: "template" }]),
    deck.slides().length,
  );
  const slide = deck.slides().find((s) => s.part === part);
  for (const rel of await deck.rels(part)) {
    if (rel.type !== REL.notesSlide) continue;
    const notes = resolvePart(part, rel.target);
    deck.remove(notes);
    deck.zip.remove(relsPathOf(notes));
  }
  await removeSlide(deck, slide);
}

// ---------- public ----------

/** Lists a template's layouts and company slides with what each can hold. */
export async function describeTemplate(bytes) {
  const deck = await Deck.load(bytes);
  const layouts = await layoutsOf(deck);
  const facts = await slideFacts(deck);
  const friendly = Object.fromEntries(
    Object.entries(TEMPLATE_LAYOUTS).map(([k, v]) => [norm(v), k]),
  );
  return {
    layouts: layouts.map((l) => ({
      layout: friendly[norm(l.name)] ?? null,
      template_layout: l.name,
      holds: slotsOf(analyseLayout(l.xml)),
    })),
    company_slides: Object.entries(COMPANY_SLIDES)
      .filter(([, c]) => facts.some(c.match))
      .map(([key, c]) => ({ include: key, about: c.label })),
    agenda: facts.some((s) => /agenda/i.test(s.layout)),
  };
}

/** Adds one slide to a deck made from the template, using its layouts; null when it has no fitting layout. */
export async function insertTemplateSlide(deck, item, index, { images, buildSlides }) {
  const layouts = await layoutsOf(deck);
  const label = item.__label ?? "Slide";
  const layout = findLayout(layouts, item);
  if (layout) return layoutSlide(deck, layout, item, index, images, label);
  if (item.layout === "agenda")
    return agendaSlide(deck, await slideFacts(deck), item, index, label);
  if (layouts.some((l) => norm(l.name) === norm(TEMPLATE_LAYOUTS.plain)) && NATIVE.has(item.layout))
    return nativeSlide(deck, layouts, item, index, buildSlides);
  return null;
}

/**
 * A new deck from the template: `items` become slides on its layouts, company slides are copied
 * by name, and the template's own sample slides are removed.
 */
export async function buildFromTemplate(
  templateBytes,
  items,
  { images, buildSlides, labelOf, meta = {} },
) {
  const deck = await Deck.load(templateBytes);
  const facts = await slideFacts(deck);
  const originals = deck.slides();
  if (items.some((item) => str(item?.notes))) await ensureNotesMaster(deck, buildSlides);
  const added = [];
  for (const [i, item] of items.entries()) {
    const label = labelOf(i);
    if (!item || typeof item !== "object") throw new Error(`${label} must be an object.`);
    const at = deck.slides().length;
    let part;
    if (item.include) {
      const company = COMPANY_SLIDES[item.include];
      const source = company ? facts.find(company.match) : null;
      if (!source)
        throw new Error(
          `${label}: include must be one of ${Object.keys(COMPANY_SLIDES)
            .filter((k) => facts.some(COMPANY_SLIDES[k].match))
            .join(", ")}.`,
        );
      part = await duplicateSlide(
        deck,
        deck.slides().findIndex((s) => s.part === source.part),
        at,
      );
    } else {
      part = await insertTemplateSlide(deck, { ...item, __label: label }, at, {
        images,
        buildSlides,
      });
      if (!part) {
        const known = [...Object.keys(TEMPLATE_LAYOUTS), "agenda", ...NATIVE].join(", ");
        throw new Error(
          `${label}: layout must be one of ${known}, or give "template_layout" with a layout name from ocsc-pptx layouts.`,
        );
      }
    }
    if (str(item.notes)) await setNotes(deck, part, str(item.notes, 20000));
    added.push(part);
  }
  for (const slide of originals) await removeSlide(deck, slide);
  const order = deck.slides();
  deck.setSlides(added.map((part) => order.find((s) => s.part === part)));
  if (meta.title) {
    const core = await deck.text("docProps/core.xml");
    if (core)
      deck.write(
        "docProps/core.xml",
        core.replace(
          /<dc:title>[\s\S]*?<\/dc:title>|<dc:title\/>/,
          `<dc:title>${esc(str(meta.title, 200))}</dc:title>`,
        ),
      );
  }
  await dropUnused(deck);
  return deck.save();
}

export function hasTemplate(path = OCSC_TEMPLATE) {
  return existsSync(path);
}
