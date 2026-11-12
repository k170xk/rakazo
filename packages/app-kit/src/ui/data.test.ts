import { describe, expect, it } from "vitest";
import { inPeriod, periodChange, readJson } from "./data.js";

const now = Date.parse("2026-11-12T12:00:00Z");
const day = (offset: number) => new Date(now - offset * 86_400_000).toISOString();
const rows = [
  { date: day(2), fee: 100 },
  { date: day(10), fee: 50 },
  { date: day(40), fee: 60 },
  { date: day(50), fee: 20 },
  { date: "not a date", fee: 999 },
];

describe("periods", () => {
  it("keeps rows inside the period", () => {
    expect(inPeriod(rows, "date", "30d", now).map((row) => row.fee)).toEqual([100, 50]);
    expect(inPeriod(rows, "date", "all", now)).toHaveLength(5);
  });

  it("compares a period with the one before it in percent", () => {
    expect(periodChange(rows, "date", "30d", "fee", now)).toEqual({
      value: 150,
      previous: 80,
      delta: 87.5,
    });
    expect(periodChange(rows, "date", "30d", undefined, now)).toEqual({
      value: 2,
      previous: 2,
      delta: 0,
    });
    expect(periodChange(rows, "date", "7d", "fee", now).delta).toBe(100);
    expect(periodChange([{ date: day(1), fee: 5 }], "date", "7d", "fee", now).delta).toBeNull();
  });

  it("reads JSON columns with a fallback", () => {
    expect(readJson('{"a":{"result":"pass"}}', {})).toEqual({ a: { result: "pass" } });
    expect(readJson("not json", { none: true })).toEqual({ none: true });
    expect(readJson(null, [])).toEqual([]);
  });
});
