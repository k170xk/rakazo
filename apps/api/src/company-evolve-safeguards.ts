import { ORPCError } from "@orpc/server";
import { callEvolveSafeguards, EvolvePluginsError } from "@rakazo/adapters";
import type { Actor, EvolveSafeguards, EvolveSafeguardsState } from "@rakazo/contracts";
import { EvolveSafeguardsStateSchema } from "@rakazo/contracts";
import { getLogger } from "@rakazo/logging";
import { requireAdmin } from "./admins.js";
import type { RouterDeps } from "./router.js";
import { actorEmail } from "./routes/bots.js";

/** Calls Evolve as the admin, so Evolve decides whether they are one of its admins too. */
async function asAdmin(
  deps: RouterDeps,
  actor: Actor,
  body: Record<string, unknown>,
): Promise<EvolveSafeguardsState> {
  await requireAdmin(deps, actor.userId);
  const email = await actorEmail(deps, actor);
  if (!deps.evolvePlugins || !email) {
    throw new ORPCError("BAD_REQUEST", { message: "Evolve is not linked to this server." });
  }
  let reply: unknown;
  try {
    reply = await callEvolveSafeguards(deps.evolvePlugins, email, body);
  } catch (error) {
    if (error instanceof EvolvePluginsError && (error.status === 403 || error.status === 400)) {
      throw new ORPCError(error.status === 403 ? "FORBIDDEN" : "BAD_REQUEST", {
        message: error.message,
      });
    }
    getLogger().warn("evolve safeguards", { error: String(error) });
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Evolve could not be reached. Try again shortly.",
    });
  }
  const parsed = EvolveSafeguardsStateSchema.safeParse(reply);
  if (!parsed.success) {
    getLogger().warn("evolve safeguards reply", { issues: parsed.error.issues.length });
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Evolve sent settings this server cannot read.",
    });
  }
  return parsed.data;
}

export function getEvolveSafeguards(deps: RouterDeps, actor: Actor) {
  return asAdmin(deps, actor, { action: "get" });
}

export function setEvolveSafeguards(deps: RouterDeps, actor: Actor, settings: EvolveSafeguards) {
  return asAdmin(deps, actor, { action: "set", settings });
}
