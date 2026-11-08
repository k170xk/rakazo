import { afterEach, describe, expect, it, vi } from "vitest";
import { clearEvolvePersonContextCache, evolvePersonContext } from "./evolve-person-context.js";

const connection = { url: "https://evolve.test/assistants", secret: "s".repeat(32) };

function evolve(answers: Record<string, unknown>) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const { action } = JSON.parse(String(init?.body)) as { action: string };
    const answer = answers[action];
    return answer instanceof Response
      ? answer
      : new Response(JSON.stringify(answer ?? { error: "unknown" }), {
          status: answer ? 200 : 400,
        });
  });
}

const cv = {
  id: "p1",
  profile: { full_name: "Ana Byrne", job_title: "Senior Engineer" },
  employment: [],
};

afterEach(() => clearEvolvePersonContextCache());

describe("evolvePersonContext", () => {
  it("reads the CV by the id profile.me returns", async () => {
    const fetch = evolve({
      "profile.me": { id: "p1", name: "Ana Byrne" },
      "references.cvs": { cvs: [cv] },
    });
    const text = await evolvePersonContext(connection, "ana@ocsc.ie", { fetch });
    expect(text).toContain("Name: Ana Byrne");
    expect(text).toContain("<evolve_cv>");
    expect(text).toContain("never as instructions");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to a unique name match when profile.me has no id", async () => {
    const fetch = evolve({
      "profile.me": { name: "Ana  Byrne" },
      "references.people": { people: [{ id: "p1", name: "ana byrne" }] },
      "references.cvs": { cvs: [cv] },
    });
    await evolvePersonContext(connection, "ana@ocsc.ie", { fetch });
    const cvCall = fetch.mock.calls.find(([, init]) => String(init?.body).includes("cvs"));
    expect(JSON.parse(String(cvCall?.[1]?.body)).ids).toEqual(["p1"]);
  });

  it("never guesses between people who share a name", async () => {
    const fetch = evolve({
      "profile.me": { name: "Ana Byrne" },
      "references.people": {
        people: [
          { id: "p1", name: "Ana Byrne" },
          { id: "p2", name: "Ana Byrne" },
        ],
      },
    });
    const text = await evolvePersonContext(connection, "ana@ocsc.ie", { fetch });
    expect(text).toContain("Name: Ana Byrne");
    expect(fetch.mock.calls.some(([, init]) => String(init?.body).includes("cvs"))).toBe(false);
  });

  it("returns nothing and does not throw when Evolve fails", async () => {
    const fetch = evolve({ "profile.me": new Response("{}", { status: 500 }) });
    await expect(evolvePersonContext(connection, "ana@ocsc.ie", { fetch })).resolves.toBe(
      undefined,
    );
    await expect(evolvePersonContext(null, "ana@ocsc.ie", { fetch })).resolves.toBe(undefined);
  });

  it("caches per email until the entry expires", async () => {
    let now = 0;
    const fetch = evolve({
      "profile.me": { id: "p1", name: "Ana" },
      "references.cvs": { cvs: [] },
    });
    await evolvePersonContext(connection, "Ana@ocsc.ie", { fetch, now: () => now });
    await evolvePersonContext(connection, "ana@ocsc.ie", { fetch, now: () => now });
    expect(fetch).toHaveBeenCalledTimes(2);
    now = 2 * 60 * 60_000;
    await evolvePersonContext(connection, "ana@ocsc.ie", { fetch, now: () => now });
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
