import { describe, expect, it } from "vitest";
import {
  EVOLVE_GENERAL_INTELLIGENCE_NAME,
  isMainPaBot,
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

  it("writes standing PA instructions that keep the short name and recommend email", () => {
    const text = paBotInstructions("Rex");
    expect(text).toContain("You are Rex");
    expect(text).toContain("chief of staff");
    expect(text).toContain("search_history");
    expect(text).toContain("Email specialist");
    expect(text).toContain("spawn_bot");
    expect(text).toContain("Do not rename yourself");
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
    expect(prompt).toContain("Email specialist");
    expect(prompt).toContain("Milo");
    expect(prompt).not.toContain("what they want you for");
  });
});
