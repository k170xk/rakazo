import { Trans, useLingui } from "@lingui/react/macro";
import type { Audience, CompanyAdminState, StaffAppState } from "@rakazo/contracts";
import {
  COMPANY_APPS,
  catalogItemKey,
  pluginStaffKey,
  staffPluginEnabled,
} from "@rakazo/contracts";
import { Badge, Input, NativeSelect, NativeSelectOption, Spinner, toast } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { PluginLogo } from "../components/integrations/plugin-marketplace";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { AudienceControl } from "./AdminAccess";

type AppKind = "company" | "app" | "plugin" | "directory";

type AppRow = {
  /** The staffApps key, or the integrations.sh domain for a directory service. */
  key: string;
  kind: AppKind;
  name: string;
  logo: string | null;
  site: string | null;
  detail: string;
  state: StaffAppState;
  audienceKey: string;
  connected: boolean;
};

const COMPANY_SLUGS = new Set<string>(COMPANY_APPS.map((app) => app.slug));

/**
 * Every app, plugin and directory service staff could see, in one list. Each keeps the setting
 * it always had: company and managed apps and plugins in staffApps, directory services in
 * catalogItems, and who can use one in appAudiences.
 */
export function AppsList({
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
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [onlyOn, setOnlyOn] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setSearched(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  const directoryProbe = useQuery({
    queryKey: ["company-directory-configured"],
    queryFn: () => rpc.capabilities.catalogSearch({ query: "", manage: true }),
    staleTime: 5 * 60_000,
  });
  const directoryOn = directoryProbe.data?.configured === true;
  const directorySearch = useQuery({
    queryKey: ["company-catalog", searched],
    enabled: directoryOn && searched.length > 0,
    queryFn: () =>
      rpc.capabilities.catalogSearch({ query: searched, browse: true, manage: true, limit: 20 }),
  });

  const plugins = useMemo(
    () => (marketplace.data?.entries ?? []).filter((entry) => entry.hasConnector),
    [marketplace.data],
  );

  const rows = useMemo(() => {
    const words = searched.toLowerCase();
    const matches = (text: string) => !words || text.toLowerCase().includes(words);
    const list: AppRow[] = [];
    for (const app of apps.data ?? []) {
      const company = COMPANY_SLUGS.has(app.slug);
      list.push({
        key: app.slug,
        kind: company ? "company" : "app",
        name: app.name,
        logo: app.logo,
        site: null,
        detail: app.ready ? "" : t`Not set up yet. Staff see it as being set up until it is.`,
        state: app.state,
        audienceKey: app.slug,
        connected: app.connected,
      });
    }
    for (const entry of plugins) {
      const key = pluginStaffKey(entry.installedSource);
      const on = staffPluginEnabled(state.staffApps, entry.installedSource);
      // With the directory as the catalogue, a plugin is listed only while it is still on.
      if (directoryOn && !(state.staffApps && on)) continue;
      list.push({
        key,
        kind: "plugin",
        name: entry.displayName,
        logo: entry.logo,
        site: entry.homepage,
        detail: entry.description,
        state: on ? "enabled" : "hidden",
        audienceKey: key,
        connected: false,
      });
    }
    const enabledDomains = new Set(Object.keys(state.catalogItems));
    const found = new Map(
      (directorySearch.data?.results ?? []).map((item) => [item.domain.toLowerCase(), item]),
    );
    for (const domain of enabledDomains) {
      const item = found.get(domain);
      list.push({
        key: domain,
        kind: "directory",
        name: item?.name ?? domain,
        logo: null,
        site: `https://${domain}`,
        detail: item?.description ?? domain,
        state: "enabled",
        audienceKey: catalogItemKey(domain),
        connected: false,
      });
    }
    const shown = list.filter(
      (row) =>
        matches(`${row.name} ${row.key} ${row.detail}`) && (!onlyOn || row.state !== "hidden"),
    );
    if (!onlyOn) {
      for (const [domain, item] of found) {
        if (enabledDomains.has(domain)) continue;
        shown.push({
          key: domain,
          kind: "directory",
          name: item.name,
          logo: null,
          site: `https://${domain}`,
          detail: item.description || domain,
          state: "hidden",
          audienceKey: catalogItemKey(domain),
          connected: false,
        });
      }
    }
    const rank = (row: AppRow) => (row.state === "hidden" ? 1 : 0);
    return shown.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [
    apps.data,
    plugins,
    state.staffApps,
    state.catalogItems,
    directoryOn,
    directorySearch.data,
    searched,
    onlyOn,
    t,
  ]);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queries.connections.companyApps.key() }),
      queryClient.invalidateQueries({ queryKey: queries.marketplace.catalog.key() }),
    ]);
  }

  async function save(key: string, work: () => Promise<CompanyAdminState>, failed: string) {
    setBusy(key);
    try {
      await onSaved(await work());
      await refresh();
    } catch (err) {
      toast.error(errorText(err, failed));
    } finally {
      setBusy(null);
    }
  }

  /** Until an admin first saves, staff see every managed app and plugin, so the first save keeps them. */
  function savedApps(): Record<string, StaffAppState> {
    if (state.staffApps) return { ...state.staffApps };
    const next: Record<string, StaffAppState> = {};
    for (const app of apps.data ?? []) if (app.state !== "hidden") next[app.slug] = app.state;
    for (const entry of plugins) next[pluginStaffKey(entry.installedSource)] = "enabled";
    return next;
  }

  function choose(row: AppRow, value: StaffAppState) {
    if (row.kind === "directory") {
      const catalogItems = { ...state.catalogItems };
      if (value === "hidden") delete catalogItems[row.key];
      else catalogItems[row.key] = "enabled";
      return save(
        row.key,
        () => rpc.companyAdmin.setTools({ catalogItems }),
        t`Could not update the app`,
      );
    }
    const staffApps = savedApps();
    if (value === "hidden") delete staffApps[row.key];
    else staffApps[row.key] = value;
    return save(
      row.key,
      () => rpc.companyAdmin.setTools({ staffApps }),
      t`Could not update the app`,
    );
  }

  function limit(row: AppRow, audience: Audience | undefined) {
    const appAudiences = { ...state.access.appAudiences };
    if (audience) appAudiences[row.audienceKey] = audience;
    else delete appAudiences[row.audienceKey];
    return save(
      row.key,
      () => rpc.companyAdmin.setTools({ appAudiences }),
      t`Could not update who can use this app`,
    );
  }

  const kindLabel: Record<AppKind, string> = {
    company: t`OCSC app`,
    app: t`App`,
    plugin: t`Plugin`,
    directory: t`Directory`,
  };
  const loading = apps.isPending || marketplace.isPending;
  const searching = directorySearch.isFetching;

  return (
    <div className="space-y-2">
      <p className="px-1 text-[13px] text-muted-foreground">
        {state.staffApps ? (
          <Trans>
            Staff see only what is on here, in Connectors, for everyone or the people and groups
            you choose. Coming soon shows an app with a badge. Admins always see every app, to test.
          </Trans>
        ) : (
          <Trans>
            Staff see every managed app and plugin until you change one here. After that they see
            only the ones that are on.
          </Trans>
        )}
      </p>
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t`Search connectors`}
          placeholder={directoryOn ? t`Search connectors and the directory` : t`Search connectors`}
        />
        <NativeSelect
          aria-label={t`Show`}
          value={onlyOn ? "on" : "all"}
          onChange={(event) => setOnlyOn(event.target.value === "on")}
        >
          <NativeSelectOption value="all">{t`All`}</NativeSelectOption>
          <NativeSelectOption value="on">{t`On for staff`}</NativeSelectOption>
        </NativeSelect>
      </div>
      {loading ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : (
        <ul
          data-testid="admin-apps"
          className="rk-scroll max-h-[640px] divide-y divide-border overflow-y-auto rounded-xl border border-border"
        >
          {rows.map((row) => (
            <li
              key={`${row.kind}:${row.key}`}
              data-testid={`admin-app-${row.key}`}
              className="flex items-center gap-4 px-4 py-3"
            >
              <PluginLogo name={row.name} logo={row.logo} site={row.site} />
              <div className="min-w-0 flex-1 space-y-2">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <span className="truncate">{row.name}</span>
                  <span className="shrink-0 text-[12px] font-normal text-muted-foreground">
                    {kindLabel[row.kind]}
                  </span>
                  {row.connected ? (
                    <Badge variant="secondary">
                      <Trans>Connected</Trans>
                    </Badge>
                  ) : null}
                </span>
                {row.detail ? (
                  <span className="block truncate text-[13px] text-muted-foreground">
                    {row.detail}
                  </span>
                ) : null}
                {row.state === "enabled" ? (
                  <AudienceControl
                    name={row.name}
                    audience={state.access.appAudiences[row.audienceKey]}
                    state={state}
                    disabled={busy !== null}
                    onChange={(audience) => limit(row, audience)}
                  />
                ) : null}
              </div>
              <NativeSelect
                aria-label={t`Staff access to ${row.name}`}
                value={row.state}
                disabled={busy !== null}
                onChange={(event) => void choose(row, event.target.value as StaffAppState)}
              >
                <NativeSelectOption value="enabled">{t`On`}</NativeSelectOption>
                {row.kind === "company" || row.kind === "app" ? (
                  <NativeSelectOption value="soon">{t`Coming soon`}</NativeSelectOption>
                ) : null}
                <NativeSelectOption value="hidden">{t`Off`}</NativeSelectOption>
              </NativeSelect>
            </li>
          ))}
          {searching ? (
            <li className="flex justify-center px-4 py-3">
              <Spinner />
            </li>
          ) : null}
          {rows.length === 0 && !searching ? (
            <li className="px-4 py-3 text-[13px] text-muted-foreground">
              {searched ? <Trans>No apps match your search.</Trans> : <Trans>No apps yet.</Trans>}
            </li>
          ) : null}
        </ul>
      )}
      {directorySearch.isError ? (
        <p className="px-1 text-[13px] text-destructive">
          {errorText(directorySearch.error, t`Could not search catalog`)}
        </p>
      ) : null}
    </div>
  );
}
