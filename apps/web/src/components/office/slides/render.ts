import type { SlideData } from "@office-kit/pptx";
import { renderSlideToSvg } from "@office-kit/pptx-preview";
import type { Deck } from "./deck";

/** Each slide's edit count, so a render is reused until that slide changes. */
const revisions = new WeakMap<SlideData, number>();
const rendered = new WeakMap<SlideData, { rev: number; svg: string }>();

export function slideRevision(slide: SlideData): number {
  return revisions.get(slide) ?? 0;
}

/** Marks a slide as changed so its picture is drawn again. */
export function touchSlide(slide: SlideData): void {
  revisions.set(slide, slideRevision(slide) + 1);
}

/**
 * The preview paints a shape filled with a picture in its "image fill" stand-in colour first and
 * draws the picture over it, so a transparent logo shows a lavender box that PowerPoint never
 * paints. The stand-in is a bare `<g fill="#DDD6FE">` around the shape's outline, followed at once
 * by the picture's own group.
 */
const IMAGE_FILL_UNDERLAY =
  /<g(?: transform="[^"]*")? fill="#DDD6FE">(?:<rect [^>]*\/>|<path [^>]*\/>)<\/g>(?=<g[^>]*>(?:<image |<path |<rect ))/g;

/** The preview's SVG with the stand-in colour behind picture-filled shapes taken out. */
export function cleanSlideSvg(svg: string): string {
  return svg.replace(IMAGE_FILL_UNDERLAY, "");
}

/** The slide as an SVG string, drawn once per change. */
export function slideSvg(deck: Deck, slide: SlideData): string {
  const rev = slideRevision(slide);
  const cached = rendered.get(slide);
  if (cached && cached.rev === rev) return cached.svg;
  const svg = cleanSlideSvg(renderSlideToSvg(deck.pres, slide));
  rendered.set(slide, { rev, svg });
  return svg;
}
