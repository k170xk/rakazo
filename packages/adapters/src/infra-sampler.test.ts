import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { serverFromStatus, takeInfraSample } from "./infra-sampler.js";

const GB = 1024 ** 3;

function prisma() {
  return {
    computer: { count: vi.fn(async () => 5) },
    run: {
      groupBy: vi.fn(async () => [
        { trigger: "message", _count: 3 },
        { trigger: "routine", _count: 2 },
        { trigger: "webhook", _count: 1 },
      ]),
      count: vi.fn(async () => 4),
    },
  } as unknown as PrismaClient;
}

describe("infrastructure sampler", () => {
  it("reads memory and disk use from a runner's host report", () => {
    expect(
      serverFromStatus({
        host: {
          load1: 2.5,
          cpus: 8,
          cpuBusyPercent: 31.2,
          memAvailableBytes: 20 * GB,
          memTotalBytes: 32 * GB,
          disk: { totalBytes: 400 * GB, freeBytes: 150 * GB },
        },
      }),
    ).toEqual({
      up: true,
      cpuPercent: 31.2,
      load1: 2.5,
      cpus: 8,
      memUsedBytes: 12 * GB,
      memTotalBytes: 32 * GB,
      diskUsedBytes: 250 * GB,
      diskTotalBytes: 400 * GB,
    });
  });

  it("leaves gaps for an older runner and marks a silent one down", () => {
    const older = serverFromStatus({ host: { load1: 1, cpus: 4, memAvailableBytes: GB } });
    expect(older).toMatchObject({
      up: true,
      cpuPercent: null,
      memUsedBytes: null,
      diskUsedBytes: null,
    });
    expect(serverFromStatus(null)).toMatchObject({ up: false, cpus: null });
  });

  it("samples both runners and the fleet, and survives a runner that does not answer", async () => {
    const fetcher = vi.fn(async (url: URL | string) => {
      if (String(url).startsWith("http://routines")) throw new Error("connect ECONNREFUSED");
      return new Response(
        JSON.stringify({
          slots: 6,
          running: 2,
          queued: 1,
          started: 40,
          large: { slots: 1, running: 1, queued: 0, started: 3 },
          video: { slots: 2, running: 0, queued: 0 },
          host: { load1: 1, cpus: 8, memAvailableBytes: 10 * GB, memTotalBytes: 32 * GB },
        }),
      );
    });
    const sample = await takeInfraSample({
      prisma: prisma(),
      runners: { app: "http://app:7091", routines: "http://routines:7091", token: "t" },
      fetch: fetcher as unknown as typeof fetch,
    });
    expect(fetcher).toHaveBeenCalledWith(
      new URL("http://app:7091/tool-runs/status"),
      expect.objectContaining({ headers: { authorization: "Bearer t" } }),
    );
    expect(sample.app).toMatchObject({ up: true, memUsedBytes: 22 * GB });
    expect(sample.routines.up).toBe(false);
    expect(sample.runners).toEqual({
      app: {
        tools: { slots: 6, running: 2, queued: 1, started: 40 },
        large: { slots: 1, running: 1, queued: 0, started: 3 },
        video: { slots: 2, running: 0, queued: 0, started: null },
      },
      routines: null,
    });
    expect(sample.incus.up).toBe(false);
    expect(sample.fleet).toEqual({
      computersRunning: 5,
      chatRuns: 3,
      routineRuns: 3,
      queuedRuns: 4,
    });
  });
});
