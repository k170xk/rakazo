import { Trans, useLingui } from "@lingui/react/macro";
import type { CompanyAdminState, CompanyApp, StaffAppState } from "@rakazo/contracts";
import { Badge, NativeSelect, NativeSelectOption, Spinner, toast } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

/** Which apps staff can connect, see as coming soon, or not see at all. */
export function StaffAppsSection({
  onSaved,
}: {
  onSaved: (next: CompanyAdminState) => Promise<void>;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const apps = useQuery(queries.connections.companyApps.queryOptions());
  const [busy, setBusy] = useState<string | null>(null);

  async function choose(app: CompanyApp, state: StaffAppState) {
    const current = apps.data ?? [];
    const staffApps = Object.fromEntries(
      current
        .map((entry): [string, StaffAppState] => [
          entry.slug,
          entry.slug === app.slug ? state : entry.state,
        ])
        .filter(([, value]) => value !== "hidden"),
    );
    setBusy(app.slug);
    try {
      await onSaved(await rpc.companyAdmin.setTools({ staffApps }));
      await queryClient.invalidateQueries({ queryKey: queries.connections.companyApps.key() });
    } catch (err) {
      toast.error(errorText(err, t`Could not update the app`));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="px-1 text-sm font-medium">
        <Trans>Apps for staff</Trans>
      </h3>
      <p className="px-1 text-[13px] text-muted-foreground">
        <Trans>
          Enabled apps can be connected. Coming soon apps show to staff with a badge. Hidden apps
          are not shown, and their tools are not offered to staff assistants. Admins always see
          every app, to test.
        </Trans>
      </p>
      {apps.isPending ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {(apps.data ?? []).map((app) => (
            <li key={app.slug} className="flex items-center gap-4 px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-white p-1.5">
                {app.logo ? (
                  <img src={app.logo} alt="" className="size-full object-contain" />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {app.name}
                  {app.connected ? (
                    <Badge variant="secondary">
                      <Trans>Connected</Trans>
                    </Badge>
                  ) : null}
                </span>
                <span className="block text-[13px] text-muted-foreground">
                  {app.ready ? (
                    <Trans>Ready to connect.</Trans>
                  ) : (
                    <Trans>Not set up yet. Staff see it as being set up until it is.</Trans>
                  )}
                </span>
              </span>
              <NativeSelect
                aria-label={t`Staff access to ${app.name}`}
                value={app.state}
                disabled={busy !== null}
                onChange={(event) => void choose(app, event.target.value as StaffAppState)}
              >
                <NativeSelectOption value="enabled">{t`Enabled`}</NativeSelectOption>
                <NativeSelectOption value="soon">{t`Coming soon`}</NativeSelectOption>
                <NativeSelectOption value="hidden">{t`Hidden`}</NativeSelectOption>
              </NativeSelect>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
