import { describe, expect, it, vi } from "vitest";
import { evolveValue } from "./app-calls.js";
import { AppServiceError, appServices } from "./app-services.js";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("app services", () => {
  it("shapes a forecast, shares it between nearby places and caches it", async () => {
    const fetcher = vi.fn(async () =>
      json({
        timezone: "Europe/Dublin",
        current: { temperature_2m: 11.2, wind_speed_10m: 18, weather_code: 61 },
        daily: {
          time: ["2026-11-13"],
          temperature_2m_max: [12],
          temperature_2m_min: [6],
          precipitation_sum: [3.1],
          precipitation_probability_max: [80],
          wind_speed_10m_max: [30],
          weather_code: [63],
        },
      }),
    );
    const services = appServices(fetcher as unknown as typeof fetch);
    const first = await services.call("weather", { lat: 53.34981, lon: -6.26031, days: 1 });
    expect(first).toMatchObject({
      current: { temperature: 11.2, summary: "Light rain" },
      days: [{ date: "2026-11-13", max: 12, rainChance: 80, summary: "Rain" }],
      source: "Open-Meteo",
    });
    await services.call("weather", { lat: 53.3502, lon: -6.2598, days: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toContain("latitude=53.35");
  });

  it("checks what it is asked before fetching anything", async () => {
    const fetcher = vi.fn();
    const services = appServices(fetcher as unknown as typeof fetch);
    await expect(services.call("stocks", {})).rejects.toBeInstanceOf(AppServiceError);
    await expect(services.call("weather", { lat: 95, lon: 0 })).rejects.toThrow(/lat/);
    await expect(services.call("rates", { base: "euro" })).rejects.toThrow(/3-letter/);
    await expect(services.call("holidays", { country: "IRL" })).rejects.toThrow(/2-letter/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reads rates and holidays and reports a service that does not answer", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ base: "EUR", date: "2026-11-12", rates: { GBP: 0.86 } }))
      .mockResolvedValueOnce(
        json([
          { date: "2026-12-25", name: "Christmas Day", localName: "Lá Nollag", counties: null },
        ]),
      )
      .mockResolvedValueOnce(new Response("no", { status: 503 }));
    const services = appServices(fetcher as unknown as typeof fetch, () => new Date("2026-11-13"));
    expect(await services.call("rates", { to: ["gbp"] })).toMatchObject({ rates: { GBP: 0.86 } });
    expect(String(fetcher.mock.calls[0]![0])).toContain("symbols=GBP");
    expect(await services.call("holidays", { country: "ie" })).toEqual([
      { date: "2026-12-25", name: "Christmas Day", localName: "Lá Nollag", regions: null },
    ]);
    expect(String(fetcher.mock.calls[1]![0])).toContain("/2026/IE");
    await expect(services.call("holidays", { country: "GB" })).rejects.toThrow(/did not answer/);
  });
});

describe("evolve results", () => {
  it("prefers structured content, then JSON text, then the text itself", () => {
    expect(evolveValue({ structuredContent: { a: 1 }, content: [] })).toEqual({ a: 1 });
    expect(evolveValue({ content: [{ type: "text", text: '[{"id":"P1"}]' }] })).toEqual([
      { id: "P1" },
    ]);
    expect(evolveValue({ content: [{ type: "text", text: "No deadlines" }] })).toBe("No deadlines");
    expect(() =>
      evolveValue({ isError: true, content: [{ type: "text", text: "Denied" }] }),
    ).toThrow("Denied");
  });
});
