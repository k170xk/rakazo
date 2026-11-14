import { DEFAULT_EMAIL_FILING_POLICY, DEFAULT_EMAIL_FILING_SETTINGS } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import type { FolderNode, StoredFilingItem } from "./email-filing.js";
import {
  blockedFolderIds,
  confidenceCap,
  evidenceFor,
  fileableFolders,
  filingIncludesSentItems,
  filingThreshold,
  folderForJob,
  folderJobKey,
  jobKeyOf,
  jobMatch,
  learnRule,
  presentFilingBatch,
  projectFolderName,
  textJobReferences,
} from "./email-filing.js";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";

function folder(id: string, name: string, parentId: string | null = null, path = name): FolderNode {
  return { id, name, path, parentId, depth: parentId ? 1 : 0, job: folderJobKey(name) };
}

describe("job numbers", () => {
  it("normalises suffix aliases and prefixes", () => {
    expect(jobKeyOf("1234")).toEqual({ key: "1234", parent: "1234" });
    expect(jobKeyOf("1234.01")).toEqual({ key: "1234.01", parent: "1234" });
    expect(jobKeyOf("1234/1")).toEqual({ key: "1234.01", parent: "1234" });
    expect(jobKeyOf("1234-1")).toEqual({ key: "1234.01", parent: "1234" });
    expect(jobKeyOf("c2045")).toEqual({ key: "C2045", parent: "C2045" });
    expect(jobKeyOf("Job No: 1234")).toEqual({ key: "1234", parent: "1234" });
    expect(jobKeyOf("hello")).toBeNull();
  });

  it("reads the leading job of a folder name", () => {
    expect(folderJobKey("1234 - Riverside School")?.key).toBe("1234");
    expect(folderJobKey("1234.02 Phase 2")?.key).toBe("1234.02");
    expect(folderJobKey("Riverside 1234")).toBeNull();
  });

  it("skips bare years and long numbers unless labelled", () => {
    const keys = (text: string) => textJobReferences(text).map((job) => job.key);
    expect(keys("Budget for 2025 attached")).toEqual([]);
    expect(keys("Job 2025 drawings")).toEqual(["2025"]);
    expect(keys("Invoice 98765432")).toEqual([]);
    expect(keys("Re: 1234/1 Riverside")).toEqual(["1234.01"]);
    expect(keys("Version 1234.5678")).toEqual([]);
  });

  it("separates exact and parent-only matches", () => {
    const parent = jobKeyOf("1234")!;
    const child = jobKeyOf("1234.01")!;
    expect(jobMatch(child, child)).toBe("exact");
    expect(jobMatch(child, parent)).toBe("parent");
    expect(jobMatch(parent, child)).toBe("parent");
    expect(jobMatch(jobKeyOf("1235")!, parent)).toBeNull();
  });

  it("names project folders with the job first and no unsafe characters", () => {
    expect(projectFolderName("1234", 'Riverside: "School" / Phase*1')).toBe(
      "1234 - Riverside School Phase 1",
    );
    expect(projectFolderName("1234", "  ")).toBe("1234");
  });
});

describe("folders", () => {
  const folders = [
    folder("inbox", "Inbox"),
    folder("projects", "Projects", "inbox", "Inbox › Projects"),
    folder(
      "p1",
      "1234 - Riverside School",
      "projects",
      "Inbox › Projects › 1234 - Riverside School",
    ),
    folder("deleted", "Deleted Items"),
    folder("old", "1234 - Old copy", "deleted", "Deleted Items › 1234 - Old copy"),
    folder("sent", "Sent Items"),
    folder("other", "1234 - Elsewhere"),
  ];
  const known = { inbox: "inbox", sentitems: "sent", deleteditems: "deleted" };

  it("never files into Inbox, Sent Items or anything under Deleted Items", () => {
    const blocked = blockedFolderIds(folders, known);
    expect([...blocked].sort()).toEqual(["deleted", "inbox", "old", "sent"]);
    const fileable = fileableFolders(folders, known, {
      ...DEFAULT_EMAIL_FILING_SETTINGS,
      excludedFolderIds: ["other"],
    }).map((entry) => entry.id);
    expect(fileable).toEqual(["projects", "p1"]);
  });

  it("prefers the job folder under the chosen parent", () => {
    expect(folderForJob(folders, jobKeyOf("1234")!, "projects")?.id).toBe("p1");
    expect(folderForJob(folders, jobKeyOf("1234")!, null)?.id).toBe("other");
    expect(folderForJob(folders, jobKeyOf("9999")!, null)).toBeNull();
  });
});

describe("evidence and confidence", () => {
  const folders = [
    folder("p1", "1234 - Riverside School"),
    folder("p2", "1234.02 - Riverside Phase 2"),
    folder("p3", "5678 - Harbour Bridge"),
  ];
  const message = {
    id: "m1",
    conversationId: "c1",
    subject: "Harbour bridge drawings for 1234.02",
    fromAddress: "ann@client.com",
    text: "Harbour bridge drawings for 1234.02\nSee attached",
  };

  it("finds job, title, rule and conversation evidence", () => {
    const rules = learnRule([], { ...message, subject: message.subject }, "domain", {
      id: "p3",
      path: "5678 - Harbour Bridge",
    });
    const evidence = evidenceFor(message, folders, rules, new Map([["c1", new Set(["p1"])]]));
    const kinds = evidence.map((entry) => `${entry.folderId}:${entry.kind}`).sort();
    expect(kinds).toEqual([
      "p1:conversation",
      "p1:job_parent",
      "p2:job_exact",
      "p3:rule",
      "p3:title",
    ]);
  });

  it("caps confidence by the strength of server-found evidence", () => {
    const evidence = evidenceFor(message, folders, [], new Map());
    expect(confidenceCap(evidence, "p2")).toBe(100);
    expect(confidenceCap(evidence, "p1")).toBe(85);
    expect(confidenceCap(evidence, "p3")).toBe(85);
    expect(confidenceCap(evidence, "nowhere")).toBe(70);
    expect(confidenceCap(evidence, null)).toBe(70);
  });

  it("uses the stricter of company and personal thresholds", () => {
    const policy = { ...DEFAULT_EMAIL_FILING_POLICY, minConfidence: 80 };
    expect(filingThreshold(policy, { ...DEFAULT_EMAIL_FILING_SETTINGS, confidence: 60 })).toBe(80);
    expect(filingThreshold(policy, { ...DEFAULT_EMAIL_FILING_SETTINGS, confidence: 95 })).toBe(95);
  });

  it("files Sent Items only when the company allows it and the person opts in", () => {
    const on = { ...DEFAULT_EMAIL_FILING_SETTINGS, includeSentItems: true };
    const off = DEFAULT_EMAIL_FILING_SETTINGS;
    const policy = (sentItems: "off" | "optional" | "on") => ({
      ...DEFAULT_EMAIL_FILING_POLICY,
      sentItems,
    });
    expect(filingIncludesSentItems(policy("off"), on)).toBe(false);
    expect(filingIncludesSentItems(policy("optional"), on)).toBe(true);
    expect(filingIncludesSentItems(policy("optional"), off)).toBe(false);
    expect(filingIncludesSentItems(policy("on"), off)).toBe(true);
  });
});

describe("presentFilingBatch", () => {
  const item = (overrides: Partial<StoredFilingItem>): StoredFilingItem => ({
    id: "i1",
    messageId: "m1",
    conversationId: null,
    sourceFolderId: "inbox",
    source: "inbox",
    subject: "s",
    from: "a",
    fromAddress: null,
    receivedAt: null,
    hasAttachments: false,
    preview: "",
    webLink: null,
    target: { kind: "folder", folderId: "p1", path: "P1" },
    confidence: 92,
    reason: "",
    evidence: [],
    chosen: false,
    remember: "none",
    status: "proposed",
    error: null,
    filedFolderId: null,
    filedPath: null,
    movedMessageId: null,
    filedAt: null,
    ...overrides,
  });

  it("marks items ready only above the threshold, with a target, or chosen by the person", () => {
    const batch = presentFilingBatch(
      {
        id: "b1",
        threadId: "t1",
        expiresAt: new Date(),
        createdAt: new Date(),
        content: {
          threshold: 90,
          allowFolderCreation: true,
          items: [
            item({ id: "high" }),
            item({ id: "low", confidence: 70 }),
            item({ id: "chosen", confidence: 40, chosen: true }),
            item({ id: "none", target: null, confidence: 99 }),
            item({ id: "filed", status: "filed", movedMessageId: "x" }),
          ],
        },
      },
      null,
    );
    expect(batch.items.map((entry) => [entry.id, entry.ready, entry.canUndo])).toEqual([
      ["high", true, false],
      ["low", false, false],
      ["chosen", true, false],
      ["none", false, false],
      ["filed", false, true],
    ]);
  });
});

describe("tool selection", () => {
  const names = (options: {
    outlookFiling?: boolean;
    trigger?: string;
    groupId?: string;
    messagingChannelRun?: boolean;
  }) =>
    selectBuiltinToolsForRun({
      graphicalToolsAllowed: false,
      semanticMemoryEnabled: false,
      groupId: options.groupId ?? null,
      trigger: options.trigger ?? "user",
      messagingChannelRun: options.messagingChannelRun ?? false,
      outlookFiling: options.outlookFiling,
    })
      .map((tool) => tool.name)
      .filter((name) => name.startsWith("outlook_filing") || name === "outlook_propose_filing");

  it("offers filing tools only when filing is open for this run", () => {
    expect(names({})).toEqual([]);
    expect(names({ outlookFiling: true })).toEqual([
      "outlook_filing_candidates",
      "outlook_propose_filing",
    ]);
    expect(names({ outlookFiling: true, trigger: "routine" })).toHaveLength(2);
    expect(names({ outlookFiling: true, trigger: "tickets" })).toEqual([]);
  });

  it("withholds them from group and messaging-channel runs", () => {
    expect(names({ outlookFiling: true, groupId: "g1" })).toEqual([]);
    expect(names({ outlookFiling: true, messagingChannelRun: true })).toEqual([]);
  });
});
