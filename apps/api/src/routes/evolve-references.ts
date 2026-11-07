import { ORPCError } from "@orpc/server";
import {
  EvolvePluginsError,
  editEvolveImage,
  listEvolveAssistants,
  listEvolvePeopleCvs,
  listEvolveReferenceExemplars,
  listEvolveReferencePeople,
  listEvolveReferenceProjects,
} from "@rakazo/adapters";
import type { EvolveReferences, EvolveReferenceTabs } from "@rakazo/contracts";
import { evolvePersonCvText } from "@rakazo/contracts";
import { IsolationError } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { actorEmail } from "./bots.js";
import type { RouterContext } from "./context.js";

/**
 * Referenced people with their whole Evolve CV, read from Evolve as the sender. Any CV text the
 * client sent is replaced, so the model only ever sees what Evolve holds.
 */
export async function withEvolvePeopleCvs(
  deps: Parameters<typeof actorEmail>[0],
  actor: Parameters<typeof actorEmail>[1],
  references: EvolveReferences | undefined,
): Promise<EvolveReferences | undefined> {
  if (!references?.people.length) return references;
  const people = references.people.map(({ cv: _cv, ...person }) => person);
  const email = await actorEmail(deps, actor);
  if (!deps.evolvePlugins || !email) {
    throw new ORPCError("BAD_REQUEST", { message: "Evolve is not linked to this server." });
  }
  const cvs = await listEvolvePeopleCvs(
    deps.evolvePlugins,
    email,
    people.map((person) => person.id),
  ).catch((error: unknown) => {
    getLogger().warn("evolve people cvs", { error: String(error) });
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Could not load these people's CVs from Evolve. Try again.",
    });
  });
  const cvById = new Map(cvs.map((cv) => [cv.id, evolvePersonCvText(cv)]));
  return {
    ...references,
    people: people.map((person) => {
      const cv = cvById.get(person.id);
      return cv ? { ...person, cv } : person;
    }),
  };
}

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
    evolveImages: {
      available: authed.evolveImages.available.handler(async ({ context }) => ({
        available: (await connectionFor(context.actor)) !== null,
      })),
      edit: authed.evolveImages.edit.handler(async ({ context, input }) => {
        const { connection, email } = await required(context.actor);
        try {
          return {
            image: await editEvolveImage(connection, email, input, { signal: context.signal }),
          };
        } catch (error) {
          getLogger().warn("evolve image edit", { error: String(error) });
          if (error instanceof EvolvePluginsError && error.status === 429) {
            throw new ORPCError("TOO_MANY_REQUESTS", {
              message: "The image service is busy. Wait a moment and render again.",
            });
          }
          throw new ORPCError("SERVICE_UNAVAILABLE", {
            message:
              error instanceof EvolvePluginsError && error.status < 500
                ? error.message
                : "The render did not finish. Try again, or choose quality Low.",
          });
        }
      }),
    },
  };
}
