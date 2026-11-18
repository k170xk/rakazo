import { describe, expect, it } from "vitest";
import { fitNav, navEntries, navModeFor } from "./nav-fit.js";

describe("navModeFor", () => {
  it("lays the bar out for phones, iPads and desktops", () => {
    expect(navModeFor(390)).toBe("phone");
    expect(navModeFor(639)).toBe("phone");
    expect(navModeFor(640)).toBe("tablet");
    expect(navModeFor(820)).toBe("tablet");
    expect(navModeFor(1023)).toBe("tablet");
    expect(navModeFor(1024)).toBe("desktop");
    expect(navModeFor(1440)).toBe("desktop");
  });
});

describe("navEntries", () => {
  it("gathers pages of one group where the first of them stands", () => {
    const entries = navEntries([
      { id: "overview" },
      { id: "register", group: "Records" },
      { id: "map" },
      { id: "photos", group: "records" },
    ]);
    expect(entries).toEqual([
      { kind: "page", item: { id: "overview" } },
      {
        kind: "group",
        label: "Records",
        items: [
          { id: "register", group: "Records" },
          { id: "photos", group: "records" },
        ],
      },
      { kind: "page", item: { id: "map" } },
    ]);
  });

  it("shows a group of one as its page", () => {
    expect(
      navEntries([
        { id: "a", group: "Solo" },
        { id: "b", group: "  " },
      ]),
    ).toEqual([
      { kind: "page", item: { id: "a", group: "Solo" } },
      { kind: "page", item: { id: "b", group: "  " } },
    ]);
  });
});

describe("fitNav", () => {
  const widths = [100, 100, 100, 100, 100];

  it("shows every tab when they fit", () => {
    expect(fitNav({ widths, moreWidth: 60, available: 520, gap: 4, selected: 0 })).toEqual({
      shown: [0, 1, 2, 3, 4],
      more: [],
    });
  });

  it("moves the tabs that do not fit under More", () => {
    expect(fitNav({ widths, moreWidth: 60, available: 400, gap: 4, selected: 0 })).toEqual({
      shown: [0, 1, 2],
      more: [3, 4],
    });
  });

  it("keeps the open page in the bar when it would have gone under More", () => {
    expect(fitNav({ widths, moreWidth: 60, available: 400, gap: 4, selected: 4 })).toEqual({
      shown: [0, 1, 4],
      more: [2, 3],
    });
  });

  it("makes room for a wider open tab", () => {
    expect(
      fitNav({ widths: [40, 40, 40, 120, 40], moreWidth: 40, available: 220, gap: 4, selected: 3 }),
    ).toEqual({ shown: [0, 3], more: [1, 2, 4] });
  });

  it("puts everything under More when even one tab cannot fit", () => {
    expect(fitNav({ widths, moreWidth: 60, available: 100, gap: 4, selected: 2 })).toEqual({
      shown: [],
      more: [0, 1, 2, 3, 4],
    });
  });
});
