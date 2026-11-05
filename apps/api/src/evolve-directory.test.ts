import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { searchEvolveDirectory } from "./evolve-directory.js";

const people = {
  people: [{ userId: "u1", name: "Keith", email: "keith@ocsc.co.uk", image: null, owner: true }],
  invites: [{ email: "ann@ocsc.co.uk", createdAt: "2026-11-05T00:00:00.000Z" }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchEvolveDirectory", () => {
  it("is unavailable without the Evolve secret", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      searchEvolveDirectory({ secret: undefined, url: undefined, query: "kn", people }),
    ).resolves.toEqual({ available: false, people: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("signs a directory-only token and marks people already in the group", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({
        profiles: [
          { name: "Keith Knox", email: "Keith@ocsc.co.uk", office: "Belfast", can_open: true },
          { name: "Ann", email: "ann@ocsc.co.uk", job_title: "Engineer", can_open: true },
          { name: "Tom", email: "tom@ocsc.co.uk", photo: "http://insecure/x.png" },
          { name: "No email" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);

    const found = await searchEvolveDirectory({
      secret: "s".repeat(40),
      url: "https://evolve.test/directory",
      query: "knox",
      people,
    });

    const init = fetch.mock.calls[0]?.[1];
    const token = String(new Headers(init?.headers).get("authorization")).replace("Bearer ", "");
    const [header, body, signature] = token.split(".");
    expect(signature).toBe(
      createHmac("sha256", "s".repeat(40)).update(`${header}.${body}`).digest("base64url"),
    );
    expect(JSON.parse(Buffer.from(String(body), "base64url").toString())).toMatchObject({
      aud: "evolve-directory",
      iss: "rakazo",
    });
    expect(found).toEqual({
      available: true,
      people: [
        expect.objectContaining({ email: "keith@ocsc.co.uk", status: "member", canOpen: true }),
        expect.objectContaining({
          email: "ann@ocsc.co.uk",
          status: "invited",
          jobTitle: "Engineer",
        }),
        expect.objectContaining({
          email: "tom@ocsc.co.uk",
          status: null,
          photo: null,
          canOpen: false,
        }),
      ],
    });
  });

  it("reports the directory unavailable when Evolve fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 500 })),
    );
    await expect(
      searchEvolveDirectory({ secret: "s".repeat(40), url: undefined, query: "kn", people }),
    ).resolves.toEqual({ available: false, people: [] });
  });
});
