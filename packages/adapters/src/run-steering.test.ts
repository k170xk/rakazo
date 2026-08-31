import { describe, expect, it } from "vitest";
import { formatRunSteering, textFromUserBlocks } from "./run-steering.js";

describe("textFromUserBlocks", () => {
  it("reads plain follow-up text", () => {
    expect(textFromUserBlocks([{ kind: "text", text: "We do civil engineering." }])).toBe(
      "We do civil engineering.",
    );
  });
});

describe("formatRunSteering", () => {
  it("asks the live turn to keep the desktop and follow one update", () => {
    expect(formatRunSteering(["  We do civil engineering.  "])).toBe(
      "The user sent an update. Keep this desktop session and follow it now:\nWe do civil engineering.",
    );
  });

  it("lists several updates without starting a new run", () => {
    expect(formatRunSteering(["filter to MEP", "Ireland only"])).toContain("follow them now");
    expect(formatRunSteering(["", "  "])).toBeNull();
  });
});
