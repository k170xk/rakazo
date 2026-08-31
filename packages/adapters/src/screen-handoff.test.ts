import { describe, expect, it } from "vitest";
import { isScreenHandoffAskBlock } from "@rakazo/core";
import { buildScreenHandoffAskBlock } from "./screen-handoff.js";

describe("buildScreenHandoffAskBlock", () => {
  it("asks the user to let this bot take the shared desktop", () => {
    const block = buildScreenHandoffAskBlock("Writer");
    expect(isScreenHandoffAskBlock(block)).toBe(true);
    expect(block).toMatchObject({
      kind: "ask",
      input: "screen_handoff",
      text: "Writer needs the shared desktop. Another session is using it.",
      status: "pending",
    });
    expect(block.kind === "ask" && block.actions?.map((action) => action.id)).toEqual([
      "allow",
      "deny",
    ]);
  });
});
