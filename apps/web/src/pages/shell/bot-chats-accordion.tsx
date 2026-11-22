import { i18n } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import type { BotChatSummary } from "@rakazo/contracts";
import { isRunWorking } from "@rakazo/core";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Spinner,
  toast,
} from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { Check, MessageSquare, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SpaceQueries } from "../../lib/query";
import { queryClient } from "../../lib/query";
import type { createSpaceRpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

export function BotChatsAccordion({
  rpc,
  queries,
  botId,
  botName,
  spaceId,
  isActiveBot,
  activeThreadId,
  creatingChat,
  onSelectChat,
  onCreateChat,
  onChatDeleted,
  onChatsMutated,
}: {
  rpc: ReturnType<typeof createSpaceRpc>;
  queries: SpaceQueries;
  botId: string;
  botName: string;
  spaceId: string;
  isActiveBot: boolean;
  activeThreadId: string | undefined;
  creatingChat: boolean;
  onSelectChat: (spaceId: string, botId: string, threadId?: string) => void;
  onCreateChat: (botId: string) => void;
  onChatDeleted: (botId: string, threadId: string) => void;
  onChatsMutated: (botId: string) => void;
}) {
  const { t } = useLingui();
  const { data, isLoading } = useQuery({
    ...queries.threads.listChats.queryOptions({ input: { botId } }),
    staleTime: 10_000,
  });
  const chats = data?.chats ?? [];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BotChatSummary | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editingId) return;
    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [editingId]);

  const startEditing = (chat: BotChatSummary) => {
    setEditingId(chat.id);
    setDraftTitle(chat.title);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setDraftTitle("");
  };

  const commitRename = async (chat: BotChatSummary) => {
    if (savingId === chat.id) return;
    const trimmed = draftTitle.trim();
    if (trimmed === chat.title) {
      cancelEditing();
      return;
    }
    setSavingId(chat.id);
    try {
      const { chat: updated } = await rpc.threads.renameChat({
        botId,
        threadId: chat.id,
        title: trimmed,
      });
      queryClient.setQueryData(
        queries.threads.listChats.queryKey({ input: { botId } }),
        (prev: { chats: BotChatSummary[] } | undefined) =>
          prev
            ? {
                chats: prev.chats.map((item) => (item.id === updated.id ? updated : item)),
              }
            : prev,
      );
      onChatsMutated(botId);
      cancelEditing();
    } catch (error) {
      toast.error(errorText(error, t`Could not rename chat`));
    } finally {
      setSavingId(null);
    }
  };

  const performDelete = async (chat: BotChatSummary) => {
    if (deletingId) return;
    setDeletingId(chat.id);
    try {
      await rpc.threads.deleteChat({ botId, threadId: chat.id });
      queryClient.setQueryData(
        queries.threads.listChats.queryKey({ input: { botId } }),
        (prev: { chats: BotChatSummary[] } | undefined) =>
          prev ? { chats: prev.chats.filter((item) => item.id !== chat.id) } : prev,
      );
      setDeleteTarget(null);
      onChatDeleted(botId, chat.id);
    } catch (error) {
      toast.error(errorText(error, t`Could not delete chat`));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div
      data-testid={`bot-chats-accordion-${botId}`}
      className="ms-[22px] mt-0.5 mb-1.5 flex flex-col gap-0.5 border-s border-sidebar-border/80 ps-2.5 pt-0.5"
    >
      <button
        type="button"
        disabled={creatingChat}
        data-testid={`bot-new-chat-${botId}`}
        onClick={() => onCreateChat(botId)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
      >
        {creatingChat ? (
          <Spinner className="size-3.5 shrink-0" aria-label={t`Creating chat`} />
        ) : (
          <Plus size={14} strokeWidth={2} className="shrink-0" aria-hidden="true" />
        )}
        <span className="truncate">{t`New chat`}</span>
      </button>

      {isLoading && chats.length === 0 ? (
        <div className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-muted-foreground">
          <Spinner className="size-3 shrink-0" aria-label={t`Loading chats`} />
          <span>{t`Loading chats…`}</span>
        </div>
      ) : (
        chats.map((chat) => {
          const isSelected =
            isActiveBot && (chat.isPrimary ? !activeThreadId : activeThreadId === chat.id);
          const working = isRunWorking(chat.status);
          const isEditing = editingId === chat.id;
          const displayTitle = chat.title || (chat.isPrimary ? t`Main chat` : t`New chat`);

          if (isEditing) {
            return (
              <form
                key={chat.id}
                onSubmit={(event) => {
                  event.preventDefault();
                  void commitRename(chat);
                }}
                className="flex items-center gap-1 rounded-lg bg-sidebar-accent px-1.5 py-1"
              >
                <input
                  ref={editInputRef}
                  type="text"
                  value={draftTitle}
                  maxLength={120}
                  disabled={savingId === chat.id}
                  placeholder={chat.isPrimary ? t`Main chat` : t`Chat title`}
                  aria-label={t`Chat title`}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancelEditing();
                    }
                  }}
                  onBlur={() => void commitRename(chat)}
                  className="min-w-0 flex-1 rounded bg-background px-1.5 py-0.5 text-[12.5px] text-foreground outline-none ring-1 ring-ring"
                />
                <button
                  type="submit"
                  disabled={savingId === chat.id}
                  aria-label={t`Save chat name`}
                  onMouseDown={(event) => event.preventDefault()}
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
                >
                  <Check size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={savingId === chat.id}
                  aria-label={t`Cancel rename`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={cancelEditing}
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </form>
            );
          }

          return (
            <div
              key={chat.id}
              data-bot-chat-id={chat.id}
              className={`group/chat relative flex items-center rounded-lg transition-colors ${
                isSelected ? "bg-sidebar-accent" : "hover:bg-accent"
              }`}
            >
              <button
                type="button"
                aria-current={isSelected ? "page" : undefined}
                onClick={() => onSelectChat(spaceId, botId, chat.isPrimary ? undefined : chat.id)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 pe-14 text-start"
              >
                {working ? (
                  <span
                    aria-label={t`Working`}
                    className="size-2 shrink-0 animate-pulse rounded-full bg-status-working"
                  />
                ) : (
                  <MessageSquare
                    size={13}
                    strokeWidth={1.8}
                    aria-hidden="true"
                    className={`shrink-0 ${
                      isSelected ? "text-foreground/80" : "text-muted-foreground/75"
                    }`}
                  />
                )}
                <span
                  dir="auto"
                  className={`min-w-0 flex-1 truncate text-[12.5px] ${
                    isSelected || chat.unread ? "font-medium text-foreground" : "text-foreground/80"
                  }`}
                >
                  {displayTitle}
                </span>
                {chat.isPrimary ? (
                  <span className="shrink-0 rounded bg-sidebar-border/70 px-1 py-px text-[9.5px] font-medium text-muted-foreground">
                    {t`Main`}
                  </span>
                ) : null}
              </button>

              <div className="pointer-events-none absolute end-1.5 flex items-center gap-1">
                {chat.unread ? (
                  <span
                    aria-label={t`Unread`}
                    className="size-1.5 rounded-full bg-unread group-hover/chat:hidden"
                  />
                ) : null}
                <span className="text-[10.5px] text-faint-foreground tabular-nums group-hover/chat:hidden group-focus-within/chat:hidden">
                  {formatShortChatTime(chat.updatedAt)}
                </span>
              </div>

              <div className="absolute end-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/chat:opacity-100 group-focus-within/chat:opacity-100 [@media(hover:none)]:opacity-100">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t`Rename ${displayTitle}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    startEditing(chat);
                  }}
                  className="size-6 rounded-md text-muted-foreground hover:bg-sidebar-border/60 hover:text-foreground"
                >
                  <Pencil size={12} aria-hidden="true" />
                </Button>
                {!chat.isPrimary ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={deletingId === chat.id}
                    aria-label={t`Delete ${displayTitle}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (chat.messageCount === 0) {
                        void performDelete(chat);
                      } else {
                        setDeleteTarget(chat);
                      }
                    }}
                    className="size-6 rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                  >
                    {deletingId === chat.id ? (
                      <Spinner className="size-3" aria-label={t`Deleting`} />
                    ) : (
                      <Trash2 size={12} aria-hidden="true" />
                    )}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })
      )}

      {deleteTarget ? (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open && !deletingId) setDeleteTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                <Trans>Delete chat?</Trans>
              </AlertDialogTitle>
              <AlertDialogDescription>
                <Trans>
                  This will permanently remove &ldquo;{deleteTarget.title || t`New chat`}&rdquo; and
                  its messages. {botName} and its other conversations will not be affected.
                </Trans>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={Boolean(deletingId)}>
                <Trans>Cancel</Trans>
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={Boolean(deletingId)}
                onClick={(event) => {
                  event.preventDefault();
                  void performDelete(deleteTarget);
                }}
              >
                {deletingId ? <Trans>Deleting…</Trans> : <Trans>Delete chat</Trans>}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}

function formatShortChatTime(isoDate?: string | null): string {
  if (!isoDate) return "";
  try {
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return "";
    const locale = i18n.locale || "en";
    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    if (isToday) {
      return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
    }
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 7) {
      return d.toLocaleDateString(locale, { weekday: "short" });
    }
    return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}
