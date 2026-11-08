import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearEvolveAccessCache,
  EVOLVE_ACCESS_GRACE_MS,
  EVOLVE_ACCESS_TTL_MS,
  EVOLVE_ASSISTANT_NO_ACCESS,
  EVOLVE_ASSISTANT_UNCONFIRMED,
  evolveAssistantAccessError,
} from "./evolve-assistants.js";

const connection = { url: "https://evolve.example/functions/v1/", secret: "s".repeat(40) };
const TENDER = "00000000-0000-4000-8000-000000000001";
const GENERAL = "00000000-0000-4000-8000-000000000002";

function evolveListing(ids: string[]) {
  return vi.fn(async () =>
    Response.json({
      assistants: ids.map((id) => ({
        id,
        name: id,
        description: "",
        model: null,
        knowledge: false,
        instructions: "",
      })),
    }),
  );
}

afterEach(clearEvolveAccessCache);

describe("evolveAssistantAccessError", () => {
  it("lets a person run a bot whose assistant Evolve lists for them", async () => {
    const fetch = evolveListing([TENDER, GENERAL]);
    await expect(
      evolveAssistantAccessError(connection, "a@ocsc.ie", TENDER, { fetch }),
    ).resolves.toBeNull();
  });

  it("refuses once Evolve stops listing the assistant, after the cached answer expires", async () => {
    const allowed = evolveListing([TENDER]);
    await evolveAssistantAccessError(connection, "a@ocsc.ie", TENDER, { fetch: allowed, now: 0 });
    const revoked = evolveListing([GENERAL]);
    await expect(
      evolveAssistantAccessError(connection, "a@ocsc.ie", TENDER, { fetch: revoked, now: 1000 }),
    ).resolves.toBeNull();
    expect(revoked).not.toHaveBeenCalled();
    await expect(
      evolveAssistantAccessError(connection, "A@ocsc.ie", TENDER, {
        fetch: revoked,
        now: EVOLVE_ACCESS_TTL_MS,
      }),
    ).resolves.toBe(EVOLVE_ASSISTANT_NO_ACCESS);
  });

  it("keeps a recent yes while Evolve is down, and refuses when it has none", async () => {
    const down = vi.fn(async () => new Response("down", { status: 503 }));
    await expect(
      evolveAssistantAccessError(connection, "b@ocsc.ie", TENDER, { fetch: down, now: 0 }),
    ).resolves.toBe(EVOLVE_ASSISTANT_UNCONFIRMED);

    await evolveAssistantAccessError(connection, "b@ocsc.ie", TENDER, {
      fetch: evolveListing([TENDER]),
      now: 0,
    });
    await expect(
      evolveAssistantAccessError(connection, "b@ocsc.ie", TENDER, {
        fetch: down,
        now: EVOLVE_ACCESS_TTL_MS,
      }),
    ).resolves.toBeNull();
    await expect(
      evolveAssistantAccessError(connection, "b@ocsc.ie", TENDER, {
        fetch: down,
        now: EVOLVE_ACCESS_GRACE_MS,
      }),
    ).resolves.toBe(EVOLVE_ASSISTANT_UNCONFIRMED);
  });

  it("refuses when Evolve is not linked or the person has no email", async () => {
    await expect(evolveAssistantAccessError(undefined, "a@ocsc.ie", TENDER)).resolves.toBe(
      EVOLVE_ASSISTANT_UNCONFIRMED,
    );
    await expect(evolveAssistantAccessError(connection, null, TENDER)).resolves.toBe(
      EVOLVE_ASSISTANT_UNCONFIRMED,
    );
  });
});
