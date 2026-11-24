import type { EvolvePluginsConnection } from "@rakazo/adapters";
import { verifyAppDataToken } from "@rakazo/adapters";
import type { AppInit } from "@rakazo/app-kit/protocol";
import {
  APP_CALL_OPS,
  MAX_ASK_PROMPT,
  MAX_EXTRACT_BASE64,
  MAX_UPLOAD_BASE64,
} from "@rakazo/app-kit/protocol";
import { editsAnything } from "@rakazo/app-kit/workspace";
import { PageStateWriteSchema } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { isAppDataError, runAsSystem } from "@rakazo/db";
import type { Hono } from "hono";
import { AppAskError, askForApp, sanitiseAskImages } from "./app-ask.js";
import type { AppCalls } from "./app-calls.js";
import { appCallFailure } from "./app-calls.js";
import type { AppExtractDeps } from "./app-extract.js";
import { AppExtractError, extractFileForApp, readExtractBody } from "./app-extract.js";
import { resolveLooker, workspaceSummary } from "./app-workspaces.js";
import type { SharedRowWrite } from "./apps.js";
import {
  addSharedAppUpload,
  colleaguesMayWrite,
  readSharedAppAsset,
  readSharedAppData,
  readSharedAppRevision,
  readUploadBody,
  writeSharedAppRow,
} from "./apps.js";
import { PageStateRefusedError, saveSharedPageState } from "./pages.js";
import { requestBodyLimit } from "./request-body-limit.js";
import { windowCounter } from "./window-counter.js";

export const EVOLVE_APP_DATA_PATH = "/api/evolve/app-data";

const MINUTE_MS = 60_000;
const WRITES_PER_PERSON_PER_MINUTE = 120;
const UPLOADS_PER_PERSON_PER_MINUTE = 30;
const TABLE = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * An app published as an Evolve plugin keeps its data here. Evolve's plugin-api, having checked
 * the person may open that plugin, signs who they are and which plugin it is; the app is the one
 * published under that slug. Anyone Evolve admits reads it, and changes follow the app's own
 * rule: its owner always, colleagues only when the owner lets the company change the data.
 */
export function mountEvolveAppData(
  app: Hono,
  prisma: PrismaClient,
  connection: EvolvePluginsConnection | null,
  /** Live changes, queries, comments and the rest, answered as the person Evolve signed. */
  calls?: AppCalls,
  /** Offline tool-runner extraction for signed-in Evolve staff. */
  extractDeps?: AppExtractDeps,
) {
  const writes = windowCounter(MINUTE_MS);
  const uploads = windowCounter(MINUTE_MS);
  const headers = { "cache-control": "no-store" };

  app.post(
    EVOLVE_APP_DATA_PATH,
    requestBodyLimit(Math.max(MAX_UPLOAD_BASE64, MAX_EXTRACT_BASE64) + 32_768),
    async (c) => {
    const token = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const caller = connection && token ? verifyAppDataToken(connection.secret, token) : null;
    if (!caller) return c.json({ error: "Unauthorized" }, 401, headers);
    const found = await runAsSystem("Evolve plugin app data", async () => {
      const page = await prisma.page.findUnique({
        where: { evolvePluginSlug: caller.slug },
        select: {
          id: true,
          title: true,
          kind: true,
          currentVersion: true,
          dataAccess: true,
          frozenAt: true,
          userId: true,
          user: { select: { email: true, emailVerified: true } },
        },
      });
      if (page?.kind !== "app" || page.frozenAt) return null;
      const viewer = await prisma.user.findFirst({
        where: { email: { equals: caller.email, mode: "insensitive" }, emailVerified: true },
        select: { id: true, name: true },
      });
      return { page, viewer };
    });
    if (!found) return c.json({ error: "This app is no longer published." }, 404, headers);
    const { page, viewer } = found;
    const isOwner =
      page.user.emailVerified && page.user.email.trim().toLowerCase() === caller.email;
    const looker = await resolveLooker(prisma, {
      pageId: page.id,
      userId: viewer?.id ?? null,
      email: caller.email,
    });
    // Rows remember who changed them, so only people with an account here write.
    const canEdit = viewer !== null && (isOwner || colleaguesMayWrite(page.dataAccess));
    const editsSomething = viewer !== null && (isOwner || editsAnything(looker, page.dataAccess));
    const ownRowsOnly = canEdit && !isOwner && page.dataAccess === "contribute";

    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const op = typeof body?.op === "string" ? body.op : "";
    const values = (value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;

    if (op === "init" || op === "data") {
      const data = await readSharedAppData(
        prisma,
        page.id,
        { userId: viewer?.id ?? null, names: viewer !== null },
        looker,
      );
      if (op === "data")
        return c.json(
          { tables: data.tables, revision: data.revision, icon: data.icon ?? undefined },
          200,
          headers,
        );
      const init: AppInit = {
        app: {
          id: page.id,
          title: page.title,
          version: page.currentVersion,
          ...(data.icon ? { icon: data.icon } : {}),
        },
        viewer: {
          name: viewer?.name ?? null,
          canEdit,
          ...(ownRowsOnly ? { ownRowsOnly } : {}),
          role: isOwner ? "owner" : "member",
        },
        theme: "light",
        workspace: workspaceSummary(looker),
        tables: data.tables,
        state: data.state as Record<string, unknown>,
        revision: data.revision,
        features: [
          "assets",
          ...(editsSomething ? ["uploads"] : []),
          ...(viewer ? ["ai"] : []),
          ...(viewer && extractDeps?.toolRunner && extractDeps.dataDir ? ["extract"] : []),
          ...(calls
            ? ["live", "query", ...(viewer ? ["comments", "history", "services"] : [])]
            : []),
          ...(calls && isOwner ? ["evolve"] : []),
        ],
      };
      return c.json(init, 200, headers);
    }
    if (op === "revision")
      return c.json({ revision: await readSharedAppRevision(prisma, page.id) }, 200, headers);
    if (calls && APP_CALL_OPS.has(op as never)) {
      try {
        const result = await calls.handle(
          {
            pageId: page.id,
            ownerId: page.userId,
            userId: viewer?.id ?? null,
            email: caller.email,
            via: "evolve",
          },
          body,
        );
        return c.json(result ?? null, 200, headers);
      } catch (error) {
        const failure = appCallFailure(error);
        return c.json({ error: failure.error }, failure.status, headers);
      }
    }
    if (op === "asset") {
      const id = typeof body?.id === "string" ? body.id.slice(0, 64) : "";
      const asset = id ? await readSharedAppAsset(prisma, page.id, id, looker) : null;
      if (!asset) return c.json({ error: "That picture is not in this app." }, 404, headers);
      return c.json(
        { mime: asset.mime, base64: Buffer.from(asset.bytes).toString("base64") },
        200,
        headers,
      );
    }
    if (op === "ai.ask") {
      if (!viewer) return c.json({ error: "Sign in to use AI in this app." }, 403, headers);
      const prompt = typeof body?.prompt === "string" ? body.prompt : "";
      if (!prompt.trim() || prompt.length > MAX_ASK_PROMPT) {
        return c.json({ error: "Invalid question." }, 400, headers);
      }
      try {
        const answer = await askForApp({
          userId: viewer.id,
          prompt,
          json: body?.json === true,
          images: sanitiseAskImages(body?.images),
        });
        return c.json(answer ?? null, 200, headers);
      } catch (error) {
        if (error instanceof AppAskError) return c.json({ error: error.message }, 400, headers);
        throw error;
      }
    }
    if (op === "file.extract") {
      if (!viewer) return c.json({ error: "Sign in to extract files in this app." }, 403, headers);
      if (!extractDeps?.toolRunner || !extractDeps.dataDir) {
        return c.json({ error: "File extraction is not set up on this server." }, 503, headers);
      }
      const parsed = readExtractBody(body);
      if (!parsed) return c.json({ error: "Invalid file payload." }, 400, headers);
      try {
        const result = await extractFileForApp(extractDeps, {
          ...parsed,
          userId: viewer.id,
          signal: c.req.raw.signal,
        });
        return c.json(result, 200, headers);
      } catch (error) {
        if (error instanceof AppExtractError) {
          return c.json({ error: error.message }, error.status, headers);
        }
        throw error;
      }
    }

    if (!["rows.insert", "rows.update", "rows.remove", "state.set", "upload"].includes(op))
      return c.json({ error: "That is not available in Evolve." }, 400, headers);
    if (!editsSomething || !viewer)
      return c.json({ error: "Only the app's owner can change its data." }, 403, headers);
    if (op === "upload") {
      if (uploads(`${caller.email}:${page.id}`) > UPLOADS_PER_PERSON_PER_MINUTE)
        return c.json({ error: "Too many photos at once. Wait a minute." }, 429, headers);
      const upload = readUploadBody(body);
      if (!upload) return c.json({ error: "That is not a photo." }, 400, headers);
      try {
        return c.json(await addSharedAppUpload(prisma, page.id, upload, viewer.id), 200, headers);
      } catch (error) {
        if (isAppDataError(error))
          return c.json(
            { error: error instanceof Error ? error.message : "Refused" },
            400,
            headers,
          );
        throw error;
      }
    }
    if (writes(`${caller.email}:${page.id}`) > WRITES_PER_PERSON_PER_MINUTE)
      return c.json({ error: "Too many changes. Wait a minute." }, 429, headers);
    if (JSON.stringify(body).length > 64_000)
      return c.json({ error: "That change is too large." }, 413, headers);

    if (op === "state.set") {
      if (!canEdit || ownRowsOnly)
        return c.json({ error: "Only the app's owner can change its settings." }, 403, headers);
      const state = PageStateWriteSchema.safeParse({ key: body?.key, value: body?.value });
      if (!state.success) return c.json({ error: "Invalid value" }, 400, headers);
      try {
        await saveSharedPageState(prisma, page.id, state.data.key, state.data.value, viewer.id);
      } catch (error) {
        if (error instanceof PageStateRefusedError)
          return c.json({ error: error.message }, 400, headers);
        throw error;
      }
      return c.json({ ok: true }, 200, headers);
    }

    const table = typeof body?.table === "string" && TABLE.test(body.table) ? body.table : null;
    const id = typeof body?.id === "string" ? body.id.slice(0, 64) : "";
    let write: SharedRowWrite | null = null;
    if (table && op === "rows.insert" && values(body?.row))
      write = { op: "insert", table, row: values(body?.row)! };
    else if (table && op === "rows.update" && id && values(body?.patch))
      write = { op: "update", table, id, patch: values(body?.patch)! };
    else if (table && op === "rows.remove" && id) write = { op: "remove", table, id };
    if (!write) return c.json({ error: "Invalid change" }, 400, headers);
    try {
      const saved = await writeSharedAppRow(
        prisma,
        page.id,
        write,
        { ...looker, isOwner: looker.isOwner || isOwner, userId: viewer.id },
        page.dataAccess,
        "evolve",
      );
      return c.json("row" in saved ? saved.row : saved, 200, headers);
    } catch (error) {
      if (isAppDataError(error))
        return c.json({ error: error instanceof Error ? error.message : "Refused" }, 400, headers);
      throw error;
    }
  });
}
