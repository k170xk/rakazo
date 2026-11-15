import { describe, expect, it, vi } from "vitest";
import { infrastructure } from "./infrastructure-admin.js";
import type { RouterDeps } from "./router.js";

const server = {
  up: true,
  cpuPercent: 12,
  load1: 1,
  cpus: 8,
  memUsedBytes: 1,
  memTotalBytes: 2,
  diskUsedBytes: 3,
  diskTotalBytes: 4,
};
const sample = {
  app: server,
  routines: { ...server, up: false },
  incus: {
    up: true,
    cpus: 16,
    memUsedBytes: 5,
    memTotalBytes: 6,
    diskUsedBytes: 7,
    diskTotalBytes: 8,
    running: 3,
    stopped: 1,
  },
  runners: { app: null, routines: null },
  fleet: { computersRunning: 3, chatRuns: 2, routineRuns: 1, queuedRuns: 0 },
};

function deps(admin: boolean, data: unknown = sample) {
  const prisma = {
    user: {
      findUnique: vi.fn(async () => ({
        email: admin ? "boss@ocsc.co.uk" : "someone@ocsc.co.uk",
        emailVerified: true,
      })),
    },
    infraSample: {
      findFirst: vi.fn(async () => ({ sampledAt: new Date("2026-11-15T12:00:00Z"), data })),
    },
    $queryRaw: vi.fn(async () => [
      { at: new Date("2026-11-15T11:55:00Z"), appCpu: 40, chatRuns: 2, incusRunning: null },
    ]),
  };
  const value = {
    prisma,
    env: { adminEmails: ["boss@ocsc.co.uk"] },
  } as unknown as Pick<RouterDeps, "prisma" | "env">;
  return { value, prisma };
}

describe("infrastructure dashboard", () => {
  it("is for admins only", async () => {
    const { value, prisma } = deps(false);
    await expect(infrastructure(value, "someone", "24h")).rejects.toThrow(/Admins only/);
    expect(prisma.infraSample.findFirst).not.toHaveBeenCalled();
  });

  it("returns the newest reading and every series for each bucket", async () => {
    const { value } = deps(true);
    const result = await infrastructure(value, "admin-1", "24h");
    expect(result.latest).toEqual({ sampledAt: "2026-11-15T12:00:00.000Z", sample });
    expect(result.bucketMinutes).toBe(5);
    expect(result.points).toHaveLength(1);
    expect(result.points[0]?.at).toBe("2026-11-15T11:55:00.000Z");
    expect(result.points[0]?.values).toMatchObject({ appCpu: 40, chatRuns: 2, incusRunning: null });
    expect(Object.keys(result.points[0]?.values ?? {})).toHaveLength(17);
  });

  it("shows no latest reading when a stored one does not match the current shape", async () => {
    const { value } = deps(true, { app: "old" });
    expect((await infrastructure(value, "admin-1", "7d")).latest).toBeNull();
  });
});
