import { Trans, useLingui } from "@lingui/react/macro";
import type { CompanyAdminState, StaffAppState } from "@rakazo/contracts";
import { pluginStaffKey, staffPluginEnabled } from "@rakazo/contracts";
import { Badge, Input, NativeSelect, NativeSelectOption, Spinner, toast } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

/** Which apps and plugins staff can connect, see as coming soon, or not see at all. */
export function StaffAppsSection({
  state,
  onSaved,
}: {
  state: CompanyAdminState;
  onSaved: (next: CompanyAdminState) => Promise<void>;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const apps = useQuery(queries.connections.companyApps.queryOptions());
  const marketplace = useQuery(
    queries.marketplace.catalog.queryOptions({
      input: { query: "", staffView: false },
      staleTime: 60_000,
    }),
  );
  const plugins = (marketplace.data?.entries ?? []).filter((entry) => entry.hasConnector);
  const [pluginQuery, setPluginQuery] = useState("");
  const shownPlugins = plugins.filter((entry) =>
    `${entry.displayName} ${entry.category ?? ""}`
      .toLowerCase()
      .includes(pluginQuery.trim().toLowerCase()),
  );
  const [busy, setBusy] = useState<string | null>(null);

  async function choose(key: string, value: StaffAppState) {
    // The first save turns the list on, so it carries every app's current choice with it.
    const next: Record<string, StaffAppState> = {};
    for (const app of apps.data ?? []) if (app.state !== "hidden") next[app.slug] = app.state;
    for (const [stored, choice] of Object.entries(state.staffApps ?? {}))
      if (stored.startsWith("plugin:") && choice !== "hidden") next[stored] = choice;
    if (value === "hidden") delete next[key];
    else next[key] = value;
    setBusy(key);
    try {
      await onSaved(await rpc.companyAdmin.setTools({ staffApps: next }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queries.connections.companyApps.key() }),
        queryClient.invalidateQueries({ queryKey: queries.marketplace.catalog.key() }),
      ]);
    } catch (err) {
      toast.error(errorText(err, t`Could not update the app`));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
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
                <AppLogo name={app.name} logo={app.logo} />
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
                  onChange={(event) => void choose(app.slug, event.target.value as StaffAppState)}
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

      <div className="space-y-2">
        <h3 className="px-1 text-sm font-medium">
          <Trans>Plugins for staff</Trans>
        </h3>
        <p className="px-1 text-[13px] text-muted-foreground">
          {state.staffApps ? (
            <Trans>
              Plugins from the catalog that connect an app, such as Stripe, Figma or Cal.com. Staff
              see only the ones enabled here, and add them while Plugins is on. Skill-only packs
              follow Staff skills.
            </Trans>
          ) : (
            <Trans>
              Staff see every plugin until you save a choice on this page. After that they see only
              the ones enabled here.
            </Trans>
          )}
        </p>
        {marketplace.isPending ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : plugins.length === 0 ? (
          <p className="px-1 text-[13px] text-muted-foreground">
            <Trans>No plugins are in the catalog.</Trans>
          </p>
        ) : (
          <>
            <Input
              value={pluginQuery}
              onChange={(event) => setPluginQuery(event.target.value)}
              aria-label={t`Search plugins`}
              placeholder={t`Search plugins`}
            />
            <ul className="rk-scroll max-h-[480px] divide-y divide-border overflow-y-auto rounded-xl border border-border">
              {shownPlugins.map((entry) => {
                const enabled = staffPluginEnabled(state.staffApps, entry.installedSource);
                return (
                  <li key={entry.installedSource} className="flex items-center gap-4 px-4 py-3">
                    <AppLogo name={entry.displayName} logo={entry.logo} tile="accent" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {entry.displayName}
                      </span>
                      <span className="block truncate text-[13px] text-muted-foreground">
                        {entry.description}
                      </span>
                    </span>
                    <NativeSelect
                      aria-label={t`Staff access to ${entry.displayName}`}
                      value={enabled ? "enabled" : "hidden"}
                      disabled={busy !== null}
                      onChange={(event) =>
                        void choose(
                          pluginStaffKey(entry.installedSource),
                          event.target.value as StaffAppState,
                        )
                      }
                    >
                      <NativeSelectOption value="enabled">{t`Enabled`}</NativeSelectOption>
                      <NativeSelectOption value="hidden">{t`Hidden`}</NativeSelectOption>
                    </NativeSelect>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function AppLogo({
  name,
  logo,
  tile = "white",
}: {
  name: string;
  logo: string | null;
  tile?: "white" | "accent";
}) {
  return logo ? (
    <span
      className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
        tile === "white" ? "border border-border bg-white p-1.5" : "bg-accent"
      }`}
    >
      <img src={logo} alt="" className="size-full object-contain" />
    </span>
  ) : (
    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-sm font-semibold text-foreground">
      {name[0]}
    </span>
  );
}
