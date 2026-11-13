import { APP_MAPS_PATH, mapTileUrl } from "@rakazo/app-kit/protocol";
import type { Hono } from "hono";
import { windowCounter } from "./window-counter.js";

/**
 * Map tiles and place search for App Studio apps. Apps have no network, so the host asks here and
 * this fetches from the free services the site inspections use (OpenStreetMap, Esri, OpenTopoMap,
 * Nominatim): no keys, no charge. Only signed-in staff are served, every tile
 * and answer is kept in memory so a busy map does not repeat requests, and Nominatim is asked at
 * most once a second as its usage policy requires.
 */

export { APP_MAPS_PATH };

const MINUTE_MS = 60_000;
const TILES_PER_USER_PER_MINUTE = 900;
const FINDS_PER_USER_PER_MINUTE = 30;
const MAX_TILE_BYTES = 400_000;
const MAX_CACHED_TILE_BYTES = 80_000_000;
const MAX_CACHED_FINDS = 2_000;
const FIND_TTL_MS = 24 * 60 * MINUTE_MS;
const NOMINATIM_GAP_MS = 1_100;
const USER_AGENT = "OCSC-Intelligence-App-Studio/1.0 (maps for staff apps; https://ocsc.ie)";

type Tile = { mime: string; bytes: Uint8Array };
export type Place = { label: string; lat: number; lon: number };

export function appMapsService(fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  const tiles = new Map<string, Tile>();
  let tileBytes = 0;
  const finds = new Map<string, { at: number; places: Place[] }>();
  let nominatimFree = 0;

  async function tile(style: string, z: number, x: number, y: number): Promise<Tile | null> {
    const url = mapTileUrl(style, z, x, y);
    if (!url) return null;
    const known = tiles.get(url);
    if (known) {
      tiles.delete(url);
      tiles.set(url, known);
      return known;
    }
    const response = await fetcher(url, {
      headers: { "user-agent": USER_AGENT, accept: "image/*" },
    });
    const mime = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!response.ok || !/^image\/(png|jpeg|webp)$/.test(mime)) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_TILE_BYTES) return null;
    const fresh = { mime, bytes };
    tiles.set(url, fresh);
    tileBytes += bytes.byteLength;
    for (const [key, value] of tiles) {
      if (tileBytes <= MAX_CACHED_TILE_BYTES) break;
      tiles.delete(key);
      tileBytes -= value.bytes.byteLength;
    }
    return fresh;
  }

  async function find(query: string): Promise<Place[]> {
    const text = query.replace(/\s+/g, " ").trim().slice(0, 200);
    if (text.length < 2) return [];
    const key = text.toLowerCase();
    const cached = finds.get(key);
    if (cached && now() - cached.at < FIND_TTL_MS) return cached.places;
    const wait = nominatimFree - now();
    nominatimFree = Math.max(now(), nominatimFree) + NOMINATIM_GAP_MS;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=0&q=${encodeURIComponent(text)}`;
    const response = await fetcher(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/json",
        "accept-language": "en-IE,en",
      },
    });
    if (!response.ok) throw new Error(`Place search answered ${response.status}`);
    const body = (await response.json()) as Array<{
      display_name?: unknown;
      lat?: unknown;
      lon?: unknown;
    }>;
    const places = (Array.isArray(body) ? body : [])
      .map((item) => ({
        label: String(item.display_name ?? ""),
        lat: Number(item.lat),
        lon: Number(item.lon),
      }))
      .filter((place) => place.label && Number.isFinite(place.lat) && Number.isFinite(place.lon))
      // OpenStreetMap often holds a place twice (the building and what is in it); show it once.
      .filter(
        (place, index, all) => all.findIndex((other) => other.label === place.label) === index,
      );
    finds.set(key, { at: now(), places });
    if (finds.size > MAX_CACHED_FINDS) finds.delete(finds.keys().next().value!);
    return places;
  }

  return { tile, find };
}

export function mountAppMaps(
  app: Hono,
  /** The signed-in user's id, or null. */
  signedInUser: (request: Request) => Promise<string | null>,
  service = appMapsService(),
) {
  const tileCounter = windowCounter(MINUTE_MS);
  const findCounter = windowCounter(MINUTE_MS);
  const noStore = { "cache-control": "no-store" };

  app.get(`${APP_MAPS_PATH}/tile/:style/:z/:x/:y`, async (c) => {
    const userId = await signedInUser(c.req.raw);
    if (!userId) return c.json({ error: "Sign in to see maps" }, 401, noStore);
    if (tileCounter(`user:${userId}`) > TILES_PER_USER_PER_MINUTE) {
      return c.json({ error: "Too many map requests" }, 429, { ...noStore, "retry-after": "60" });
    }
    const [z, x, y] = [c.req.param("z"), c.req.param("x"), c.req.param("y")].map(Number) as [
      number,
      number,
      number,
    ];
    const tile = await service.tile(c.req.param("style"), z, x, y).catch(() => null);
    if (!tile) return c.json({ error: "No such map tile" }, 404, noStore);
    return c.body(tile.bytes.slice().buffer, 200, {
      "content-type": tile.mime,
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
    });
  });

  app.get(`${APP_MAPS_PATH}/find`, async (c) => {
    const userId = await signedInUser(c.req.raw);
    if (!userId) return c.json({ error: "Sign in to search places" }, 401, noStore);
    if (findCounter(`user:${userId}`) > FINDS_PER_USER_PER_MINUTE) {
      return c.json({ error: "Too many searches; wait a minute" }, 429, {
        ...noStore,
        "retry-after": "60",
      });
    }
    try {
      return c.json({ places: await service.find(c.req.query("q") ?? "") }, 200, {
        "cache-control": "private, max-age=3600",
      });
    } catch {
      return c.json({ error: "Place search is not answering; try again shortly" }, 502, noStore);
    }
  });
}
