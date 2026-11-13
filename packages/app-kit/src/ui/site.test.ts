import { describe, expect, it } from "vitest";
import { dayNumber, dayText } from "./gantt.js";
import type { LatLon } from "./map.js";
import { areaSquareMeters, distanceMeters, formatArea, formatDistance } from "./map.js";

describe("map measurements", () => {
  it("measures a route along the ground", () => {
    // One degree of latitude is about 111.2 km.
    expect(
      distanceMeters([
        [53, -6],
        [54, -6],
      ]),
    ).toBeCloseTo(111_195, -2);
    expect(distanceMeters([[53, -6]])).toBe(0);
  });

  it("measures an area, whichever way round its corners go", () => {
    // About 100 m by 100 m in Dublin.
    const lat = 53.35;
    const dLat = 100 / 111_195;
    const dLon = 100 / (111_195 * Math.cos((lat * Math.PI) / 180));
    const square: LatLon[] = [
      [lat, -6.26],
      [lat, -6.26 + dLon],
      [lat + dLat, -6.26 + dLon],
      [lat + dLat, -6.26],
    ];
    expect(areaSquareMeters(square)).toBeGreaterThan(9_900);
    expect(areaSquareMeters(square)).toBeLessThan(10_100);
    expect(areaSquareMeters([...square].reverse())).toBeCloseTo(areaSquareMeters(square), 3);
    expect(areaSquareMeters(square.slice(0, 2))).toBe(0);
  });

  it("formats lengths and areas for site work", () => {
    expect(formatDistance(349.6)).toBe("350 m");
    expect(formatDistance(1240)).toBe("1.24 km");
    expect(formatDistance(25_400)).toBe("25.4 km");
    expect(formatArea(820.4)).toBe("820 m²");
    expect(formatArea(13_500)).toBe("1.35 ha");
  });
});

describe("Gantt days", () => {
  it("counts whole days from dates and text without time zones", () => {
    expect(dayNumber("2026-11-13")).toBe(dayNumber("2026-11-13T23:59:00Z"));
    expect(dayText(dayNumber("2026-03-29")! + 1)).toBe("2026-03-30");
    expect(dayNumber(new Date(2026, 0, 1, 12))).toBe(dayNumber("2026-01-01"));
    expect(dayNumber("13/11/2026")).toBeNull();
    expect(dayNumber(null)).toBeNull();
  });
});
