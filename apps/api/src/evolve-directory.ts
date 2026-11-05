import { createHmac, randomUUID } from "node:crypto";
import type { DirectoryPerson, GroupPeople } from "@rakazo/contracts";
import { getLogger } from "@rakazo/logging";

const DEFAULT_DIRECTORY_URL =
  "https://axywhnegcerpjqjiuhhn.supabase.co/functions/v1/evolve-computer-directory";
const TOKEN_TTL_SEC = 60;
const TIMEOUT_MS = 8000;

type EvolveProfile = {
  name?: unknown;
  email?: unknown;
  job_title?: unknown;
  department?: unknown;
  office?: unknown;
  photo?: unknown;
  can_open?: unknown;
};

/** Evolve checks the audience, so this token is useless as a sign-in token and the reverse. */
function directoryToken(secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    aud: "evolve-directory",
    iss: "rakazo",
    iat: now,
    exp: now + TOKEN_TTL_SEC,
    jti: randomUUID(),
  })}`;
  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** Active Evolve profiles matching the query, marked against who is already in the group. */
export async function searchEvolveDirectory(input: {
  secret: string | undefined;
  url: string | undefined;
  query: string;
  people: GroupPeople;
}): Promise<{ available: boolean; people: DirectoryPerson[] }> {
  if (!input.secret) return { available: false, people: [] };
  const members = new Set(input.people.people.map((person) => person.email.toLowerCase()));
  const invited = new Set(input.people.invites.map((invite) => invite.email.toLowerCase()));
  try {
    const response = await fetch(input.url || DEFAULT_DIRECTORY_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${directoryToken(input.secret)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: input.query, limit: 8 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Evolve directory answered ${response.status}`);
    const body = (await response.json()) as { profiles?: EvolveProfile[] };
    const people = (body.profiles ?? []).flatMap((profile): DirectoryPerson[] => {
      const email = text(profile.email)?.toLowerCase();
      if (!email?.includes("@")) return [];
      return [
        {
          email,
          name: text(profile.name) ?? email,
          jobTitle: text(profile.job_title) ?? text(profile.department),
          office: text(profile.office),
          photo: text(profile.photo)?.startsWith("https://") ? text(profile.photo) : null,
          canOpen: profile.can_open === true,
          status: members.has(email) ? "member" : invited.has(email) ? "invited" : null,
        },
      ];
    });
    return { available: true, people };
  } catch (error) {
    getLogger().warn("evolve.directory.search_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { available: false, people: [] };
  }
}
