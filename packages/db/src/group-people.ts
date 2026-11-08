import type { Actor, GroupPeople, GroupPerson, SharedGroup } from "@rakazo/contracts";
import { resolveBotAvatarSet } from "@rakazo/contracts";
import type { PrismaClient } from "./client.js";
import { runAsSystem } from "./row-security.js";
import { IsolationError } from "./scope.js";

const personUser = { select: { id: true, name: true, email: true, image: true } } as const;

type PersonUser = { id: string; name: string; email: string; image: string | null };

function toPerson(user: PersonUser, owner: boolean): GroupPerson {
  return {
    userId: user.id,
    name: user.name.trim() || user.email,
    email: user.email,
    image: user.image,
    owner,
  };
}

async function assertGroupOwner(prisma: PrismaClient, actor: Actor, groupId: string) {
  if (actor.guestGroupIds) throw new IsolationError();
  const group = await prisma.chatGroup.findFirst({
    where: { id: groupId, spaceId: actor.spaceId, userId: actor.userId, archivedAt: null },
    select: { id: true, userId: true },
  });
  if (!group) throw new IsolationError();
  return group;
}

/**
 * The actor for a colleague using a Space only through the groups they were added to. Every
 * procedure outside a short allowlist refuses it, so nothing else in the Space is reachable.
 */
export async function groupGuestActor(
  prisma: PrismaClient,
  user: { id: string; email: string },
  spaceId: string,
): Promise<Actor | null> {
  const rows = await runAsSystem("resolve a colleague's shared groups", () =>
    prisma.chatGroupPerson.findMany({
      where: { userId: user.id, group: { spaceId, archivedAt: null } },
      select: { groupId: true },
    }),
  );
  if (rows.length === 0) return null;
  return {
    userId: user.id,
    spaceId,
    email: user.email,
    isDeploymentOwner: false,
    guestGroupIds: rows.map((row) => row.groupId),
  };
}

/** Whether people besides the owner read this group. */
export async function groupHasColleagues(prisma: PrismaClient, groupId: string) {
  return (await prisma.chatGroupPerson.count({ where: { groupId } })) > 0;
}

/**
 * Whether a run in a group with colleagues serves anyone but its owner. Only a run woken directly
 * by the owner's own message keeps the owner's context; a colleague's message, a bot's handoff,
 * or a scheduled run in that group all reply where colleagues read.
 */
export async function sharedGroupRunFromColleague(
  prisma: PrismaClient,
  run: { groupId: string; sourceMessageId: string | null },
): Promise<boolean> {
  if (!(await groupHasColleagues(prisma, run.groupId))) return false;
  const source = run.sourceMessageId
    ? await prisma.message.findUnique({
        where: { id: run.sourceMessageId },
        select: { role: true, authorUserId: true },
      })
    : null;
  return !(source?.role === "user" && !source.authorUserId);
}

/** The owner of a group, for acting on the owner's behalf when a colleague writes. */
export async function groupOwner(prisma: PrismaClient, groupId: string) {
  return runAsSystem("load a shared group's owner", async () => {
    const group = await prisma.chatGroup.findUnique({
      where: { id: groupId },
      select: { spaceId: true, userId: true },
    });
    if (!group) throw new IsolationError();
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: group.userId },
      ...personUser,
    });
    return { spaceId: group.spaceId, user };
  });
}

/** Everyone in a group, owner first; undefined while the owner is its only person. */
export async function groupPeopleForThread(
  prisma: PrismaClient,
  groupId: string,
): Promise<GroupPerson[] | undefined> {
  return runAsSystem("list a group's people", async () => {
    const group = await prisma.chatGroup.findUnique({
      where: { id: groupId },
      select: {
        userId: true,
        people: { orderBy: { createdAt: "asc" }, select: { user: personUser } },
      },
    });
    if (!group || group.people.length === 0) return undefined;
    const owner = await prisma.user.findUniqueOrThrow({
      where: { id: group.userId },
      ...personUser,
    });
    return [toPerson(owner, true), ...group.people.map((row) => toPerson(row.user, false))];
  });
}

export async function listGroupPeople(
  prisma: PrismaClient,
  actor: Actor,
  groupId: string,
): Promise<GroupPeople> {
  await assertGroupOwner(prisma, actor, groupId);
  const [owner, people, invites] = await runAsSystem("list a group's people", () =>
    Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, ...personUser }),
      prisma.chatGroupPerson.findMany({
        where: { groupId },
        orderBy: { createdAt: "asc" },
        select: { user: personUser },
      }),
      prisma.chatGroupInvite.findMany({
        where: { groupId },
        orderBy: { createdAt: "asc" },
        select: { email: true, createdAt: true },
      }),
    ]),
  );
  return {
    people: [toPerson(owner, true), ...people.map((row) => toPerson(row.user, false))],
    invites: invites.map((invite) => ({
      email: invite.email,
      createdAt: invite.createdAt.toISOString(),
    })),
  };
}

/** Adds a colleague by work email: at once if they have signed in before, else on first sign-in. */
export async function addGroupPerson(
  prisma: PrismaClient,
  actor: Actor,
  groupId: string,
  rawEmail: string,
): Promise<GroupPeople> {
  await assertGroupOwner(prisma, actor, groupId);
  const email = rawEmail.trim().toLowerCase();
  if (email === actor.email.toLowerCase()) return listGroupPeople(prisma, actor, groupId);
  await runAsSystem("add a person to a group", async () => {
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (user) {
      await prisma.chatGroupPerson.upsert({
        where: { groupId_userId: { groupId, userId: user.id } },
        create: { groupId, userId: user.id, addedByUserId: actor.userId },
        update: {},
      });
      await prisma.chatGroupInvite.deleteMany({ where: { groupId, email } });
    } else {
      await prisma.chatGroupInvite.upsert({
        where: { groupId_email: { groupId, email } },
        create: { groupId, email, invitedByUserId: actor.userId },
        update: {},
      });
    }
  });
  return listGroupPeople(prisma, actor, groupId);
}

export async function removeGroupPerson(
  prisma: PrismaClient,
  actor: Actor,
  groupId: string,
  person: { userId?: string; email?: string },
): Promise<GroupPeople> {
  await assertGroupOwner(prisma, actor, groupId);
  await runAsSystem("remove a person from a group", async () => {
    if (person.userId) {
      await prisma.chatGroupPerson.deleteMany({ where: { groupId, userId: person.userId } });
    }
    if (person.email) {
      await prisma.chatGroupInvite.deleteMany({
        where: { groupId, email: person.email.trim().toLowerCase() },
      });
    }
  });
  return listGroupPeople(prisma, actor, groupId);
}

/** Turns invites for this email into memberships, then lists the groups shared with the user. */
export async function listSharedGroups(
  prisma: PrismaClient,
  user: { id: string; email: string },
): Promise<SharedGroup[]> {
  return runAsSystem("list groups shared with a colleague", async () => {
    const email = user.email.trim().toLowerCase();
    const invites = await prisma.chatGroupInvite.findMany({
      where: { email },
      select: { id: true, groupId: true, invitedByUserId: true },
    });
    for (const invite of invites) {
      await prisma.chatGroupPerson.upsert({
        where: { groupId_userId: { groupId: invite.groupId, userId: user.id } },
        create: { groupId: invite.groupId, userId: user.id, addedByUserId: invite.invitedByUserId },
        update: {},
      });
      await prisma.chatGroupInvite.delete({ where: { id: invite.id } }).catch(() => undefined);
    }
    const rows = await prisma.chatGroupPerson.findMany({
      where: { userId: user.id, group: { archivedAt: null, userId: { not: user.id } } },
      select: {
        group: {
          select: {
            id: true,
            spaceId: true,
            name: true,
            updatedAt: true,
            userId: true,
            members: {
              where: { bot: { archivedAt: null } },
              orderBy: { createdAt: "asc" },
              select: { bot: { select: { id: true, name: true, color: true, avatarSet: true } } },
            },
          },
        },
      },
    });
    const owners = new Map(
      (
        await prisma.user.findMany({
          where: { id: { in: [...new Set(rows.map(({ group }) => group.userId))] } },
          select: { id: true, name: true, email: true },
        })
      ).map((owner) => [owner.id, owner.name.trim() || owner.email]),
    );
    return rows
      .map(({ group }) => ({
        id: group.id,
        spaceId: group.spaceId,
        name: group.name,
        ownerName: owners.get(group.userId) ?? "",
        members: group.members.map(({ bot }) => ({
          botId: bot.id,
          name: bot.name,
          color: bot.color,
          avatarSet: resolveBotAvatarSet(bot.avatarSet),
        })),
        updatedAt: group.updatedAt.toISOString(),
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
}
