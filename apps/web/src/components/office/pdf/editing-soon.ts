import type { Me } from "@rakazo/contracts";

/**
 * PDF viewing works for everyone. Markup and design run on the person's computer, which only
 * Full access has, so everyone else is told editing is coming soon.
 */
export function pdfEditingSoon(me: Pick<Me, "computerAccess" | "features"> | null | undefined): boolean {
  if (!me) return false;
  return me.computerAccess !== "full" || me.features.computers === false;
}
