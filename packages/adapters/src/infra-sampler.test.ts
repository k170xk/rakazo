import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import {
  accumulateMember,
  clusterMemberNames,
  parseInfraServerLabels,
  serverFromStatus,
  takeInfraSample,
} from "./infra-sampler.js";

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

  it("counts every online cluster member and adds their capacity together", () => {
    expect(
      clusterMemberNames([
        { server_name: "computers1", status: "Online" },
        { server_name: "computers2", status: "Online" },
        { server_name: "computers3", status: "Offline" },
      ]),
    ).toEqual(["computers1", "computers2"]);
    expect(clusterMemberNames(["/1.0/cluster/members/computers1"])).toEqual(["computers1"]);
    expect(clusterMemberNames(null)).toBeNull();

    const total = {
      up: false,
      cpus: null,
      memUsedBytes: null,
      memTotalBytes: null,
      diskUsedBytes: null,
      diskTotalBytes: null,
      running: null,
      stopped: null,
    };
    accumulateMember(total, {
      cpus: 8,
      memUsedBytes: 4 * GB,
      memTotalBytes: 32 * GB,
      diskUsedBytes: 60 * GB,
      diskTotalBytes: 300 * GB,
    });
    accumulateMember(total, {
      cpus: 8,
      memUsedBytes: 2 * GB,
      memTotalBytes: 32 * GB,
      diskUsedBytes: GB,
      diskTotalBytes: 300 * GB,
    });
    expect(total).toMatchObject({
      up: true,
      members: 2,
      cpus: 16,
      memUsedBytes: 6 * GB,
      memTotalBytes: 64 * GB,
      diskUsedBytes: 61 * GB,
      diskTotalBytes: 600 * GB,
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

  it("aggregates multiple dedicated tool runners with names and data centres", async () => {
    const labels = parseInfraServerLabels(
      "app=computer.ocsc.me|Manchester, UK (DC18);10.77.0.4=computers2|Manchester, UK (DC18);10.77.0.5=tools2|Paris, FR (DC26);10.77.0.6=tools3|Paris, FR (DC26);10.77.0.3=routines1|Manchester, UK (DC18)",
    );
    const fetcher = vi.fn(async (url: URL | string) => {
      const s = String(url);
      if (s.includes("10.77.0.4")) {
        return new Response(
          JSON.stringify({
            slots: 8,
            running: 2,
            queued: 0,
            started: 10,
            large: { slots: 1, running: 1, queued: 0, started: 2 },
            video: { slots: 2, running: 0, queued: 0, started: 1 },
            host: {
              load1: 1.5,
              cpus: 8,
              cpuBusyPercent: 20,
              memAvailableBytes: 24 * GB,
              memTotalBytes: 32 * GB,
              disk: { totalBytes: 400 * GB, freeBytes: 350 * GB },
            },
          }),
        );
      }
      if (s.includes("10.77.0.5")) {
        return new Response(
          JSON.stringify({
            slots: 8,
            running: 1,
            queued: 0,
            started: 5,
            large: { slots: 1, running: 0, queued: 0, started: 1 },
            video: { slots: 2, running: 1, queued: 0, started: 3 },
            host: {
              load1: 0.5,
              cpus: 8,
              cpuBusyPercent: 10,
              memAvailableBytes: 28 * GB,
              memTotalBytes: 32 * GB,
              disk: { totalBytes: 400 * GB, freeBytes: 390 * GB },
            },
          }),
        );
      }
      if (s.includes("10.77.0.6")) {
        throw new Error("connect ETIMEDOUT");
      }
      return new Response(
        JSON.stringify({
          slots: 8,
          running: 0,
          queued: 0,
          started: 1,
          host: { load1: 0.2, cpus: 8, cpuBusyPercent: 4, memAvailableBytes: 26 * GB, memTotalBytes: 32 * GB },
        }),
      );
    });
    const sample = await takeInfraSample({
      prisma: prisma(),
      runners: {
        app: "http://127.0.0.1:7091",
        tools: ["http://10.77.0.4:7091", "http://10.77.0.5:7091", "http://10.77.0.6:7091"],
        routines: "http://10.77.0.3:7091",
        token: "t",
      },
      labels,
      fetch: fetcher as unknown as typeof fetch,
    });
    expect(sample.app).toMatchObject({
      name: "computer.ocsc.me",
      datacenter: "Manchester, UK (DC18)",
    });
    expect(sample.routines).toMatchObject({
      name: "routines1",
      datacenter: "Manchester, UK (DC18)",
    });
    expect(sample.toolNodes).toHaveLength(3);
    expect(sample.toolNodes?.[0]).toMatchObject({
      name: "computers2",
      datacenter: "Manchester, UK (DC18)",
      primary: true,
      up: true,
    });
    expect(sample.toolNodes?.[1]).toMatchObject({
      name: "tools2",
      datacenter: "Paris, FR (DC26)",
      primary: false,
      up: true,
    });
    expect(sample.toolNodes?.[2]).toMatchObject({
      name: "tools3",
      datacenter: "Paris, FR (DC26)",
      up: false,
      lanes: null,
    });
    expect(sample.tools).toMatchObject({
      up: true,
      cpus: 16,
      cpuPercent: 15,
      memUsedBytes: 12 * GB,
      memTotalBytes: 64 * GB,
      diskUsedBytes: 60 * GB,
      diskTotalBytes: 800 * GB,
    });
    expect(sample.runners.app).toEqual({
      tools: { slots: 16, running: 3, queued: 0, started: 15 },
      large: { slots: 2, running: 1, queued: 0, started: 3 },
      video: { slots: 4, running: 1, queued: 0, started: 4 },
    });
  });
});
