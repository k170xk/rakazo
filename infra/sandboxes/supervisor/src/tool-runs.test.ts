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
  deleteToolCacheFiles,
  FairSlots,
  listToolCacheFiles,
  openToolCacheFile,
  prepareToolRunMount,
  sweepToolCache,
  toolRunContainerOptions,
  toolRunFileSchema,
  toolRunLocalMount,
  toolRunRequestSchema,
  writeToolCacheFile,
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
    expect(toolRunRequestSchema.safeParse({ ...valid, program: "video" }).success).toBe(true);
    expect(toolRunRequestSchema.safeParse({ ...valid, program: "show" }).success).toBe(false);
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
    });
    expect(options.WorkingDir).toBe("/work/bots/b1");
    expect(options.Entrypoint).toEqual(["/usr/local/bin/ocsc-word"]);
    expect(options.Env).toContain("WORKSPACE_DIR=/work/bots/b1");
    expect(options.HostConfig.Tmpfs).not.toHaveProperty("/opt/ocsc-video/.work");
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
});
