import { ORPCError } from "@orpc/server";
import {
  listEvolveAssistants,
  listEvolveReferenceExemplars,
  listEvolveReferencePeople,
  listEvolveReferenceProjects,
} from "@rakazo/adapters";
import type { EvolveReferenceTabs } from "@rakazo/contracts";
import { IsolationError } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { actorEmail } from "./bots.js";
import type { RouterContext } from "./context.js";

const UNAVAILABLE: EvolveReferenceTabs = { available: false, people: false, exemplars: false };

/** The References dialog's calls, each made as the signed-in person's Evolve profile. */
export function evolveReferencesRoutes(ctx: RouterContext) {
  const { deps, repos, authed } = ctx;

  async function connectionFor(actor: Parameters<typeof actorEmail>[1]) {
    const email = await actorEmail(deps, actor);
    if (!deps.evolvePlugins || !email) return null;
    return { connection: deps.evolvePlugins, email };
  }

  async function required(actor: Parameters<typeof actorEmail>[1]) {
    const linked = await connectionFor(actor);
    if (!linked) {
      throw new ORPCError("BAD_REQUEST", { message: "Evolve is not linked to this server." });
    }
    return linked;
  }

  function unreachable(error: unknown): never {
    getLogger().warn("evolve references", { error: String(error) });
    throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Evolve could not be reached." });
  }

  return {
    evolveReferences: {
      tabs: authed.evolveReferences.tabs.handler(async ({ context, input }) => {
        const linked = await connectionFor(context.actor);
        if (!linked) return UNAVAILABLE;
        if (!input.botId) return { available: true, people: true, exemplars: true };
        const bots = await repos.listBots(context.actor);
        if (!bots.some((bot) => bot.id === input.botId)) throw new IsolationError();
        const row = await deps.prisma.bot.findUnique({
          where: { id: input.botId },
          select: { evolveAssistantId: true },
        });
        // A bot not started from an Evolve assistant offers every tab.
        if (!row?.evolveAssistantId) return { available: true, people: true, exemplars: true };
        try {
          const assistants = await listEvolveAssistants(linked.connection, linked.email, {
            signal: context.signal,
          });
          const assistant = assistants.find((item) => item.id === row.evolveAssistantId);
          if (!assistant) return { available: true, people: true, exemplars: true };
          return {
            available: true,
            people: assistant.enablePeople === true,
            exemplars: assistant.enableResponses === true,
          };
        } catch (error) {
          getLogger().warn("evolve references tabs", { error: String(error) });
          return { available: true, people: false, exemplars: false };
        }
      }),
      projects: authed.evolveReferences.projects.handler(async ({ context, input }) => {
        const { connection, email } = await required(context.actor);
        return listEvolveReferenceProjects(connection, email, input, {
          signal: context.signal,
        }).catch(unreachable);
      }),
      people: authed.evolveReferences.people.handler(async ({ context }) => {
        const { connection, email } = await required(context.actor);
        const people = await listEvolveReferencePeople(connection, email, {
          signal: context.signal,
        }).catch(unreachable);
        return { people };
      }),
      exemplars: authed.evolveReferences.exemplars.handler(async ({ context }) => {
        const { connection, email } = await required(context.actor);
        const exemplars = await listEvolveReferenceExemplars(connection, email, {
          signal: context.signal,
        }).catch(unreachable);
        return { exemplars };
      }),
    },
  };
}
