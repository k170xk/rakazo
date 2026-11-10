import { ORPCError } from "@orpc/server";
import { callEvolveDocumentLibrary, EvolvePluginsError } from "@rakazo/adapters";
import type { Actor, LibraryAiAccess, LibraryDocument } from "@rakazo/contracts";
import { companyToolsFrom, LibraryDocumentSchema } from "@rakazo/contracts";
import { runAsSystem } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { requireAdmin } from "./admins.js";
import { setCompanyTools } from "./company-admin.js";
import type { RouterDeps } from "./router.js";
import { actorEmail } from "./routes/bots.js";

/** Calls Evolve as the admin, so Evolve's own Document Library permission decides. */
async function asAdmin<T>(
  deps: RouterDeps,
  actor: Actor,
  body: Record<string, unknown>,
): Promise<T> {
  await requireAdmin(deps, actor.userId);
  const email = await actorEmail(deps, actor);
  if (!deps.evolvePlugins || !email) {
    throw new ORPCError("BAD_REQUEST", { message: "Evolve is not linked to this server." });
  }
  try {
    return await callEvolveDocumentLibrary<T>(deps.evolvePlugins, email, body);
  } catch (error) {
    if (error instanceof EvolvePluginsError && (error.status === 403 || error.status === 400)) {
      throw new ORPCError(error.status === 403 ? "FORBIDDEN" : "BAD_REQUEST", {
        message: error.message,
      });
    }
    getLogger().warn("evolve document library", { error: String(error) });
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Evolve's Document Library could not be reached. Try again shortly.",
    });
  }
}

async function defaultTemplateId(deps: RouterDeps): Promise<string | null> {
  const row = await runAsSystem("read the default Word template", () =>
    deps.prisma.deploymentSettings.findUnique({
      where: { id: "default" },
      select: { companyTools: true },
    }),
  );
  return companyToolsFrom(row?.companyTools).defaultWordTemplateId ?? null;
}

export async function listLibraryDocuments(
  deps: RouterDeps,
  actor: Actor,
): Promise<{ documents: LibraryDocument[]; defaultTemplateId: string | null }> {
  const result = await asAdmin<{ documents?: unknown[] }>(deps, actor, { action: "list" });
  return {
    documents: (result.documents ?? []).flatMap((row) => {
      const parsed = LibraryDocumentSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    }),
    defaultTemplateId: await defaultTemplateId(deps),
  };
}

/** Only a document Evolve currently marks as a Word template can become the default. */
export async function setDefaultLibraryTemplate(
  deps: RouterDeps,
  actor: Actor,
  input: { id: string | null },
): Promise<{ defaultTemplateId: string | null }> {
  if (input.id) {
    const { documents } = await listLibraryDocuments(deps, actor);
    const chosen = documents.find((document) => document.id === input.id);
    if (chosen?.aiAccess !== "template" || !chosen.canBeTemplate) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Set the document's AI access to Template first.",
      });
    }
  }
  await setCompanyTools(deps, actor, { defaultWordTemplateId: input.id });
  return { defaultTemplateId: input.id };
}

export async function setLibraryDocumentAccess(
  deps: RouterDeps,
  actor: Actor,
  input: { id: string; aiAccess: LibraryAiAccess },
): Promise<{ id: string; aiAccess: LibraryAiAccess }> {
  await asAdmin(deps, actor, { action: "set", id: input.id, aiAccess: input.aiAccess });
  return input;
}
