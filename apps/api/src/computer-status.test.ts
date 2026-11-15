import { ComputerStatusSchema } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import {
  executionBlocksUserTakeover,
  resolveBusyBotName,
  toComputerStatus,
} from "./computer-status.js";

describe("toComputerStatus", () => {
  it("shows a quarantined computer as an error without making its screen available", () => {
    expect(
      toComputerStatus("bot", {
        kind: "novita",
        state: "quarantined",
        scope: "team",
        controlHolder: "none",
        homeRevision: "saved",
      }),
    ).toMatchObject({ state: "error", screenAvailable: false });
  });
  it("warns at 90% full until the user hides it, and again once the disk fills further", () => {
    const computer = {
      kind: "docker",
      state: "running",
      scope: "team",
      controlHolder: "none",
      homeRevision: "saved",
      diskUsedBytes: 91n,
      diskFreeBytes: 9n,
    };
    const status = (changes: object) => toComputerStatus("bot", { ...computer, ...changes });
    expect(status({}).diskFullPercent).toBe(91);
    expect(ComputerStatusSchema.parse(status({})).diskFullPercent).toBe(91);
    expect(status({ diskUsedBytes: 89n, diskFreeBytes: 11n }).diskFullPercent).toBeUndefined();
    expect(status({ diskDismissedPercent: 91 }).diskFullPercent).toBeUndefined();
    expect(status({ diskDismissedPercent: 90 }).diskFullPercent).toBe(91);
    expect(status({ diskUsedBytes: null }).diskFullPercent).toBeUndefined();
  });
  it("only marks control that is bound to a waiting run as a requested takeover", () => {
    const computer = {
      kind: "fake",
      state: "running",
      scope: "team",
      controlHolder: "user",
      controlBotId: "bot-1",
      controlRunId: "run-1",
      homeRevision: "revision-1",
    };

    expect(toComputerStatus("bot-1", computer).takeoverRequested).toBe(true);
    expect(toComputerStatus("bot-1", { ...computer, controlRunId: null }).takeoverRequested).toBe(
      false,
    );
  });

  it("passes through the busy agent name when takeover is blocked", () => {
    const computer = {
      kind: "fake",
      state: "running",
      scope: "team",
      controlHolder: "none",
      homeRevision: "revision-1",
    };
    expect(toComputerStatus("bot-1", computer).busyBotName).toBeNull();
    expect(toComputerStatus("bot-1", computer, "Writer").busyBotName).toBe("Writer");
  });

  it("sandbox-none-computer-status", () => {
    const stopped = toComputerStatus("bot-1", {
      kind: "none",
      state: "stopped",
      scope: "team",
      controlHolder: "none",
      homeRevision: "empty",
    });
    expect(ComputerStatusSchema.parse(stopped)).toMatchObject({
      kind: "none",
      state: "stopped",
      canUpdate: false,
      terminalAvailable: false,
      screenAvailable: false,
    });

    const running = toComputerStatus("bot-1", {
      kind: "none",
      state: "running",
      scope: "team",
      controlHolder: "none",
      homeRevision: "empty",
    });
    expect(ComputerStatusSchema.parse(running)).toMatchObject({
      state: "stopped",
      canUpdate: false,
      terminalAvailable: false,
      screenAvailable: false,
    });
  });

  it("hides update on desktop computers", () => {
    expect(
      toComputerStatus("bot-1", {
        kind: "desktop",
        state: "running",
        scope: "team",
        controlHolder: "none",
        homeRevision: "r1",
      }).canUpdate,
    ).toBe(false);
    expect(
      toComputerStatus("bot-1", {
        kind: "e2b",
        state: "running",
        scope: "team",
        controlHolder: "none",
        homeRevision: "r1",
      }).canUpdate,
    ).toBe(true);
  });
});

describe("executionBlocksUserTakeover", () => {
  const now = Date.parse("2026-08-25T12:00:00.000Z");

  it("allows takeover when there is no execution lease", () => {
    expect(
      executionBlocksUserTakeover({
        hasLease: false,
        leaseExpiresAt: new Date(now + 60_000),
        runStatus: "running",
        now,
      }),
    ).toBe(false);
  });

  it("allows takeover while the run is waiting for the user", () => {
    expect(
      executionBlocksUserTakeover({
        hasLease: true,
        leaseExpiresAt: new Date(now + 60_000),
        runStatus: "waiting_takeover",
        now,
      }),
    ).toBe(false);
  });

  it("allows takeover while the waiting run continues for a chat message", () => {
    expect(
      executionBlocksUserTakeover({
        hasLease: true,
        leaseExpiresAt: new Date(now + 60_000),
        runStatus: "running",
        now,
        takeoverRequested: true,
      }),
    ).toBe(false);
  });

  it("blocks takeover for an active lease or active run", () => {
    expect(
      executionBlocksUserTakeover({
        hasLease: true,
        leaseExpiresAt: new Date(now + 60_000),
        runStatus: "running",
        now,
      }),
    ).toBe(true);
    expect(
      executionBlocksUserTakeover({
        hasLease: true,
        leaseExpiresAt: new Date(now - 1),
        runStatus: "running",
        now,
      }),
    ).toBe(true);
    expect(
      executionBlocksUserTakeover({
        hasLease: true,
        leaseExpiresAt: new Date(now + 60_000),
        runStatus: "completed",
        now,
      }),
    ).toBe(true);
  });

  it("allows takeover when both the lease and run are inactive", () => {
    expect(
      executionBlocksUserTakeover({
        hasLease: true,
        leaseExpiresAt: new Date(now - 1),
        runStatus: "completed",
        now,
      }),
    ).toBe(false);
  });
});

describe("resolveBusyBotName", () => {
  const later = new Date(Date.now() + 60_000);
  const earlier = new Date(Date.now() - 60_000);
  const prismaWith = (
    leases: { botId: string; runId: string }[],
    running: string[],
    finished: string[] = [],
  ) =>
    ({
      computerExecutionLease: {
        findMany: vi.fn(async () =>
          leases.map((lease) => ({
            ...lease,
            expiresAt: finished.includes(lease.runId) ? earlier : later,
            computer: { controlRunId: null },
          })),
        ),
      },
      run: {
        findMany: vi.fn(async () => [
          ...running.map((id) => ({ id, status: "running" })),
          ...finished.map((id) => ({ id, status: "succeeded" })),
        ]),
      },
      bot: { findUnique: vi.fn(async () => ({ name: "Researcher" })) },
    }) as unknown as PrismaClient;
  const input = { computerId: "computer-1", botId: "bot-1", botName: "Writer" };

  it("names another agent at work on a shared computer", async () => {
    const prisma = prismaWith([{ botId: "bot-2", runId: "run-2" }], ["run-2"]);
    await expect(resolveBusyBotName(prisma, input)).resolves.toBe("Researcher");
  });
  it("names this agent first when it is working too", async () => {
    const prisma = prismaWith(
      [
        { botId: "bot-2", runId: "run-2" },
        { botId: "bot-1", runId: "run-1" },
      ],
      ["run-1", "run-2"],
    );
    await expect(resolveBusyBotName(prisma, input)).resolves.toBe("Writer");
  });
  it("names nobody once the runs have finished", async () => {
    const prisma = prismaWith([{ botId: "bot-2", runId: "run-2" }], [], ["run-2"]);
    await expect(resolveBusyBotName(prisma, input)).resolves.toBeNull();
  });
});
