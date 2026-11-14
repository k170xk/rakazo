import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type {
  Bot,
  EvolveConversationSummary,
  EvolveHistoryAssistant,
  Group,
  MessageBlock,
} from "@rakazo/contracts";
import {
  BotAvatar,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  GroupAvatar,
  toast,
} from "@rakazo/ui-web";
import { Archive, History, Loader2, MessagesSquare, X } from "lucide-react";
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

/**
 * Archived bots, groups and Evolve chats. Opened from the space actions menu so the
 * sidebar stays clear of the list.
 */
export function EvolveArchive({
  open,
  onOpenChange,
  rpc,
  archivedBots,
  archivedGroups,
  refreshBots,
  setDeleteTarget,
  setDeleteGroupTarget,
  onRestore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rpc: SpaceRpc;
  archivedBots: Bot[];
  archivedGroups: Group[];
  refreshBots: (includeArchived?: boolean) => Promise<void>;
  setDeleteTarget: (bot: Bot) => void;
  setDeleteGroupTarget: (group: Group) => void;
  /** Moves the Evolve chat into the chatbot list above. */
  onRestore: (conversationId: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const [looks, setLooks] = useState<Map<string, EvolveHistoryAssistant["look"]>>(new Map());
  const [items, setItems] = useState<EvolveConversationSummary[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        await refreshBots(true).catch(() => undefined);
        const result = await rpc.evolveHistory.assistants();
        if (!live) return;
        if (result.available) {
          setLooks(new Map(result.assistants.map((assistant) => [assistant.id, assistant.look])));
          const page = await rpc.evolveHistory.conversations({
            search: "",
            page: 0,
            archived: false,
          });
          if (!live) return;
          setItems(page.conversations);
          setNextPage(page.nextPage);
        } else {
          setItems([]);
          setNextPage(null);
        }
      } catch {
        if (live) {
          setItems([]);
          setNextPage(null);
        }
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [open, rpc, refreshBots]);

  const chats = items.filter((item) => item.continuedIn.length === 0);
  const empty = !loading && chats.length + archivedBots.length + archivedGroups.length === 0;

  function drop(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
    setConfirming(null);
  }

  async function restore(id: string) {
    setBusy(id);
    try {
      await onRestore(id);
      drop(id);
    } catch (failure) {
      toast.error(errorText(failure, t`Could not restore that chat.`));
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      await rpc.evolveHistory.remove({ conversationId: id });
      drop(id);
    } catch (failure) {
      toast.error(errorText(failure, t`Could not delete that chat.`));
    } finally {
      setBusy(null);
    }
  }

  async function loadMore() {
    if (nextPage === null) return;
    setLoadingMore(true);
    try {
      const page = await rpc.evolveHistory.conversations({
        search: "",
        page: nextPage,
        archived: false,
      });
      setItems((current) => [...current, ...page.conversations]);
      setNextPage(page.nextPage);
    } catch (failure) {
      toast.error(errorText(failure, t`Could not load your archived chats.`));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        data-testid="evolve-archive"
        className="flex max-h-[min(85dvh,640px)] w-[min(420px,calc(100vw-1.5rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <Archive className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <DialogTitle className="min-w-0 flex-1 truncate text-[15px] font-medium">
            {t`Archived`}
          </DialogTitle>
          <DialogClose
            aria-label={t`Close`}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" strokeWidth={1.8} />
          </DialogClose>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="grid place-items-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" aria-label={t`Loading`} />
            </div>
          ) : empty ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              {t`Nothing archived.`}
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {archivedBots.map((bot) => (
                <div key={bot.id} className="flex items-center gap-2 rounded-lg px-2.5 py-2">
                  <BotAvatar
                    avatarSet={bot.avatarSet}
                    color={bot.color}
                    identity={bot.id}
                    size={28}
                    status={bot.status}
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-[14px] text-foreground/75"
                    dir="auto"
                  >
                    {bot.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      void rpc.bots.restore({ botId: bot.id }).then(() => refreshBots(true))
                    }
                  >
                    {t`Restore`}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-destructive hover:text-destructive"
                    aria-label={t`Delete ${bot.name}`}
                    onClick={() => {
                      setDeleteTarget(bot);
                      onOpenChange(false);
                    }}
                  >
                    {t`Delete`}
                  </Button>
                </div>
              ))}
              {archivedGroups.map((group) => (
                <div key={group.id} className="flex items-center gap-2 rounded-lg px-2.5 py-2">
                  <GroupAvatar members={group.members} size={28} />
                  <span
                    className="min-w-0 flex-1 truncate text-[14px] text-foreground/75"
                    dir="auto"
                  >
                    {group.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      void rpc.groups.restore({ groupId: group.id }).then(() => refreshBots(true))
                    }
                  >
                    {t`Restore`}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-destructive hover:text-destructive"
                    aria-label={t`Delete ${group.name}`}
                    onClick={() => {
                      setDeleteGroupTarget(group);
                      onOpenChange(false);
                    }}
                  >
                    {t`Delete`}
                  </Button>
                </div>
              ))}
              {chats.map((item) => {
                const look = looks.get(item.assistantId);
                const working = busy === item.id;
                return (
                  <div key={item.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5">
                    {look ? (
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
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] text-foreground/85" dir="auto">
                        {item.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.assistantName} · {shortDate(item.lastMessageAt)}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={working}
                      onClick={() => void restore(item.id)}
                    >
                      {t`Restore`}
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-destructive hover:text-destructive"
                      disabled={working}
                      aria-label={t`Delete ${item.title}`}
                      onClick={() => {
                        if (confirming === item.id) void remove(item.id);
                        else setConfirming(item.id);
                      }}
                    >
                      {working ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : confirming === item.id ? (
                        t`Confirm`
                      ) : (
                        t`Delete`
                      )}
                    </Button>
                  </div>
                );
              })}
              {nextPage !== null ? (
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {loadingMore ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  {t`Load more`}
                </button>
              ) : null}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
