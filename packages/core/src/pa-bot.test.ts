import { describe, expect, it } from "vitest";
import {
  EVOLVE_GENERAL_INTELLIGENCE_NAME,
  emailSpecialistInstructions,
  isMainPaBot,
  LEGACY_FIRST_BOT_NAMES,
  marketingSpecialistInstructions,
  ONBOARDING_FIRST_BOT_SPAWN_KEY,
  paBotDescription,
  paBotInstructions,
  paBotIntroPrompt,
  paBotTeamInstructions,
  qaSpecialistInstructions,
  researchSpecialistInstructions,
  runsPaAgentSetup,
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

  it("writes standing PA instructions that offer four OCSC agents from the CV", () => {
    const text = paBotInstructions("Rex");
    expect(text).toContain("You are Rex");
    expect(text).toContain("chief of staff");
    expect(text).toContain("search_history");
    expect(text).toContain("Discipline");
    expect(text).toContain("OCSC Email agent");
    expect(text).toContain("OCSC Marketing agent");
    expect(text).toContain("OCSC Research agent");
    expect(text).toContain("spawn_bot");
    expect(text).toContain("four OCSC agents");
    expect(text).toContain("Leave the spawn name empty");
    expect(text).toContain("Creating an agent never ends the setup");
    expect(text).toContain("Weekday mornings at 8:30");
    expect(text).toContain("What should it make most often?");
    expect(text).toContain("Never offer a generic construction roundup");
    expect(text).toContain("Do not rename yourself");
  });

  it("knows which Main PA is still running the organisation agent setup", () => {
    const spawnKey = "onboarding:first";
    expect(runsPaAgentSetup({ spawnKey, instructions: paBotInstructions("Max") })).toBe(true);
    expect(runsPaAgentSetup({ spawnKey, instructions: paBotTeamInstructions("Max") })).toBe(false);
    expect(runsPaAgentSetup({ spawnKey: null, instructions: paBotInstructions("Max") })).toBe(
      false,
    );
  });

  it("writes Email specialist instructions for mail, todos and routines", () => {
    const text = emailSpecialistInstructions("Keith");
    expect(text).toContain("Keith's OCSC Email agent");
    expect(text).toContain("source_kind email");
    expect(text).toContain("schedule_create");
    expect(text).toContain("Never send");
  });

  it("writes a read-only QA agent that digests the person's tracker projects", () => {
    const qa = qaSpecialistInstructions("Keith");
    expect(qa).toContain("Keith's OCSC QA agent");
    expect(qa).toContain('find_tracker_projects returns with person "me"');
    expect(qa).toContain("get_project_details");
    expect(qa).toContain("peer review");
    expect(qa).toContain("design risk assessment");
    expect(qa).toContain("PSDP");
    expect(qa).toContain("Never add, change or delete");
    expect(paBotInstructions("Max")).toContain("Set up an OCSC QA agent?");
    expect(
      paBotIntroPrompt({ userName: "Keith", spaceName: null, disabledBuiltinTools: [] }),
    ).toContain("How often should it send the QA digest?");
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
    expect(prompt).toContain("Leave the spawn name empty");
    expect(prompt).toContain("Creating an agent never ends the setup");
    expect(prompt).toContain("Weekday mornings at 8:30");
    expect(prompt).toContain("Never offer a generic construction roundup");
    expect(prompt).toContain("Milo");
    expect(prompt).not.toContain("what they want you for");
  });

  it("asks what a new team is for and skips the agent setup", () => {
    const text = paBotTeamInstructions("Nova");
    expect(text).toContain("You are Nova");
    expect(text).toContain("Do not run the organisation agent setup");
    expect(text).not.toContain("Set them up");
    const prompt = paBotIntroPrompt({
      userName: "Keith",
      spaceName: "Bridges",
      disabledBuiltinTools: [],
      botName: "Nova",
      setupAgents: false,
    });
    expect(prompt).toContain("what they want this team for");
    expect(prompt).toContain("Bridges");
    expect(prompt).toContain("Do not run the organisation agent setup");
    expect(prompt).not.toContain("OCSC Email agent");
  });
});
