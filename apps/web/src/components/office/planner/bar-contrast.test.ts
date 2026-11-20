import { describe, expect, it } from "vitest";
import { prefersDarkText } from "./bar-contrast";

describe("prefersDarkText", () => {
  it("uses dark text on the OCSC green and other light bars", () => {
    expect(prefersDarkText("rgb(118, 191, 67)")).toBe(true);
    expect(prefersDarkText("#fbbf24")).toBe(true);
    expect(prefersDarkText("rgba(255, 255, 255, 0.9)")).toBe(true);
  });

  it("keeps white text on dark bars", () => {
    expect(prefersDarkText("rgb(30, 64, 175)")).toBe(false);
    expect(prefersDarkText("#dc2626")).toBe(false);
    expect(prefersDarkText("#334")).toBe(false);
  });

  it("falls back to white for colours it cannot read", () => {
    expect(prefersDarkText("")).toBe(false);
    expect(prefersDarkText("linear-gradient(red, blue)")).toBe(false);
  });
});
