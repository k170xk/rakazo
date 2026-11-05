import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { emailAllowed } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { bootstrapUserSpace } from "@rakazo/db";
import { resolveSignupPolicy } from "./signup-policy.js";

export const EVOLVE_SSO_AUD = "rakazo";
export const EVOLVE_SSO_ISS = "evolve-computer";
export const EVOLVE_SSO_TTL_SEC = 120;

export class EvolveSsoInvalidTokenError extends Error {
  constructor(message = "Invalid Evolve SSO token") {
    super(message);
    this.name = "EvolveSsoInvalidTokenError";
  }
}

export class EvolveSsoReplayError extends Error {
  constructor(message = "Evolve SSO token already used") {
    super(message);
    this.name = "EvolveSsoReplayError";
  }
}

export class EvolveSsoSignupsClosedError extends Error {
  constructor(message = "Registration is closed") {
    super(message);
    this.name = "EvolveSsoSignupsClosedError";
  }
}

export interface EvolveComputerSsoClaims {
  sub: string;
  email: string;
  evolve_profile_id: number;
  full_name?: string | null;
  aud: string;
  iss: string;
  exp: number;
  iat: number;
  jti: string;
}

export interface SignEvolveComputerSsoInput {
  email: string;
  evolveProfileId: number;
  fullName?: string | null;
  expiresInSec?: number;
  nowSec?: number;
  jti?: string;
}

function newId(): string {
  return randomBytes(16).toString("hex");
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

function signHs256(secret: string, unsigned: string): Buffer {
  return createHmac("sha256", secret).update(unsigned).digest();
}

export function signEvolveComputerSsoToken(
  secret: string,
  input: SignEvolveComputerSsoInput,
): { token: string; jti: string; expiresAt: Date } {
  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  const expiresInSec = input.expiresInSec ?? EVOLVE_SSO_TTL_SEC;
  const jti = input.jti ?? crypto.randomUUID();
  const email = input.email.trim().toLowerCase();
  const payload = {
    sub: email,
    email,
    evolve_profile_id: input.evolveProfileId,
    full_name: input.fullName?.trim() || null,
    aud: EVOLVE_SSO_AUD,
    iss: EVOLVE_SSO_ISS,
    iat: now,
    exp: now + expiresInSec,
    jti,
  };
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const unsigned = `${header}.${body}`;
  const token = `${unsigned}.${base64UrlEncode(signHs256(secret, unsigned))}`;
  return { token, jti, expiresAt: new Date((now + expiresInSec) * 1000) };
}

export function verifyEvolveComputerSsoToken(
  secret: string,
  token: string,
): EvolveComputerSsoClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const headerPart = parts[0];
  const payloadPart = parts[1];
  const signaturePart = parts[2];
  if (!headerPart || !payloadPart || !signaturePart) return null;
  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = signHs256(secret, `${headerPart}.${payloadPart}`);
    actual = base64UrlDecode(signaturePart);
  } catch {
    return null;
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  let payload: EvolveComputerSsoClaims;
  try {
    payload = JSON.parse(base64UrlDecode(payloadPart).toString("utf8")) as EvolveComputerSsoClaims;
  } catch {
    return null;
  }

  if (typeof payload.email !== "string" || !payload.email.includes("@")) return null;
  if (typeof payload.jti !== "string" || !payload.jti) return null;
  if (
    typeof payload.evolve_profile_id !== "number" ||
    !Number.isFinite(payload.evolve_profile_id)
  ) {
    return null;
  }
  if (payload.aud !== EVOLVE_SSO_AUD || payload.iss !== EVOLVE_SSO_ISS) return null;
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) return null;

  return {
    ...payload,
    email: payload.email.trim().toLowerCase(),
    sub: (payload.sub ?? payload.email).trim().toLowerCase(),
  };
}

export async function exchangeEvolveSso(input: {
  prisma: PrismaClient;
  secret: string;
  token: string;
  signupsEnabled: string | undefined;
  signupAllowlist: string | undefined;
}): Promise<{ token: string; expiresAt: Date; created: boolean; email: string }> {
  const claims = verifyEvolveComputerSsoToken(input.secret, input.token);
  if (!claims) throw new EvolveSsoInvalidTokenError();

  const identifier = `evolve-sso:${claims.jti}`;
  const replayed = await input.prisma.verification.findFirst({
    where: { identifier },
    select: { id: true },
  });
  if (replayed) throw new EvolveSsoReplayError();

  await input.prisma.verification.create({
    data: {
      id: newId(),
      identifier,
      value: claims.email,
      expiresAt: new Date(claims.exp * 1000),
    },
  });

  const email = claims.email;
  let user = await input.prisma.user.findUnique({ where: { email } });
  let created = false;
  if (!user) {
    const policy = await resolveSignupPolicy(input.prisma, {
      signupsEnabled: input.signupsEnabled,
      signupAllowlist: input.signupAllowlist,
    });
    // Evolve already checked this person. Public signup can stay closed; an allowlist still applies.
    if (!emailAllowed(email, policy.allowlist)) throw new EvolveSsoSignupsClosedError();

    user = await input.prisma.user.create({
      data: {
        id: newId(),
        name: claims.full_name?.trim() || email,
        email,
        emailVerified: true,
      },
    });
    await bootstrapUserSpace(input.prisma, user, {
      signupsEnabled: input.signupsEnabled,
      signupAllowlist: input.signupAllowlist,
    });
    created = true;
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const sessionToken = randomBytes(32).toString("base64url");
  await input.prisma.session.create({
    data: {
      id: newId(),
      token: sessionToken,
      userId: user.id,
      expiresAt,
    },
  });

  return { token: sessionToken, expiresAt, created, email };
}
