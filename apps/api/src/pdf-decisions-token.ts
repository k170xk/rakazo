import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A short-lived credential for one computer command to reach POST /api/pdf/decisions without a
 * user session: `pdfd1.<base64url claims>.<base64url HMAC-SHA256>`, signed with
 * RAKAZO_PDF_DECISIONS_SECRET. It grants that one endpoint only, for the space and person the run
 * belongs to, and the endpoint still applies the flag, caps and daily budget.
 */
export const PDF_DECISIONS_TOKEN_PREFIX = "pdfd1";
export const PDF_DECISIONS_SECRET_MIN_LENGTH = 32;
/** Longer-lived tokens are refused even when correctly signed. */
export const PDF_DECISIONS_TOKEN_MAX_TTL_SECONDS = 24 * 60 * 60;

export interface PdfDecisionsTokenClaims {
  spaceId: string;
  userId: string;
  botId?: string;
  runId?: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
}

const encode = (value: string | Buffer) => Buffer.from(value).toString("base64url");

function signature(secret: string, body: string) {
  return createHmac("sha256", secret).update(`${PDF_DECISIONS_TOKEN_PREFIX}.${body}`).digest();
}

function usableSecret(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.trim().length >= PDF_DECISIONS_SECRET_MIN_LENGTH;
}

export function mintPdfDecisionsToken(
  claims: Omit<PdfDecisionsTokenClaims, "exp">,
  secret: string,
  options: { ttlSeconds?: number; now?: number } = {},
): string {
  if (!usableSecret(secret)) {
    throw new Error(
      `RAKAZO_PDF_DECISIONS_SECRET must be at least ${PDF_DECISIONS_SECRET_MIN_LENGTH} characters`,
    );
  }
  const ttl = Math.min(options.ttlSeconds ?? 3600, PDF_DECISIONS_TOKEN_MAX_TTL_SECONDS);
  const exp = Math.floor((options.now ?? Date.now()) / 1000) + Math.max(1, Math.floor(ttl));
  const body = encode(
    JSON.stringify({
      s: claims.spaceId,
      u: claims.userId,
      ...(claims.botId ? { b: claims.botId } : {}),
      ...(claims.runId ? { r: claims.runId } : {}),
      exp,
    }),
  );
  return `${PDF_DECISIONS_TOKEN_PREFIX}.${body}.${encode(signature(secret.trim(), body))}`;
}

/** The claims of a valid, unexpired token; null for anything else, including a missing secret. */
export function verifyPdfDecisionsToken(
  token: string | undefined,
  secret: string | undefined,
  now = Date.now(),
): PdfDecisionsTokenClaims | null {
  if (!token || !usableSecret(secret)) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PDF_DECISIONS_TOKEN_PREFIX) return null;
  const [, body = "", sent = ""] = parts;
  const expected = signature(secret.trim(), body);
  const given = Buffer.from(sent, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const { s, u, b, r, exp } = raw as Record<string, unknown>;
  if (typeof s !== "string" || !s || typeof u !== "string" || !u) return null;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  const nowSeconds = now / 1000;
  if (exp <= nowSeconds || exp > nowSeconds + PDF_DECISIONS_TOKEN_MAX_TTL_SECONDS + 60) return null;
  return {
    spaceId: s,
    userId: u,
    ...(typeof b === "string" && b ? { botId: b } : {}),
    ...(typeof r === "string" && r ? { runId: r } : {}),
    exp,
  };
}

/** The bearer value of an Authorization header, when it is one of these tokens. */
export function pdfDecisionsBearer(authorization: string | undefined): string | undefined {
  if (authorization?.slice(0, 7).toLowerCase() !== "bearer ") return undefined;
  const value = authorization.slice(7).trim();
  return value.startsWith(`${PDF_DECISIONS_TOKEN_PREFIX}.`) ? value : undefined;
}
