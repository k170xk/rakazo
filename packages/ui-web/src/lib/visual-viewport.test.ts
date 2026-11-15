import { describe, expect, it } from "vitest";
import { viewportFrameOf } from "./visual-viewport";

describe("viewportFrameOf", () => {
  it("follows the visible screen when the page has shifted down", () => {
    expect(viewportFrameOf({ offsetTop: 48, offsetLeft: 0, width: 390, height: 700 })).toEqual({
      top: 48,
      left: 0,
      width: 390,
      height: 700,
    });
  });

  it("leaves the layout alone until the viewport has a size", () => {
    expect(viewportFrameOf({ offsetTop: 0, offsetLeft: 0, width: 0, height: 0 })).toBeNull();
  });
});
