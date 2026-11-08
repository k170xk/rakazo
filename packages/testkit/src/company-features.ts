import { setCompanyPolicy } from "@rakazo/adapters";
import type { CompanyFeatures } from "@rakazo/contracts";
import { companyFeaturesFrom } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { asSystem } from "@rakazo/db";

/** Turns company switches on for a suite, stored so the app's periodic policy refresh keeps them. */
export async function enableCompanyFeatures(
  prisma: PrismaClient,
  features: Partial<CompanyFeatures>,
): Promise<void> {
  const db = asSystem(prisma);
  const row = await db.deploymentSettings.findUnique({ where: { id: "default" } });
  const next = { ...companyFeaturesFrom(row?.companyFeatures), ...features };
  await db.deploymentSettings.upsert({
    where: { id: "default" },
    create: { id: "default", companyFeatures: next },
    update: { companyFeatures: next },
  });
  setCompanyPolicy({ features: next });
}
