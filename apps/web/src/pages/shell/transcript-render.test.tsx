// @vitest-environment jsdom
import type { ThreadMessage } from "@rakazo/contracts";
import type { ReactNode } from "react";
import { act, useCallback, useMemo, useRef } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { rpc } from "../../lib/rpc";
import { Transcript } from "./transcript";

const messageRenders = vi.hoisted(() => new Map<string, number>());

vi.mock("./message-view", async () => {
  const { createElement, memo } = await import("react");
  return {
    MessageView: memo(function MessageView({ message }: { message: { id: string } }) {
      messageRenders.set(message.id, (messageRenders.get(message.id) ?? 0) + 1);
      return createElement("div", { "data-testid": `message-${message.id}` });
    }),
  };
});

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
  }),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  messageRenders.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  HTMLElement.prototype.scrollTo = () => undefined;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function message(id: string, text: string): ThreadMessage {
  return {
    id,
    threadId: "thread",
    seq: 1,
    role: "bot",
    createdAt: "2026-10-30T12:00:00.000Z",
    blocks: [{ kind: "text", text }],
  };
}

function Host({
  messages,
  olderCursor = null,
  loadingOlder = false,
  onLoadOlder,
}: {
  messages: ThreadMessage[];
  olderCursor?: number | null;
  loadingOlder?: boolean;
  onLoadOlder?: () => void | Promise<void>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const artifactTarget = useMemo(() => ({ botId: "bot" }), []);
  const none = useMemo(() => new Set<string>(), []);
  const reply = useCallback(() => undefined, []);
  const quote = useCallback(() => undefined, []);
  const peer = useCallback(() => undefined, []);
  const refresh = useCallback(async () => undefined, []);
  const answer = useCallback(async () => undefined, []);
  const react = useCallback(async () => undefined, []);
  return (
    <Transcript
      rpc={rpc}
      scrollRef={scrollRef}
      scrollRequest={null}
      onScrollRequestHandled={reply}
      followRequest={0}
      artifactTarget={artifactTarget}
      transcript={{
        messages,
        folded: new Map(),
        markerOf: new Map(),
        mergedInto: new Map(),
      }}
      showToolActivity={false}
      olderCursor={olderCursor}
      unreadAfterSeq={null}
      loadingOlder={loadingOlder}
      answerableAskIds={none}
      dismissableAskIds={none}
      running={false}
      workingBots={[]}
      onLoadOlder={onLoadOlder ?? reply}
      onOpenBot={reply}
      onAnswer={answer}
      onReply={reply}
      onMarkUnread={reply}
      onQuote={quote}
      onReact={react}
      onJumpToMessage={reply}
      onOpenPeerMessages={peer}
      peerBot={peer}
      onRefresh={refresh}
      onBotChanged={refresh}
      onAddRoutine={quote}
      voiceReady={false}
      speakingMessageId={null}
      onSpeak={reply}
      onOpenComputer={reply}
    />
  );
}

it.each([false, true])(
  "leaves an unchanged message unrendered when a later one updates (mentions: %s)",
  (withMentions) => {
    const kept = message("kept", "Earlier");
    const announcement: ThreadMessage = {
      ...message("announcement", ""),
      blocks: [{ kind: "child_bot", botId: "child", name: "Planner", status: "created" }],
    };
    const earlier = withMentions ? [announcement, kept] : [kept];
    const live = message("progress:run", "Draft");
    act(() => root.render(<Host messages={[...earlier, live]} />));
    expect(messageRenders.get("kept")).toBe(1);
    expect(messageRenders.get("progress:run")).toBe(1);

    act(() =>
      root.render(<Host messages={[...earlier, message("progress:run", "Draft continues")]} />),
    );
    expect(messageRenders.get("kept")).toBe(1);
    expect(messageRenders.get("progress:run")).toBe(2);
    if (withMentions) {
      expect(messageRenders.has("announcement")).toBe(false);
      const renamed: ThreadMessage = {
        ...announcement,
        blocks: [{ kind: "child_bot", botId: "child", name: "Writer", status: "created" }],
      };
      act(() => root.render(<Host messages={[renamed, kept, live]} />));
      expect(messageRenders.get("kept")).toBe(2);
    }
  },
);

it("redraws a page card's reply only when a newer card supersedes it", () => {
  const card = (id: string, version: number): ThreadMessage => ({
    ...message(id, ""),
    botId: "bot",
    blocks: [{ kind: "page", pageId: "page", version, title: "Plan" }],
  });
  const reply = { ...message("reply", "Here is the plan"), botId: "bot" };
  const earlier = [card("card", 1), reply];
  act(() => root.render(<Host messages={[...earlier, message("progress:run", "Draft")]} />));
  act(() =>
    root.render(<Host messages={[...earlier, message("progress:run", "Draft continues")]} />),
  );
  expect(messageRenders.has("card")).toBe(false);
  expect(messageRenders.get("reply")).toBe(1);

  act(() => root.render(<Host messages={[...earlier, card("card-2", 2)]} />));
  expect(messageRenders.get("reply")).toBe(2);
});

it("auto-loads earlier messages when scrolling up near the top and avoids retry loops on failure", async () => {
  const onLoadOlder = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(undefined);
  act(() =>
    root.render(
      <Host messages={[message("m1", "Hello")]} olderCursor={41} onLoadOlder={onLoadOlder} />,
    ),
  );
  const scroller = container.querySelector<HTMLDivElement>('[data-testid="transcript"]')!;
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 2_000 });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 600 });

  // Establish scroll position below the threshold, then scroll up into the top zone.
  scroller.scrollTop = 500;
  act(() => scroller.dispatchEvent(new Event("scroll")));
  expect(onLoadOlder).not.toHaveBeenCalled();

  scroller.scrollTop = 100;
  await act(async () => {
    scroller.dispatchEvent(new Event("scroll"));
    await Promise.resolve();
  });
  expect(onLoadOlder).toHaveBeenCalledTimes(1);

  // Another scroll event at the same failed cursor does not spam retries.
  scroller.scrollTop = 40;
  await act(async () => {
    scroller.dispatchEvent(new Event("scroll"));
    await Promise.resolve();
  });
  expect(onLoadOlder).toHaveBeenCalledTimes(1);

  // Clicking the fallback button manually clears the block and retries.
  const button = scroller.querySelector<HTMLButtonElement>('[aria-label="Load earlier messages"]')!;
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
  expect(onLoadOlder).toHaveBeenCalledTimes(2);
});
