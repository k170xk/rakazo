import { Trans, useLingui } from "@lingui/react/macro";
import type { TodoItem, TodoPriority, TodoStatus } from "@rakazo/contracts";
import {
  openStudioNote,
  PERSONAL_TODO_LIST,
  TODO_STATUSES,
  TODO_TITLE_MAX,
} from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
  Spinner,
  Textarea,
  toast,
} from "@rakazo/ui-web";
import { useIsMobile } from "@rakazo/ui-web/hooks/use-mobile";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CalendarDays,
  Check,
  ChevronDown,
  ExternalLink,
  ListTodo,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { DragEvent, FormEvent } from "react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePageSession } from "../../lib/pages";
import { useSpaceQueries } from "../../lib/query";
import type { StudioCard } from "../../lib/studio-activity";
import { StudioActivityCarousel } from "../studio/StudioActivityCarousel";
import { StudioChatPane } from "../studio/StudioChatPane";
import { control } from "../studio/StudioFrame";
import { StudioFloatingDock, studioDockStyle } from "../studio/studio-dock";
import { TODO_REFRESH_MS as REFRESH_MS, TODO_NEW_MS } from "./todo-count";

const DRAG_TYPE = "application/x-rakazo-todo";
const NO_ACTIVITY: StudioCard[] = [];
const idleSubscribe = () => () => {};
const pill =
  "flex h-[35px] items-center gap-1.5 rounded-full border border-foreground/[0.06] px-2.5 text-[14px] leading-5 text-foreground outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-foreground/[0.08] sm:px-[15px]";

function ListMark() {
  return (
    <span className="grid size-5 shrink-0 place-items-center rounded-md bg-background text-foreground/70">
      <ListTodo className="size-3.5" strokeWidth={1.8} />
    </span>
  );
}

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

/** The person's to-do studio: chat on the left, the open list on the right. */
export function TodoBoardDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const columns = useColumnLabels();
  const session = usePageSession();
  const closeButton = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState(PERSONAL_TODO_LIST);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<TodoItem | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ status: TodoStatus; beforeId: string | null }>();
  const [chatOpen, setChatOpen] = useState(
    () =>
      typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1024px)").matches,
  );
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const phone = useIsMobile();
  const [shown, setShown] = useState<TodoStatus>("todo");
  const listInput = selected === PERSONAL_TODO_LIST ? {} : { listId: selected };
  const listOptions = queries.todos.list.queryOptions({ input: listInput });
  const list = useQuery({ ...listOptions, refetchInterval: REFRESH_MS });
  const archived = useQuery({
    ...queries.todos.list.queryOptions({
      input: { ...listInput, includeArchived: true },
    }),
    enabled: showArchived,
  });
  const lists = useQuery(queries.todos.lists.queryOptions());
  const items = list.data ?? [];
  const extraLists = (lists.data ?? []).filter((entry) => !entry.personal);
  const selectedList = extraLists.find((entry) => entry.id === selected);
  const selectedTitle =
    selected === PERSONAL_TODO_LIST ? t`Personal` : (selectedList?.title ?? t`To-do list`);
  const running = useSyncExternalStore(
    session?.dock.subscribe ?? idleSubscribe,
    () => session?.dock.get().running === true,
    () => false,
  );
  const activity = useSyncExternalStore(
    session?.dock.subscribe ?? idleSubscribe,
    () => session?.dock.get().activity ?? NO_ACTIVITY,
    () => NO_ACTIVITY,
  );
  const showActivity = !chatOpen && (running || activity.length > 0);
  const setDockNode = useCallback(
    (node: HTMLDivElement | null) => session?.dock.set({ node }),
    [session],
  );
  const setChatNode = useCallback(
    (chat: HTMLDivElement | null) => session?.dock.set({ chat }),
    [session],
  );

  useEffect(() => {
    if (selected === PERSONAL_TODO_LIST || !lists.isSuccess || lists.isFetching) return;
    if (!extraLists.some((entry) => entry.id === selected)) setSelected(PERSONAL_TODO_LIST);
  }, [extraLists, lists.isFetching, lists.isSuccess, selected]);

  useEffect(() => {
    setRenaming(false);
    setShowArchived(false);
  }, [selected]);

  useEffect(() => {
    if (!session || !list.isSuccess) return;
    session.dock.set({
      page: {
        note: openStudioNote({
          kind: "todo",
          title: selected === PERSONAL_TODO_LIST ? "Personal" : selectedTitle,
          id: selected,
          blank: items.length === 0,
        }),
      },
    });
  }, [session, list.isSuccess, items.length, selected, selectedTitle]);

  useEffect(
    () => () => {
      session?.dock.set({ page: null, node: null, chat: null });
    },
    [session],
  );

  async function createList() {
    try {
      const created = await queries.todos.createList.call({ title: t`To-do list` });
      setSelected(created.id);
      await queryClient.invalidateQueries({ queryKey: queries.todos.key() });
    } catch {
      toast.error(t`Could not create that list.`);
    }
  }

  async function renameList(title: string) {
    const next = title.trim();
    setRenaming(false);
    if (!next || selected === PERSONAL_TODO_LIST || next === selectedList?.title) return;
    try {
      await queries.todos.renameList.call({ listId: selected, title: next });
      await queryClient.invalidateQueries({ queryKey: queries.todos.key() });
    } catch {
      toast.error(t`Could not rename that list.`);
    }
  }

  async function removeList(listId: string) {
    try {
      await queries.todos.removeList.call({ listId });
      setSelected(PERSONAL_TODO_LIST);
      await refresh();
    } catch {
      toast.error(t`Could not delete that list.`);
    }
  }

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
    move(itemId, status, beforeId);
  }

  function move(itemId: string, status: TodoStatus, beforeId: string | null) {
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

  const composer = <div ref={setDockNode} />;

  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        const target = details.event?.target;
        if (
          !open &&
          details.reason === "escape-key" &&
          target instanceof Element &&
          target.closest('[data-slot="popover-content"], [data-slot="dropdown-menu-content"]')
        ) {
          details.cancel();
          return;
        }
        if (!open) onClose();
      }}
    >
      <DialogContent
        overlay={false}
        showCloseButton={false}
        initialFocus={closeButton}
        data-testid="todo-board"
        className="overflow-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] ps-[env(safe-area-inset-left)] pe-[env(safe-area-inset-right)]"
      >
        <div className="relative size-full">
          <header className="absolute inset-x-0 top-0 z-10 flex h-12 items-center gap-1.5 overflow-hidden border-b border-border bg-muted px-2.5 sm:gap-2">
            <button
              type="button"
              aria-pressed={chatOpen}
              title={t`Show the chat beside the list`}
              aria-label={t`Chat`}
              onClick={() => setChatOpen((open) => !open)}
              className={`${control} relative size-[35px]`}
            >
              <MessageSquare className="size-[18px]" strokeWidth={1.7} />
              {running && !chatOpen ? (
                <span className="absolute end-1 top-1 size-2 rounded-full bg-primary" />
              ) : null}
            </button>
            <button
              type="button"
              data-testid="todo-new"
              aria-label={t`New to-do list`}
              title={t`New to-do list`}
              onClick={() => void createList()}
              className={`${control} size-[35px]`}
            >
              <Plus className="size-[18px]" strokeWidth={1.7} />
            </button>
            <DialogTitle className="sr-only">{selectedTitle}</DialogTitle>
            <DialogDescription className="sr-only">
              <Trans>
                Only you can see this list. Your assistants can add to it from your emails and chats
                when you ask them, including in routines.
              </Trans>
            </DialogDescription>
            {renaming ? (
              <Input
                autoFocus
                value={titleDraft}
                aria-label={t`Rename`}
                className="h-8 max-w-xs"
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => void renameList(titleDraft)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void renameList(titleDraft);
                  if (event.key === "Escape") setRenaming(false);
                }}
              />
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger
                  data-testid="todo-switcher"
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-w-0 max-w-[38vw] gap-1.5 font-medium sm:max-w-[280px]"
                    />
                  }
                >
                  <ListMark />
                  <span className="truncate">{selectedTitle}</span>
                  <ChevronDown className="size-3.5 shrink-0 opacity-65" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72">
                  <DropdownMenuItem
                    onClick={() => setSelected(PERSONAL_TODO_LIST)}
                    className="flex items-center gap-2"
                  >
                    <ListMark />
                    <span className="min-w-0 flex-1 truncate">
                      <Trans>Personal</Trans>
                    </span>
                    {selected === PERSONAL_TODO_LIST ? (
                      <Check className="size-4 shrink-0 text-primary" />
                    ) : null}
                  </DropdownMenuItem>
                  {extraLists.map((entry) => (
                    <DropdownMenuItem
                      key={entry.id}
                      onClick={() => setSelected(entry.id)}
                      className="flex items-center gap-2"
                    >
                      <ListMark />
                      <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                      {entry.id === selected ? (
                        <Check className="size-4 shrink-0 text-primary" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void createList()}>
                    <Plus className="size-4" />
                    <Trans>New to-do list</Trans>
                  </DropdownMenuItem>
                  {selected !== PERSONAL_TODO_LIST ? (
                    <>
                      <DropdownMenuItem
                        onClick={() => {
                          setTitleDraft(selectedList?.title ?? "");
                          setRenaming(true);
                        }}
                      >
                        <Pencil className="size-4" />
                        <Trans>Rename</Trans>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => void removeList(selected)}
                      >
                        <Trash2 className="size-4" />
                        <Trans>Delete</Trans>
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <div className="flex-1" />
            <button
              type="button"
              aria-pressed={showArchived}
              onClick={() => setShowArchived((value) => !value)}
              className={pill}
            >
              <Archive className="size-4" strokeWidth={1.8} />
              <span className="max-sm:sr-only">
                {showArchived ? <Trans>Back to board</Trans> : <Trans>Archived</Trans>}
              </span>
            </button>
            <DialogClose
              ref={closeButton}
              aria-label={t`Close to do list`}
              className={`${control} size-[35px]`}
            >
              <X className="size-[18px]" strokeWidth={1.7} />
            </DialogClose>
          </header>
          <div
            className="absolute inset-x-0 top-12 bottom-0 flex"
            style={studioDockStyle(chatOpen, showActivity)}
          >
            {chatOpen ? (
              <StudioChatPane>
                <div ref={setChatNode} className="flex min-h-0 flex-1 flex-col" />
                <div className="shrink-0 px-2 pb-2">{composer}</div>
              </StudioChatPane>
            ) : null}
            <section aria-label={selectedTitle} className="flex min-h-0 min-w-0 flex-1 flex-col">
              {showArchived ? (
                <ArchivedList
                  items={(archived.data ?? []).filter((item) => item.archivedAt)}
                  loading={archived.isPending}
                  onRestore={(item) =>
                    run(
                      () => queries.todos.restore.call({ itemId: item.id }),
                      t`Could not restore it.`,
                    )
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
                <div
                  className={`grid min-h-0 flex-1 items-start gap-3 bg-muted/60 ${
                    phone
                      ? "grid-cols-1 grid-rows-[auto_minmax(0,1fr)] px-3 pt-3 pb-3"
                      : "grid-cols-[repeat(4,minmax(240px,1fr))] overflow-x-auto px-6 pt-5 pb-6"
                  }`}
                >
                  {phone ? (
                    <div
                      role="tablist"
                      aria-label={t`To do list`}
                      className="-mx-3 flex gap-1.5 overflow-x-auto px-3"
                    >
                      {TODO_STATUSES.map((status) => (
                        <button
                          key={status}
                          type="button"
                          role="tab"
                          aria-selected={shown === status}
                          data-testid={`todo-tab-${status}`}
                          onClick={() => setShown(status)}
                          className={`flex h-9 flex-none items-center gap-2 rounded-full border px-3 text-[13px] font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                            shown === status
                              ? "border-transparent bg-card text-foreground shadow-sm"
                              : "border-border text-muted-foreground"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`size-2 rounded-full ${COLUMN_STYLE[status].dot}`}
                          />
                          {columns[status]}
                          <span className={`${CHIP} ${COLUMN_STYLE[status].count}`}>
                            {items.filter((item) => item.status === status).length}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {(phone ? [shown] : TODO_STATUSES).map((status) => {
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
                          if (dropTarget?.status !== status)
                            setDropTarget({ status, beforeId: null });
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
                            <span
                              aria-hidden="true"
                              className={`size-2.5 rounded-full ${style.dot}`}
                            />
                            {columns[status]}
                          </h3>
                          <span className={`${CHIP} ${style.count}`}>{column.length}</span>
                        </header>
                        <AddTodo
                          status={status}
                          onAdd={(title) =>
                            run(
                              () =>
                                queries.todos.create.call({
                                  title,
                                  status,
                                  ...(selected === PERSONAL_TODO_LIST ? {} : { listId: selected }),
                                }),
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
                                setDropTarget({
                                  status,
                                  beforeId: beforeIdAt(column, index, event),
                                });
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
                                onMove={
                                  phone
                                    ? (next) => {
                                        if (next !== item.status) move(item.id, next, null);
                                      }
                                    : undefined
                                }
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
            </section>
          </div>
          {chatOpen ? null : (
            <StudioFloatingDock>
              {showActivity ? (
                <StudioActivityCarousel
                  cards={activity}
                  running={running}
                  onOpen={() => setChatOpen(true)}
                />
              ) : null}
              {composer}
            </StudioFloatingDock>
          )}
        </div>
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
  onMove,
}: {
  item: TodoItem;
  dragging: boolean;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
  onOpen: () => void;
  /** Shown where dragging is unavailable (touch screens). */
  onMove?: (status: TodoStatus) => void;
}) {
  const { t, i18n } = useLingui();
  const priorities = usePriorityLabels();
  const columns = useColumnLabels();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dragging is pointer-only; the edit dialog's Status moves a card by keyboard.
    <div
      draggable={!onMove}
      data-testid="todo-card"
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`cursor-grab rounded-lg border border-l-4 bg-card p-2.5 shadow-sm transition hover:-translate-y-px hover:shadow-md active:cursor-grabbing ${PRIORITY_STRIPE[item.priority]} ${
        Date.now() - new Date(item.createdAt).getTime() < TODO_NEW_MS ? "rk-todo-new" : ""
      } ${dragging ? "opacity-40" : ""}`}
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
        {onMove ? (
          <NativeSelect
            size="sm"
            className="ms-auto"
            aria-label={t`Move to`}
            data-testid="todo-move"
            value={item.status}
            onChange={(event) => onMove(event.target.value as TodoStatus)}
          >
            {TODO_STATUSES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {columns[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
