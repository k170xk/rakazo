/**
 * Visual edits in the App Studio: the owner clicks something in the running app and changes its
 * words or look directly, without asking the bot. The preview build tags each element with the
 * place it was written ("App.tsx:12:7"); this module finds that element in the source, lists the
 * words written there and the style choices it has, and rewrites only that spot. It runs in the
 * browser, and the result is saved like any other code change, so history and restore still work.
 */

export type StyleGroupId =
  | "size"
  | "weight"
  | "color"
  | "background"
  | "align"
  | "padding"
  | "radius"
  | "shadow";

export type StyleGroup = { id: StyleGroupId; label: string; options: readonly string[] };

/** Only theme tokens, so a visual edit can never take an app off brand or break dark mode. */
export const STYLE_GROUPS: readonly StyleGroup[] = [
  {
    id: "size",
    label: "Text size",
    options: [
      "text-xs",
      "text-sm",
      "text-base",
      "text-lg",
      "text-xl",
      "text-2xl",
      "text-3xl",
      "text-4xl",
      "text-5xl",
    ],
  },
  {
    id: "weight",
    label: "Weight",
    options: ["font-normal", "font-medium", "font-semibold", "font-bold"],
  },
  {
    id: "color",
    label: "Text colour",
    options: [
      "text-foreground",
      "text-muted-foreground",
      "text-primary",
      "text-success",
      "text-warning",
      "text-destructive",
    ],
  },
  {
    id: "background",
    label: "Background",
    options: [
      "bg-transparent",
      "bg-card",
      "bg-muted",
      "bg-primary/10",
      "bg-primary",
      "bg-success/10",
      "bg-warning/10",
      "bg-destructive/10",
    ],
  },
  { id: "align", label: "Align", options: ["text-left", "text-center", "text-right"] },
  {
    id: "padding",
    label: "Padding",
    options: ["p-0", "p-1", "p-2", "p-3", "p-4", "p-5", "p-6", "p-8", "p-10"],
  },
  {
    id: "radius",
    label: "Corners",
    options: [
      "rounded-none",
      "rounded-sm",
      "rounded-md",
      "rounded-lg",
      "rounded-xl",
      "rounded-2xl",
      "rounded-3xl",
      "rounded-full",
    ],
  },
  {
    id: "shadow",
    label: "Shadow",
    options: ["shadow-none", "shadow-sm", "shadow-md", "shadow-lg", "shadow-xl"],
  },
];

/** Every class a visual edit can add; preview builds include them so a change shows at once. */
export const VISUAL_EDIT_CLASSES: readonly string[] = STYLE_GROUPS.flatMap(
  (group) => group.options,
);

/** Props whose plain string values are words people read, so they can be edited in place. */
const TEXT_PROPS = new Set([
  "title",
  "subtitle",
  "label",
  "description",
  "eyebrow",
  "placeholder",
  "caption",
  "hint",
  "empty",
  "emptyText",
  "text",
  "heading",
  "message",
  "alt",
]);

export { LOC_CLASS_PREFIX, locClass, locFromClass } from "./loc.js";

export type Loc = { file: string; line: number; column: number };

export function parseLoc(loc: string): Loc | null {
  const match = /^(.+):(\d+):(\d+)$/.exec(loc);
  if (!match) return null;
  return { file: match[1]!, line: Number(match[2]), column: Number(match[3]) };
}

type Span = { start: number; end: number };
type Attribute = {
  name: string;
  /** The whole attribute, name to end of value. */
  span: Span;
  value:
    | { kind: "string"; span: Span; text: string; quote: string }
    | { kind: "expression"; span: Span }
    | { kind: "none" };
};
type Segment = Span & { text: string; kind: "jsx" | "literal" };
type Element = {
  start: number;
  nameEnd: number;
  name: string;
  attributes: Attribute[];
  openEnd: number;
  /** Text written directly inside the element (not inside child elements). */
  segments: Segment[];
};

class ScanError extends Error {}

const isSpace = (char: string | undefined) => char !== undefined && /\s/.test(char);

function skipString(text: string, at: number): number {
  const quote = text[at];
  for (let i = at + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === quote) return i + 1;
    else if (text[i] === "\n" && quote !== "`") break;
  }
  throw new ScanError("Unclosed string.");
}

function skipTemplate(text: string, at: number): number {
  for (let i = at + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "`") return i + 1;
    else if (text[i] === "$" && text[i + 1] === "{") i = skipExpression(text, i + 1) - 1;
  }
  throw new ScanError("Unclosed template.");
}

function startsJsx(text: string, at: number): boolean {
  const next = text[at + 1];
  if (!next || !/[A-Za-z>]/.test(next)) return false;
  let i = at - 1;
  while (i >= 0 && isSpace(text[i])) i--;
  if (i < 0) return true;
  if ("([{,;:?=&|!>}".includes(text[i]!)) return true;
  return /\b(?:return|yield|default|case)$/.test(text.slice(Math.max(0, i - 7), i + 1));
}

/** From an opening brace to just past its matching close, through strings, templates and JSX. */
function skipExpression(text: string, at: number): number {
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"' || char === "'") i = skipString(text, i) - 1;
    else if (char === "`") i = skipTemplate(text, i) - 1;
    else if (char === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
    } else if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) throw new ScanError("Unclosed comment.");
      i = end + 1;
    } else if (char === "<" && startsJsx(text, i)) i = parseElement(text, i).end - 1;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new ScanError("Unclosed expression.");
}

function parseOpening(text: string, start: number) {
  if (text[start] !== "<") throw new ScanError("Not an element.");
  let i = start + 1;
  while (i < text.length && /[A-Za-z0-9_.$:-]/.test(text[i]!)) i++;
  const nameEnd = i;
  const name = text.slice(start + 1, nameEnd);
  const attributes: Attribute[] = [];
  for (;;) {
    while (isSpace(text[i])) i++;
    if (i >= text.length) throw new ScanError("Unclosed tag.");
    if (text[i] === "/" && text[i + 1] === ">")
      return { name, nameEnd, attributes, openEnd: i + 2, selfClosing: true };
    if (text[i] === ">") return { name, nameEnd, attributes, openEnd: i + 1, selfClosing: false };
    if (text[i] === "{") {
      i = skipExpression(text, i);
      continue;
    }
    const nameStart = i;
    while (i < text.length && !isSpace(text[i]) && !"=/>".includes(text[i]!)) i++;
    const attrName = text.slice(nameStart, i);
    if (!attrName) throw new ScanError("Unreadable attribute.");
    let j = i;
    while (isSpace(text[j])) j++;
    if (text[j] !== "=") {
      attributes.push({
        name: attrName,
        span: { start: nameStart, end: i },
        value: { kind: "none" },
      });
      continue;
    }
    j++;
    while (isSpace(text[j])) j++;
    if (text[j] === '"' || text[j] === "'") {
      const quote = text[j]!;
      const close = text.indexOf(quote, j + 1);
      if (close === -1) throw new ScanError("Unclosed attribute.");
      attributes.push({
        name: attrName,
        span: { start: nameStart, end: close + 1 },
        value: {
          kind: "string",
          span: { start: j + 1, end: close },
          text: text.slice(j + 1, close),
          quote,
        },
      });
      i = close + 1;
    } else if (text[j] === "{") {
      const end = skipExpression(text, j);
      attributes.push({
        name: attrName,
        span: { start: nameStart, end },
        value: { kind: "expression", span: { start: j, end } },
      });
      i = end;
    } else throw new ScanError("Unreadable attribute value.");
  }
}

function parseElement(text: string, start: number): Element & { end: number } {
  const opening = parseOpening(text, start);
  const element = { start, ...opening, segments: [] as Segment[] };
  if (opening.selfClosing) return { ...element, end: opening.openEnd };
  let i = opening.openEnd;
  let textStart = i;
  const flush = (end: number) => {
    if (end > textStart && text.slice(textStart, end).trim()) {
      element.segments.push({
        start: textStart,
        end,
        text: text.slice(textStart, end),
        kind: "jsx",
      });
    }
  };
  while (i < text.length) {
    if (text.startsWith("</", i)) {
      flush(i);
      const close = text.indexOf(">", i);
      if (close === -1) throw new ScanError("Unclosed element.");
      if (text.slice(i + 2, close).trim() !== opening.name)
        throw new ScanError("Mismatched closing tag.");
      return { ...element, end: close + 1 };
    }
    if (text[i] === "<") {
      flush(i);
      i = parseElement(text, i).end;
      textStart = i;
    } else if (text[i] === "{") {
      flush(i);
      const end = skipExpression(text, i);
      const inner = text.slice(i + 1, end - 1).trim();
      const literal =
        /^(["'])((?:(?!\1)[^\\\n]|\\.)*)\1$/.exec(inner) ?? /^`([^`$\\]*)`$/.exec(inner);
      if (literal) {
        const value = literal.length === 3 ? literal[2]! : literal[1]!;
        if (value.trim())
          element.segments.push({ start: i, end, text: unescapeJs(value), kind: "literal" });
      }
      i = end;
      textStart = i;
    } else i++;
  }
  throw new ScanError("Unclosed element.");
}

function unescapeJs(value: string): string {
  return value.replace(/\\(["'\\`nt])/g, (_, char: string) =>
    char === "n" ? "\n" : char === "t" ? "\t" : char,
  );
}

function offsetOf(text: string, line: number, column: number): number {
  let offset = 0;
  for (let current = 1; current < line; current++) {
    const next = text.indexOf("\n", offset);
    if (next === -1) return -1;
    offset = next + 1;
  }
  return offset + column - 1;
}

function locate(
  files: Record<string, string>,
  loc: string,
): { file: string; text: string; element: Element & { end: number } } {
  const parsed = parseLoc(loc);
  if (!parsed) throw new ScanError("That element has no place in the code.");
  const text = files[parsed.file];
  if (typeof text !== "string")
    throw new ScanError(`${parsed.file} is not one of the app's files.`);
  let start = offsetOf(text, parsed.line, parsed.column);
  if (start < 0) throw new ScanError("That element has moved; reload the app.");
  if (text[start] !== "<") {
    // Columns count characters; a nearby '<' on the same line covers wide characters before it.
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = text.indexOf("\n", lineStart);
    const near = text.indexOf("<", Math.max(lineStart, start - 4));
    if (near === -1 || (lineEnd !== -1 && near > lineEnd))
      throw new ScanError("That element has moved; reload the app.");
    start = near;
  }
  return { file: parsed.file, text, element: parseElement(text, start) };
}

export type EditableText = { id: string; label: string; value: string };

export type ElementInfo = {
  file: string;
  /** The tag or component as written, such as "h2" or "Button". */
  name: string;
  texts: EditableText[];
  /** The element's own classes, or null when they are computed and only the bot can change them. */
  classes: string[] | null;
  /** The chosen option of each style group, or null for the default. */
  styles: Record<StyleGroupId, string | null>;
};

const normalise = (value: string) => value.replace(/\s+/g, " ").trim();

function classSource(
  element: Element,
  text: string,
): { span: Span; value: string } | "none" | null {
  const attribute = element.attributes.find((item) => item.name === "className");
  if (!attribute) return "none";
  if (attribute.value.kind === "string")
    return { span: attribute.value.span, value: attribute.value.text };
  if (attribute.value.kind !== "expression") return null;
  const { start, end } = attribute.value.span;
  const inner = text.slice(start + 1, end - 1);
  const template = /^\s*`([^`$\\]*)`\s*$/.exec(inner);
  if (template) {
    const at = start + 1 + inner.indexOf("`") + 1;
    return { span: { start: at, end: at + template[1]!.length }, value: template[1]! };
  }
  const call = /^\s*(?:cn|clsx|classNames)\(\s*(["'])([^"'\\\n]*)\1/.exec(inner);
  if (call) {
    const at = start + 1 + inner.indexOf(call[1]!, inner.indexOf("(")) + 1;
    return { span: { start: at, end: at + call[2]!.length }, value: call[2]! };
  }
  return null;
}

function stylesOf(classes: readonly string[]): Record<StyleGroupId, string | null> {
  const styles = {} as Record<StyleGroupId, string | null>;
  for (const group of STYLE_GROUPS) {
    styles[group.id] = [...classes].reverse().find((name) => group.options.includes(name)) ?? null;
  }
  return styles;
}

function textsOf(element: Element): EditableText[] {
  const texts: EditableText[] = element.segments.map((segment, index) => ({
    id: `child:${index}`,
    label: "Text",
    value: normalise(segment.text),
  }));
  for (const attribute of element.attributes) {
    if (
      attribute.value.kind === "string" &&
      TEXT_PROPS.has(attribute.name) &&
      attribute.value.text.trim()
    ) {
      texts.push({
        id: `prop:${attribute.name}`,
        label: attribute.name,
        value: attribute.value.text,
      });
    }
  }
  return texts;
}

/** What can be changed on the element at loc, or a reason it can only be changed through the bot. */
export function readElement(
  files: Record<string, string>,
  loc: string,
): ElementInfo | { error: string } {
  try {
    const { file, text, element } = locate(files, loc);
    const source = classSource(element, text);
    const classes =
      source === null ? null : source === "none" ? [] : source.value.split(/\s+/).filter(Boolean);
    return {
      file,
      name: element.name || "fragment",
      texts: textsOf(element),
      classes,
      styles: stylesOf(classes ?? []),
    };
  } catch (error) {
    return {
      error:
        error instanceof ScanError ? error.message : "That part of the code can't be edited here.",
    };
  }
}

export type VisualEdit = {
  /** New words by EditableText id. */
  texts?: Record<string, string>;
  /** New option per style group; null removes the group's class so the default shows. */
  styles?: Partial<Record<StyleGroupId, string | null>>;
};

function jsxText(original: string, value: string): string {
  const lead = /^\s*/.exec(original)![0];
  const trail = /\s*$/.exec(original)![0];
  const safe = /[{}<>]/.test(value) ? `{${JSON.stringify(value)}}` : value;
  return `${lead}${safe}${trail}`;
}

/** The class list after setting each group, keeping every other class in its place. */
export function applyStyles(
  classes: readonly string[],
  styles: VisualEdit["styles"] = {},
): string[] {
  let next = [...classes];
  for (const group of STYLE_GROUPS) {
    if (!(group.id in styles)) continue;
    const value = styles[group.id];
    if (value != null && !group.options.includes(value)) continue;
    next = next.filter((name) => !group.options.includes(name));
    if (value) next.push(value);
  }
  return next;
}

/** The app's files with the edit made at loc, or a reason it could not be made. */
export function applyVisualEdit(
  files: Record<string, string>,
  loc: string,
  edit: VisualEdit,
): { files: Record<string, string> } | { error: string } {
  try {
    const { file, text, element } = locate(files, loc);
    const replacements: Array<Span & { value: string }> = [];
    for (const [id, value] of Object.entries(edit.texts ?? {})) {
      if (id.startsWith("child:")) {
        const segment = element.segments[Number(id.slice(6))];
        if (!segment) return { error: "That text has changed; reload the app." };
        if (normalise(segment.text) === normalise(value)) continue;
        replacements.push({
          start: segment.start,
          end: segment.end,
          value:
            segment.kind === "jsx" ? jsxText(segment.text, value) : `{${JSON.stringify(value)}}`,
        });
      } else if (id.startsWith("prop:")) {
        const attribute = element.attributes.find((item) => item.name === id.slice(5));
        if (attribute?.value.kind !== "string")
          return { error: "That text has changed; reload the app." };
        if (attribute.value.text === value) continue;
        replacements.push(
          value.includes(attribute.value.quote) || /[\n\\]/.test(value)
            ? {
                start: attribute.span.start,
                end: attribute.span.end,
                value: `${attribute.name}={${JSON.stringify(value)}}`,
              }
            : { ...attribute.value.span, value },
        );
      }
    }
    if (edit.styles && Object.keys(edit.styles).length) {
      const source = classSource(element, text);
      if (source === null)
        return {
          error: "This element's classes are computed in code; ask the bot to change its look.",
        };
      const current = source === "none" ? [] : source.value.split(/\s+/).filter(Boolean);
      const next = applyStyles(current, edit.styles).join(" ");
      if (next !== current.join(" ")) {
        if (source === "none") {
          if (next)
            replacements.push({
              start: element.nameEnd,
              end: element.nameEnd,
              value: ` className="${next}"`,
            });
        } else replacements.push({ ...source.span, value: next });
      }
    }
    if (!replacements.length) return { files };
    let updated = text;
    for (const item of replacements.sort((a, b) => b.start - a.start)) {
      updated = updated.slice(0, item.start) + item.value + updated.slice(item.end);
    }
    return { files: { ...files, [file]: updated } };
  } catch (error) {
    return {
      error:
        error instanceof ScanError ? error.message : "That part of the code can't be edited here.",
    };
  }
}
