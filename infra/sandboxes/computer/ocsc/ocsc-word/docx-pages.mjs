/**
 * The browser renderer prints a PAGE field's saved result, so every footer says "1". Each PAGE
 * field's result is swapped for PAGE_MARK, and each section's first paragraph gets a bookmark
 * named SECTION_MARK + its index, so the screen can number the printed pages as Word does,
 * including roman front matter and sections that restart at 1.
 */

/** Invisible separators around a hash: what a footer's page number reads before numbering. */
export const PAGE_MARK = "\u2063#\u2063";
export const SECTION_MARK = "_ob_section_";

const PAGE_INSTR = /^\s*PAGE\b/;
/** A section's properties, written out or self-closing. */
export const SECTION = /<w:sectPr\b(?:[^>]*\/>|[\s\S]*?<\/w:sectPr>)/g;

/** A header or footer part with each PAGE field's shown result replaced by PAGE_MARK. */
export function markPageFields(xml) {
  let out = xml.replace(
    /(<w:fldSimple\b[^>]*\bw:instr="([^"]*)"[^>]*>)([\s\S]*?)(<\/w:fldSimple>)/g,
    (whole, open, instr, inner, close) =>
      PAGE_INSTR.test(instr)
        ? open + inner.replace(/(<w:t\b[^>]*>)[^<]*(<\/w:t>)/, `$1${PAGE_MARK}$2`) + close
        : whole,
  );
  const instr = /<w:instrText\b[^>]*>([^<]*)<\/w:instrText>/g;
  let from = 0;
  for (let m = instr.exec(out); m; m = instr.exec(out)) {
    if (m.index < from || !PAGE_INSTR.test(m[1])) continue;
    const separate = out.indexOf('w:fldCharType="separate"', m.index);
    const end = out.indexOf('w:fldCharType="end"', m.index);
    if (separate < 0 || end < 0 || end < separate) continue;
    const result = out.slice(separate, end);
    const marked = result.replace(/(<w:t\b[^>]*>)[^<]*(<\/w:t>)/, `$1${PAGE_MARK}$2`);
    if (marked === result) continue;
    out = out.slice(0, separate) + marked + out.slice(end);
    from = separate + marked.length;
    instr.lastIndex = from;
  }
  return out;
}

/** Where a paragraph's content starts: after its opening tag and its properties. */
function contentStart(xml, at) {
  const open = xml.indexOf(">", at) + 1;
  const props = /^<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(xml.slice(open));
  return open + (props ? props[0].length : 0);
}

/**
 * The document with a bookmark at the start of every section, and each section's numbering:
 * start (null to continue from the previous page) and format (decimal, lowerRoman, ...).
 */
export function markSections(body) {
  const sections = [...body.matchAll(SECTION)];
  if (!sections.length) return { xml: body, numbering: [] };
  const numbering = sections.map((m) => {
    const type = /<w:pgNumType\b[^>]*>/.exec(m[0])?.[0] ?? "";
    const start = /\bw:start="(-?\d+)"/.exec(type)?.[1];
    return {
      start: start === undefined ? null : Number(start),
      format: /\bw:fmt="(\w+)"/.exec(type)?.[1] ?? "decimal",
    };
  });
  const starts = [];
  const bodyOpen = body.indexOf("<w:body");
  const first = bodyOpen < 0 ? -1 : body.slice(bodyOpen).search(/<w:p\b/);
  if (first >= 0) starts.push(contentStart(body, bodyOpen + first));
  for (const m of sections.slice(0, -1)) {
    const closes = body.indexOf("</w:p>", m.index + m[0].length);
    const next = closes < 0 ? -1 : body.slice(closes).search(/<w:p\b/);
    starts.push(next < 0 ? -1 : contentStart(body, closes + next));
  }
  let xml = body;
  for (let i = starts.length - 1; i >= 0; i -= 1) {
    if (starts[i] < 0) continue;
    const id = 2_147_000_000 + i;
    const mark = `<w:bookmarkStart w:id="${id}" w:name="${SECTION_MARK}${i}"/><w:bookmarkEnd w:id="${id}"/>`;
    xml = xml.slice(0, starts[i]) + mark + xml.slice(starts[i]);
  }
  return { xml, numbering };
}
