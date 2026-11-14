import type { SlideData, SlideLayoutData, SlideShapeData } from "@office-kit/pptx";
import {
  addSlideAt,
  addSlideImage,
  addSlideLine,
  addSlideShape,
  addSlideTextBox,
  asColor,
  bringShapeForward,
  bringShapeToFront,
  emu,
  getParagraphAlignment,
  getParagraphBullet,
  getShapeFillColor,
  getShapeRunFormatEffective,
  getShapeStrokeColor,
  getSlideLayoutName,
  getSlideLayouts,
  getSlides,
  removeShape,
  sendShapeBackward,
  sendShapeToBack,
  setShapeAlignment,
  setShapeBulletStyle,
  setShapeFill,
  setShapeNoFill,
  setShapeNoStroke,
  setShapeStroke,
  setShapeStrokeArrow,
  setShapeTextFormat,
} from "@office-kit/pptx";
import { stepFontSize } from "../ribbon/FontSizeInput";
import type { Box, Deck } from "./deck";
import { setShapeBox, shapeBox } from "./deck";

export type InsertShape = "rect" | "roundRect" | "ellipse" | "line" | "arrow";
export type Arrange = "forward" | "backward" | "front" | "back";
export type SlideAlign = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type TextAlign = "left" | "center" | "right" | "justify";
export type BulletKind = "bullet" | "number";

/** The selected text box's look, read from its first run and paragraph. */
export type TextLook = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  size: number | null;
  color: string | null;
  align: TextAlign;
  bullet: BulletKind | "none";
};

const LINE_COLOR = "#404040";
/** A 1.5 pt line. */
const LINE_WIDTH_EMU = 19050;

/** A box of `wFrac` × `hFrac` of the slide, centred on it. */
export function centredBox(
  deck: Pick<Deck, "width" | "height">,
  wFrac: number,
  hFrac: number,
): Box {
  const w = Math.round(deck.width * wFrac);
  const h = Math.round(deck.height * hFrac);
  return { x: Math.round((deck.width - w) / 2), y: Math.round((deck.height - h) / 2), w, h };
}

function emuBox(box: Box) {
  return { x: emu(box.x), y: emu(box.y), w: emu(box.w), h: emu(box.h) };
}

export function insertTextBox(deck: Deck, slide: SlideData, text: string): SlideShapeData {
  return addSlideTextBox(slide, { ...emuBox(centredBox(deck, 0.5, 0.14)), text });
}

export function insertShape(deck: Deck, slide: SlideData, kind: InsertShape): SlideShapeData {
  if (kind === "line" || kind === "arrow") {
    const box = centredBox(deck, 0.3, 0);
    const line = addSlideLine(slide, {
      from: { x: emu(box.x), y: emu(box.y) },
      to: { x: emu(box.x + box.w), y: emu(box.y) },
      color: LINE_COLOR,
      widthEmu: LINE_WIDTH_EMU,
    });
    if (kind === "arrow") setShapeStrokeArrow(line, "tail", { type: "triangle" });
    return line;
  }
  const side = Math.round(Math.min(deck.width, deck.height) * 0.3);
  const box: Box = {
    x: Math.round((deck.width - side * (kind === "ellipse" ? 1 : 1.4)) / 2),
    y: Math.round((deck.height - side) / 2),
    w: Math.round(side * (kind === "ellipse" ? 1 : 1.4)),
    h: side,
  };
  return addSlideShape(slide, { preset: kind, ...emuBox(box) });
}

/** A picture, scaled to fit within most of the slide and centred, keeping its proportions. */
export function insertPicture(
  deck: Deck,
  slide: SlideData,
  bytes: Uint8Array,
  natural: { width: number; height: number },
): SlideShapeData {
  const room = centredBox(deck, 0.6, 0.6);
  const ratio = natural.width > 0 && natural.height > 0 ? natural.width / natural.height : 4 / 3;
  const w = Math.min(room.w, room.h * ratio);
  const h = w / ratio;
  const box = {
    x: Math.round((deck.width - w) / 2),
    y: Math.round((deck.height - h) / 2),
    w: Math.round(w),
    h: Math.round(h),
  };
  return addSlideImage(slide, bytes, { ...emuBox(box), fit: "contain" });
}

export function arrangeShape(shape: SlideShapeData, how: Arrange): void {
  if (how === "forward") bringShapeForward(shape);
  else if (how === "backward") sendShapeBackward(shape);
  else if (how === "front") bringShapeToFront(shape);
  else sendShapeToBack(shape);
}

/** Lines a shape up with an edge or the middle of the slide. */
export function alignToSlide(deck: Deck, shape: SlideShapeData, how: SlideAlign): boolean {
  const box = shapeBox(deck, shape);
  if (!box) return false;
  const next = { ...box };
  if (how === "left") next.x = 0;
  else if (how === "center") next.x = Math.round((deck.width - box.w) / 2);
  else if (how === "right") next.x = deck.width - box.w;
  else if (how === "top") next.y = 0;
  else if (how === "middle") next.y = Math.round((deck.height - box.h) / 2);
  else next.y = deck.height - box.h;
  setShapeBox(shape, next);
  return true;
}

export function deleteShape(shape: SlideShapeData): void {
  removeShape(shape);
}

function alignOf(token: string | null): TextAlign {
  if (token === "ctr") return "center";
  if (token === "r") return "right";
  if (token === "just" || token === "dist") return "justify";
  return "left";
}

export function textLook(deck: Deck, shape: SlideShapeData): TextLook {
  const run = getShapeRunFormatEffective(deck.pres, shape, 0, 0) ?? {};
  const bullet = getParagraphBullet(shape, 0);
  return {
    bold: run.bold === true,
    italic: run.italic === true,
    underline: Boolean(run.underline) && run.underline !== "none",
    size: typeof run.size === "number" ? run.size : null,
    color: typeof run.color === "string" ? run.color : null,
    align: alignOf(getParagraphAlignment(shape, 0)),
    bullet: bullet === "bullet" || bullet === "number" ? bullet : "none",
  };
}

/** Bold, italic or underline across the whole text box, the opposite of its first run. */
export function toggleTextStyle(
  deck: Deck,
  shape: SlideShapeData,
  style: "bold" | "italic" | "underline",
): void {
  const on = !textLook(deck, shape)[style];
  setShapeTextFormat(
    shape,
    style === "underline" ? { underline: on ? "sng" : "none" } : { [style]: on },
  );
}

export function setTextSize(shape: SlideShapeData, points: number): void {
  setShapeTextFormat(shape, { size: points });
}

export function stepTextSize(deck: Deck, shape: SlideShapeData, direction: 1 | -1): number {
  const next = stepFontSize(textLook(deck, shape).size ?? 18, direction);
  setTextSize(shape, next);
  return next;
}

export function setTextColor(shape: SlideShapeData, hex: string | null): void {
  setShapeTextFormat(shape, { color: hex ? asColor(hex) : null });
}

export function setTextAlign(shape: SlideShapeData, align: TextAlign): void {
  setShapeAlignment(shape, align);
}

/** Turns bullets or numbering on for every paragraph, or off when they already have them. */
export function toggleBullets(deck: Deck, shape: SlideShapeData, kind: BulletKind): void {
  setShapeBulletStyle(shape, textLook(deck, shape).bullet === kind ? "none" : kind);
}

export function setFill(shape: SlideShapeData, hex: string | null): void {
  const color = hex ? asColor(hex) : null;
  if (color) setShapeFill(shape, color);
  else setShapeNoFill(shape);
}

export function setOutline(shape: SlideShapeData, hex: string | null): void {
  const color = hex ? asColor(hex) : null;
  if (color) setShapeStroke(shape, { color });
  else setShapeNoStroke(shape);
}

export function shapeColors(shape: SlideShapeData): {
  fill: string | null;
  outline: string | null;
} {
  return { fill: getShapeFillColor(shape), outline: getShapeStrokeColor(shape) };
}

export type NamedLayout = { name: string; layout: SlideLayoutData };

/** The deck's slide layouts by name, each listed once. */
export function layoutsOf(deck: Deck): NamedLayout[] {
  const seen = new Set<string>();
  const out: NamedLayout[] = [];
  for (const layout of getSlideLayouts(deck.pres)) {
    const name = getSlideLayoutName(layout).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, layout });
  }
  return out;
}

/** A new slide after `index` on the given layout; returns the new slide's index. */
export function addSlideWithLayout(deck: Deck, index: number, layout: SlideLayoutData): number {
  const at = Math.min(Math.max(index + 1, 0), getSlides(deck.pres).length);
  addSlideAt(deck.pres, at, { layout });
  return at;
}

/** The slides a slideshow shows, skipping hidden ones; falls back to all when every slide is hidden. */
export function showOrder(hidden: readonly boolean[]): number[] {
  const shown = hidden.flatMap((isHidden, index) => (isHidden ? [] : [index]));
  return shown.length > 0 ? shown : hidden.map((_, index) => index);
}
