import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  documentHomePath,
  expiredItems,
  isPinned,
  listStoredItems,
  openStoredFile,
  readStoredItem,
  removeStoredItem,
  runnerHomePath,
  storedHomePaths,
  sweepConversationFolders,
  sweepHome,
} from "./file-retention.js";
import { LocalAgentHomeStore } from "./home.js";

const DAY = 86_400_000;
/** ctime cannot be set back, so "old" means a sweep run this far in the future. */
const LATER = Date.now() + 40 * DAY;

let data: string;
let home: string;
let other: string;

async function put(file: string, content = "x") {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

beforeEach(async () => {
  data = await mkdtemp(path.join(tmpdir(), "file-retention-"));
  home = path.join(data, "homes", "team-a");
  other = path.join(data, "homes", "team-b");
  await put(path.join(home, "agents/b1/report.docx"), "12345");
  await put(path.join(home, "agents/b1/site/index.html"));
  await put(path.join(home, "agents/b1/site/app.js"));
  await put(path.join(home, "agents/b1/outputs/deck.pptx"));
  await put(path.join(home, "agents/b1/outputs/video.mp4"));
  await put(path.join(home, "agents/b1/work/spec.json"));
  await put(path.join(home, "agents/b1/.settings/keep.json"));
  await put(path.join(home, "conversations/thread-1/notes.txt"));
  await put(path.join(other, "agents/b9/outputs/deck.pptx"), "someone else's");
  await put(path.join(other, "agents/b9/secret.txt"), "someone else's");
});

afterEach(async () => {
  await rm(data, { recursive: true, force: true });
});

describe("listing an agent's files", () => {
  it("lists top-level items and each output separately, never hidden settings", async () => {
    const items = await listStoredItems(home, "bots/b1");
    expect(items.map((item) => item.path).sort()).toEqual([
      "outputs/deck.pptx",
      "outputs/video.mp4",
      "report.docx",
      "site",
      "work/spec.json",
    ]);
    const site = items.find((item) => item.path === "site")!;
    expect(site).toMatchObject({ kind: "dir", files: 2 });
    expect(items.find((item) => item.path === "report.docx")).toMatchObject({
      kind: "file",
      size: 5,
    });
  });

  it("does not follow a folder swapped for a link into another person's home", async () => {
    await rm(path.join(home, "bots/b1/outputs"), { recursive: true });
    await symlink(path.join(other, "bots/b9/outputs"), path.join(home, "bots/b1/outputs"));
    const items = await listStoredItems(home, "bots/b1");
    expect(items.map((item) => item.path)).not.toContain("outputs/deck.pptx");
    await expect(removeStoredItem(home, "bots/b1", "outputs/deck.pptx")).rejects.toThrow();
    expect(existsSync(path.join(other, "agents/b9/outputs/deck.pptx"))).toBe(true);
    await expect(openStoredFile(home, "bots/b1", "outputs/deck.pptx")).rejects.toThrow();
  });

  it("finds nothing when the agent folder itself is a link", async () => {
    await rm(path.join(home, "bots/b1"), { recursive: true });
    await symlink(path.join(other, "bots/b9"), path.join(home, "bots/b1"));
    expect(await listStoredItems(home, "bots/b1")).toEqual([]);
  });
});

describe("pins", () => {
  it("keep the item itself, the item holding it, and anything inside it", () => {
    expect(isPinned("site", ["site"])).toBe(true);
    expect(isPinned("site", ["site/index.html"])).toBe(true);
    expect(isPinned("site/index.html", ["site"])).toBe(true);
    expect(isPinned("sites", ["site"])).toBe(false);
  });

  it("only items older than the retention and not pinned expire", async () => {
    const items = await listStoredItems(home, "bots/b1");
    expect(expiredItems(items, [], 30, Date.now())).toEqual([]);
    expect(
      expiredItems(items, ["outputs/video.mp4"], 30, LATER)
        .map((item) => item.path)
        .sort(),
    ).toEqual(["outputs/deck.pptx", "report.docx", "site", "work/spec.json"]);
  });
});

describe("removing an item", () => {
  it("refuses anything that is not an item shape", async () => {
    for (const bad of ["../b9", ".settings", "site/index.html", "outputs/a/b", "", "a//b"]) {
      await expect(removeStoredItem(home, "bots/b1", bad)).rejects.toThrow();
    }
    expect(existsSync(path.join(home, "agents/b1/site/index.html"))).toBe(true);
  });

  it("removes a link as a link, leaving its target", async () => {
    await symlink(path.join(other, "agents/b9/secret.txt"), path.join(home, "bots/b1/pointer"));
    await removeStoredItem(home, "bots/b1", "pointer");
    expect(existsSync(path.join(home, "bots/b1/pointer"))).toBe(false);
    expect(existsSync(path.join(other, "agents/b9/secret.txt"))).toBe(true);
  });

  it("leaves nothing behind in the server's trash", async () => {
    await removeStoredItem(home, "bots/b1", "site");
    expect(existsSync(path.join(home, "bots/b1/site"))).toBe(false);
    expect(await readdir(path.join(data, "file-trash"))).toEqual([]);
  });
});

describe("reading an item for a download", () => {
  async function read(itemPath: string) {
    const files: Record<string, string> = {};
    for await (const file of readStoredItem(home, "bots/b1", itemPath)) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of file.data) chunks.push(chunk);
      files[file.path] = Buffer.concat(chunks).toString();
    }
    return files;
  }

  it("reads a file, or every file in a folder", async () => {
    expect(await read("report.docx")).toEqual({ "report.docx": "12345" });
    expect(Object.keys(await read("site")).sort()).toEqual(["site/app.js", "site/index.html"]);
  });

  it("skips links inside a folder and refuses a linked item or a path outside the shape", async () => {
    await symlink(path.join(other, "agents/b9/secret.txt"), path.join(home, "agents/b1/site/leak.txt"));
    await symlink(path.join(other, "bots/b9"), path.join(home, "bots/b1/site/elsewhere"));
    expect(Object.keys(await read("site")).sort()).toEqual(["site/app.js", "site/index.html"]);
    await symlink(path.join(other, "agents/b9/secret.txt"), path.join(home, "bots/b1/pointer"));
    await expect(read("pointer")).rejects.toThrow();
    await expect(read("../b9/secret.txt")).rejects.toThrow();
  });
});

describe("sweeping a home", () => {
  it("deletes old unpinned items and stale conversation folders, keeping settings and pins", async () => {
    const swept = await sweepHome({
      home,
      scope: "team",
      bots: new Map([["b1", ["site"]]]),
      retentionDays: 30,
      now: LATER,
    });
    expect(swept.deletedItems).toBe(5);
    expect(await readdir(path.join(home, "bots/b1"))).toEqual(
      expect.arrayContaining([".settings", "site"]),
    );
    expect(existsSync(path.join(home, "agents/b1/report.docx"))).toBe(false);
    expect(existsSync(path.join(home, "agents/b1/outputs/video.mp4"))).toBe(false);
    expect(existsSync(path.join(home, "conversations/thread-1"))).toBe(false);
    expect(existsSync(path.join(other, "agents/b9/outputs/deck.pptx"))).toBe(true);
  });

  it("deletes nothing that changed within the retention", async () => {
    const swept = await sweepHome({
      home,
      scope: "team",
      bots: new Map([["b1", []]]),
      retentionDays: 30,
      now: Date.now(),
    });
    expect(swept.deletedItems).toBe(0);
    expect(swept.homeBytes).toBeGreaterThan(0);
  });

  it("moves colleague conversations out of the home when tool runners hold them", async () => {
    const conversations = path.join(data, "tool-work/conversations");
    await put(path.join(conversations, "thread-2/kept.txt"));
    await put(path.join(home, "conversations/thread-2/stale-copy.txt"));
    await sweepHome({
      home,
      scope: "team",
      bots: new Map([["b1", []]]),
      retentionDays: 30,
      now: Date.now(),
      conversationsTo: conversations,
    });
    expect(existsSync(path.join(home, "conversations/thread-1"))).toBe(false);
    expect(existsSync(path.join(conversations, "thread-1/notes.txt"))).toBe(true);
    expect(await readdir(path.join(conversations, "thread-2"))).toEqual(["kept.txt"]);
    expect(await readdir(path.join(home, "conversations"))).toEqual([]);
  });
});

describe("where a person's agent files are kept", () => {
  it("uses the home, or a document home apart from a computer that keeps its own", () => {
    const store = new LocalAgentHomeStore(data);
    const where = { home: store, dataDir: data, homeKey: "team-a" };
    expect(runnerHomePath({ ...where, sharesHome: true })).toBe(home);
    expect(storedHomePaths({ ...where, sharesHome: true })).toEqual([home]);
    const documents = path.join(data, "tool-work/documents/team-a");
    expect(documentHomePath(data, "team-a")).toBe(documents);
    expect(runnerHomePath({ ...where, sharesHome: false })).toBe(documents);
    expect(storedHomePaths({ ...where, sharesHome: false })).toEqual([documents, home]);
    expect(runnerHomePath({ ...where, dataDir: undefined, sharesHome: false })).toBeNull();
    expect(documentHomePath(data, "../team-a")).toBeNull();
  });
});

describe("sweeping tool runner conversation folders", () => {
  it("deletes folders idle past the retention and keeps recent ones", async () => {
    await put(path.join(data, "tool-work/conversations/old/deck.pptx"), "12345");
    const old = await sweepConversationFolders({ dataDir: data, retentionDays: 30, now: LATER });
    expect(old).toEqual({ deletedItems: 1, freedBytes: 5 });
    expect(existsSync(path.join(data, "tool-work/conversations/old"))).toBe(false);
    await put(path.join(data, "tool-work/conversations/new/deck.pptx"));
    const recent = await sweepConversationFolders({
      dataDir: data,
      retentionDays: 30,
      now: Date.now(),
    });
    expect(recent.deletedItems).toBe(0);
  });
});
