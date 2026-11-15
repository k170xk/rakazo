import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  autoToolRunSlots,
  cpuBusyOver,
  cpuTimes,
  deleteToolCacheFiles,
  FairSlots,
  listToolCacheFiles,
  memoryRoomFor,
  openToolCacheFile,
  prepareToolRunMount,
  printedOutOfMemory,
  slotsPerPerson,
  sweepToolCache,
  toolRunContainerOptions,
  toolRunFileSchema,
  toolRunHostLoad,
  toolRunLocalMount,
  toolRunRequestSchema,
  writeToolCacheFile,
} from "./tool-runs.js";

const valid = { mount: "tool-work/conversations/t1", program: "word", args: [], owner: "u1" };

describe("tool run requests", () => {
  it("accepts only a conversation folder, a document folder or a whole home", () => {
    expect(toolRunRequestSchema.safeParse(valid).success).toBe(true);
    expect(
      toolRunRequestSchema.safeParse({ ...valid, mount: "homes/team-a", cwd: "bots/b1" }).success,
    ).toBe(true);
    expect(
      toolRunRequestSchema.safeParse({
        ...valid,
        mount: "tool-work/documents/team-a",
        cwd: "bots/b1",
      }).success,
    ).toBe(true);
    for (const mount of [
      "homes",
      "homes/..",
      "homes/team-a/bots",
      "tool-work",
      "tool-work/documents",
      "tool-work/documents/team-a/bots",
      "artifacts",
      "/data/homes/team-a",
      "tool-work/conversations/../../homes/team-a",
    ]) {
      expect(toolRunRequestSchema.safeParse({ ...valid, mount }).success, mount).toBe(false);
    }
    expect(toolRunRequestSchema.safeParse({ ...valid, cwd: "../x" }).success).toBe(false);
    expect(toolRunRequestSchema.safeParse({ ...valid, program: "video" }).success).toBe(true);
    expect(toolRunRequestSchema.safeParse({ ...valid, program: "show" }).success).toBe(false);
  });
});

describe("runner host load", () => {
  it("reports available memory from meminfo, or null when it cannot be read", async () => {
    const load = await toolRunHostLoad(async () => "MemTotal: 100 kB\nMemAvailable:   2048 kB\n");
    expect(load.memAvailableBytes).toBe(2048 * 1024);
    expect(load.cpus).toBeGreaterThan(0);
    expect((await toolRunHostLoad(async () => "")).memAvailableBytes).toBeNull();
  });
  it("measures CPU use between readings at least five seconds apart", () => {
    expect(cpuTimes("cpu  10 0 10 70 10 0 0 0 0 0\ncpu0 1 2 3 4")).toEqual({
      total: 100,
      idle: 80,
    });
    expect(cpuTimes("")).toBeNull();
    expect(cpuBusyOver({ total: 100, idle: 80 }, 0)).toBeNull();
    expect(cpuBusyOver({ total: 150, idle: 90 }, 1_000)).toBeNull();
    expect(cpuBusyOver({ total: 200, idle: 105 }, 6_000)).toBe(75);
    expect(cpuBusyOver(null, 7_000)).toBe(75);
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
    expect(slots.stats()).toEqual({ slots: 1, running: 1, queued: 3, started: 1, perOwner: 1 });
    first();
    await Promise.all(waits);
    expect(order).toEqual(["alice1", "bob1", "alice2"]);
    expect(slots.stats()).toEqual({ slots: 1, running: 0, queued: 0, started: 4, perOwner: 1 });
  });

  it("keeps runners free for others while one person runs a batch", async () => {
    const slots = new FairSlots(4, 2);
    const flood = Array.from({ length: 6 }, () => slots.acquire("flooder"));
    await Promise.all(flood.slice(0, 2));
    expect(slots.stats("flooder")).toMatchObject({ running: 2, queued: 4, ownerRunning: 2 });
    const queuedFor: number[] = [];
    const other = await slots.acquire("someone", undefined, (ahead) => queuedFor.push(ahead));
    expect(queuedFor).toEqual([]);
    expect(slots.stats("someone")).toMatchObject({ running: 3, ownerRunning: 1 });
    other();
    (await flood[0]!)();
    await flood[2];
    expect(slots.stats("flooder")).toMatchObject({ running: 2, queued: 3, ownerRunning: 2 });
  });

  it("gives a capped person's turn to whoever is next", async () => {
    const slots = new FairSlots(2, 1);
    const alice = await slots.acquire("alice");
    const aliceAgain = slots.acquire("alice");
    const bob = await slots.acquire("bob");
    const carol = slots.acquire("carol");
    bob();
    (await carol)();
    alice();
    (await aliceAgain)();
    expect(slots.stats()).toMatchObject({ running: 0, queued: 0 });
  });

  it("caps each person at half the runners, at least four", () => {
    expect([1, 2, 4, 8, 12, 16].map(slotsPerPerson)).toEqual([1, 2, 4, 4, 6, 8]);
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

describe("copied folders for runners on another server", () => {
  const bytes = (text: string) =>
    (async function* () {
      yield new TextEncoder().encode(text);
    })();

  it("keeps copies apart from the real folders and only takes safe file paths", () => {
    expect(toolRunLocalMount({ mount: "homes/team-a", synced: true })).toBe(
      "tool-cache/homes/team-a",
    );
    expect(toolRunLocalMount({ mount: "homes/team-a" })).toBe("homes/team-a");
    for (const bad of ["../x", "a/../../x", "/etc/passwd", "a//b", "./a", ""]) {
      expect(toolRunFileSchema.safeParse({ mount: "homes/team-a", path: bad }).success).toBe(false);
    }
    expect(
      toolRunFileSchema.safeParse({ mount: "homes/team-a", path: "bots/b1/a b.docx" }).success,
    ).toBe(true);
  });

  it("writes, lists, reads and deletes copied files without following links", async () => {
    const data = await mkdtemp(path.join(tmpdir(), "tool-cache-"));
    try {
      const root = await prepareToolRunMount(data, "tool-cache/homes/team-a", undefined);
      await writeToolCacheFile({
        root,
        relative: "bots/b1/in/brief.txt",
        body: bytes("brief"),
        mtimeMs: 1_700_000_000_000,
        owner: undefined,
        maxBytes: 100,
      });
      await expect(
        writeToolCacheFile({
          root,
          relative: "bots/b1/big.txt",
          body: bytes("x".repeat(20)),
          mtimeMs: 1,
          owner: undefined,
          maxBytes: 10,
        }),
      ).rejects.toThrow(/exceeds 10 bytes/);
      await writeFile(path.join(data, "secret.txt"), "secret");
      await symlink(path.join(data, "secret.txt"), path.join(root, "bots/b1/link.txt"));
      await symlink(data, path.join(root, "bots/b1/out"));
      await expect(
        writeToolCacheFile({
          root,
          relative: "bots/b1/out/escape.txt",
          body: bytes("x"),
          mtimeMs: 1,
          owner: undefined,
          maxBytes: 10,
        }),
      ).rejects.toThrow("not a plain folder");

      expect(await listToolCacheFiles(root, "bots/b1")).toEqual([
        { path: "bots/b1/in/brief.txt", size: 5, mtimeMs: 1_700_000_000_000 },
      ]);
      expect(await listToolCacheFiles(root, "bots/missing")).toEqual([]);
      expect(await openToolCacheFile(root, "bots/b1/link.txt")).toBeUndefined();
      const opened = await openToolCacheFile(root, "bots/b1/in/brief.txt");
      expect(opened?.size).toBe(5);
      await opened?.handle.close();

      expect(await deleteToolCacheFiles(root, ["bots/b1/in/brief.txt", "bots/b1/link.txt"])).toBe(
        1,
      );
      expect(await readFile(path.join(data, "secret.txt"), "utf8")).toBe("secret");
    } finally {
      await rm(data, { recursive: true, force: true });
    }
  });

  it("drops copies nobody has used for a while", async () => {
    const data = await mkdtemp(path.join(tmpdir(), "tool-cache-"));
    try {
      const stale = await prepareToolRunMount(data, "tool-cache/homes/old", undefined);
      await prepareToolRunMount(data, "tool-cache/tool-work/conversations/fresh", undefined);
      const longAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await utimes(stale, longAgo, longAgo);
      expect(await sweepToolCache(data, 7 * 24 * 60 * 60 * 1000)).toBe(1);
      expect(await readdir(path.join(data, "tool-cache/tool-work/conversations"))).toEqual([
        "fresh",
      ]);
      expect(await readdir(path.join(data, "tool-cache/homes"))).toEqual([]);
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
      CpuShares: 512,
    });
    expect(options.WorkingDir).toBe("/work/bots/b1");
    expect(options.Entrypoint).toEqual(["/usr/local/bin/ocsc-word"]);
    expect(options.Env).toContain("WORKSPACE_DIR=/work/bots/b1");
    expect(options.Env.some((entry) => entry.startsWith("OCSC_AUTHOR="))).toBe(false);
    expect(options.HostConfig.Tmpfs).not.toHaveProperty("/opt/ocsc-video/.work");
  });

  it("gives a video twice a document's cores", () => {
    const options = toolRunContainerOptions({
      name: "rakazo-tool-run-v",
      image: "rakazo/computer:local",
      user: "1000:1000",
      request: toolRunRequestSchema.parse({ ...valid, program: "video", args: ["render"] }),
      storage: { homePath: "/srv/data/homes/team-a" },
    });
    expect(options.HostConfig).toMatchObject({ NanoCpus: 4e9, CpuShares: 512 });
  });

  it("names the person as the author of tracked changes, on one line", () => {
    const options = toolRunContainerOptions({
      name: "rakazo-tool-run-a",
      image: "rakazo/computer:local",
      user: "1000:1000",
      request: toolRunRequestSchema.parse({ ...valid, author: " Keith\nKnox " }),
      storage: { homePath: "/srv/data/tool-work/conversations/t1" },
    });
    expect(options.Env).toContain("OCSC_AUTHOR=Keith Knox");
  });

  it("gives a video more memory and a writable engine scratch folder", () => {
    const options = toolRunContainerOptions({
      name: "rakazo-tool-run-v",
      image: "rakazo/computer:local",
      user: "1000:1000",
      request: toolRunRequestSchema.parse({ ...valid, program: "video", args: ["render"] }),
      storage: { homePath: "/srv/data/homes/team-a" },
    });
    expect(options.Entrypoint).toEqual(["/usr/local/bin/ocsc-video"]);
    expect(options.HostConfig.Memory).toBe(6 * 1024 ** 3);
    expect(options.HostConfig.ReadonlyRootfs).toBe(true);
    expect(options.HostConfig.Tmpfs).toHaveProperty("/opt/ocsc-video/.work");
    expect(options.Env).toContain("OCSC_VIDEO_INLINE=1");
  });

  it("gives a large document more memory, cores and scratch room, and lifts the tools' size limit", () => {
    const options = toolRunContainerOptions({
      name: "rakazo-tool-run-l",
      image: "rakazo/computer:local",
      user: "1000:1000",
      request: toolRunRequestSchema.parse({ ...valid, program: "pptx", large: true }),
      storage: { homePath: "/srv/data/homes/team-a" },
    });
    expect(options.HostConfig).toMatchObject({
      Memory: 12 * 1024 ** 3,
      MemorySwap: 12 * 1024 ** 3,
      NanoCpus: 4e9,
      CpuShares: 512,
      ReadonlyRootfs: true,
    });
    expect(options.HostConfig.Tmpfs["/tmp"]).toContain("size=4g");
    expect(options.Env).toContain("OCSC_LARGE_INPUT=1");
    expect(options.Env).toContain("NODE_OPTIONS=--max-old-space-size=9216");
  });

  it("keeps ordinary commands and videos out of the large-document settings", () => {
    for (const request of [valid, { ...valid, program: "video", args: ["render"], large: true }]) {
      const options = toolRunContainerOptions({
        name: "rakazo-tool-run-o",
        image: "rakazo/computer:local",
        user: "1000:1000",
        request: toolRunRequestSchema.parse(request),
        storage: { homePath: "/srv/data/homes/team-a" },
      });
      expect(options.HostConfig.Tmpfs["/tmp"]).toContain("size=2g");
      expect(options.Env).not.toContain("OCSC_LARGE_INPUT=1");
      expect(options.Env.some((entry) => entry.startsWith("NODE_OPTIONS="))).toBe(false);
    }
  });

  it("is the first thing the kernel stops when the server runs out of memory", () => {
    const options = toolRunContainerOptions({
      name: "rakazo-tool-run-k",
      image: "rakazo/computer:local",
      user: "1000:1000",
      request: toolRunRequestSchema.parse(valid),
      storage: { homePath: "/srv/data/homes/team-a" },
    });
    expect(options.HostConfig.OomScoreAdj).toBe(1000);
    expect(options.HostConfig.Ulimits).toEqual([{ Name: "core", Soft: 0, Hard: 0 }]);
  });
});

describe("runner capacity", () => {
  const gib = 1024 ** 3;

  it("sizes an automatic runner to the server's cores and memory", () => {
    expect(autoToolRunSlots(8, 31 * gib, 2 * gib)).toBe(8);
    expect(autoToolRunSlots(16, 31 * gib, 2 * gib)).toBe(11);
    expect(autoToolRunSlots(32, 64 * gib, 4 * gib)).toBe(14);
    expect(autoToolRunSlots(2, 8 * gib, 4 * gib)).toBe(2);
  });

  it("starts a command only while the server keeps memory spare", () => {
    expect(memoryRoomFor(2 * gib, 20 * gib)).toBe(true);
    expect(memoryRoomFor(12 * gib, 13 * gib)).toBe(false);
    expect(memoryRoomFor(12 * gib, 14 * gib)).toBe(true);
    expect(memoryRoomFor(12 * gib, null)).toBe(true);
  });

  it("recognises a program that ran out of memory by what it printed", () => {
    expect(
      printedOutOfMemory(
        "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory",
      ),
    ).toBe(true);
    expect(printedOutOfMemory("Deck.pptx does not exist.")).toBe(false);
  });
});
