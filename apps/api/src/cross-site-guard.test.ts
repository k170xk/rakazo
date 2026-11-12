import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { crossSiteGuard, forgedCrossSiteRequest } from "./cross-site-guard.js";

const trusted = (origin: string) =>
  origin === "https://rakazo.ocsc.me" || origin.startsWith("rakazo://");

function request(method: string, headers: Record<string, string>) {
  return new Request("https://rakazo.ocsc.me/rpc/thread/send", { method, headers });
}

describe("forgedCrossSiteRequest", () => {
  it("refuses a signed-in write from another site on the same domain", () => {
    const cookie = { cookie: "session=1" };
    expect(
      forgedCrossSiteRequest(
        request("POST", { ...cookie, origin: "https://evolve.ocsc.me" }),
        trusted,
      ),
    ).toBe(true);
    expect(forgedCrossSiteRequest(request("POST", { ...cookie, origin: "null" }), trusted)).toBe(
      true,
    );
    expect(
      forgedCrossSiteRequest(
        request("POST", { ...cookie, "sec-fetch-site": "same-site" }),
        trusted,
      ),
    ).toBe(true);
    expect(
      forgedCrossSiteRequest(
        request("DELETE", { ...cookie, "sec-fetch-site": "cross-site" }),
        trusted,
      ),
    ).toBe(true);
  });

  it("allows Rakazo's own pages and apps, reads, and requests that carry no session", () => {
    const cookie = { cookie: "session=1" };
    expect(
      forgedCrossSiteRequest(
        request("POST", { ...cookie, origin: "https://rakazo.ocsc.me" }),
        trusted,
      ),
    ).toBe(false);
    expect(
      forgedCrossSiteRequest(request("POST", { ...cookie, origin: "rakazo://app" }), trusted),
    ).toBe(false);
    expect(
      forgedCrossSiteRequest(
        request("POST", { ...cookie, "sec-fetch-site": "same-origin" }),
        trusted,
      ),
    ).toBe(false);
    expect(forgedCrossSiteRequest(request("POST", cookie), trusted)).toBe(false);
    expect(
      forgedCrossSiteRequest(
        request("GET", { ...cookie, origin: "https://evolve.ocsc.me" }),
        trusted,
      ),
    ).toBe(false);
    expect(
      forgedCrossSiteRequest(request("POST", { origin: "https://hooks.slack.com" }), trusted),
    ).toBe(false);
  });
});

describe("crossSiteGuard", () => {
  it("answers 403 to a forged write and leaves open paths alone", async () => {
    const app = new Hono();
    app.use("*", crossSiteGuard(trusted, ["/api/plugin-submissions"]));
    app.post("*", (c) => c.text("ok"));
    const forged = { cookie: "session=1", origin: "https://evolve.ocsc.me" };
    expect((await app.request("/rpc/x", { method: "POST", headers: forged })).status).toBe(403);
    expect(
      (await app.request("/api/plugin-submissions", { method: "POST", headers: forged })).status,
    ).toBe(200);
  });
});
