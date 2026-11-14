import { Trans } from "@lingui/react/macro";
import type { DocumentRevision } from "@rakazo/contracts";
import type { UseQueryResult } from "@tanstack/react-query";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { downloadTokenUrl, fetchDownload } from "./word/upload";

const RUNNING_POLL_MS = 1200;
const IDLE_POLL_MS = 10_000;

/** The assistant's unsent write to the open file, parsed for read-only display. */
export type LiveDraft<T> = { updatedAt: string; baseVersion: number; value: T };

/**
 * Polls the open file's newest version, quickly while the assistant works, and while it works
 * loads its live draft when that is newer than the version shown. The draft is dropped when the
 * run ends or once the studio shows a version past the draft's base.
 */
export function useLiveDraft<T>(options: {
  rootArtifactId: string;
  enabled: boolean;
  running: boolean;
  /** The version the studio shows; undefined while nothing is open. */
  shownVersion: number | undefined;
  parse: (bytes: ArrayBuffer) => Promise<T>;
}): { revision: UseQueryResult<DocumentRevision>; draft: LiveDraft<T> | null } {
  const { rootArtifactId, enabled, running, shownVersion } = options;
  const queries = useSpaceQueries();
  const [loaded, setLoaded] = useState<LiveDraft<T> | null>(null);
  const parse = useRef(options.parse);
  parse.current = options.parse;
  const pending = useRef<string | null>(null);
  const family = useRef(rootArtifactId);
  family.current = rootArtifactId;

  // A new run or file starts with no draft.
  useEffect(() => {
    setLoaded(null);
    pending.current = null;
  }, [running, rootArtifactId]);

  const revision = useQuery({
    ...queries.documents.revision.queryOptions({
      input: loaded ? { rootArtifactId, draftSeen: loaded.updatedAt } : { rootArtifactId },
    }),
    enabled,
    refetchInterval: running ? RUNNING_POLL_MS : IDLE_POLL_MS,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });

  const offered = revision.data?.draft;
  const token = offered?.downloadToken;
  const offeredAt = offered?.updatedAt;
  const offeredBase = offered?.baseVersion;
  useEffect(() => {
    if (!running || !token || offeredAt === undefined || offeredBase === undefined) return;
    if (shownVersion === undefined || offeredBase < shownVersion) return;
    if (pending.current === offeredAt) return;
    pending.current = offeredAt;
    const forFamily = rootArtifactId;
    void (async () => {
      try {
        const value = await parse.current(await fetchDownload(downloadTokenUrl(token)));
        if (family.current !== forFamily || pending.current !== offeredAt) return;
        setLoaded({ updatedAt: offeredAt, baseVersion: offeredBase, value });
      } catch {
        // The next poll offers a fresh token.
        if (pending.current === offeredAt) pending.current = null;
      }
    })();
  }, [running, token, offeredAt, offeredBase, shownVersion, rootArtifactId]);

  const newest = revision.data?.version ?? 0;
  const showing =
    running &&
    loaded !== null &&
    shownVersion !== undefined &&
    shownVersion <= loaded.baseVersion &&
    (offered !== undefined || newest > shownVersion);
  return { revision, draft: showing ? loaded : null };
}

/** Says the studio shows the assistant's live draft rather than a saved version. */
export function LiveDraftPill({ className = "" }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-x-0 flex justify-center ${className}`}>
      <span
        className="flex items-center gap-1.5 rounded-full bg-background/95 px-3 py-1 text-[12px] font-medium text-primary shadow-sm ring-1 ring-border"
        aria-live="polite"
        data-testid="office-live-draft"
      >
        <Radio className="size-3.5 animate-pulse" aria-hidden="true" />
        <Trans>Assistant draft (live)</Trans>
      </span>
    </div>
  );
}
