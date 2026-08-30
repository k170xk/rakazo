import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EVOLVE_SSO_AUD,
  EVOLVE_SSO_ISS,
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

  it("rejects a token with the wrong audience or issuer", () => {
    const { token } = signEvolveComputerSsoToken(secret, {
      email: "ada@example.com",
      evolveProfileId: 1,
    });
    const [header, payload, signature] = token.split(".");
    expect(header && payload && signature).toBeTruthy();
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
    const tampered = Buffer.from(
      JSON.stringify({ ...claims, aud: "careers" }),
      "utf8",
    ).toString("base64url");
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

    expect(verifyEvolveComputerSsoToken(secret, `${header}.${payload}.${signature}`)).not.toBeNull();
  });

  it("rejects malformed input", () => {
    expect(verifyEvolveComputerSsoToken(secret, "")).toBeNull();
    expect(verifyEvolveComputerSsoToken(secret, "not-a-jwt")).toBeNull();
    expect(verifyEvolveComputerSsoToken(secret, "a.b")).toBeNull();
  });
});
