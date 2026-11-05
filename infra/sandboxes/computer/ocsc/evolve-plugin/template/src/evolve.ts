/**
 * The plugin's only way to Evolve data. Inside Evolve, window.evolve is provided by the Evolve
 * page; on the builder's computer (npm run dev) the sample data in mock.ts and mock-data.json
 * answers instead, so no real data or sign-in is ever needed while building.
 *
 * Call scopes with the name written out in quotes (Evolve's checks read them from the code); every scope the code
 * calls must be listed in evolve-plugin.json, and the reviewers grant each one separately.
 */

export type ThemeMode = "light" | "dark";

export type EvolveContext = {
  user: { name: string | null };
  plugin: { slug: string; name: string; version: string };
  /** The scopes this version was granted. */
  scopes: string[];
  /** True while an author or reviewer tries an unpublished version. */
  preview: boolean;
  /** Evolve's light or dark mode right now. The page switches by itself; see onTheme. */
  theme: { mode: ThemeMode };
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

export type Skill = {
  id: string;
  skill: string;
  category: string | null;
  skill_level: string | null;
  is_software: boolean;
};

/**
 * Asking a data.<source> scope. Admins choose each source's table, columns and whether people
 * see all rows or only their own; evolve_plugin_scopes lists them. Search, filters and sorting
 * work on that source's columns only.
 */
export type DataQuery = {
  /** Two or more characters, matched against the source's searchable columns. */
  search?: string;
  /** Exact matches, e.g. { year_completed: 2024 }. null matches empty values. */
  filters?: Record<string, string | number | boolean | null>;
  orderBy?: string;
  ascending?: boolean;
  /** Up to the source's row limit; 50 by default. */
  limit?: number;
  offset?: number;
};

export type DataResult<Row = Record<string, unknown>> = {
  rows: Row[];
  columns: string[];
  hasMore: boolean;
  limit: number;
  offset: number;
};

/** What each built-in scope returns. */
export interface ScopeResults {
  "me.read": Person | null;
  "directory.read": Person[];
  "offices.read": Office[];
  "storage.personal": unknown;
  "cv.write": Skill | { removed: true };
}

type DataScope = `data.${string}`;

type Bridge = {
  ready(): Promise<EvolveContext>;
  context(): EvolveContext | null;
  onTheme(listener: (theme: { mode: ThemeMode }) => void): () => void;
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

function call<S extends keyof ScopeResults>(
  scope: S,
  params?: Record<string, unknown>,
): Promise<ScopeResults[S]>;
function call<Row = Record<string, unknown>>(
  scope: DataScope,
  params?: DataQuery,
): Promise<DataResult<Row>>;
async function call(scope: string, params?: Record<string, unknown> | DataQuery): Promise<unknown> {
  return (await connect()).call(scope, params as Record<string, unknown>);
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
  call,
  /** Called when Evolve switches between light and dark mode. Returns an unsubscribe. */
  onTheme(listener: (theme: { mode: ThemeMode }) => void): () => void {
    let off = () => {};
    let stopped = false;
    void connect().then((b) => {
      if (!stopped) off = b.onTheme(listener);
    });
    return () => {
      stopped = true;
      off();
    };
  },
};
