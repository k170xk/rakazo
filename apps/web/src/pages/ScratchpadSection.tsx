import { Trans, useLingui } from "@lingui/react/macro";
import type { ScratchpadItem } from "@rakazo/contracts";
import { fetchFresh, writeSaved } from "@rakazo/core/query";
import {
  Button,
  Checkbox,
  Input,
  NativeSelect,
  NativeSelectOption,
  SectionHeading,
  Textarea,
  toast,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Pencil, Plus, X } from "lucide-react";
import { useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { useSpaceRpc } from "../lib/space-rpc";

const NO_ITEMS: ScratchpadItem[] = [];

export type ScratchpadMoveTarget = { id: string; name: string };

export function ScratchpadSection({
  botId,
  bots,
  alwaysVisible = false,
}: {
  botId: string;
  bots?: readonly ScratchpadMoveTarget[];
  alwaysVisible?: boolean;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const list = queries.scratchpad.list.queryOptions({ input: { botId } });
  // The bot edits its open work as it runs, so every open refreshes behind the cached list.
  const items = useQuery({ ...list, refetchOnMount: "always" }).data ?? NO_ITEMS;
  const moveTargets = (bots ?? []).filter((candidate) => candidate.id !== botId);
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveTargetId, setMoveTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setItems(update: (current: ScratchpadItem[]) => ScratchpadItem[]) {
    return writeSaved(queryClient, list.queryKey, (current) => update(current ?? []));
  }

  async function refresh() {
    await fetchFresh(queryClient, list);
  }

  function startEdit(item: ScratchpadItem) {
    setMovingId(null);
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditNotes(item.notes);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditTitle("");
    setEditNotes("");
  }

  function startMove(item: ScratchpadItem) {
    const first = moveTargets[0];
    if (!first) return;
    setEditingId(null);
    setMovingId(item.id);
    setMoveTargetId(first.id);
    setError(null);
  }

  function cancelMove() {
    setMovingId(null);
    setMoveTargetId("");
  }

  async function addItem() {
    const title = draft.trim();
    if (!title || busy) return;
    setBusy(true);
    setError(null);
    try {
      const notes = draftNotes.trim();
      const created = await rpc.scratchpad.create({
        botId,
        title,
        ...(notes ? { notes } : {}),
      });
      setDraft("");
      setDraftNotes("");
      setAdding(false);
      await setItems((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      try {
        await refresh();
      } catch {
        setError(t`Saved, but list refresh failed`);
      }
    } catch {
      setError(t`Could not add`);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(item: ScratchpadItem) {
    const title = editTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await rpc.scratchpad.update({
        itemId: item.id,
        title,
        notes: editNotes.trim(),
      });
      await setItems((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
      cancelEdit();
      try {
        await refresh();
      } catch {
        setError(t`Saved, but list refresh failed`);
      }
    } catch {
      setError(t`Could not update`);
    } finally {
      setBusy(false);
    }
  }

  async function moveItem(item: ScratchpadItem) {
    const targetId = moveTargetId;
    const target = moveTargets.find((candidate) => candidate.id === targetId);
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      await rpc.scratchpad.update({ itemId: item.id, botId: target.id });
      await setItems((current) => current.filter((entry) => entry.id !== item.id));
      cancelMove();
      void queryClient.invalidateQueries({
        queryKey: queries.scratchpad.list.queryKey({ input: { botId: target.id } }),
      });
      const targetName = target.name;
      toast.success(t`Moved to ${targetName}`);
      try {
        await refresh();
      } catch {
        setError(t`Moved, but list refresh failed`);
      }
    } catch {
      setError(t`Could not move`);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(item: ScratchpadItem, status: ScratchpadItem["status"]) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await rpc.scratchpad.update({ itemId: item.id, status });
      await setItems((current) => {
        const next = current.map((entry) => (entry.id === updated.id ? updated : entry));
        return status === "done" ? next.filter((entry) => entry.status !== "done") : next;
      });
      try {
        await refresh();
      } catch {
        setError(t`Saved, but list refresh failed`);
      }
    } catch {
      setError(t`Could not update`);
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(item: ScratchpadItem) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await rpc.scratchpad.remove({ itemId: item.id });
      await setItems((current) => current.filter((entry) => entry.id !== item.id));
      if (editingId === item.id) cancelEdit();
      if (movingId === item.id) cancelMove();
      try {
        await refresh();
      } catch {
        setError(t`Removed, but list refresh failed`);
      }
    } catch {
      setError(t`Could not remove`);
    } finally {
      setBusy(false);
    }
  }

  if (!alwaysVisible && !items.length && !error) return null;

  const actionButtonClass =
    "-mt-0.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 [@media(pointer:coarse)]:opacity-100";

  return (
    <div className={alwaysVisible ? undefined : "mt-6"} data-testid="bot-scratchpad">
      <SectionHeading variant="label" className="mb-1 flex items-center justify-between pe-1">
        <Trans>Open work</Trans>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t`Add open work`}
          title={t`Add open work`}
          onClick={() => setAdding((value) => !value)}
        >
          <Plus className="size-4" />
        </Button>
      </SectionHeading>
      {alwaysVisible ? (
        <p className="mb-2 text-[12.5px] text-muted-foreground">
          <Trans>Open items this agent tracks across chats. Edit, move, or remove anytime.</Trans>
        </p>
      ) : null}
      <div className="rounded-xl bg-muted/50 p-4">
        {alwaysVisible && !items.length && !adding ? (
          <div className="py-1 text-[13px] text-muted-foreground">
            <Trans>No open work right now</Trans>
          </div>
        ) : null}
        {(showAll ? items : items.slice(0, 5)).map((item) => {
          const isEditing = editingId === item.id;
          const isMoving = movingId === item.id;
          return (
            <div key={item.id} className="group -mx-2.5 rounded-lg px-2.5 py-2 hover:bg-accent/50">
              {isEditing ? (
                <form
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveEdit(item);
                  }}
                >
                  <Input
                    autoFocus
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                    aria-label={t`Edit open-work title`}
                    maxLength={200}
                    disabled={busy}
                  />
                  <Textarea
                    value={editNotes}
                    onChange={(event) => setEditNotes(event.target.value)}
                    placeholder={t`Notes (optional)`}
                    aria-label={t`Edit open-work notes`}
                    maxLength={4000}
                    rows={3}
                    disabled={busy}
                    className="text-[13px]"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      type="submit"
                      disabled={busy || !editTitle.trim()}
                    >
                      <Trans>Save</Trans>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      disabled={busy}
                      onClick={cancelEdit}
                    >
                      <Trans>Cancel</Trans>
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="flex items-start gap-2">
                    <Checkbox
                      aria-label={item.status === "done" ? t`Reopen` : t`Complete`}
                      checked={item.status === "done"}
                      disabled={busy}
                      onCheckedChange={(checked) => void setStatus(item, checked ? "done" : "open")}
                      className="mt-[3px]"
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-start text-[14.5px] ${item.status === "done" ? "text-muted-foreground/80 line-through" : "text-foreground"}`}
                        dir="auto"
                      >
                        {item.title}
                      </div>
                      {item.notes ? (
                        <div className="mt-0.5 text-[12.5px] text-muted-foreground/80" dir="auto">
                          {item.notes}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t`Edit`}
                        title={t`Edit`}
                        disabled={busy}
                        onClick={() => startEdit(item)}
                        className={actionButtonClass}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      {moveTargets.length > 0 ? (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t`Move to another agent`}
                          title={t`Move to another agent`}
                          disabled={busy}
                          onClick={() => (isMoving ? cancelMove() : startMove(item))}
                          className={actionButtonClass}
                        >
                          <ArrowRightLeft className="size-3.5" />
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t`Remove`}
                        title={t`Remove`}
                        disabled={busy}
                        onClick={() => void removeItem(item)}
                        className={actionButtonClass}
                      >
                        <X />
                      </Button>
                    </div>
                  </div>
                  {isMoving ? (
                    <div className="mt-2 flex items-center gap-2 ps-6">
                      <NativeSelect
                        aria-label={t`Move to agent`}
                        value={moveTargetId}
                        disabled={busy}
                        onChange={(event) => setMoveTargetId(event.target.value)}
                        className="min-w-0 flex-1"
                      >
                        {moveTargets.map((target) => (
                          <NativeSelectOption key={target.id} value={target.id}>
                            {target.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        disabled={busy || !moveTargetId}
                        onClick={() => void moveItem(item)}
                      >
                        <Trans>Move</Trans>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        disabled={busy}
                        onClick={cancelMove}
                      >
                        <Trans>Cancel</Trans>
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
        {items.length > 5 && !showAll ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full text-muted-foreground"
            onClick={() => setShowAll(true)}
          >
            <Trans>Show more</Trans>
          </Button>
        ) : null}
        {adding ? (
          <form
            className={`space-y-2 ${items.length ? "mt-2" : ""}`}
            onSubmit={(event) => {
              event.preventDefault();
              void addItem();
            }}
          >
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t`Add item`}
                aria-label={t`New open-work item`}
                maxLength={200}
                className="min-w-0 flex-1"
              />
              <Button variant="secondary" type="submit" disabled={busy || !draft.trim()}>
                <Trans>Add</Trans>
              </Button>
            </div>
            <Textarea
              value={draftNotes}
              onChange={(event) => setDraftNotes(event.target.value)}
              placeholder={t`Notes (optional)`}
              aria-label={t`New open-work notes`}
              maxLength={4000}
              rows={2}
              className="text-[13px]"
            />
          </form>
        ) : null}
      </div>
      {error ? <div className="mt-2 text-[13px] text-destructive">{error}</div> : null}
    </div>
  );
}
