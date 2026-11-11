import { BOT_NAME_IDEAS } from "@rakazo/core";
import { describe, expect, it } from "vitest";
import {
  EVOLVE_GENERAL_INTELLIGENCE_NAME,
  findFirstBot,
  firstPaBotCreateInput,
  ONBOARDING_FIRST_BOT_SPAWN_KEY,
} from "./onboarding-first-bot";

describe("findFirstBot", () => {
  it("reuses the onboarding spawn key before legacy names", () => {
    expect(
      findFirstBot([
        { id: "legacy", name: "Chief", spawnKey: null },
        { id: "pa", name: "Rex", spawnKey: ONBOARDING_FIRST_BOT_SPAWN_KEY, pinned: true },
      ]),
    ).toEqual({ id: "pa", pinned: true });
  });

  it("reuses legacy General Intelligence and Chief without creating another", () => {
    expect(
      findFirstBot([{ id: "gi", name: EVOLVE_GENERAL_INTELLIGENCE_NAME, spawnKey: null }]),
    ).toEqual({ id: "gi", pinned: undefined });
    expect(findFirstBot([{ id: "chief", name: "Chief", spawnKey: null, pinned: false }])).toEqual({
      id: "chief",
      pinned: false,
    });
  });

  it("returns nothing when there is no first bot yet", () => {
    expect(findFirstBot([{ id: "other", name: "Nova", spawnKey: null }])).toBeUndefined();
  });
});

describe("firstPaBotCreateInput", () => {
  it("picks a short name, PA description, standing instructions and spawn key", () => {
    const created = firstPaBotCreateInput({
      existingNames: [],
      userDisplayName: "Keith Cronin",
      random: () => 0,
    });
    expect(created.name).toBe(BOT_NAME_IDEAS[0]);
    expect(created.description).toBe("Keith's PA");
    expect(created.spawnKey).toBe(ONBOARDING_FIRST_BOT_SPAWN_KEY);
    expect(created.instructions).toContain(`You are ${created.name}`);
    expect(created.instructions).toContain("OCSC Email agent");
    expect(created.instructions).toContain("OCSC Marketing agent");
    expect(created.instructions).toContain("OCSC Research agent");
    expect(created.notifyOnFinish).toBe(true);
  });

  it("skips the agent setup for a team inside the organisation", () => {
    const created = firstPaBotCreateInput({
      existingNames: [],
      userDisplayName: "Keith Cronin",
      team: true,
      random: () => 0,
    });
    expect(created.instructions).toContain("Do not run the three-agent setup");
    expect(created.instructions).not.toContain("Set them up");
  });

  it("attaches an Evolve assistant id only for knowledge", () => {
    expect(
      firstPaBotCreateInput({
        existingNames: ["Rex"],
        userDisplayName: "Ada",
        evolveAssistantId: "11111111-1111-1111-1111-111111111111",
        random: () => 0,
      }).evolveAssistantId,
    ).toBe("11111111-1111-1111-1111-111111111111");
  });
});
