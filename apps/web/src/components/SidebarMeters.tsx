import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useSpaceQueries } from "../lib/query";
import { openStorageDialog } from "../lib/storage-prompt";

const RECHECK_MS = 30 * 60_000;

function usageLeft(usedPercent: number) {
  if (usedPercent >= 100) return <Trans>None left</Trans>;
  const left = 100 - usedPercent;
  return <Trans>{left}% left</Trans>;
}

function formatSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Storage and monthly allowance under the to-do list. The allowance is a percentage only;
 * the amount stays in company admin.
 */
export function SidebarMeters({
  mini,
  onOpenStorage,
}: {
  mini: boolean;
  onOpenStorage?: () => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const meters = useQuery({
    ...queries.computer.myMeters.queryOptions(),
    staleTime: RECHECK_MS / 2,
    refetchInterval: RECHECK_MS,
  });
  const data = meters.data;
  if (!data) return null;
  const storageShare = data.limitBytes > 0 ? Math.min(1, data.usedBytes / data.limitBytes) : 0;
  const storageFull = storageShare >= 0.8;
  const usage = data.usagePercent;
  const open = () => {
    onOpenStorage?.();
    openStorageDialog();
  };

  if (mini) {
    return (
      <div className="flex flex-col items-center gap-1.5 px-2 pt-1">
        <Meter
          label={t`Storage`}
          share={storageShare}
          warn={storageFull}
          onClick={open}
          testId="sidebar-storage"
        />
        {usage === null ? null : (
          <Meter
            label={t`Usage`}
            share={usage / 100}
            warn={usage >= 100}
            testId="sidebar-usage"
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 px-2.5 pt-1 pb-1">
      <button
        type="button"
        onClick={open}
        data-testid="sidebar-storage"
        className="block w-full rounded-lg px-2.5 py-1.5 text-start hover:bg-accent"
      >
        <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span>
            <Trans>Storage</Trans>
          </span>
          <span className="tabular-nums">
            {formatSize(data.usedBytes)} / {formatSize(data.limitBytes)}
          </span>
        </span>
        <Bar
          share={storageShare}
          warn={storageFull}
          label={t`Storage used`}
          value={Math.round(storageShare * 100)}
        />
      </button>
      {usage === null ? null : (
        <div className="px-2.5 py-1.5" data-testid="sidebar-usage">
          <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
            <span>
              <Trans>Usage</Trans>
            </span>
            <span className="tabular-nums">{usageLeft(usage)}</span>
          </span>
          <Bar share={usage / 100} warn={usage >= 100} label={t`Usage`} value={usage} />
        </div>
      )}
    </div>
  );
}

function Meter({
  label,
  share,
  warn,
  onClick,
  testId,
}: {
  label: string;
  share: number;
  warn: boolean;
  onClick?: () => void;
  testId: string;
}) {
  const bar = (
    <Bar share={share} warn={warn} label={label} value={Math.round(share * 100)} />
  );
  if (!onClick) {
    return (
      <div className="w-full px-1" data-testid={testId} title={label}>
        {bar}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="w-full rounded px-1 py-1 hover:bg-accent"
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={onClick}
    >
      {bar}
    </button>
  );
}

function Bar({
  share,
  warn,
  label,
  value,
}: {
  share: number;
  warn: boolean;
  label: string;
  value: number;
}) {
  return (
    <span
      className="mt-1 block h-1.5 overflow-hidden rounded-full bg-border"
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span
        className={warn ? "block h-full bg-destructive" : "block h-full bg-primary"}
        style={{ width: `${Math.min(100, Math.max(0, share * 100))}%` }}
      />
    </span>
  );
}
