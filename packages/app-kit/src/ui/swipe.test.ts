import { describe, expect, it } from "vitest";
import { swipeDecision } from "./swipe.js";

describe("swipeDecision", () => {
  it("needs a clear drag either way and ignores a small one", () => {
    expect(swipeDecision(100, 320)).toBe("right");
    expect(swipeDecision(-100, 320)).toBe("left");
    expect(swipeDecision(40, 320)).toBeNull();
  });
});
