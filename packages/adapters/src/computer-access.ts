import type { ComputerAccess } from "@rakazo/contracts";
import { ComputerAccessSchema } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";
import { companyFeatures, companyTools } from "./company-policy.js";

/** A person's level as an admin stored it, else the company default; "none" while computers are off. */
export function effectiveComputerAccess(stored: string | null | undefined): ComputerAccess {
  if (!companyFeatures().computers) return "none";
  const parsed = ComputerAccessSchema.safeParse(stored);
  return parsed.success ? parsed.data : companyTools().defaultComputerAccess;
}

export async function computerAccessFor(
  prisma: PrismaClient,
  userId: string,
): Promise<ComputerAccess> {
  try {
    const user = await runAsSystem("read computer access", () =>
      prisma.user.findUnique({ where: { id: userId }, select: { computerAccess: true } }),
    );
    return effectiveComputerAccess(user?.computerAccess);
  } catch {
    const fallback = effectiveComputerAccess(null);
    return fallback === "full" ? "tools" : fallback;
  }
}

/**
 * A colleague talking to someone else's bot works on the owner's computer, so their turn only
 * gets the OCSC commands and files, never the owner's shell, screen or browser sessions.
 */
export function runComputerAccess(ownerAccess: ComputerAccess, colleagueTurn: boolean) {
  return colleagueTurn && ownerAccess === "full" ? "tools" : ownerAccess;
}

/**
 * Whether the tool runners may work in the owner's home on this server's disk. A computer that
 * keeps its own copy of the home (Incus, Kubernetes) replaces that home whenever it saves, which
 * would wipe what a runner wrote, so its owner's documents go to a document home instead.
 */
export function toolRunnersShareHome(ownerAccess: ComputerAccess, computerHomeOnDisk: boolean) {
  return ownerAccess !== "full" || computerHomeOnDisk;
}
