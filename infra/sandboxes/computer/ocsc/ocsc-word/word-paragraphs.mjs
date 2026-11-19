/** A paragraph that is not self-closing, through its first close. */
const PARA_RE = /<w:p(?=[\s>])[^>]*(?<!\/)>[\s\S]*?<\/w:p>/g;
const BOX_OPEN = /<w:txbxContent(?=[\s>])[^>]*>/g;
const BOX_CLOSE = "</w:txbxContent>";
const BOX_MARK = /<ocscbox n="(\d+)"\/>/g;

/** Where the text box opened at `from` closes, counting boxes inside it; -1 when it never does. */
function boxEnd(xml, from) {
  let depth = 0;
  let i = from;
  for (;;) {
    BOX_OPEN.lastIndex = i;
    const open = BOX_OPEN.exec(xml);
    const close = xml.indexOf(BOX_CLOSE, i);
    if (close < 0) return -1;
    if (open && open.index < close) {
      depth += 1;
      i = open.index + open[0].length;
    } else {
      depth -= 1;
      i = close + BOX_CLOSE.length;
      if (depth === 0) return i;
    }
  }
}

const marks = (xml) => xml.match(BOX_MARK)?.join("") ?? "";

/**
 * The first `<w:tag>…</w:tag>` in `xml`, through its own close: tracked changes nest the same
 * element inside it (`<w:rPr>…<w:rPrChange><w:rPr>…</w:rPr></w:rPrChange></w:rPr>`), and stopping
 * at the first close would cut it short. Like `/<w:tag>[\s\S]*?<\/w:tag>/`, only an opening
 * without attributes counts, so XML without nesting gives the same match. "" when there is none.
 */
export function firstElement(xml, tag) {
  const start = xml.indexOf(`<w:${tag}>`);
  if (start < 0) return "";
  const open = new RegExp(`<w:${tag}(?=[\\s>])[^>]*>`, "g");
  const close = `</w:${tag}>`;
  let depth = 0;
  let i = start;
  for (;;) {
    open.lastIndex = i;
    const o = open.exec(xml);
    const c = xml.indexOf(close, i);
    if (c < 0) return "";
    if (o && o.index < c) {
      if (!o[0].endsWith("/>")) depth += 1;
      i = o.index + o[0].length;
    } else {
      depth -= 1;
      i = c + close.length;
      if (depth === 0) return xml.slice(start, i);
    }
  }
}

/** The properties of the first run in `xml` that opens with them, as `firstElement` reads them. */
export function firstRunProps(xml) {
  const run = /<w:r(?:\s[^>]*)?>\s*(?=<w:rPr>)/.exec(xml);
  return run ? firstElement(xml.slice(run.index + run[0].length), "rPr") : "";
}

/**
 * Whether every element in `xml` closes in the order it opened. Comments, processing
 * instructions, CDATA and declarations are skipped; `>` inside quoted attribute values is allowed.
 */
export function xmlTagsBalanced(xml) {
  const open = [];
  let elements = 0;
  let at = xml.indexOf("<");
  const skipTo = (marker, from) => {
    const end = xml.indexOf(marker, from);
    return end < 0 ? -1 : end + marker.length;
  };
  while (at !== -1) {
    let next;
    if (xml.startsWith("<!--", at)) next = skipTo("-->", at + 4);
    else if (xml.startsWith("<![CDATA[", at)) next = skipTo("]]>", at + 9);
    else if (xml.startsWith("<?", at)) next = skipTo("?>", at + 2);
    else if (xml.startsWith("<!", at)) next = skipTo(">", at + 2);
    else {
      let end = at + 1;
      let quote = "";
      for (; end < xml.length; end += 1) {
        const ch = xml[end];
        if (quote) {
          if (ch === quote) quote = "";
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === ">") break;
      }
      if (end >= xml.length) return false;
      const closing = xml[at + 1] === "/";
      const name = /^[^\s/>]+/.exec(xml.slice(closing ? at + 2 : at + 1, end))?.[0];
      if (!name) return false;
      if (closing) {
        if (open.pop() !== name) return false;
      } else {
        if (xml[end - 1] !== "/") open.push(name);
        elements += 1;
      }
      next = end + 1;
    }
    if (next < 0) return false;
    at = xml.indexOf("<", next);
  }
  return open.length === 0 && elements > 0;
}

/**
 * `xml.replace(PARA_RE, edit)` that sees each paragraph whole. A paragraph holding a text box
 * would otherwise end at the box's first inner paragraph, and an edit of that slice drops the
 * box's opening tags while its closing tags stay, which Word reports as unreadable content.
 * Each box's contents are set aside while the paragraph around it is edited, and the box's own
 * paragraphs are edited separately; an edit that drops a box keeps its paragraph as it was.
 * XML without text boxes is edited exactly as `replace` would.
 */
export function mapParagraphs(xml, edit) {
  if (!xml.includes("<w:txbxContent")) return xml.replace(PARA_RE, edit);
  const boxes = [];
  let masked = "";
  let at = 0;
  for (;;) {
    BOX_OPEN.lastIndex = at;
    const open = BOX_OPEN.exec(xml);
    if (!open) break;
    const end = boxEnd(xml, open.index);
    if (end < 0) break;
    const inner = xml.slice(open.index + open[0].length, end - BOX_CLOSE.length);
    masked += `${xml.slice(at, open.index)}<ocscbox n="${boxes.length}"/>`;
    boxes.push(`${open[0]}${mapParagraphs(inner, edit)}${BOX_CLOSE}`);
    at = end;
  }
  masked += xml.slice(at);
  const edited = masked.replace(PARA_RE, (paragraph, ...rest) => {
    const next = edit(paragraph, ...rest);
    return marks(next) === marks(paragraph) ? next : paragraph;
  });
  return edited.replace(BOX_MARK, (_, n) => boxes[Number(n)]);
}
