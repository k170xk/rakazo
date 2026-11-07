/**
 * Draws PowerPoint slides as HTML from their XML: shapes, text with its formatting, pictures,
 * tables, simple charts, backgrounds, and the layout and master graphics behind them. Used for
 * the screen preview, PDF printing and `ocsc-pptx preview`, so text-based slides look as they
 * will in PowerPoint without needing PowerPoint. Positions are percentages of the slide and font
 * sizes are container-width units, so a slide draws the same at any size.
 */
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { attr, parseRels, relsPathOf, resolvePart, unesc } from "./pptx-package.mjs";

const PLAYWRIGHT = process.env.OCSC_PLAYWRIGHT_MODULE || "/app/node_modules/playwright/index.mjs";
process.env.PLAYWRIGHT_BROWSERS_PATH ||= "/ms-playwright";

const IMAGE_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
};
const FONT_FALLBACK = "'Liberation Sans',Arial,Helvetica,sans-serif";

const escHtml = (text) =>
  String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const first = (xml, tag) => {
  const open = new RegExp(`<${tag}\\b[^>]*\\/>|<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`).exec(
    xml ?? "",
  );
  return open ? open[0] : "";
};

/** Top-level children of a shape tree, in drawing order. */
function children(tree) {
  const out = [];
  const open = /<(p:sp|p:pic|p:graphicFrame|p:grpSp|p:cxnSp|mc:AlternateContent)\b[^>]*?(\/?)>/g;
  let match;
  while ((match = open.exec(tree))) {
    const [, tag, selfClosing] = match;
    const start = match.index;
    if (selfClosing) {
      out.push({ tag, xml: match[0] });
      continue;
    }
    const scan = new RegExp(`<${tag}\\b[^>]*?(\\/?)>|<\\/${tag}>`, "g");
    scan.lastIndex = open.lastIndex;
    let depth = 1;
    let m;
    while (depth > 0 && (m = scan.exec(tree))) {
      if (m[0].startsWith("</")) depth -= 1;
      else if (m[1] !== "/") depth += 1;
    }
    if (depth > 0) break;
    out.push({ tag, xml: tree.slice(start, scan.lastIndex) });
    open.lastIndex = scan.lastIndex;
  }
  return out;
}

function treeOf(xml) {
  const tree = /<p:spTree>([\s\S]*)<\/p:spTree>/.exec(xml ?? "");
  return tree ? tree[1] : "";
}

// ---------- colour ----------

function hsl(hex) {
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hex([h, s, l]) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, "0");
  };
  return `${f(0)}${f(8)}${f(4)}`;
}

class Theme {
  constructor(xml) {
    this.colours = {};
    const scheme = first(xml, "a:clrScheme");
    for (const name of [
      "dk1",
      "lt1",
      "dk2",
      "lt2",
      "accent1",
      "accent2",
      "accent3",
      "accent4",
      "accent5",
      "accent6",
      "hlink",
      "folHlink",
    ]) {
      const node = first(scheme, `a:${name}`);
      this.colours[name] =
        attr(first(node, "a:srgbClr"), "val") ||
        attr(first(node, "a:sysClr"), "lastClr") ||
        (name.startsWith("dk") ? "000000" : "FFFFFF");
    }
    this.major = attr(first(first(xml, "a:majorFont"), "a:latin"), "typeface") || "Calibri";
    this.minor = attr(first(first(xml, "a:minorFont"), "a:latin"), "typeface") || "Calibri";
  }

  /** CSS colour of a colour choice (srgbClr, schemeClr, sysClr, prstClr) with its modifiers. */
  colour(node, map = {}) {
    if (!node) return null;
    const pick =
      /<a:(srgbClr|schemeClr|sysClr|prstClr|scrgbClr)\b([^>]*?)(\/>|>([\s\S]*?)<\/a:\1>)/.exec(
        node,
      );
    if (!pick) return null;
    let value;
    const val = attr(pick[2], "val");
    if (pick[1] === "srgbClr") value = val;
    else if (pick[1] === "sysClr") value = attr(pick[2], "lastClr") || "000000";
    else if (pick[1] === "prstClr")
      value =
        {
          black: "000000",
          white: "FFFFFF",
          red: "FF0000",
          green: "00FF00",
          blue: "0000FF",
          gray: "808080",
        }[val] ?? "000000";
    else if (pick[1] === "schemeClr") {
      const alias =
        {
          bg1: map.bg1 ?? "lt1",
          tx1: map.tx1 ?? "dk1",
          bg2: map.bg2 ?? "lt2",
          tx2: map.tx2 ?? "dk2",
        }[val] ?? val;
      value = this.colours[alias] ?? "000000";
    } else value = "000000";
    if (!/^[0-9a-f]{6}$/i.test(value)) value = "000000";
    const mods = pick[4] ?? "";
    let alpha = 1;
    let [h, s, l] = hsl(value);
    for (const m of mods.matchAll(
      /<a:(lumMod|lumOff|tint|shade|alpha|satMod)\b[^>]*val="(\d+)"/g,
    )) {
      const v = Number(m[2]) / 100000;
      if (m[1] === "lumMod") l *= v;
      else if (m[1] === "lumOff") l += v;
      else if (m[1] === "tint") l = l + (1 - l) * (1 - v);
      else if (m[1] === "shade") l *= v;
      else if (m[1] === "satMod") s *= v;
      else if (m[1] === "alpha") alpha = v;
    }
    l = Math.max(0, Math.min(1, l));
    s = Math.max(0, Math.min(1, s));
    const rgb = hex([h, s, l]);
    return alpha < 1
      ? `rgba(${Number.parseInt(rgb.slice(0, 2), 16)},${Number.parseInt(rgb.slice(2, 4), 16)},${Number.parseInt(rgb.slice(4, 6), 16)},${alpha.toFixed(3)})`
      : `#${rgb}`;
  }

  font(face) {
    if (!face) return null;
    if (face === "+mj-lt") return this.major;
    if (face === "+mn-lt") return this.minor;
    return face;
  }
}

// ---------- package ----------

class Package {
  constructor(zip) {
    this.zip = zip;
    this.cache = new Map();
  }

  async text(part) {
    if (!this.cache.has(part))
      this.cache.set(part, (await this.zip.file(part)?.async("string")) ?? "");
    return this.cache.get(part);
  }

  async rels(part) {
    return parseRels(await this.text(relsPathOf(part)));
  }

  async related(part, type) {
    const rel = (await this.rels(part)).find((r) => r.type.endsWith(`/${type}`));
    return rel ? resolvePart(part, rel.target) : null;
  }

  async dataUrl(part, rid) {
    const rel = (await this.rels(part)).find((r) => r.id === rid);
    if (!rel || rel.external) return null;
    const target = resolvePart(part, rel.target);
    const ext = target.split(".").pop().toLowerCase();
    const type = IMAGE_TYPES[ext];
    if (!type) return null;
    const data = await this.zip.file(target)?.async("base64");
    return data ? `data:${type};base64,${data}` : null;
  }
}

// ---------- geometry ----------

function xfrmOf(xml) {
  const x = first(xml, "a:xfrm") || first(xml, "p:xfrm");
  if (!x) return null;
  const off = first(x, "a:off");
  const ext = first(x, "a:ext");
  if (!off || !ext) return null;
  const out = {
    x: Number(attr(off, "x")),
    y: Number(attr(off, "y")),
    w: Number(attr(ext, "cx")),
    h: Number(attr(ext, "cy")),
    rot: Number(attr(x, "rot")) / 60000 || 0,
    flipH: attr(x, "flipH") === "1",
    flipV: attr(x, "flipV") === "1",
  };
  const chOff = first(x, "a:chOff");
  const chExt = first(x, "a:chExt");
  if (chOff && chExt) {
    out.chX = Number(attr(chOff, "x"));
    out.chY = Number(attr(chOff, "y"));
    out.chW = Number(attr(chExt, "cx")) || 1;
    out.chH = Number(attr(chExt, "cy")) || 1;
  }
  return out;
}

function placeholderOf(xml) {
  const ph = /<p:ph\b[^>]*\/?>/.exec(xml)?.[0];
  if (!ph) return null;
  return { type: attr(ph, "type") || "body", idx: attr(ph, "idx") };
}

function matchPlaceholder(tree, ph) {
  const shapes = children(tree).filter((c) => c.tag === "p:sp");
  const same = (c, test) => {
    const other = placeholderOf(c.xml);
    return other && test(other);
  };
  const titleish = (t) => (t === "ctrTitle" ? "title" : t);
  return (
    shapes.find(
      (c) => ph.idx && same(c, (o) => o.idx === ph.idx && titleish(o.type) === titleish(ph.type)),
    ) ??
    shapes.find((c) => ph.idx && same(c, (o) => o.idx === ph.idx)) ??
    shapes.find((c) => same(c, (o) => titleish(o.type) === titleish(ph.type))) ??
    (ph.type === "subTitle" || ph.type === "obj"
      ? shapes.find((c) => same(c, (o) => o.type === "body"))
      : null)
  )?.xml;
}

const GEOMETRY = {
  ellipse: "border-radius:50%",
  triangle: "clip-path:polygon(50% 0,100% 100%,0 100%)",
  chevron: "clip-path:polygon(0 0,75% 0,100% 50%,75% 100%,0 100%,25% 50%)",
  homePlate: "clip-path:polygon(0 0,80% 0,100% 50%,80% 100%,0 100%)",
  rightArrow: "clip-path:polygon(0 25%,70% 25%,70% 0,100% 50%,70% 100%,70% 75%,0 75%)",
  leftArrow: "clip-path:polygon(30% 0,30% 25%,100% 25%,100% 75%,30% 75%,30% 100%,0 50%)",
  hexagon: "clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)",
  diamond: "clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)",
  parallelogram: "clip-path:polygon(25% 0,100% 0,75% 100%,0 100%)",
  pentagon: "clip-path:polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%)",
};

/** A custom shape's outline as an SVG path in a 0-1 box; arcs are drawn as straight lines. */
function customPath(geom, box) {
  const out = [];
  for (const p of geom.matchAll(/<a:path\b([^>]*)>([\s\S]*?)<\/a:path>/g)) {
    const w = Number(attr(`<x ${p[1]}>`, "w")) || box?.w || 1;
    const h = Number(attr(`<x ${p[1]}>`, "h")) || box?.h || 1;
    let d = "";
    for (const c of p[2].matchAll(
      /<a:(moveTo|lnTo|cubicBezTo|quadBezTo|arcTo|close)\b[^>]*?(?:\/>|>([\s\S]*?)<\/a:\1>)/g,
    )) {
      const pts = [...(c[2] ?? "").matchAll(/<a:pt x="(-?\d+)" y="(-?\d+)"/g)].map(
        (m) => `${(Number(m[1]) / w).toFixed(5)} ${(Number(m[2]) / h).toFixed(5)}`,
      );
      if (c[1] === "moveTo" && pts[0]) d += `M${pts[0]} `;
      else if (c[1] === "lnTo" && pts[0]) d += `L${pts[0]} `;
      else if (c[1] === "cubicBezTo" && pts.length === 3) d += `C${pts.join(" ")} `;
      else if (c[1] === "quadBezTo" && pts.length === 2) d += `Q${pts.join(" ")} `;
      else if (c[1] === "close") d += "Z ";
    }
    out.push(d.trim());
  }
  return out.join(" ");
}

const RECT_PATH = "M0 0 L1 0 L1 1 L0 1 Z";
const ELLIPSE_PATH = "M0 0.5 A0.5 0.5 0 1 0 1 0.5 A0.5 0.5 0 1 0 0 0.5 Z";

// ---------- slides ----------

class SlideRenderer {
  constructor(pkg, size, theme, map) {
    this.pkg = pkg;
    this.size = size;
    this.theme = theme;
    this.map = map;
    this.slideWidthPt = size.cx / 12700;
  }

  pct(v, of) {
    return `${((v / of) * 100).toFixed(4)}%`;
  }

  /** Font size in container units, from hundredths of a point. */
  fs(sz) {
    return `${((sz / 100 / this.slideWidthPt) * 100).toFixed(4)}cqw`;
  }

  emuLen(v) {
    return `${((v / this.size.cx) * 100).toFixed(4)}cqw`;
  }

  async background(slideXml, part, layout, master) {
    for (const [xml, owner] of [
      [slideXml, part],
      [layout.xml, layout.part],
      [master.xml, master.part],
    ]) {
      const bg = first(first(xml, "p:cSld"), "p:bg");
      if (!bg) continue;
      const pr = first(bg, "p:bgPr");
      if (pr) {
        const blip = first(pr, "a:blipFill");
        if (blip) {
          const url = await this.pkg.dataUrl(owner, attr(first(blip, "a:blip"), "r:embed"));
          if (url) return `background:url('${url}') center/cover no-repeat`;
        }
        const fill = first(pr, "a:solidFill");
        if (fill) return `background:${this.theme.colour(fill, this.map)}`;
        const grad = first(pr, "a:gradFill");
        if (grad) {
          const stops = [...grad.matchAll(/<a:gs\b[^>]*pos="(\d+)"[^>]*>([\s\S]*?)<\/a:gs>/g)].map(
            (g) => `${this.theme.colour(g[2], this.map)} ${Number(g[1]) / 1000}%`,
          );
          if (stops.length) return `background:linear-gradient(180deg,${stops.join(",")})`;
        }
      }
      const ref = first(bg, "p:bgRef");
      if (ref) {
        const colour = this.theme.colour(ref, this.map);
        if (colour) return `background:${colour}`;
      }
    }
    return "background:#fff";
  }

  /** Inherited text defaults for a placeholder: from the layout and master shapes, then the master's text styles. */
  inherited(ph, layout, master) {
    const chain = [];
    if (ph) {
      const fromLayout = matchPlaceholder(treeOf(layout.xml), ph);
      if (fromLayout) chain.push(fromLayout);
      const fromMaster = matchPlaceholder(treeOf(master.xml), ph);
      if (fromMaster) chain.push(fromMaster);
      const styles = first(master.xml, "p:txStyles");
      const style =
        ph.type === "title" || ph.type === "ctrTitle"
          ? first(styles, "p:titleStyle")
          : ["body", "subTitle", "obj"].includes(ph.type)
            ? first(styles, "p:bodyStyle")
            : first(styles, "p:otherStyle");
      if (style) chain.push(`<a:lstStyle>${style}</a:lstStyle>`);
    } else {
      const other = first(first(master.xml, "p:txStyles"), "p:otherStyle");
      if (other) chain.push(`<a:lstStyle>${other}</a:lstStyle>`);
    }
    return chain;
  }

  /** The first value found for a level's paragraph or run property, through the inheritance chain. */
  levelProps(own, chain, level) {
    const tag = `a:lvl${level + 1}pPr`;
    const out = [];
    for (const xml of [own, ...chain]) {
      const lst = first(xml, "a:lstStyle");
      const lvl = first(lst, tag);
      if (lvl) out.push(lvl);
    }
    return out;
  }

  async text(sp, chain) {
    const body = first(sp, "p:txBody") || first(sp, "a:txBody");
    if (!body || !/<a:t>/.test(body)) return "";
    const bodyPr = [first(body, "a:bodyPr"), ...chain.map((c) => first(c, "a:bodyPr"))].filter(
      Boolean,
    );
    const bp = (name, fallback) => {
      for (const b of bodyPr) {
        const v = attr(b, name);
        if (v !== "") return v;
      }
      return fallback;
    };
    const anchor =
      { t: "flex-start", ctr: "center", b: "flex-end" }[bp("anchor", "t")] ?? "flex-start";
    const ins = (name, d) => this.emuLen(Number(bp(name, String(d))));
    const vert = bp("vert", "");
    const autofit = bodyPr[0] ?? "";
    const scale = Number(attr(first(autofit, "a:normAutofit"), "fontScale")) / 100000 || 1;
    const shrink = /<a:normAutofit\b/.test(autofit);
    const wrap = bp("wrap", "square") !== "none";
    const paragraphs = [...body.matchAll(/<a:p>[\s\S]*?<\/a:p>|<a:p\/>/g)].map((m) => m[0]);
    const html = [];
    const counters = {};
    for (const para of paragraphs) {
      const pPr = first(para, "a:pPr");
      const level = Number(attr(pPr, "lvl")) || 0;
      const inheritedP = this.levelProps(body, chain, level);
      const pick = (name) => {
        for (const p of [pPr, ...inheritedP]) {
          const v = attr(/<a:(?:pPr|lvl\dpPr)\b[^>]*>/.exec(p)?.[0] ?? "", name);
          if (v !== "") return v;
        }
        return "";
      };
      const child = (name) => {
        for (const p of [pPr, ...inheritedP]) {
          const v = first(p, name);
          if (v) return v;
        }
        return "";
      };
      const defRPr = (name) => {
        for (const p of inheritedP) {
          const d = first(p, "a:defRPr");
          const v = attr(/<a:defRPr\b[^>]*>/.exec(d)?.[0] ?? "", name);
          if (v !== "") return v;
        }
        return "";
      };
      const defFill = () => {
        for (const p of inheritedP) {
          const fill = first(first(p, "a:defRPr"), "a:solidFill");
          if (fill) return this.theme.colour(fill, this.map);
        }
        return null;
      };
      const defFont = () => {
        for (const p of inheritedP) {
          const face = attr(first(first(p, "a:defRPr"), "a:latin"), "typeface");
          if (face) return this.theme.font(face);
        }
        return null;
      };
      const align =
        { l: "left", ctr: "center", r: "right", just: "justify", dist: "justify" }[pick("algn")] ??
        "left";
      const marL = Number(pick("marL")) || 0;
      const indent = Number(pick("indent")) || 0;
      const spacing = (tag) => {
        const node = first(child(tag), "a:spcPts");
        if (node)
          return `${((Number(attr(node, "val")) / 100 / this.slideWidthPt) * 100 * scale).toFixed(4)}cqw`;
        const pct = first(child(tag), "a:spcPct");
        if (pct) return `${Number(attr(pct, "val")) / 100000}em`;
        return "0";
      };
      const lnPct = first(child("a:lnSpc"), "a:spcPct");
      const lineHeight = lnPct ? (Number(attr(lnPct, "val")) / 100000) * 1.2 : 1.2;
      const firstRun = /<a:rPr\b[^>]*>/.exec(para)?.[0] ?? "";
      const baseSz =
        Number(attr(firstRun, "sz")) ||
        Number(attr(/<a:endParaRPr\b[^>]*>/.exec(para)?.[0] ?? "", "sz")) ||
        Number(defRPr("sz")) ||
        1800;
      let bullet = "";
      let buNone = false;
      let buChar = "";
      let buAuto = "";
      // The nearest level that says anything about bullets decides.
      for (const level of [pPr, ...inheritedP]) {
        if (/<a:buNone\b/.test(level)) {
          buNone = true;
          break;
        }
        buChar = first(level, "a:buChar");
        if (buChar) break;
        buAuto = first(level, "a:buAutoNum");
        if (buAuto) break;
      }
      if (!buNone && buChar) {
        const colour = this.theme.colour(child("a:buClr"), this.map);
        bullet = `<span style="display:inline-block;width:${this.emuLen(Math.abs(indent) || 228600)};margin-left:${this.emuLen(indent)};${colour ? `color:${colour};` : ""}">${escHtml(attr(buChar, "char") || "•")}</span>`;
      } else if (!buNone && buAuto) {
        counters[level] = (counters[level] ?? 0) + 1;
        bullet = `<span style="display:inline-block;width:${this.emuLen(Math.abs(indent) || 342900)};margin-left:${this.emuLen(indent)};">${counters[level]}.</span>`;
      }
      const runs = [];
      for (const piece of para.matchAll(
        /<a:(r|fld)\b[^>]*>[\s\S]*?<\/a:\1>|<a:br\b[^>]*\/>|<a:br\b[^>]*>[\s\S]*?<\/a:br>/g,
      )) {
        if (piece[0].startsWith("<a:br")) {
          runs.push("<br>");
          continue;
        }
        const rPr = first(piece[0], "a:rPr");
        const rTag = /<a:rPr\b[^>]*>/.exec(rPr)?.[0] ?? "";
        const t =
          /<a:fld\b[^>]*type="slidenum"/.test(piece[0]) && this.number
            ? String(this.number)
            : [...piece[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => unesc(m[1])).join("");
        if (!t) continue;
        const sz = Number(attr(rTag, "sz")) || Number(defRPr("sz")) || 1800;
        const bold = (attr(rTag, "b") || defRPr("b")) === "1";
        const italic = (attr(rTag, "i") || defRPr("i")) === "1";
        const under =
          (attr(rTag, "u") || defRPr("u")) && (attr(rTag, "u") || defRPr("u")) !== "none";
        const strike = (attr(rTag, "strike") || defRPr("strike")) === "sngStrike";
        const caps = (attr(rTag, "cap") || defRPr("cap")) === "all";
        const spc = Number(attr(rTag, "spc") || defRPr("spc")) || 0;
        const colour =
          this.theme.colour(first(rPr, "a:solidFill"), this.map) ??
          defFill() ??
          (this.map.tx1 === "lt1" ? "#fff" : "#000");
        const face =
          this.theme.font(attr(first(rPr, "a:latin"), "typeface")) ?? defFont() ?? this.theme.minor;
        const highlight = this.theme.colour(first(rPr, "a:highlight"), this.map);
        runs.push(
          `<span style="font-size:${this.fs(sz * scale)};font-family:'${escHtml(face)}',${FONT_FALLBACK};color:${colour};${bold ? "font-weight:700;" : ""}${italic ? "font-style:italic;" : ""}${under || strike ? `text-decoration:${under ? "underline" : ""} ${strike ? "line-through" : ""};` : ""}${caps ? "text-transform:uppercase;" : ""}${spc ? `letter-spacing:${this.fs(spc * scale)};` : ""}${highlight ? `background:${highlight};` : ""}">${escHtml(t).replace(/\n/g, "<br>")}</span>`,
        );
      }
      const empty = runs.length === 0;
      html.push(
        `<p style="margin:0;margin-top:${html.length === 0 ? "0" : spacing("a:spcBef")};margin-bottom:${spacing("a:spcAft")};padding-left:${this.emuLen(marL)};text-indent:0;text-align:${align};line-height:${lineHeight};font-size:${this.fs(baseSz * scale)};${empty ? `min-height:${lineHeight}em;` : ""}">${empty ? "" : bullet}${runs.join("")}</p>`,
      );
    }
    const pad = `padding:${ins("tIns", 45720)} ${ins("rIns", 91440)} ${ins("bIns", 45720)} ${ins("lIns", 91440)}`;
    const rotate =
      vert === "vert"
        ? "writing-mode:vertical-rl;"
        : vert === "vert270"
          ? "writing-mode:vertical-rl;transform:rotate(180deg);"
          : "";
    return `<div class="tx"${shrink && scale === 1 ? ' data-shrink="1"' : ""} style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:${anchor};${pad};${wrap ? "" : "white-space:nowrap;"}${rotate}">${html.join("")}</div>`;
  }

  fillOf(spPr, style) {
    const own = spPr.replace(/<a:ln\b[\s\S]*?<\/a:ln>|<a:ln\b[^>]*\/>/g, "");
    const solid = first(own, "a:solidFill");
    if (solid) return this.theme.colour(solid, this.map);
    const grad = first(own, "a:gradFill");
    if (grad) {
      const stops = [...grad.matchAll(/<a:gs\b[^>]*pos="(\d+)"[^>]*>([\s\S]*?)<\/a:gs>/g)].map(
        (g) => `${this.theme.colour(g[2], this.map)} ${Number(g[1]) / 1000}%`,
      );
      const ang = Number(attr(first(grad, "a:lin"), "ang")) / 60000 || 0;
      if (stops.length) return `linear-gradient(${ang + 90}deg,${stops.join(",")})`;
    }
    if (/<a:noFill\b/.test(own)) return "transparent";
    const ref = first(style, "a:fillRef");
    if (ref && attr(ref, "idx") !== "0") return this.theme.colour(ref, this.map);
    return "transparent";
  }

  lineOf(spPr, style) {
    const ln = first(spPr, "a:ln");
    if (/<a:noFill\b/.test(ln)) return "";
    const width = Number(attr(/<a:ln\b[^>]*>/.exec(ln)?.[0] ?? "", "w")) || 12700;
    const colour =
      this.theme.colour(first(ln, "a:solidFill"), this.map) ??
      (first(style, "a:lnRef") && attr(first(style, "a:lnRef"), "idx") !== "0"
        ? this.theme.colour(first(style, "a:lnRef"), this.map)
        : null);
    if (!colour) return "";
    return `${this.emuLen(width)} solid ${colour}`;
  }

  async shape(node, frame, layout, master, part) {
    const xml = node.xml;
    const ph = placeholderOf(xml);
    const chain = this.inherited(ph, layout, master);
    let box = xfrmOf(first(xml, "p:spPr") || first(xml, "p:grpSpPr") || xml);
    if (!box && ph) for (const c of chain) if ((box = xfrmOf(first(c, "p:spPr")))) break;
    if (!box) return "";
    const pos = frame(box);
    const style = first(xml, "p:style");
    const spPr = first(xml, "p:spPr");
    const geom = attr(first(spPr, "a:prstGeom"), "prst") || "rect";
    const fill = this.fillOf(spPr, style);
    const line = geom === "line" || node.tag === "p:cxnSp" ? "" : this.lineOf(spPr, style);
    const transform = `${pos.rot ? `rotate(${pos.rot}deg)` : ""}${pos.flipH ? " scaleX(-1)" : ""}${pos.flipV ? " scaleY(-1)" : ""}`;
    let radius = "";
    if (geom === "roundRect") {
      const adj =
        Number(/<a:gd\b[^>]*name="adj"[^>]*fmla="val (\d+)"/.exec(spPr)?.[1] ?? 16667) / 100000;
      radius = `border-radius:${this.emuLen(Math.min(box.w, box.h) * adj)};`;
    }
    const outer = `position:absolute;left:${pos.left};top:${pos.top};width:${pos.width};height:${pos.height};${transform ? `transform:${transform};` : ""}`;
    if (geom === "line" || node.tag === "p:cxnSp") {
      const ln = first(spPr, "a:ln");
      const colour =
        this.theme.colour(first(ln, "a:solidFill"), this.map) ??
        this.theme.colour(first(style, "a:lnRef"), this.map) ??
        "#000";
      const width = Number(attr(/<a:ln\b[^>]*>/.exec(ln)?.[0] ?? "", "w")) || 12700;
      return `<svg style="${outer}overflow:visible" viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="0" y1="${box.h ? 0 : 50}" x2="100" y2="${box.h ? 100 : 50}" stroke="${colour}" vector-effect="non-scaling-stroke" style="stroke-width:${this.emuLen(width)}"/></svg>`;
    }
    const text = await this.text(xml, chain);
    const custom = first(spPr, "a:custGeom");
    const blipFill = first(spPr.replace(/<a:ln\b[\s\S]*?<\/a:ln>/g, ""), "a:blipFill");
    if (custom || blipFill) {
      const d = custom
        ? customPath(custom, box) || RECT_PATH
        : geom === "ellipse"
          ? ELLIPSE_PATH
          : RECT_PATH;
      const id = `g${(this.ids = (this.ids ?? 0) + 1)}`;
      let paint = fill.startsWith("linear-gradient")
        ? (/#[0-9a-f]{6}|rgba?\([^)]*\)/i.exec(fill)?.[0] ?? "none")
        : fill === "transparent"
          ? "none"
          : fill;
      let defs = "";
      if (blipFill) {
        const url = await this.pkg.dataUrl(part, attr(first(blipFill, "a:blip"), "r:embed"));
        if (url) {
          defs = `<defs><pattern id="${id}" patternContentUnits="objectBoundingBox" width="1" height="1"><image href="${url}" width="1" height="1" preserveAspectRatio="none"/></pattern></defs>`;
          paint = `url(#${id})`;
        }
      }
      const ln = first(spPr, "a:ln");
      const stroke = line
        ? `stroke="${/solid (.*)$/.exec(line)?.[1] ?? "none"}" vector-effect="non-scaling-stroke" style="stroke-width:${this.emuLen(Number(attr(/<a:ln\b[^>]*>/.exec(ln)?.[0] ?? "", "w")) || 12700)}"`
        : "";
      return `<div style="${outer}"><svg style="position:absolute;inset:0;width:100%;height:100%;overflow:visible" viewBox="0 0 1 1" preserveAspectRatio="none">${defs}<path d="${d}" fill="${paint}" ${stroke}/></svg>${text}</div>`;
    }
    const shapeCss = `${GEOMETRY[geom] ?? ""};${radius}background:${fill};${line ? `border:${line};` : ""}`;
    return `<div style="${outer}"><div style="position:absolute;inset:0;box-sizing:border-box;${shapeCss}"></div>${text}</div>`;
  }

  async picture(node, frame, part, layout, master) {
    const xml = node.xml;
    let box = xfrmOf(first(xml, "p:spPr"));
    const ph = placeholderOf(xml);
    let shapeSource = first(xml, "p:spPr");
    if (ph && layout) {
      for (const tree of [treeOf(layout.xml), treeOf(master?.xml)]) {
        const inherited = matchPlaceholder(tree, ph);
        if (!inherited) continue;
        box ??= xfrmOf(first(inherited, "p:spPr"));
        if (!/<a:(prstGeom|custGeom)\b/.test(shapeSource)) shapeSource = first(inherited, "p:spPr");
        if (box) break;
      }
    }
    if (!box) return "";
    const pos = frame(box);
    const blip = first(xml, "a:blip");
    const url = await this.pkg.dataUrl(part, attr(blip, "r:embed"));
    const crop = first(first(xml, "p:blipFill"), "a:srcRect");
    const l = Number(attr(crop, "l")) / 100000 || 0;
    const t = Number(attr(crop, "t")) / 100000 || 0;
    const r = Number(attr(crop, "r")) / 100000 || 0;
    const b = Number(attr(crop, "b")) / 100000 || 0;
    const w = 1 - l - r || 1;
    const h = 1 - t - b || 1;
    const alpha = Number(attr(first(blip, "a:alphaModFix"), "amt")) / 100000;
    const ellipse = attr(first(shapeSource, "a:prstGeom"), "prst") === "ellipse";
    const custom = first(shapeSource, "a:custGeom");
    let clip = "";
    let clipDefs = "";
    if (custom) {
      const id = `c${(this.ids = (this.ids ?? 0) + 1)}`;
      clipDefs = `<svg width="0" height="0" style="position:absolute"><clipPath id="${id}" clipPathUnits="objectBoundingBox"><path d="${customPath(custom, box)}"/></clipPath></svg>`;
      clip = `clip-path:url(#${id});`;
    }
    const video = /<a:videoFile\b|<p14:media\b/.test(xml);
    const transform = `${pos.rot ? `rotate(${pos.rot}deg)` : ""}${pos.flipH ? " scaleX(-1)" : ""}${pos.flipV ? " scaleY(-1)" : ""}`;
    const image = url
      ? `<img alt="" src="${url}" style="position:absolute;left:${(-l / w) * 100}%;top:${(-t / h) * 100}%;width:${100 / w}%;height:${100 / h}%;max-width:none;${alpha ? `opacity:${alpha};` : ""}">`
      : '<div style="position:absolute;inset:0;background:#eef1f3"></div>';
    const play = video
      ? '<div style="position:absolute;left:50%;top:50%;width:8cqw;height:8cqw;margin:-4cqw 0 0 -4cqw;border-radius:50%;background:rgba(0,0,0,.55)"><div style="position:absolute;left:38%;top:28%;border-left:3cqw solid #fff;border-top:1.8cqw solid transparent;border-bottom:1.8cqw solid transparent"></div></div>'
      : "";
    return `${clipDefs}<div style="position:absolute;left:${pos.left};top:${pos.top};width:${pos.width};height:${pos.height};overflow:hidden;${ellipse ? "border-radius:50%;" : ""}${clip}${transform ? `transform:${transform};` : ""}">${image}${play}</div>`;
  }

  async table(xml, pos) {
    const tbl = first(xml, "a:tbl");
    const cols = [...tbl.matchAll(/<a:gridCol\b[^>]*w="(\d+)"/g)].map((m) => Number(m[1]));
    const total = cols.reduce((a, b) => a + b, 0) || 1;
    const rows = [...tbl.matchAll(/<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g)].map((tr) => {
      const h = Number(attr(/<a:tr\b[^>]*>/.exec(tr[0])[0], "h"));
      const cells = [...tr[0].matchAll(/<a:tc\b[^>]*>[\s\S]*?<\/a:tc>|<a:tc\b[^>]*\/>/g)];
      return { h, cells };
    });
    const html = [];
    for (const row of rows) {
      const cells = [];
      for (const cell of row.cells) {
        const tag = /<a:tc\b[^>]*>/.exec(cell[0])?.[0] ?? "";
        if (attr(tag, "hMerge") === "1" || attr(tag, "vMerge") === "1") continue;
        const tcPr = first(cell[0], "a:tcPr");
        const fill = this.theme.colour(
          first(tcPr.replace(/<a:ln[A-Za-z]*\b[\s\S]*?<\/a:ln[A-Za-z]*>/g, ""), "a:solidFill"),
          this.map,
        );
        const border =
          this.theme.colour(first(first(tcPr, "a:lnB"), "a:solidFill"), this.map) ?? "#ccc";
        const span = Number(attr(tag, "gridSpan")) || 1;
        const rowSpan = Number(attr(tag, "rowSpan")) || 1;
        const text = await this.text(
          cell[0].replace(/<a:txBody>/, "<p:txBody>").replace(/<\/a:txBody>/, "</p:txBody>"),
          [],
        );
        cells.push(
          `<td${span > 1 ? ` colspan="${span}"` : ""}${rowSpan > 1 ? ` rowspan="${rowSpan}"` : ""} style="position:relative;border:1px solid ${border};${fill ? `background:${fill};` : ""}vertical-align:top;padding:0;height:${this.emuLen(row.h)}"><div style="position:relative;min-height:${this.emuLen(row.h)}">${text.replace("position:absolute;inset:0;", "position:relative;").replace("overflow:hidden;", "")}</div></td>`,
        );
      }
      html.push(`<tr>${cells.join("")}</tr>`);
    }
    return `<table style="position:absolute;left:${pos.left};top:${pos.top};width:${pos.width};border-collapse:collapse;table-layout:fixed"><colgroup>${cols.map((c) => `<col style="width:${(c / total) * 100}%">`).join("")}</colgroup>${html.join("")}</table>`;
  }

  async chart(xml, pos, part) {
    const rid = attr(first(xml, "c:chart"), "r:id");
    const rel = (await this.pkg.rels(part)).find((r) => r.id === rid);
    if (!rel) return "";
    const chart = await this.pkg.text(resolvePart(part, rel.target));
    const plot = first(chart, "c:plotArea");
    const kind = /<c:(barChart|bar3DChart)\b/.test(plot)
      ? "bar"
      : /<c:(lineChart|line3DChart)\b/.test(plot)
        ? "line"
        : /<c:(areaChart|area3DChart)\b/.test(plot)
          ? "area"
          : /<c:doughnutChart\b/.test(plot)
            ? "doughnut"
            : /<c:(pieChart|pie3DChart)\b/.test(plot)
              ? "pie"
              : "bar";
    const horizontal = attr(first(plot, "c:barDir"), "val") === "bar";
    const palette = ["#76BF43", "#1D2B36", "#A3D47C", "#5B6770", "#2F7D32", "#9AA5AE"];
    const series = [...plot.matchAll(/<c:ser>[\s\S]*?<\/c:ser>/g)].map((s, i) => {
      const values = [
        ...first(first(s[0], "c:val"), "c:numCache").matchAll(
          /<c:pt\b[^>]*idx="(\d+)"[^>]*>\s*<c:v>([^<]*)<\/c:v>/g,
        ),
      ].map((m) => Number(m[2]) || 0);
      const cats = [...first(s[0], "c:cat").matchAll(/<c:pt\b[^>]*>\s*<c:v>([^<]*)<\/c:v>/g)].map(
        (m) => unesc(m[1]),
      );
      const name = unesc(/<c:tx>[\s\S]*?<c:v>([^<]*)<\/c:v>/.exec(s[0])?.[1] ?? `Series ${i + 1}`);
      const colour =
        this.theme.colour(first(first(s[0], "c:spPr"), "a:solidFill"), this.map) ??
        palette[i % palette.length];
      const points = [...s[0].matchAll(/<c:dPt>[\s\S]*?<\/c:dPt>/g)].map((d) =>
        this.theme.colour(first(d[0], "a:solidFill"), this.map),
      );
      return { values, cats, name, colour, points };
    });
    if (series.length === 0) return "";
    const W = 1000;
    const H =
      Math.round(
        ((W * Number.parseFloat(pos.height)) / Number.parseFloat(pos.width)) *
          (this.size.cy / this.size.cx),
      ) || 560;
    const svg = [];
    const text = (x, y, t, anchor = "middle", size = 22, colour = "#5B6770") =>
      `<text x="${x}" y="${y}" font-size="${size}" fill="${colour}" text-anchor="${anchor}" font-family="Arial">${escHtml(t)}</text>`;
    if (kind === "pie" || kind === "doughnut") {
      const s = series[0];
      const sum = s.values.reduce((a, b) => a + b, 0) || 1;
      const cx = W / 2;
      const cy = H / 2 - 20;
      const r = Math.min(W, H) / 2 - 60;
      let angle = -Math.PI / 2;
      for (const [i, v] of s.values.entries()) {
        const a2 = angle + (v / sum) * Math.PI * 2;
        const large = a2 - angle > Math.PI ? 1 : 0;
        const colour = s.points[i] ?? palette[i % palette.length];
        svg.push(
          `<path d="M${cx},${cy} L${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a2)},${cy + r * Math.sin(a2)} Z" fill="${colour}" stroke="#fff" stroke-width="3"/>`,
        );
        angle = a2;
      }
      if (kind === "doughnut")
        svg.push(`<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="#fff"/>`);
      svg.push(
        s.cats
          .map(
            (c, i) =>
              `<rect x="${40 + (i % 4) * 240}" y="${H - 40 + Math.floor(i / 4) * 30}" width="18" height="18" fill="${s.points[i] ?? palette[i % palette.length]}"/>${text(66 + (i % 4) * 240, H - 25 + Math.floor(i / 4) * 30, c, "start", 18)}`,
          )
          .join(""),
      );
    } else {
      const cats = series[0].cats;
      const max = Math.max(1, ...series.flatMap((s) => s.values));
      const left = 80;
      const bottom = H - 70;
      const top = 20;
      const right = W - 20;
      for (let g = 0; g <= 4; g += 1) {
        const y = bottom - ((bottom - top) * g) / 4;
        svg.push(
          `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="#DDE3D8"/>${text(left - 10, y + 7, String(Math.round(((max * g) / 4) * 100) / 100), "end", 18)}`,
        );
      }
      const slot = (right - left) / Math.max(cats.length, 1);
      if (kind === "bar" && !horizontal) {
        const bw = (slot * 0.7) / series.length;
        for (const [si, s] of series.entries())
          for (const [i, v] of s.values.entries()) {
            const h = ((bottom - top) * v) / max;
            svg.push(
              `<rect x="${left + i * slot + slot * 0.15 + si * bw}" y="${bottom - h}" width="${bw}" height="${h}" fill="${s.points[i] ?? s.colour}"/>`,
            );
          }
      } else if (kind === "bar") {
        const rowH = (bottom - top) / Math.max(cats.length, 1);
        const bh = (rowH * 0.7) / series.length;
        for (const [si, s] of series.entries())
          for (const [i, v] of s.values.entries())
            svg.push(
              `<rect x="${left}" y="${top + i * rowH + rowH * 0.15 + si * bh}" width="${((right - left) * v) / max}" height="${bh}" fill="${s.colour}"/>`,
            );
      } else {
        for (const s of series) {
          const pts = s.values.map(
            (v, i) => `${left + i * slot + slot / 2},${bottom - ((bottom - top) * v) / max}`,
          );
          if (kind === "area")
            svg.push(
              `<polygon points="${left + slot / 2},${bottom} ${pts.join(" ")} ${left + (s.values.length - 1) * slot + slot / 2},${bottom}" fill="${s.colour}" opacity=".6"/>`,
            );
          svg.push(
            `<polyline points="${pts.join(" ")}" fill="none" stroke="${s.colour}" stroke-width="5"/>`,
          );
        }
      }
      if (!horizontal)
        for (const [i, c] of cats.entries())
          svg.push(text(left + i * slot + slot / 2, bottom + 30, c, "middle", 18));
      if (series.length > 1)
        svg.push(
          series
            .map(
              (s, i) =>
                `<rect x="${left + i * 220}" y="${H - 28}" width="18" height="18" fill="${s.colour}"/>${text(left + 26 + i * 220, H - 13, s.name, "start", 18)}`,
            )
            .join(""),
        );
    }
    return `<svg style="position:absolute;left:${pos.left};top:${pos.top};width:${pos.width};height:${pos.height}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${svg.join("")}</svg>`;
  }

  async node(node, frame, layout, master, part) {
    if (node.tag === "mc:AlternateContent") {
      const choice =
        /<mc:Fallback>([\s\S]*?)<\/mc:Fallback>/.exec(node.xml)?.[1] ??
        /<mc:Choice\b[^>]*>([\s\S]*?)<\/mc:Choice>/.exec(node.xml)?.[1] ??
        "";
      const out = [];
      for (const child of children(choice))
        out.push(await this.node(child, frame, layout, master, part));
      return out.join("");
    }
    if (node.tag === "p:sp" || node.tag === "p:cxnSp")
      return this.shape(node, frame, layout, master, part);
    if (node.tag === "p:pic") return this.picture(node, frame, part, layout, master);
    if (node.tag === "p:graphicFrame") {
      const box = xfrmOf(node.xml);
      if (!box) return "";
      const pos = frame(box);
      if (/<a:tbl>/.test(node.xml)) return this.table(node.xml, pos);
      if (/<c:chart\b/.test(node.xml)) return this.chart(node.xml, pos, part);
      return `<div style="position:absolute;left:${pos.left};top:${pos.top};width:${pos.width};height:${pos.height};background:#f3f5f7;border:1px dashed #c8ced3"></div>`;
    }
    if (node.tag === "p:grpSp") {
      const g = xfrmOf(first(node.xml, "p:grpSpPr"));
      const inner = node.xml.replace(/^<p:grpSp\b[^>]*>/, "").replace(/<\/p:grpSp>$/, "");
      const out = [];
      const childFrame = g?.chW
        ? (b) =>
            frame({
              ...b,
              x: g.x + ((b.x - g.chX) * g.w) / g.chW,
              y: g.y + ((b.y - g.chY) * g.h) / g.chH,
              w: (b.w * g.w) / g.chW,
              h: (b.h * g.h) / g.chH,
            })
        : frame;
      for (const child of children(inner))
        out.push(await this.node(child, childFrame, layout, master, part));
      return out.join("");
    }
    return "";
  }

  /** The decorative shapes of a layout or master: everything that is not a placeholder. */
  async decorations(owner, layout, master, frame) {
    const out = [];
    for (const child of children(treeOf(owner.xml))) {
      if (child.tag === "p:sp" && placeholderOf(child.xml)) continue;
      out.push(await this.node(child, frame, layout, master, owner.part));
    }
    return out.join("");
  }

  async slide(part, number = null) {
    this.number = number;
    const xml = await this.pkg.text(part);
    const layoutPart = await this.pkg.related(part, "slideLayout");
    const layout = { part: layoutPart, xml: layoutPart ? await this.pkg.text(layoutPart) : "" };
    const masterPart = layoutPart ? await this.pkg.related(layoutPart, "slideMaster") : null;
    const master = { part: masterPart, xml: masterPart ? await this.pkg.text(masterPart) : "" };
    const frame = (b) => ({
      left: this.pct(b.x, this.size.cx),
      top: this.pct(b.y, this.size.cy),
      width: this.pct(b.w, this.size.cx),
      height: this.pct(b.h, this.size.cy),
      rot: b.rot,
      flipH: b.flipH,
      flipV: b.flipV,
    });
    const background = await this.background(xml, part, layout, master);
    const showMaster = !/<p:sld\b[^>]*showMasterSp="0"/.test(xml);
    const showLayoutMaster = !/<p:sldLayout\b[^>]*showMasterSp="0"/.test(layout.xml);
    let html = "";
    if (showMaster && showLayoutMaster && master.part)
      html += await this.decorations(master, layout, master, frame);
    if (showMaster && layout.part) html += await this.decorations(layout, layout, master, frame);
    for (const child of children(treeOf(xml)))
      html += await this.node(child, frame, layout, master, part);
    return { background, html };
  }
}

const SHRINK_SCRIPT = `<script>
(function(){
  function fit(){
    document.querySelectorAll('[data-shrink]').forEach(function(box){
      var scale=1;
      var spans=box.querySelectorAll('span,p');
      var base=[];spans.forEach(function(s){base.push(parseFloat(s.style.fontSize)||0)});
      while(box.scrollHeight>box.clientHeight+1&&scale>0.35){
        scale-=0.05;
        spans.forEach(function(s,i){if(base[i])s.style.fontSize=(base[i]*scale).toFixed(4)+'cqw'});
      }
    });
    document.body.dataset.ready="1";
  }
  var imgs=[].slice.call(document.images).map(function(i){return i.complete?null:new Promise(function(r){i.onload=i.onerror=r})});
  Promise.all(imgs.concat([document.fonts?document.fonts.ready:null])).then(fit);
})();
</script>`;

const SLIDE_STYLE = `<style>.ob-slide{container-type:inline-size}.ob-slide .stage{position:absolute;inset:0;overflow:hidden}.ob-slide .stage p{word-wrap:break-word}</style>`;

async function load(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const pkg = new Package(zip);
  const presentation = await pkg.text("ppt/presentation.xml");
  if (!presentation) throw new Error("this is not a PowerPoint (.pptx) file.");
  const size = /<p:sldSz\b[^>]*\/>/.exec(presentation)?.[0] ?? "";
  const dims = {
    cx: Number(attr(size, "cx")) || 12192000,
    cy: Number(attr(size, "cy")) || 6858000,
  };
  const presRels = await pkg.rels("ppt/presentation.xml");
  const parts = [];
  for (const id of presentation.matchAll(/<p:sldId\b[^>]*\/>/g)) {
    const rel = presRels.find((r) => r.id === attr(id[0], "r:id"));
    if (rel) parts.push(resolvePart("ppt/presentation.xml", rel.target));
  }
  const masterRel = presRels.find((r) => r.type.endsWith("/slideMaster"));
  const masterPart = masterRel ? resolvePart("ppt/presentation.xml", masterRel.target) : null;
  const themePart = masterPart ? await pkg.related(masterPart, "theme") : null;
  const theme = new Theme(themePart ? await pkg.text(themePart) : "");
  const clrMap =
    /<p:clrMap\b[^>]*\/>/.exec(masterPart ? await pkg.text(masterPart) : "")?.[0] ?? "";
  const map = {
    bg1: attr(clrMap, "bg1") || "lt1",
    tx1: attr(clrMap, "tx1") || "dk1",
    bg2: attr(clrMap, "bg2") || "lt2",
    tx2: attr(clrMap, "tx2") || "dk2",
  };
  return { renderer: new SlideRenderer(pkg, dims, theme, map), parts, dims };
}

/** The deck as preview HTML for screen.mjs: `{ body, script, ready, note }`. */
export async function renderDeckHtml(bytes) {
  const { renderer, parts, dims } = await load(bytes);
  const slides = [];
  for (const [i, part] of parts.entries()) {
    const { background, html } = await renderer.slide(part, i + 1);
    slides.push(
      `<div class="ob-slide" style="aspect-ratio:${dims.cx}/${dims.cy};${background}"><div class="stage">${html}</div><span class="num">${i + 1}</span></div>`,
    );
  }
  const ratio = dims.cx / dims.cy;
  return {
    body:
      SLIDE_STYLE +
      (slides.join("") || '<div class="ob-error">This presentation has no slides.</div>'),
    script: SHRINK_SCRIPT,
    ready: false,
    note: `${parts.length} slide${parts.length === 1 ? "" : "s"}, ${Math.abs(ratio - 16 / 9) < 0.01 ? "16:9" : Math.abs(ratio - 4 / 3) < 0.01 ? "4:3" : "custom size"}.`,
  };
}

/** PNGs of the slides at 1920 pixels wide, as a Map of slide number to bytes. */
export async function renderDeckPngs(bytes, only = null) {
  const { renderer, parts, dims } = await load(bytes);
  if (only !== null && (!Number.isInteger(only) || only < 1 || only > parts.length))
    throw new Error(`--slide must be a slide number from 1 to ${parts.length}.`);
  let chromium;
  try {
    ({ chromium } = await import(pathToFileURL(PLAYWRIGHT).href));
  } catch (error) {
    throw new Error(`The slide renderer is not available on this computer (${error.message}).`);
  }
  const width = 1920;
  const height = Math.round((width * dims.cy) / dims.cx);
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.OCSC_CHROMIUM ? { executablePath: process.env.OCSC_CHROMIUM } : {}),
  });
  const out = new Map();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    for (const [i, part] of parts.entries()) {
      if (only !== null && i + 1 !== only) continue;
      const { background, html } = await renderer.slide(part, i + 1);
      const pageHtml = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}.ob-slide{position:relative;width:${width}px;height:${height}px}</style>${SLIDE_STYLE}</head><body><div class="ob-slide" style="${background}"><div class="stage">${html}</div></div>${SHRINK_SCRIPT}</body></html>`;
      await page.setContent(pageHtml, { waitUntil: "load", timeout: 60_000 });
      await page.evaluate(
        () =>
          new Promise((done) => {
            const started = Date.now();
            const tick = () =>
              document.body.dataset.ready === "1" || Date.now() - started > 20_000
                ? done()
                : setTimeout(tick, 50);
            tick();
          }),
      );
      out.set(i + 1, await page.screenshot({ type: "png", timeout: 15_000 }));
    }
  } finally {
    // Chromium on the computer can hang while closing; the screenshots are already taken.
    await Promise.race([
      browser.close().catch(() => {}),
      new Promise((done) => setTimeout(done, 3000)),
    ]);
  }
  return out;
}
