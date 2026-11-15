import { describe, expect, it } from "vitest";
import {
  documentLoadErrorReason,
  formatLoadBytes,
  loadPercent,
} from "./document-load";

describe("documentLoadErrorReason", () => {
  it("classifies network, stall, truncate and abort failures", () => {
    expect(documentLoadErrorReason(new DOMException("x", "AbortError"))).toBe("aborted");
    expect(documentLoadErrorReason(new Error("Download stalled after 12 bytes"))).toBe("stalled");
    expect(documentLoadErrorReason(new Error("Download truncated (3 of 10 bytes)"))).toBe(
      "truncated",
    );
    expect(documentLoadErrorReason(new Error("Download returned 410"))).toBe("network");
    expect(documentLoadErrorReason(new Error("Failed to fetch"))).toBe("network");
    expect(documentLoadErrorReason(new Error("bad zip"))).toBe("unknown");
  });
});

describe("formatLoadBytes / loadPercent", () => {
  it("formats sizes and percent for the loading pill", () => {
    expect(formatLoadBytes(512)).toBe("512 B");
    expect(formatLoadBytes(2048)).toBe("2.0 KB");
    expect(formatLoadBytes(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(loadPercent(50, 100)).toBe(50);
    expect(loadPercent(10, null)).toBeNull();
  });
});
