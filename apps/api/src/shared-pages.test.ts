import { describe, expect, it } from "vitest";
import { sharedStateWritable } from "./shared-pages.js";

describe("sharedStateWritable", () => {
  it("never lets someone who opened the link with only its password save", () => {
    expect(sharedStateWritable("page", "company", null)).toBe(false);
    expect(sharedStateWritable("app", "company", null)).toBe(false);
  });

  it("lets a signed-in colleague save a page's values", () => {
    expect(sharedStateWritable("page", "owner", "user-1")).toBe(true);
  });

  it("follows an app's data setting", () => {
    expect(sharedStateWritable("app", "company", "user-1")).toBe(true);
    expect(sharedStateWritable("app", "owner", "user-1")).toBe(false);
    expect(sharedStateWritable("app", "contribute", "user-1")).toBe(false);
  });
});
