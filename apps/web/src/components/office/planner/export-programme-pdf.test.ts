import { describe, expect, it } from "vitest";
import {
  exportProgrammePdf,
  PROGRAMME_PDF_COLORS,
  pickProgrammeSheetSize,
} from "./export-programme-pdf";
import {
  saveBaselineSnapshot,
  setTaskPriority,
  setTaskProgress,
  setTaskStatus,
  upsertPlanNote,
} from "./filters";
import type { PlanDocument } from "./plan";

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

describe("exportProgrammePdf", () => {
  it("exports plans cleanly after status, priority, progress, baseline and note updates", async () => {
    const base: PlanDocument = {
      title: "Bridge Replacement",
      categories: { civils: { label: "Civils", color: "#5B9BD5" } },
      tasks: [
        {
          id: "t1",
          label: "Site mobilisation",
          category: "civils",
          start: "2027-02-01",
          end: "2027-02-12",
          progress: 0,
        },
        {
          id: "t2",
          label: "Deck pour",
          category: "civils",
          start: "2027-02-15",
          end: "2027-02-26",
          dependencies: ["t1"],
          progress: 0,
        },
      ],
    };
    const enriched = upsertPlanNote(
      saveBaselineSnapshot(
        setTaskPriority(
          setTaskProgress(setTaskStatus(base, "t1", "in-progress"), "t1", 0.5),
          "t2",
          "urgent",
        ),
        "Tender baseline",
      ),
      { title: "Site constraints", content: "Weekend track possession required." },
    ).plan;

    const result = await exportProgrammePdf(enriched, { fileName: "Bridge-Replacement.jantt" });
    expect(result.fileName).toBe("Bridge-Replacement.pdf");
    expect(result.sheet).toBe("a4");
    expect(result.pages).toBe(1);
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("uses OCSC brand green for programme bars and progress overlay", () => {
    expect(PROGRAMME_PDF_COLORS.task).toBe("#76BF43");
    expect(PROGRAMME_PDF_COLORS.progress).toBe("#4B8A22");
    expect(PROGRAMME_PDF_COLORS.summaryBg).toBe("#E9F5DF");
  });
});
