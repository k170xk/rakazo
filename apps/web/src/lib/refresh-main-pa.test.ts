import { beforeEach, describe, expect, it, vi } from "vitest";

const update = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("./rpc", () => ({ rpc: { bots: { update } } }));

import { refreshMainPaInstructions } from "./refresh-main-pa";

describe("refreshMainPaInstructions", () => {
  beforeEach(() => update.mockClear());

  it("updates an early Main PA that lacks the continued-interview marker", async () => {
    await expect(
      refreshMainPaInstructions({
        id: "bot-1",
        name: "Rok",
        spawnKey: "onboarding:first",
        instructions: "You are Rok, the user's personal assistant.",
      }),
    ).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith({
      botId: "bot-1",
      instructions: expect.stringContaining("three OCSC agents"),
    });
  });

  it("leaves a current Main PA and ordinary bots alone", async () => {
    await expect(
      refreshMainPaInstructions({
        id: "bot-1",
        name: "Rok",
        spawnKey: "onboarding:first",
        instructions: "… three OCSC agents …",
      }),
    ).resolves.toBe(false);
    await expect(
      refreshMainPaInstructions({
        id: "bot-2",
        name: "Nova",
        spawnKey: null,
        instructions: "Research bot",
      }),
    ).resolves.toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
