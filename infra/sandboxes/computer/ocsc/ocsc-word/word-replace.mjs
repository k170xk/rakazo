/**
 * Span-accurate, cross-run, smart-punctuation-tolerant text replacement for Word paragraphs.
 *
 * Unlike whole-paragraph rewrites (which strip inline bold/italic/hyperlinks and drop anchored
 * text boxes/drawings), this splices only the exact character spans across `<w:r>` runs, leaving
 * all untouched runs, `<w:drawing>`, `<w:pict>`, `<ocscbox>`, `<w:del>`, and formatting intact.
 * When `rev` is provided, only the replaced span is wrapped in `<w:del>` / `<w:ins>`.
 */
import { findSmartMatches } from "./ooxml-safe.mjs";
import { firstElement } from "./word-paragraphs.mjs";

function esc(text) {
  return String(text ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unesc(text) {
  return String(text ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");
}

function closeOf(xml, from, tag) {
  const open = new RegExp(`<w:${tag}(?=[\\s>/])`, "g");
  const close = `</w:${tag}>`;
  const gt0 = xml.indexOf(">", from);
  if (gt0 < 0) return xml.length;
  if (xml[gt0 - 1] === "/") return gt0 + 1;
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

/**
 * Extracts all active (non-deleted) text runs inside a Word paragraph in document order,
 * skipping `<w:del>`, `<w:moveFrom>`, `<w:pPr>`, `<w:rPr>` etc.
 * Runs containing `<w:drawing>`, `<w:pict>`, `<w:object>`, or `<ocscbox>` are marked non-plain
 * so their non-text content is never lost.
 */
function extractRuns(paragraph) {
  const runs = [];
  const re = /<w:(r|del|moveFrom|pPr)(?=[\s>/])/g;
  let i = paragraph.indexOf(">") + 1;
  while (i < paragraph.length) {
    re.lastIndex = i;
    const m = re.exec(paragraph);
    if (!m) break;
    const end = closeOf(paragraph, m.index, m[1]);
    if (m[1] !== "r") {
      i = end;
      continue;
    }
    const whole = paragraph.slice(m.index, end);
    const hasSpecial = /<w:(?:drawing|pict|object|fldChar|instrText|footnoteReference|endnoteReference|commentReference|sym)\b|<ocscbox\b/.test(
      whole,
    );
    // Extract each <w:t> / <w:tab/> / <w:br/> piece inside this run
    const pieces = [
      ...whole.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:t(?:\s[^>]*)?\/>|<w:tab\/>|<w:br(?:\s[^>]*)?\/>/g),
    ];
    if (!pieces.length) {
      i = end;
      continue;
    }
    const text = pieces
      .map((p) => {
        if (p[1] !== undefined) return unesc(p[1]);
        if (p[0].startsWith("<w:tab")) return "\t";
        if (p[0].startsWith("<w:br")) return "\n";
        return "";
      })
      .join("");
    const plainSingleText =
      !hasSpecial &&
      pieces.length === 1 &&
      pieces[0][0].startsWith("<w:t") &&
      !/<w:(?:tab|br)\b/.test(whole);
    runs.push({
      from: m.index,
      to: end,
      whole,
      text,
      rPr: firstElement(whole, "rPr"),
      plain: plainSingleText,
      hasSpecial,
    });
    i = end;
  }
  return runs;
}

/**
 * Replaces `find` with `replacement` inside one Word paragraph `p` across runs.
 * - Uses exact match first, falling back to smart-punctuation/whitespace match (`findSmartMatches`).
 * - Preserves untouched runs, inline formatting, hyperlinks, drawings and `<ocscbox>` markers.
 * - If `rev` is provided (`Revisions` instance), records `<w:del>` + `<w:ins>` inline only on the
 *   matched span rather than striking the entire paragraph.
 */
export function replaceWordParagraph(p, find, replacement, { all = true, rev = null } = {}) {
  const runs = extractRuns(p);
  if (!runs.length) return { paragraph: p, count: 0 };
  const full = runs.map((r) => r.text).join("");
  const hits = findSmartMatches(full, find, { all });
  if (!hits.length) return { paragraph: p, count: 0 };

  // Compute each run's character interval in `full`
  const ranges = [];
  let cursor = 0;
  for (const run of runs) {
    ranges.push({ start: cursor, end: cursor + run.text.length });
    cursor += run.text.length;
  }

  // If any hit touches a non-plain run (e.g. a run containing a tab/br/drawing mixed with text),
  // handle carefully: skip hits inside `hasSpecial` runs (never drop drawings/textboxes!).
  const safeHits = hits.filter((hit) => {
    for (let i = 0; i < runs.length; i += 1) {
      if (ranges[i].end <= hit.start || ranges[i].start >= hit.end) continue;
      if (runs[i].hasSpecial) return false;
    }
    return true;
  });
  if (!safeHits.length) return { paragraph: p, count: 0 };

  const textPiecesXml = (str, tag) => {
    let xml = "";
    let buf = "";
    const flush = () => {
      if (!buf) return;
      xml += `<w:${tag} xml:space="preserve">${esc(buf)}</w:${tag}>`;
      buf = "";
    };
    for (const ch of str) {
      if (ch === "\t") {
        flush();
        xml += "<w:tab/>";
      } else if (ch === "\n") {
        flush();
        xml += "<w:br/>";
      } else {
        buf += ch;
      }
    }
    flush();
    return xml;
  };

  const makeTextRun = (rPr, str) =>
    str ? `<w:r>${rPr}${textPiecesXml(str, "t")}</w:r>` : "";

  const makeTrackedDelta = (rPr, deletedStr, insertedStr) => {
    let xml = "";
    if (deletedStr) {
      xml += `<w:del ${rev.attrs()}><w:r>${rPr}${textPiecesXml(deletedStr, "delText")}</w:r></w:del>`;
    }
    if (insertedStr) {
      xml += `<w:ins ${rev.attrs()}><w:r>${rPr}${textPiecesXml(insertedStr, "t")}</w:r></w:ins>`;
    }
    return xml;
  };

  // For each run, split its text by the hit boundaries that intersect it.
  // Each run produces a list of XML segments: untouched text, or deleted+inserted span.
  const runOutputs = runs.map((run) => ({ run, xml: run.whole, modified: false }));

  // Build per-run event lists (cut points from safeHits, in left-to-right order).
  // When a hit spans multiple runs, the replacement is inserted once at the first run of the hit.
  const perRunOps = runs.map(() => []);
  for (let hIdx = 0; hIdx < safeHits.length; hIdx += 1) {
    const hit = safeHits[hIdx];
    let firstRun = true;
    for (let i = 0; i < runs.length; i += 1) {
      const rStart = ranges[i].start;
      const rEnd = ranges[i].end;
      if (rEnd <= hit.start || rStart >= hit.end) continue;
      const localStart = Math.max(0, hit.start - rStart);
      const localEnd = Math.min(runs[i].text.length, hit.end - rStart);
      perRunOps[i].push({
        start: localStart,
        end: localEnd,
        replacement: firstRun ? String(replacement ?? "") : "",
      });
      firstRun = false;
    }
  }

  for (let i = 0; i < runs.length; i += 1) {
    const ops = perRunOps[i];
    if (!ops.length) continue;
    const run = runs[i];
    const rPr = run.rPr;
    ops.sort((a, b) => a.start - b.start);
    let built = "";
    if (!rev) {
      let merged = "";
      let pos = 0;
      for (const op of ops) {
        merged += run.text.slice(pos, op.start) + op.replacement;
        pos = op.end;
      }
      merged += run.text.slice(pos);
      built = makeTextRun(rPr, merged);
    } else {
      let pos = 0;
      for (const op of ops) {
        const before = run.text.slice(pos, op.start);
        const removed = run.text.slice(op.start, op.end);
        built += makeTextRun(rPr, before);
        built += makeTrackedDelta(rPr, removed, op.replacement);
        pos = op.end;
      }
      built += makeTextRun(rPr, run.text.slice(pos));
    }
    runOutputs[i] = { run, xml: built, modified: true };
  }

  // Reassemble paragraph XML
  let out = "";
  let last = 0;
  for (const item of runOutputs) {
    out += p.slice(last, item.run.from);
    out += item.xml;
    last = item.run.to;
  }
  out += p.slice(last);
  return { paragraph: out, count: safeHits.length };
}
