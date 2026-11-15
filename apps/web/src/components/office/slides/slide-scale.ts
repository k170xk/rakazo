import type { CSSProperties } from "react";
import { EMU_PER_SVG_UNIT, type Deck } from "./deck";

/** The slide at 96dpi, which is the size the preview lays its text out for. */
export function slideCssPixels(deck: Deck): { width: number; height: number } {
  return {
    width: deck.width / EMU_PER_SVG_UNIT,
    height: deck.height / EMU_PER_SVG_UNIT,
  };
}

/**
 * Paint the slide at its natural pixel size, then scale that box into `fitWidth`.
 *
 * The preview draws titles as HTML inside the SVG. Giving the SVG a CSS width and
 * height directly leaves that HTML unscaled in the iOS web view the Capacitor app
 * uses, so the text stays full size and piles up on the shapes. A CSS transform
 * scales the text and the shapes together.
 */
export function scaledSlideStyle(
  natural: { width: number; height: number },
  fitWidth: number,
): CSSProperties {
  const scale = natural.width > 0 ? fitWidth / natural.width : 0;
  return {
    width: natural.width,
    height: natural.height,
    transform: `scale(${scale})`,
    transformOrigin: "0 0",
  };
}
