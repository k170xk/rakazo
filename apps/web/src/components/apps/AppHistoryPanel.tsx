import { useLingui } from "@lingui/react/macro";
import { Button, Spinner } from "@rakazo/ui-web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSpaceQueries } from "../../lib/query";

/** Every saved version of the app's code; restoring one keeps it as a new version. */
export function AppHistoryPanel({ pageId, current }: { pageId: string; current: number }) {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const versions = useQuery(queries.apps.versions.queryOptions({ input: { pageId } }));
  const restore = useMutation({
    mutationFn: (version: number) => queries.apps.restore.call({ pageId, version }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queries.apps.key() });
      void queryClient.invalidateQueries({ queryKey: queries.pages.get.key() });
    },
  });
  if (versions.isPending) {
    return (
      <div className="grid h-40 place-items-center">
        <Spinner />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 p-3">
      <p className="px-1 pb-2 text-[12px] text-muted-foreground">
        {t`Code changes are versioned. Data is not: restoring a version keeps today's rows.`}
      </p>
      {restore.isError ? (
        <p role="alert" className="px-1 pb-2 text-[12px] text-destructive">
          {t`That version couldn't be restored.`}
        </p>
      ) : null}
      {(versions.data ?? []).map((entry) => (
        <div
          key={entry.version}
          className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-foreground/[0.03]"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-foreground/[0.05] text-[12px] font-medium tabular-nums">
            {entry.version}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] text-foreground">{entry.title}</p>
            <p className="text-[12px] text-muted-foreground">
              {i18n.date(entry.createdAt, { dateStyle: "medium", timeStyle: "short" })}
            </p>
          </div>
          {entry.version === current ? (
            <span className="text-[12px] font-medium text-primary">{t`Current`}</span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={restore.isPending}
              onClick={() => restore.mutate(entry.version)}
            >
              {t`Restore`}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
