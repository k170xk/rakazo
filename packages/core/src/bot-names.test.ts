import { describe, expect, it } from "vitest";
import { BOT_NAME_IDEAS, suggestBotName } from "./bot-names.js";

describe("suggestBotName", () => {
  it("offers only short names", () => {
    expect(BOT_NAME_IDEAS.length).toBeGreaterThan(40);
    for (const name of BOT_NAME_IDEAS) expect(name).toMatch(/^[A-Z][a-z]{2,3}$/);
    expect(new Set(BOT_NAME_IDEAS).size).toBe(BOT_NAME_IDEAS.length);
  });

  it("skips names the person's agents already use, ignoring case", () => {
    const taken = BOT_NAME_IDEAS.filter((name) => name !== "Nova").map((name) =>
      name.toUpperCase(),
    );
    expect(suggestBotName(taken)).toBe("Nova");
  });

  it("adds a number once every idea is in use", () => {
    const taken = [...BOT_NAME_IDEAS, `${BOT_NAME_IDEAS[0]} 2`];
    expect(suggestBotName(taken, () => 0)).toBe(`${BOT_NAME_IDEAS[0]} 3`);
  });
});
