import { expect, it } from "vitest";
import { scaledSlideStyle, slideCssPixels } from "./slide-scale";

const widescreen = { pres: {} as never, width: 12_192_000, height: 6_858_000 };

it("lays a widescreen slide out at 1280 by 720, then scales that box", () => {
  expect(slideCssPixels(widescreen)).toEqual({ width: 1280, height: 720 });
  expect(scaledSlideStyle(slideCssPixels(widescreen), 320)).toMatchObject({
    width: 1280,
    height: 720,
    transform: "scale(0.25)",
    transformOrigin: "0 0",
  });
});
