import { describe, expect, it } from "vitest";
import { cleanupDue, lastCleanupSlot, nextCleanupSlot } from "./file-cleanup.js";

const daily = { fileCleanupSchedule: "daily", fileCleanupHour: 2, fileCleanupWeekday: 0 } as const;
const at = (iso: string) => Date.parse(iso);

describe("file cleanup schedule", () => {
  it("runs at the chosen UK hour in winter and in summer", () => {
    expect(new Date(lastCleanupSlot(daily, at("2026-11-08T17:00:00Z"))!).toISOString()).toBe(
      "2026-11-08T02:00:00.000Z",
    );
    expect(new Date(lastCleanupSlot(daily, at("2026-07-08T17:00:00Z"))!).toISOString()).toBe(
      "2026-07-08T01:00:00.000Z",
    );
    expect(new Date(nextCleanupSlot(daily, at("2026-11-08T17:00:00Z"))!).toISOString()).toBe(
      "2026-11-09T02:00:00.000Z",
    );
  });

  it("before today's hour, the last run was yesterday's", () => {
    expect(new Date(lastCleanupSlot(daily, at("2026-11-08T01:30:00Z"))!).toISOString()).toBe(
      "2026-11-07T02:00:00.000Z",
    );
  });

  it("runs weekly on the chosen day", () => {
    const weekly = { ...daily, fileCleanupSchedule: "weekly", fileCleanupWeekday: 3 } as const;
    // Sunday 8 November 2026; the Wednesdays either side are the 4th and the 11th.
    expect(new Date(lastCleanupSlot(weekly, at("2026-11-08T17:00:00Z"))!).toISOString()).toBe(
      "2026-11-04T02:00:00.000Z",
    );
    expect(new Date(nextCleanupSlot(weekly, at("2026-11-08T17:00:00Z"))!).toISOString()).toBe(
      "2026-11-11T02:00:00.000Z",
    );
  });

  it("is never due while paused unless an admin asks", () => {
    const off = { ...daily, fileCleanupSchedule: "off" } as const;
    const now = at("2026-11-08T17:00:00Z");
    expect(nextCleanupSlot(off, now)).toBeNull();
    expect(cleanupDue(off, { lastRunAt: null, requestedAt: null }, now)).toBe(false);
    expect(
      cleanupDue(off, { lastRunAt: null, requestedAt: new Date(at("2026-11-08T16:59:00Z")) }, now),
    ).toBe(true);
  });

  it("runs once per scheduled start, and again when asked after it", () => {
    const now = at("2026-11-08T17:00:00Z");
    const ranAt = new Date(at("2026-11-08T02:00:30Z"));
    expect(cleanupDue(daily, { lastRunAt: null, requestedAt: null }, now)).toBe(true);
    expect(cleanupDue(daily, { lastRunAt: ranAt, requestedAt: null }, now)).toBe(false);
    expect(
      cleanupDue(
        daily,
        { lastRunAt: ranAt, requestedAt: new Date(at("2026-11-08T01:00:00Z")) },
        now,
      ),
    ).toBe(false);
    expect(
      cleanupDue(
        daily,
        { lastRunAt: ranAt, requestedAt: new Date(at("2026-11-08T16:00:00Z")) },
        now,
      ),
    ).toBe(true);
  });
});
