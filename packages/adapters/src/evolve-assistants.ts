import type { EvolveAssistant } from "@rakazo/contracts";
import { EvolveAssistantSchema } from "@rakazo/contracts";
import { z } from "zod";
import type { EvolvePluginsConnection } from "./evolve-plugins.js";
import { callEvolveAssistants } from "./evolve-plugins.js";

/** One Evolve assistant with the prompt a new bot copies. */
export type EvolveAssistantDetail = EvolveAssistant & { instructions: string };

const ListSchema = z.object({
  assistants: z.array(EvolveAssistantSchema.extend({ instructions: z.string() })),
});

/** The Evolve chat assistants this person can open in Evolve. */
export async function listEvolveAssistants(
  connection: EvolvePluginsConnection,
  email: string,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<EvolveAssistantDetail[]> {
  const payload = await callEvolveAssistants(connection, email, { action: "list" }, options);
  return ListSchema.parse(payload).assistants;
}

/** How long an answer from Evolve stands before a run asks again, so a removal lands within it. */
export const EVOLVE_ACCESS_TTL_MS = 5 * 60_000;
/** While Evolve cannot be reached, an earlier yes this recent still counts. */
export const EVOLVE_ACCESS_GRACE_MS = 60 * 60_000;

export const EVOLVE_ASSISTANT_NO_ACCESS =
  "This bot is built on an Evolve assistant you no longer have access to. An Evolve admin can give you access in Access Control → Assistants.";
export const EVOLVE_ASSISTANT_UNCONFIRMED =
  "Evolve could not confirm you still have access to this bot's assistant. Try again in a few minutes.";

const accessCache = new Map<string, { ids: ReadonlySet<string>; at: number }>();

export function clearEvolveAccessCache(): void {
  accessCache.clear();
}

/**
 * Why this person may not run a bot built on an Evolve assistant, or null when they may.
 * Evolve's own list is the only authority, so the groups, people and line-manager grants set in
 * Evolve's Access Control apply here unchanged.
 */
export async function evolveAssistantAccessError(
  connection: EvolvePluginsConnection | null | undefined,
  email: string | null | undefined,
  assistantId: string,
  options: { now?: number; signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<string | null> {
  if (!connection || !email) return EVOLVE_ASSISTANT_UNCONFIRMED;
  const now = options.now ?? Date.now();
  const key = email.trim().toLowerCase();
  const cached = accessCache.get(key);
  let ids = cached && now - cached.at < EVOLVE_ACCESS_TTL_MS ? cached.ids : null;
  if (!ids) {
    try {
      const assistants = await listEvolveAssistants(connection, email, options);
      ids = new Set(assistants.map((assistant) => assistant.id));
      accessCache.set(key, { ids, at: now });
    } catch {
      if (!cached || now - cached.at >= EVOLVE_ACCESS_GRACE_MS) return EVOLVE_ASSISTANT_UNCONFIRMED;
      ids = cached.ids;
    }
  }
  return ids.has(assistantId) ? null : EVOLVE_ASSISTANT_NO_ACCESS;
}
