import type { EvolvePluginsConnection } from "./evolve-plugins.js";
import { callEvolvePlugins } from "./evolve-plugins.js";

/**
 * Before a new app is built, the Evolve library and the apps in review are searched for one that
 * already does the same job, so the person can ask its creator to share it instead of building a
 * duplicate. Other people's private drafts are never searched.
 */

export type CatalogueApp = {
  slug: string;
  name: string;
  description: string | null;
  brief: string | null;
  state: "library" | "in_review";
  mine: boolean;
  url: string | null;
  creator: {
    name: string | null;
    email: string | null;
    role: string | null;
    discipline: string | null;
    office: string | null;
  } | null;
};

export type SimilarApp = CatalogueApp & { score: number };

const STOP = new Set(
  (
    "a an and app apps application applications are as at be build built by can each every for from " +
    "has have help helps how in into is it its let lets of on one or our see so staff that the their " +
    "them this to tool tools track up use used uses using we what when where which who will with " +
    "you your ocsc evolve page pages screen screens view simple small quick new"
  ).split(" "),
);

/** The meaningful words of a text, lightly stemmed so "inspections" matches "inspection". */
export function words(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of (text ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    const stem = raw
      .replace(/ies$/, "y")
      .replace(/(ings?|ers?|ed)$/, "")
      .replace(/(?<=[^s])s$/, "");
    if (stem.length >= 3 && !STOP.has(stem)) out.add(stem);
  }
  return out;
}

const overlap = (a: Set<string>, b: Set<string>) => {
  let n = 0;
  for (const word of a) if (b.has(word)) n++;
  return n;
};

/**
 * How alike a planned app is to a catalogue app, from 0 to 1: the share of the planned title's
 * words in the other app's name, blended with how much the two descriptions share.
 */
export function similarity(
  planned: { title: string; brief?: string | null },
  other: Pick<CatalogueApp, "name" | "description" | "brief">,
): number {
  const title = words(planned.title);
  const name = words(other.name);
  const mine = words(`${planned.title} ${planned.brief ?? ""}`);
  const theirs = words(`${other.name} ${other.description ?? ""} ${other.brief ?? ""}`);
  if (!mine.size || !theirs.size) return 0;
  const titleShare = title.size ? overlap(title, name) / title.size : 0;
  const shared = overlap(mine, theirs);
  const dice = (2 * shared) / (mine.size + theirs.size);
  const cover = shared / Math.min(mine.size, theirs.size);
  return Math.min(1, 0.5 * titleShare + 0.3 * cover + 0.2 * dice);
}

export const SIMILAR_AT = 0.4;

export function rankSimilar(
  planned: { title: string; brief?: string | null },
  apps: CatalogueApp[],
  limit = 3,
): SimilarApp[] {
  return apps
    .filter((app) => !app.mine)
    .map((app) => ({ ...app, score: similarity(planned, app) }))
    .filter((app) => app.score >= SIMILAR_AT)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Similar apps by other people, or an empty list when Evolve cannot be asked. */
export async function findSimilarApps(
  connection: EvolvePluginsConnection,
  email: string,
  planned: { title: string; brief?: string | null },
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<SimilarApp[]> {
  try {
    const signal = AbortSignal.any([
      AbortSignal.timeout(10_000),
      ...(options.signal ? [options.signal] : []),
    ]);
    const result = await callEvolvePlugins<{ apps?: CatalogueApp[] }>(
      connection,
      email,
      { action: "catalogue" },
      { signal, ...(options.fetch ? { fetch: options.fetch } : {}) },
    );
    return rankSimilar(planned, Array.isArray(result.apps) ? result.apps : []);
  } catch {
    return [];
  }
}

/** What the bot tells the person about each similar app, naming its creator. */
export function similarAppNote(app: SimilarApp): string {
  const who = app.creator?.name ?? "a colleague";
  const about = [app.creator?.role, app.creator?.office].filter(Boolean).join(", ");
  const where =
    app.state === "library"
      ? `it is in the Evolve library${app.url ? ` (${app.url})` : ""}`
      : "it is being reviewed for the Evolve library";
  const contact = app.creator?.name ? app.creator.name.split(" ")[0] : "its creator";
  return `${who}${about ? ` (${about})` : ""} built "${app.name}", which looks like the same use case; ${where}. Check in with ${contact} to share it with you.`;
}
