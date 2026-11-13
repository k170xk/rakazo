import type { Actor, SharedAppAdmin } from "@rakazo/contracts";
import { IsolationError, recordAuditEvent, runAsSystem } from "@rakazo/db";
import { requireAdmin } from "./admins.js";
import { shownVisibility } from "./pages.js";
import type { RouterDeps } from "./router.js";

type Deps = Pick<RouterDeps, "prisma" | "env">;

const select = {
  id: true,
  title: true,
  kind: true,
  visibility: true,
  evolvePluginSlug: true,
  frozenAt: true,
  updatedAt: true,
  user: { select: { name: true, email: true } },
} as const;

type Row = {
  id: string;
  title: string;
  kind: string;
  visibility: string;
  evolvePluginSlug: string | null;
  frozenAt: Date | null;
  updatedAt: Date;
  user: { name: string | null; email: string };
};

const shown = (row: Row): SharedAppAdmin => ({
  id: row.id,
  title: row.title,
  kind: row.kind === "app" ? "app" : "page",
  owner: row.user.name?.trim() || row.user.email,
  visibility: shownVisibility(row.visibility),
  evolvePluginSlug: row.evolvePluginSlug,
  frozenAt: row.frozenAt?.toISOString() ?? null,
  updatedAt: row.updatedAt.toISOString(),
});

/** Pages and apps someone other than their owner can open, and any an admin froze. */
export async function listSharedApps(deps: Deps, actor: Actor): Promise<SharedAppAdmin[]> {
  await requireAdmin(deps, actor.userId);
  const rows = await runAsSystem("company admin lists shared apps", () =>
    deps.prisma.page.findMany({
      where: {
        OR: [
          { visibility: { in: ["link", "public"] } },
          { evolvePluginSlug: { not: null } },
          { frozenAt: { not: null } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 500,
      select,
    }),
  );
  return rows.map(shown);
}

/** Freezes or unfreezes one page or app; the owner keeps their copy either way. */
export async function setSharedAppFrozen(
  deps: Deps,
  actor: Actor,
  input: { pageId: string; frozen: boolean },
): Promise<SharedAppAdmin> {
  await requireAdmin(deps, actor.userId);
  const row = await runAsSystem("company admin freezes an app", async () => {
    const found = await deps.prisma.page.findUnique({
      where: { id: input.pageId },
      select: { id: true },
    });
    if (!found) throw new IsolationError();
    return deps.prisma.page.update({
      where: { id: input.pageId },
      data: input.frozen
        ? { frozenAt: new Date(), frozenBy: actor.userId }
        : { frozenAt: null, frozenBy: null },
      select,
    });
  });
  await recordAuditEvent({
    action: input.frozen ? "page.frozen" : "page.unfrozen",
    actor: { type: "user", id: actor.userId },
    spaceId: actor.spaceId,
    target: { type: row.kind === "app" ? "app" : "page", id: row.id, label: row.title },
  });
  return shown(row);
}
