import sanitizeHtml from "sanitize-html";

const LINK_SCHEMES = ["https", "http", "mailto", "tel"];
const BODY_TAGS = [
  "p",
  "br",
  "div",
  "span",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "a",
  "blockquote",
  "h2",
  "h3",
];

/** What an edited email body may contain: text formatting and links, no styles or media. */
export function sanitizeEmailBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: BODY_TAGS,
    allowedAttributes: { a: ["href", "rel"] },
    allowedSchemes: LINK_SCHEMES,
    transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }) },
  }).trim();
}

const SIGNATURE_STYLES = Object.fromEntries(
  [
    "color",
    "background-color",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "text-decoration",
    "text-align",
    "line-height",
    "vertical-align",
    "width",
    "height",
    "max-width",
    "margin",
    "margin-top",
    "margin-bottom",
    "margin-left",
    "margin-right",
    "padding",
    "padding-top",
    "padding-bottom",
    "padding-left",
    "padding-right",
    "border",
    "border-top",
    "border-bottom",
    "border-left",
    "border-right",
    "border-collapse",
  ].map((property) => [property, [/^[^;:<>()\\]*$|^(rgb|rgba)\([\d\s,.%]+\)$/i]]),
);
const IMAGE_DATA = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

/**
 * A pasted Outlook signature: its tables, inline styles and images survive; scripts, forms,
 * event handlers and images that only load on the sender's computer (file:, cid:) do not.
 */
export function sanitizeEmailSignature(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [...BODY_TAGS, "table", "thead", "tbody", "tr", "td", "th", "img", "font", "hr"],
    allowedAttributes: {
      "*": ["style", "align", "valign", "width", "height"],
      a: ["href", "rel", "style"],
      img: ["src", "alt", "width", "height", "style", "border"],
      table: ["cellpadding", "cellspacing", "border", "width", "style", "align"],
      td: ["colspan", "rowspan", "width", "height", "style", "align", "valign", "bgcolor"],
      font: ["color", "face", "size"],
    },
    allowedStyles: { "*": SIGNATURE_STYLES },
    allowedSchemes: LINK_SCHEMES,
    allowedSchemesByTag: { img: ["https", "data"] },
    exclusiveFilter: (frame) =>
      frame.tag === "img" &&
      !(/^https:\/\//i.test(frame.attribs.src ?? "") || IMAGE_DATA.test(frame.attribs.src ?? "")),
  }).trim();
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
}

/**
 * The assistant writes plain text with light markdown (paragraphs, - and 1. lists, **bold**,
 * *italic*, [links](https://…)); everything else is escaped, so nothing it writes runs as HTML.
 */
export function emailTextToHtml(text: string): string {
  const blocks = text
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n\s*\n/);
  return blocks
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((line) => /^\s*[-*•]\s+/.test(line))) {
        return `<ul>${lines.map((line) => `<li>${inline(line.replace(/^\s*[-*•]\s+/, ""))}</li>`).join("")}</ul>`;
      }
      if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
        return `<ol>${lines.map((line) => `<li>${inline(line.replace(/^\s*\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`;
      }
      return `<p>${lines.map(inline).join("<br>")}</p>`;
    })
    .join("");
}

/**
 * The HTML Outlook sends: the body, then the signature, then (for a reply) the quoted earlier
 * messages Outlook put in the reply draft.
 */
export function composeEmailHtml(input: {
  bodyHtml: string;
  signatureHtml: string | null;
  quotedHtml?: string;
}): string {
  const ours = `<div style="font-family: Aptos, Calibri, Arial, sans-serif; font-size: 11pt;">${sanitizeEmailBody(
    input.bodyHtml,
  )}${input.signatureHtml ? `<br>${sanitizeEmailSignature(input.signatureHtml)}` : ""}</div>`;
  const quoted = input.quotedHtml ?? "";
  if (!quoted) return ours;
  const bodyTag = /<body[^>]*>/i.exec(quoted);
  if (!bodyTag) return `${ours}<br>${quoted}`;
  const at = bodyTag.index + bodyTag[0].length;
  return `${quoted.slice(0, at)}${ours}<br>${quoted.slice(at)}`;
}
