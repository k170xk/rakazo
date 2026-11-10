import type { BackgroundJobHandlers } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { InMemoryRealtimeFanout } from "./realtime.js";
import {
  poolComputerAccess,
  runInPool,
  runPoolFromEnv,
  runPoolOf,
  runPoolWhere,
  runReadyTopic,
  runReadyTopics,
} from "./run-pool.js";
import { RunStarter } from "./run-wakeup.js";

describe("run pools", () => {
  it("reads the pool from the environment and refuses unknown pools", () => {
    expect(runPoolFromEnv({})).toBe("all");
    expect(runPoolFromEnv({ RAKAZO_RUN_POOL: "routines" })).toBe("routines");
    expect(runPoolFromEnv({ RAKAZO_RUN_POOL: " chat " })).toBe("chat");
    expect(() => runPoolFromEnv({ RAKAZO_RUN_POOL: "computers" })).toThrow();
  });

  it("puts routine and webhook runs in the routines pool and everything else in chat", () => {
    expect(runPoolOf("routine")).toBe("routines");
    expect(runPoolOf("webhook")).toBe("routines");
    expect(runPoolOf("user")).toBe("chat");
    expect(runPoolOf("reaction")).toBe("chat");
    expect(runInPool("routine", "chat")).toBe(false);
    expect(runInPool("routine", "all")).toBe(true);
    expect(runInPool("user", "routines")).toBe(false);
  });

  it("filters scans and topics by pool", () => {
    expect(runPoolWhere("all")).toEqual({});
    expect(runPoolWhere("routines")).toEqual({ trigger: { in: ["routine", "webhook"] } });
    expect(runPoolWhere("chat")).toEqual({ trigger: { notIn: ["routine", "webhook"] } });
    expect(runReadyTopic("chat")).toBe("runs:ready");
    expect(runReadyTopic("all")).toBe("runs:ready");
    expect(runReadyTopics("all")).toEqual(["runs:ready", runReadyTopic("routines")]);
    expect(runReadyTopics("routines")).toEqual([runReadyTopic("routines")]);
  });

  it("never gives routine runners a computer", () => {
    expect(poolComputerAccess("full", "routines")).toBe("tools");
    expect(poolComputerAccess("none", "routines")).toBe("none");
    expect(poolComputerAccess("full", "chat")).toBe("full");
    expect(poolComputerAccess("full", "all")).toBe("full");
  });
});

describe("RunStarter in a pool", () => {
  function starter(pool: "chat" | "routines", trigger: string) {
    const realtime = new InMemoryRealtimeFanout();
    const publish = vi.spyOn(realtime, "publish");
    const prisma = {
      run: { findUnique: vi.fn(async () => ({ trigger })) },
    } as unknown as PrismaClient;
    const runStarter = new RunStarter(realtime, { pool: { pool, prisma } });
    const dispatched = vi.fn(async () => undefined);
    runStarter.attach({ "run.continue": dispatched } as unknown as BackgroundJobHandlers);
    return { runStarter, publish, dispatched };
  }

  it("hands a routine run made in a chat process to the routine runners", async () => {
    const { runStarter, publish, dispatched } = starter("chat", "routine");
    runStarter.start("run-1");
    await vi.waitFor(() =>
      expect(publish).toHaveBeenCalledWith(runReadyTopic("routines"), "run-1"),
    );
    expect(dispatched).not.toHaveBeenCalled();
    await runStarter.stop();
  });

  it("hands a chat run that reached a routine runner back to chat", async () => {
    const { runStarter, publish, dispatched } = starter("routines", "user");
    runStarter.take("run-2");
    await vi.waitFor(() => expect(publish).toHaveBeenCalledWith("runs:ready", "run-2"));
    expect(dispatched).not.toHaveBeenCalled();
    await runStarter.stop();
  });

  it("runs its own pool's work", async () => {
    const { runStarter, publish, dispatched } = starter("routines", "routine");
    runStarter.start("run-3");
    await vi.waitFor(() => expect(dispatched).toHaveBeenCalled());
    expect(publish).not.toHaveBeenCalled();
    await runStarter.stop();
  });
});
