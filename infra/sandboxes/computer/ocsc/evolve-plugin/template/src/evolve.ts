/**
 * The plugin's only way to Evolve data. Inside Evolve, window.evolve is provided by the Evolve
 * page; on the builder's computer (npm run dev) the sample data in mock.ts answers instead, so
 * no real data or sign-in is ever needed while building.
 *
 * Call scopes with the name written out in quotes (Evolve's checks read them from the code); every scope the code
 * calls must be listed in evolve-plugin.json, and the reviewers grant each one separately.
 */

export type EvolveContext = {
  user: { name: string | null };
  plugin: { slug: string; name: string; version: string };
  /** The scopes this version was granted. */
  scopes: string[];
  /** True while an author or reviewer tries an unpublished version. */
  preview: boolean;
};

export type Person = {
  id: number;
  full_name: string | null;
  email: string | null;
  job_title: string | null;
  department: string | null;
  office_id: string | null;
};

export type Office = { id: string; name: string; country: string | null };

export type Project = {
  id: string;
  name: string;
  job_number: string | null;
  client: string | null;
  project_summary: string | null;
  year_completed: number | null;
};

export type Skill = {
  id: string;
  skill: string;
  category: string | null;
  skill_level: string | null;
  is_software: boolean;
};

/** What each scope returns. */
export interface ScopeResults {
  "me.read": Person | null;
  "directory.read": Person[];
  "offices.read": Office[];
  "projects.read": Project[];
  "cv.read": {
    skills: Skill[];
    qualifications: Record<string, unknown>[];
    bios: Record<string, unknown>[];
  };
  "storage.personal": unknown;
  "cv.write": Skill | { removed: true };
}

type Bridge = {
  ready(): Promise<EvolveContext>;
  context(): EvolveContext | null;
  call(scope: string, params?: Record<string, unknown>): Promise<unknown>;
};

declare global {
  interface Window {
    evolve?: Bridge;
  }
}

let bridge: Promise<Bridge> | null = null;

function connect(): Promise<Bridge> {
  bridge ??= (async () => {
    if (window.evolve) return window.evolve;
    if (import.meta.env.DEV) return (await import("./mock")).createMockBridge();
    throw new Error("Open this plugin from Evolve.");
  })();
  return bridge;
}

export const evolve = {
  /** Who is using the plugin and what it may do. Resolves once Evolve has started it. */
  async ready(): Promise<EvolveContext> {
    return (await connect()).ready();
  },
  /**
   * Runs one scope. Writes the reviewers marked "ask first" show the person a confirmation; if
   * they decline, this rejects with "You declined this change."
   */
  async call<S extends keyof ScopeResults>(
    scope: S,
    params?: Record<string, unknown>,
  ): Promise<ScopeResults[S]> {
    return (await (await connect()).call(scope, params)) as ScopeResults[S];
  },
};
