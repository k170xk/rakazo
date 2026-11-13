import { describe, expect, it } from "vitest";
import { sameCompanyEmail, sharedStateWritable } from "./shared-pages.js";

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

describe("sameCompanyEmail", () => {
  it("treats OCSC's UK and Irish staff as one company", () => {
    expect(sameCompanyEmail("ann@ocsc.co.uk", "bob@ocsc.ie")).toBe(true);
    expect(sameCompanyEmail("Ann@OCSC.ie", "bob@ocsc.ie")).toBe(true);
  });

  it("keeps other companies to their own domain", () => {
    expect(sameCompanyEmail("ann@example.com", "bob@example.com")).toBe(true);
    expect(sameCompanyEmail("ann@gmail.com", "bob@ocsc.co.uk")).toBe(false);
    expect(sameCompanyEmail("ann@ocsc.co.uk.evil.com", "bob@ocsc.co.uk")).toBe(false);
    expect(sameCompanyEmail("ann@example.com", "bob@other.com")).toBe(false);
    expect(sameCompanyEmail("", "bob@ocsc.co.uk")).toBe(false);
  });
});
