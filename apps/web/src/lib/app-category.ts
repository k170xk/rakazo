/** Staff-facing kind of an OCSC app, read from its title until a category is stored on the app. */
export type AppCategoryId =
  | "clients"
  | "people"
  | "workshop"
  | "register"
  | "field"
  | "delivery"
  | "custom";

/**
 * More specific work comes first, so "Fee tracker" stays with clients and
 * "Site investigation tracker" stays with field work.
 */
const RULES: { id: Exclude<AppCategoryId, "custom">; pattern: RegExp }[] = [
  {
    id: "clients",
    pattern: /\b(clients?|fees?|pipelines?|crm|invoices?|quotations?|quotes?)\b/i,
  },
  {
    id: "people",
    pattern: /\b(timesheets?|rotas?|rosters?|leave|holidays?|onboarding|resourcing|resource planning)\b/i,
  },
  {
    id: "workshop",
    pattern: /\b(workshops?|strateg(?:y|ies)|whiteboards?|organograms?|option studies|options study)\b/i,
  },
  {
    id: "register",
    pattern: /\b(registers?|attributes?|bim|documents?|assets?|compliance)\b/i,
  },
  {
    id: "field",
    pattern:
      /\b(geotech\w*|investigations?|inspections?|snag(?:ging|s)?|audits?|diaries|diary|boreholes?|laboratory|lab|sites?)\b/i,
  },
  {
    id: "delivery",
    pattern: /\b(trackers?|programmes?|programs?|tenders?|portfolios?|gantt)\b/i,
  },
];

const ORDER: AppCategoryId[] = [
  "clients",
  "people",
  "workshop",
  "register",
  "field",
  "delivery",
  "custom",
];

export function categoryForAppTitle(title: string): AppCategoryId {
  return RULES.find((rule) => rule.pattern.test(title))?.id ?? "custom";
}

/** Groups apps under their category, keeping the order they were already listed in. */
export function groupByAppCategory<T>(
  items: readonly T[],
  titleOf: (item: T) => string,
): { id: AppCategoryId; items: T[] }[] {
  const buckets = new Map<AppCategoryId, T[]>();
  for (const item of items) {
    const id = categoryForAppTitle(titleOf(item));
    const list = buckets.get(id);
    if (list) list.push(item);
    else buckets.set(id, [item]);
  }
  return ORDER.filter((id) => buckets.has(id)).map((id) => ({ id, items: buckets.get(id) ?? [] }));
}
