import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { APP_MAPS_PATH, appMapsService, mountAppMaps } from "./app-maps.js";

const png = () =>
  new Response(new Uint8Array([137, 80, 78, 71]), {
    status: 200,
    headers: { "content-type": "image/png" },
  });

describe("appMapsService", () => {
  it("fetches a real tile once from the free service and keeps it", async () => {
    const fetcher = vi.fn(async () => png());
    const service = appMapsService(fetcher as unknown as typeof fetch);
    expect(await service.tile("streets", 5, 15, 10)).toMatchObject({ mime: "image/png" });
    await service.tile("streets", 5, 15, 10);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://tile.openstreetmap.org/5/15/10.png");
    const headers = init.headers as Record<string, string>;
    expect(headers["user-agent"]).toMatch(/^OCSC-Intelligence/);
  });

  it("refuses styles, zooms and squares that do not exist without fetching", async () => {
    const fetcher = vi.fn(async () => png());
    const service = appMapsService(fetcher as unknown as typeof fetch);
    expect(await service.tile("google", 5, 1, 1)).toBeNull();
    expect(await service.tile("terrain", 18, 1, 1)).toBeNull();
    expect(await service.tile("streets", 2, 4, 0)).toBeNull();
    expect(await service.tile("streets", 2, 1.5, 0)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("drops answers that are not pictures", async () => {
    const service = appMapsService(
      (async () =>
        new Response("<html>", { headers: { "content-type": "text/html" } })) as typeof fetch,
    );
    expect(await service.tile("light", 3, 1, 1)).toBeNull();
  });

  it("turns Nominatim results into places and answers repeats from memory", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            { display_name: "Cork, Ireland", lat: "51.89", lon: "-8.47" },
            { display_name: "Cork, Ireland", lat: "51.8901", lon: "-8.4701" },
            { display_name: "", lat: "x" },
          ]),
          {
            headers: { "content-type": "application/json" },
          },
        ),
    );
    const service = appMapsService(fetcher as unknown as typeof fetch);
    expect(await service.find("  Cork  ")).toEqual([
      { label: "Cork, Ireland", lat: 51.89, lon: -8.47 },
    ]);
    expect(await service.find("cork")).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String((fetcher.mock.calls[0] as unknown as [string])[0])).toContain("q=Cork");
  });
});

describe("mountAppMaps", () => {
  const service = {
    tile: vi.fn(async () => ({ mime: "image/png", bytes: new Uint8Array([1, 2, 3]) })),
    find: vi.fn(async () => [{ label: "Galway", lat: 53.27, lon: -9.05 }]),
  };
  const appFor = (userId: string | null) => {
    const app = new Hono();
    mountAppMaps(app, async () => userId, service);
    return app;
  };

  it("serves only signed-in staff", async () => {
    const response = await appFor(null).request(`${APP_MAPS_PATH}/tile/streets/1/0/0`);
    expect(response.status).toBe(401);
    expect(service.tile).not.toHaveBeenCalled();
  });

  it("answers tiles as pictures and searches as places", async () => {
    const app = appFor("user-1");
    const tile = await app.request(`${APP_MAPS_PATH}/tile/streets/1/0/0`);
    expect(tile.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await tile.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const found = await app.request(`${APP_MAPS_PATH}/find?q=Galway`);
    expect(await found.json()).toEqual({ places: [{ label: "Galway", lat: 53.27, lon: -9.05 }] });
  });
});
