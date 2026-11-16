/**
 * A small XML reader for the parts of a workbook file: elements with attributes and text, names
 * without their namespace prefix. It reads the whole document into a tree, which is all the
 * compiler needs; it does not validate.
 */

export type XmlNode = {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

/** Excel writes characters XML cannot hold as _xHHHH_. */
export function decodeExcelEscapes(text: string): string {
  if (!text.includes("_x")) return text;
  return text.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

const local = (name: string) => {
  const colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
};

/** XML parsers read a raw carriage return, alone or before a line feed, as one line feed. */
const lineEnds = (text: string) => (text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text);

export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const lt = source.indexOf("<", i);
    if (lt < 0) break;
    if (lt > i) {
      const parent = stack[stack.length - 1]!;
      parent.text += decodeEntities(lineEnds(source.slice(i, lt)));
    }
    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", lt)) {
      const end = source.indexOf("]]>", lt + 9);
      stack[stack.length - 1]!.text += lineEnds(source.slice(lt + 9, end < 0 ? n : end));
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (source[lt + 1] === "?" || source[lt + 1] === "!") {
      const end = source.indexOf(">", lt);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (source[lt + 1] === "/") {
      const end = source.indexOf(">", lt);
      if (stack.length > 1) stack.pop();
      i = end < 0 ? n : end + 1;
      continue;
    }
    // Find the tag's end, stepping over quoted attribute values.
    let j = lt + 1;
    let quote = "";
    for (; j < n; j++) {
      const ch = source[j]!;
      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ">") break;
    }
    const selfClosing = source[j - 1] === "/";
    const body = source.slice(lt + 1, selfClosing ? j - 1 : j);
    const space = body.search(/\s/);
    const name = local(space < 0 ? body : body.slice(0, space));
    const attrs: Record<string, string> = {};
    if (space >= 0) {
      const pattern = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      const rest = body.slice(space);
      for (let m = pattern.exec(rest); m; m = pattern.exec(rest)) {
        const key = m[1]!;
        const value = decodeEntities(m[3] ?? m[4] ?? "");
        attrs[key.startsWith("xmlns") ? key : key.startsWith("r:") ? key : local(key)] = value;
      }
    }
    const node: XmlNode = { name, attrs, children: [], text: "" };
    stack[stack.length - 1]!.children.push(node);
    if (!selfClosing) stack.push(node);
    i = j + 1;
  }
  return root;
}

export const child = (node: XmlNode | undefined, name: string) =>
  node?.children.find((c) => c.name === name);
export const childrenNamed = (node: XmlNode | undefined, name: string) =>
  node ? node.children.filter((c) => c.name === name) : [];

/** Every descendant with the given name, in document order. */
export function descendants(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}

/** The text of a node and everything inside it. */
export function textOf(node: XmlNode | undefined): string {
  if (!node) return "";
  let out = node.text;
  for (const c of node.children) out += textOf(c);
  return out;
}
