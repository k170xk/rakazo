import { sniffUploadMime } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import { readUploadBody } from "./apps.js";

describe("app photo uploads", () => {
  it("know a picture by its bytes, not its name", () => {
    expect(sniffUploadMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0]))).toBe("image/jpeg");
    expect(sniffUploadMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png");
    const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
    expect(sniffUploadMime(webp)).toBe("image/webp");
    expect(sniffUploadMime(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffUploadMime(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
  });

  it("accept only plain base64 bodies of photo size", () => {
    expect(readUploadBody({ name: "a.jpg", base64: "/9j/4AAQ" })).toEqual({
      name: "a.jpg",
      base64: "/9j/4AAQ",
    });
    expect(readUploadBody({ base64: "/9j/4AAQ" })?.name).toBe("photo");
    expect(readUploadBody({ base64: "not base64!" })).toBeNull();
    expect(readUploadBody({ base64: "A".repeat(6_000_000) })).toBeNull();
    expect(readUploadBody(null)).toBeNull();
  });
});
