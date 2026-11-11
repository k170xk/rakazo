import type { EvolvePluginsConnection } from "@rakazo/adapters";
import { verifyAppDataToken } from "@rakazo/adapters";
import type { AppInit } from "@rakazo/app-kit/protocol";
import { PageStateWriteSchema } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { isAppDataError, runAsSystem } from "@rakazo/db";
import type { Hono } from "hono";
import type { SharedRowWrite } from "./apps.js";
import {
  readSharedAppAsset,
  readSharedAppData,
  readSharedAppRevision,
  writeSharedAppRow,
} from "./apps.js";
import { PageStateRefusedError, saveSharedPageState } from "./pages.js";
import { windowCounter } from "./window-counter.js";

export const EVOLVE_APP_DATA_PATH = "/api/evolve/app-data";

const MINUTE_MS = 60_000;
const WRITES_PER_PERSON_PER_MINUTE = 120;
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
) {
  const writes = windowCounter(MINUTE_MS);
  const headers = { "cache-control": "no-store" };

  app.post(EVOLVE_APP_DATA_PATH, async (c) => {
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
          user: { select: { email: true } },
        },
      });
      if (page?.kind !== "app") return null;
      const viewer = await prisma.user.findFirst({
        where: { email: { equals: caller.email, mode: "insensitive" } },
        select: { id: true, name: true },
      });
      return { page, viewer };
    });
    if (!found) return c.json({ error: "This app is no longer published." }, 404, headers);
    const { page, viewer } = found;
    const isOwner = page.user.email.trim().toLowerCase() === caller.email;
    // Rows remember who changed them, so only people with an account here write.
    const canEdit = viewer !== null && (isOwner || page.dataAccess === "company");

    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const op = typeof body?.op === "string" ? body.op : "";
    const values = (value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;

    if (op === "init" || op === "data") {
      const data = await readSharedAppData(prisma, page.id);
      if (op === "data")
        return c.json({ tables: data.tables, revision: data.revision }, 200, headers);
      const init: AppInit = {
        app: { id: page.id, title: page.title, version: page.currentVersion },
        viewer: {
          name: viewer?.name ?? null,
          canEdit,
          role: isOwner ? "owner" : "member",
        },
        theme: "light",
        tables: data.tables,
        state: data.state as Record<string, unknown>,
        revision: data.revision,
        features: ["assets"],
      };
      return c.json(init, 200, headers);
    }
    if (op === "revision")
      return c.json({ revision: await readSharedAppRevision(prisma, page.id) }, 200, headers);
    if (op === "asset") {
      const id = typeof body?.id === "string" ? body.id.slice(0, 64) : "";
      const asset = id ? await readSharedAppAsset(prisma, page.id, id) : null;
      if (!asset) return c.json({ error: "That picture is not in this app." }, 404, headers);
      return c.json(
        { mime: asset.mime, base64: Buffer.from(asset.bytes).toString("base64") },
        200,
        headers,
      );
    }

    if (!["rows.insert", "rows.update", "rows.remove", "state.set"].includes(op))
      return c.json({ error: "That is not available in Evolve." }, 400, headers);
    if (!canEdit || !viewer)
      return c.json({ error: "Only the app's owner can change its data." }, 403, headers);
    if (writes(`${caller.email}:${page.id}`) > WRITES_PER_PERSON_PER_MINUTE)
      return c.json({ error: "Too many changes. Wait a minute." }, 429, headers);
    if (JSON.stringify(body).length > 64_000)
      return c.json({ error: "That change is too large." }, 413, headers);

    if (op === "state.set") {
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
      const saved = await writeSharedAppRow(prisma, page.id, write, viewer.id);
      return c.json("row" in saved ? saved.row : saved, 200, headers);
    } catch (error) {
      if (isAppDataError(error))
        return c.json({ error: error instanceof Error ? error.message : "Refused" }, 400, headers);
      throw error;
    }
  });
}
