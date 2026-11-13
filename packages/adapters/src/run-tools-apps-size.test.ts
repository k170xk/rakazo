import { describe, expect, it } from "vitest";
import { appSize, HEAVY_APP_BYTES } from "./run-tools-apps.js";

describe("appSize", () => {
  it("stays quiet for a light app", () => {
    expect(appSize({ bytes: HEAVY_APP_BYTES, weight: [{ part: "react", kb: 190 }] })).toBeNull();
  });

  it("names recharts when an app imported it directly", () => {
    const size = appSize({
      bytes: 820_000,
      weight: [
        { part: "recharts", kb: 380 },
        { part: "react", kb: 190 },
      ],
    });
    expect(size?.kb).toBe(820);
    expect(size?.largest[0]).toEqual({ part: "recharts", kb: 380 });
    expect(size?.hint).toContain("380 KB");
  });

  it("points at data in code otherwise", () => {
    expect(appSize({ bytes: 700_000, weight: [{ part: "app code", kb: 400 }] })?.hint).toContain(
      "tables",
    );
  });
});
