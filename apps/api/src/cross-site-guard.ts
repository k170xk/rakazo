import type { MiddlewareHandler } from "hono";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// A request the person typed or bookmarked, or one from a page on this exact origin.
const OWN_FETCH_SITES = new Set(["same-origin", "none"]);

/**
 * Whether a state-changing request may have been forged by another site. SameSite=Lax cookies
 * still reach Rakazo from any page on the same registrable domain (Evolve included), so a
 * request that carries cookies must come from one of Rakazo's own origins. Requests without
 * cookies carry no session to abuse: webhooks, the mobile app and server calls are unaffected.
 */
export function forgedCrossSiteRequest(
  request: Request,
  trustedOrigin: (origin: string) => boolean,
): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return false;
  if (!request.headers.get("cookie")) return false;
  const origin = request.headers.get("origin");
  if (origin) return origin === "null" || !trustedOrigin(origin);
  const fetchSite = request.headers.get("sec-fetch-site");
  return Boolean(fetchSite && !OWN_FETCH_SITES.has(fetchSite));
}

export function crossSiteGuard(
  trustedOrigin: (origin: string) => boolean,
  openPaths: readonly string[],
): MiddlewareHandler {
  return async (c, next) => {
    if (!openPaths.includes(c.req.path) && forgedCrossSiteRequest(c.req.raw, trustedOrigin)) {
      return c.json({ error: "This request came from another site." }, 403);
    }
    await next();
  };
}
