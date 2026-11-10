import { Trans, useLingui } from "@lingui/react/macro";
import type { TodoItem, TodoPriority, TodoStatus } from "@rakazo/contracts";
import { TODO_STATUSES, TODO_TITLE_MAX } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
  Spinner,
  Textarea,
  toast,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CalendarDays,
  ExternalLink,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { DragEvent, FormEvent } from "react";
import { useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { TODO_REFRESH_MS as REFRESH_MS } from "./todo-count";

const DRAG_TYPE = "application/x-rakazo-todo";

/** Each column's colour: accent bar, header dot, count pill and its drop highlight. */
const COLUMN_STYLE: Record<
  TodoStatus,
  { bar: string; dot: string; count: string; list: string; drop: string; line: string }
> = {
  todo: {
    bar: "bg-sky-500",
    dot: "bg-sky-500",
    count: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    list: "bg-sky-50 dark:bg-sky-950",
    drop: "ring-sky-500/60",
    line: "bg-sky-500",
  },
  in_progress: {
    bar: "bg-amber-500",
    dot: "bg-amber-500",
    count: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    list: "bg-amber-50 dark:bg-amber-950",
    drop: "ring-amber-500/60",
    line: "bg-amber-500",
  },
  waiting: {
    bar: "bg-violet-500",
    dot: "bg-violet-500",
    count: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    list: "bg-violet-50 dark:bg-violet-950",
    drop: "ring-violet-500/60",
    line: "bg-violet-500",
  },
  done: {
    bar: "bg-emerald-500",
    dot: "bg-emerald-500",
    count: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    list: "bg-emerald-50 dark:bg-emerald-950",
    drop: "ring-emerald-500/60",
    line: "bg-emerald-500",
  },
};

const PRIORITY_STRIPE: Record<TodoPriority, string> = {
  high: "border-l-rose-500",
  normal: "border-l-transparent",
  low: "border-l-slate-300 dark:border-l-slate-600",
};

const CHIP = "inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium";

function dueSoon(item: TodoItem): boolean {
  if (!item.dueAt || item.status === "done") return false;
  const days = (new Date(item.dueAt).getTime() - Date.now()) / 86_400_000;
  return days >= 0 && days <= 2;
}

function useColumnLabels(): Record<TodoStatus, string> {
  const { t } = useLingui();
  return {
    todo: t`To do`,
    in_progress: t`In progress`,
    waiting: t`Waiting on others`,
    done: t`Done`,
  };
}

function usePriorityLabels(): Record<TodoPriority, string> {
  const { t } = useLingui();
  return { low: t`Low`, normal: t`Normal`, high: t`High` };
}

function dueLabel(dueAt: string, locale: string): string {
  return new Date(dueAt).toLocaleDateString(locale || "en", { day: "numeric", month: "short" });
}

function overdue(item: TodoItem): boolean {
  return Boolean(item.dueAt && item.status !== "done" && new Date(item.dueAt) < new Date());
}

/** The card order after `itemId` is dropped into `status` above `beforeId` (or at the end). */
export function reorderTodos(
  items: TodoItem[],
  itemId: string,
  status: TodoStatus,
  beforeId: string | null,
): TodoItem[] {
  const moving = items.find((item) => item.id === itemId);
  if (!moving) return items;
  const rest = items.filter((item) => item.id !== itemId);
  const column = rest.filter((item) => item.status === status);
  const index = beforeId ? column.findIndex((item) => item.id === beforeId) : -1;
  const above = column[(index < 0 ? column.length : index) - 1]?.position;
  const below = index < 0 ? undefined : column[index]?.position;
  const position =
    above === undefined
      ? below === undefined
        ? 0
        : below - 1
      : below === undefined
        ? above + 1
        : (above + below) / 2;
  return [...rest, { ...moving, status, position }].sort((a, b) => a.position - b.position);
}

/** The person's own to-do board: their items and the ones their assistants added. */
export function TodoBoardDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const columns = useColumnLabels();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<TodoItem | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ status: TodoStatus; beforeId: string | null }>();
  const listOptions = queries.todos.list.queryOptions({ input: {} });
  const list = useQuery({ ...listOptions, refetchInterval: REFRESH_MS });
  const archived = useQuery({
    ...queries.todos.list.queryOptions({ input: { includeArchived: true } }),
    enabled: showArchived,
  });
  const items = list.data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: queries.todos.key() });
  async function run(work: () => Promise<unknown>, failure: string) {
    try {
      await work();
    } catch {
      toast.error(failure);
    } finally {
      await refresh();
    }
  }

  function drop(status: TodoStatus, beforeId: string | null, event: DragEvent) {
    event.preventDefault();
    const itemId = event.dataTransfer.getData(DRAG_TYPE) || dragging;
    setDragging(null);
    setDropTarget(undefined);
    if (!itemId || itemId === beforeId) return;
    queryClient.setQueryData(listOptions.queryKey, (current: TodoItem[] | undefined) =>
      current ? reorderTodos(current, itemId, status, beforeId) : current,
    );
    void run(
      () => queries.todos.move.call({ itemId, status, beforeId }),
      t`Could not move that item.`,
    );
  }

  function beforeIdAt(column: TodoItem[], index: number, event: DragEvent<HTMLElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const lowerHalf = event.clientY > box.top + box.height / 2;
    return lowerHalf ? (column[index + 1]?.id ?? null) : column[index]!.id;
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        data-testid="todo-board"
        className="flex h-[760px] max-h-[calc(100%-2rem)] w-[1200px] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-2xl bg-card p-0 sm:max-w-[1200px]"
      >
        <DialogHeader className="flex-row items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div className="min-w-0">
            <DialogTitle className="text-heading2 text-foreground">
              <Trans>To do list</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>
                Only you can see this list. Your assistants can add to it from your emails and chats
                when you ask them, including in routines.
              </Trans>
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant={showArchived ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setShowArchived((value) => !value)}
            >
              <Archive />
              {showArchived ? <Trans>Back to board</Trans> : <Trans>Archived</Trans>}
            </Button>
            <DialogClose
              render={<Button variant="ghost" size="icon-sm" aria-label={t`Close to do list`} />}
            >
              <X />
            </DialogClose>
          </div>
        </DialogHeader>
        {showArchived ? (
          <ArchivedList
            items={(archived.data ?? []).filter((item) => item.archivedAt)}
            loading={archived.isPending}
            onRestore={(item) =>
              run(() => queries.todos.restore.call({ itemId: item.id }), t`Could not restore it.`)
            }
            onDelete={(item) =>
              run(
                () => queries.todos.remove.call({ itemId: item.id }),
                t`Could not hard delete it.`,
              )
            }
          />
        ) : list.isPending ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        ) : list.isError ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            <Trans>Could not load your to do list.</Trans>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[repeat(4,minmax(240px,1fr))] gap-3 overflow-x-auto items-start bg-muted/60 px-6 pt-5 pb-6">
            {TODO_STATUSES.map((status) => {
              const column = items.filter((item) => item.status === status);
              const target = dropTarget?.status === status;
              const style = COLUMN_STYLE[status];
              return (
                <section
                  key={status}
                  aria-label={columns[status]}
                  data-testid={`todo-column-${status}`}
                  className={`flex max-h-full min-h-0 flex-col overflow-hidden rounded-xl shadow-md ${style.list} ${
                    target ? `ring-2 ${style.drop}` : ""
                  }`}
                  onDragOver={(event) => {
                    if (!dragging) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    if (dropTarget?.status !== status) setDropTarget({ status, beforeId: null });
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setDropTarget(undefined);
                    }
                  }}
                  onDrop={(event) => drop(status, target ? dropTarget.beforeId : null, event)}
                >
                  <div aria-hidden="true" className={`h-1.5 ${style.bar}`} />
                  <header className="flex items-center justify-between px-3 pt-2.5 pb-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span aria-hidden="true" className={`size-2.5 rounded-full ${style.dot}`} />
                      {columns[status]}
                    </h3>
                    <span className={`${CHIP} ${style.count}`}>{column.length}</span>
                  </header>
                  <AddTodo
                    status={status}
                    onAdd={(title) =>
                      run(
                        () => queries.todos.create.call({ title, status }),
                        t`Could not add that item.`,
                      )
                    }
                  />
                  <ol className="flex min-h-12 flex-col gap-2 overflow-y-auto px-2 pt-1 pb-3">
                    {column.map((item, index) => (
                      <li
                        key={item.id}
                        onDragOver={(event) => {
                          if (!dragging) return;
                          event.preventDefault();
                          event.stopPropagation();
                          setDropTarget({ status, beforeId: beforeIdAt(column, index, event) });
                        }}
                      >
                        {target && dropTarget?.beforeId === item.id ? (
                          <DropLine color={style.line} />
                        ) : null}
                        <TodoCard
                          item={item}
                          dragging={dragging === item.id}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData(DRAG_TYPE, item.id);
                            setDragging(item.id);
                          }}
                          onDragEnd={() => {
                            setDragging(null);
                            setDropTarget(undefined);
                          }}
                          onOpen={() => setEditing(item)}
                        />
                      </li>
                    ))}
                    {target && dropTarget?.beforeId === null ? (
                      <DropLine color={style.line} />
                    ) : null}
                    {column.length === 0 && !target ? (
                      <li className="px-2 py-4 text-center text-xs text-muted-foreground">
                        <Trans>Nothing here</Trans>
                      </li>
                    ) : null}
                  </ol>
                </section>
              );
            })}
          </div>
        )}
        {editing ? (
          <TodoEditDialog
            item={editing}
            onClose={() => setEditing(null)}
            onSave={async (patch) => {
              await run(
                () => queries.todos.update.call({ itemId: editing.id, ...patch }),
                t`Could not save your changes.`,
              );
              setEditing(null);
            }}
            onArchive={async () => {
              await run(
                () => queries.todos.archive.call({ itemId: editing.id }),
                t`Could not delete it.`,
              );
              setEditing(null);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DropLine({ color }: { color: string }) {
  return <div aria-hidden="true" className={`mb-2 h-1 rounded-full ${color}`} />;
}

function AddTodo({
  status,
  onAdd,
}: {
  status: TodoStatus;
  onAdd: (title: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  if (!open) {
    return (
      <div className="px-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground"
          data-testid={`todo-add-${status}`}
          onClick={() => setOpen(true)}
        >
          <Plus />
          <Trans>Add item</Trans>
        </Button>
      </div>
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    setSaving(true);
    await onAdd(value);
    setSaving(false);
    setTitle("");
  }
  return (
    <form className="flex gap-1.5 px-2" onSubmit={(event) => void submit(event)}>
      <Input
        autoFocus
        value={title}
        maxLength={TODO_TITLE_MAX}
        placeholder={t`What needs doing?`}
        aria-label={t`New item`}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
            setTitle("");
          }
        }}
        onBlur={() => {
          if (!title.trim()) setOpen(false);
        }}
      />
      <Button type="submit" size="sm" disabled={saving || !title.trim()}>
        <Trans>Add</Trans>
      </Button>
    </form>
  );
}

function TodoCard({
  item,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  item: TodoItem;
  dragging: boolean;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
  onOpen: () => void;
}) {
  const { t, i18n } = useLingui();
  const priorities = usePriorityLabels();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dragging is pointer-only; the edit dialog's Status moves a card by keyboard.
    <div
      draggable
      data-testid="todo-card"
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`cursor-grab rounded-lg border border-l-4 bg-card p-2.5 shadow-sm transition hover:-translate-y-px hover:shadow-md active:cursor-grabbing ${PRIORITY_STRIPE[item.priority]} ${
        dragging ? "opacity-40" : ""
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        className={`block w-full rounded-sm text-start text-sm break-words focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
          item.status === "done" ? "text-muted-foreground line-through" : "text-foreground"
        }`}
      >
        {item.title}
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {item.origin === "ai" ? (
          <span
            title={t`Added by your assistant`}
            className={`${CHIP} bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300`}
          >
            <Sparkles className="size-3" aria-hidden="true" />
            <Trans>AI</Trans>
          </span>
        ) : null}
        {item.priority === "high" ? (
          <span className={`${CHIP} bg-rose-500 text-white`}>{priorities.high}</span>
        ) : item.priority === "low" ? (
          <span className={`${CHIP} bg-slate-500/15 text-slate-600 dark:text-slate-300`}>
            {priorities.low}
          </span>
        ) : null}
        {item.dueAt ? (
          <span
            className={`${CHIP} ${
              overdue(item)
                ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                : dueSoon(item)
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                  : item.status === "done"
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-muted text-muted-foreground"
            }`}
          >
            <CalendarDays className="size-3" aria-hidden="true" />
            {dueLabel(item.dueAt, i18n.locale)}
          </span>
        ) : null}
        {item.source?.link ? (
          <a
            href={item.source.link}
            target="_blank"
            rel="noopener noreferrer"
            draggable={false}
            className={`${CHIP} min-w-0 max-w-full bg-sky-500/15 text-sky-700 hover:bg-sky-500/25 dark:text-sky-300`}
            onClick={(event) => event.stopPropagation()}
          >
            <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.source.label || t`Open link`}</span>
          </a>
        ) : item.source?.label ? (
          <span className={`${CHIP} min-w-0 max-w-full bg-muted`}>
            <span className="truncate">{item.source.label}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function dateInputValue(dueAt: string | null): string {
  return dueAt ? dueAt.slice(0, 10) : "";
}

function TodoEditDialog({
  item,
  onClose,
  onSave,
  onArchive,
}: {
  item: TodoItem;
  onClose: () => void;
  onSave: (patch: {
    title: string;
    notes: string;
    status: TodoStatus;
    priority: TodoPriority;
    dueAt: string | null;
  }) => Promise<void>;
  onArchive: () => Promise<void>;
}) {
  const { t } = useLingui();
  const columns = useColumnLabels();
  const priorities = usePriorityLabels();
  const [title, setTitle] = useState(item.title);
  const [notes, setNotes] = useState(item.notes);
  const [status, setStatus] = useState<TodoStatus>(item.status);
  const [priority, setPriority] = useState<TodoPriority>(item.priority);
  const [due, setDue] = useState(dateInputValue(item.dueAt));
  const [saving, setSaving] = useState(false);
  async function act(work: () => Promise<void>) {
    setSaving(true);
    try {
      await work();
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            <Trans>Edit item</Trans>
          </DialogTitle>
          {item.origin === "ai" ? (
            <DialogDescription>
              <Trans>Your assistant added this item.</Trans>
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim()) return;
            void act(() =>
              onSave({
                title: title.trim(),
                notes,
                status,
                priority,
                dueAt: due ? new Date(`${due}T12:00:00Z`).toISOString() : null,
              }),
            );
          }}
        >
          <Field>
            <FieldLabel htmlFor="todo-title">
              <Trans>Title</Trans>
            </FieldLabel>
            <Input
              id="todo-title"
              value={title}
              maxLength={TODO_TITLE_MAX}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="todo-notes">
              <Trans>Notes</Trans>
            </FieldLabel>
            <Textarea
              id="todo-notes"
              rows={4}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field>
              <FieldLabel htmlFor="todo-status">
                <Trans>Status</Trans>
              </FieldLabel>
              <NativeSelect
                id="todo-status"
                className="w-full"
                value={status}
                onChange={(event) => setStatus(event.target.value as TodoStatus)}
              >
                {TODO_STATUSES.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {columns[value]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="todo-priority">
                <Trans>Priority</Trans>
              </FieldLabel>
              <NativeSelect
                id="todo-priority"
                className="w-full"
                value={priority}
                onChange={(event) => setPriority(event.target.value as TodoPriority)}
              >
                {(["low", "normal", "high"] as const).map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {priorities[value]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="todo-due">
                <Trans>Due</Trans>
              </FieldLabel>
              <Input
                id="todo-due"
                type="date"
                value={due}
                onChange={(event) => setDue(event.target.value)}
              />
            </Field>
          </div>
          {item.source ? (
            <p className="text-sm text-muted-foreground">
              <Trans>From:</Trans>{" "}
              {item.source.link ? (
                <a
                  href={item.source.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground underline"
                >
                  {item.source.label || t`Open link`}
                </a>
              ) : (
                item.source.label
              )}
            </p>
          ) : null}
          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => void act(onArchive)}
            >
              <Trash2 />
              <Trans>Delete</Trans>
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Button type="submit" disabled={saving || !title.trim()}>
                <Trans>Save</Trans>
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArchivedList({
  items,
  loading,
  onRestore,
  onDelete,
}: {
  items: TodoItem[];
  loading: boolean;
  onRestore: (item: TodoItem) => Promise<void>;
  onDelete: (item: TodoItem) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <Trans>Nothing archived.</Trans>
      </div>
    );
  }
  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-6 pb-6">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2"
        >
          <div className="min-w-0">
            <p className="truncate text-sm text-foreground">{item.title}</p>
            {item.origin === "ai" ? (
              <p className="text-xs text-muted-foreground">
                <Trans>Added by your assistant</Trans>
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button variant="outline" size="sm" onClick={() => void onRestore(item)}>
              <RotateCcw />
              <Trans>Restore</Trans>
            </Button>
            {confirming === item.id ? (
              <Button variant="destructive" size="sm" onClick={() => void onDelete(item)}>
                <Trans>Confirm hard delete</Trans>
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirming(item.id)}>
                <Trash2 />
                <Trans>Hard delete</Trans>
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
