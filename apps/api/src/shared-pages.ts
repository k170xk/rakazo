import { MAX_UPLOAD_BASE64, SHARED_APP_CALL_PATH } from "@rakazo/app-kit/protocol";
import { editsAnything } from "@rakazo/app-kit/workspace";
import {
  PageStateWriteSchema,
  SHARED_PAGE_PASSWORD_HEADER,
  SHARED_PAGE_PATH_PREFIX,
} from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { isAppDataError, runAsSystem } from "@rakazo/db";
import type { Context, Hono } from "hono";
import { AppAskError, askForApp } from "./app-ask.js";
import type { AppCalls } from "./app-calls.js";
import { appCallFailure } from "./app-calls.js";
import { resolveLooker, workspaceSummary } from "./app-workspaces.js";
import type { SharedRowWrite } from "./apps.js";
import {
  addSharedAppUpload,
  colleaguesMayWrite,
  exportSharedAppTable,
  readSharedAppAsset,
  readSharedAppData,
  readSharedAppRevision,
  readUploadBody,
  writeSharedAppRow,
} from "./apps.js";
import { sameCompanyEmail } from "./company-email.js";
import {
  PageStateRefusedError,
  readSharedPage,
  readSharedPageState,
  saveSharedPageState,
  sharePasswordMatches,
} from "./pages.js";
import { requestBodyLimit } from "./request-body-limit.js";
import { throttleKey, windowCounter } from "./window-counter.js";

const MINUTE_MS = 60_000;
const READS_PER_IP_PER_MINUTE = 120;
/** Password tries per address and link in 15 minutes, right or wrong. */
const PASSWORD_TRIES = 20;
/** Row writes per address and app a minute, so a script on an open link cannot flood a table. */
const WRITES_PER_MINUTE = 120;
/** Photos per address and app a minute. */
const UPLOADS_PER_MINUTE = 30;

export { sameCompanyEmail };

async function colleagueOfOwner(prisma: PrismaClient, viewerId: string, ownerId: string) {
  if (viewerId === ownerId) return true;
  const people = await runAsSystem("check a shared page reader's company", () =>
    prisma.user.findMany({
      where: { id: { in: [viewerId, ownerId] } },
      select: { id: true, email: true, emailVerified: true },
    }),
  );
  const viewer = people.find((person) => person.id === viewerId);
  const owner = people.find((person) => person.id === ownerId);
  return Boolean(viewer?.emailVerified && owner && sameCompanyEmail(viewer.email, owner.email));
}

/**
 * A page's saved values follow an app's data setting, since an app keeps data in them too; as in
 * Evolve, someone who may only add their own rows cannot change the app's shared settings.
 */
export function sharedStateWritable(kind: string, dataAccess: string, userId: string | null) {
  if (userId === null) return false;
  return kind !== "app" || dataAccess === "company";
}

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
  /** Live changes, queries, comments and the rest, answered as the reader the link admitted. */
  calls?: AppCalls,
) {
  const reads = windowCounter(MINUTE_MS);
  const writes = windowCounter(MINUTE_MS);
  const uploads = windowCounter(MINUTE_MS);
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
    const signedIn = await signedInUser(c.req.raw);
    if (signedIn && !found) return c.json({ error: "Not found" }, 404, headers);
    // Only the owner's colleagues open a link by being signed in; any other account needs the
    // password like a visitor, and gets the same answers.
    if (signedIn && found && (await colleagueOfOwner(prisma, signedIn, found.ownerId))) {
      return { found, userId: signedIn };
    }
    if (signedIn && found?.visibility !== "public") {
      return c.json({ error: "Not found" }, 404, headers);
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
  const lookerOf = (admitted: { found: { pageId: string }; userId: string | null }) =>
    resolveLooker(prisma, { pageId: admitted.found.pageId, userId: admitted.userId });
  app.get(`${SHARED_PAGE_PATH_PREFIX}:token`, async (c) => {
    const admitted = await admit(c);
    if (admitted instanceof Response) return admitted;
    const looker = admitted.found.page.kind === "app" ? await lookerOf(admitted) : null;
    return c.json(
      {
        ...admitted.found.page,
        canSaveState: sharedStateWritable(
          admitted.found.page.kind,
          admitted.found.dataAccess,
          admitted.userId,
        ),
        canEditData: looker !== null && editsAnything(looker, admitted.found.dataAccess),
      },
      200,
      headers,
    );
  });
  /** An app's tables for a reader the link admitted; canEdit says whether they may change rows. */
  app.get(`${SHARED_PAGE_PATH_PREFIX}:token/app/data`, async (c) => {
    const admitted = await admit(c);
    if (admitted instanceof Response) return admitted;
    if (admitted.found.page.kind !== "app") return c.json({ error: "Not found" }, 404, headers);
    const looker = await lookerOf(admitted);
    const data = await readSharedAppData(
      prisma,
      admitted.found.pageId,
      { userId: admitted.userId, names: admitted.userId !== null },
      looker,
    );
    const canEdit = admitted.userId !== null && colleaguesMayWrite(admitted.found.dataAccess);
    return c.json(
      {
        ...data,
        canEdit,
        workspace: workspaceSummary(looker),
        ownRowsOnly: canEdit && admitted.found.dataAccess === "contribute",
        isOwner: admitted.userId !== null && admitted.userId === admitted.found.ownerId,
        canSaveState: sharedStateWritable(
          admitted.found.page.kind,
          admitted.found.dataAccess,
          admitted.userId,
        ),
      },
      200,
      headers,
    );
  });
  app.get(`${SHARED_PAGE_PATH_PREFIX}:token/app/revision`, async (c) => {
    const admitted = await admit(c);
    if (admitted instanceof Response) return admitted;
    if (admitted.found.page.kind !== "app") return c.json({ error: "Not found" }, 404, headers);
    return c.json(
      { revision: await readSharedAppRevision(prisma, admitted.found.pageId) },
      200,
      headers,
    );
  });
  app.post(`${SHARED_PAGE_PATH_PREFIX}:token/app/rows`, async (c) => {
    const admitted = await admit(c);
    if (admitted instanceof Response) return admitted;
    if (admitted.found.page.kind !== "app") return c.json({ error: "Not found" }, 404, headers);
    const looker = await lookerOf(admitted);
    const userId = admitted.userId;
    if (!userId || !editsAnything(looker, admitted.found.dataAccess)) {
      return c.json({ error: "Only the owner can change this app's data" }, 403, headers);
    }
    if (writes(`${throttleKey(clientIp(c))}:${admitted.found.pageId}`) > WRITES_PER_MINUTE) {
      return c.json({ error: "Too many changes" }, 429, { ...headers, "retry-after": "60" });
    }
    const body = (await c.req.json().catch(() => null)) as Partial<SharedRowWrite> | null;
    const table =
      typeof body?.table === "string" && /^[a-z][a-z0-9_]{0,39}$/.test(body.table)
        ? body.table
        : null;
    const values = (value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    let write: SharedRowWrite | null = null;
    if (table && body?.op === "insert" && values(body.row))
      write = { op: "insert", table, row: values(body.row)! };
    else if (table && body?.op === "update" && typeof body.id === "string" && values(body.patch)) {
      write = { op: "update", table, id: body.id.slice(0, 64), patch: values(body.patch)! };
    } else if (table && body?.op === "remove" && typeof body.id === "string")
      write = { op: "remove", table, id: body.id.slice(0, 64) };
    if (!write) return c.json({ error: "Invalid change" }, 400, headers);
    if (JSON.stringify(write).length > 64_000)
      return c.json({ error: "That change is too large" }, 413, headers);
    try {
      return c.json(
        await writeSharedAppRow(
          prisma,
          admitted.found.pageId,
          write,
          { ...looker, userId },
          admitted.found.dataAccess,
        ),
        200,
        headers,
      );
    } catch (error) {
      if (isAppDataError(error))
        return c.json({ error: error instanceof Error ? error.message : "Refused" }, 400, headers);
      throw error;
    }
  });
  /** A photo from a colleague allowed to change the app's data; answers with its picture id. */
  app.post(
    `${SHARED_PAGE_PATH_PREFIX}:token/app/uploads`,
    requestBodyLimit(MAX_UPLOAD_BASE64 + 4096, "That photo is too large"),
    async (c) => {
      const admitted = await admit(c);
      if (admitted instanceof Response) return admitted;
      if (admitted.found.page.kind !== "app") return c.json({ error: "Not found" }, 404, headers);
      if (!admitted.userId || !editsAnything(await lookerOf(admitted), admitted.found.dataAccess)) {
        return c.json({ error: "Only the owner can add photos to this app" }, 403, headers);
      }
      if (uploads(`${throttleKey(clientIp(c))}:${admitted.found.pageId}`) > UPLOADS_PER_MINUTE) {
        return c.json({ error: "Too many photos at once" }, 429, {
          ...headers,
          "retry-after": "60",
        });
      }
      const body = readUploadBody(await c.req.json().catch(() => null));
      if (!body) return c.json({ error: "That is not a photo" }, 400, headers);
      try {
        return c.json(
          await addSharedAppUpload(prisma, admitted.found.pageId, body, admitted.userId),
          200,
          headers,
        );
      } catch (error) {
        if (isAppDataError(error))
          return c.json(
            { error: error instanceof Error ? error.message : "Refused" },
            400,
            headers,
          );
        throw error;
      }
    },
  );
  app.get(`${SHARED_PAGE_PATH_PREFIX}:token/app/assets/:assetId`, async (c) => {
    const admitted = await admit(c);
    if (admitted instanceof Response) return admitted;
    if (admitted.found.page.kind !== "app" && admitted.found.page.kind !== "whiteboard") {
      return c.json({ error: "Not found" }, 404, headers);
    }
    const asset = await readSharedAppAsset(
      prisma,
      admitted.found.pageId,
      (c.req.param("assetId") ?? "").slice(0, 64),
      await lookerOf(admitted),
    );
    if (!asset) return c.json({ error: "Not found" }, 404, headers);
    return c.body(new Uint8Array(asset.bytes), 200, {
      ...headers,
      "content-type": asset.mime,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
  });
  /** An app's AI answer, for colleagues signed in to the company; visitors with the password get none. */
  app.post(`${SHARED_PAGE_PATH_PREFIX}:token/app/ask`, async (c) => {
    const admitted = await admit(c);
    if (admitted instanceof Response) return admitted;
    if (admitted.found.page.kind !== "app") return c.json({ error: "Not found" }, 404, headers);
    if (!admitted.userId) return c.json({ error: "Sign in to use AI in this app" }, 403, headers);
    const body = (await c.req.json().catch(() => null)) as {
      prompt?: unknown;
      json?: unknown;
    } | null;
    if (typeof body?.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 8000)
      return c.json({ error: "Invalid question" }, 400, headers);
    try {
      const answer = await askForApp({
        userId: admitted.userId,
        prompt: body.prompt,
        json: body.json === true,
      });
      return c.json({ answer }, 200, headers);
    } catch (error) {
      if (error instanceof AppAskError) return c.json({ error: error.message }, 400, headers);
      throw error;
    }
  });
  app.post(
    `${SHARED_PAGE_PATH_PREFIX}:token/${SHARED_APP_CALL_PATH}`,
    requestBodyLimit(64_000, "That request is too large"),
    async (c) => {
      const admitted = await admit(c);
      if (admitted instanceof Response) return admitted;
      if (admitted.found.page.kind !== "app" || !calls)
        return c.json({ error: "Not found" }, 404, headers);
      try {
        const result = await calls.handle(
          {
            pageId: admitted.found.pageId,
            ownerId: admitted.found.ownerId,
            userId: admitted.userId,
            via: "shared",
          },
          await c.req.json().catch(() => null),
        );
        return c.json({ result: result ?? null }, 200, headers);
      } catch (error) {
        const failure = appCallFailure(error);
        return c.json({ error: failure.error }, failure.status, headers);
      }
    },
  );
  app.get(`${SHARED_PAGE_PATH_PREFIX}:token/app/export`, async (c) => {
    const admitted = await admit(c);
    if (admitted instanceof Response) return admitted;
    if (admitted.found.page.kind !== "app") return c.json({ error: "Not found" }, 404, headers);
    const table = c.req.query("table") ?? "";
    const format = c.req.query("format") === "csv" ? "csv" : "xlsx";
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(table))
      return c.json({ error: "Invalid table" }, 400, headers);
    try {
      return c.json(
        await exportSharedAppTable(
          prisma,
          admitted.found.pageId,
          table,
          format,
          await lookerOf(admitted),
        ),
        200,
        headers,
      );
    } catch {
      return c.json({ error: "Not found" }, 404, headers);
    }
  });
  app.get(`${SHARED_PAGE_PATH_PREFIX}:token/state`, async (c) => {
    const admitted = await admit(c);
    if (admitted instanceof Response) return admitted;
    const values = await readSharedPageState(prisma, admitted.found.pageId);
    return c.json(
      {
        values,
        writable: sharedStateWritable(
          admitted.found.page.kind,
          admitted.found.dataAccess,
          admitted.userId,
        ),
      },
      200,
      headers,
    );
  });
  app.put(`${SHARED_PAGE_PATH_PREFIX}:token/state`, async (c) => {
    const admitted = await admit(c);
    if (admitted instanceof Response) return admitted;
    if (!admitted.userId) return c.json({ error: "Sign in to save" }, 403, headers);
    if (
      !sharedStateWritable(admitted.found.page.kind, admitted.found.dataAccess, admitted.userId)
    ) {
      return c.json({ error: "Only the owner can change this app's data" }, 403, headers);
    }
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
