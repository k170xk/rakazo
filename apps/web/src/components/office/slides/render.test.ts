import {
  addBlankSlide,
  addSlideShape,
  createPresentation,
  emu,
  getShapeImageFillBytes,
  setShapeFill,
  setShapeImageFill,
} from "@office-kit/pptx";
import { renderSlideToSvg } from "@office-kit/pptx-preview";
import { describe, expect, it } from "vitest";
import { cleanSlideSvg, slideSvg } from "./render";

/** A 1×1 fully transparent PNG, like the clear background around the OCSC logo. */
const CLEAR_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==",
  ),
  (char) => char.charCodeAt(0),
);

/** One slide with a freeform-style shape filled with the picture, as the cover layout's logo is. */
function logoDeck() {
  const pres = createPresentation();
  const slide = addBlankSlide(pres);
  const logo = addSlideShape(slide, {
    preset: "rect",
    x: emu(914400),
    y: emu(914400),
    w: emu(1828800),
    h: emu(914400),
    name: "Logo",
  });
  setShapeImageFill(logo, CLEAR_PNG, { format: "png" });
  return { pres, slide, logo };
}

describe("cleanSlideSvg", () => {
  it("drops the stand-in colour the preview paints behind a picture-filled shape", () => {
    const { pres, slide } = logoDeck();
    const raw = renderSlideToSvg(pres, slide);
    expect(raw).toContain('fill="#DDD6FE"');

    const svg = slideSvg({ pres, width: 12192000, height: 6858000 }, slide);
    expect(svg).not.toContain("#DDD6FE");
    expect(svg).toContain("<image ");
  });

  it("keeps a shape whose own fill is that colour", () => {
    const { pres, slide } = logoDeck();
    const box = addSlideShape(slide, {
      preset: "rect",
      x: emu(0),
      y: emu(0),
      w: emu(914400),
      h: emu(914400),
    });
    setShapeFill(box, "#DDD6FE");
    const svg = cleanSlideSvg(renderSlideToSvg(pres, slide));
    expect(svg.match(/#DDD6FE/gi)).toHaveLength(1);
  });

  it("leaves the presentation itself alone", () => {
    const { pres, slide, logo } = logoDeck();
    slideSvg({ pres, width: 12192000, height: 6858000 }, slide);
    expect(getShapeImageFillBytes(logo)).toEqual(CLEAR_PNG);
  });
});
