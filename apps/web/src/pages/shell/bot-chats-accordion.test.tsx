// @vitest-environment jsdom

import type { BotChatSummary } from "@rakazo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@rakazo/ui-web", () => {
  const Plain = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    AlertDialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? <div role="alertdialog">{children}</div> : null,
    AlertDialogContent: Plain,
    AlertDialogHeader: Plain,
    AlertDialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    AlertDialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    AlertDialogFooter: Plain,
    AlertDialogCancel: ({ children, ...props }: ComponentProps<"button">) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    AlertDialogAction: ({
      variant: _v,
      children,
      ...props
    }: ComponentProps<"button"> & { variant?: string }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Button: ({
      variant: _v,
      size: _s,
      ...props
    }: ComponentProps<"button"> & Record<string, unknown>) => <button type="button" {...props} />,
    Spinner: () => <span data-testid="spinner" />,
    toast: { error: vi.fn() },
  };
});

import type { SpaceQueries } from "../../lib/query";
import { queryClient } from "../../lib/query";
import type { createSpaceRpc } from "../../lib/rpc";
import { BotChatsAccordion } from "./bot-chats-accordion";

let container: HTMLDivElement;
let root: Root;
let localClient: QueryClient;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  localClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localClient.clear();
  queryClient.clear();
  vi.unstubAllGlobals();
});

const primaryChat: BotChatSummary = {
  id: "thread-main",
  botId: "bot-1",
  title: "",
  isPrimary: true,
  preview: "Main chat preview",
  unread: false,
  status: "idle",
  runErrorId: null,
  messageCount: 12,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-11-20T10:00:00.000Z",
};

const blankExtraChat: BotChatSummary = {
  id: "thread-blank",
  botId: "bot-1",
  title: "",
  isPrimary: false,
  preview: "",
  unread: false,
  status: "idle",
  runErrorId: null,
  messageCount: 0,
  createdAt: "2026-11-22T09:00:00.000Z",
  updatedAt: "2026-11-22T09:00:00.000Z",
};

const populatedExtraChat: BotChatSummary = {
  id: "thread-topic",
  botId: "bot-1",
  title: "Structural Tender Review",
  isPrimary: false,
  preview: "Checked Eurocode 2 compliance",
  unread: true,
  status: "idle",
  runErrorId: null,
  messageCount: 4,
  createdAt: "2026-11-21T09:00:00.000Z",
  updatedAt: "2026-11-21T15:00:00.000Z",
};

function makeFixture(chats: BotChatSummary[]) {
  const deleteChat = vi.fn(async () => ({ ok: true as const }));
  const renameChat = vi.fn(async ({ threadId, title }: { threadId: string; title: string }) => ({
    chat: {
      ...(chats.find((c) => c.id === threadId) ?? primaryChat),
      title,
    },
  }));
  const rpc = {
    threads: { deleteChat, renameChat },
  } as unknown as ReturnType<typeof createSpaceRpc>;
  const queries = {
    threads: {
      listChats: {
        queryKey: ({ input }: { input: { botId: string } }) => ["threads.listChats", input.botId],
        queryOptions: ({ input }: { input: { botId: string } }) => ({
          queryKey: ["threads.listChats", input.botId],
          queryFn: async () => ({ chats }),
        }),
      },
    },
  } as unknown as SpaceQueries;
  return { rpc, queries, deleteChat, renameChat };
}

it("renders Main chat without a delete button, lets users create, switch, and delete blank chats immediately", async () => {
  const { rpc, queries, deleteChat } = makeFixture([
    primaryChat,
    blankExtraChat,
    populatedExtraChat,
  ]);
  const onSelectChat = vi.fn();
  const onCreateChat = vi.fn();
  const onChatDeleted = vi.fn();
  const onChatsMutated = vi.fn();

  await act(async () => {
    root.render(
      <QueryClientProvider client={localClient}>
        <BotChatsAccordion
          rpc={rpc}
          queries={queries}
          botId="bot-1"
          botName="Document Reviewer"
          spaceId="space-1"
          isActiveBot
          activeThreadId="thread-topic"
          creatingChat={false}
          onSelectChat={onSelectChat}
          onCreateChat={onCreateChat}
          onChatDeleted={onChatDeleted}
          onChatsMutated={onChatsMutated}
        />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  // + New chat button works
  const newChatBtn = container.querySelector('[data-testid="bot-new-chat-bot-1"]') as HTMLButtonElement;
  expect(newChatBtn).not.toBeNull();
  act(() => newChatBtn.click());
  expect(onCreateChat).toHaveBeenCalledWith("bot-1");

  // Primary row has NO delete button, only rename
  const mainRow = container.querySelector('[data-bot-chat-id="thread-main"]')!;
  expect(mainRow.textContent).toContain("Main chat");
  expect(mainRow.textContent).toContain("Main");
  expect(mainRow.querySelector('button[aria-label^="Delete"]')).toBeNull();
  expect(mainRow.querySelector('button[aria-label^="Rename"]')).not.toBeNull();

  // Clicking Main row selects primary (threadId = undefined)
  const mainSelectBtn = mainRow.querySelector("button")!;
  act(() => mainSelectBtn.click());
  expect(onSelectChat).toHaveBeenCalledWith("space-1", "bot-1", undefined);

  // Blank extra chat deletes immediately without confirmation modal
  const blankRow = container.querySelector('[data-bot-chat-id="thread-blank"]')!;
  const blankDeleteBtn = blankRow.querySelector('button[aria-label^="Delete"]') as HTMLButtonElement;
  await act(async () => blankDeleteBtn.click());
  expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  expect(deleteChat).toHaveBeenCalledWith({ botId: "bot-1", threadId: "thread-blank" });
  expect(onChatDeleted).toHaveBeenCalledWith("bot-1", "thread-blank");

  // Populated extra chat opens confirmation dialog before deleting
  const topicRow = container.querySelector('[data-bot-chat-id="thread-topic"]')!;
  const topicDeleteBtn = topicRow.querySelector('button[aria-label^="Delete"]') as HTMLButtonElement;
  act(() => topicDeleteBtn.click());
  const dialog = container.querySelector('[role="alertdialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog?.textContent).toContain("Structural Tender Review");
  expect(deleteChat).toHaveBeenCalledTimes(1);

  // Confirming the dialog deletes the populated chat
  const confirmBtn = [...dialog!.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Delete chat"),
  ) as HTMLButtonElement;
  await act(async () => confirmBtn.click());
  expect(deleteChat).toHaveBeenCalledWith({ botId: "bot-1", threadId: "thread-topic" });
  expect(onChatDeleted).toHaveBeenCalledWith("bot-1", "thread-topic");
});

it("supports inline renaming a chat and saving via form submit", async () => {
  const { rpc, queries, renameChat } = makeFixture([primaryChat, populatedExtraChat]);
  const onChatsMutated = vi.fn();

  await act(async () => {
    root.render(
      <QueryClientProvider client={localClient}>
        <BotChatsAccordion
          rpc={rpc}
          queries={queries}
          botId="bot-1"
          botName="Document Reviewer"
          spaceId="space-1"
          isActiveBot
          activeThreadId="thread-topic"
          creatingChat={false}
          onSelectChat={vi.fn()}
          onCreateChat={vi.fn()}
          onChatDeleted={vi.fn()}
          onChatsMutated={onChatsMutated}
        />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const topicRow = container.querySelector('[data-bot-chat-id="thread-topic"]')!;
  const renameBtn = topicRow.querySelector('button[aria-label^="Rename"]') as HTMLButtonElement;
  act(() => renameBtn.click());

  const input = container.querySelector('input[aria-label="Chat title"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  expect(input.value).toBe("Structural Tender Review");

  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    valueSetter?.call(input, "Bridge Design Check");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const form = input.closest("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  expect(renameChat).toHaveBeenCalledWith({
    botId: "bot-1",
    threadId: "thread-topic",
    title: "Bridge Design Check",
  });
  expect(onChatsMutated).toHaveBeenCalledWith("bot-1");
});
