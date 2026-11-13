import { describe, expect, it } from "vitest";
import { dailyLimitNotice } from "./run-routines.js";

describe("dailyLimitNotice", () => {
  it("says how often it ran and when it runs again, in the routine's timezone", () => {
    const text = dailyLimitNotice(24, new Date("2026-11-14T08:00:00Z"), "Europe/Dublin");
    expect(text).toMatch(/run 24 times in the last 24 hours/);
    expect(text).toMatch(/Sat/);
    expect(text).toMatch(/08:00/);
    expect(dailyLimitNotice(1, new Date("2026-11-14T08:00:00Z"), "Europe/Dublin")).toMatch(
      /run once/,
    );
  });

  it("still reads when the timezone is not one the runtime knows", () => {
    expect(dailyLimitNotice(2, new Date("2026-11-14T08:00:00Z"), "Mars/Base")).toMatch(
      /until 2026-11-14 08:00/,
    );
  });
});
