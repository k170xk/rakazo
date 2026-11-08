/**
 * OCSC slides drawn as native PowerPoint objects: every title, bullet, card, number, chart and
 * table is a real text box, shape, chart or table the person can edit in PowerPoint, and photos
 * and generated pictures are placed as pictures beside them. Positions in a "custom" slide use
 * the same 1920x1080 grid as ocsc-video, so a bot can lay a slide out like a video frame.
 */
import { existsSync, readFileSync } from "node:fs";

export const GREEN = "76BF43";
export const INK = "1D2B36";
export const MUTED = "5B6770";
const TINT = "F3F7F0";
const LINE = "DDE3D8";
export const FONT = "Arial";
export const SLIDE_W = 13.333;
export const SLIDE_H = 7.5;
const LOGO = "/opt/ocsc-video/src/assets/ocsc-logo.png";
const LOGO_DARK = "/opt/ocsc-video/src/assets/ocsc-logo-on-dark.png";

export const LAYOUTS = [
  "title",
  "section",
  "bullets",
  "columns",
  "stats",
  "quote",
  "photo",
  "split",
  "gallery",
  "infographics",
  "chart",
  "table",
  "timeline",
  "motion",
  "custom",
];

const CHART_TYPES = {
  bar: "bar",
  column: "bar",
  line: "line",
  area: "area",
  pie: "pie",
  doughnut: "doughnut",
};

/** Inches from the 1920x1080 grid. */
const px = (value) => (Number(value) || 0) / 144;

const str = (value, max = 2000) =>
  typeof value === "string" || typeof value === "number"
    ? String(value)
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
        .slice(0, max)
    : "";

const list = (value, max) => (Array.isArray(value) ? value.slice(0, max) : []);

const hex = (value, fallback) => {
  const clean = str(value, 9).replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(clean) ? clean.toUpperCase() : fallback;
};

/** The layout a slide asks for, or the one its content implies; null for an unknown layout. */
export function layoutOf(slide) {
  if (LAYOUTS.includes(slide.layout)) return slide.layout;
  if (slide.layout) return null;
  if (Array.isArray(slide.elements)) return "custom";
  if (slide.chart) return "chart";
  if (Array.isArray(slide.rows)) return "table";
  if (Array.isArray(slide.steps)) return "timeline";
  if (Array.isArray(slide.images)) return "gallery";
  if (Array.isArray(slide.stats)) return "stats";
  if (Array.isArray(slide.columns)) return "columns";
  if (slide.quote) return "quote";
  if (Array.isArray(slide.bullets)) return slide.image ? "split" : "bullets";
  return "title";
}

/** A whole-slide picture from an older deck spec: an image with no layout and nothing else to draw. */
export function isPictureSlide(slide) {
  return (
    typeof slide === "string" ||
    (slide !== null &&
      typeof slide === "object" &&
      Boolean(slide.image) &&
      !slide.layout &&
      !slide.bullets &&
      !slide.columns &&
      !slide.stats &&
      !slide.quote &&
      !slide.text)
  );
}

/** Every picture a slide refers to, as `{ source, label }`, so they can be loaded up front. */
export function imageSources(slide, label) {
  const out = [];
  const add = (source, where) => {
    if (typeof source === "string" && source.trim())
      out.push({ source: source.trim(), label: `${label} ${where}` });
  };
  if (typeof slide === "string") {
    add(slide, "image");
    return out;
  }
  add(slide.image, "image");
  add(slide.background, "background");
  add(slide.poster, "poster");
  for (const [i, item] of list(slide.images, 6).entries())
    add(typeof item === "string" ? item : item?.image, `image ${i + 1}`);
  for (const [i, column] of list(slide.columns, 4).entries())
    add(column?.image, `column ${i + 1} image`);
  for (const [i, element] of list(slide.elements, 80).entries()) {
    if (element?.type === "image") add(element.image ?? element.src, `element ${i + 1}`);
    if (element?.type === "video") add(element.poster, `element ${i + 1} poster`);
  }
  return out;
}

/** Video files a slide plays, as `{ source, label }`. */
export function videoSources(slide, label) {
  const out = [];
  if (slide && typeof slide === "object") {
    if (typeof slide.video === "string") out.push({ source: slide.video, label: `${label} video` });
    for (const [i, element] of list(slide.elements, 80).entries())
      if (element?.type === "video" && typeof (element.video ?? element.src) === "string")
        out.push({ source: element.video ?? element.src, label: `${label} element ${i + 1}` });
  }
  return out;
}

function logo(dark) {
  const path = dark ? LOGO_DARK : LOGO;
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  return {
    data: `image/png;base64,${bytes.toString("base64")}`,
    ratio: bytes.readUInt32BE(16) / bytes.readUInt32BE(20),
  };
}

/** Builds slides onto a PptxGenJS deck. `images` maps a source string to `{bytes,type,width,height}`. */
export class SlideBuilder {
  constructor(pptx, meta, images, videos = new Map()) {
    this.pptx = pptx;
    this.meta = meta;
    this.images = images;
    this.videos = videos;
    this.logos = { light: logo(false), dark: logo(true) };
  }

  image(source) {
    return typeof source === "string" ? this.images.get(source.trim()) : undefined;
  }

  /** Places a picture in a box, cropped to fill it ("cover") or fitted inside it ("contain"). */
  picture(page, source, box, { fit = "cover", alt = "", rounded = false, transparency } = {}) {
    const img = this.image(source);
    if (!img) return false;
    page.addImage({
      data: `image/${img.type};base64,${img.bytes.toString("base64")}`,
      x: box.x,
      y: box.y,
      w: img.width / 100,
      h: img.height / 100,
      sizing: { type: fit === "contain" ? "contain" : "cover", w: box.w, h: box.h },
      altText: alt,
      ...(rounded ? { rounding: false } : {}),
      ...(transparency ? { transparency } : {}),
    });
    return true;
  }

  /** The green bar, logo, footer and slide number shared by every light slide. */
  chrome(page, { dark = false, footer = true, bar = true } = {}) {
    // On a company template the master already draws the footer, logo and page number.
    if (this.frame === "template") return;
    if (bar && !dark)
      page.addShape(this.pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: px(24),
        h: SLIDE_H,
        fill: { color: GREEN },
        line: { color: GREEN, width: 0 },
      });
    const mark = dark ? this.logos.dark : this.logos.light;
    const y = SLIDE_H - px(56) - 0.39;
    if (mark) {
      page.addImage({
        data: mark.data,
        x: px(140),
        y,
        h: 0.39,
        w: 0.39 * mark.ratio,
        altText: "OCSC",
      });
    } else {
      page.addText("OCSC", {
        x: px(140),
        y,
        w: 1.4,
        h: 0.39,
        fontFace: FONT,
        fontSize: 18,
        bold: true,
        color: dark ? "FFFFFF" : GREEN,
        margin: 0,
      });
    }
    const text = footer ? str(this.meta.footer || this.meta.title, 160) : "";
    if (text)
      page.addText(text, {
        x: px(140) + (mark ? 0.39 * mark.ratio : 1.4) + 0.25,
        y,
        w: 7.5,
        h: 0.39,
        fontFace: FONT,
        fontSize: 12,
        color: dark ? "E6EAEE" : MUTED,
        valign: "middle",
        margin: 0,
      });
    if (!dark)
      page.slideNumber = {
        x: SLIDE_W - px(140) - 0.6,
        y,
        w: 0.6,
        h: 0.39,
        fontFace: FONT,
        fontSize: 12,
        color: MUTED,
        align: "right",
        valign: "middle",
      };
  }

  /** The kicker, title and subtitle at the top of a light slide; returns where content starts. */
  heading(page, slide, { x = px(140), w = SLIDE_W - px(280), dark = false } = {}) {
    // The template's own heading placeholders hold the title; content starts below them.
    if (this.frame === "template") return 1.35;
    let y = px(110);
    const kicker = str(slide.kicker, 120);
    if (kicker) {
      page.addText(kicker.toUpperCase(), {
        x,
        y,
        w,
        h: 0.35,
        fontFace: FONT,
        fontSize: 14,
        bold: true,
        color: GREEN,
        charSpacing: 2,
        margin: 0,
      });
      y += 0.45;
    }
    const title = str(slide.title, 300);
    const size = title.length > 70 ? 26 : title.length > 45 ? 30 : 34;
    page.addText(title, {
      x,
      y,
      w,
      h: 1.0,
      fontFace: FONT,
      fontSize: size,
      bold: true,
      color: dark ? "FFFFFF" : INK,
      valign: "top",
      fit: "shrink",
      margin: 0,
    });
    y += title.length > 60 && w < 9 ? 1.15 : 0.95;
    const subtitle = str(slide.subtitle, 400);
    if (subtitle) {
      page.addText(subtitle, {
        x,
        y,
        w,
        h: 0.6,
        fontFace: FONT,
        fontSize: 17,
        color: dark ? "E6EAEE" : MUTED,
        valign: "top",
        fit: "shrink",
        margin: 0,
      });
      y += 0.65;
    }
    return y + 0.2;
  }

  bulletBox(page, items, box, size = 20) {
    const runs = [];
    for (const item of list(items, 8)) {
      const text = str(typeof item === "object" ? item?.text : item, 400);
      if (!text) continue;
      const level = typeof item === "object" && Number(item?.level) === 1 ? 1 : 0;
      runs.push({
        text,
        options: {
          bullet: level ? { indent: 18 } : { code: "25A0", indent: 22 },
          indentLevel: level,
          fontSize: level ? size - 3 : size,
          color: level ? MUTED : INK,
          breakLine: true,
          paraSpaceAfter: 10,
        },
      });
    }
    if (runs.length === 0) return;
    page.addText(runs, {
      ...box,
      fontFace: FONT,
      valign: "top",
      fit: "shrink",
      margin: 0,
      lineSpacingMultiple: 1.1,
    });
  }

  notes(page, slide) {
    const notes = str(slide.notes, 20000);
    if (notes) page.addNotes(notes);
  }

  add(slide, label) {
    const layout = layoutOf(slide);
    if (!layout) throw new Error(`${label}: layout must be one of ${LAYOUTS.join(", ")}.`);
    const page = this.pptx.addSlide();
    this.frame = slide.__frame;
    if (this.frame !== "template") page.background = { color: "FFFFFF" };
    this[`draw_${layout}`](page, slide, label);
    this.notes(page, slide);
    return page;
  }

  /** A whole-slide picture, as older decks were made; letterboxed on white when not 16:9. */
  addPicture(slide, label) {
    const source = typeof slide === "string" ? slide : slide.image;
    const img = this.image(source);
    if (!img) throw new Error(`${label}: the image could not be loaded.`);
    const page = this.pptx.addSlide();
    page.background = { color: "FFFFFF" };
    const aspect = img.width / img.height;
    const box =
      aspect >= SLIDE_W / SLIDE_H
        ? { x: 0, y: (SLIDE_H - SLIDE_W / aspect) / 2, w: SLIDE_W, h: SLIDE_W / aspect }
        : { x: (SLIDE_W - SLIDE_H * aspect) / 2, y: 0, w: SLIDE_H * aspect, h: SLIDE_H };
    page.addImage({
      data: `image/${img.type};base64,${img.bytes.toString("base64")}`,
      ...box,
      altText: str(slide.title, 300) || label,
    });
    if (typeof slide === "object") this.notes(page, slide);
    return { page, letterboxed: Math.abs(aspect - 16 / 9) > 0.01 };
  }

  /** A dark or green full-colour slide, optionally over a darkened photo. */
  hero(page, slide, colour) {
    page.background = { color: colour };
    if (
      this.picture(page, slide.image ?? slide.background, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H })
    ) {
      page.addShape(this.pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: SLIDE_W,
        h: SLIDE_H,
        fill: { color: colour, transparency: 25 },
        line: { color: colour, width: 0 },
      });
    }
  }

  draw_title(page, slide) {
    this.hero(page, slide, INK);
    const x = px(140);
    const w = SLIDE_W - px(420);
    let y = 1.9;
    const kicker = str(slide.kicker, 120);
    if (kicker) {
      page.addText(kicker.toUpperCase(), {
        x,
        y,
        w,
        h: 0.4,
        fontFace: FONT,
        fontSize: 15,
        bold: true,
        color: GREEN,
        charSpacing: 2,
        margin: 0,
      });
      y += 0.55;
    }
    const title = str(slide.title, 300);
    page.addText(title, {
      x,
      y,
      w,
      h: 2.0,
      fontFace: FONT,
      fontSize: title.length > 50 ? 40 : 50,
      bold: true,
      color: "FFFFFF",
      valign: "top",
      fit: "shrink",
      margin: 0,
    });
    y += 2.05;
    const subtitle = str(slide.subtitle, 400);
    if (subtitle) {
      page.addText(subtitle, {
        x,
        y,
        w,
        h: 0.8,
        fontFace: FONT,
        fontSize: 19,
        color: "E6EAEE",
        valign: "top",
        fit: "shrink",
        margin: 0,
      });
      y += 0.85;
    }
    page.addShape(this.pptx.ShapeType.rect, {
      x,
      y: y + 0.1,
      w: px(220),
      h: px(12),
      fill: { color: GREEN },
      line: { color: GREEN, width: 0 },
    });
    this.chrome(page, { dark: true, footer: false });
  }

  draw_section(page, slide) {
    this.hero(page, slide, GREEN);
    const x = px(140);
    const w = SLIDE_W - px(420);
    let y = 2.4;
    const kicker = str(slide.kicker, 120);
    if (kicker) {
      page.addText(kicker.toUpperCase(), {
        x,
        y,
        w,
        h: 0.4,
        fontFace: FONT,
        fontSize: 15,
        bold: true,
        color: INK,
        charSpacing: 2,
        margin: 0,
      });
      y += 0.55;
    }
    page.addText(str(slide.title, 300), {
      x,
      y,
      w,
      h: 1.6,
      fontFace: FONT,
      fontSize: 46,
      bold: true,
      color: "FFFFFF",
      valign: "top",
      fit: "shrink",
      margin: 0,
    });
    const subtitle = str(slide.subtitle, 400);
    if (subtitle)
      page.addText(subtitle, {
        x,
        y: y + 1.65,
        w,
        h: 0.8,
        fontFace: FONT,
        fontSize: 19,
        color: "FFFFFF",
        valign: "top",
        fit: "shrink",
        margin: 0,
      });
    this.chrome(page, { dark: true });
  }

  draw_bullets(page, slide) {
    const top = this.heading(page, slide);
    this.bulletBox(
      page,
      slide.bullets,
      {
        x: px(140),
        y: top + 0.15,
        w: SLIDE_W - px(280),
        h: SLIDE_H - top - 1.25,
      },
      21,
    );
    this.chrome(page);
  }

  draw_split(page, slide) {
    const right = slide.side !== "left";
    const imgW = SLIDE_W * 0.42;
    const textX = right ? px(140) : imgW + 0.6;
    const textW = SLIDE_W - imgW - px(140) - 0.6;
    this.picture(
      page,
      slide.image,
      { x: right ? SLIDE_W - imgW : 0, y: 0, w: imgW, h: SLIDE_H },
      {
        fit: slide.fit === "contain" ? "contain" : "cover",
        alt: str(slide.caption || slide.title, 300),
      },
    );
    const top = this.heading(page, slide, { x: textX, w: textW });
    const text = str(slide.text, 1500);
    let y = top + 0.1;
    if (text) {
      page.addText(text, {
        x: textX,
        y,
        w: textW,
        h: 1.3,
        fontFace: FONT,
        fontSize: 17,
        color: MUTED,
        valign: "top",
        fit: "shrink",
        margin: 0,
      });
      y += 1.35;
    }
    this.bulletBox(page, slide.bullets, { x: textX, y, w: textW, h: SLIDE_H - y - 1.2 }, 19);
    const caption = str(slide.caption, 200);
    if (caption)
      page.addText(caption, {
        x: right ? SLIDE_W - imgW : 0,
        y: SLIDE_H - 0.45,
        w: imgW,
        h: 0.45,
        fontFace: FONT,
        fontSize: 11,
        color: "FFFFFF",
        fill: { color: INK, transparency: 30 },
        margin: [0, 10, 0, 10],
        valign: "middle",
      });
    this.chrome(page, { bar: Boolean(right) });
  }

  draw_columns(page, slide) {
    const top = this.heading(page, slide);
    const columns = list(slide.columns, 4);
    const gap = 0.35;
    const total = SLIDE_W - px(280);
    const w = (total - gap * (columns.length - 1)) / Math.max(columns.length, 1);
    const h = SLIDE_H - top - 1.3;
    for (const [i, column] of columns.entries()) {
      const x = px(140) + i * (w + gap);
      page.addShape(this.pptx.ShapeType.roundRect, {
        x,
        y: top + 0.1,
        w,
        h,
        fill: { color: TINT },
        line: { color: TINT, width: 0 },
        rectRadius: 0.08,
      });
      page.addShape(this.pptx.ShapeType.rect, {
        x,
        y: top + 0.1,
        w,
        h: 0.07,
        fill: { color: GREEN },
        line: { color: GREEN, width: 0 },
      });
      let y = top + 0.35;
      if (
        this.picture(
          page,
          column?.image,
          { x: x + 0.25, y, w: w - 0.5, h: Math.min(1.6, h * 0.4) },
          {
            fit: column?.fit === "contain" ? "contain" : "cover",
            alt: str(column?.heading, 200),
          },
        )
      )
        y += Math.min(1.6, h * 0.4) + 0.2;
      page.addText(str(column?.heading ?? column?.title, 200), {
        x: x + 0.25,
        y,
        w: w - 0.5,
        h: 0.55,
        fontFace: FONT,
        fontSize: 19,
        bold: true,
        color: INK,
        valign: "top",
        fit: "shrink",
        margin: 0,
      });
      y += 0.6;
      const body = str(column?.text, 800);
      if (body) {
        page.addText(body, {
          x: x + 0.25,
          y,
          w: w - 0.5,
          h: 1.2,
          fontFace: FONT,
          fontSize: 14,
          color: MUTED,
          valign: "top",
          fit: "shrink",
          margin: 0,
        });
        y += 1.25;
      }
      this.bulletBox(
        page,
        column?.bullets,
        { x: x + 0.25, y, w: w - 0.5, h: Math.max(top + 0.1 + h - y - 0.2, 0.5) },
        14,
      );
    }
    this.chrome(page);
  }

  draw_stats(page, slide) {
    const top = this.heading(page, slide);
    const stats = list(slide.stats, 4);
    const gap = 0.45;
    const total = SLIDE_W - px(280);
    const w = (total - gap * (stats.length - 1)) / Math.max(stats.length, 1);
    const y = Math.max(top + 0.4, 3.0);
    for (const [i, stat] of stats.entries()) {
      const x = px(140) + i * (w + gap);
      page.addShape(this.pptx.ShapeType.rect, {
        x,
        y,
        w: px(10),
        h: 2.1,
        fill: { color: GREEN },
        line: { color: GREEN, width: 0 },
      });
      page.addText(str(stat?.value, 40), {
        x: x + 0.3,
        y,
        w: w - 0.3,
        h: 1.1,
        fontFace: FONT,
        fontSize: 54,
        bold: true,
        color: GREEN,
        valign: "top",
        fit: "shrink",
        margin: 0,
      });
      page.addText(str(stat?.label, 200), {
        x: x + 0.3,
        y: y + 1.15,
        w: w - 0.3,
        h: 0.95,
        fontFace: FONT,
        fontSize: 16,
        color: MUTED,
        valign: "top",
        fit: "shrink",
        margin: 0,
      });
    }
    this.chrome(page);
  }

  draw_quote(page, slide) {
    const hasImage = this.picture(
      page,
      slide.image,
      { x: SLIDE_W * 0.62, y: 0, w: SLIDE_W * 0.38, h: SLIDE_H },
      {
        alt: str(slide.by, 200),
      },
    );
    const w = hasImage ? SLIDE_W * 0.62 - px(140) - 0.5 : SLIDE_W - px(280);
    page.addText("\u201C", {
      x: px(140),
      y: 1.2,
      w: 1.5,
      h: 1.3,
      fontFace: FONT,
      fontSize: 120,
      bold: true,
      color: GREEN,
      margin: 0,
      valign: "top",
    });
    page.addText(str(slide.quote, 600), {
      x: px(140),
      y: 2.4,
      w,
      h: 2.6,
      fontFace: FONT,
      fontSize: 30,
      bold: true,
      color: INK,
      valign: "top",
      fit: "shrink",
      margin: 0,
    });
    const by = str(slide.by, 200);
    if (by)
      page.addText(by, {
        x: px(140),
        y: 5.1,
        w,
        h: 0.5,
        fontFace: FONT,
        fontSize: 17,
        color: MUTED,
        margin: 0,
      });
    this.chrome(page);
  }

  /** A full-bleed photo with an editable title band. */
  draw_photo(page, slide) {
    this.picture(
      page,
      slide.image,
      { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H },
      {
        fit: slide.fit === "contain" ? "contain" : "cover",
        alt: str(slide.caption || slide.title, 300),
      },
    );
    const title = str(slide.title, 200);
    const caption = str(slide.caption ?? slide.subtitle, 300);
    if (title || caption) {
      page.addShape(this.pptx.ShapeType.rect, {
        x: 0,
        y: SLIDE_H - 1.75,
        w: SLIDE_W,
        h: 1.75,
        fill: { color: INK, transparency: 20 },
        line: { color: INK, width: 0 },
      });
      page.addShape(this.pptx.ShapeType.rect, {
        x: 0,
        y: SLIDE_H - 1.75,
        w: px(24),
        h: 1.75,
        fill: { color: GREEN },
        line: { color: GREEN, width: 0 },
      });
      if (title)
        page.addText(title, {
          x: px(140),
          y: SLIDE_H - 1.6,
          w: SLIDE_W - px(280),
          h: 0.75,
          fontFace: FONT,
          fontSize: 28,
          bold: true,
          color: "FFFFFF",
          fit: "shrink",
          margin: 0,
        });
      if (caption)
        page.addText(caption, {
          x: px(140),
          y: SLIDE_H - 0.85,
          w: SLIDE_W - px(280),
          h: 0.55,
          fontFace: FONT,
          fontSize: 15,
          color: "E6EAEE",
          fit: "shrink",
          margin: 0,
        });
    }
  }

  /** Two to six pictures in a grid, each with an optional caption. */
  grid(page, slide, fit) {
    const top = this.heading(page, slide);
    const items = list(slide.images, 6).map((item) =>
      typeof item === "string" ? { image: item } : (item ?? {}),
    );
    const n = Math.max(items.length, 1);
    const cols = n <= 3 ? n : n === 4 ? 2 : 3;
    const rows = Math.ceil(n / cols);
    const gap = 0.3;
    const totalW = SLIDE_W - px(280);
    const totalH = SLIDE_H - top - 1.15;
    const w = (totalW - gap * (cols - 1)) / cols;
    const cellH = (totalH - gap * (rows - 1)) / rows;
    const captioned = items.some((item) => str(item.caption ?? item.title, 10));
    const h = captioned ? cellH - 0.45 : cellH;
    for (const [i, item] of items.entries()) {
      const x = px(140) + (i % cols) * (w + gap);
      const y = top + Math.floor(i / cols) * (cellH + gap);
      if (fit === "contain")
        page.addShape(this.pptx.ShapeType.rect, {
          x,
          y,
          w,
          h,
          fill: { color: "FFFFFF" },
          line: { color: LINE, width: 0.75 },
        });
      this.picture(
        page,
        item.image,
        fit === "contain" ? { x: x + 0.05, y: y + 0.05, w: w - 0.1, h: h - 0.1 } : { x, y, w, h },
        {
          fit: item.fit ?? fit,
          alt: str(item.caption ?? item.title, 300),
        },
      );
      const caption = str(item.caption ?? item.title, 200);
      if (caption)
        page.addText(caption, {
          x,
          y: y + h + 0.05,
          w,
          h: 0.4,
          fontFace: FONT,
          fontSize: 13,
          bold: fit === "contain",
          color: fit === "contain" ? INK : MUTED,
          align: fit === "contain" ? "center" : "left",
          valign: "top",
          fit: "shrink",
          margin: 0,
        });
    }
    this.chrome(page);
  }

  draw_gallery(page, slide) {
    this.grid(page, slide, "cover");
  }

  draw_infographics(page, slide) {
    this.grid(page, slide, "contain");
  }

  draw_chart(page, slide, label) {
    const chart = slide.chart ?? {};
    const type = CHART_TYPES[chart.type] ?? "bar";
    const categories = list(chart.categories ?? chart.labels, 40).map((c) => str(c, 80));
    const series = list(chart.series, 8)
      .map((s) => ({
        name: str(s?.name, 80) || "Series",
        labels: categories,
        values: list(s?.values ?? s?.data, 40).map((v) => Number(v) || 0),
      }))
      .filter((s) => s.values.length > 0);
    if (categories.length === 0 || series.length === 0)
      throw new Error(`${label}: a chart needs "categories" and "series": [{"name","values"}].`);
    const top = this.heading(page, slide);
    const side = str(slide.text, 800) || list(slide.bullets, 1).length > 0;
    const w = side ? (SLIDE_W - px(280)) * 0.62 : SLIDE_W - px(280);
    const palette = [GREEN, INK, "A3D47C", "5B6770", "2F7D32", "9AA5AE", "CFE8B8", "34495E"];
    const pie = type === "pie" || type === "doughnut";
    page.addChart(this.pptx.ChartType[type], series, {
      x: px(140),
      y: top,
      w,
      h: SLIDE_H - top - 1.1,
      barDir: chart.type === "bar" ? "bar" : "col",
      chartColors: pie ? palette.slice(0, categories.length) : palette.slice(0, series.length),
      showLegend: series.length > 1 || pie,
      legendPos: "b",
      legendFontFace: FONT,
      legendFontSize: 12,
      catAxisLabelFontFace: FONT,
      catAxisLabelFontSize: 12,
      catAxisLabelColor: MUTED,
      valAxisLabelFontFace: FONT,
      valAxisLabelFontSize: 11,
      valAxisLabelColor: MUTED,
      valAxisLabelFormatCode: str(chart.format, 40) || undefined,
      valGridLine: { color: LINE, size: 0.75 },
      showValue: chart.show_values === true || pie,
      dataLabelFontFace: FONT,
      dataLabelFontSize: 11,
      dataLabelColor: pie ? "FFFFFF" : INK,
      showPercent: pie && chart.show_values !== true,
      lineSize: 3,
      lineDataSymbolSize: 8,
      holeSize: 55,
    });
    if (side) {
      const x = px(140) + w + 0.4;
      const sw = SLIDE_W - px(140) - x;
      let y = top + 0.2;
      const text = str(slide.text, 800);
      if (text) {
        page.addText(text, {
          x,
          y,
          w: sw,
          h: 1.6,
          fontFace: FONT,
          fontSize: 16,
          color: MUTED,
          valign: "top",
          fit: "shrink",
          margin: 0,
        });
        y += 1.7;
      }
      this.bulletBox(page, slide.bullets, { x, y, w: sw, h: SLIDE_H - y - 1.2 }, 16);
    }
    this.chrome(page);
  }

  draw_table(page, slide) {
    const top = this.heading(page, slide);
    const header = list(slide.header, 10).map((h) => ({
      text: str(h, 120),
      options: { bold: true, color: "FFFFFF", fill: { color: INK } },
    }));
    const rows = list(slide.rows, 14).map((row, r) =>
      list(row, 10).map((cell) => ({
        text: str(cell, 300),
        options: { fill: { color: r % 2 ? "FFFFFF" : TINT } },
      })),
    );
    const data = header.length ? [header, ...rows] : rows;
    const count = Math.max(data.length, 1);
    const fontSize = count > 10 ? 11 : count > 7 ? 13 : 15;
    page.addTable(data, {
      x: px(140),
      y: top + 0.1,
      w: SLIDE_W - px(280),
      fontFace: FONT,
      fontSize,
      color: INK,
      border: { type: "solid", color: LINE, pt: 0.75 },
      margin: [4, 8, 4, 8],
      autoPage: false,
      rowH: Math.min(0.5, (SLIDE_H - top - 1.3) / count),
    });
    this.chrome(page);
  }

  /** Three to six steps as numbered chevrons with a short line each. */
  draw_timeline(page, slide) {
    const top = this.heading(page, slide);
    const steps = list(slide.steps, 6);
    const gap = 0.12;
    const total = SLIDE_W - px(280);
    const w = (total - gap * (steps.length - 1)) / Math.max(steps.length, 1);
    const y = Math.max(top + 0.3, 2.6);
    for (const [i, step] of steps.entries()) {
      const x = px(140) + i * (w + gap);
      page.addShape(i === 0 ? this.pptx.ShapeType.homePlate : this.pptx.ShapeType.chevron, {
        x,
        y,
        w,
        h: 0.9,
        fill: { color: i % 2 ? INK : GREEN },
        line: { color: "FFFFFF", width: 0 },
      });
      page.addText(str(step?.label, 40) || String(i + 1), {
        x: x + (i === 0 ? 0.15 : 0.45),
        y,
        w: w - 0.75,
        h: 0.9,
        fontFace: FONT,
        fontSize: 18,
        bold: true,
        color: "FFFFFF",
        valign: "middle",
        fit: "shrink",
        margin: 0,
      });
      page.addText(str(step?.title, 120), {
        x: x + 0.1,
        y: y + 1.1,
        w: w - 0.2,
        h: 0.6,
        fontFace: FONT,
        fontSize: 16,
        bold: true,
        color: INK,
        valign: "top",
        fit: "shrink",
        margin: 0,
      });
      page.addText(str(step?.text, 400), {
        x: x + 0.1,
        y: y + 1.7,
        w: w - 0.2,
        h: 1.9,
        fontFace: FONT,
        fontSize: 13,
        color: MUTED,
        valign: "top",
        fit: "shrink",
        margin: 0,
      });
    }
    this.chrome(page);
  }

  /** A full-slide video (for example an ocsc-video motion scene), with its poster frame. */
  draw_motion(page, slide, label) {
    const video = this.videos.get(str(slide.video, 2000).trim());
    const poster = this.image(slide.poster);
    if (!video || !poster)
      throw new Error(
        `${label}: a motion slide needs "video" (an .mp4) and "poster" (a PNG frame of it).`,
      );
    page.addMedia({
      type: "video",
      data: `video/mp4;base64,${video.toString("base64")}`,
      extn: "mp4",
      cover: `data:image/${poster.type};base64,${poster.bytes.toString("base64")}`,
      x: 0,
      y: 0,
      w: SLIDE_W,
      h: SLIDE_H,
    });
  }

  /** A slide laid out freely on the 1920x1080 grid, element by element. */
  draw_custom(page, slide, label) {
    const background = hex(slide.background_color, null);
    if (background) page.background = { color: background };
    if (slide.background)
      this.picture(page, slide.background, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H });
    for (const [i, el] of list(slide.elements, 80).entries()) {
      const where = `${label} element ${i + 1}`;
      const box = { x: px(el?.x), y: px(el?.y), w: px(el?.w ?? 400), h: px(el?.h ?? 100) };
      const fill = hex(el?.fill, null);
      const fillProps = fill
        ? { fill: { color: fill, transparency: Number(el?.transparency) || 0 } }
        : {};
      const lineColour = hex(el?.line, null);
      switch (el?.type) {
        case "text": {
          const runs = Array.isArray(el.runs)
            ? el.runs.map((run) => ({
                text: str(run?.text, 2000),
                options: {
                  bold: run?.bold === true,
                  italic: run?.italic === true,
                  color: hex(run?.color, undefined),
                  highlight: hex(run?.highlight, undefined),
                  fontSize: Number(run?.size) || undefined,
                  breakLine: run?.newline === true,
                },
              }))
            : str(el.text, 4000);
          page.addText(runs, {
            ...box,
            ...fillProps,
            fontFace: FONT,
            fontSize: Math.min(Math.max(Number(el.size) || 18, 6), 140),
            bold: el.bold === true,
            italic: el.italic === true,
            color: hex(el.color, INK),
            highlight: hex(el.highlight, undefined),
            align: ["left", "center", "right"].includes(el.align) ? el.align : "left",
            valign: ["top", "middle", "bottom"].includes(el.valign) ? el.valign : "top",
            bullet: el.bullets === true ? { code: "25A0", indent: 22 } : undefined,
            fit: "shrink",
            margin: Number.isFinite(Number(el.padding)) ? Number(el.padding) : 0,
            rotate: Number(el.rotate) || 0,
            charSpacing: Number(el.letter_spacing) || undefined,
            lineSpacingMultiple: Number(el.line_height) || undefined,
            ...(lineColour
              ? { line: { color: lineColour, width: Number(el.line_width) || 1 } }
              : {}),
          });
          break;
        }
        case "shape": {
          const shapes = {
            rect: "rect",
            rounded: "roundRect",
            ellipse: "ellipse",
            circle: "ellipse",
            triangle: "triangle",
            chevron: "chevron",
            arrow: "rightArrow",
            line: "line",
            hexagon: "hexagon",
            donut: "donut",
          };
          const name = shapes[el.shape] ?? "rect";
          page.addShape(this.pptx.ShapeType[name], {
            ...box,
            fill:
              name === "line"
                ? undefined
                : { color: fill ?? GREEN, transparency: Number(el.transparency) || 0 },
            line: {
              color: lineColour ?? (name === "line" ? GREEN : (fill ?? GREEN)),
              width: Number(el.line_width) || (name === "line" ? 2 : 0),
            },
            rectRadius: name === "roundRect" ? px(el.radius ?? 16) : undefined,
            rotate: Number(el.rotate) || 0,
            ...(el.shadow === true
              ? {
                  shadow: {
                    type: "outer",
                    blur: 6,
                    offset: 2,
                    angle: 90,
                    color: "000000",
                    opacity: 0.18,
                  },
                }
              : {}),
          });
          if (str(el.text, 10))
            page.addText(str(el.text, 1000), {
              ...box,
              fontFace: FONT,
              fontSize: Number(el.size) || 18,
              bold: el.bold === true,
              color: hex(el.color, "FFFFFF"),
              align: "center",
              valign: "middle",
              fit: "shrink",
              margin: 4,
            });
          break;
        }
        case "image":
          if (
            !this.picture(page, el.image ?? el.src, box, {
              fit: el.fit === "contain" ? "contain" : "cover",
              alt: str(el.alt, 300),
              transparency: Number(el.transparency) || 0,
            })
          )
            throw new Error(`${where}: the image could not be loaded.`);
          break;
        case "chart":
          this.draw_chart_in(page, el, box, where);
          break;
        case "table": {
          const header = list(el.header, 10).map((h) => ({
            text: str(h, 120),
            options: { bold: true, color: "FFFFFF", fill: { color: INK } },
          }));
          const rows = list(el.rows, 20).map((row, r) =>
            list(row, 10).map((cell) => ({
              text: str(cell, 300),
              options: { fill: { color: r % 2 ? "FFFFFF" : TINT } },
            })),
          );
          page.addTable(header.length ? [header, ...rows] : rows, {
            x: box.x,
            y: box.y,
            w: box.w,
            fontFace: FONT,
            fontSize: Number(el.size) || 13,
            color: INK,
            border: { type: "solid", color: LINE, pt: 0.75 },
            margin: [4, 8, 4, 8],
            autoPage: false,
          });
          break;
        }
        case "video": {
          const video = this.videos.get(str(el.video ?? el.src, 2000).trim());
          const poster = this.image(el.poster);
          if (!video || !poster)
            throw new Error(
              `${where}: a video needs "video" (an .mp4) and "poster" (a PNG frame).`,
            );
          page.addMedia({
            type: "video",
            data: `video/mp4;base64,${video.toString("base64")}`,
            extn: "mp4",
            cover: `data:image/${poster.type};base64,${poster.bytes.toString("base64")}`,
            ...box,
          });
          break;
        }
        default:
          throw new Error(`${where}: type must be text, shape, image, chart, table or video.`);
      }
    }
    if (slide.branded !== false)
      this.chrome(page, { dark: slide.dark === true, bar: slide.bar !== false });
  }

  draw_chart_in(page, el, box, where) {
    const type = CHART_TYPES[el.chart?.type ?? el.chart_type] ?? "bar";
    const chart = el.chart ?? el;
    const categories = list(chart.categories ?? chart.labels, 40).map((c) => str(c, 80));
    const series = list(chart.series, 8).map((s) => ({
      name: str(s?.name, 80) || "Series",
      labels: categories,
      values: list(s?.values ?? s?.data, 40).map((v) => Number(v) || 0),
    }));
    if (categories.length === 0 || series.length === 0)
      throw new Error(`${where}: a chart needs "categories" and "series".`);
    const pie = type === "pie" || type === "doughnut";
    const palette = [GREEN, INK, "A3D47C", "5B6770", "2F7D32", "9AA5AE", "CFE8B8", "34495E"];
    page.addChart(this.pptx.ChartType[type], series, {
      ...box,
      barDir: chart.type === "bar" ? "bar" : "col",
      chartColors: pie ? palette.slice(0, categories.length) : palette.slice(0, series.length),
      showLegend: series.length > 1 || pie,
      legendPos: "b",
      legendFontFace: FONT,
      catAxisLabelFontFace: FONT,
      valAxisLabelFontFace: FONT,
      valGridLine: { color: LINE, size: 0.75 },
      showValue: chart.show_values === true,
      showPercent: pie,
      holeSize: 55,
    });
  }
}
