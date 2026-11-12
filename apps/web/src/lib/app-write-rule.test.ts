import { describe, expect, it } from "vitest";
import { appWriteDecision, CLICK_WINDOW_MS } from "./app-write-rule";

const colleague = { canEdit: true, colleague: true, focused: false, msSinceClick: Infinity };

describe("appWriteDecision", () => {
  it("leaves reads and the owner's own app alone", () => {
    expect(appWriteDecision({ ...colleague, op: "init" })).toBe("ok");
    for (const op of ["rows.insert", "rows.update", "rows.remove", "state.set"]) {
      expect(appWriteDecision({ ...colleague, colleague: false, op })).toBe("ok");
    }
  });

  it("skips settings saves and refuses row changes for someone who may only view", () => {
    expect(appWriteDecision({ ...colleague, canEdit: false, op: "state.set" })).toBe("skip");
    expect(appWriteDecision({ ...colleague, canEdit: false, op: "rows.insert" })).toMatch(/view/);
  });

  it("refuses a colleague's app writing as soon as it opens", () => {
    expect(appWriteDecision({ ...colleague, op: "rows.insert" })).toMatch(/Click/);
    expect(appWriteDecision({ ...colleague, op: "rows.update" })).toMatch(/Click/);
    expect(appWriteDecision({ ...colleague, op: "rows.remove" })).toMatch(/Click/);
    expect(appWriteDecision({ ...colleague, op: "state.set" })).toBe("skip");
  });

  it("lets a colleague who is using the app save as they type", () => {
    for (const op of ["rows.insert", "rows.update", "state.set"]) {
      expect(appWriteDecision({ ...colleague, focused: true, op })).toBe("ok");
    }
  });

  it("removes rows only just after a click, which covers a bulk delete", () => {
    const focused = { ...colleague, focused: true };
    expect(appWriteDecision({ ...focused, op: "rows.remove" })).toMatch(/Click/);
    expect(appWriteDecision({ ...focused, op: "rows.remove", msSinceClick: 200 })).toBe("ok");
    expect(
      appWriteDecision({ ...focused, op: "rows.remove", msSinceClick: CLICK_WINDOW_MS + 1 }),
    ).toMatch(/Click/);
  });
});
