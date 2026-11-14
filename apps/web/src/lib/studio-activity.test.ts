import { describe, expect, it } from "vitest";
import { sameStudioCards, studioActivity } from "./studio-activity";

const ask = {
  id: "u1",
  role: "user",
  blocks: [{ kind: "text", text: "Draw the QA workflow" }],
};

describe("studio activity", () => {
  it("keeps the latest messages and marks the current action while a run is live", () => {
    const cards = studioActivity(
      [
        ask,
        {
          id: "b1",
          role: "bot",
          blocks: [
            {
              kind: "steps",
              steps: [
                { label: "Reading the tender" },
                { label: "Drawing the workflow" },
                { label: "Saving the board" },
              ],
            },
          ],
        },
      ],
      true,
    );
    expect(cards.map((card) => [card.who, card.text, card.live])).toEqual([
      ["you", "Draw the QA workflow", false],
      ["action", "Reading the tender", false],
      ["action", "Drawing the workflow", false],
      ["action", "Saving the board", true],
    ]);
  });

  it("uses an app update summary and stays quiet when nothing has happened", () => {
    expect(
      studioActivity(
        [
          {
            id: "b2",
            role: "bot",
            blocks: [{ kind: "page", title: "BIM Register", summary: "Added the overview charts" }],
          },
        ],
        false,
      ),
    ).toEqual([
      { id: "b2:page", who: "action", text: "Added the overview charts", live: false },
    ]);
    expect(studioActivity([], true)).toEqual([]);
  });

  it("treats the same cards as unchanged", () => {
    const cards = studioActivity([ask], false);
    expect(sameStudioCards(cards, studioActivity([ask], false))).toBe(true);
    expect(sameStudioCards(cards, [])).toBe(false);
    expect(sameStudioCards(undefined, [])).toBe(true);
  });
});
