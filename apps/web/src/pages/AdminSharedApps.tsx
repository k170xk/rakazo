import { Trans, useLingui } from "@lingui/react/macro";
import type { SharedAppAdmin } from "@rakazo/contracts";
import { Button, Spinner, toast } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

/**
 * Every page and app colleagues or link visitors can open. Freezing one closes its link and its
 * Evolve plugin straight away and stops it being shared again; the owner keeps their own copy.
 */
export function SharedAppsSection() {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const list = useQuery(queries.companyAdmin.sharedApps.list.queryOptions());
  const [busy, setBusy] = useState<string | null>(null);

  async function setFrozen(app: SharedAppAdmin, frozen: boolean) {
    setBusy(app.id);
    try {
      const next = await rpc.companyAdmin.sharedApps.setFrozen({ pageId: app.id, frozen });
      queryClient.setQueryData(
        queries.companyAdmin.sharedApps.list.queryKey(),
        (current: SharedAppAdmin[] | undefined) =>
          current?.map((item) => (item.id === next.id ? next : item)),
      );
      toast.success(frozen ? t`Frozen` : t`Unfrozen`);
    } catch (error) {
      toast.error(errorText(error, t`Could not change it`));
    } finally {
      setBusy(null);
    }
  }

  const reach = (app: SharedAppAdmin) =>
    [
      app.visibility === "link"
        ? t`Colleagues with the link`
        : app.visibility === "public"
          ? t`Anyone with the link and password`
          : null,
      app.evolvePluginSlug ? t`Evolve plugin ${app.evolvePluginSlug}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <section className="space-y-6" data-testid="shared-apps">
      <div>
        <h2 className="text-base font-medium">
          <Trans>Shared apps</Trans>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <Trans>
            Pages and apps people have shared by link or published to Evolve. Freeze one to take it
            offline for everyone else at once; its owner keeps their copy and can't share it again
            until you unfreeze it.
          </Trans>
        </p>
      </div>
      {list.isPending ? (
        <Spinner />
      ) : list.error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorText(list.error, t`Could not load shared apps`)}
        </p>
      ) : !list.data?.length ? (
        <p className="text-sm text-muted-foreground">
          <Trans>Nothing is shared right now.</Trans>
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {list.data.map((app) => (
            <li key={app.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{app.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {app.kind === "app" ? t`App` : t`Page`} · {app.owner}
                  {reach(app) ? ` · ${reach(app)}` : ""}
                  {app.frozenAt
                    ? ` · ${t`Frozen ${i18n.date(new Date(app.frozenAt), { dateStyle: "medium" })}`}`
                    : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant={app.frozenAt ? "outline" : "destructive"}
                disabled={busy !== null}
                onClick={() => void setFrozen(app, !app.frozenAt)}
              >
                {app.frozenAt ? <Trans>Unfreeze</Trans> : <Trans>Freeze</Trans>}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
