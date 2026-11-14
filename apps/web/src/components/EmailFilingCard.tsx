import { Trans, useLingui } from "@lingui/react/macro";
import type {
  EmailFilingBatch,
  EmailFilingItem,
  EmailFilingProfile,
  EmailFilingProject,
  EmailFilingRetarget,
} from "@rakazo/contracts";
import { Button, cn, Input, NativeSelect, NativeSelectOption, Spinner } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BookMarked,
  ExternalLink,
  FolderInput,
  FolderPlus,
  Paperclip,
  Undo2,
} from "lucide-react";
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

/** Name and address from "Ada Lovelace <ada@example.com>", or the whole string when it is already an address. */
export function filingSender(from: string): { address: string; name: string | null } {
  const match = /^(.*?)\s*<([^>]+)>\s*$/.exec(from.trim());
  if (!match?.[2]) return { address: from.trim(), name: null };
  const address = match[2].trim();
  const name = match[1]?.trim() ?? "";
  return { address, name: name && name.toLowerCase() !== address.toLowerCase() ? name : null };
}

/** The folder the email is heading to, split so the destination itself is the line you read. */
function filingDestination(
  item: EmailFilingItem,
): { parents: string; leaf: string; path: string } | null {
  const path =
    item.status === "filed" && item.filedPath
      ? item.filedPath
      : item.target?.kind === "project"
        ? `${item.target.parentPath} › ${item.target.folderName}`
        : item.target?.kind === "folder"
          ? item.target.path
          : null;
  if (!path) return null;
  const parts = path
    .split(" › ")
    .map((part) => part.trim())
    .filter(Boolean);
  return { parents: parts.slice(0, -1).join(" › "), leaf: parts.at(-1) ?? path, path };
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
  const [memoryOpen, setMemoryOpen] = useState(false);

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
        <Button
          variant="ghost"
          size="xs"
          aria-expanded={memoryOpen}
          onClick={() => setMemoryOpen((open) => !open)}
        >
          <BookMarked size={12} /> <Trans>Memory</Trans>
        </Button>
        <span className="text-[12.5px] text-muted-foreground">
          <Trans>Ready at {batch.threshold}%</Trans>
        </span>
      </div>
      {memoryOpen ? <FilingMemory /> : null}
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
                    className="mt-3.5 size-4 shrink-0 accent-primary"
                    aria-label={t`Select ${item.subject}`}
                    checked={selected.has(item.id)}
                    disabled={!selectable(item) || locked}
                    onChange={(event) => toggle(item.id, event.target.checked)}
                  />
                ) : null}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <FilingRoute
                    item={item}
                    threshold={batch.threshold}
                    dateLabel={dateLabel(i18n, item.receivedAt)}
                  />
                  {item.reason || item.evidence.length ? (
                    <details className="text-[12.5px] text-muted-foreground">
                      <summary className="cursor-pointer select-none truncate">
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
                  <div className="flex flex-wrap items-center gap-1">
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

function FilingMemory() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const options = queries.emailFiling.settings.get.queryOptions({ input: {} });
  const profile = useQuery(options);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function keep(next: EmailFilingProfile) {
    queryClient.setQueryData(options.queryKey, next);
  }

  async function remember() {
    const value = text.trim();
    if (value.length < 3) return;
    setBusy(true);
    setError(null);
    try {
      keep(await rpc.emailFiling.settings.remember({ text: value }));
      setText("");
    } catch (err) {
      setError(errorText(err, t`Could not save this instruction`));
    } finally {
      setBusy(false);
    }
  }

  async function forget(kind: "memory" | "rule", id: string) {
    setBusy(true);
    setError(null);
    try {
      keep(
        kind === "memory"
          ? await rpc.emailFiling.settings.forgetMemory({ memoryId: id })
          : await rpc.emailFiling.settings.removeRule({ ruleId: id }),
      );
    } catch (err) {
      setError(errorText(err, t`Could not forget that`));
    } finally {
      setBusy(false);
    }
  }

  const memories = profile.data?.memories ?? [];
  const rules = profile.data?.rules ?? [];

  return (
    <div className="space-y-2 border-b border-border bg-muted/40 px-4 py-3">
      <p className="font-medium">
        <Trans>What filing remembers</Trans>
      </p>
      <p className="text-[12.5px] text-muted-foreground">
        <Trans>
          Filing reads these the next time it chooses a folder. An instruction guides that choice. A
          sender, domain or conversation rule is ready on its own.
        </Trans>
      </p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void remember();
        }}
      >
        <Input
          aria-label={t`Add an instruction filing should follow`}
          placeholder={t`Graduate applications from careers@ go in Inbox › HR`}
          value={text}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={busy || text.trim().length < 3}>
          {busy ? <Spinner /> : <Trans>Remember</Trans>}
        </Button>
      </form>
      {profile.isPending ? <Spinner /> : null}
      {profile.isError ? (
        <p className="text-[12.5px] text-destructive">
          {errorText(profile.error, t`Could not load what filing remembers`)}
        </p>
      ) : null}
      {profile.data && memories.length === 0 && rules.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">
          <Trans>Nothing remembered yet.</Trans>
        </p>
      ) : null}
      {memories.length > 0 ? (
        <MemoryList
          title={t`Instructions`}
          items={memories.map((memory) => ({ id: memory.id, label: memory.text }))}
          busy={busy}
          onForget={(id) => void forget("memory", id)}
        />
      ) : null}
      {rules.length > 0 ? (
        <MemoryList
          title={t`Rules`}
          items={rules.map((rule) => ({
            id: rule.id,
            label: `${rule.label} → ${rule.folderPath}`,
          }))}
          busy={busy}
          onForget={(id) => void forget("rule", id)}
        />
      ) : null}
      {error ? <p className="text-[12.5px] text-destructive">{error}</p> : null}
    </div>
  );
}

function MemoryList({
  title,
  items,
  busy,
  onForget,
}: {
  title: string;
  items: Array<{ id: string; label: string }>;
  busy: boolean;
  onForget: (id: string) => void;
}) {
  const { t } = useLingui();
  return (
    <div className="space-y-1">
      <p className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex max-w-full items-center gap-1 rounded-full bg-background px-2.5 py-1 text-[12.5px]"
          >
            <span className="min-w-0 break-words">{item.label}</span>
            <button
              type="button"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={t`Forget ${item.label}`}
              disabled={busy}
              onClick={() => onForget(item.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
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
            : "bg-background text-muted-foreground",
      )}
    >
      {value}%
    </span>
  );
}

function dateLabel(
  i18n: { date: (value: Date, options: { dateStyle: "medium" }) => string },
  receivedAt: string | null,
) {
  return receivedAt ? i18n.date(new Date(receivedAt), { dateStyle: "medium" }) : null;
}

const pill = "flex min-w-0 flex-1 items-center gap-2 rounded-full bg-muted px-3 py-2";

function FilingRoute({
  item,
  threshold,
  dateLabel: when,
}: {
  item: EmailFilingItem;
  threshold: number;
  dateLabel: string | null;
}) {
  const { t } = useLingui();
  const sender = filingSender(item.from);
  const skipped = item.status === "skipped";
  const filed = item.status === "filed" && Boolean(item.filedPath);
  const creating = item.target?.kind === "project" && !filed;
  const destination = skipped ? null : filingDestination(item);
  const path = destination?.path ?? "";
  const destinationLabel = skipped
    ? t`Skipped; left where it is.`
    : filed && item.filedPath
      ? t`Filed in ${item.filedPath}`
      : creating && destination
        ? t`New folder: ${path}`
        : destination
          ? destination.path
          : t`No folder suggested.`;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className={pill} title={item.from}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] leading-5">
            <span className="font-medium">{sender.address}</span>
            {sender.name ? <span className="text-muted-foreground"> {sender.name}</span> : null}
            {when ? <span className="text-muted-foreground"> · {when}</span> : null}
            {item.source === "sentitems" ? (
              <span className="text-muted-foreground"> · {t`Sent`}</span>
            ) : null}
            {item.hasAttachments ? (
              <Paperclip
                size={12}
                className="ms-1 inline align-[-1px] text-muted-foreground"
                aria-label={t`Has attachments`}
              />
            ) : null}
          </p>
          <p className="line-clamp-2 font-medium leading-5" title={item.subject}>
            {item.subject}
          </p>
        </div>
        <ConfidencePill value={item.confidence} threshold={threshold} />
      </div>
      <ArrowRight
        size={16}
        aria-hidden
        className="mx-auto shrink-0 rotate-90 text-muted-foreground"
      />
      <div className={cn(pill, !destination && "text-muted-foreground")} title={destinationLabel}>
        {creating ? (
          <FolderPlus size={14} className="shrink-0" />
        ) : (
          <FolderInput size={14} className="shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          {destination?.parents ? (
            <p className="truncate text-[11.5px] leading-4 text-muted-foreground">
              {destination.parents}
            </p>
          ) : null}
          <p className="line-clamp-2 font-medium leading-5">
            {destination?.leaf ?? destinationLabel}
          </p>
          {creating ? (
            <p className="truncate text-[11.5px] leading-4 text-muted-foreground">
              <Trans>New folder</Trans>
            </p>
          ) : null}
        </div>
      </div>
    </div>
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
