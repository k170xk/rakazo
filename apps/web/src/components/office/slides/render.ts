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

/** The slide as an SVG string, drawn once per change. */
export function slideSvg(deck: Deck, slide: SlideData): string {
  const rev = slideRevision(slide);
  const cached = rendered.get(slide);
  if (cached && cached.rev === rev) return cached.svg;
  const svg = renderSlideToSvg(deck.pres, slide);
  rendered.set(slide, { rev, svg });
  return svg;
}
