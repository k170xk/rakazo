import type { PrismaClient } from "@rakazo/db";
import { recordSecurityEvent, runAsSystem } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";

const HOUR_MS = 60 * 60 * 1000;
/** Evolve only knows OCSC staff; anyone else is never looked up or offboarded. */
export const EVOLVE_STAFF_DOMAINS = ["ocsc.co.uk", "ocsc.ie"];
const PASS_GAP_MS = 12 * HOUR_MS;
/** A person must be missing from Evolve twice, this far apart, before anything is removed. */
const CONFIRM_AFTER_MS = 20 * HOUR_MS;
const MAX_LEAVERS_PER_PASS = 2;
const MAX_LEAVER_SHARE = 0.2;

type LeaverDb = Pick<
  PrismaClient,
  "user" | "session" | "connection" | "secret" | "routine" | "$transaction"
>;

export type LeaverSweepDeps = {
  prisma: LeaverDb;
  isActive: (email: string) => Promise<boolean>;
  now?: () => number;
};

function staffEmail(email: string | null | undefined) {
  const value = email?.trim().toLowerCase();
  const domain = value?.split("@")[1];
  return value && domain && EVOLVE_STAFF_DOMAINS.includes(domain) ? value : null;
}

/** Signs out people who have left OCSC, removes their Microsoft tokens and pauses their routines. */
export async function offboardLeaver(prisma: LeaverDb, userId: string) {
  return runAsSystem("evolve leaver offboarding", async () => {
    const connections = await prisma.connection.findMany({
      where: { userId, connectorId: "microsoft", status: { not: "revoked" } },
      select: { id: true, secretId: true },
    });
    const secretIds = connections.flatMap((row) => (row.secretId ? [row.secretId] : []));
    return prisma.$transaction(async (tx) => {
      const sessions = await tx.session.deleteMany({ where: { userId } });
      await tx.connection.updateMany({
        where: { id: { in: connections.map((row) => row.id) } },
        data: { status: "revoked", secretId: null },
      });
      if (secretIds.length > 0) {
        await tx.secret.deleteMany({ where: { id: { in: secretIds }, userId } });
      }
      const routines = await tx.routine.updateMany({
        where: { userId, active: true },
        data: { active: false },
      });
      return {
        sessions: sessions.count,
        connections: connections.length,
        routines: routines.count,
      };
    });
  });
}

/**
 * Compares Rakazo accounts with Evolve's active staff. Nothing happens unless every lookup
 * answered, and a pass that would remove more than a few people stops instead, so an Evolve
 * outage or a directory change cannot sign everyone out.
 */
export function evolveLeaverSweep(deps: LeaverSweepDeps) {
  const now = deps.now ?? Date.now;
  const firstMissed = new Map<string, number>();
  let lastPass = Number.NEGATIVE_INFINITY;

  return async (signal: AbortSignal) => {
    if (now() - lastPass < PASS_GAP_MS) return;
    const users = await runAsSystem("evolve leaver check", () =>
      deps.prisma.user.findMany({ select: { id: true, email: true } }),
    );
    const staff = users.flatMap((user) => {
      const email = staffEmail(user.email);
      return email ? [{ id: user.id, email }] : [];
    });
    const missing: string[] = [];
    for (const person of staff) {
      if (signal.aborted) return;
      if (!(await deps.isActive(person.email))) missing.push(person.id);
    }
    lastPass = now();

    const stillMissing = new Set(missing);
    for (const id of firstMissed.keys()) if (!stillMissing.has(id)) firstMissed.delete(id);
    const confirmed: string[] = [];
    for (const id of missing) {
      const since = firstMissed.get(id);
      if (since === undefined) firstMissed.set(id, lastPass);
      else if (lastPass - since >= CONFIRM_AFTER_MS) confirmed.push(id);
    }
    if (confirmed.length === 0) return;
    if (
      confirmed.length > MAX_LEAVERS_PER_PASS ||
      confirmed.length > Math.max(1, staff.length * MAX_LEAVER_SHARE)
    ) {
      getLogger().error("evolve.leavers.too_many", {
        confirmed: confirmed.length,
        checked: staff.length,
      });
      return;
    }
    for (const userId of confirmed) {
      const removed = await offboardLeaver(deps.prisma, userId);
      if (removed.sessions + removed.connections + removed.routines === 0) continue;
      getLogger().info("evolve.leavers.offboarded", { userId, ...removed });
      await recordSecurityEvent({
        type: "auth.session.revoked",
        userId,
        metadata: { reason: "evolve_leaver", ...removed },
      });
    }
  };
}
