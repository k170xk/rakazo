import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import type {
  Bot,
  EvolveConversationMessages,
  EvolveConversationSummary,
  EvolveHistoryAssistant,
  EvolveHistoryMessage,
  MessageBlock,
} from "@rakazo/contracts";
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, toast } from "@rakazo/ui-web";
import {
  Archive,
  Check,
  ChevronDown,
  FileText,
  History,
  Loader2,
  Menu,
  MessagesSquare,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

/** A message that only added references: its first line, with the stored details on request. */
function ReferenceContext({ content }: { content: string }) {
  const { t } = useLingui();
  const [heading, ...rest] = content.trim().split("\n");
  const details = rest.join("\n").trim();
  return (
    <div className="space-y-1">
      <p dir="auto">{heading}</p>
      {details ? (
        <details>
          <summary className="cursor-pointer text-xs opacity-80">{t`Show details`}</summary>
          <p className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap text-xs" dir="auto">
            {details}
          </p>
        </details>
      ) : null}
    </div>
  );
}

function HistoryMessage({ message }: { message: EvolveHistoryMessage }) {
  const { t } = useLingui();
  const mine = message.role === "user";
  const { projects, people, exemplars } = message.references;
  const references = [
    ...projects.map((p) => p.name),
    ...people.map((p) => (p.role ? `${p.name} (${p.role})` : p.name)),
    ...exemplars.map((e) => e.title),
  ];
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] space-y-2 rounded-2xl px-3.5 py-2 text-[14px] ${
          mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        }`}
      >
        {message.type === "references" && message.content.trim() ? (
          <ReferenceContext content={message.content} />
        ) : message.content.trim() ? (
          mine ? (
            <p className="whitespace-pre-wrap" dir="auto">
              {message.content}
            </p>
          ) : (
            <ChatMarkdown>{message.content}</ChatMarkdown>
          )
        ) : message.unsaved ? (
          <p className="italic text-muted-foreground">{t`No reply was saved in Evolve.`}</p>
        ) : null}
        {message.images.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {message.images.map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer">
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  className="max-h-48 rounded-lg border border-border object-contain"
                />
              </a>
            ))}
          </div>
        ) : null}
        {message.files.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {message.files.map((file) => (
              <span
                key={file.name}
                className="inline-flex items-center gap-1 rounded-md bg-background/70 px-2 py-0.5 text-xs text-foreground"
              >
                <FileText className="size-3" />
                {file.name}
              </span>
            ))}
          </div>
        ) : null}
        {references.length > 0 ? (
          <p className="text-xs opacity-80">
            {t`References:`} {references.join(", ")}
          </p>
        ) : null}
        <p className="text-[11px] opacity-60">{shortDate(message.createdAt)}</p>
      </div>
    </div>
  );
}

/**
 * An Evolve conversation opened in the chat area: read live from Evolve and read-only until the
 * person continues it in one of their bots' chats, or opens the chat it was continued in.
 */
export function EvolveConversationView({
  rpc,
  conversationId,
  bots,
  activeBot,
  onClose,
  onOpenNavigation,
  onOpenBot,
  onContinue,
  onAddBot,
}: {
  rpc: SpaceRpc;
  conversationId: string;
  bots: readonly Bot[];
  /** The chat that was showing, offered as another place to continue. */
  activeBot?: Bot;
  onClose: () => void;
  onOpenNavigation: () => void;
  onOpenBot: (botId: string) => void;
  onContinue: (botId: string, conversationId: string) => Promise<void>;
  /** Creates a bot from an Evolve assistant and returns it. */
  onAddBot: (assistant: EvolveHistoryAssistant) => Promise<Bot>;
}) {
  const { t } = useLingui();
  const [detail, setDetail] = useState<EvolveConversationMessages | null>(null);
  const [assistants, setAssistants] = useState<EvolveHistoryAssistant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const openedId = detail?.conversation.id;

  useEffect(() => {
    let live = true;
    setDetail(null);
    setError(null);
    Promise.all([
      rpc.evolveHistory.messages({ conversationId }),
      rpc.evolveHistory.assistants(),
    ]).then(
      ([messages, list]) => {
        if (!live) return;
        setDetail(messages);
        setAssistants(list.assistants);
      },
      (failure) => live && setError(errorText(failure, t`Could not open that conversation.`)),
    );
    return () => {
      live = false;
    };
  }, [rpc, conversationId]);

  // A conversation opens at its newest message, as a chat does.
  useEffect(() => {
    const element = scrollRef.current;
    if (openedId && element) element.scrollTop = element.scrollHeight;
  }, [openedId]);

  async function loadEarlier() {
    if (!detail?.before) return;
    const element = scrollRef.current;
    const fromBottom = element ? element.scrollHeight - element.scrollTop : 0;
    setLoadingOlder(true);
    try {
      const older = await rpc.evolveHistory.messages({
        conversationId: detail.conversation.id,
        before: detail.before,
      });
      setDetail((current) =>
        current && current.conversation.id === older.conversation.id
          ? { ...current, messages: [...older.messages, ...current.messages], before: older.before }
          : current,
      );
      requestAnimationFrame(() => {
        if (element) element.scrollTop = element.scrollHeight - fromBottom;
      });
    } catch (failure) {
      toast.error(errorText(failure, t`Could not load earlier messages.`));
    } finally {
      setLoadingOlder(false);
    }
  }

  async function act(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } catch (failure) {
      toast.error(errorText(failure, t`Could not continue that conversation.`));
    } finally {
      setBusy(false);
    }
  }

  const conversation = detail?.conversation;
  const assistant = conversation
    ? assistants.find((item) => item.id === conversation.assistantId)
    : undefined;
  const assistantBot = assistant?.botId
    ? bots.find((item) => item.id === assistant.botId)
    : undefined;
  const openTarget = (conversation?.continuedIn ?? [])
    .map((id) => bots.find((item) => item.id === id))
    .find((item): item is Bot => Boolean(item));
  const otherChat =
    activeBot && activeBot.id !== openTarget?.id && activeBot.id !== assistantBot?.id
      ? activeBot
      : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="evolve-conversation">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={t`Open navigation`}
          onClick={onOpenNavigation}
        >
          <Menu className="size-4" />
        </Button>
        <Archive className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" dir="auto">
            {conversation?.title ?? t`Evolve conversation`}
          </p>
          {conversation ? (
            <p className="truncate text-xs text-muted-foreground">
              {t`From Evolve`} · {conversation.assistantName} ·{" "}
              {shortDate(conversation.lastMessageAt)}
              {conversation.files.length > 0 ? ` · ${filesLabel(conversation.files.length)}` : ""}
            </p>
          ) : null}
        </div>
        <Button variant="ghost" size="icon" aria-label={t`Close`} onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      <div ref={scrollRef} className="rk-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-6">
          {detail?.before ? (
            <div className="flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                disabled={loadingOlder}
                onClick={() => void loadEarlier()}
              >
                {loadingOlder ? <Loader2 className="size-4 animate-spin" /> : null}
                {t`Load earlier messages`}
              </Button>
            </div>
          ) : null}
          {detail?.messages.map((message) => (
            <HistoryMessage key={message.id} message={message} />
          ))}
          {detail && detail.messages.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">
              {t`This conversation is empty.`}
            </p>
          ) : null}
          {!detail && !error ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : null}
          {error ? <p className="text-center text-sm text-destructive">{error}</p> : null}
        </div>
      </div>
      {conversation ? (
        <div className="px-4 pb-4">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2.5 rounded-2xl border border-border bg-card px-4 py-3">
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              {openTarget
                ? t`You already carried this conversation over. Pick it up in its chat.`
                : t`Read only, from Evolve. Continue it here to keep chatting; its files come with it.`}
            </p>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              {otherChat ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void act(() => onContinue(otherChat.id, conversation.id))}
                >
                  {t`Continue in ${otherChat.name}`}
                </Button>
              ) : null}
              {openTarget ? (
                <Button size="sm" onClick={() => onOpenBot(openTarget.id)}>
                  {t`Open in ${openTarget.name}`}
                </Button>
              ) : assistantBot ? (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void act(() => onContinue(assistantBot.id, conversation.id))}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  {t`Continue in ${assistantBot.name}`}
                </Button>
              ) : assistant?.available ? (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const created = await onAddBot(assistant);
                      await onContinue(created.id, conversation.id);
                    })
                  }
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  {t`Continue as a new ${conversation.assistantName} chat`}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ContinuedBadge() {
  const { t } = useLingui();
  return (
    <span
      title={t`Continued in a chat here`}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-medium text-primary"
    >
      <Check className="size-3" />
      {t`Continued`}
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
  activeConversationId,
  reloadKey,
  onOpenConversation,
  onOpenBot,
}: {
  rpc: SpaceRpc;
  bots: readonly Bot[];
  hidden: boolean;
  /** The Evolve conversation showing in the chat area, if any. */
  activeConversationId: string | null;
  /** Changes after a conversation is continued, to refresh what was carried over. */
  reloadKey: number;
  onOpenConversation: (conversationId: string) => void;
  onOpenBot: (botId: string) => void;
}) {
  const { t } = useLingui();
  const [total, setTotal] = useState(0);
  const [continued, setContinued] = useState(0);
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
      toast.error(errorText(failure, t`Could not load your Evolve conversations.`));
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
        <span className="flex-1 text-start">{t`From Evolve`}</span>
        <span className="text-xs">
          {continued > 0 ? t`${continued} of ${total} continued` : total}
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
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => (chat ? onOpenBot(chat.id) : onOpenConversation(item.id))}
              data-active={activeConversationId === item.id ? "" : undefined}
              title={chat ? t`Continued in ${chat.name}` : undefined}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-start hover:bg-sidebar-accent data-active:bg-sidebar-accent"
            >
              <MessagesSquare
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
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
