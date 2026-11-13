import type { AppService } from "@rakazo/app-kit/protocol";
import { APP_SERVICES } from "@rakazo/app-kit/protocol";

/**
 * Free public data for apps, fetched by the server because apps have no network: weather from
 * Open-Meteo, exchange rates from Frankfurter (the ECB's reference rates) and public holidays from
 * Nager.Date. None needs a key or charges; answers are cached so busy apps ask each service rarely.
 */

const USER_AGENT = "OCSC-Intelligence-App-Studio/1.0 (data for staff apps; https://ocsc.ie)";
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_CACHED = 500;
const MINUTE = 60_000;

export class AppServiceError extends Error {}

type Fetcher = typeof fetch;
type Plan = { url: string; ttlMs: number; shape: (body: unknown) => unknown };

const WEATHER: Record<number, string> = {
  0: "Clear",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light showers",
  81: "Showers",
  82: "Heavy showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Thunderstorm with hail",
};

const weatherText = (code: unknown) =>
  typeof code === "number" ? (WEATHER[code] ?? "Unsettled") : null;

function numberParam(value: unknown, min: number, max: number, name: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < min || number > max)
    throw new AppServiceError(`${name} must be a number from ${min} to ${max}.`);
  return number;
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function plan(name: AppService, params: Record<string, unknown>, now: Date): Plan {
  if (name === "weather") {
    // Two decimals is about a kilometre, so nearby sites share one cached forecast.
    const lat = numberParam(params.lat, -90, 90, "lat").toFixed(2);
    const lon = numberParam(params.lon, -180, 180, "lon").toFixed(2);
    const days = Math.round(numberParam(params.days ?? 7, 1, 16, "days"));
    const daily =
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max";
    return {
      url: `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=${daily}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto&forecast_days=${days}`,
      ttlMs: 30 * MINUTE,
      shape: (body) => {
        const data = body as {
          current?: Record<string, unknown>;
          daily?: Record<string, unknown[]>;
          timezone?: string;
        };
        const daily = data.daily ?? {};
        return {
          timezone: data.timezone ?? null,
          current: data.current
            ? {
                temperature: data.current.temperature_2m ?? null,
                wind: data.current.wind_speed_10m ?? null,
                code: data.current.weather_code ?? null,
                summary: weatherText(data.current.weather_code),
              }
            : null,
          days: list(daily.time).map((date, index) => ({
            date,
            max: list(daily.temperature_2m_max)[index] ?? null,
            min: list(daily.temperature_2m_min)[index] ?? null,
            rain: list(daily.precipitation_sum)[index] ?? null,
            rainChance: list(daily.precipitation_probability_max)[index] ?? null,
            wind: list(daily.wind_speed_10m_max)[index] ?? null,
            code: list(daily.weather_code)[index] ?? null,
            summary: weatherText(list(daily.weather_code)[index]),
          })),
          units: { temperature: "°C", rain: "mm", wind: "km/h" },
          source: "Open-Meteo",
        };
      },
    };
  }
  if (name === "rates") {
    const code = (value: unknown) => {
      const text = String(value ?? "").toUpperCase();
      if (!/^[A-Z]{3}$/.test(text)) throw new AppServiceError("Currencies are 3-letter codes.");
      return text;
    };
    const base = code(params.base ?? "EUR");
    const to = list(params.to).slice(0, 30).map(code);
    return {
      url: `https://api.frankfurter.dev/v1/latest?base=${base}${to.length ? `&symbols=${to.join(",")}` : ""}`,
      ttlMs: 6 * 60 * MINUTE,
      shape: (body) => {
        const data = body as { base?: string; date?: string; rates?: Record<string, number> };
        return {
          base: data.base ?? base,
          date: data.date ?? null,
          rates: data.rates ?? {},
          source: "European Central Bank via Frankfurter",
        };
      },
    };
  }
  const country = String(params.country ?? "IE").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country))
    throw new AppServiceError("country is a 2-letter code such as IE or GB.");
  const year = Math.round(numberParam(params.year ?? now.getUTCFullYear(), 1990, 2100, "year"));
  return {
    url: `https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`,
    ttlMs: 7 * 24 * 60 * MINUTE,
    shape: (body) =>
      list(body).map((entry) => {
        const day = entry as Record<string, unknown>;
        return {
          date: day.date ?? null,
          name: day.name ?? null,
          localName: day.localName ?? null,
          regions: Array.isArray(day.counties) ? day.counties : null,
        };
      }),
  };
}

export function appServices(fetcher: Fetcher = fetch, now: () => Date = () => new Date()) {
  const cache = new Map<string, { at: number; ttl: number; value: unknown }>();
  return {
    async call(name: unknown, params: unknown): Promise<unknown> {
      if (!(APP_SERVICES as readonly unknown[]).includes(name))
        throw new AppServiceError(`Services are ${APP_SERVICES.join(", ")}.`);
      const input =
        params && typeof params === "object" && !Array.isArray(params)
          ? (params as Record<string, unknown>)
          : {};
      const { url, ttlMs, shape } = plan(name as AppService, input, now());
      const known = cache.get(url);
      if (known && now().getTime() - known.at < known.ttl) {
        cache.delete(url);
        cache.set(url, known);
        return known.value;
      }
      const response = await fetcher(url, {
        headers: { "user-agent": USER_AGENT, accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
      if (!response?.ok) throw new AppServiceError(`The ${String(name)} service did not answer.`);
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES)
        throw new AppServiceError(`The ${String(name)} service sent too much.`);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new AppServiceError(`The ${String(name)} service sent something unexpected.`);
      }
      const value = shape(body);
      cache.set(url, { at: now().getTime(), ttl: ttlMs, value });
      if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
      return value;
    },
  };
}

export type AppServices = ReturnType<typeof appServices>;
