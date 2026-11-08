/**
 * Rewrites the maths delimiters models write into the `$$` form remark-math reads, leaving code
 * untouched: `\[…\]` becomes a display block, `\(…\)` and `$…$` become inline maths.
 *
 * A single `$` pair counts as maths only when it hugs its content and is not followed by a digit,
 * so prices such as "$5 and $10" or "$5-$10" stay text.
 */
export function normalizeMathDelimiters(text: string): string {
  if (!/[$\\]/.test(text)) return text;
  return splitCode(text)
    .map((part) => (part.code ? part.value : rewriteMath(part.value)))
    .join("");
}

type Part = { code: boolean; value: string };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Fenced blocks and inline code spans, which hold maths-looking text that must stay literal. */
function splitCode(text: string): Part[] {
  const parts: Part[] = [];
  let prose = "";
  const lines = text.split(/(?<=\n)/);
  let fence: string | null = null;
  let block = "";
  for (const line of lines) {
    if (fence) {
      block += line;
      const closing = line.match(FENCE);
      if (closing?.[1] && closing[1][0] === fence[0] && closing[1].length >= fence.length) {
        parts.push({ code: true, value: block });
        fence = null;
        block = "";
      }
      continue;
    }
    const opening = line.match(FENCE);
    if (opening?.[1]) {
      if (prose) parts.push(...splitInlineCode(prose));
      prose = "";
      fence = opening[1];
      block = line;
      continue;
    }
    prose += line;
  }
  if (fence) parts.push({ code: true, value: block });
  if (prose) parts.push(...splitInlineCode(prose));
  return parts;
}

function splitInlineCode(text: string): Part[] {
  const parts: Part[] = [];
  const span = /(`+)[\s\S]*?[^`]\1(?!`)/g;
  let last = 0;
  for (const match of text.matchAll(span)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ code: false, value: text.slice(last, start) });
    parts.push({ code: true, value: match[0] });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ code: false, value: text.slice(last) });
  return parts;
}

function rewriteMath(text: string): string {
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, body: string) => `\n$$\n${body.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, body: string) => `$$${body.trim()}$$`)
    .replace(
      /(^|[^$\\])\$(?=\S)([^$\n]*?[^\s$\\])\$(?![$\d])/g,
      (_, before: string, body: string) => `${before}$$${body}$$`,
    );
}
