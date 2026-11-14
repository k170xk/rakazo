import { Trans, useLingui } from "@lingui/react/macro";
import type {
  EmailFilingBatch,
  EmailFilingItem,
  EmailFilingProject,
  EmailFilingRetarget,
} from "@rakazo/contracts";
import { Button, cn, Input, NativeSelect, NativeSelectOption, Spinner } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FolderInput, FolderPlus, Paperclip, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

type Tab = "ready" | "decide" | "done";

const selectable = (item: EmailFilingItem) =>
  item.target !== null && (item.status === "proposed" || item.status === "failed");

export function tabOf(item: EmailFilingItem): Tab {
  if (item.status === "filed" || item.status === "skipped" || item.status === "gone") return "done";
  return item.ready ? "ready" : "decide";
}

/** Only Outlook's own https links open from the card. */
function outlookLink(link: string | null): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function EmailFilingCard({ batchId }: { batchId: string }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const options = queries.emailFiling.get.queryOptions({ input: { id: batchId } });
  const state = useQuery({ ...options, staleTime: 30_000 });
  const batch = state.data;

  if (state.isPending) {
    return (
      <div className="flex w-[640px] max-w-full items-center gap-2 rounded-[20px] bg-card px-4 py-3 text-sm text-muted-foreground">
        <Spinner /> <Trans>Loading email filing</Trans>
      </div>
    );
  }
  if (!batch) {
    return (
      <div className="w-[640px] max-w-full rounded-[20px] bg-card px-4 py-3 text-sm text-muted-foreground">
        {errorText(state.error, t`This filing card is not available`)}
      </div>
    );
  }
  return (
    <FilingBoard batch={batch} apply={(next) => queryClient.setQueryData(options.queryKey, next)} />
  );
}

function FilingBoard({
  batch,
  apply,
}: {
  batch: EmailFilingBatch;
  apply: (next: EmailFilingBatch) => void;
}) {
  const { t, i18n } = useLingui();
  const counts = useMemo(() => {
    const result: Record<Tab, number> = { ready: 0, decide: 0, done: 0 };
    for (const item of batch.items) result[tabOf(item)]++;
    return result;
  }, [batch.items]);
  const [tab, setTab] = useState<Tab>(() =>
    counts.ready > 0 ? "ready" : counts.decide > 0 ? "decide" : "done",
  );
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(batch.items.filter((item) => item.ready && selectable(item)).map((item) => item.id)),
  );
  const [picking, setPicking] = useState<string | null>(null);
  const [busy, setBusy] = useState<"file" | "skip" | "undo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelected((current) => {
      const allowed = new Set(batch.items.filter(selectable).map((item) => item.id));
      const next = new Set([...current].filter((id) => allowed.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [batch.items]);

  const shown = batch.items.filter((item) => tabOf(item) === tab);
  const chosen = batch.items.filter((item) => selected.has(item.id) && selectable(item));
  const locked = Boolean(batch.cannotFile) || busy !== null;

  function toggle(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function run(kind: "file" | "skip" | "undo", itemIds: string[]) {
    if (itemIds.length === 0) return;
    setBusy(kind);
    setError(null);
    try {
      const input = { id: batch.id, itemIds };
      const next =
        kind === "file"
          ? await rpc.emailFiling.file(input)
          : kind === "skip"
            ? await rpc.emailFiling.skip(input)
            : await rpc.emailFiling.undo(input);
      apply(next);
      if (kind !== "undo") setSelected(new Set());
    } catch (err) {
      setError(
        errorText(
          err,
          kind === "file"
            ? t`Could not file these emails`
            : kind === "skip"
              ? t`Could not skip these emails`
              : t`Could not put these emails back`,
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "ready", label: t`Ready` },
    { id: "decide", label: t`Needs a decision` },
    { id: "done", label: t`Done` },
  ];

  return (
    <div
      data-testid="email-filing-card"
      className="w-[640px] max-w-full overflow-hidden rounded-[20px] border border-border bg-card text-sm"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <FolderInput size={16} className="shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 font-medium">
          <Trans>File Outlook email</Trans>
        </p>
        <span className="text-[12.5px] text-muted-foreground">
          <Trans>Ready at {batch.threshold}%</Trans>
        </span>
      </div>
      {batch.cannotFile ? (
        <p role="status" className="border-b border-border bg-muted/50 px-4 py-2 text-[13px]">
          {batch.cannotFile}
        </p>
      ) : null}
      <div role="tablist" aria-label={t`Filing groups`} className="flex gap-1 px-3 pt-2">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={cn(
              "rounded-full px-3 py-1 text-[13px] transition-colors",
              tab === entry.id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60",
            )}
          >
            {entry.label} <span className="tabular-nums opacity-70">{counts[entry.id]}</span>
          </button>
        ))}
      </div>
      <ul className="max-h-[440px] divide-y divide-border overflow-y-auto px-1 py-1">
        {shown.length === 0 ? (
          <li className="px-3 py-4 text-[13px] text-muted-foreground">
            {tab === "ready" ? (
              <Trans>Nothing is ready to file.</Trans>
            ) : tab === "decide" ? (
              <Trans>Nothing needs your decision.</Trans>
            ) : (
              <Trans>Nothing filed yet.</Trans>
            )}
          </li>
        ) : (
          shown.map((item) => (
            <li key={item.id} className="px-3 py-2.5" data-testid={`filing-item-${item.id}`}>
              <div className="flex items-start gap-3">
                {tab !== "done" ? (
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-primary"
                    aria-label={t`Select ${item.subject}`}
                    checked={selected.has(item.id)}
                    disabled={!selectable(item) || locked}
                    onChange={(event) => toggle(item.id, event.target.checked)}
                  />
                ) : null}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 truncate font-medium" title={item.subject}>
                      {item.subject}
                    </p>
                    <ConfidencePill value={item.confidence} threshold={batch.threshold} />
                  </div>
                  <p className="truncate text-[12.5px] text-muted-foreground">
                    {item.from}
                    {item.receivedAt
                      ? ` · ${i18n.date(new Date(item.receivedAt), { dateStyle: "medium" })}`
                      : ""}
                    {item.source === "sentitems" ? ` · ${t`Sent`}` : ""}
                    {item.hasAttachments ? (
                      <Paperclip
                        size={12}
                        className="ms-1 inline align-[-1px]"
                        aria-label={t`Has attachments`}
                      />
                    ) : null}
                  </p>
                  <TargetLine item={item} />
                  {item.reason || item.evidence.length ? (
                    <details className="text-[12.5px] text-muted-foreground">
                      <summary className="cursor-pointer select-none">
                        {item.reason || t`Why`}
                      </summary>
                      <ul className="mt-1 list-disc space-y-0.5 ps-5">
                        {item.evidence.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {item.error ? (
                    <p className="text-[12.5px] text-destructive">{item.error}</p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-1 pt-0.5">
                    {outlookLink(item.webLink) ? (
                      <a
                        href={outlookLink(item.webLink) ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12.5px] text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <ExternalLink size={12} /> <Trans>Open in Outlook</Trans>
                      </a>
                    ) : null}
                    {item.status === "proposed" || item.status === "failed" ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={locked}
                        onClick={() => setPicking(picking === item.id ? null : item.id)}
                      >
                        {item.target ? <Trans>Change folder</Trans> : <Trans>Choose folder</Trans>}
                      </Button>
                    ) : null}
                    {item.canUndo ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={busy !== null || Boolean(batch.cannotFile)}
                        onClick={() => void run("undo", [item.id])}
                      >
                        <Undo2 size={12} /> <Trans>Undo</Trans>
                      </Button>
                    ) : null}
                  </div>
                  {picking === item.id ? (
                    <FilingTargetPicker
                      batch={batch}
                      item={item}
                      onDone={(next) => {
                        apply(next);
                        setPicking(null);
                        const updated = next.items.find((entry) => entry.id === item.id);
                        if (updated && selectable(updated)) toggle(item.id, true);
                      }}
                      onCancel={() => setPicking(null)}
                    />
                  ) : null}
                </div>
              </div>
            </li>
          ))
        )}
      </ul>
      {error ? (
        <p role="alert" className="px-4 pb-1 text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
      {counts.ready + counts.decide > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={locked}
            onClick={() =>
              setSelected(
                new Set(
                  batch.items
                    .filter((item) => item.ready && selectable(item))
                    .map((item) => item.id),
                ),
              )
            }
          >
            <Trans>Select ready</Trans>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={locked}
            onClick={() =>
              setSelected(new Set(batch.items.filter(selectable).map((item) => item.id)))
            }
          >
            <Trans>Select all</Trans>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={locked || selected.size === 0}
            onClick={() => setSelected(new Set())}
          >
            <Trans>Clear</Trans>
          </Button>
          <span className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            disabled={locked || chosen.length === 0}
            onClick={() =>
              void run(
                "skip",
                chosen.map((item) => item.id),
              )
            }
          >
            {busy === "skip" ? <Spinner /> : <Trans>Skip</Trans>}
          </Button>
          <Button
            size="sm"
            disabled={locked || chosen.length === 0}
            onClick={() =>
              void run(
                "file",
                chosen.map((item) => item.id),
              )
            }
          >
            {busy === "file" ? <Spinner /> : <Trans>File {chosen.length} selected</Trans>}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ConfidencePill({ value, threshold }: { value: number; threshold: number }) {
  const { t } = useLingui();
  return (
    <span
      title={t`Confidence`}
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-medium tabular-nums",
        value >= threshold
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
          : value >= 70
            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
            : "bg-muted text-muted-foreground",
      )}
    >
      {value}%
    </span>
  );
}

function TargetLine({ item }: { item: EmailFilingItem }) {
  if (item.status === "filed" && item.filedPath) {
    return (
      <p className="flex items-center gap-1 text-[12.5px]">
        <FolderInput size={12} className="shrink-0" />
        <span className="truncate">
          <Trans>Filed in {item.filedPath}</Trans>
        </span>
      </p>
    );
  }
  if (item.status === "skipped") {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        <Trans>Skipped; left where it is.</Trans>
      </p>
    );
  }
  if (!item.target) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        <Trans>No folder suggested.</Trans>
      </p>
    );
  }
  if (item.target.kind === "project") {
    const path = `${item.target.parentPath} › ${item.target.folderName}`;
    return (
      <p className="flex items-center gap-1 text-[12.5px]">
        <FolderPlus size={12} className="shrink-0" />
        <span className="truncate" title={path}>
          <Trans>New folder: {path}</Trans>
        </span>
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1 text-[12.5px]">
      <FolderInput size={12} className="shrink-0" />
      <span className="truncate" title={item.target.path}>
        {item.target.path}
      </span>
    </p>
  );
}

function FilingTargetPicker({
  batch,
  item,
  onDone,
  onCancel,
}: {
  batch: EmailFilingBatch;
  item: EmailFilingItem;
  onDone: (next: EmailFilingBatch) => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const folders = useQuery({
    ...queries.emailFiling.folders.queryOptions({ input: {} }),
    staleTime: 60_000,
  });
  const [search, setSearch] = useState("");
  const [remember, setRemember] = useState<EmailFilingRetarget["remember"]>("none");
  const [projects, setProjects] = useState<EmailFilingProject[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchSeq = useRef(0);

  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matching = (folders.data?.folders ?? [])
    .filter((folder) => words.every((word) => folder.path.toLowerCase().includes(word)))
    .slice(0, 40);

  useEffect(() => {
    const query = search.trim();
    if (query.length < 2) {
      setProjects(null);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      setSearching(true);
      rpc.emailFiling
        .searchProjects({ search: query })
        .then((result) => {
          if (seq === searchSeq.current) setProjects(result.projects);
        })
        .catch(() => {
          if (seq === searchSeq.current) setProjects([]);
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  async function choose(target: EmailFilingRetarget["target"]) {
    setBusy(true);
    setError(null);
    try {
      onDone(await rpc.emailFiling.retarget({ id: batch.id, itemId: item.id, target, remember }));
    } catch (err) {
      setError(errorText(err, t`Could not change the folder`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1 space-y-2 rounded-xl border border-border bg-background p-2.5">
      <Input
        autoFocus
        aria-label={t`Search folders or Evolve projects`}
        placeholder={t`Search folders, or an Evolve job number or title`}
        value={search}
        disabled={busy}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="max-h-56 space-y-2 overflow-y-auto">
        <div>
          <p className="px-1 pb-1 text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
            <Trans>Your folders</Trans>
          </p>
          {folders.isPending ? (
            <Spinner />
          ) : folders.isError ? (
            <p className="px-1 text-[12.5px] text-destructive">
              {errorText(folders.error, t`Could not load your folders`)}
            </p>
          ) : matching.length === 0 ? (
            <p className="px-1 text-[12.5px] text-muted-foreground">
              <Trans>No folder matches.</Trans>
            </p>
          ) : (
            <ul>
              {matching.map((folder) => (
                <li key={folder.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void choose({ kind: "folder", folderId: folder.id })}
                    className="w-full truncate rounded-md px-1.5 py-1 text-start text-[13px] hover:bg-accent"
                    title={folder.path}
                  >
                    {folder.path}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {projects !== null || searching ? (
          <div>
            <p className="px-1 pb-1 text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
              <Trans>Evolve projects</Trans>
            </p>
            {searching ? (
              <Spinner />
            ) : projects && projects.length > 0 ? (
              <ul>
                {projects.map((project) => (
                  <li key={project.jobNumber}>
                    <button
                      type="button"
                      disabled={busy || (!project.folderId && !batch.allowFolderCreation)}
                      onClick={() =>
                        void choose(
                          project.folderId
                            ? { kind: "folder", folderId: project.folderId }
                            : { kind: "project", jobNumber: project.jobNumber },
                        )
                      }
                      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-start text-[13px] hover:bg-accent disabled:opacity-50"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {project.jobNumber} – {project.title}
                        {project.client ? (
                          <span className="text-muted-foreground"> · {project.client}</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-[11.5px] text-muted-foreground">
                        {project.folderId ? t`Has a folder` : t`New folder`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-1 text-[12.5px] text-muted-foreground">
                <Trans>No Evolve project matches.</Trans>
              </p>
            )}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          aria-label={t`Remember this choice`}
          className="max-w-64"
          value={remember}
          disabled={busy}
          onChange={(event) => setRemember(event.target.value as EmailFilingRetarget["remember"])}
        >
          <NativeSelectOption value="none">{t`Just this email`}</NativeSelectOption>
          <NativeSelectOption value="sender">{t`Remember for this sender`}</NativeSelectOption>
          <NativeSelectOption value="domain">{t`Remember for this sender's domain`}</NativeSelectOption>
          <NativeSelectOption value="conversation">
            {t`Remember for this conversation`}
          </NativeSelectOption>
        </NativeSelect>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
      </div>
      {error ? <p className="text-[12.5px] text-destructive">{error}</p> : null}
    </div>
  );
}
