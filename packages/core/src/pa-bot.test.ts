import { describe, expect, it } from "vitest";
import {
  EVOLVE_GENERAL_INTELLIGENCE_NAME,
  emailSpecialistInstructions,
  isMainPaBot,
  marketingSpecialistInstructions,
  researchSpecialistInstructions,
  LEGACY_FIRST_BOT_NAMES,
  ONBOARDING_FIRST_BOT_SPAWN_KEY,
  paBotDescription,
  paBotInstructions,
  paBotIntroPrompt,
} from "./pa-bot.js";

describe("pa-bot", () => {
  it("marks only the onboarding first spawn key as Main PA", () => {
    expect(isMainPaBot({ spawnKey: ONBOARDING_FIRST_BOT_SPAWN_KEY })).toBe(true);
    expect(isMainPaBot({ spawnKey: null })).toBe(false);
    expect(isMainPaBot({ spawnKey: "tool-call-1" })).toBe(false);
  });

  it("builds a first-name PA description", () => {
    expect(paBotDescription("Keith Cronin")).toBe("Keith's PA");
    expect(paBotDescription("  Ada  Lovelace ")).toBe("Ada's PA");
    expect(paBotDescription("")).toBe("Your PA");
    expect(paBotDescription("___")).toBe("Your PA");
  });

  it("keeps legacy first-bot names for reuse", () => {
    expect(LEGACY_FIRST_BOT_NAMES.has(EVOLVE_GENERAL_INTELLIGENCE_NAME)).toBe(true);
    expect(LEGACY_FIRST_BOT_NAMES.has("Chief")).toBe(true);
  });

  it("writes standing PA instructions that offer three OCSC agents from the CV", () => {
    const text = paBotInstructions("Rex");
    expect(text).toContain("You are Rex");
    expect(text).toContain("chief of staff");
    expect(text).toContain("search_history");
    expect(text).toContain("Discipline");
    expect(text).toContain("OCSC Email agent");
    expect(text).toContain("OCSC Marketing agent");
    expect(text).toContain("OCSC Research agent");
    expect(text).toContain("spawn_bot");
    expect(text).toContain("three OCSC agents");
    expect(text).not.toContain("construction-news");
    expect(text).toContain("Do not rename yourself");
  });

  it("writes Email specialist instructions for mail, todos and routines", () => {
    const text = emailSpecialistInstructions("Keith");
    expect(text).toContain("Keith's OCSC Email agent");
    expect(text).toContain("source_kind email");
    expect(text).toContain("schedule_create");
    expect(text).toContain("Never send");
  });

  it("writes Marketing and Research agent instructions", () => {
    expect(marketingSpecialistInstructions("Keith")).toContain("documents and presentations");
    const research = researchSpecialistInstructions("Keith", "structural engineering");
    expect(research).toContain("structural engineering");
    expect(research).toContain("upskilling researcher");
    expect(research).toContain("generic construction roundup");
  });

  it("writes a PA intro that interviews and offers specialists", () => {
    const prompt = paBotIntroPrompt({
      userName: "Keith",
      spaceName: null,
      disabledBuiltinTools: [],
      botName: "Milo",
    });
    expect(prompt).toContain("personal assistant");
    expect(prompt).toContain("ask_user");
    expect(prompt).toContain("OCSC Email agent");
    expect(prompt).toContain("OCSC Marketing agent");
    expect(prompt).toContain("OCSC Research agent");
    expect(prompt).toContain("Discipline");
    expect(prompt).toContain("Do not stop after the first card");
    expect(prompt).not.toContain("construction-news");
    expect(prompt).toContain("Milo");
    expect(prompt).not.toContain("what they want you for");
  });
});
