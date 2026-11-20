import { describe, expect, it } from "vitest";
import { fitMonthLabels, visibleMarkers } from "./header-fit";

const perChar = (text: string) => text.length * 8;
const one = (full: string, available: number) => fitMonthLabels([{ full, available }], perChar)[0];

describe("fitMonthLabels", () => {
  it("shortens to three letters, then one, then nothing", () => {
    expect(one("September", 100)).toBe("September");
    expect(one("September", 30)).toBe("Sep");
    expect(one("September", 10)).toBe("S");
    expect(one("September", 4)).toBe("");
  });

  it("keeps a short year with the month when there is room", () => {
    expect(one("March 2027", 60)).toBe("Mar '27");
  });

  it("drops labels it cannot shorten", () => {
    expect(one("Q1 2027", 20)).toBe("");
  });

  it("uses one shared form so months match", () => {
    const labels = fitMonthLabels(
      [
        { full: "March", available: 40 },
        { full: "April", available: 40 },
        { full: "January", available: 40 },
        { full: "May", available: 40 },
      ],
      perChar,
    );
    expect(labels).toEqual(["Mar", "Apr", "Jan", "May"]);
  });

  it("lets a cut-off first or last month shorten on its own", () => {
    const labels = fitMonthLabels(
      [
        { full: "March", available: 10 },
        { full: "April", available: 60 },
        { full: "May", available: 60 },
      ],
      perChar,
    );
    expect(labels).toEqual(["M", "April", "May"]);
  });
});

describe("visibleMarkers", () => {
  it("keeps markers that do not touch", () => {
    expect([...visibleMarkers([{ center: 10, width: 18, priority: 1 }, { center: 40, width: 18, priority: 1 }])]).toEqual([0, 1]);
  });

  it("hides the later of two overlapping markers", () => {
    expect([...visibleMarkers([{ center: 10, width: 18, priority: 1 }, { center: 20, width: 18, priority: 1 }])]).toEqual([0]);
  });

  it("lets today and task dates win over month starts", () => {
    const kept = visibleMarkers([
      { center: 14, width: 18, priority: 2 },
      { center: 18, width: 18, priority: 1 },
      { center: 30, width: 18, priority: 0 },
    ]);
    expect([...kept].sort()).toEqual([2]);
  });
});
