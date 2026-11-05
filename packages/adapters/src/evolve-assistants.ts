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
