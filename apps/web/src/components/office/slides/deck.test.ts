import type { SlideData, SlideShapeData } from "@office-kit/pptx";
import {
  addSlideAt,
  addSlideTextBox,
  createPresentation,
  emu,
  getShapeId,
  getShapeText,
  getSlideLayouts,
  getSlideNotes,
  getSlideShapes,
  getSlides,
  isSlideHidden,
  loadPresentation,
  savePresentation,
} from "@office-kit/pptx";
import { describe, expect, it } from "vitest";
import type { Deck } from "./deck";
import {
  addSlideAfter,
  changedSlides,
  deleteSlide,
  duplicateSlide,
  findShape,
  MIN_SHAPE_EMU,
  movedBox,
  openDeck,
  reorderSlide,
  resizedBox,
  saveVerified,
  selectionLabel,
  setNotes,
  setShapeBox,
  setText,
  shapeBox,
  toggleSlideHidden,
} from "./deck";

async function threeSlides(): Promise<{ deck: Deck; ids: number[] }> {
  const pres = createPresentation();
  const layout = getSlideLayouts(pres)[0];
  if (!layout) throw new Error("no layout");
  const ids: number[] = [];
  for (const [at, text] of ["One", "Two", "Three"].entries()) {
    const slide = addSlideAt(pres, at, { layout });
    const box = addSlideTextBox(slide, {
      x: emu(914400),
      y: emu(914400),
      w: emu(3657600),
      h: emu(914400),
      text,
    });
    ids.push(getShapeId(box));
  }
  const deck = await openDeck(await savePresentation(pres));
  return { deck, ids };
}

function findFirstText(slide: SlideData): SlideShapeData {
  const shape = getSlideShapes(slide).find((s) => getShapeText(s));
  if (!shape) throw new Error("no text");
  return shape;
}

const titles = (deck: Deck) => getSlides(deck.pres).map((s) => getShapeText(findFirstText(s)));

describe("box geometry", () => {
  const box = { x: 1000000, y: 1000000, w: 2000000, h: 1000000 };
  const deck = { width: 12192000, height: 6858000 };

  it("moves a box and keeps part of it on the slide", () => {
    expect(movedBox(box, 500000, -250000, deck)).toEqual({ ...box, x: 1500000, y: 750000 });
    const far = movedBox(box, 99999999, 99999999, deck);
    expect(far.x).toBe(deck.width - MIN_SHAPE_EMU);
    expect(far.y).toBe(deck.height - MIN_SHAPE_EMU);
  });

  it("resizes from any side, keeping the opposite side in place", () => {
    expect(resizedBox(box, "se", 100, 200)).toEqual({ ...box, w: 2000100, h: 1000200 });
    const nw = resizedBox(box, "nw", 100000, 100000);
    expect(nw.x + nw.w).toBe(box.x + box.w);
    expect(nw.y + nw.h).toBe(box.y + box.h);
    expect(resizedBox(box, "e", -99999999, 0).w).toBe(MIN_SHAPE_EMU);
    expect(resizedBox(box, "n", 0, 99999999).h).toBe(MIN_SHAPE_EMU);
  });
});

describe("slide edits round-trip", () => {
  it("keeps moved shapes, new text and notes after saving", async () => {
    const { deck, ids } = await threeSlides();
    const slide = getSlides(deck.pres)[1];
    const shape = slide && ids[1] !== undefined ? findShape(slide, ids[1]) : null;
    if (!slide || !shape) throw new Error("missing shape");
    const before = shapeBox(deck, shape);
    if (!before) throw new Error("no bounds");
    const next = movedBox(before, 254000, 127000, deck);
    setShapeBox(shape, next);
    setText(shape, "Two\nand a half");
    setNotes(slide, "Say this");

    const saved = await loadPresentation(await saveVerified(deck.pres));
    const again = getSlides(saved)[1];
    const reread = again && ids[1] !== undefined ? findShape(again, ids[1]) : null;
    if (!again || !reread) throw new Error("lost shape");
    expect(getShapeText(reread)).toBe("Two\nand a half");
    expect(getSlideNotes(again)).toBe("Say this");
    expect(shapeBox({ ...deck, pres: saved }, reread)).toEqual(next);
  });

  it("adds, duplicates, moves, hides and deletes slides", async () => {
    const { deck } = await threeSlides();
    expect(titles(deck)).toEqual(["One", "Two", "Three"]);
    expect(duplicateSlide(deck, 0)).toBe(1);
    expect(titles(deck)).toEqual(["One", "One", "Two", "Three"]);
    expect(reorderSlide(deck, 3, 0)).toBe(0);
    expect(titles(deck)).toEqual(["Three", "One", "One", "Two"]);
    expect(deleteSlide(deck, 1)).toBe(1);
    expect(titles(deck)).toEqual(["Three", "One", "Two"]);
    toggleSlideHidden(deck, 2);
    expect(addSlideAfter(deck, 0)).toBe(1);
    expect(getSlides(deck.pres)).toHaveLength(4);

    const saved = await openDeck(await saveVerified(deck.pres));
    expect(getSlides(saved.pres)).toHaveLength(4);
    expect(getSlides(saved.pres).map(isSlideHidden)).toEqual([false, false, false, true]);
  });

  it("never deletes the last slide", async () => {
    const { deck } = await threeSlides();
    deleteSlide(deck, 0);
    deleteSlide(deck, 0);
    expect(deleteSlide(deck, 0)).toBe(0);
    expect(getSlides(deck.pres)).toHaveLength(1);
  });
});

describe("what changed and what is selected", () => {
  it("finds the slides a newer version changed", async () => {
    const { deck } = await threeSlides();
    const next = await openDeck(await savePresentation(deck.pres));
    const slide = getSlides(next.pres)[2];
    if (!slide) throw new Error("no slide");
    setText(findFirstText(slide), "Changed");
    expect([...changedSlides(deck, next)]).toEqual([2]);
    expect([...changedSlides(null, next)]).toEqual([0, 1, 2]);
  });

  it("names the slide and the selected text for the assistant", () => {
    expect(selectionLabel(2, null)).toBe("slide 3");
    expect(selectionLabel(0, "  Walk\n the site ")).toBe('slide 1, text "Walk the site"');
  });
});
