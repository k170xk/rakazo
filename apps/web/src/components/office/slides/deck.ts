import type { PresentationData, ShapeBounds, SlideData, SlideShapeData } from "@office-kit/pptx";
import {
  addSlideAt,
  duplicateSlideAt,
  emu,
  findShapeById,
  getShapeBounds,
  getShapeBoundsResolved,
  getShapeDescription,
  getShapeId,
  getShapeImageBytes,
  getShapeImageFormat,
  getShapeKind,
  getShapeName,
  getShapePlaceholderType,
  getShapeRotation,
  getShapeText,
  getSlideLayout,
  getSlideNotes,
  getSlideShapes,
  getSlideSize,
  getSlides,
  getSlideTitle,
  isShapeTextBox,
  isSlideHidden,
  loadPresentation,
  moveSlide,
  removeSlide,
  savePresentation,
  setShapeBounds,
  setShapeText,
  setSlideHidden,
  setSlideNotes,
  validatePresentation,
} from "@office-kit/pptx";
import type { SlideShapeSummary, SlideView } from "./context";

/** EMU per unit of the preview's SVG viewBox (96 units per inch). */
export const EMU_PER_SVG_UNIT = 9525;
/** The smallest a shape can be resized to, about 0.1 inch. */
export const MIN_SHAPE_EMU = 91440;

export type Box = { x: number; y: number; w: number; h: number };

export type Deck = {
  pres: PresentationData;
  width: number;
  height: number;
};

export async function openDeck(bytes: Uint8Array): Promise<Deck> {
  const pres = await loadPresentation(bytes);
  const size = getSlideSize(pres);
  return { pres, width: size?.width ?? 12192000, height: size?.height ?? 6858000 };
}

export class SaveCheckError extends Error {}

/** Every slide's notes and shape texts, in order, to prove a saved file kept them. */
function contentOf(pres: PresentationData): string {
  return getSlides(pres)
    .map((slide) =>
      [
        getSlideNotes(slide) ?? "",
        isSlideHidden(slide) ? "hidden" : "",
        ...getSlideShapes(slide).map(getShapeText),
      ].join("\u0001"),
    )
    .join("\u0002");
}

/** The file to upload: checked before saving, then reopened to prove it kept every slide's text. */
export async function saveVerified(pres: PresentationData): Promise<Uint8Array> {
  const errors = validatePresentation(pres).filter((issue) => issue.severity === "error");
  if (errors.length > 0)
    throw new SaveCheckError(errors[0]?.message ?? "The file did not check out.");
  const bytes = await savePresentation(pres);
  let reloaded: PresentationData;
  try {
    reloaded = await loadPresentation(bytes);
  } catch (error) {
    throw new SaveCheckError("The saved file did not open again.", { cause: error });
  }
  if (getSlides(reloaded).length !== getSlides(pres).length) {
    throw new SaveCheckError("The saved file lost a slide.");
  }
  if (contentOf(reloaded) !== contentOf(pres)) {
    throw new SaveCheckError("The saved file lost some slide text.");
  }
  return bytes;
}

/** A shape on a slide whose text can be typed over. */
export function canEditText(shape: SlideShapeData): boolean {
  return getShapeKind(shape) === "shape";
}

/**
 * Whether dragging and resizing a shape is safe: plain shapes and pictures at the top of the slide.
 * Group members are placed inside their group's own coordinates and rotated shapes turn about their
 * centre, so moving either by slide coordinates would land them somewhere else.
 */
export function canMoveShape(shape: SlideShapeData, nested: boolean): boolean {
  const kind = getShapeKind(shape);
  return !nested && (kind === "shape" || kind === "picture") && getShapeRotation(shape) === 0;
}

export function shapeBox(deck: Deck, shape: SlideShapeData): Box | null {
  const bounds = getShapeBounds(shape) ?? getShapeBoundsResolved(deck.pres, shape);
  return bounds ? { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h } : null;
}

export function setShapeBox(shape: SlideShapeData, box: Box): void {
  const bounds: ShapeBounds = {
    x: emu(Math.round(box.x)),
    y: emu(Math.round(box.y)),
    w: emu(Math.round(box.w)),
    h: emu(Math.round(box.h)),
  };
  setShapeBounds(shape, bounds);
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** `box` moved by `dx`, `dy` (EMU), kept so at least part of it stays on the slide. */
export function movedBox(
  box: Box,
  dx: number,
  dy: number,
  deck: Pick<Deck, "width" | "height">,
): Box {
  const keep = MIN_SHAPE_EMU;
  const x = Math.min(Math.max(box.x + dx, keep - box.w), deck.width - keep);
  const y = Math.min(Math.max(box.y + dy, keep - box.h), deck.height - keep);
  return { ...box, x, y };
}

/** `box` with the edge or corner `handle` dragged by `dx`, `dy` (EMU); the opposite side stays put. */
export function resizedBox(box: Box, handle: Handle, dx: number, dy: number): Box {
  let { x, y, w, h } = box;
  if (handle.includes("w")) {
    const right = x + w;
    w = Math.max(MIN_SHAPE_EMU, w - dx);
    x = right - w;
  } else if (handle.includes("e")) {
    w = Math.max(MIN_SHAPE_EMU, w + dx);
  }
  if (handle.startsWith("n")) {
    const bottom = y + h;
    h = Math.max(MIN_SHAPE_EMU, h - dy);
    y = bottom - h;
  } else if (handle.startsWith("s")) {
    h = Math.max(MIN_SHAPE_EMU, h + dy);
  }
  return { x, y, w, h };
}

export function findShape(slide: SlideData, id: number): SlideShapeData | null {
  return findShapeById(slide, id);
}

/** Replaces a text box's words, keeping its font, size and colour. */
export function setText(shape: SlideShapeData, text: string): void {
  setShapeText(shape, text, { preserveFormatting: true });
}

export function setNotes(slide: SlideData, text: string): void {
  setSlideNotes(slide, text, { preserveFormatting: true });
}

/** A new slide after `index` using the same layout; returns the new slide's index. */
export function addSlideAfter(deck: Deck, index: number): number {
  const slides = getSlides(deck.pres);
  const source = slides[index] ?? slides[slides.length - 1];
  const layout = source ? getSlideLayout(source) : null;
  if (!layout) throw new Error("This presentation has no slide layout to copy.");
  addSlideAt(deck.pres, index + 1, { layout });
  return index + 1;
}

export function duplicateSlide(deck: Deck, index: number): number {
  const slide = getSlides(deck.pres)[index];
  if (!slide) return index;
  duplicateSlideAt(deck.pres, index + 1, slide);
  return index + 1;
}

/** Moves the slide at `from` to `to`; returns where it ended up. */
export function reorderSlide(deck: Deck, from: number, to: number): number {
  const slides = getSlides(deck.pres);
  const slide = slides[from];
  const target = Math.min(Math.max(to, 0), slides.length - 1);
  if (!slide || target === from) return from;
  moveSlide(deck.pres, slide, target);
  return target;
}

export function toggleSlideHidden(deck: Deck, index: number): void {
  const slide = getSlides(deck.pres)[index];
  if (slide) setSlideHidden(slide, !isSlideHidden(slide));
}

/** Deletes a slide, never the last one; returns the slide to show next. */
export function deleteSlide(deck: Deck, index: number): number {
  const slides = getSlides(deck.pres);
  const slide = slides[index];
  if (!slide || slides.length <= 1) return index;
  removeSlide(deck.pres, slide);
  return Math.min(index, slides.length - 2);
}

/** What a slide shows, so a reload can tell which slides the assistant changed. */
export function slideSignature(slide: SlideData): string {
  return [
    getSlideNotes(slide) ?? "",
    isSlideHidden(slide) ? "hidden" : "",
    ...getSlideShapes(slide).map(
      (shape) =>
        `${getShapeId(shape)}:${JSON.stringify(getShapeBounds(shape))}:${getShapeText(shape)}`,
    ),
  ].join("\u0001");
}

/** Indexes of slides in `after` that are new or differ from the slide at the same place before. */
export function changedSlides(before: Deck | null, after: Deck): Set<number> {
  const old = before ? getSlides(before.pres).map(slideSignature) : [];
  const changed = new Set<number>();
  getSlides(after.pres).forEach((slide, index) => {
    if (old[index] !== slideSignature(slide)) changed.add(index);
  });
  return changed;
}

/** One shape as the studio note describes it. */
export function shapeSummary(deck: Deck, shape: SlideShapeData): SlideShapeSummary {
  const kind = getShapeKind(shape);
  const text = getShapeText(shape);
  const placeholder = getShapePlaceholderType(shape);
  return {
    kind:
      kind === "picture"
        ? "picture"
        : kind === "shape"
          ? isShapeTextBox(shape) || placeholder || text.trim()
            ? "text"
            : "shape"
          : "other",
    name: getShapeName(shape),
    text,
    alt: getShapeDescription(shape),
    placeholder,
    box: shapeBox(deck, shape),
  };
}

/** The slide in view for the studio note: its title, text, notes and the picked shape. */
export function slideView(
  deck: Deck,
  slide: SlideData,
  index: number,
  count: number,
  picked: SlideShapeData | null,
): SlideView {
  const title = getSlideTitle(slide);
  const texts = getSlideShapes(slide)
    .map(getShapeText)
    .map((text) => text.trim())
    .filter((text) => text && text !== title?.trim());
  return {
    index,
    count,
    title,
    texts,
    notes: getSlideNotes(slide) ?? "",
    picked: picked ? shapeSummary(deck, picked) : null,
  };
}

/** A picture shape's image as a file to attach, or null when it holds none. */
export function pictureFile(shape: SlideShapeData): File | null {
  if (getShapeKind(shape) !== "picture") return null;
  const bytes = getShapeImageBytes(shape);
  if (!bytes) return null;
  const format = (getShapeImageFormat(shape) ?? "png").toLowerCase().replace("jpeg", "jpg");
  const type =
    format === "jpg" ? "image/jpeg" : format === "svg" ? "image/svg+xml" : `image/${format}`;
  const name = (getShapeName(shape) || "picture").replace(/[^\w.-]+/g, "-").replace(/\.\w+$/, "");
  return new File([bytes.slice()], `${name}.${format}`, { type });
}

const SELECTED_TEXT_MAX = 200;

/** The selection line for the studio note, such as `slide 3` or `slide 3, text "Walk the site"`. */
export function selectionLabel(index: number, text: string | null): string {
  const words = text?.replace(/\s+/g, " ").trim().slice(0, SELECTED_TEXT_MAX) ?? "";
  return words ? `slide ${index + 1}, text ${JSON.stringify(words)}` : `slide ${index + 1}`;
}
