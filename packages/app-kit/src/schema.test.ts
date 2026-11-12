import { describe, expect, it } from "vitest";
import { coerceValue, formatValue, imageIds, MAX_IMAGES_PER_CELL } from "./schema.js";

const photos = { key: "photos", label: "Photos", type: "image" as const };

describe("image columns", () => {
  it("keep picture ids joined by commas, dropping anything else", () => {
    expect(coerceValue(photos, ["cm1abcdefgh", " cm2abcdefgh "])).toEqual({
      ok: true,
      value: "cm1abcdefgh,cm2abcdefgh",
    });
    expect(coerceValue(photos, "cm1abcdefgh,<script>,https://x.example/a.jpg")).toEqual({
      ok: true,
      value: "cm1abcdefgh",
    });
    expect(coerceValue(photos, "javascript:alert(1)").ok).toBe(false);
    expect(coerceValue(photos, null)).toEqual({ ok: true, value: null });
  });

  it("cap a cell's photos and describe them as a count", () => {
    const many = Array.from(
      { length: 20 },
      (_, index) => `asset_${String(index).padStart(4, "0")}`,
    );
    expect(imageIds(many.join(","))).toHaveLength(MAX_IMAGES_PER_CELL);
    expect(formatValue(photos, "cm1abcdefgh")).toBe("1 photo");
    expect(formatValue(photos, "cm1abcdefgh,cm2abcdefgh")).toBe("2 photos");
  });
});
