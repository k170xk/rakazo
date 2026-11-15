import { describe, expect, it } from "vitest";
import { clampColumnWidth, columnResizeDelta, maximumColumnWidth } from "./column-resize";

const panel = { minWidth: 320, maxWidth: 1040, minRemainder: 360 };

describe("column resize", () => {
  it("grows a right-hand panel when its edge moves left", () => {
    expect(columnResizeDelta(100, 60, "start", 1)).toBe(40);
    expect(columnResizeDelta(100, 140, "end", 1)).toBe(40);
  });

  it("leaves a usable canvas beside the chat", () => {
    expect(clampColumnWidth(800, 1428, { ...panel, reserved: 390 })).toBe(1428 - 360 - 390);
    expect(maximumColumnWidth(900, panel)).toBe(900 - 360);
    expect(clampColumnWidth(100, 1600, panel)).toBe(320);
  });
});
