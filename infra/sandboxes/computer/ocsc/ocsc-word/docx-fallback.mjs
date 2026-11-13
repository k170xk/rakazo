/**
 * Word keeps two copies of a floating text box: the DrawingML shape it shows (mc:Choice) and an
 * older VML copy for other programs (mc:Fallback). The browser renderer draws only the VML copy,
 * whose horizontal position is often stale (an offset from the text column where Word measures
 * from the page) or uses centring the renderer ignores, so banner titles and the back cover's
 * office address print shifted left. This rewrites each VML copy's horizontal position from the
 * DrawingML copy, as a distance from the page edge, before the file is drawn. prepareDocx also
 * marks page numbers (docx-pages.mjs) in the same pass.
 */
import JSZip from "jszip";
import { markPageFields, markSections, SECTION } from "./docx-pages.mjs";

const EMU_PER_PT = 12700;
const TWIPS_PER_PT = 20;
const PART = /^word\/(document|header\d*|footer\d*)\.xml$/;

/** Each mc:AlternateContent block, outermost only, as [start, end] offsets. */
function alternateBlocks(xml) {
  const tag = /<(\/?)mc:AlternateContent\b[^>]*>/g;
  const blocks = [];
  let depth = 0;
  let start = -1;
  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    if (m[1]) {
      depth -= 1;
      if (depth === 0 && start >= 0) blocks.push([start, m.index + m[0].length]);
    } else {
      if (depth === 0) start = m.index;
      depth += 1;
    }
  }
  return blocks;
}

function attr(tag, name) {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
}

/** Page width and left/right margins, in points, from a w:sectPr. */
function pageOf(sectPr) {
  const size = /<w:pgSz\b[^>]*>/.exec(sectPr)?.[0] ?? "";
  const margins = /<w:pgMar\b[^>]*>/.exec(sectPr)?.[0] ?? "";
  const width = Number(attr(size, "w:w"));
  const left = Number(attr(margins, "w:left"));
  const right = Number(attr(margins, "w:right"));
  if (!(width > 0) || !(left >= 0) || !(right >= 0)) return null;
  return { width: width / TWIPS_PER_PT, left: left / TWIPS_PER_PT, right: right / TWIPS_PER_PT };
}

/** Where Word puts the box's left edge, in points from the page edge, or null when unsure. */
export function anchorLeft(choice, page) {
  const horizontal = /<wp:positionH\b[^>]*>[\s\S]*?<\/wp:positionH>/.exec(choice)?.[0];
  const extent = /<wp:extent\b[^>]*>/.exec(choice)?.[0];
  if (!horizontal || !extent) return null;
  const width = Number(attr(extent, "cx")) / EMU_PER_PT;
  const from = attr(horizontal, "relativeFrom");
  const box =
    from === "page"
      ? { start: 0, size: page.width }
      : from === "margin" || from === "column"
        ? { start: page.left, size: page.width - page.left - page.right }
        : null;
  if (!box || !(width >= 0)) return null;
  const offset = /<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(horizontal)?.[1];
  if (offset !== undefined) return box.start + Number(offset) / EMU_PER_PT;
  const align = /<wp:align>(\w+)<\/wp:align>/.exec(horizontal)?.[1];
  if (align === "left") return box.start;
  if (align === "center") return box.start + (box.size - width) / 2;
  if (align === "right") return box.start + box.size - width;
  return null;
}

const pt = (value) => `${Math.round(value * 100) / 100}pt`;

/** The text box's left and right padding in points, from Word's insets or its defaults. */
export function insetOf(choice) {
  const body = /<wps:bodyPr\b[^>]*>/.exec(choice)?.[0];
  if (!body) return null;
  const side = (name) => Number(attr(body, name) ?? 91440) / EMU_PER_PT;
  return { left: side("lIns"), right: side("rIns") };
}

const HORIZONTAL =
  /^(left|margin-left|mso-position-horizontal|mso-position-horizontal-relative|--ob-inset-[lr])$/i;

/**
 * A VML style with its horizontal position replaced by `left` points from the page edge, and the
 * box's side padding, which the renderer would otherwise drop, in --ob-inset-l and --ob-inset-r.
 */
export function placedStyle(style, left, inset = null) {
  const kept = style
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !HORIZONTAL.test(part.split(":")[0].trim()));
  const padding = inset
    ? [`--ob-inset-l:${pt(inset.left)}`, `--ob-inset-r:${pt(inset.right)}`]
    : [];
  return [...kept, `left:${pt(left)}`, "margin-left:0", ...padding].join(";");
}

/** One part's XML with every positioned VML fallback moved to where Word shows its box. */
export function alignFallbacks(xml, pageAt) {
  let out = "";
  let last = 0;
  for (const [start, end] of alternateBlocks(xml)) {
    const block = xml.slice(start, end);
    const split = block.indexOf("<mc:Fallback");
    const page = pageAt(start);
    const choice = split > 0 ? block.slice(0, split) : "";
    const left = page && choice ? anchorLeft(choice, page) : null;
    if (left === null) continue;
    const inset = insetOf(choice);
    const fallback = block
      .slice(split)
      .replace(
        /(<v:(?:shape|rect|roundrect|oval|group)\b[^>]*?\sstyle=")([^"]*)(")/,
        (whole, open, style, close) =>
          /position:\s*absolute/i.test(style)
            ? open + placedStyle(style, left, inset) + close
            : whole,
      );
    out += xml.slice(last, start) + block.slice(0, split) + fallback;
    last = end;
  }
  return last ? out + xml.slice(last) : xml;
}

/**
 * The .docx prepared for the browser renderer: floating text boxes placed as Word places them,
 * and page numbers marked for the screen to fill in. numbering lists each section's page
 * numbering, in order; the input bytes come back when nothing needed changing.
 */
export async function prepareDocx(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const body = await zip.file("word/document.xml")?.async("string");
  if (!body) return { bytes, numbering: [] };
  const sections = [...body.matchAll(SECTION)].map((m) => ({
    end: m.index + m[0].length,
    xml: m[0],
    page: pageOf(m[0]),
  }));
  const rels = (await zip.file("word/_rels/document.xml.rels")?.async("string")) ?? "";
  const targets = new Map(
    [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      attr(m[0], "Id"),
      attr(m[0], "Target"),
    ]),
  );
  /** A header or footer takes the page of the first section that uses it. */
  const pageOfPart = (name) =>
    sections.find((section) =>
      [...section.xml.matchAll(/<w:(?:header|footer)Reference\b[^>]*>/g)].some(
        (ref) => `word/${targets.get(attr(ref[0], "r:id"))}` === name,
      ),
    )?.page ?? sections[0]?.page;
  let changed = false;
  let numbering = [];
  for (const name of Object.keys(zip.files)) {
    if (!PART.test(name)) continue;
    const isBody = name === "word/document.xml";
    const xml = isBody ? body : await zip.file(name).async("string");
    let next = xml;
    if (sections.length && next.includes("mc:Fallback")) {
      // Body positions use the body as it was, before any bookmark shifts the offsets.
      const fixedPage = isBody ? null : pageOfPart(name);
      next = alignFallbacks(
        next,
        (at) => fixedPage ?? (sections.find((section) => section.end > at) ?? sections.at(-1)).page,
      );
    }
    if (isBody) {
      const marked = markSections(next);
      next = marked.xml;
      numbering = marked.numbering;
    } else if (next.includes("PAGE")) {
      next = markPageFields(next);
    }
    if (next !== xml) {
      zip.file(name, next);
      changed = true;
    }
  }
  return {
    bytes: changed
      ? await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
      : bytes,
    numbering,
  };
}
