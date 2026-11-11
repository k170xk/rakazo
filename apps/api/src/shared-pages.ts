import {
  PageStateWriteSchema,
  SHARED_PAGE_PASSWORD_HEADER,
  SHARED_PAGE_PATH_PREFIX,
} from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import type { Context, Hono } from "hono";
import {
  PageStateRefusedError,
  readSharedPage,
  readSharedPageState,
  saveSharedPageState,
  sharePasswordMatches,
} from "./pages.js";
import { throttleKey, windowCounter } from "./window-counter.js";

const MINUTE_MS = 60_000;
const READS_PER_IP_PER_MINUTE = 120;
/** Password tries per address and link in 15 minutes, right or wrong. */
const PASSWORD_TRIES = 20;

/**
 * Anyone signed in to this company with a page's link reads its current version here. A page
 * whose link is open to anyone also opens with its password, for someone not signed in; the
 * link alone opens nothing on the open internet. Every token that does not open a shared page
 * gets the same answer as a link that needs signing in, and nothing here runs tools or models.
 */
export function mountSharedPages(
  app: Hono,
  prisma: PrismaClient,
  clientIp: (c: Context) => string | undefined,
  /** The signed-in user's id, or null. */
  signedInUser: (request: Request) => Promise<string | null>,
) {
  const reads = windowCounter(MINUTE_MS);
  const tries = windowCounter(15 * MINUTE_MS);
  const headers = {
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
    "referrer-policy": "no-referrer",
  };
  /** The page this request may open, or the answer to send instead. */
  async function admit(c: Context): Promise<
    | {
        found: NonNullable<Awaited<ReturnType<typeof readSharedPage>>>;
        userId: string | null;
      }
    | Response
  > {
    const ip = throttleKey(clientIp(c));
    if (reads(ip) > READS_PER_IP_PER_MINUTE) {
      return c.json({ error: "Too many requests" }, 429, { ...headers, "retry-after": "60" });
    }
    const found = await readSharedPage(prisma, c.req.param("token") ?? "");
    const userId = await signedInUser(c.req.raw);
    if (userId) {
      if (!found) return c.json({ error: "Not found" }, 404, headers);
      return { found, userId };
    }
    if (found?.visibility !== "public" || !found.passwordHash) {
      return c.json({ error: "Sign in to view this page" }, 401, headers);
    }
    const given = c.req.header(SHARED_PAGE_PASSWORD_HEADER)?.trim();
    if (!given) {
      return c.json({ error: "Enter the page's password", needsPassword: true }, 401, headers);
    }
    if (tries(`${ip}:${found.pageId}`) > PASSWORD_TRIES) {
      return c.json({ error: "Too many tries" }, 429, { ...headers, "retry-after": "900" });
    }
    if (!sharePasswordMatches(found.passwordHash, given)) {
      return c.json({ error: "Wrong password", needsPassword: true, wrong: true }, 401, headers);
    }
    return { found, userId: null };
  }
  app.get(`${SHARED_PAGE_PATH_PREFIX}:token`, async (c) => {
    const admitted = await admit(c);
    if (admitted instanceof Response) return admitted;
    return c.json({ ...admitted.found.page, canSaveState: admitted.userId !== null }, 200, headers);
  });
  app.get(`${SHARED_PAGE_PATH_PREFIX}:token/state`, async (c) => {
    const admitted = await admit(c);
    if (admitted instanceof Response) return admitted;
    const values = await readSharedPageState(prisma, admitted.found.pageId);
    return c.json({ values, writable: admitted.userId !== null }, 200, headers);
  });
  app.put(`${SHARED_PAGE_PATH_PREFIX}:token/state`, async (c) => {
    const admitted = await admit(c);
    if (admitted instanceof Response) return admitted;
    if (!admitted.userId) return c.json({ error: "Sign in to save" }, 403, headers);
    const body = PageStateWriteSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid value" }, 400, headers);
    try {
      await saveSharedPageState(
        prisma,
        admitted.found.pageId,
        body.data.key,
        body.data.value,
        admitted.userId,
      );
    } catch (error) {
      if (error instanceof PageStateRefusedError) {
        return c.json({ error: error.message }, 400, headers);
      }
      throw error;
    }
    return c.json({ ok: true }, 200, headers);
  });
}
