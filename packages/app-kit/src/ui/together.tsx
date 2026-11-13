import { History, MessageCircle, Send, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { AppPresence } from "../protocol.js";
import type { TableSchema } from "../schema.js";
import { formatValue } from "../schema.js";
import { useComments, usePresence, useRowHistory } from "../sdk/index.js";
import { Avatar, Button, Skeleton, Tabs, Textarea } from "./basic.js";
import { cn } from "./cn.js";
import { toast } from "./overlay.js";

/** "just now", "5 min ago", "3 h ago", then the date. */
export function ago(iso: string, now = Date.now()): string {
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return "";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(at).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
}

/**
 * Faces of the others who have the app open now, each with what they are looking at on hover.
 * Shows nothing when you are alone. Pass a row to show only the people on that row.
 */
export function PresenceStack({
  table,
  rowId,
  max = 4,
  className,
}: {
  table?: string;
  rowId?: string | null;
  max?: number;
  className?: string;
}) {
  const { others } = usePresence();
  const people = others.filter(
    (person) =>
      !table || (person.focus?.table === table && (!rowId || person.focus?.rowId === rowId)),
  );
  if (!people.length) return null;
  const label = (person: AppPresence) =>
    person.focus ? `${person.name} · viewing a row` : `${person.name} · here now`;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex -space-x-2">
        <AnimatePresence initial={false}>
          {people.slice(0, max).map((person) => (
            <motion.span
              key={person.id}
              title={label(person)}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              className="relative"
            >
              <Avatar name={person.name} size={28} />
              <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-success ring-2 ring-card" />
            </motion.span>
          ))}
        </AnimatePresence>
        {people.length > max && (
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-muted text-[11px] font-bold ring-2 ring-card">
            +{people.length - max}
          </span>
        )}
      </div>
      {rowId && (
        <span className="text-xs text-muted-foreground">
          {people.length === 1 ? `${people[0]?.name} is here` : `${people.length} here`}
        </span>
      )}
    </div>
  );
}

/**
 * The conversation on one row: everyone's comments, newest at the bottom, and a box to add one
 * (Enter sends, Shift+Enter starts a line). Visitors with only the password can read the row but
 * not comment.
 */
export function Comments({
  table,
  rowId,
  className,
}: {
  table: string;
  rowId: string;
  className?: string;
}) {
  const { comments, loading, canComment, canRemoveAny, add, remove } = useComments(table, rowId);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const submit = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      await add(draft);
      setDraft("");
    } catch (error) {
      toast.error("Not sent", error instanceof Error ? error.message : undefined);
    } finally {
      setSending(false);
    }
  };
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {loading && !comments.length ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12 w-3/4" />
          <Skeleton className="h-12 w-2/3" />
        </div>
      ) : comments.length ? (
        <ol className="flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {comments.map((comment) => (
              <motion.li
                key={comment.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="group flex gap-3"
              >
                <Avatar name={comment.by ?? "Someone"} size={30} />
                <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm bg-muted/60 px-3.5 py-2.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-semibold">{comment.by ?? "Someone"}</span>
                    <span className="text-xs text-muted-foreground">{ago(comment.createdAt)}</span>
                    {(comment.mine || canRemoveAny) && (
                      <button
                        type="button"
                        aria-label="Remove comment"
                        onClick={() =>
                          void remove(comment.id).catch((error: unknown) =>
                            toast.error(
                              "Not removed",
                              error instanceof Error ? error.message : undefined,
                            ),
                          )
                        }
                        className="ml-auto text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm whitespace-pre-wrap break-words">{comment.body}</p>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <MessageCircle className="size-4" />
          No comments yet.
        </p>
      )}
      {canComment && (
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            rows={2}
            maxLength={4000}
            placeholder="Write a comment…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            className="min-h-0 flex-1 resize-none"
          />
          <Button
            icon={<Send />}
            loading={sending}
            disabled={!draft.trim()}
            onClick={() => void submit()}
            aria-label="Send comment"
          />
        </div>
      )}
    </div>
  );
}

const ACTION_DOT = {
  added: "bg-success",
  changed: "bg-primary",
  removed: "bg-destructive",
} as const;

const VIA: Record<string, string> = {
  assistant: "By the assistant",
  import: "From an import",
  template: "From the template",
  evolve: "From OCSC Evolve",
  shared: "From the shared link",
};

/** Who added and changed one row, newest first, with each changed column's old and new value. */
export function RowHistory({
  table,
  rowId,
  schema,
  className,
}: {
  table: string;
  rowId: string;
  /** Formats values the way the table shows them. */
  schema?: TableSchema | null;
  className?: string;
}) {
  const { changes, loading, available } = useRowHistory(table, rowId);
  const show = (key: string, value: unknown) => {
    const column = schema?.columns.find((item) => item.key === key);
    if (value === null || value === undefined || value === "") return "—";
    return column ? formatValue(column, value) : String(value);
  };
  if (!available)
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        History shows for people signed in.
      </p>
    );
  if (loading && !changes.length)
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-10 w-2/3" />
      </div>
    );
  if (!changes.length)
    return (
      <p className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
        <History className="size-4" />
        No changes recorded yet.
      </p>
    );
  return (
    <ol
      className={cn(
        "relative flex flex-col gap-4 pl-6 before:absolute before:top-1 before:bottom-1 before:left-[7px] before:w-px before:bg-border",
        className,
      )}
    >
      {changes.map((change) => (
        <li key={change.id} className="relative">
          <span
            className={cn(
              "absolute top-1 -left-6 size-[15px] rounded-full border-[3px] border-card",
              ACTION_DOT[change.action],
            )}
          />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">
              {change.by ?? "Someone"} {change.action}
              {change.action === "changed" && change.fields?.length
                ? ` ${change.fields.map((field) => field.label).join(", ")}`
                : " this"}
            </p>
            <span className="text-xs text-muted-foreground">{ago(change.at)}</span>
          </div>
          {change.fields?.length ? (
            <ul className="mt-1 flex flex-col gap-0.5 text-[13px] text-muted-foreground">
              {change.fields.slice(0, 8).map((field) => (
                <li key={field.key} className="truncate">
                  <span className="font-medium text-foreground">{field.label}:</span>{" "}
                  <span className="line-through decoration-muted-foreground/50">
                    {show(field.key, field.before)}
                  </span>{" "}
                  → {show(field.key, field.after)}
                </li>
              ))}
            </ul>
          ) : change.via && VIA[change.via] ? (
            <p className="mt-0.5 text-[13px] text-muted-foreground">{VIA[change.via]}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** Comments and history for one row as two tabs, for a drawer or detail page. */
export function RowActivity({
  table,
  rowId,
  schema,
  className,
}: {
  table: string;
  rowId: string;
  schema?: TableSchema | null;
  className?: string;
}) {
  const [tab, setTab] = useState<"comments" | "history">("comments");
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex items-center justify-between gap-3">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "comments", label: "Comments", icon: <MessageCircle /> },
            { value: "history", label: "History", icon: <History /> },
          ]}
        />
        <PresenceStack table={table} rowId={rowId} />
      </div>
      {tab === "comments" ? (
        <Comments table={table} rowId={rowId} />
      ) : (
        <RowHistory table={table} rowId={rowId} schema={schema} />
      )}
    </div>
  );
}
