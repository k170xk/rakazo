import { describe, expect, it } from "vitest";
import { pickUnusedVoice } from "./voice-assignment";

const voices = ["en-us-x-iob-local", "en-us-x-iog-local", "en-us-x-iol-local", "en-us-x-iom-local"];

describe("pickUnusedVoice", () => {
  it("gives each agent a voice no other agent has while voices last", () => {
    const taken = new Set<string>();
    for (const botId of ["bot-a", "bot-b", "bot-c", "bot-d"]) {
      const voice = pickUnusedVoice(voices, taken, botId);
      expect(taken.has(voice)).toBe(false);
      taken.add(voice);
    }
    expect(taken.size).toBe(voices.length);
  });

  it("is stable for the same agent and the same free voices", () => {
    expect(pickUnusedVoice(voices, new Set(), "bot-b")).toBe(
      pickUnusedVoice(voices, new Set(), "bot-b"),
    );
  });

  it("shares a voice once every voice is taken", () => {
    expect(voices).toContain(pickUnusedVoice(voices, new Set(voices), "late-bot"));
  });
});
