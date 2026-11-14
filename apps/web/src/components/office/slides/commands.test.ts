import type { SlideShapeData } from "@office-kit/pptx";
import {
  addSlideAt,
  createPresentation,
  getShapeId,
  getShapeKind,
  getShapePreset,
  getShapeStrokeArrow,
  getShapeText,
  getShapeZIndex,
  getSlideLayouts,
  getSlideShapes,
  getSlides,
  savePresentation,
} from "@office-kit/pptx";
import { describe, expect, it } from "vitest";
import {
  addSlideWithLayout,
  alignToSlide,
  arrangeShape,
  centredBox,
  deleteShape,
  insertPicture,
  insertShape,
  insertTextBox,
  layoutsOf,
  setFill,
  setOutline,
  setTextAlign,
  setTextColor,
  shapeColors,
  showOrder,
  stepTextSize,
  textLook,
  toggleBullets,
  toggleTextStyle,
} from "./commands";
import type { Deck } from "./deck";
import { findShape, openDeck, saveVerified, shapeBox } from "./deck";

const PIXEL = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

async function oneSlide(): Promise<Deck> {
  const pres = createPresentation();
  const layout = getSlideLayouts(pres)[0];
  if (!layout) throw new Error("no layout");
  addSlideAt(pres, 0, { layout });
  return openDeck(await savePresentation(pres));
}

function firstSlide(deck: Deck) {
  const slide = getSlides(deck.pres)[0];
  if (!slide) throw new Error("no slide");
  return slide;
}

/** Saves through the studio's checked save and opens the result, as a reload would. */
async function roundTrip(deck: Deck): Promise<Deck> {
  return openDeck(await saveVerified(deck.pres));
}

function reread(deck: Deck, id: number): SlideShapeData {
  const shape = findShape(firstSlide(deck), id);
  if (!shape) throw new Error(`shape ${id} was lost`);
  return shape;
}

describe("slides ribbon commands", () => {
  it("inserts text boxes, shapes, lines, arrows and pictures that survive a save", async () => {
    const deck = await oneSlide();
    const slide = firstSlide(deck);
    const text = getShapeId(insertTextBox(deck, slide, "Hello"));
    const rect = getShapeId(insertShape(deck, slide, "rect"));
    const round = getShapeId(insertShape(deck, slide, "roundRect"));
    const ellipse = getShapeId(insertShape(deck, slide, "ellipse"));
    const line = getShapeId(insertShape(deck, slide, "line"));
    const arrow = getShapeId(insertShape(deck, slide, "arrow"));
    const picture = getShapeId(insertPicture(deck, slide, PIXEL, { width: 1, height: 1 }));

    const back = await roundTrip(deck);
    expect(getShapeText(reread(back, text))).toBe("Hello");
    expect(getShapePreset(reread(back, rect))).toBe("rect");
    expect(getShapePreset(reread(back, round))).toBe("roundRect");
    expect(getShapePreset(reread(back, ellipse))).toBe("ellipse");
    expect(getShapeKind(reread(back, line))).toBe("connector");
    expect(getShapeStrokeArrow(reread(back, arrow), "tail")?.type).toBe("triangle");
    expect(getShapeStrokeArrow(reread(back, line), "tail")).toBeFalsy();
    expect(getShapeKind(reread(back, picture))).toBe("picture");
    const box = shapeBox(back, reread(back, picture));
    expect(box?.w).toBe(box?.h);
    expect(box && Math.abs(box.x + box.w / 2 - back.width / 2)).toBeLessThanOrEqual(1);
  });

  it("formats a text box and keeps the formatting after a save", async () => {
    const deck = await oneSlide();
    const slide = firstSlide(deck);
    const shape = insertTextBox(deck, slide, "One\nTwo");
    const id = getShapeId(shape);
    toggleTextStyle(deck, shape, "bold");
    toggleTextStyle(deck, shape, "italic");
    toggleTextStyle(deck, shape, "underline");
    setTextColor(shape, "#76BF43");
    setTextAlign(shape, "center");
    toggleBullets(deck, shape, "bullet");
    const size = stepTextSize(deck, shape, 1);

    const back = await roundTrip(deck);
    const look = textLook(back, reread(back, id));
    expect(look).toMatchObject({
      bold: true,
      italic: true,
      underline: true,
      size,
      align: "center",
      bullet: "bullet",
    });
    expect(look.color?.toUpperCase()).toBe("#76BF43");

    const again = reread(back, id);
    toggleTextStyle(back, again, "bold");
    toggleBullets(back, again, "bullet");
    const reloaded = await roundTrip(back);
    const off = textLook(reloaded, reread(reloaded, id));
    expect(off.bold).toBe(false);
    expect(off.bullet).toBe("none");
  });

  it("orders, aligns, colours and deletes shapes", async () => {
    const deck = await oneSlide();
    const slide = firstSlide(deck);
    const a = insertShape(deck, slide, "rect");
    const b = insertShape(deck, slide, "ellipse");
    const ids = [getShapeId(a), getShapeId(b)];
    arrangeShape(b, "back");
    expect(getShapeZIndex(b)).toBeLessThan(getShapeZIndex(a));
    arrangeShape(b, "forward");
    expect(getShapeZIndex(b)).toBeGreaterThan(getShapeZIndex(a));
    arrangeShape(b, "backward");
    arrangeShape(a, "front");
    expect(getShapeZIndex(a)).toBeGreaterThan(getShapeZIndex(b));

    alignToSlide(deck, a, "right");
    alignToSlide(deck, a, "bottom");
    alignToSlide(deck, b, "left");
    alignToSlide(deck, b, "middle");
    setFill(a, "#76BF43");
    setOutline(a, "#1F2937");
    setFill(b, null);
    setOutline(b, null);

    const back = await roundTrip(deck);
    const boxA = shapeBox(back, reread(back, ids[0] as number));
    const boxB = shapeBox(back, reread(back, ids[1] as number));
    expect(boxA && boxA.x + boxA.w).toBe(back.width);
    expect(boxA && boxA.y + boxA.h).toBe(back.height);
    expect(boxB?.x).toBe(0);
    expect(boxB && Math.abs(boxB.y + boxB.h / 2 - back.height / 2)).toBeLessThanOrEqual(1);
    expect(shapeColors(reread(back, ids[0] as number))).toEqual({
      fill: "#76BF43",
      outline: "#1F2937",
    });
    expect(shapeColors(reread(back, ids[1] as number)).fill).toBeNull();

    const count = getSlideShapes(firstSlide(back)).length;
    deleteShape(reread(back, ids[0] as number));
    const gone = await roundTrip(back);
    expect(findShape(firstSlide(gone), ids[0] as number)).toBeNull();
    expect(getSlideShapes(firstSlide(gone))).toHaveLength(count - 1);
  });

  it("adds a slide on a named layout", async () => {
    const deck = await oneSlide();
    const layouts = layoutsOf(deck);
    expect(layouts.length).toBeGreaterThan(0);
    expect(new Set(layouts.map((l) => l.name)).size).toBe(layouts.length);
    const target = layouts[layouts.length - 1];
    if (!target) throw new Error("no layout");
    expect(addSlideWithLayout(deck, 0, target.layout)).toBe(1);
    const back = await roundTrip(deck);
    expect(getSlides(back.pres)).toHaveLength(2);
  });

  it("centres boxes and plans the slideshow order", () => {
    expect(centredBox({ width: 100, height: 50 }, 0.5, 0.5)).toEqual({
      x: 25,
      y: 13,
      w: 50,
      h: 25,
    });
    expect(showOrder([false, true, false])).toEqual([0, 2]);
    expect(showOrder([true, true])).toEqual([0, 1]);
  });
});
