/**
 * Formatting edits shared by ocsc-word, ocsc-pptx and ocsc-xlsx.
 * Colour, highlight, bold, italic, underline, size, alignment and fills,
 * applied to the existing text so the rest of the file stays as it is.
 */

const NAMED = {
  black: "000000",
  white: "FFFFFF",
  red: "C00000",
  green: "76BF43",
  brand: "76BF43",
  ocsc: "76BF43",
  blue: "1F4E79",
  navy: "0D1B2A",
  yellow: "FFC000",
  orange: "ED7D31",
  grey: "595959",
  gray: "595959",
  purple: "7030A0",
  pink: "E83E8C",
  teal: "0D7377",
};

const HIGHLIGHTS = {
  yellow: "yellow",
  green: "green",
  red: "red",
  blue: "blue",
  cyan: "cyan",
  pink: "magenta",
  magenta: "magenta",
  grey: "lightGray",
  gray: "lightGray",
  orange: "darkYellow",
  black: "black",
  white: "white",
  darkgreen: "darkGreen",
  darkred: "darkRed",
  darkblue: "darkBlue",
};

const COLOUR_NAMES = "black, white, red, green, blue, navy, yellow, orange, grey, purple, pink, teal, brand";

const WORD_ORDER = [
  "rStyle",
  "rFonts",
  "b",
  "bCs",
  "i",
  "iCs",
  "caps",
  "smallCaps",
  "strike",
  "color",
  "sz",
  "szCs",
  "vertAlign",
  "highlight",
  "u",
  "shd",
];

function esc(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unesc(text) {
  return String(text)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** RRGGBB, or null when `value` is not a colour we know. */
export function colourHex(value) {
  if (value == null || value === "") return null;
  const raw = String(value).trim().toLowerCase().replace(/\s+/g, "");
  if (NAMED[raw]) return NAMED[raw];
  const hex = raw.replace(/^#/, "");
  if (/^[0-9a-f]{3}$/.test(hex))
    return hex
      .split("")
      .map((c) => c + c)
      .join("")
      .toUpperCase();
  if (/^[0-9a-f]{6}$/.test(hex)) return hex.toUpperCase();
  return null;
}

export function colourOrThrow(value, label) {
  const hex = colourHex(value);
  if (!hex)
    throw new Error(
      `${label} ${JSON.stringify(value)} is not a colour. Use a hex such as #76BF43, or ${COLOUR_NAMES}.`,
    );
  return hex;
}

function highlightOrThrow(value) {
  const name = HIGHLIGHTS[String(value).trim().toLowerCase().replace(/\s+/g, "")];
  if (!name)
    throw new Error(
      `Highlight ${JSON.stringify(value)} is not one of: yellow, green, red, blue, cyan, pink, orange, grey.`,
    );
  return name;
}

/** The fields an edit may set. `colour` is accepted as `color`. */
export function styleFrom(op) {
  const style = {
    color: op.color ?? op.colour ?? op.font_color ?? op.font_colour,
    fill: op.fill ?? op.background ?? op.background_colour,
    shade: op.shade,
    highlight: op.highlight,
    bold: op.bold,
    italic: op.italic,
    underline: op.underline,
    strike: op.strike ?? op.strikethrough,
    size: op.size ?? op.font_size,
    font: op.font ?? op.font_name,
    script: op.script ?? (op.superscript ? "super" : op.subscript ? "sub" : undefined),
    align: op.align ?? op.alignment,
    spacing: op.spacing ?? op.line_spacing,
    before: op.before ?? op.space_before,
    after: op.after ?? op.space_after,
    indent: op.indent,
    wrap: op.wrap,
    valign: op.valign ?? op.vertical,
    border: op.border,
  };
  return style;
}

export function hasStyle(style) {
  return Boolean(
    style.color ||
      style.fill ||
      style.shade ||
      style.highlight ||
      style.bold != null ||
      style.italic != null ||
      style.underline != null ||
      style.strike != null ||
      style.size ||
      style.font ||
      style.script ||
      style.align ||
      style.spacing != null ||
      style.before != null ||
      style.after != null ||
      style.indent != null ||
      style.wrap != null ||
      style.valign ||
      style.border,
  );
}

export function stylePhrase(style) {
  const parts = [];
  if (style.color) parts.push(`text ${style.color}`);
  if (style.highlight) parts.push(`${style.highlight} highlight`);
  if (style.fill) parts.push(`fill ${style.fill}`);
  if (style.shade) parts.push(`background ${style.shade}`);
  if (style.bold === true) parts.push("bold");
  if (style.bold === false) parts.push("not bold");
  if (style.italic === true) parts.push("italic");
  if (style.underline === true) parts.push("underlined");
  if (style.size) parts.push(`${style.size}pt`);
  if (style.font) parts.push(String(style.font));
  if (style.strike === true) parts.push("strikethrough");
  if (style.script) parts.push(style.script === "sub" ? "subscript" : "superscript");
  if (style.spacing != null) parts.push(`line spacing ${style.spacing}`);
  if (style.before != null) parts.push(`${style.before}pt before`);
  if (style.after != null) parts.push(`${style.after}pt after`);
  if (style.indent != null) parts.push(`indent ${style.indent}cm`);
  if (style.wrap === true) parts.push("wrap");
  if (style.align) parts.push(String(style.align));
  if (style.border) parts.push("borders");
  return parts.join(", ") || "formatting";
}

function upsertWord(inner, tag, element) {
  const existing = new RegExp(`<w:${tag}\\b[^>]*/>`);
  if (existing.test(inner)) return inner.replace(existing, element);
  const later = WORD_ORDER.slice(WORD_ORDER.indexOf(tag) + 1);
  for (const name of later) {
    const at = inner.search(new RegExp(`<w:${name}\\b`));
    if (at >= 0) return inner.slice(0, at) + element + inner.slice(at);
  }
  return inner + element;
}

function dropWord(inner, tag) {
  return inner.replace(new RegExp(`<w:${tag}\\b[^>]*/>`, "g"), "");
}

export function applyWordRunStyle(rPr, style) {
  let inner = rPr ? rPr.replace(/^<w:rPr>/, "").replace(/<\/w:rPr>$/, "") : "";
  if (style.bold === true) inner = upsertWord(inner, "b", "<w:b/>");
  if (style.bold === false) inner = dropWord(dropWord(inner, "b"), "bCs");
  if (style.italic === true) inner = upsertWord(inner, "i", "<w:i/>");
  if (style.italic === false) inner = dropWord(dropWord(inner, "i"), "iCs");
  if (style.color)
    inner = upsertWord(inner, "color", `<w:color w:val="${colourOrThrow(style.color, "Colour")}"/>`);
  if (style.size) {
    const half = Math.max(2, Math.round(Number(style.size) * 2));
    inner = upsertWord(inner, "sz", `<w:sz w:val="${half}"/>`);
    inner = upsertWord(inner, "szCs", `<w:szCs w:val="${half}"/>`);
  }
  if (style.highlight)
    inner = upsertWord(inner, "highlight", `<w:highlight w:val="${highlightOrThrow(style.highlight)}"/>`);
  if (style.underline === true) inner = upsertWord(inner, "u", `<w:u w:val="single"/>`);
  if (style.underline === false) inner = dropWord(inner, "u");
  if (style.strike === true) inner = upsertWord(inner, "strike", "<w:strike/>");
  if (style.strike === false) inner = dropWord(inner, "strike");
  if (style.font) {
    const name = fontName(style.font);
    inner = upsertWord(
      inner,
      "rFonts",
      `<w:rFonts w:ascii="${esc(name)}" w:hAnsi="${esc(name)}" w:cs="${esc(name)}"/>`,
    );
  }
  if (style.script) {
    const value = style.script === "sub" || style.script === "subscript" ? "subscript" : "superscript";
    inner = upsertWord(inner, "vertAlign", `<w:vertAlign w:val="${value}"/>`);
  }
  if (style.script === false) inner = dropWord(inner, "vertAlign");
  return inner ? `<w:rPr>${inner}</w:rPr>` : "";
}

function fontName(value) {
  const name = String(value).trim();
  if (!/^[\p{L}\p{N} .+-]{1,40}$/u.test(name))
    throw new Error(`Font ${JSON.stringify(value)} must be a font name such as Calibri or Arial.`);
  return name;
}

function wordText(xml) {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => unesc(m[1])).join("");
}

function plainWordRun(xml) {
  return /<w:t[\s>]/.test(xml) && !/<w:drawing|<w:pict|<w:object|<w:tab\/|<w:br\b/.test(xml);
}

function paint(text, find, all) {
  const marks = new Array(text.length).fill(false);
  let count = 0;
  let from = 0;
  while (from <= text.length) {
    const at = text.indexOf(find, from);
    if (at < 0) break;
    for (let i = 0; i < find.length; i += 1) marks[at + i] = true;
    count += 1;
    if (!all) break;
    from = at + Math.max(find.length, 1);
  }
  return { marks, count };
}

function paintsCharacters(style) {
  return Boolean(
    style.color ||
      style.highlight ||
      style.bold != null ||
      style.italic != null ||
      style.underline != null ||
      style.strike != null ||
      style.size ||
      style.font ||
      style.script,
  );
}

function lineSpacing(value) {
  const raw = String(value).trim().toLowerCase();
  if (raw === "single" || raw === "1") return { line: "240", rule: "auto" };
  if (raw === "1.5" || raw === "oneandhalf") return { line: "360", rule: "auto" };
  if (raw === "double" || raw === "2") return { line: "480", rule: "auto" };
  const points = /^(\d+(?:\.\d+)?)\s*pt$/.exec(raw);
  if (points) return { line: String(Math.round(Number(points[1]) * 20)), rule: "exact" };
  const multiple = Number(raw);
  if (multiple > 0 && multiple <= 10) return { line: String(Math.round(multiple * 240)), rule: "auto" };
  throw new Error(`Line spacing ${JSON.stringify(value)} must be 1, 1.5, 2, double, or a size such as 14pt.`);
}

function upsertPPr(paragraph, tag, element) {
  if (/<w:pPr>[\s\S]*?<\/w:pPr>/.test(paragraph)) {
    return paragraph.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/, (_, inner) => {
      const re = new RegExp(`<w:${tag}\\b[^>]*/>`);
      const next = re.test(inner) ? inner.replace(re, element) : `${inner}${element}`;
      return `<w:pPr>${next}</w:pPr>`;
    });
  }
  return paragraph.replace(/<w:p\b[^>]*>/, (open) => `${open}<w:pPr>${element}</w:pPr>`);
}

function spacingParagraph(paragraph, style) {
  const existing = /<w:spacing\b([^>]*)\/>/.exec(paragraph)?.[1] ?? "";
  const kept = (name) => new RegExp(`\\bw:${name}="[^"]*"`).exec(existing)?.[0];
  const set = (name, value) => (value != null ? `w:${name}="${value}"` : kept(name));
  const line = style.spacing != null ? lineSpacing(style.spacing) : null;
  const bits = [
    set("before", style.before != null ? String(Math.round(Number(style.before) * 20)) : null),
    set("after", style.after != null ? String(Math.round(Number(style.after) * 20)) : null),
    set("line", line?.line ?? null),
    set("lineRule", line?.rule ?? null),
  ].filter(Boolean);
  return upsertPPr(paragraph, "spacing", `<w:spacing ${bits.join(" ")}/>`);
}

function indentParagraph(paragraph, indent) {
  const twips = Math.round(Number(indent) * 567);
  if (!Number.isFinite(twips)) throw new Error(`Indent ${JSON.stringify(indent)} must be centimetres.`);
  return upsertPPr(paragraph, "ind", `<w:ind w:left="${twips}"/>`);
}

function shadeParagraph(paragraph, hex) {
  const shd = `<w:shd w:val="clear" w:color="auto" w:fill="${hex}"/>`;
  if (/<w:pPr>[\s\S]*?<\/w:pPr>/.test(paragraph)) {
    return paragraph.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/, (_, inner) => {
      const next = /<w:shd\b[^>]*\/>/.test(inner)
        ? inner.replace(/<w:shd\b[^>]*\/>/, shd)
        : `${inner}${shd}`;
      return `<w:pPr>${next}</w:pPr>`;
    });
  }
  return paragraph.replace(/<w:p\b[^>]*>/, (open) => `${open}<w:pPr>${shd}</w:pPr>`);
}

function alignParagraph(paragraph, align) {
  const value = align === "centre" ? "center" : align === "justify" ? "both" : align;
  if (!["left", "center", "right", "both"].includes(value))
    throw new Error(`Alignment ${JSON.stringify(align)} must be left, center, right or justify.`);
  const jc = `<w:jc w:val="${value}"/>`;
  if (/<w:pPr>[\s\S]*?<\/w:pPr>/.test(paragraph)) {
    return paragraph.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/, (_, inner) => {
      const next = /<w:jc\b[^>]*\/>/.test(inner) ? inner.replace(/<w:jc\b[^>]*\/>/, jc) : `${inner}${jc}`;
      return `<w:pPr>${next}</w:pPr>`;
    });
  }
  return paragraph.replace(/<w:p\b[^>]*>/, (open) => `${open}<w:pPr>${jc}</w:pPr>`);
}

function shadeCell(cell, hex) {
  const shd = `<w:shd w:val="clear" w:color="auto" w:fill="${hex}"/>`;
  if (/<w:tcPr>[\s\S]*?<\/w:tcPr>/.test(cell)) {
    return cell.replace(/<w:tcPr>([\s\S]*?)<\/w:tcPr>/, (_, inner) => {
      const next = /<w:shd\b[^>]*\/>/.test(inner)
        ? inner.replace(/<w:shd\b[^>]*\/>/, shd)
        : `${inner}${shd}`;
      return `<w:tcPr>${next}</w:tcPr>`;
    });
  }
  return cell.replace(/<w:tc\b[^>]*>/, (open) => `${open}<w:tcPr>${shd}</w:tcPr>`);
}

/** Colours and styles `find` inside one Word paragraph. */
export function formatWordParagraph(paragraph, find, style, all = true) {
  if (!paragraph.includes(find) && !wordText(paragraph).includes(find))
    return { paragraph, count: 0 };
  const runs = [...paragraph.matchAll(/<w:r(?=[\s>])[^>]*>[\s\S]*?<\/w:r>/g)].map((m) => ({
    index: m.index,
    whole: m[0],
    text: wordText(m[0]),
    plain: plainWordRun(m[0]),
    rPr: /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(m[0])?.[0] ?? "",
  }));
  const full = runs.map((run) => run.text).join("");
  if (!full.includes(find)) return { paragraph, count: 0 };
  const { marks, count } = paint(full, find, all);
  if (!count) return { paragraph, count: 0 };
  let paragraphOut = paragraph;
  if (paintsCharacters(style)) {
    let out = "";
    let last = 0;
    let pos = 0;
    for (const run of runs) {
      out += paragraph.slice(last, run.index);
      last = run.index + run.whole.length;
      const slice = marks.slice(pos, pos + run.text.length);
      pos += run.text.length;
      if (!run.text || !slice.some(Boolean)) {
        out += run.whole;
        continue;
      }
      if (!run.plain) {
        const styled = applyWordRunStyle(run.rPr, style);
        out += run.rPr
          ? run.whole.replace(run.rPr, styled)
          : run.whole.replace(/<w:r\b[^>]*>/, (open) => `${open}${styled}`);
        continue;
      }
      let built = "";
      let i = 0;
      while (i < run.text.length) {
        const on = slice[i];
        let j = i + 1;
        while (j < run.text.length && slice[j] === on) j += 1;
        const rPr = on ? applyWordRunStyle(run.rPr, style) : run.rPr;
        built += `<w:r>${rPr}<w:t xml:space="preserve">${esc(run.text.slice(i, j))}</w:t></w:r>`;
        i = j;
      }
      out += built;
    }
    paragraphOut = out + paragraph.slice(last);
  }
  const background = style.shade ?? style.fill;
  if (background) paragraphOut = shadeParagraph(paragraphOut, colourOrThrow(background, "Background"));
  if (style.align) paragraphOut = alignParagraph(paragraphOut, String(style.align).toLowerCase());
  if (style.spacing != null || style.before != null || style.after != null)
    paragraphOut = spacingParagraph(paragraphOut, style);
  if (style.indent != null) paragraphOut = indentParagraph(paragraphOut, style.indent);
  return { paragraph: paragraphOut, count };
}

const PAPER = {
  a4: [11906, 16838],
  letter: [12240, 15840],
  a3: [16838, 23811],
  legal: [12240, 20160],
};

function cmToTwips(value, label) {
  const n = typeof value === "number" ? value : Number(String(value).replace(/cm$/i, "").trim());
  if (!Number.isFinite(n) || n < 0 || n > 15)
    throw new Error(`${label} ${JSON.stringify(value)} must be centimetres, such as 2.5.`);
  return Math.round(n * 567);
}

/** Sets page margins (centimetres), paper and orientation on every Word section. */
export function applyWordPageSetup(xml, setup) {
  const margin = setup.margin ?? setup.margins;
  const top = setup.top ?? margin;
  const bottom = setup.bottom ?? margin;
  const left = setup.left ?? margin;
  const right = setup.right ?? margin;
  const paperKey = String(setup.paper ?? setup.size ?? "")
    .trim()
    .toLowerCase();
  const orient = String(setup.orientation ?? setup.orient ?? "")
    .trim()
    .toLowerCase();
  if (top == null && bottom == null && left == null && right == null && !paperKey && !orient)
    throw new Error("page_setup needs margins, paper (A4, Letter, A3, Legal) or orientation (portrait, landscape).");
  const patch = (sect) => {
    let next = sect;
    if (top != null || right != null || bottom != null || left != null) {
      const current = /<w:pgMar\b([^>]*)\/>/.exec(next)?.[1] ?? ` w:header="708" w:footer="708" w:gutter="0"`;
      const attr = (name, value) =>
        value == null
          ? (new RegExp(`\\bw:${name}="[^"]*"`).exec(current)?.[0] ?? `w:${name}="1440"`)
          : `w:${name}="${cmToTwips(value, name)}"`;
      const mar = `<w:pgMar ${attr("top", top)} ${attr("right", right)} ${attr("bottom", bottom)} ${attr("left", left)} ${attr("header", null)} ${attr("footer", null)} ${attr("gutter", null)}/>`;
      next = /<w:pgMar\b[^>]*\/>/.test(next)
        ? next.replace(/<w:pgMar\b[^>]*\/>/, mar)
        : next.replace("</w:sectPr>", `${mar}</w:sectPr>`);
    }
    if (paperKey || orient) {
      const current = /<w:pgSz\b([^>]*)\/>/.exec(next)?.[1] ?? "";
      let w = Number(/\bw:w="(\d+)"/.exec(current)?.[1] ?? 11906);
      let h = Number(/\bw:h="(\d+)"/.exec(current)?.[1] ?? 16838);
      if (paperKey) {
        const size = PAPER[paperKey];
        if (!size) throw new Error(`Paper ${JSON.stringify(setup.paper ?? setup.size)} must be A4, Letter, A3 or Legal.`);
        [w, h] = size;
      }
      const landscape = orient === "landscape" || orient === "wide";
      const portrait = orient === "portrait";
      if (landscape && w < h) [w, h] = [h, w];
      if (portrait && w > h) [w, h] = [h, w];
      const o = landscape ? "landscape" : portrait ? "portrait" : w > h ? "landscape" : "portrait";
      const sz = `<w:pgSz w:w="${w}" w:h="${h}" w:orient="${o}"/>`;
      next = /<w:pgSz\b[^>]*\/>/.test(next)
        ? next.replace(/<w:pgSz\b[^>]*\/>/, sz)
        : next.replace("</w:sectPr>", `${sz}</w:sectPr>`);
    }
    return next;
  };
  if (/<w:sectPr\b[\s\S]*?<\/w:sectPr>/.test(xml)) return xml.replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g, patch);
  const sect = patch("<w:sectPr></w:sectPr>");
  if (xml.includes("</w:body>")) return xml.replace("</w:body>", `${sect}</w:body>`);
  return xml + sect;
}

/** Applies a Word formatting edit across the document body. */
export function formatWordDocument(xml, find, style, all = true) {
  let count = 0;
  let next = xml.replace(/<w:p(?=[\s>])[^>]*(?<!\/)>[\s\S]*?<\/w:p>/g, (paragraph) => {
    if (!all && count) return paragraph;
    const result = formatWordParagraph(paragraph, find, style, all);
    count += result.count;
    return result.paragraph;
  });
  const background = style.shade ?? style.fill;
  if (background) {
    const hex = colourOrThrow(background, "Background");
    const wanted = find.replace(/\s+/g, " ").trim();
    next = next.replace(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g, (cell) => {
      const text = wordText(cell).replace(/\s+/g, " ").trim();
      return text === wanted ? shadeCell(cell, hex) : cell;
    });
  }
  return { xml: next, count };
}

function setAttr(element, name, value) {
  const attr = `${name}="${value}"`;
  if (new RegExp(`\\b${name}="[^"]*"`).test(element))
    return element.replace(new RegExp(`\\b${name}="[^"]*"`), attr);
  return element.replace(/<a:rPr\b/, `<a:rPr ${attr}`).replace(/<a:pPr\b/, `<a:pPr ${attr}`);
}

function applyPptxRunStyle(runInner, style) {
  let rPr = /<a:rPr\b[^>]*\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/.exec(runInner)?.[0] ?? "<a:rPr/>";
  if (style.bold != null) rPr = setAttr(rPr, "b", style.bold ? "1" : "0");
  if (style.italic != null) rPr = setAttr(rPr, "i", style.italic ? "1" : "0");
  if (style.underline != null) rPr = setAttr(rPr, "u", style.underline ? "sng" : "none");
  if (style.size) rPr = setAttr(rPr, "sz", String(Math.round(Number(style.size) * 100)));
  if (style.font) {
    const name = fontName(style.font);
    const faces = `<a:latin typeface="${esc(name)}"/><a:ea typeface="${esc(name)}"/><a:cs typeface="${esc(name)}"/>`;
    rPr = rPr.replace(/<a:latin\b[^>]*\/>|<a:ea\b[^>]*\/>|<a:cs\b[^>]*\/>/g, "");
    if (rPr.endsWith("/>")) rPr = rPr.replace(/\/>$/, `>${faces}</a:rPr>`);
    else rPr = rPr.replace("</a:rPr>", `${faces}</a:rPr>`);
  }
  if (style.color) {
    const fill = `<a:solidFill><a:srgbClr val="${colourOrThrow(style.color, "Colour")}"/></a:solidFill>`;
    if (/<a:(?:solidFill|gradFill)>/.test(rPr))
      rPr = rPr.replace(/<a:solidFill>[\s\S]*?<\/a:solidFill>|<a:gradFill>[\s\S]*?<\/a:gradFill>/, fill);
    else if (rPr.endsWith("/>")) rPr = rPr.replace(/\/>$/, `>${fill}</a:rPr>`);
    else rPr = rPr.replace(/<a:rPr\b[^>]*>/, (open) => `${open}${fill}`);
  }
  if (/<a:rPr\b/.test(runInner))
    return runInner.replace(/<a:rPr\b[^>]*\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/, rPr);
  return `${rPr}${runInner}`;
}

function pptxAlign(paragraph, align) {
  const key = String(align).toLowerCase();
  const value =
    key === "centre" || key === "center" ? "ctr" : key === "right" ? "r" : key === "justify" ? "just" : key === "left" ? "l" : null;
  if (!value) throw new Error(`Alignment ${JSON.stringify(align)} must be left, center, right or justify.`);
  if (/<a:pPr\b[^>]*\/>/.test(paragraph))
    return paragraph.replace(/<a:pPr\b[^>]*\/>/, (tag) => setAttr(tag, "algn", value));
  if (/<a:pPr\b[^>]*>/.test(paragraph))
    return paragraph.replace(/<a:pPr\b[^>]*>/, (tag) => setAttr(tag, "algn", value));
  return paragraph.replace("<a:p>", `<a:p><a:pPr algn="${value}"/>`);
}

/** Colours and styles `find` inside one PowerPoint paragraph. */
export function formatPptxParagraph(paragraph, find, style, all = true) {
  const runs = [...paragraph.matchAll(/<a:r\b[^>]*>([\s\S]*?)<\/a:r>/g)].map((m) => {
    const text = /<a:t>([\s\S]*?)<\/a:t>/.exec(m[1]);
    return { whole: m[0], index: m.index, inner: m[1], text: text ? unesc(text[1]) : "" };
  });
  const full = runs.map((run) => run.text).join("");
  if (!find || !full.includes(find)) return { paragraph, count: 0 };
  const { marks, count } = paint(full, find, all);
  let out = "";
  let last = 0;
  let pos = 0;
  for (const run of runs) {
    out += paragraph.slice(last, run.index);
    last = run.index + run.whole.length;
    const slice = marks.slice(pos, pos + run.text.length);
    pos += run.text.length;
    if (!run.text || !slice.some(Boolean)) {
      out += run.whole;
      continue;
    }
    const rPr = /<a:rPr\b[^>]*\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/.exec(run.inner)?.[0] ?? "";
    let built = "";
    let i = 0;
    while (i < run.text.length) {
      const on = slice[i];
      let j = i + 1;
      while (j < run.text.length && slice[j] === on) j += 1;
      const inner = on ? applyPptxRunStyle(`${rPr}<a:t></a:t>`, style).replace(/<a:t><\/a:t>/, "") : rPr;
      built += `<a:r>${inner}<a:t>${esc(run.text.slice(i, j))}</a:t></a:r>`;
      i = j;
    }
    out += built;
  }
  let paragraphOut = out + paragraph.slice(last);
  if (style.align) paragraphOut = pptxAlign(paragraphOut, String(style.align).toLowerCase());
  return { paragraph: paragraphOut, count };
}

/** Applies a PowerPoint text formatting edit to a slide. */
export function formatPptxXml(xml, find, style, all = true) {
  let count = 0;
  const next = xml.replace(/<a:p>[\s\S]*?<\/a:p>/g, (paragraph) => {
    if (!all && count) return paragraph;
    const result = formatPptxParagraph(paragraph, find, style, all);
    count += result.count;
    return result.paragraph;
  });
  return { xml: next, count };
}

function shapeFill(sp, hex) {
  const fill = `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
  return sp.replace(/<p:spPr\b[^>]*>([\s\S]*?)<\/p:spPr>/, (spPr) => {
    if (/<a:blipFill\b/.test(spPr)) return spPr;
    if (/<a:solidFill>[\s\S]*?<\/a:solidFill>|<a:gradFill>[\s\S]*?<\/a:gradFill>|<a:noFill\/>/.test(spPr))
      return spPr.replace(/<a:solidFill>[\s\S]*?<\/a:solidFill>|<a:gradFill>[\s\S]*?<\/a:gradFill>|<a:noFill\/>/, fill);
    if (/<\/a:prstGeom>/.test(spPr)) return spPr.replace("</a:prstGeom>", `</a:prstGeom>${fill}`);
    return spPr.replace(/<p:spPr\b[^>]*>/, (open) => `${open}${fill}`);
  });
}

function mapPptxShape(xml, shapeId, change) {
  let found = false;
  const next = xml.replace(/<p:(sp|pic)\b[^>]*>[\s\S]*?<\/p:\1>/g, (block) => {
    const id = Number(/\bid="(\d+)"/.exec(/<p:cNvPr\b[^>]*>/.exec(block)?.[0] ?? "")?.[1]);
    if (found || id !== Number(shapeId)) return block;
    found = true;
    return change(block);
  });
  return { xml: next, found };
}

const EMU_PER_CM = 360000;

/** Moves or resizes a shape. x, y, w and h are centimetres from the slide's top left. */
export function placePptxShape(xml, shapeId, box) {
  const emu = (cm, label) => {
    const n = Number(cm);
    if (!Number.isFinite(n)) throw new Error(`${label} ${JSON.stringify(cm)} must be centimetres.`);
    return Math.round(n * EMU_PER_CM);
  };
  return mapPptxShape(xml, shapeId, (block) => {
    const xfrmRe = /<a:xfrm\b[^>]*>[\s\S]*?<\/a:xfrm>/;
    let xfrm = xfrmRe.exec(block)?.[0] ?? `<a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm>`;
    const num = (tag, attr) => Number(new RegExp(`<a:${tag}\\b[^>]*\\b${attr}="(-?\\d+)"`).exec(xfrm)?.[1] ?? 0);
    const x = box.x != null ? emu(box.x, "x") : num("off", "x");
    const y = box.y != null ? emu(box.y, "y") : num("off", "y");
    const w = box.w != null ? emu(box.w, "w") : box.width != null ? emu(box.width, "width") : num("ext", "cx");
    const h = box.h != null ? emu(box.h, "h") : box.height != null ? emu(box.height, "height") : num("ext", "cy");
    if (/<a:off\b/.test(xfrm)) xfrm = xfrm.replace(/<a:off\b[^>]*\/>/, `<a:off x="${x}" y="${y}"/>`);
    else xfrm = xfrm.replace(/<a:xfrm\b[^>]*>/, (open) => `${open}<a:off x="${x}" y="${y}"/>`);
    if (/<a:ext\b/.test(xfrm)) xfrm = xfrm.replace(/<a:ext\b[^>]*\/>/, `<a:ext cx="${w}" cy="${h}"/>`);
    else xfrm = xfrm.replace(/<\/a:xfrm>/, `<a:ext cx="${w}" cy="${h}"/></a:xfrm>`);
    if (xfrmRe.test(block)) return block.replace(xfrmRe, xfrm);
    return block.replace(/<p:spPr\b[^>]*>/, (open) => `${open}${xfrm}`);
  });
}

/** Removes one shape or picture by its shape number. */
export function removePptxShape(xml, shapeId) {
  return mapPptxShape(xml, shapeId, () => "");
}

/** Fills the slide background. */
export function fillPptxSlide(xml, colour) {
  const hex = colourOrThrow(colour, "Background");
  const bg = `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;
  if (/<p:bg\b[\s\S]*?<\/p:bg>/.test(xml)) return xml.replace(/<p:bg\b[\s\S]*?<\/p:bg>/, bg);
  if (/<p:cSld\b[^>]*>/.test(xml)) return xml.replace(/<p:cSld\b[^>]*>/, (open) => `${open}${bg}`);
  return xml;
}

/** Fills a shape and, when a text colour is given, recolours the words inside it. */
export function formatPptxShape(xml, shapeId, style) {
  let found = false;
  const next = xml.replace(/<p:sp\b[^>]*>[\s\S]*?<\/p:sp>/g, (sp) => {
    const id = Number(/\bid="(\d+)"/.exec(/<p:cNvPr\b[^>]*>/.exec(sp)?.[0] ?? "")?.[1]);
    if (found || id !== Number(shapeId)) return sp;
    found = true;
    let shaped = sp;
    if (style.fill) shaped = shapeFill(shaped, colourOrThrow(style.fill, "Fill"));
    if (style.color || style.bold != null || style.size) {
      shaped = shaped.replace(/<a:p>[\s\S]*?<\/a:p>/g, (paragraph) => {
        const text = [...paragraph.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => unesc(m[1])).join("");
        if (!text) return paragraph;
        return formatPptxParagraph(paragraph, text, style, true).paragraph;
      });
    }
    return shaped;
  });
  return { xml: next, found };
}

/** A1 or A1:C4, as ExcelJS column and row numbers. */
export function cellRange(ref) {
  const clean = String(ref ?? "").replace(/\$/g, "");
  const m = /^([A-Za-z]{1,3})(\d{1,7})(?::([A-Za-z]{1,3})(\d{1,7}))?$/.exec(clean);
  if (!m) return null;
  const col = (letters) =>
    letters
      .toUpperCase()
      .split("")
      .reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  return {
    c1: col(m[1]),
    r1: Number(m[2]),
    c2: col(m[3] || m[1]),
    r2: Number(m[4] || m[2]),
  };
}

const EXCEL_ALIGN = { left: "left", center: "center", centre: "center", right: "right", justify: "justify" };

/** Applies a formatting edit to one ExcelJS cell, keeping its value. */
export function applyExcelFormat(cell, style) {
  const font = { ...(cell.font ?? {}) };
  let fontChanged = false;
  if (style.color) {
    font.color = { argb: `FF${colourOrThrow(style.color, "Colour")}` };
    fontChanged = true;
  }
  if (style.bold != null) {
    font.bold = Boolean(style.bold);
    fontChanged = true;
  }
  if (style.italic != null) {
    font.italic = Boolean(style.italic);
    fontChanged = true;
  }
  if (style.underline != null) {
    font.underline = style.underline ? "single" : false;
    fontChanged = true;
  }
  if (style.size) {
    font.size = Number(style.size);
    fontChanged = true;
  }
  if (style.font) {
    font.name = String(style.font);
    fontChanged = true;
  }
  if (style.strike != null) {
    font.strike = Boolean(style.strike);
    fontChanged = true;
  }
  if (fontChanged) cell.font = font;
  if (style.fill || style.shade) {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${colourOrThrow(style.fill || style.shade, "Fill")}` },
    };
  }
  if (style.align || style.wrap != null || style.valign) {
    const next = { ...(cell.alignment ?? {}) };
    if (style.align) {
      const horizontal = EXCEL_ALIGN[String(style.align).toLowerCase()];
      if (!horizontal) throw new Error(`Alignment ${JSON.stringify(style.align)} must be left, center, right or justify.`);
      next.horizontal = horizontal;
    }
    if (style.wrap != null) next.wrapText = Boolean(style.wrap);
    if (style.valign) {
      const vertical = { top: "top", middle: "middle", center: "middle", centre: "middle", bottom: "bottom" }[
        String(style.valign).toLowerCase()
      ];
      if (!vertical) throw new Error(`Vertical alignment ${JSON.stringify(style.valign)} must be top, middle or bottom.`);
      next.vertical = vertical;
    }
    cell.alignment = next;
  }
  if (style.border) {
    const edge = { style: "thin", color: { argb: "FFBFBFBF" } };
    cell.border = { top: edge, left: edge, bottom: edge, right: edge };
  }
}
