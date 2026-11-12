import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EVOLVE_SSO_AUD,
  EVOLVE_SSO_ISS,
  EvolveSsoReplayError,
  exchangeEvolveSso,
  signEvolveComputerSsoToken,
  verifyEvolveComputerSsoToken,
} from "./evolve-sso.js";

const secret = "evolve-computer-sso-test-secret-32chars";

describe("Evolve Computer SSO JWT", () => {
  it("round-trips a signed token", () => {
    const { token, jti } = signEvolveComputerSsoToken(secret, {
      email: "  Ada@Example.com ",
      evolveProfileId: 42,
      fullName: "Ada Lovelace",
    });
    const claims = verifyEvolveComputerSsoToken(secret, token);
    expect(claims).toMatchObject({
      email: "ada@example.com",
      sub: "ada@example.com",
      evolve_profile_id: 42,
      full_name: "Ada Lovelace",
      aud: EVOLVE_SSO_AUD,
      iss: EVOLVE_SSO_ISS,
      jti,
    });
  });

  it("rejects a token signed with a different secret", () => {
    const { token } = signEvolveComputerSsoToken(secret, {
      email: "ada@example.com",
      evolveProfileId: 1,
    });
    expect(verifyEvolveComputerSsoToken("other-secret-that-is-also-long-enough", token)).toBeNull();
  });

  it("rejects an expired token", () => {
    const { token } = signEvolveComputerSsoToken(secret, {
      email: "ada@example.com",
      evolveProfileId: 1,
      nowSec: Math.floor(Date.now() / 1000) - 180,
      expiresInSec: 120,
    });
    expect(verifyEvolveComputerSsoToken(secret, token)).toBeNull();
  });

  it("rejects a token that lives longer than a sign-in needs", () => {
    const { token } = signEvolveComputerSsoToken(secret, {
      email: "ada@example.com",
      evolveProfileId: 1,
      expiresInSec: 3600,
    });
    expect(verifyEvolveComputerSsoToken(secret, token)).toBeNull();
  });

  it("refuses the second of two uses that arrive together", async () => {
    const { token } = signEvolveComputerSsoToken(secret, {
      email: "ada@example.com",
      evolveProfileId: 1,
    });
    const ids = new Set<string>();
    const prisma = {
      verification: {
        findFirst: async () => null,
        create: async ({ data }: { data: { id: string } }) => {
          if (ids.has(data.id)) throw Object.assign(new Error("unique"), { code: "P2002" });
          ids.add(data.id);
          return data;
        },
      },
      user: { findUnique: async () => ({ id: "user-1", email: "ada@example.com" }) },
      session: { create: async () => ({}) },
    } as unknown as Parameters<typeof exchangeEvolveSso>[0]["prisma"];
    const exchange = () =>
      exchangeEvolveSso({
        prisma,
        secret,
        token,
        signupsEnabled: "false",
        signupAllowlist: "",
      });
    const results = await Promise.allSettled([exchange(), exchange()]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const refused = results.find((result) => result.status === "rejected");
    expect((refused as PromiseRejectedResult).reason).toBeInstanceOf(EvolveSsoReplayError);
  });

  it("rejects a token with the wrong audience or issuer", () => {
    const { token } = signEvolveComputerSsoToken(secret, {
      email: "ada@example.com",
      evolveProfileId: 1,
    });
    const [header, payload, signature] = token.split(".");
    expect(header && payload && signature).toBeTruthy();
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
    const tampered = Buffer.from(JSON.stringify({ ...claims, aud: "careers" }), "utf8").toString(
      "base64url",
    );
    const unsigned = `${header}.${tampered}`;
    const hmac = createHmac("sha256", secret).update(unsigned).digest("base64url");
    expect(verifyEvolveComputerSsoToken(secret, `${unsigned}.${hmac}`)).toBeNull();

    const issuerTampered = Buffer.from(
      JSON.stringify({ ...claims, iss: "evolve-careers" }),
      "utf8",
    ).toString("base64url");
    const issuerUnsigned = `${header}.${issuerTampered}`;
    const issuerHmac = createHmac("sha256", secret).update(issuerUnsigned).digest("base64url");
    expect(verifyEvolveComputerSsoToken(secret, `${issuerUnsigned}.${issuerHmac}`)).toBeNull();

    expect(
      verifyEvolveComputerSsoToken(secret, `${header}.${payload}.${signature}`),
    ).not.toBeNull();
  });

  it("rejects malformed input", () => {
    expect(verifyEvolveComputerSsoToken(secret, "")).toBeNull();
    expect(verifyEvolveComputerSsoToken(secret, "not-a-jwt")).toBeNull();
    expect(verifyEvolveComputerSsoToken(secret, "a.b")).toBeNull();
  });
});
