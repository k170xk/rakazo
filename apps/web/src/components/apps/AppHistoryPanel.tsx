import { useLingui } from "@lingui/react/macro";
import type { AppDataChange } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Spinner,
} from "@rakazo/ui-web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Minus, Pencil, Plus, Redo2, Table2, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { CodeDiff } from "./CodeDiff";

type View = "code" | "data";

/**
 * The app's history: every code version with what it changed, line by line, and every change to
 * its data. Restoring a version or undoing a change is kept too, so a mistake is never final.
 */
export function AppHistoryPanel({
  pageId,
  current,
  focus,
}: {
  pageId: string;
  current: number;
  /** A version to open straight away, from "See what changed". */
  focus?: number;
}) {
  const { t } = useLingui();
  const [view, setView] = useState<View>("code");
  return (
    <div className="flex flex-col gap-2 p-3">
      <div
        role="tablist"
        aria-label={t`History`}
        className="flex gap-1 self-start rounded-full bg-foreground/[0.05] p-1"
      >
        {(
          [
            ["code", t`Code changes`],
            ["data", t`Data changes`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={`rounded-full px-3 py-1 text-[12px] font-medium ${view === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {view === "code" ? (
        <CodeHistory pageId={pageId} current={current} focus={focus} />
      ) : (
        <DataHistory pageId={pageId} />
      )}
    </div>
  );
}

function useInvalidateApp() {
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queries.apps.key() });
    void queryClient.invalidateQueries({ queryKey: queries.pages.get.key() });
  };
}

function useVersionFiles(pageId: string, version: number | null) {
  const queries = useSpaceQueries();
  return useQuery({
    ...queries.apps.files.queryOptions({ input: { pageId, version: version ?? 1 } }),
    enabled: version !== null,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

function CodeHistory({
  pageId,
  current,
  focus,
}: {
  pageId: string;
  current: number;
  focus?: number;
}) {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const versions = useQuery(queries.apps.versions.queryOptions({ input: { pageId } }));
  const [open, setOpen] = useState<number | null>(focus ?? null);
  const [restoring, setRestoring] = useState<number | null>(null);

  const how = (entry: NonNullable<typeof versions.data>[number]) => {
    const by = entry.author;
    switch (entry.via) {
      case "assistant":
        return by ? t`By the assistant, for ${by}` : t`By the assistant`;
      case "studio":
        return by ? t`Edited in the Studio by ${by}` : t`Edited in the Studio`;
      case "restore":
        return entry.restoredFrom
          ? t`Restored version ${entry.restoredFrom}`
          : t`Restored an earlier version`;
      case "import":
        return t`Made from a spreadsheet`;
      case "template":
        return t`Started from a template`;
      default:
        return null;
    }
  };

  if (versions.isPending) return <Loading />;
  return (
    <>
      <p className="px-1 text-[12px] text-muted-foreground">
        {t`Every save is a version. Open one to see what it changed; restoring keeps the current version too.`}
      </p>
      <ol className="flex flex-col">
        {(versions.data ?? []).map((entry) => {
          const expanded = open === entry.version;
          const label = how(entry);
          return (
            <li key={entry.version} className="rounded-lg hover:bg-foreground/[0.02]">
              <div className="flex items-center gap-2 px-1 py-1.5">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : entry.version)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-start"
                >
                  {expanded ? (
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-foreground/[0.05] text-[11px] font-medium tabular-nums">
                    {entry.version}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-foreground">
                      {label ?? entry.title}
                    </span>
                    <span className="block text-[11.5px] text-muted-foreground">
                      {i18n.date(entry.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  </span>
                </button>
                {entry.version === current ? (
                  <span className="px-2 text-[12px] font-medium text-primary">{t`Current`}</span>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setRestoring(entry.version)}>
                    {t`Restore`}
                  </Button>
                )}
              </div>
              {expanded ? <VersionChanges pageId={pageId} version={entry.version} /> : null}
            </li>
          );
        })}
      </ol>
      {restoring !== null ? (
        <RestoreDialog
          pageId={pageId}
          current={current}
          version={restoring}
          onClose={() => setRestoring(null)}
        />
      ) : null}
    </>
  );
}

/** What one version changed against the version before it. */
function VersionChanges({ pageId, version }: { pageId: string; version: number }) {
  const { t } = useLingui();
  const after = useVersionFiles(pageId, version);
  const before = useVersionFiles(pageId, version > 1 ? version - 1 : null);
  if (after.isPending || (version > 1 && before.isPending)) return <Loading />;
  if (!after.data) return null;
  return (
    <div className="px-1 pb-3">
      {version === 1 ? (
        <p className="pb-2 text-[12px] text-muted-foreground">{t`The first version: every line is new.`}</p>
      ) : null}
      <CodeDiff before={before.data?.files ?? {}} after={after.data.files} />
    </div>
  );
}

/** Shows exactly what restoring will change before it happens. */
function RestoreDialog({
  pageId,
  current,
  version,
  onClose,
}: {
  pageId: string;
  current: number;
  version: number;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const invalidate = useInvalidateApp();
  const now = useVersionFiles(pageId, current);
  const target = useVersionFiles(pageId, version);
  const restore = useMutation({
    mutationFn: () => queries.apps.restore.call({ pageId, version }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(next) => !next && !restore.isPending && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="pe-8 text-[16px]">{t`Restore version ${version}?`}</DialogTitle>
          <DialogDescription>
            {t`These changes will be made to the current version ${current}. It stays in the history, so you can restore it again. The app's data is not changed.`}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-auto" style={{ maxHeight: "55vh" }}>
          {now.data && target.data ? (
            <CodeDiff before={now.data.files} after={target.data.files} />
          ) : (
            <Loading />
          )}
        </div>
        {restore.isError ? (
          <p role="alert" className="text-[12px] text-destructive">
            {restore.error instanceof Error
              ? restore.error.message
              : t`That version couldn't be restored.`}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={restore.isPending}>
            {t`Cancel`}
          </Button>
          <Button
            onClick={() => restore.mutate()}
            disabled={restore.isPending || !now.data || !target.data}
          >
            {restore.isPending ? <Spinner /> : null}
            {t`Restore version ${version}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const ACTION_ICON: Record<AppDataChange["action"], ReactNode> = {
  added: <Plus className="size-3.5 text-emerald-600" />,
  changed: <Pencil className="size-3.5 text-amber-600" />,
  removed: <Minus className="size-3.5 text-red-600" />,
  table: <Table2 className="size-3.5 text-sky-600" />,
};

function shown(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value).slice(0, 80);
  return String(value).slice(0, 80);
}

function DataHistory({ pageId }: { pageId: string }) {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const invalidate = useInvalidateApp();
  const changes = useQuery(queries.apps.changes.queryOptions({ input: { pageId } }));
  const undo = useMutation({
    mutationFn: (input: { changeId: string; redo: boolean }) =>
      queries.apps.undoChange.call({ pageId, ...input }),
    onSuccess: invalidate,
  });

  const who = (change: AppDataChange) => {
    const by = change.author;
    switch (change.via) {
      case "assistant":
        return t`the assistant`;
      case "studio":
        return by ? t`${by} in the Studio` : t`the Studio`;
      case "shared":
        return by ? t`${by} by link` : t`someone by link`;
      case "evolve":
        return by ? t`${by} in Evolve` : t`someone in Evolve`;
      case "import":
        return t`a spreadsheet import`;
      case "template":
        return t`the template`;
      default:
        return by ?? null;
    }
  };

  if (changes.isPending) return <Loading />;
  const list = changes.data ?? [];
  return (
    <>
      <p className="px-1 text-[12px] text-muted-foreground">
        {t`Every row added, changed or removed, and every bulk load, is kept here. Undo the newest change to a row first; anything undone can be redone.`}
      </p>
      {undo.isError ? (
        <p role="alert" className="px-1 text-[12px] text-destructive">
          {undo.error instanceof Error ? undo.error.message : t`That change couldn't be undone.`}
        </p>
      ) : null}
      {list.length === 0 ? (
        <p className="px-1 py-4 text-[13px] text-muted-foreground">{t`No data changes yet.`}</p>
      ) : (
        <ol className="flex flex-col">
          {list.map((change) => {
            const by = who(change);
            const pending = undo.isPending && undo.variables?.changeId === change.id;
            return (
              <li
                key={change.id}
                className={`flex gap-2 rounded-lg px-1 py-2 hover:bg-foreground/[0.02] ${change.undone ? "opacity-60" : ""}`}
              >
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-foreground/[0.05]">
                  {ACTION_ICON[change.action]}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-[13px] text-foreground ${change.undone ? "line-through" : ""}`}
                  >
                    {change.summary}
                  </p>
                  <p className="text-[11.5px] text-muted-foreground">
                    {[
                      change.undone ? t`Undone` : null,
                      by,
                      i18n.date(change.createdAt, { dateStyle: "medium", timeStyle: "short" }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {change.fields?.length ? (
                    <ul className="mt-1 flex flex-col gap-0.5 text-[12px]">
                      {change.fields.map((field) => (
                        <li key={field.key} className="flex flex-wrap items-baseline gap-1.5">
                          <span className="text-muted-foreground">{field.label}</span>
                          <span className="rounded bg-red-500/15 px-1 text-foreground line-through decoration-red-600/70">
                            {shown(field.before)}
                          </span>
                          <span className="rounded bg-emerald-500/15 px-1 text-foreground">
                            {shown(field.after)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {change.undone ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!change.canRedo || undo.isPending}
                    title={change.canRedo ? undefined : t`Newer changes replaced this one.`}
                    onClick={() => undo.mutate({ changeId: change.id, redo: true })}
                  >
                    {pending ? <Spinner /> : <Redo2 />}
                    {t`Redo`}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!change.canUndo || undo.isPending}
                    title={change.canUndo ? undefined : t`Undo the newer change to this first.`}
                    onClick={() => undo.mutate({ changeId: change.id, redo: false })}
                  >
                    {pending ? <Spinner /> : <Undo2 />}
                    {t`Undo`}
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

function Loading() {
  return (
    <div className="grid h-24 place-items-center">
      <Spinner />
    </div>
  );
}
