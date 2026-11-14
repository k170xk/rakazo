import { describe, expect, it } from "vitest";
import { buildAxis, indexAt, scrollToShow, sizeOf, span, startOf } from "./geometry";

const axis = buildAxis(10, (index) => (index === 3 ? 0 : index === 5 ? 50 : 20));

describe("buildAxis", () => {
  it("adds sizes up, with hidden items taking no room", () => {
    expect(axis.total).toBe(8 * 20 + 50);
    expect(startOf(axis, 1)).toBe(0);
    expect(startOf(axis, 4)).toBe(40);
    expect(sizeOf(axis, 3)).toBe(0);
    expect(sizeOf(axis, 5)).toBe(50);
    expect(sizeOf(axis, 11)).toBe(0);
  });
});

describe("indexAt", () => {
  it("finds the item under a pixel and never a hidden one", () => {
    expect(indexAt(axis, 0)).toBe(1);
    expect(indexAt(axis, 19.5)).toBe(1);
    expect(indexAt(axis, 20)).toBe(2);
    expect(indexAt(axis, 40)).toBe(4);
    expect(indexAt(axis, 70)).toBe(5);
    expect(indexAt(axis, -5)).toBe(1);
    expect(indexAt(axis, 10_000)).toBe(10);
  });

  it("stays fast on a very long sheet", () => {
    const long = buildAxis(1_048_576, () => 20);
    expect(indexAt(long, 20 * 999_999 + 1)).toBe(1_000_000);
  });
});

describe("span", () => {
  it("draws the visible items plus a margin, never the frozen ones", () => {
    expect(span(axis, 40, 100, 1, 0)).toEqual({ first: 4, last: 5 });
    expect(span(axis, 40, 100, 5, 1)).toEqual({ first: 5, last: 6 });
    expect(span(axis, 0, 0, 1)).toEqual({ first: 1, last: 0 });
  });
});

describe("scrollToShow", () => {
  it("scrolls only as far as needed and leaves frozen items alone", () => {
    expect(scrollToShow(axis, 2, 0, 0, 60)).toBe(0);
    expect(scrollToShow(axis, 8, 0, 0, 60)).toBe(startOf(axis, 9) - 60);
    expect(scrollToShow(axis, 2, 100, 0, 60)).toBe(20);
    // With item 1 frozen (20px), item 2 hides under it once scrolled.
    expect(scrollToShow(axis, 2, 30, 20, 60)).toBe(0);
    expect(scrollToShow(axis, 1, 30, 20, 60)).toBe(30);
  });
});
