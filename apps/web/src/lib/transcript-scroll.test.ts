import { describe, expect, it } from "vitest";
import {
  TRANSCRIPT_AUTOLOAD_TOP_PX,
  transcriptCanSnapAfterFrame,
  transcriptIsNearEnd,
  transcriptMovedDown,
  transcriptShouldAutoloadOlder,
} from "./transcript-scroll.js";

describe("transcriptIsNearEnd", () => {
  it("follows only while the viewport is within 80px of the latest message", () => {
    expect(transcriptIsNearEnd({ scrollHeight: 1_000, scrollTop: 421, clientHeight: 500 })).toBe(
      true,
    );
    expect(transcriptIsNearEnd({ scrollHeight: 1_000, scrollTop: 420, clientHeight: 500 })).toBe(
      false,
    );
  });
});

describe("transcriptCanSnapAfterFrame", () => {
  it("does not snap after the reader moves while the frame is queued", () => {
    const transcript = { scrollTop: 950 };
    expect(transcriptCanSnapAfterFrame(transcript, transcript, 950)).toBe(true);
    transcript.scrollTop = 920;
    expect(transcriptCanSnapAfterFrame(transcript, transcript, 950)).toBe(false);
  });

  it("does not snap a replacement transcript", () => {
    const queuedTranscript = { scrollTop: 950 };
    const replacementTranscript = { scrollTop: 950 };
    expect(transcriptCanSnapAfterFrame(replacementTranscript, queuedTranscript, 950)).toBe(false);
  });
});

describe("transcriptMovedDown", () => {
  it("does not treat an uninitialized baseline as downward movement", () => {
    expect(transcriptMovedDown(null, 920)).toBe(false);
    expect(transcriptMovedDown(950, 920)).toBe(false);
    expect(transcriptMovedDown(920, 950)).toBe(true);
  });
});

describe("transcriptShouldAutoloadOlder", () => {
  it("triggers when scrolling upward into the top threshold of an overflowing transcript", () => {
    expect(
      transcriptShouldAutoloadOlder(
        { scrollHeight: 2_000, scrollTop: TRANSCRIPT_AUTOLOAD_TOP_PX, clientHeight: 600 },
        TRANSCRIPT_AUTOLOAD_TOP_PX + 20,
      ),
    ).toBe(true);
    expect(
      transcriptShouldAutoloadOlder({ scrollHeight: 2_000, scrollTop: 0, clientHeight: 600 }, 40),
    ).toBe(true);
  });

  it("does not trigger when below the threshold, moving downward, uninitialized, or not overflowing", () => {
    expect(
      transcriptShouldAutoloadOlder(
        { scrollHeight: 2_000, scrollTop: TRANSCRIPT_AUTOLOAD_TOP_PX + 1, clientHeight: 600 },
        TRANSCRIPT_AUTOLOAD_TOP_PX + 40,
      ),
    ).toBe(false);
    expect(
      transcriptShouldAutoloadOlder({ scrollHeight: 2_000, scrollTop: 80, clientHeight: 600 }, 40),
    ).toBe(false);
    expect(
      transcriptShouldAutoloadOlder({ scrollHeight: 2_000, scrollTop: 0, clientHeight: 600 }, null),
    ).toBe(false);
    expect(
      transcriptShouldAutoloadOlder({ scrollHeight: 500, scrollTop: 0, clientHeight: 600 }, 20),
    ).toBe(false);
  });
});
