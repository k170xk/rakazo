// @vitest-environment jsdom
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { EmailDraft } from "@rakazo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getDraft, updateDraft, createDraft, discardDraft, listFiles, setSignature } = vi.hoisted(
  () => ({
    getDraft: vi.fn(),
    updateDraft: vi.fn(),
    createDraft: vi.fn(),
    discardDraft: vi.fn(),
    listFiles: vi.fn(),
    setSignature: vi.fn(),
  }),
);

const lingui = vi.hoisted(() => ({
  t: (parts: TemplateStringsArray, ...values: unknown[]) => String.raw({ raw: parts }, ...values),
  i18n: {
    date: () => "14 Nov 2026, 14:30",
  },
}));

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => lingui,
  Trans: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../lib/rpc", () => ({
  rpc: {
    emailDrafts: {
      get: getDraft,
      update: updateDraft,
      createDraft,
      discard: discardDraft,
      files: listFiles,
      signature: { set: setSignature },
    },
  },
}));

vi.mock("../lib/query", () => ({
  useSpaceQueries: () => ({
    emailDrafts: {
      get: {
        queryOptions: ({ input }: { input: { id: string } }) => ({
          queryKey: ["emailDrafts.get", input.id],
          queryFn: () => getDraft(input),
        }),
      },
    },
  }),
}));

import { EmailDraftCard, outlookDraftAppLink, parseRecipientInput } from "./EmailDraftCard";

function sampleDraft(patch: Partial<EmailDraft> = {}): EmailDraft {
  return {
    id: "draft-1",
    threadId: "thread-1",
    mode: "new",
    status: "draft",
    version: 1,
    from: "keith@ocsc.ie",
    replyTo: null,
    to: ["client@example.com"],
    cc: [],
    bcc: [],
    subject: "Riverside drawings",
    bodyHtml: "<p>Hi Anne,</p><p>Please find the drawings attached.</p><p>Kind regards,</p>",
    signatureHtml: "<p>Keith Knox</p>",
    attachments: [],
    cannotSend: null,
    outlookWebLink: null,
    error: null,
    sentAt: null,
    createdAt: "2026-11-14T14:00:00.000Z",
    updatedAt: "2026-11-14T14:00:00.000Z",
    ...patch,
  };
}

describe("outlookDraftAppLink", () => {
  const id = "AAMkAGI2/draft=";

  it("opens the Outlook app on a phone", () => {
    expect(outlookDraftAppLink(id, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(
      "ms-outlook://emails/message/open?restID=AAMkAGI2%2Fdraft%3D",
    );
    expect(outlookDraftAppLink(id, "Mozilla/5.0 (Linux; Android 14)")).toContain("ms-outlook://");
  });

  it("uses the link the Outlook app claims on a computer", () => {
    expect(outlookDraftAppLink(id, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(
      "https://outlook.office.com/mail/0/applink/read/AAMkAGI2%2Fdraft%3D/?ai=1",
    );
    expect(outlookDraftAppLink("  ", "Mozilla/5.0")).toBeNull();
  });
});

describe("EmailDraftCard", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let client: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    i18n.load("en", {});
    i18n.activate("en");
    getDraft.mockReset();
    updateDraft.mockReset();
    createDraft.mockReset();
    discardDraft.mockReset();
    listFiles.mockReset();
    setSignature.mockReset();
    client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  async function renderCard(draftId = "draft-1", version?: number) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <I18nProvider i18n={i18n}>
            <EmailDraftCard draftId={draftId} version={version} />
          </I18nProvider>
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("populates the email body input field immediately when the draft loads", async () => {
    getDraft.mockResolvedValueOnce(sampleDraft());
    await renderCard();

    const bodyEditor = host.querySelector<HTMLDivElement>(
      '[role="textbox"][aria-label="Email body"]',
    );
    expect(bodyEditor).toBeTruthy();
    expect(bodyEditor!.innerHTML).toContain("Please find the drawings attached.");

    const subjectInput = host.querySelector<HTMLInputElement>('input[aria-label="Subject"]');
    expect(subjectInput?.value).toBe("Riverside drawings");

    const createButton = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Create draft"),
    );
    expect(createButton).toBeTruthy();
    expect(
      [...host.querySelectorAll("button")].some((button) => button.textContent === "Send"),
    ).toBe(false);
  });

  it("flushes uncommitted recipient text and edited body/subject when Create draft is clicked", async () => {
    const initial = sampleDraft({ to: [] });
    getDraft.mockResolvedValueOnce(initial);
    createDraft.mockImplementationOnce(async (payload) =>
      sampleDraft({
        version: 2,
        status: "created",
        to: payload.to,
        subject: payload.subject,
        bodyHtml: payload.bodyHtml,
        sentAt: "2026-11-14T14:30:00.000Z",
        outlookWebLink: "https://outlook.office.com/mail/drafts/id/m1",
      }),
    );

    await renderCard();

    // Type an address in To WITHOUT pressing Enter first.
    const toInput = host.querySelector<HTMLInputElement>('input[aria-label="To"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(toInput, "Anne Byrne <anne@ocsc.ie>");
      toInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Edit Subject.
    const subjectInput = host.querySelector<HTMLInputElement>('input[aria-label="Subject"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(subjectInput, "Updated Riverside drawings");
      subjectInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Edit Email body.
    const bodyEditor = host.querySelector<HTMLDivElement>(
      '[role="textbox"][aria-label="Email body"]',
    )!;
    await act(async () => {
      bodyEditor.innerHTML = "<p>Updated body text for Outlook Drafts.</p>";
      bodyEditor.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const createButton = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Create draft"),
    )!;
    expect(createButton.disabled).toBe(false);

    await act(async () => {
      createButton.click();
    });

    expect(createDraft).toHaveBeenCalledWith({
      id: "draft-1",
      version: 1,
      to: ["anne@ocsc.ie"],
      cc: [],
      bcc: [],
      subject: "Updated Riverside drawings",
      bodyHtml: "<p>Updated body text for Outlook Drafts.</p>",
      attachmentIds: [],
    });

    expect(host.textContent).toContain("Saved in Outlook Drafts");
    expect(host.textContent).toContain("Draft created in keith@ocsc.ie");
    expect(host.textContent).toContain(
      "Open your Outlook Drafts folder to review and send this email.",
    );
    const openLink = host.querySelector<HTMLAnchorElement>('a[href*="outlook.office.com"]');
    expect(openLink?.textContent).toContain("Open in Outlook");
  });

  it("lets the user paste and save their Outlook signature directly on the card", async () => {
    getDraft.mockResolvedValueOnce(sampleDraft({ signatureHtml: null }));
    setSignature.mockResolvedValueOnce({ html: "<p><strong>Keith Knox</strong> · OCSC</p>" });

    await renderCard();

    const pasteBtn = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Paste signature"),
    );
    expect(pasteBtn).toBeTruthy();

    await act(async () => {
      pasteBtn!.click();
    });

    const sigEditor = host.querySelector<HTMLDivElement>(
      '[role="textbox"][aria-label="Email signature"]',
    )!;
    expect(sigEditor).toBeTruthy();

    await act(async () => {
      sigEditor.innerHTML = "<p><strong>Keith Knox</strong> · OCSC</p>";
    });

    const saveSigBtn = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Save signature"),
    )!;
    await act(async () => {
      saveSigBtn.click();
    });

    expect(setSignature).toHaveBeenCalledWith({
      html: "<p><strong>Keith Knox</strong> · OCSC</p>",
    });
    expect(host.querySelector('iframe[title="Signature"]')).toBeTruthy();
  });

  it("updates the body and subject inputs when a newer draft version arrives", async () => {
    getDraft
      .mockResolvedValueOnce(sampleDraft({ version: 1, bodyHtml: "<p>First version</p>" }))
      .mockResolvedValueOnce(
        sampleDraft({
          version: 2,
          subject: "Second subject",
          bodyHtml: "<p>Second version from assistant</p>",
        }),
      );

    await renderCard("draft-1", 1);
    const bodyEditor = host.querySelector<HTMLDivElement>(
      '[role="textbox"][aria-label="Email body"]',
    )!;
    expect(bodyEditor.innerHTML).toBe("<p>First version</p>");

    await renderCard("draft-1", 2);
    expect(getDraft).toHaveBeenCalledTimes(2);
    expect(bodyEditor.innerHTML).toBe("<p>Second version from assistant</p>");
    const subjectInput = host.querySelector<HTMLInputElement>('input[aria-label="Subject"]')!;
    expect(subjectInput.value).toBe("Second subject");
  });
});

describe("parseRecipientInput", () => {
  it("parses display-name angle-bracket addresses and plain email lists", () => {
    expect(
      parseRecipientInput("Anne Byrne <Anne@OCSC.ie>, bob@ocsc.ie; invalid", ["existing@ocsc.ie"]),
    ).toEqual({
      added: ["anne@ocsc.ie", "bob@ocsc.ie"],
      invalid: ["invalid"],
    });
  });
});
