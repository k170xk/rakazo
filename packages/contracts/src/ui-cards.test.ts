import { describe, expect, it } from "vitest";
import { MessageBlock } from "./events.js";
import { UiCard, uiCardText } from "./ui-cards.js";

describe("UiCard", () => {
  it("accepts each card type the show_card tool offers", () => {
    const cards = [
      {
        type: "record",
        title: "HEL18",
        status: "Live",
        tone: "positive",
        fields: [{ label: "Client", value: "DLR" }],
      },
      { type: "metrics", title: "Fees", metrics: [{ label: "Won", value: "£42k", change: "+8%" }] },
      { type: "checklist", title: "Submission", items: [{ text: "Method statement", done: true }] },
      { type: "notice", title: "Deadline", body: "Friday at noon", tone: "caution" },
      { type: "table", title: "Bids", columns: ["Name", "Value"], rows: [["A", "1"]] },
      { type: "quote", quote: "Connected information.", attribution: "Keith" },
    ];
    for (const card of cards) {
      expect(MessageBlock.safeParse({ kind: "ui_card", card }).success).toBe(true);
    }
  });

  it("rejects a table row with the wrong number of cells", () => {
    const parsed = UiCard.safeParse({
      type: "table",
      title: "Bids",
      columns: ["Name", "Value"],
      rows: [["A"]],
    });
    expect(parsed.success).toBe(false);
  });

  it("summarises a card as text for later turns", () => {
    expect(
      uiCardText({
        type: "checklist",
        title: "Submission",
        items: [
          { text: "Method statement", done: true },
          { text: "Pricing", done: false },
        ],
      }),
    ).toBe("Submission; [x] Method statement; [ ] Pricing");
  });
});
