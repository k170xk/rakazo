import type { PlanDocument } from "./plan";

export type PlanCategory = { label: string; color: string };

/** Colours offered for a new category, starting with OCSC green. */
export const CATEGORY_COLOURS = [
  "#76BF43",
  "#3B82F6",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#14B8A6",
  "#EC4899",
  "#64748B",
] as const;

/** A key for a new category from its label, unique among `taken`. */
export function categoryKey(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "category";
  let key = base;
  for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
  return key;
}

/** The first offered colour no existing category uses, or the first colour when all are taken. */
export function nextCategoryColour(existing: Iterable<PlanCategory>): string {
  const used = new Set([...existing].map((category) => category.color.toLowerCase()));
  return CATEGORY_COLOURS.find((colour) => !used.has(colour.toLowerCase())) ?? CATEGORY_COLOURS[0];
}

/**
 * The plan with categories made in the task drawer that a task now uses. One made and then
 * abandoned (drawer cancelled) is left out; ones already in the plan are left alone.
 */
export function withCategories(plan: PlanDocument, added: ReadonlyMap<string, PlanCategory>): PlanDocument {
  const current = plan.categories ?? {};
  const used = new Set((plan.tasks ?? []).map((task) => task.category));
  const missing = [...added].filter(([key]) => !(key in current) && used.has(key));
  if (!missing.length) return plan;
  return { ...plan, categories: { ...current, ...Object.fromEntries(missing) } };
}
