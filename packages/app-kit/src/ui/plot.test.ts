import { describe, expect, it } from "vitest";
import { linear, monotonePath, niceTicks, roundedRect } from "./plot.js";

describe("niceTicks", () => {
  it("covers the data with round steps from zero", () => {
    expect(niceTicks(0, 187_000)).toEqual([0, 50_000, 100_000, 150_000, 200_000]);
    expect(niceTicks(3, 9)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it("spans negatives and keeps zero on the axis", () => {
    const ticks = niceTicks(-40, 90);
    expect(ticks[0]).toBeLessThanOrEqual(-40);
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(90);
    expect(ticks).toContain(0);
  });

  it("still draws an axis for empty or flat data", () => {
    expect(niceTicks(0, 0)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(Number.NaN, Number.NaN)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(5, 5).at(-1)).toBeGreaterThanOrEqual(5);
  });

  it("does not leave floating-point noise in tick values", () => {
    expect(niceTicks(0, 0.7)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
  });
});

describe("linear", () => {
  it("maps the domain onto the range, including an inverted one for y", () => {
    const y = linear([0, 100], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(50)).toBe(100);
    expect(y(100)).toBe(0);
  });
});

describe("monotonePath", () => {
  it("draws nothing, a point, a line, then smooth curves", () => {
    expect(monotonePath([])).toBe("");
    expect(monotonePath([[1, 2]])).toBe("M1,2");
    expect(
      monotonePath([
        [0, 0],
        [10, 10],
      ]),
    ).toBe("M0,0L10,10");
    const path = monotonePath([
      [0, 10],
      [10, 0],
      [20, 5],
    ]);
    expect(path.startsWith("M0,10C")).toBe(true);
    expect(path.match(/C/g)).toHaveLength(2);
    expect(path.endsWith(",20,5")).toBe(true);
  });

  it("never overshoots a flat stretch (monotone)", () => {
    const path = monotonePath([
      [0, 50],
      [10, 50],
      [20, 50],
      [30, 0],
    ]);
    const ys = [...path.matchAll(/[ ,C]-?\d+(?:\.\d+)?,(-?\d+(?:\.\d+)?)/g)].map((match) =>
      Number(match[1]),
    );
    expect(Math.max(...ys)).toBeLessThanOrEqual(50);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  });

  it("continues a path with L when asked not to move", () => {
    expect(
      monotonePath(
        [
          [0, 0],
          [5, 5],
        ],
        false,
      ).startsWith("L0,0"),
    ).toBe(true);
  });
});

describe("roundedRect", () => {
  it("rounds only the corners asked for and clamps the radius to the bar", () => {
    expect(roundedRect(0, 0, 20, 30, [6, 6, 0, 0])).toBe(
      "M6,0H14A6,6 0 0 1 20,6V30H0V6A6,6 0 0 1 6,0Z",
    );
    expect(roundedRect(0, 0, 4, 20, [6, 6, 0, 0])).toContain("A2,2");
  });

  it("draws nothing for an empty bar", () => {
    expect(roundedRect(0, 0, 0, 10, [6, 6, 0, 0])).toBe("");
    expect(roundedRect(0, 0, 10, 0, [6, 6, 0, 0])).toBe("");
  });
});
