import { ORPCError } from "@orpc/server";
import {
  EvolveToolRefusal,
  enrolInLearningClinic,
  evolveToolCatalogue,
  loadLearningClinic,
  markLearningModuleWatched,
  submitLearningQuiz,
} from "@rakazo/adapters";
import { getLogger } from "@rakazo/logging";
import { actorEmail } from "./bots.js";
import type { RouterContext } from "./context.js";

/**
 * Clinic cards and the staff tool catalogue. Every call is signed as the person clicking, so Evolve
 * checks their own Learning Centre access and saves only their own enrolment and quiz attempts.
 */
export function evolveLearningRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;

  async function linked(actor: Parameters<typeof actorEmail>[1]) {
    const email = await actorEmail(deps, actor);
    if (!deps.evolvePlugins || !email) {
      throw new ORPCError("BAD_REQUEST", { message: "Evolve is not linked to this server." });
    }
    return { connection: deps.evolvePlugins, email };
  }

  function refused(error: unknown): never {
    if (error instanceof EvolveToolRefusal) {
      throw new ORPCError("BAD_REQUEST", { message: error.message });
    }
    getLogger().warn("evolve learning", { error: String(error) });
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Evolve's Learning Centre could not be reached. Try again.",
    });
  }

  return {
    evolveLearning: {
      card: authed.evolveLearning.card.handler(async ({ context, input }) => {
        const { connection, email } = await linked(context.actor);
        return loadLearningClinic(connection, email, input.clinicId, context.signal).catch(refused);
      }),
      enrol: authed.evolveLearning.enrol.handler(async ({ context, input }) => {
        const { connection, email } = await linked(context.actor);
        try {
          await enrolInLearningClinic(connection, email, input.clinicId, context.signal);
          return await loadLearningClinic(connection, email, input.clinicId, context.signal);
        } catch (error) {
          refused(error);
        }
      }),
      markWatched: authed.evolveLearning.markWatched.handler(async ({ context, input }) => {
        const { connection, email } = await linked(context.actor);
        try {
          await markLearningModuleWatched(
            connection,
            email,
            input.clinicId,
            input.moduleId,
            context.signal,
          );
          return await loadLearningClinic(connection, email, input.clinicId, context.signal);
        } catch (error) {
          refused(error);
        }
      }),
      submitQuiz: authed.evolveLearning.submitQuiz.handler(async ({ context, input }) => {
        const { connection, email } = await linked(context.actor);
        try {
          const result = await submitLearningQuiz(connection, email, input, context.signal);
          const clinic = await loadLearningClinic(
            connection,
            email,
            input.clinicId,
            context.signal,
          );
          return { result, clinic };
        } catch (error) {
          refused(error);
        }
      }),
    },
    evolveTools: {
      catalogue: authed.evolveTools.catalogue.handler(async ({ context }) => {
        const health = deps.evolveTools?.health();
        const email = await actorEmail(deps, context.actor);
        if (!health || !deps.evolvePlugins || !email) {
          return { status: "not-configured" as const, tools: [] };
        }
        return evolveToolCatalogue(deps.evolvePlugins, email, health, context.signal).catch(
          (error: unknown) => {
            getLogger().warn("evolve tool catalogue", { error: String(error) });
            return { status: "unavailable" as const, tools: [] };
          },
        );
      }),
    },
  };
}
