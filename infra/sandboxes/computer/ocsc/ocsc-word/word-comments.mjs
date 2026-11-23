/**
 * Native OOXML Word margin comments (`word/comments.xml`) for ocsc-word.
 *
 * Used alongside tracked changes (`<w:ins>` / `<w:del>`) so legal red-pen reviews
 * produce both redline edits and margin comments explaining the rationale / Clause
 * Library position, readable in Microsoft Word and Rakazo's Word Studio.
 */

const COMMENTS_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const COMMENTS_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";
const COMMENTS_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";

function escXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unescXml(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function authorInitials(author) {
  const parts = String(author || "OCSC")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "OC";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return parts
    .slice(0, 3)
    .map((p) => p[0].toUpperCase())
    .join("");
}

export function extractComments(commentsXml) {
  if (!commentsXml || typeof commentsXml !== "string") return [];
  const out = [];
  const re = /<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g;
  for (const m of commentsXml.matchAll(re)) {
    const attrs = m[1] || "";
    const inner = m[2] || "";
    const id = /\bw:id="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const author = unescXml(/\bw:author="([^"]*)"/.exec(attrs)?.[1] ?? "");
    const initials = unescXml(/\bw:initials="([^"]*)"/.exec(attrs)?.[1] ?? "");
    const date = /\bw:date="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const paras = [...inner.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
      .map((p) =>
        [...p[1].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
          .map((t) => unescXml(t[1]))
          .join(""),
      )
      .filter((line) => line.length > 0);
    const text = paras.join("\n").trim();
    out.push({ id, author, initials, date, text });
  }
  return out;
}

export class WordCommentStore {
  constructor(existingCommentsXml = null, { author = "OCSC Bot", date = null } = {}) {
    this.author = String(author || "OCSC Bot").trim() || "OCSC Bot";
    this.initials = authorInitials(this.author);
    this.date = date || new Date().toISOString().replace(/\.\d+Z$/, "Z");
    this.xml =
      existingCommentsXml && existingCommentsXml.includes("</w:comments>")
        ? existingCommentsXml
        : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments ${COMMENTS_NS}></w:comments>`;
    const existingIds = [...this.xml.matchAll(/<w:comment\b[^>]*\bw:id="(\d+)"/g)].map(
      (m) => Number(m[1]),
    );
    this.nextId = existingIds.length ? Math.max(...existingIds) + 1 : 0;
    this.addedCount = 0;
  }

  add(text) {
    const clean = String(text ?? "").trim();
    if (!clean) return null;
    const id = this.nextId++;
    const paragraphs = clean
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line, idx, all) => line.length > 0 || all.length === 1)
      .map(
        (line) =>
          `<w:p><w:r><w:t xml:space="preserve">${escXml(line)}</w:t></w:r></w:p>`,
      )
      .join("");
    const entry =
      `<w:comment w:id="${id}" w:author="${escXml(this.author)}" w:date="${escXml(this.date)}" w:initials="${escXml(this.initials)}">` +
      paragraphs +
      `</w:comment>`;
    this.xml = this.xml.replace("</w:comments>", `${entry}</w:comments>`);
    this.addedCount += 1;
    return id;
  }
}

function commentRefRun(id) {
  return `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r>`;
}

/**
 * Anchors a Word margin comment across a single `<w:p>...</w:p>` element,
 * placing `<w:commentRangeStart>` right after `<w:pPr>` and `<w:commentRangeEnd>` +
 * `<w:commentReference>` immediately before `</w:p>`.
 */
export function anchorCommentOnParagraph(paragraphXml, id) {
  if (id === null || id === undefined) return paragraphXml;
  if (/^<w:p(?=[\s/])[^>]*\/>$/.test(paragraphXml)) return paragraphXml;
  const openEnd = paragraphXml.indexOf(">") + 1;
  const closeAt = paragraphXml.lastIndexOf("</w:p>");
  if (openEnd <= 0 || closeAt < openEnd) return paragraphXml;

  let insertStartAt = openEnd;
  const afterOpen = paragraphXml.slice(openEnd);
  const selfPpr = /^<w:pPr\s*\/>/.exec(afterOpen);
  if (selfPpr) {
    insertStartAt = openEnd + selfPpr[0].length;
  } else if (afterOpen.startsWith("<w:pPr")) {
    const pprClose = afterOpen.indexOf("</w:pPr>");
    if (pprClose >= 0) insertStartAt = openEnd + pprClose + "</w:pPr>".length;
  }

  return (
    paragraphXml.slice(0, insertStartAt) +
    `<w:commentRangeStart w:id="${id}"/>` +
    paragraphXml.slice(insertStartAt, closeAt) +
    `<w:commentRangeEnd w:id="${id}"/>` +
    commentRefRun(id) +
    paragraphXml.slice(closeAt)
  );
}

/**
 * Anchors a Word margin comment across a chunk of one or more body elements
 * (paragraphs, tables, tracked changes). Places start in the first non-empty
 * `<w:p>` and end + reference in the last non-empty `<w:p>`.
 */
export function anchorCommentOnBlocks(blocksXml, id) {
  if (id === null || id === undefined) return blocksXml;
  const paras = [...blocksXml.matchAll(/<w:p(?=[\s>])[^>]*(?<!\/)>[\s\S]*?<\/w:p>/g)];
  if (!paras.length) return blocksXml;
  if (paras.length === 1) {
    const m = paras[0];
    return (
      blocksXml.slice(0, m.index) +
      anchorCommentOnParagraph(m[0], id) +
      blocksXml.slice(m.index + m[0].length)
    );
  }
  const first = paras[0];
  const last = paras[paras.length - 1];
  const firstOpenEnd = first[0].indexOf(">") + 1;
  const afterOpen = first[0].slice(firstOpenEnd);
  let startOffset = firstOpenEnd;
  const selfPpr = /^<w:pPr\s*\/>/.exec(afterOpen);
  if (selfPpr) startOffset = firstOpenEnd + selfPpr[0].length;
  else if (afterOpen.startsWith("<w:pPr")) {
    const pprClose = afterOpen.indexOf("</w:pPr>");
    if (pprClose >= 0) startOffset = firstOpenEnd + pprClose + "</w:pPr>".length;
  }
  const lastCloseAt = last[0].lastIndexOf("</w:p>");
  const startAbs = first.index + startOffset;
  const endAbs = last.index + lastCloseAt;
  return (
    blocksXml.slice(0, startAbs) +
    `<w:commentRangeStart w:id="${id}"/>` +
    blocksXml.slice(startAbs, endAbs) +
    `<w:commentRangeEnd w:id="${id}"/>` +
    commentRefRun(id) +
    blocksXml.slice(endAbs)
  );
}

/** Ensures `[Content_Types].xml` and `word/_rels/document.xml.rels` register `word/comments.xml`. */
export function ensureCommentsPartsRegistered({ types, rels, nextRelId }) {
  let nextTypes = types;
  let nextRels = rels;
  if (!/PartName="\/word\/comments\.xml"/i.test(nextTypes)) {
    const override = `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CONTENT_TYPE}"/>`;
    if (nextTypes.includes("</Types>")) {
      nextTypes = nextTypes.replace("</Types>", `${override}</Types>`);
    } else {
      nextTypes = nextTypes.replace(/<Types\b([^>]*?)\s*\/>/, `<Types$1>${override}</Types>`);
    }
  }
  if (!/relationships\/comments"/i.test(nextRels)) {
    const rid = nextRelId();
    const rel = `<Relationship Id="${rid}" Type="${COMMENTS_REL_TYPE}" Target="comments.xml"/>`;
    if (nextRels.includes("</Relationships>")) {
      nextRels = nextRels.replace("</Relationships>", `${rel}</Relationships>`);
    } else {
      nextRels = nextRels.replace(
        /<Relationships\b([^>]*?)\s*\/>/,
        `<Relationships$1>${rel}</Relationships>`,
      );
    }
  }
  return { types: nextTypes, rels: nextRels };
}
