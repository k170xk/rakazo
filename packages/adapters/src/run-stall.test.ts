import { describe, expect, it, vi } from "vitest";
import {
  DESKTOP_BUSY_TOO_LONG,
  failStalledRuns,
  isComputerWaitAnnouncement,
  isStalledRun,
  RUN_STALL_MS,
  RUN_STALLED_TOO_LONG,
  shouldGiveUpComputerWait,
  WAITING_FOR_SHARED_DESKTOP,
} from "./run-stall.js";

describe("computer wait and stall guards", () => {
  it("gives up after the busy-retry fence, not on the first wait", () => {
    expect(shouldGiveUpComputerWait(1)).toBe(false);
    expect(shouldGiveUpComputerWait(11)).toBe(false);
    expect(shouldGiveUpComputerWait(12)).toBe(true);
  });

  it("treats a run as stalled only after several minutes without activity", () => {
    const now = new Date("2026-08-31T19:31:00.000Z");
    expect(isStalledRun(new Date("2026-08-31T19:26:33.000Z"), now)).toBe(false);
    expect(isStalledRun(new Date("2026-08-31T19:22:00.000Z"), now)).toBe(true);
    expect(isStalledRun(undefined, now)).toBe(false);
    expect(isStalledRun(now, now, RUN_STALL_MS)).toBe(false);
  });

  it("recognizes the shared-desktop wait banner so it is announced once", () => {
    expect(isComputerWaitAnnouncement({ text: WAITING_FOR_SHARED_DESKTOP })).toBe(true);
    expect(isComputerWaitAnnouncement({ text: "Working" })).toBe(false);
    expect(isComputerWaitAnnouncement(null)).toBe(false);
  });

  it("fails a silent running turn and drops its desktop lease", async () => {
    const now = new Date("2026-08-31T19:35:00.000Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const attemptUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const append = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      run: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "run-stuck",
            startedAt: new Date("2026-08-31T19:17:00.000Z"),
            workspaceId: "ws-1",
            threadId: "thread-1",
            botId: "bot-1",
          },
        ]),
        updateMany,
      },
      event: {
        findFirst: vi.fn().mockResolvedValue({ createdAt: new Date("2026-08-31T19:26:33.000Z") }),
      },
      computerExecutionLease: { deleteMany },
      attempt: { updateMany: attemptUpdate },
    };
    const failed = await failStalledRuns(
      prisma as never,
      { append } as never,
      now,
    );
    expect(failed).toEqual(["run-stuck"]);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "run-stuck", status: { in: ["running", "leased"] } },
      data: expect.objectContaining({
        status: "failed",
        error: RUN_STALLED_TOO_LONG,
      }),
    });
    expect(deleteMany).toHaveBeenCalledWith({ where: { runId: "run-stuck" } });
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "run.failed",
        runId: "run-stuck",
        payload: { error: RUN_STALLED_TOO_LONG },
      }),
    );
    expect(DESKTOP_BUSY_TOO_LONG).toContain("Send the message again");
  });

  it("does not fail a run that is still streaming", async () => {
    const now = new Date("2026-08-31T19:28:00.000Z");
    const updateMany = vi.fn();
    const prisma = {
      run: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "run-live",
            startedAt: new Date("2026-08-31T19:17:00.000Z"),
            workspaceId: "ws-1",
            threadId: "thread-1",
            botId: "bot-1",
          },
        ]),
        updateMany,
      },
      event: {
        findFirst: vi.fn().mockResolvedValue({ createdAt: new Date("2026-08-31T19:26:33.000Z") }),
      },
      computerExecutionLease: { deleteMany: vi.fn() },
      attempt: { updateMany: vi.fn() },
    };
    await expect(failStalledRuns(prisma as never, undefined, now)).resolves.toEqual([]);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
