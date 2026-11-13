import { Trans, useLingui } from "@lingui/react/macro";
import type { Audience, CompanyAdminState } from "@rakazo/contracts";
import { catalogItemKey } from "@rakazo/contracts";
import { Input, NativeSelect, NativeSelectOption, Spinner, toast } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { AudienceControl } from "./AdminAccess";

/** Which integrations.sh services staff can add, and who among them can. */
export function CatalogSection({
  state,
  onSaved,
}: {
  state: CompanyAdminState;
  onSaved: (next: CompanyAdminState) => Promise<void>;
}) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  const search = useQuery({
    queryKey: ["company-catalog", debounced],
    enabled: debounced.length > 0,
    queryFn: () =>
      rpc.capabilities.catalogSearch({ query: debounced, browse: true, manage: true, limit: 20 }),
  });
  const enabled = Object.keys(state.catalogItems).sort();

  async function choose(domain: string, on: boolean) {
    const key = domain.trim().toLowerCase();
    const catalogItems = { ...state.catalogItems };
    if (on) catalogItems[key] = "enabled";
    else delete catalogItems[key];
    setBusy(key);
    try {
      await onSaved(await rpc.companyAdmin.setTools({ catalogItems }));
    } catch (err) {
      toast.error(errorText(err, t`Could not update the directory`));
    } finally {
      setBusy(null);
    }
  }

  async function limit(domain: string, audience: Audience | undefined) {
    const key = catalogItemKey(domain);
    const appAudiences = { ...state.access.appAudiences };
    if (audience) appAudiences[key] = audience;
    else delete appAudiences[key];
    setBusy(key);
    try {
      await onSaved(await rpc.companyAdmin.setTools({ appAudiences }));
    } catch (err) {
      toast.error(errorText(err, t`Could not update who can use this`));
    } finally {
      setBusy(null);
    }
  }

  const found = (search.data?.results ?? []).filter(
    (item) => !enabled.includes(item.domain.toLowerCase()),
  );

  return (
    <div className="space-y-2">
      <h3 className="px-1 text-sm font-medium">
        <Trans>Directory for staff</Trans>
      </h3>
      <p className="px-1 text-[13px] text-muted-foreground">
        <Trans>
          Services from the integrations directory. Nothing is shown until you enable it. Everyone
          means the whole company, or limit it to people and groups. Admins can connect anything
          enabled here.
        </Trans>
      </p>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label={t`Search the directory`}
        placeholder={t`Search the directory`}
      />
      {search.isFetching ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : search.isError ? (
        <p className="px-1 text-[13px] text-destructive">
          {errorText(search.error, t`Could not search catalog`)}
        </p>
      ) : null}
      <ul className="rk-scroll max-h-[480px] divide-y divide-border overflow-y-auto rounded-xl border border-border">
        {enabled.map((domain) => (
          <CatalogRow
            key={domain}
            domain={domain}
            name={domain}
            description=""
            enabled
            audience={state.access.appAudiences[catalogItemKey(domain)]}
            state={state}
            busy={busy !== null}
            onChoose={choose}
            onLimit={limit}
          />
        ))}
        {found.map((item) => (
          <CatalogRow
            key={item.domain}
            domain={item.domain}
            name={item.name}
            description={item.description}
            enabled={false}
            state={state}
            busy={busy !== null}
            onChoose={choose}
            onLimit={limit}
          />
        ))}
        {enabled.length === 0 && found.length === 0 && !search.isFetching ? (
          <li className="px-4 py-3 text-[13px] text-muted-foreground">
            <Trans>Search for a service, then enable it.</Trans>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function CatalogRow({
  domain,
  name,
  description,
  enabled,
  audience,
  state,
  busy,
  onChoose,
  onLimit,
}: {
  domain: string;
  name: string;
  description: string;
  enabled: boolean;
  audience?: Audience;
  state: CompanyAdminState;
  busy: boolean;
  onChoose: (domain: string, on: boolean) => Promise<void>;
  onLimit: (domain: string, audience: Audience | undefined) => Promise<void>;
}) {
  const { t } = useLingui();
  return (
    <li className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-2">
        <span className="block truncate text-sm font-medium">{name}</span>
        {description ? (
          <span className="block truncate text-[13px] text-muted-foreground">{description}</span>
        ) : (
          <span className="block truncate text-[13px] text-muted-foreground">{domain}</span>
        )}
        {enabled ? (
          <AudienceControl
            name={name}
            audience={audience}
            state={state}
            disabled={busy}
            onChange={(next) => onLimit(domain, next)}
          />
        ) : null}
      </div>
      <NativeSelect
        aria-label={t`Staff access to ${name}`}
        value={enabled ? "enabled" : "hidden"}
        disabled={busy}
        onChange={(event) => void onChoose(domain, event.target.value === "enabled")}
      >
        <NativeSelectOption value="enabled">{t`Enabled`}</NativeSelectOption>
        <NativeSelectOption value="hidden">{t`Hidden`}</NativeSelectOption>
      </NativeSelect>
    </li>
  );
}
