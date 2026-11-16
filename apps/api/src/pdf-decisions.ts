import type { Actor } from "@rakazo/contracts";
import { getLogger } from "@rakazo/logging";
import type { Hono } from "hono";
import { readBoundedBody } from "./http-body.js";
import {
  decidePdf,
  memoryPdfDecisionsBudget,
  PDF_DECISIONS_LIMITS,
  type PdfDecisionsBudget,
  type PdfDecisionsCaller,
  type PdfDecisionsLogEvent,
  pdfDecisionsMode,
} from "./pdf-decisions-core.js";
import { pdfDecisionsBearer, verifyPdfDecisionsToken } from "./pdf-decisions-token.js";

export const PDF_DECISIONS_PATH = "/api/pdf/decisions";

export interface PdfDecisionsRouteDeps {
  /** The signed-in caller (cookie or better-auth bearer), as for the other HTTP routes. */
  sessionActor: (request: Request) => Promise<Actor | null>;
  /** The organisation a space belongs to, for the per-company budget; null falls back to the space. */
  companyOf: (spaceId: string) => Promise<string | null>;
  env?: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  budget?: PdfDecisionsBudget;
  now?: () => number;
  log?: (event: PdfDecisionsLogEvent) => void;
}

const logEvent = (event: PdfDecisionsLogEvent) => getLogger().info("pdf decisions", { ...event });

/**
 * POST /api/pdf/decisions: PDF Studio's Decisions questions, answered with the api's own
 * OPENAI_API_KEY behind RAKAZO_PDF_DECISIONS. A computer command authenticates with a
 * `pdfd1.` token (see pdf-decisions-token.ts); anyone else needs a signed-in session.
 */
export function mountPdfDecisionsRoute(app: Hono, deps: PdfDecisionsRouteDeps): void {
  const env = deps.env ?? process.env;
  const budget = deps.budget ?? memoryPdfDecisionsBudget();
  const companies = new Map<string, string>();
  const company = async (spaceId: string) => {
    const known = companies.get(spaceId);
    if (known) return known;
    const found = await deps.companyOf(spaceId).catch(() => null);
    const key = found ? `org:${found}` : `space:${spaceId}`;
    if (found) {
      if (companies.size > 10_000) companies.clear();
      companies.set(spaceId, key);
    }
    return key;
  };

  const caller = async (request: Request): Promise<PdfDecisionsCaller | null> => {
    const token = pdfDecisionsBearer(request.headers.get("authorization") ?? undefined);
    if (token) {
      const claims = verifyPdfDecisionsToken(
        token,
        env.RAKAZO_PDF_DECISIONS_SECRET,
        deps.now?.() ?? Date.now(),
      );
      if (!claims) return null;
      return {
        company: await company(claims.spaceId),
        spaceId: claims.spaceId,
        userId: claims.userId,
        via: "sandbox",
        ...(claims.botId ? { botId: claims.botId } : {}),
        ...(claims.runId ? { runId: claims.runId } : {}),
      };
    }
    const actor = await deps.sessionActor(request).catch(() => null);
    if (!actor) return null;
    return {
      company: await company(actor.spaceId),
      spaceId: actor.spaceId,
      userId: actor.userId,
      via: "session",
    };
  };

  app.post(PDF_DECISIONS_PATH, async (c) => {
    const headers = { "cache-control": "no-store" };
    const coreDeps = {
      env,
      fetch: deps.fetch ?? globalThis.fetch,
      budget,
      now: deps.now,
      log: deps.log ?? logEvent,
    };
    // Off answers before reading credentials or the body.
    if (pdfDecisionsMode(env) === "off") {
      const off = await decidePdf(null, null, coreDeps);
      return c.json(off.body, off.status as 200, headers);
    }
    const who = await caller(c.req.raw);
    if (!who) {
      const denied = await decidePdf(null, null, coreDeps);
      return c.json(denied.body, denied.status as 401, headers);
    }
    const raw = await readBoundedBody(c.req.raw, PDF_DECISIONS_LIMITS.maxBodyBytes);
    if (raw === null) {
      return c.json(
        { ok: false, reason: "invalid", detail: "the request body is too large" },
        413,
        headers,
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      body = undefined;
    }
    const result = await decidePdf(body, who, coreDeps);
    return c.json(result.body, result.status as 200, headers);
  });
}
