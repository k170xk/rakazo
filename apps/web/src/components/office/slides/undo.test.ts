import {
  addSlideAt,
  createPresentation,
  getSlideLayouts,
  getSlideNotes,
  getSlideShapes,
  getSlides,
  savePresentation,
} from "@office-kit/pptx";
import { afterEach, describe, expect, it, vi } from "vitest";
import { insertShape, insertTextBox } from "./commands";
import type { Deck } from "./deck";
import { openDeck, setNotes } from "./deck";
import { createDeckUndo } from "./undo";

async function oneSlide(): Promise<Deck> {
  const pres = createPresentation();
  const layout = getSlideLayouts(pres)[0];
  if (!layout) throw new Error("no layout");
  addSlideAt(pres, 0, { layout });
  return openDeck(await savePresentation(pres));
}

const shapes = (deck: Deck) => getSlideShapes(getSlides(deck.pres)[0] ?? never()).length;
const notes = (deck: Deck) => getSlideNotes(getSlides(deck.pres)[0] ?? never()) ?? "";
function never(): never {
  throw new Error("no slide");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("deck undo", () => {
  it("steps back and forward through changes", async () => {
    const deck = await oneSlide();
    const undo = createDeckUndo(deck);
    const start = shapes(deck);
    insertShape(deck, getSlides(deck.pres)[0] ?? never(), "rect");
    undo.committed();
    insertTextBox(deck, getSlides(deck.pres)[0] ?? never(), "Hi");
    undo.committed();
    expect(shapes(deck)).toBe(start + 2);

    expect(await undo.undo()).toBe(true);
    expect(shapes(deck)).toBe(start + 1);
    expect(await undo.undo()).toBe(true);
    expect(shapes(deck)).toBe(start);
    expect(await undo.undo()).toBe(false);

    expect(await undo.redo()).toBe(true);
    expect(await undo.redo()).toBe(true);
    expect(shapes(deck)).toBe(start + 2);
    expect(await undo.redo()).toBe(false);
  });

  it("a new change after undoing drops what could be redone", async () => {
    const deck = await oneSlide();
    const undo = createDeckUndo(deck);
    insertShape(deck, getSlides(deck.pres)[0] ?? never(), "rect");
    undo.committed();
    await undo.undo();
    insertShape(deck, getSlides(deck.pres)[0] ?? never(), "ellipse");
    undo.committed();
    expect(undo.history.canRedo()).toBe(false);
    expect(undo.history.canUndo()).toBe(true);
  });

  it("treats a burst of typing as one step", async () => {
    vi.useFakeTimers();
    const deck = await oneSlide();
    const undo = createDeckUndo(deck);
    for (const text of ["H", "He", "Hel", "Hello"]) {
      setNotes(getSlides(deck.pres)[0] ?? never(), text);
      undo.typed();
    }
    vi.advanceTimersByTime(1000);
    expect(notes(deck)).toBe("Hello");
    expect(await undo.undo()).toBe(true);
    expect(notes(deck)).toBe("");
    expect(await undo.redo()).toBe(true);
    expect(notes(deck)).toBe("Hello");
    undo.dispose();
  });
});
