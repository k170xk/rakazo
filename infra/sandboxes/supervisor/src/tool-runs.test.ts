import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FairSlots,
  prepareToolRunMount,
  toolRunContainerOptions,
  toolRunRequestSchema,
} from "./tool-runs.js";

const valid = { mount: "tool-work/conversations/t1", program: "word", args: [], owner: "u1" };

describe("tool run requests", () => {
  it("accepts only a conversation folder or a whole home", () => {
    expect(toolRunRequestSchema.safeParse(valid).success).toBe(true);
    expect(
      toolRunRequestSchema.safeParse({ ...valid, mount: "homes/team-a", cwd: "bots/b1" }).success,
    ).toBe(true);
    for (const mount of [
      "homes",
      "homes/..",
      "homes/team-a/bots",
      "tool-work",
      "artifacts",
      "/data/homes/team-a",
      "tool-work/conversations/../../homes/team-a",
    ]) {
      expect(toolRunRequestSchema.safeParse({ ...valid, mount }).success, mount).toBe(false);
    }
    expect(toolRunRequestSchema.safeParse({ ...valid, cwd: "../x" }).success).toBe(false);
    expect(toolRunRequestSchema.safeParse({ ...valid, program: "video" }).success).toBe(false);
  });
});

describe("runner slots", () => {
  it("lets waiting people take turns", async () => {
    const slots = new FairSlots(1);
    const order: string[] = [];
    const first = await slots.acquire("alice");
    const waits = [
      ["alice", 1],
      ["alice", 2],
      ["bob", 1],
    ].map(([owner, n]) =>
      slots.acquire(String(owner)).then((release) => {
        order.push(`${owner}${n}`);
        release();
      }),
    );
    expect(slots.stats()).toEqual({ slots: 1, running: 1, queued: 3 });
    first();
    await Promise.all(waits);
    expect(order).toEqual(["alice1", "bob1", "alice2"]);
    expect(slots.stats()).toEqual({ slots: 1, running: 0, queued: 0 });
  });

  it("drops a cancelled wait", async () => {
    const slots = new FairSlots(1);
    const release = await slots.acquire("a");
    const abort = new AbortController();
    const waiting = slots.acquire("b", abort.signal);
    abort.abort();
    await expect(waiting).rejects.toThrow("cancelled");
    expect(slots.stats().queued).toBe(0);
    release();
    expect(slots.stats().running).toBe(0);
  });
});

describe("tool run folder", () => {
  it("makes a conversation folder and refuses one that is a link", async () => {
    const data = await mkdtemp(path.join(tmpdir(), "tool-runs-"));
    try {
      expect(await prepareToolRunMount(data, "tool-work/conversations/t1", undefined)).toBe(
        path.join(data, "tool-work/conversations/t1"),
      );
      await mkdir(path.join(data, "homes/team-a"), { recursive: true });
      await symlink(path.join(data, "homes"), path.join(data, "tool-work/conversations/t2"));
      await expect(
        prepareToolRunMount(data, "tool-work/conversations/t2", undefined),
      ).rejects.toThrow("not a plain folder");
      await expect(prepareToolRunMount(data, "homes/team-b", undefined)).rejects.toThrow();
    } finally {
      await rm(data, { recursive: true, force: true });
    }
  });
});

describe("tool run container", () => {
  it("sees one folder, cannot write its system disk and has no screen", () => {
    const options = toolRunContainerOptions({
      name: "rakazo-tool-run-x",
      image: "rakazo/computer:local",
      user: "1000:1000",
      request: toolRunRequestSchema.parse({ ...valid, mount: "homes/team-a", cwd: "bots/b1" }),
      storage: { homePath: "/srv/data/homes/team-a" },
    });
    expect(options.HostConfig).toMatchObject({
      Binds: ["/srv/data/homes/team-a:/work"],
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      NanoCpus: 2e9,
    });
    expect(options.WorkingDir).toBe("/work/bots/b1");
    expect(options.Entrypoint).toEqual(["/usr/local/bin/ocsc-word"]);
    expect(options.Env).toContain("WORKSPACE_DIR=/work/bots/b1");
  });
});
