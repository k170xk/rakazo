import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type {
  Bot,
  EvolveConversationSummary,
  EvolveHistoryAssistant,
  MessageBlock,
} from "@rakazo/contracts";
import {
  BotAvatar,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  toast,
} from "@rakazo/ui-web";
import { Archive, Check, ChevronDown, History, Loader2, MessagesSquare } from "lucide-react";
import { useEffect, useState } from "react";
import type { createSpaceRpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

type SpaceRpc = ReturnType<typeof createSpaceRpc>;

function shortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function filesLabel(count: number): string {
  return plural(count, { one: "# file", other: "# files" });
}

function ContinuedBadge() {
  const { t } = useLingui();
  return (
    <span
      title={t`Opened as a chat`}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-medium text-primary"
    >
      <Check className="size-3" />
      {t`Opened`}
    </span>
  );
}

const ARCHIVE_OPEN_KEY = "rakazo.sidebar.evolveArchive.open";
const ARCHIVE_RECENT = 6;

/**
 * The sidebar's Evolve section: the person's Evolve conversations and how many they have carried
 * over. Hidden unless Evolve is linked and they have history.
 */
export function EvolveArchive({
  rpc,
  bots,
  hidden,
  reloadKey,
  onOpenConversation,
  onOpenBot,
}: {
  rpc: SpaceRpc;
  bots: readonly Bot[];
  hidden: boolean;
  /** Changes after a conversation is continued, to refresh what was carried over. */
  reloadKey: number;
  /** Opens the archived chat as a chat of its own, making it on first open. */
  onOpenConversation: (conversationId: string) => Promise<void>;
  onOpenBot: (botId: string) => void;
}) {
  const { t } = useLingui();
  const [opening, setOpening] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [continued, setContinued] = useState(0);
  const [looks, setLooks] = useState<Map<string, EvolveHistoryAssistant["look"]>>(new Map());
  const [items, setItems] = useState<EvolveConversationSummary[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState(() => localStorage.getItem(ARCHIVE_OPEN_KEY) !== "0");

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const result = await rpc.evolveHistory.assistants();
        if (!live || !result.available) return;
        const count = result.assistants.reduce((sum, item) => sum + item.conversations, 0);
        setTotal(count);
        setContinued(result.continued);
        setLooks(new Map(result.assistants.map((assistant) => [assistant.id, assistant.look])));
        if (count === 0) return;
        const page = await rpc.evolveHistory.conversations({ search: "", page: 0 });
        if (!live) return;
        setItems(page.conversations);
        setNextPage(page.nextPage);
      } catch {
        // Evolve unreachable: the section stays hidden.
      }
    })();
    return () => {
      live = false;
    };
  }, [rpc, bots.length, reloadKey]);

  if (total === 0 || items.length === 0) return null;

  async function loadMore() {
    if (nextPage === null) return;
    setLoadingMore(true);
    try {
      const page = await rpc.evolveHistory.conversations({ search: "", page: nextPage });
      setItems((current) => [...current, ...page.conversations]);
      setNextPage(page.nextPage);
    } catch (failure) {
      toast.error(errorText(failure, t`Could not load your archived chats.`));
    } finally {
      setLoadingMore(false);
    }
  }

  const shown = showAll ? items : items.slice(0, ARCHIVE_RECENT);
  const more = showAll ? nextPage !== null : items.length > ARCHIVE_RECENT || nextPage !== null;

  return (
    <Collapsible
      open={expanded}
      onOpenChange={(next) => {
        setExpanded(next);
        localStorage.setItem(ARCHIVE_OPEN_KEY, next ? "1" : "0");
      }}
      className={hidden ? "hidden" : "mt-2 border-t border-border pt-2"}
      data-testid="evolve-archive"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13.5px] text-muted-foreground hover:bg-sidebar-accent">
        <Archive className="size-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 text-start">{t`Archived chats`}</span>
        <span className="text-xs">
          {continued > 0 ? t`${continued} of ${total} opened` : total}
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-0.5">
        {shown.map((item) => {
          const chat = item.continuedIn
            .map((id) => bots.find((bot) => bot.id === id))
            .find((bot): bot is Bot => Boolean(bot));
          const look = chat
            ? { color: chat.color, avatarSet: chat.avatarSet, identity: chat.id }
            : looks.get(item.assistantId);
          return (
            <button
              type="button"
              key={item.id}
              disabled={opening !== null}
              onClick={() => {
                if (chat) return onOpenBot(chat.id);
                setOpening(item.id);
                onOpenConversation(item.id)
                  .catch((failure) => toast.error(errorText(failure, t`Could not open that chat.`)))
                  .finally(() => setOpening(null));
              }}
              title={chat ? t`Opened as ${chat.name}` : undefined}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-start hover:bg-sidebar-accent disabled:cursor-default"
            >
              {opening === item.id ? (
                <span className="flex size-6 shrink-0 items-center justify-center">
                  <Loader2
                    className="size-4 animate-spin text-muted-foreground"
                    aria-hidden="true"
                  />
                </span>
              ) : look ? (
                <span className="shrink-0" aria-hidden="true">
                  <BotAvatar
                    avatarSet={look.avatarSet}
                    color={look.color}
                    identity={look.identity}
                    size={24}
                  />
                </span>
              ) : (
                <MessagesSquare
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span
                    className="min-w-0 flex-1 truncate text-[13.5px] text-foreground/85"
                    dir="auto"
                  >
                    {item.title}
                  </span>
                  {chat ? <ContinuedBadge /> : null}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {item.assistantName} · {shortDate(item.lastMessageAt)}
                </span>
              </span>
            </button>
          );
        })}
        {more ? (
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => (showAll ? void loadMore() : setShowAll(true))}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-[13px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            {loadingMore ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {showAll ? t`Load more` : t`Show all ${total}`}
          </button>
        ) : showAll && items.length > ARCHIVE_RECENT ? (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="rounded-lg px-2.5 py-1.5 text-start text-[13px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            {t`Show fewer`}
          </button>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A continued Evolve conversation in the chat: what was carried over, transcript on demand. */
export function EvolveConversationCard({
  block,
}: {
  block: Extract<MessageBlock, { kind: "evolve_conversation" }>;
}) {
  return (
    <details className="w-80 max-w-full rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <History className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium" dir="auto">
            {block.title}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {block.assistantName} · {shortDate(block.lastMessageAt)} ·{" "}
            {plural(block.messageCount, { one: "# message", other: "# messages" })}
            {block.files.length > 0 ? ` · ${filesLabel(block.files.length)}` : ""}
          </span>
        </span>
      </summary>
      <pre className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap font-sans text-xs text-muted-foreground">
        {block.transcript}
      </pre>
    </details>
  );
}
