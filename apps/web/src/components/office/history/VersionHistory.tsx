import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Spinner } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, History, X } from "lucide-react";
import { useState } from "react";
import { useSpaceQueries } from "../../../lib/query";
import { formatRelativeTime } from "../../../lib/relative-time";
import { pill } from "../../studio/StudioFrame";
import { fetchDownload } from "../word/upload";
import type { VersionRow } from "../word/versions";
import type { HistoryFormat } from "./format";
import { createSnapshotCache } from "./format";

/** Newest versions whose change summary loads as soon as the history opens. */
const SUMMARY_ROWS = 6;

const caches = new WeakMap<object, ReturnType<typeof createSnapshotCache>>();

function cacheFor(format: object) {
  let cache = caches.get(format);
  if (!cache) {
    cache = createSnapshotCache();
    caches.set(format, cache);
  }
  return cache;
}

/** The header button that opens and closes the history panel. */
export function HistoryButton({
  open,
  disabled,
  onOpenChange,
}: {
  open: boolean;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  return (
    <button
      type="button"
      data-testid="office-history"
      disabled={disabled}
      aria-pressed={open}
      aria-label={t`Version history`}
      onClick={() => onOpenChange(!open)}
      className={`${pill} disabled:opacity-40 aria-pressed:bg-foreground/[0.06]`}
    >
      <History className="size-4" strokeWidth={1.8} />
      <span className="max-sm:sr-only">
        <Trans>History</Trans>
      </span>
    </button>
  );
}

function useVersionDiff<S, D>(
  format: HistoryFormat<S, D> & { id: string },
  row: VersionRow,
  previous: VersionRow | null,
  enabled: boolean,
  fetchVersion: (artifactId: string) => Promise<Uint8Array>,
) {
  return useQuery({
    queryKey: ["office-version-diff", format.id, row.artifactId, previous?.artifactId ?? null],
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60_000,
    retry: 1,
    queryFn: async () => {
      const cache = cacheFor(format) as (id: string, load: () => Promise<S>) => Promise<S>;
      const read = (artifactId: string) =>
        cache(artifactId, async () => format.read(await fetchVersion(artifactId)));
      const [before, after] = await Promise.all([
        previous ? read(previous.artifactId) : Promise.resolve(null),
        read(row.artifactId),
      ]);
      return format.compare(before, after);
    },
  });
}

/**
 * Every saved version, newest first, laid out like the App Studio's history: who made it, when,
 * and what it changed. Opening one shows its changes against the version before it.
 */
export function VersionHistoryPanel<S, D>({
  format,
  rows,
  restoring,
  onRestore,
  onClose,
}: {
  format: HistoryFormat<S, D> & { id: string };
  rows: readonly VersionRow[];
  /** The version being restored, while it is. */
  restoring: number | null;
  onRestore: (row: VersionRow) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const fetchVersion = async (artifactId: string) => {
    const { url } = await queries.artifacts.downloadToken.call({ artifactId });
    return new Uint8Array(await fetchDownload(url));
  };
  const [open, setOpen] = useState<number | null>(null);
  return (
    <aside
      aria-label={t`Version history`}
      data-testid="office-history-panel"
      className="absolute inset-0 z-20 flex min-h-0 flex-col border-foreground/[0.06] bg-card sm:start-auto sm:w-[min(46vw,560px)] sm:border-s"
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-foreground/[0.06] px-3">
        <span className="text-[14px] font-medium">
          <Trans>Version history</Trans>
        </span>
        <button
          type="button"
          aria-label={t`Close version history`}
          onClick={onClose}
          className="grid size-9 place-items-center rounded-full hover:bg-foreground/[0.06]"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex flex-col gap-2 p-3">
          <p className="px-1 text-[12px] text-muted-foreground">
            {t`Every save is a version. Open one to see what it changed; restoring keeps the current version too.`}
          </p>
          <ol className="flex flex-col">
            {rows.map((row, index) => (
              <VersionEntry
                key={row.artifactId}
                format={format}
                row={row}
                previous={rows[index + 1] ?? null}
                summarize={index < SUMMARY_ROWS}
                expanded={open === row.version}
                onToggle={() => setOpen(open === row.version ? null : row.version)}
                restoring={restoring}
                onRestore={onRestore}
                fetchVersion={fetchVersion}
              />
            ))}
          </ol>
        </div>
      </div>
    </aside>
  );
}

function VersionEntry<S, D>({
  format,
  row,
  previous,
  summarize,
  expanded,
  onToggle,
  restoring,
  onRestore,
  fetchVersion,
}: {
  format: HistoryFormat<S, D> & { id: string };
  row: VersionRow;
  previous: VersionRow | null;
  summarize: boolean;
  expanded: boolean;
  onToggle: () => void;
  restoring: number | null;
  onRestore: (row: VersionRow) => void;
  fetchVersion: (artifactId: string) => Promise<Uint8Array>;
}) {
  const { t } = useLingui();
  const diff = useVersionDiff(format, row, previous, summarize || expanded, fetchVersion);
  const who = row.author === "assistant" ? t`Assistant` : row.author === "you" ? t`You` : null;
  const when = formatRelativeTime(row.createdAt);
  const summary = diff.data ? format.summary(diff.data) : null;
  const restoreButton = (
    <Button
      size="sm"
      variant="outline"
      disabled={restoring !== null}
      onClick={() => onRestore(row)}
      aria-label={t`Restore version ${row.version}`}
    >
      {restoring === row.version ? <Spinner /> : null}
      {t`Restore`}
    </Button>
  );
  return (
    <li className="rounded-lg hover:bg-foreground/[0.02]" data-testid="office-version">
      <div className="flex items-center gap-2 px-1 py-1.5">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-start"
        >
          {expanded ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-foreground/[0.05] text-[11px] font-medium tabular-nums">
            {row.version}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] text-foreground">
              {summary ?? t`Version ${row.version}`}
            </span>
            <span
              className="block truncate text-[11.5px] text-muted-foreground"
              title={new Date(row.createdAt).toLocaleString()}
            >
              {[who, when].filter(Boolean).join(" · ")}
            </span>
          </span>
        </button>
        {row.latest ? (
          <span className="px-2 text-[12px] font-medium text-primary">{t`Current`}</span>
        ) : (
          restoreButton
        )}
      </div>
      {expanded ? (
        <div className="px-1 pb-3">
          {diff.isPending ? (
            <div className="grid h-24 place-items-center">
              <Spinner />
            </div>
          ) : diff.data ? (
            <>
              {previous ? null : (
                <p className="pb-2 text-[12px] text-muted-foreground">
                  {t`The first version: everything in it is new.`}
                </p>
              )}
              <format.View diff={diff.data} />
              {row.latest ? null : <div className="flex justify-end pt-2">{restoreButton}</div>}
            </>
          ) : (
            <p role="alert" className="px-1 py-2 text-[12px] text-destructive">
              {t`The changes in this version couldn't be shown.`}
            </p>
          )}
        </div>
      ) : null}
    </li>
  );
}
