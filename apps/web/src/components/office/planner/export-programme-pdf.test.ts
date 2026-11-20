import { describe, expect, it } from "vitest";
import { pickProgrammeSheetSize } from "./export-programme-pdf";

describe("pickProgrammeSheetSize", () => {
  it("picks A4 for a short programme", () => {
    expect(pickProgrammeSheetSize({ taskCount: 20, spanDays: 60 })).toBe("a4");
  });

  it("picks A3 for a mid-size programme like Ballyraggett", () => {
    expect(pickProgrammeSheetSize({ taskCount: 58, spanDays: 300 })).toBe("a3");
  });

  it("picks A1 for Mountjoy / Charleville-scale programmes", () => {
    expect(pickProgrammeSheetSize({ taskCount: 184, spanDays: 1500 })).toBe("a1");
    expect(pickProgrammeSheetSize({ taskCount: 200, spanDays: 620 })).toBe("a1");
  });

  it("falls back to A0 when even A1 is cramped", () => {
    expect(pickProgrammeSheetSize({ taskCount: 400, spanDays: 2500 })).toBe("a0");
  });
});
