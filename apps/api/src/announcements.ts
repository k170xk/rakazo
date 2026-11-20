import { ORPCError } from "@orpc/server";
import type { AdminAnnouncement, Announcement, AnnouncementInput } from "@rakazo/contracts";
import { ANNOUNCEMENT_SHOWN_DAYS } from "@rakazo/contracts";
import { runAsSystem } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { requireAdmin } from "./admins.js";
import type { RouterDeps } from "./router.js";

type AnnouncementDeps = Pick<RouterDeps, "prisma" | "events"> & {
  env: Pick<RouterDeps["env"], "adminEmails">;
};

const DAY_MS = 86_400_000;
const LIST_LIMIT = 50;

type Row = {
  id: string;
  title: string;
  body: string;
  image: string | null;
  offerReload: boolean;
  authorName: string | null;
  createdAt: Date;
};

const columns = {
  id: true,
  title: true,
  body: true,
  image: true,
  offerReload: true,
  authorName: true,
  createdAt: true,
} as const;

function toAnnouncement(row: Row): Announcement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    image: row.image,
    offerReload: row.offerReload,
    authorName: row.authorName,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listAnnouncements(deps: AnnouncementDeps, actorUserId: string): Promise<AdminAnnouncement[]> {
  await requireAdmin(deps, actorUserId);
  const rows = await runAsSystem("list company announcements", () =>
    deps.prisma.companyAnnouncement.findMany({
      orderBy: { createdAt: "desc" },
      take: LIST_LIMIT,
      select: { ...columns, withdrawnAt: true, _count: { select: { dismissals: true } } },
    }),
  );
  return rows.map((row) => ({
    ...toAnnouncement(row),
    dismissedCount: row._count.dismissals,
    withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
  }));
}

/** Saves the announcement, then tells every open app; a failed signal still leaves it saved. */
export async function sendAnnouncement(
  deps: AnnouncementDeps,
  actorUserId: string,
  input: AnnouncementInput,
): Promise<AdminAnnouncement> {
  await requireAdmin(deps, actorUserId);
  const author = await deps.prisma.user.findUnique({ where: { id: actorUserId }, select: { name: true } });
  const row = await runAsSystem("send a company announcement", () =>
    deps.prisma.companyAnnouncement.create({
      data: {
        title: input.title,
        body: input.body,
        image: input.image,
        offerReload: input.offerReload,
        authorId: actorUserId,
        authorName: author?.name?.trim() || null,
      },
      select: columns,
    }),
  );
  await deps.events.publishAnnouncement?.(row.id).catch((error: unknown) => {
    getLogger().warn("announcements.publish_failed", { error: String(error) });
  });
  return { ...toAnnouncement(row), dismissedCount: 0, withdrawnAt: null };
}

export async function withdrawAnnouncement(deps: AnnouncementDeps, actorUserId: string, id: string) {
  await requireAdmin(deps, actorUserId);
  const { count } = await runAsSystem("withdraw a company announcement", () =>
    deps.prisma.companyAnnouncement.updateMany({
      where: { id, withdrawnAt: null },
      data: { withdrawnAt: new Date() },
    }),
  );
  if (count === 0) throw new ORPCError("NOT_FOUND", { message: "That announcement was not found." });
  // Open apps reload their list, so a withdrawn dialog closes for people still looking at it.
  await deps.events.publishAnnouncement?.(id).catch(() => undefined);
  return { ok: true as const };
}

/** Recent announcements this person has not dismissed, oldest first so they read in order. */
export async function pendingAnnouncements(
  deps: Pick<RouterDeps, "prisma">,
  userId: string,
  now = new Date(),
): Promise<Announcement[]> {
  const rows = await runAsSystem("read pending announcements", () =>
    deps.prisma.companyAnnouncement.findMany({
      where: {
        withdrawnAt: null,
        createdAt: { gte: new Date(now.getTime() - ANNOUNCEMENT_SHOWN_DAYS * DAY_MS) },
        dismissals: { none: { userId } },
      },
      orderBy: { createdAt: "asc" },
      select: columns,
    }),
  );
  return rows.map(toAnnouncement);
}

export async function dismissAnnouncement(deps: Pick<RouterDeps, "prisma">, userId: string, id: string) {
  await runAsSystem("dismiss an announcement", async () => {
    const exists = await deps.prisma.companyAnnouncement.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new ORPCError("NOT_FOUND", { message: "That announcement was not found." });
    await deps.prisma.announcementDismissal.upsert({
      where: { announcementId_userId: { announcementId: id, userId } },
      create: { announcementId: id, userId },
      update: {},
    });
  });
  return { ok: true as const };
}
