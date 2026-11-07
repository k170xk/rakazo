import type {
  EvolvePersonCv,
  EvolvePersonOption,
  EvolveProjectPage,
  EvolveReferenceExemplar,
} from "@rakazo/contracts";
import {
  EvolvePersonCvSchema,
  EvolvePersonOptionSchema,
  EvolveProjectPageSchema,
  EvolveReferenceExemplarSchema,
} from "@rakazo/contracts";
import { z } from "zod";
import type { EvolvePluginsConnection } from "./evolve-plugins.js";
import { callEvolveAssistants } from "./evolve-plugins.js";

type CallOptions = { signal?: AbortSignal; fetch?: typeof fetch };

/** One page of Evolve project datasheets (20 a page), searched by job number, name, client or summary. */
export async function listEvolveReferenceProjects(
  connection: EvolvePluginsConnection,
  email: string,
  input: { search: string; page: number },
  options: CallOptions = {},
): Promise<EvolveProjectPage> {
  const payload = await callEvolveAssistants(
    connection,
    email,
    { action: "references.projects", search: input.search, page: input.page },
    options,
  );
  return EvolveProjectPageSchema.parse(payload);
}

/** Every active Evolve profile, as the dialog's People tab lists them. */
export async function listEvolveReferencePeople(
  connection: EvolvePluginsConnection,
  email: string,
  options: CallOptions = {},
): Promise<EvolvePersonOption[]> {
  const payload = await callEvolveAssistants(
    connection,
    email,
    { action: "references.people" },
    options,
  );
  return z.object({ people: z.array(EvolvePersonOptionSchema) }).parse(payload).people;
}

/** Evolve's exemplar tender responses, newest first. */
export async function listEvolveReferenceExemplars(
  connection: EvolvePluginsConnection,
  email: string,
  options: CallOptions = {},
): Promise<EvolveReferenceExemplar[]> {
  const payload = await callEvolveAssistants(
    connection,
    email,
    { action: "references.exemplars" },
    options,
  );
  return z.object({ exemplars: z.array(EvolveReferenceExemplarSchema) }).parse(payload).exemplars;
}

/** The CVs of the given Evolve profiles, as their CV pages hold them. */
export async function listEvolvePeopleCvs(
  connection: EvolvePluginsConnection,
  email: string,
  ids: string[],
  options: CallOptions = {},
): Promise<EvolvePersonCv[]> {
  if (ids.length === 0) return [];
  const payload = await callEvolveAssistants(
    connection,
    email,
    { action: "references.cvs", ids },
    options,
  );
  return z.object({ cvs: z.array(EvolvePersonCvSchema) }).parse(payload).cvs;
}

/** The signed-in person's own Evolve name and CV photo (an https URL, or null). */
export async function readEvolveOwnProfile(
  connection: EvolvePluginsConnection,
  email: string,
  options: CallOptions = {},
): Promise<{ name: string | null; photo: string | null }> {
  const payload = await callEvolveAssistants(connection, email, { action: "profile.me" }, options);
  return z
    .object({
      name: z.string().nullable().default(null),
      photo: z.string().url().max(2_000).nullable().default(null),
    })
    .parse(payload);
}
