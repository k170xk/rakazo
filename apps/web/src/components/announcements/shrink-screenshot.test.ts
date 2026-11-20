import { describe, expect, it } from "vitest";
import { fitScale } from "./shrink-screenshot";

describe("fitScale", () => {
  it("keeps screenshots that already fit at full size", () => {
    expect(fitScale(1280, 800)).toBe(1);
    expect(fitScale(1800, 1800)).toBe(1);
  });

  it("shrinks the longer edge to the limit, whichever way round", () => {
    expect(fitScale(3600, 2000)).toBe(0.5);
    expect(fitScale(1000, 3600)).toBe(0.5);
  });
});
