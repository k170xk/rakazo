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
import { newClientId } from "@rakazo/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  toast,
} from "@rakazo/ui-web";
import { FileText, History, Loader2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconTooltip } from "../../components/IconTooltip";
import type { createSpaceRpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

type SpaceRpc = ReturnType<typeof createSpaceRpc>;

const ALL = "all";

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
 * Previous conversations from Evolve chat: the signed-in person's own history, read live from
 * Evolve. A conversation can be continued in a bot's chat, or its assistant added as a bot.
 */
export function EvolveHistoryDialog({
  rpc,
  bot,
  bots,
  assistants,
  open,
  onClose,
  onContinue,
  onAddBot,
}: {
  rpc: SpaceRpc;
  /** The chat the dialog was opened from. */
  bot: Bot;
  bots: readonly Bot[];
  assistants: EvolveHistoryAssistant[];
  open: boolean;
  onClose: () => void;
  onContinue: (botId: string, conversationId: string) => Promise<void>;
  onAddBot: (assistant: EvolveHistoryAssistant, conversationId: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const ownAssistant = assistants.find((assistant) => assistant.botId === bot.id);
  const [assistantId, setAssistantId] = useState<string>(ownAssistant?.id ?? ALL);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [list, setList] = useState<EvolveConversationSummary[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EvolveConversationMessages | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const openedId = detail?.conversation.id;

  // A conversation opens at its newest message, as a chat does.
  useEffect(() => {
    const element = transcriptRef.current;
    if (openedId && element) element.scrollTop = element.scrollHeight;
  }, [openedId]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  async function loadList(page: number) {
    const request = ++listRequest.current;
    setListLoading(true);
    setListError(null);
    try {
      const result = await rpc.evolveHistory.conversations({
        ...(assistantId === ALL ? {} : { assistantId }),
        search,
        page,
      });
      if (request !== listRequest.current) return;
      setList((current) =>
        page === 0 ? result.conversations : [...current, ...result.conversations],
      );
      setNextPage(result.nextPage);
    } catch (error) {
      if (request === listRequest.current) {
        setListError(errorText(error, t`Could not load your Evolve conversations.`));
      }
    } finally {
      if (request === listRequest.current) setListLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setList([]);
    void loadList(0);
  }, [open, assistantId, search]);

  async function openConversation(id: string) {
    const request = ++detailRequest.current;
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const result = await rpc.evolveHistory.messages({ conversationId: id });
      if (request === detailRequest.current) setDetail(result);
    } catch (error) {
      if (request === detailRequest.current) {
        toast.error(errorText(error, t`Could not open that conversation.`));
      }
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  }

  async function loadEarlier() {
    if (!detail?.before) return;
    const request = detailRequest.current;
    setDetailLoading(true);
    try {
      const older = await rpc.evolveHistory.messages({
        conversationId: detail.conversation.id,
        before: detail.before,
      });
      if (request !== detailRequest.current) return;
      setDetail((current) =>
        current
          ? { ...current, messages: [...older.messages, ...current.messages], before: older.before }
          : current,
      );
    } catch (error) {
      toast.error(errorText(error, t`Could not load earlier messages.`));
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  }

  async function act(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
      onClose();
    } catch (error) {
      toast.error(errorText(error, t`Could not continue that conversation.`));
    } finally {
      setBusy(false);
    }
  }

  const conversation = detail?.conversation;
  const conversationAssistant = conversation
    ? assistants.find((assistant) => assistant.id === conversation.assistantId)
    : undefined;
  const assistantBot = conversationAssistant?.botId
    ? bots.find((item) => item.id === conversationAssistant.botId)
    : undefined;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="flex h-[85vh] flex-col overflow-hidden sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{t`Previous conversations`}</DialogTitle>
          <DialogDescription>
            {t`Your chat history from Evolve. Open a conversation to read it, or continue it here.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col gap-3">
            <select
              aria-label={t`Assistant`}
              value={assistantId}
              onChange={(event) => setAssistantId(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value={ALL}>{t`All assistants`}</option>
              {assistants.map((assistant) => (
                <option key={assistant.id} value={assistant.id}>
                  {assistant.name} ({assistant.conversations})
                </option>
              ))}
            </select>
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={t`Search titles...`}
                className="ps-8"
              />
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pe-1">
              {list.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => void openConversation(item.id)}
                  data-active={selectedId === item.id ? "" : undefined}
                  className="w-full rounded-lg px-3 py-2 text-start hover:bg-muted data-active:bg-muted"
                >
                  <span className="block truncate text-sm font-medium" dir="auto">
                    {item.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.assistantName} · {shortDate(item.lastMessageAt)}
                    {item.files > 0 ? ` · ${filesLabel(item.files)}` : ""}
                  </span>
                </button>
              ))}
              {listLoading ? (
                <div className="flex justify-center py-3">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : null}
              {listError ? <p className="px-3 text-sm text-destructive">{listError}</p> : null}
              {!listLoading && !listError && list.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">
                  {t`No conversations found.`}
                </p>
              ) : null}
              {nextPage !== null && !listLoading ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => void loadList(nextPage)}
                >
                  {t`Load more`}
                </Button>
              ) : null}
            </div>
          </div>
          <div className="flex min-h-0 flex-col rounded-xl border border-border">
            {conversation ? (
              <>
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" dir="auto">
                      {conversation.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {conversation.assistantName} · {shortDate(conversation.lastMessageAt)}
                      {conversation.files.length > 0
                        ? ` · ${filesLabel(conversation.files.length)}`
                        : ""}
                    </p>
                  </div>
                  {assistantBot && assistantBot.id !== bot.id ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void act(() => onContinue(assistantBot.id, conversation.id))}
                    >
                      {t`Continue in ${assistantBot.name}`}
                    </Button>
                  ) : null}
                  {!assistantBot && conversationAssistant?.available ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void act(() => onAddBot(conversationAssistant, conversation.id))
                      }
                    >
                      {t`Add ${conversation.assistantName} as a bot`}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void act(() => onContinue(bot.id, conversation.id))}
                  >
                    {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                    {t`Continue here`}
                  </Button>
                </div>
                <div
                  ref={transcriptRef}
                  className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
                >
                  {detail?.before ? (
                    <div className="flex justify-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={detailLoading}
                        onClick={() => void loadEarlier()}
                      >
                        {t`Load earlier messages`}
                      </Button>
                    </div>
                  ) : null}
                  {detail?.messages.map((message) => (
                    <HistoryMessage key={message.id} message={message} />
                  ))}
                  {detail && detail.messages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t`This conversation is empty.`}</p>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="grid flex-1 place-items-center p-6 text-sm text-muted-foreground">
                {detailLoading ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  t`Choose a conversation to read it.`
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The header's history button; hidden unless Evolve is linked and the person has history. */
export function EvolveHistoryAction({
  rpc,
  bot,
  bots,
  onContinued,
  onAddBot,
}: {
  rpc: SpaceRpc;
  bot: Bot;
  bots: readonly Bot[];
  /** After a conversation is put into a bot's chat: show that chat. */
  onContinued: (botId: string) => Promise<void> | void;
  /** Creates a bot from an Evolve assistant and returns it. */
  onAddBot: (assistant: EvolveHistoryAssistant) => Promise<Bot>;
}) {
  const { t } = useLingui();
  const [assistants, setAssistants] = useState<EvolveHistoryAssistant[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    rpc.evolveHistory.assistants().then(
      (result) => live && setAssistants(result.available ? result.assistants : []),
      () => live && setAssistants([]),
    );
    return () => {
      live = false;
    };
  }, [rpc, bots.length]);
  if (!assistants?.length) return null;

  async function continueIn(botId: string, conversationId: string) {
    await rpc.threads.continueEvolveConversation({
      botId,
      conversationId,
      clientNonce: newClientId(),
    });
    await onContinued(botId);
    toast.success(t`Conversation added to the chat.`);
  }

  return (
    <>
      <IconTooltip label={t`Previous conversations`}>
        <Button
          variant="floating"
          size="icon-lg"
          aria-label={t`Previous conversations`}
          onClick={() => setOpen(true)}
          className="app-no-drag"
        >
          <History strokeWidth={1.6} className="size-[17px]" />
        </Button>
      </IconTooltip>
      {open ? (
        <EvolveHistoryDialog
          rpc={rpc}
          bot={bot}
          bots={bots}
          assistants={assistants}
          open={open}
          onClose={() => setOpen(false)}
          onContinue={continueIn}
          onAddBot={async (assistant, conversationId) => {
            const created = await onAddBot(assistant);
            await continueIn(created.id, conversationId);
          }}
        />
      ) : null}
    </>
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
