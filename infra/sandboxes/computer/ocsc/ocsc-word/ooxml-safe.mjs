/**
 * Shared OOXML safety, validation and smart-punctuation matching helpers used by
 * ocsc-word, ocsc-pptx (pptx-package), ocsc-xlsx and format-edits.
 */

const QUOTE_1 = /[\u2018\u2019\u201a\u201b\u2032\u0060\u00b4]/;
const QUOTE_2 = /[\u201c\u201d\u201e\u201f\u2033\u00ab\u00bb]/;
const DASH = /[\u2010-\u2015\u2212]/;
const INVISIBLE = /[\u200b-\u200d\u2060\ufeff\u00ad]/;
const BARE_AMP_RE = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;
const ILLEGAL_XML_CHAR_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;

/**
 * Normalizes smart quotes, typographic dashes, invisible characters and whitespace runs
 * to plain ASCII equivalents, returning both the plain string and a map from each plain
 * index back to its original character span `[start, end)` in `source`.
 */
export function normalizeWithMap(source) {
  const str = String(source ?? "");
  let text = "";
  const starts = [];
  const ends = [];
  let inSpace = false;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (INVISIBLE.test(ch)) continue;
    if (/\s/.test(ch)) {
      if (!inSpace && text.length > 0) {
        text += " ";
        starts.push(i);
        ends.push(i + 1);
      } else if (inSpace && ends.length > 0) {
        ends[ends.length - 1] = i + 1;
      }
      inSpace = true;
      continue;
    }
    inSpace = false;
    text += QUOTE_1.test(ch) ? "'" : QUOTE_2.test(ch) ? '"' : DASH.test(ch) ? "-" : ch;
    starts.push(i);
    ends.push(i + 1);
  }
  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    starts.pop();
    ends.pop();
  }
  return { text, starts, ends };
}

/**
 * Finds occurrences of `find` in `text`.
 * 1. Exact literal match first (100% backward-compatible).
 * 2. Fallback: smart-punctuation & whitespace-normalized match mapped back to exact
 *    `{ start, end }` offsets in `text`.
 */
export function findSmartMatches(text, find, { all = true, caseInsensitive = false } = {}) {
  const hay = String(text ?? "");
  const needle = String(find ?? "");
  if (!needle) return [];

  // 1. Exact match (or case-insensitive exact match when requested)
  const exactHits = [];
  const hCmp = caseInsensitive ? hay.toLowerCase() : hay;
  const nCmp = caseInsensitive ? needle.toLowerCase() : needle;
  let from = 0;
  while (from <= hCmp.length) {
    const at = hCmp.indexOf(nCmp, from);
    if (at < 0) break;
    exactHits.push({ start: at, end: at + needle.length });
    if (!all) return exactHits;
    from = at + Math.max(needle.length, 1);
  }
  if (exactHits.length) return exactHits;

  // 2. Smart-punctuation & whitespace-tolerant fallback
  const normNeedle = normalizeWithMap(needle).text;
  if (!normNeedle) return [];
  const normHay = normalizeWithMap(hay);
  const nhCmp = caseInsensitive ? normHay.text.toLowerCase() : normHay.text;
  const nnCmp = caseInsensitive ? normNeedle.toLowerCase() : normNeedle;

  const hits = [];
  let pos = 0;
  while (pos <= nhCmp.length) {
    const at = nhCmp.indexOf(nnCmp, pos);
    if (at < 0) break;
    const start = normHay.starts[at];
    const end = normHay.ends[at + normNeedle.length - 1];
    if (start !== undefined && end !== undefined && end > start) {
      hits.push({ start, end });
      if (!all) return hits;
    }
    pos = at + Math.max(normNeedle.length, 1);
  }
  return hits;
}

/**
 * Checks that every XML tag opens and closes in proper nested order.
 * Skips XML comments, CDATA, processing instructions and declarations,
 * and allows `>` inside quoted attributes.
 */
export function xmlWellFormed(xml) {
  if (typeof xml !== "string" || !xml.trim()) {
    return { ok: false, reason: "empty XML" };
  }
  if (ILLEGAL_XML_CHAR_RE.test(xml)) {
    return { ok: false, reason: "contains illegal XML control character" };
  }
  const open = [];
  let elements = 0;
  let at = xml.indexOf("<");
  const skipTo = (marker, from) => {
    const end = xml.indexOf(marker, from);
    return end < 0 ? -1 : end + marker.length;
  };
  let textFrom = 0;
  while (at !== -1) {
    // Check text node between previous tag and this `<` for bare `&`
    if (at > textFrom) {
      const textChunk = xml.slice(textFrom, at);
      if (BARE_AMP_RE.test(textChunk)) {
        return { ok: false, reason: "contains unescaped '&' in text content" };
      }
    }
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
      if (end >= xml.length) return { ok: false, reason: "unterminated XML tag" };
      const closing = xml[at + 1] === "/";
      const tagInner = xml.slice(closing ? at + 2 : at + 1, end);
      const name = /^[^\s/>]+/.exec(tagInner)?.[0];
      if (!name) return { ok: false, reason: "malformed tag name" };
      if (!closing) {
        // Check attribute values for bare `&`
        for (const m of tagInner.matchAll(/="([^"]*)"|='([^']*)'/g)) {
          const val = m[1] ?? m[2] ?? "";
          if (BARE_AMP_RE.test(val)) {
            return { ok: false, reason: `unescaped '&' in attribute of <${name}>` };
          }
        }
      }
      if (closing) {
        const expected = open.pop();
        if (expected !== name) {
          return {
            ok: false,
            reason: `mismatched closing tag </${name}> (expected </${expected ?? "none"}>)`,
          };
        }
      } else {
        if (xml[end - 1] !== "/") open.push(name);
        elements += 1;
      }
      next = end + 1;
    }
    if (next < 0) return { ok: false, reason: "unclosed comment/CDATA/PI" };
    textFrom = next;
    at = xml.indexOf("<", next);
  }
  if (open.length !== 0) {
    return { ok: false, reason: `unclosed tag <${open[open.length - 1]}>` };
  }
  if (elements === 0) return { ok: false, reason: "no XML elements found" };
  return { ok: true };
}

/**
 * Throws a clear error if `xml` is not well-formed XML.
 */
export function assertXmlValid(xml, partName = "document") {
  const check = xmlWellFormed(xml);
  if (!check.ok) {
    throw new Error(`XML validation failed for ${partName}: ${check.reason}`);
  }
}

/**
 * Nested-tag-aware helper: returns `{ from, to, xml }` for every direct matching `<tag>`
 * element inside `xml` (properly handling nested elements of the same tag name).
 */
export function topLevelElements(xml, tagName) {
  const out = [];
  const openRe = new RegExp(`<${tagName}(?=[\\s>/])`, "g");
  const closeStr = `</${tagName}>`;
  let i = 0;
  while (i < xml.length) {
    openRe.lastIndex = i;
    const m = openRe.exec(xml);
    if (!m) break;
    const start = m.index;
    const gt = xml.indexOf(">", start);
    if (gt < 0) break;
    if (xml[gt - 1] === "/") {
      out.push({ from: start, to: gt + 1, xml: xml.slice(start, gt + 1) });
      i = gt + 1;
      continue;
    }
    let depth = 1;
    let cur = gt + 1;
    while (cur < xml.length && depth > 0) {
      openRe.lastIndex = cur;
      const nextOpen = openRe.exec(xml);
      const nextClose = xml.indexOf(closeStr, cur);
      if (nextClose < 0) {
        cur = xml.length;
        break;
      }
      if (nextOpen && nextOpen.index < nextClose) {
        const og = xml.indexOf(">", nextOpen.index);
        if (og < 0) {
          cur = xml.length;
          break;
        }
        if (xml[og - 1] !== "/") depth += 1;
        cur = og + 1;
      } else {
        depth -= 1;
        cur = nextClose + closeStr.length;
      }
    }
    out.push({ from: start, to: cur, xml: xml.slice(start, cur) });
    i = cur;
  }
  return out;
}
