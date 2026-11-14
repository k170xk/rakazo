// @vitest-environment jsdom
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { EmailFilingBatch, EmailFilingItem } from "@rakazo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getBatch, fileItems, skipItems, undoItems, retarget, listFolders, getSettings, remember } =
  vi.hoisted(() => ({
    getBatch: vi.fn(),
    fileItems: vi.fn(),
    skipItems: vi.fn(),
    undoItems: vi.fn(),
    retarget: vi.fn(),
    listFolders: vi.fn(),
    getSettings: vi.fn(),
    remember: vi.fn(),
  }));

const lingui = vi.hoisted(() => ({
  t: (parts: TemplateStringsArray, ...values: unknown[]) => String.raw({ raw: parts }, ...values),
  i18n: { date: () => "14 Nov 2026" },
}));

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => lingui,
  Trans: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../lib/rpc", () => ({
  rpc: {
    emailFiling: {
      get: getBatch,
      file: fileItems,
      skip: skipItems,
      undo: undoItems,
      retarget,
      searchProjects: vi.fn(async () => ({ projects: [] })),
      settings: { get: getSettings, remember, forgetMemory: vi.fn(), removeRule: vi.fn() },
    },
  },
}));

vi.mock("../lib/query", () => ({
  useSpaceQueries: () => ({
    emailFiling: {
      get: {
        queryOptions: ({ input }: { input: { id: string } }) => ({
          queryKey: ["emailFiling.get", input.id],
          queryFn: () => getBatch(input),
        }),
      },
      folders: {
        queryOptions: () => ({ queryKey: ["emailFiling.folders"], queryFn: () => listFolders() }),
      },
      settings: {
        get: {
          queryOptions: () => ({
            queryKey: ["emailFiling.settings"],
            queryFn: () => getSettings(),
          }),
        },
      },
    },
  }),
}));

import { EmailFilingCard, filingSender } from "./EmailFilingCard";

function item(id: string, patch: Partial<EmailFilingItem> = {}): EmailFilingItem {
  return {
    id,
    subject: `Subject ${id}`,
    from: "Ann <ann@client.com>",
    receivedAt: "2026-11-14T09:00:00.000Z",
    hasAttachments: false,
    preview: "",
    webLink: "https://outlook.office.com/mail/id/1",
    source: "inbox",
    target: { kind: "folder", folderId: "p1", path: "Inbox › Projects › 1234 - Riverside" },
    confidence: 95,
    reason: "Mentions job 1234",
    evidence: ["Mentions job 1234"],
    ready: true,
    status: "proposed",
    error: null,
    filedPath: null,
    canUndo: false,
    ...patch,
  };
}

function batch(items: EmailFilingItem[], patch: Partial<EmailFilingBatch> = {}): EmailFilingBatch {
  return {
    id: "batch-1",
    threadId: "thread-1",
    threshold: 90,
    allowFolderCreation: true,
    items,
    cannotFile: null,
    expiresAt: "2026-11-28T00:00:00.000Z",
    createdAt: "2026-11-14T00:00:00.000Z",
    ...patch,
  };
}

describe("filingSender", () => {
  it("keeps the address and the name together", () => {
    expect(filingSender("OCSC Careers <careers@evolve.ocsc.me>")).toEqual({
      address: "careers@evolve.ocsc.me",
      name: "OCSC Careers",
    });
    expect(filingSender("ada@example.com")).toEqual({ address: "ada@example.com", name: null });
  });
});

describe("EmailFilingCard", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let client: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    i18n.load("en", {});
    i18n.activate("en");
    for (const mock of [
      getBatch,
      fileItems,
      skipItems,
      undoItems,
      retarget,
      listFolders,
      getSettings,
      remember,
    ]) {
      mock.mockReset();
    }
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <I18nProvider i18n={i18n}>
            <EmailFilingCard batchId="batch-1" />
          </I18nProvider>
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const button = (text: string) =>
    [...host.querySelectorAll("button")].find((entry) => entry.textContent?.includes(text));

  it("starts with ready emails ticked and files only the ticked ones", async () => {
    getBatch.mockResolvedValueOnce(
      batch([item("a"), item("b"), item("c", { confidence: 60, ready: false, reason: "Unsure" })]),
    );
    fileItems.mockResolvedValueOnce(
      batch([
        item("a", {
          status: "filed",
          filedPath: "Inbox › Projects › 1234 - Riverside",
          canUndo: true,
          ready: false,
        }),
        item("b"),
        item("c", { confidence: 60, ready: false }),
      ]),
    );
    await render();

    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain(
      "Ready",
    );
    expect(host.querySelectorAll('[data-testid^="filing-item-"]')).toHaveLength(2);
    const ready = host.querySelector('[data-testid="filing-item-a"]');
    expect(ready?.textContent).toContain("ann@client.com");
    expect(ready?.textContent).toContain("Subject a");
    expect(ready?.textContent).toContain("Inbox › Projects");
    expect(ready?.textContent).toContain("1234 - Riverside");
    expect(button("File 2 selected")).toBeTruthy();

    const boxB = host.querySelector<HTMLInputElement>('input[aria-label="Select Subject b"]');
    await act(async () => boxB?.click());
    expect(button("File 1 selected")).toBeTruthy();

    await act(async () => button("File 1 selected")?.click());
    expect(fileItems).toHaveBeenCalledWith({ id: "batch-1", itemIds: ["a"] });
  });

  it("keeps unsure emails under Needs a decision, unticked", async () => {
    getBatch.mockResolvedValueOnce(
      batch([
        item("c", { confidence: 60, ready: false }),
        item("d", { target: null, ready: false }),
      ]),
    );
    await render();
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain(
      "Needs a decision",
    );
    expect(
      host.querySelector<HTMLInputElement>('input[aria-label="Select Subject c"]')?.checked,
    ).toBe(false);
    expect(
      host.querySelector<HTMLInputElement>('input[aria-label="Select Subject d"]')?.disabled,
    ).toBe(true);
    expect(host.textContent).toContain("60%");
    expect(button("Choose folder")).toBeTruthy();
  });

  it("disables filing and says why when the person cannot file", async () => {
    getBatch.mockResolvedValueOnce(
      batch([item("a")], { cannotFile: "Connect Outlook in Connectors to file these emails." }),
    );
    await render();
    expect(host.textContent).toContain("Connect Outlook in Connectors to file these emails.");
    expect(button("File 1 selected")?.disabled).toBe(true);
  });

  it("links only to Outlook https addresses", async () => {
    getBatch.mockResolvedValueOnce(
      batch([item("a"), item("b", { webLink: "javascript:alert(1)" })]),
    );
    await render();
    const links = [...host.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    expect(links).toEqual(["https://outlook.office.com/mail/id/1"]);
  });

  it("opens filing memory and saves an instruction", async () => {
    getBatch.mockResolvedValueOnce(batch([item("a")]));
    getSettings.mockResolvedValue({
      settings: {
        enabled: true,
        confidence: 90,
        parentFolderId: null,
        parentFolderPath: null,
        includeSentItems: false,
        excludedFolderIds: [],
        excludedSenders: [],
      },
      rules: [
        {
          id: "r1",
          kind: "sender",
          label: "careers@evolve.ocsc.me",
          folderId: "hr",
          folderPath: "Inbox › HR",
          createdAt: "2026-11-14T00:00:00.000Z",
        },
      ],
      memories: [],
      policy: {
        minConfidence: 90,
        allowFolderCreation: true,
        defaultParentFolder: "Projects",
        sentItems: "optional",
        maxPerBatch: 50,
        autonomy: "off",
      },
      outlookConnected: true,
    });
    remember.mockImplementation(async ({ text }: { text: string }) => ({
      ...(await getSettings()),
      memories: [{ id: "m1", text, createdAt: "2026-11-14T00:00:00.000Z" }],
    }));
    await render();
    await act(async () => button("Memory")?.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain("careers@evolve.ocsc.me → Inbox › HR");
    const field = host.querySelector<HTMLInputElement>(
      'input[aria-label="Add an instruction filing should follow"]',
    );
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setValue?.call(field, "Graduate applications go in HR");
      field?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Remember")?.click());
    expect(remember).toHaveBeenCalledWith({ text: "Graduate applications go in HR" });
    expect(host.textContent).toContain("Graduate applications go in HR");
  });
});
