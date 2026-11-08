import { SHARED_PAGE_PATH_PREFIX } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import type { Context, Hono } from "hono";
import { readSharedPage } from "./pages.js";
import { throttleKey, windowCounter } from "./window-counter.js";

const MINUTE_MS = 60_000;
const READS_PER_IP_PER_MINUTE = 120;

/**
 * Anyone signed in to this company with a page's link reads its current version here; the
 * link alone opens nothing on the open internet. Every token that does not open a shared page
 * gets the same 404, and nothing here runs tools or models.
 */
export function mountSharedPages(
  app: Hono,
  prisma: PrismaClient,
  clientIp: (c: Context) => string | undefined,
  signedIn: (request: Request) => Promise<boolean>,
) {
  const reads = windowCounter(MINUTE_MS);
  app.get(`${SHARED_PAGE_PATH_PREFIX}:token`, async (c) => {
    const headers = {
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
    };
    if (reads(throttleKey(clientIp(c))) > READS_PER_IP_PER_MINUTE) {
      return c.json({ error: "Too many requests" }, 429, { ...headers, "retry-after": "60" });
    }
    if (!(await signedIn(c.req.raw))) {
      return c.json({ error: "Sign in to view this page" }, 401, headers);
    }
    const page = await readSharedPage(prisma, c.req.param("token"));
    if (!page) return c.json({ error: "Not found" }, 404, headers);
    return c.json(page, 200, headers);
  });
}
