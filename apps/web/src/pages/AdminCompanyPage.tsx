import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type {
  CompanyAdminState,
  CompanyFeatureId,
  CompanyFeatures,
  ModelCatalogEntry,
} from "@rakazo/contracts";
import {
  Badge,
  Button,
  buttonVariants,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
  Spinner,
  Switch,
  toast,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { PageLoading } from "../components/PageLoading";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { CompanyToolsSection } from "./AdminCompanyTools";
import { CompanyComputerAccessSection } from "./AdminComputerAccess";
import { StaffSpendingSection } from "./AdminStaffSpending";
import { WindowChrome } from "./WindowChrome";

export function AdminCompanyPage() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const me = useQuery(queries.me.queryOptions());
  if (me.isPending) return <PageLoading />;
  if (!me.data?.isAdmin) return <Navigate to="/app" replace />;
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <WindowChrome />
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <Link
          to="/app"
          className={buttonVariants({ variant: "ghost", size: "icon" })}
          aria-label={t`Back`}
        >
          <ChevronLeft />
        </Link>
        <h1 className="flex-1 font-medium">
          <Trans>Company admin</Trans>
        </h1>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-10 px-4 py-6">
          <CompanyAdminPanels />
        </div>
      </main>
    </div>
  );
}

function CompanyAdminPanels() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const state = useQuery(queries.companyAdmin.get.queryOptions());

  async function saved(next: CompanyAdminState) {
    queryClient.setQueryData(queries.companyAdmin.get.queryKey(), next);
    // Me carries the switches and model readiness the rest of the app reads.
    await queryClient.invalidateQueries({ queryKey: queries.me.key() });
  }

  if (state.isPending)
    return (
      <div className="grid place-items-center py-10">
        <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
      </div>
    );
  if (state.isError)
    return (
      <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
        {errorText(state.error, t`Couldn't load company settings`)}
        <Button variant="outline" size="sm" onClick={() => void state.refetch()}>
          <Trans>Retry</Trans>
        </Button>
      </div>
    );
  return (
    <>
      <CompanyModelSection state={state.data} onSaved={saved} />
      <CompanyFeaturesSection state={state.data} onSaved={saved} />
      <CompanyToolsSection state={state.data} onSaved={saved} />
      <CompanyComputerAccessSection state={state.data} onSaved={saved} />
      <CompanyPeopleSection state={state.data} />
      <StaffSpendingSection />
    </>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-medium">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function CompanyModelSection({
  state,
  onSaved,
}: {
  state: CompanyAdminState;
  onSaved: (next: CompanyAdminState) => Promise<void>;
}) {
  const { t } = useLingui();
  const catalog = useQuery({
    queryKey: ["company-admin", "catalog"],
    queryFn: () => rpc.models.list(),
    staleTime: 60_000,
  });
  // A company key runs every member's chats, so subscription sign-ins are left out.
  const entries = useMemo(
    () =>
      (catalog.data ?? []).filter(
        (entry: ModelCatalogEntry) => entry.auth !== "oauth" && !entry.placeholder,
      ),
    [catalog.data],
  );
  const providers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of entries)
      if (!seen.has(entry.provider)) seen.set(entry.provider, entry.providerName ?? entry.provider);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [entries]);
  const current = state.model;
  const [provider, setProvider] = useState(current?.provider ?? "openai");
  const [modelId, setModelId] = useState(current?.modelId ?? "");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const models = entries.filter((entry) => entry.provider === provider);

  useEffect(() => {
    if (!models.length || models.some((entry) => entry.id === modelId)) return;
    setModelId(models.find((entry) => entry.recommended)?.id ?? models[0]?.id ?? "");
  }, [models, modelId]);

  const keepsKey = current !== null && current.provider === provider;
  const canSave = busy === null && provider && modelId && (apiKey.trim().length >= 8 || keepsKey);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    try {
      const next = await rpc.companyAdmin.setModel({
        provider,
        modelId,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setApiKey("");
      await onSaved(next);
      toast.success(t`Everyone now uses this model`);
    } catch (err) {
      toast.error(errorText(err, t`Could not save the company model`));
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    setBusy("clear");
    try {
      await onSaved(await rpc.companyAdmin.clearModel());
    } catch (err) {
      toast.error(errorText(err, t`Could not remove the company model`));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section
      title={t`Company model`}
      description={t`Every member's assistant runs on this model and key. Members are never asked to connect one.`}
    >
      {current ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm">
          <Badge variant="secondary">
            <Trans>Active</Trans>
          </Badge>
          <span className="font-medium">
            {current.providerName ?? current.provider} · {current.modelId}
          </span>
          {current.keyHint ? (
            <span className="text-muted-foreground">
              <Trans>Key ending {current.keyHint}</Trans>
            </span>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="ms-auto"
            disabled={busy !== null}
            onClick={() => void clear()}
          >
            {busy === "clear" ? <Trans>Removing…</Trans> : <Trans>Remove</Trans>}
          </Button>
        </div>
      ) : state.environmentModel ? (
        <p className="text-sm text-muted-foreground">
          <Trans>
            The server's own model is in use: {state.environmentModel.provider} ·{" "}
            {state.environmentModel.modelId}. Saving a company model here replaces it.
          </Trans>
        </p>
      ) : (
        <p role="status" className="text-sm text-destructive">
          <Trans>No model is set up yet. Members see a waiting screen until you save one.</Trans>
        </p>
      )}
      <form onSubmit={(event) => void save(event)} className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="company-provider">
            <Trans>Provider</Trans>
          </FieldLabel>
          <NativeSelect
            id="company-provider"
            value={provider}
            disabled={catalog.isPending}
            onChange={(event) => {
              setProvider(event.target.value);
              setModelId("");
              setApiKey("");
            }}
          >
            {providers.map(([id, name]) => (
              <NativeSelectOption key={id} value={id}>
                {name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="company-model">
            <Trans>Model</Trans>
          </FieldLabel>
          <NativeSelect
            id="company-model"
            value={modelId}
            disabled={!models.length}
            onChange={(event) => setModelId(event.target.value)}
          >
            {models.map((entry) => (
              <NativeSelectOption key={entry.id} value={entry.id}>
                {entry.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="company-key">
            <Trans>API key</Trans>
          </FieldLabel>
          <Input
            id="company-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            placeholder={keepsKey ? t`Leave blank to keep the saved key` : undefined}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <FieldDescription>
            <Trans>
              The key is checked with the provider, then stored encrypted on the server.
            </Trans>
          </FieldDescription>
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={!canSave}>
            {busy === "save" ? <Trans>Checking…</Trans> : <Trans>Save for everyone</Trans>}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function CompanyFeaturesSection({
  state,
  onSaved,
}: {
  state: CompanyAdminState;
  onSaved: (next: CompanyAdminState) => Promise<void>;
}) {
  const { t } = useLingui();
  const [busy, setBusy] = useState<CompanyFeatureId | null>(null);
  const rows: Array<{ id: CompanyFeatureId; label: string; description: string }> = [
    {
      id: "memberModels",
      label: t`Members choose models`,
      description: t`Off: only admins connect models or change a bot's model; everyone runs on the company model.`,
    },
    {
      id: "computers",
      label: t`Computers`,
      description: t`Each assistant's cloud computer, browser and files. Off also stops the OCSC PDF, Word and video skills.`,
    },
    {
      id: "connectedApps",
      label: t`Connected apps`,
      description: t`Members connect apps such as Gmail, Slack or Notion to their assistants.`,
    },
    {
      id: "plugins",
      label: t`Plugins`,
      description: t`Members install plugins from the catalog.`,
    },
    {
      id: "mcpServers",
      label: t`MCP servers`,
      description: t`Members add their own MCP servers.`,
    },
    {
      id: "messaging",
      label: t`Messaging`,
      description: t`Members link Slack, Telegram and other chat apps to their assistants.`,
    },
    {
      id: "routines",
      label: t`Routines`,
      description: t`Scheduled and recurring tasks.`,
    },
    {
      id: "evolvePlugins",
      label: t`Evolve plugins`,
      description: t`Staff with the Plugin builder privilege in Evolve build mini-apps here and send them to Evolve for review.`,
    },
    {
      id: "cursorAgents",
      label: t`Cursor cloud agents`,
      description: t`Assistants can hand coding work to Cursor cloud agents on the company's Cursor key, up to the monthly run cap.`,
    },
  ];

  async function toggle(id: CompanyFeatureId, value: boolean) {
    setBusy(id);
    try {
      const patch: Partial<CompanyFeatures> = { [id]: value };
      await onSaved(await rpc.companyAdmin.setFeatures(patch));
    } catch (err) {
      toast.error(errorText(err, t`Could not update the company setting`));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section
      title={t`Features`}
      description={t`These apply to everyone in the company and take effect within a few seconds.`}
    >
      <ul className="divide-y divide-border rounded-xl border border-border">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-4 px-4 py-3">
            <label htmlFor={`company-feature-${row.id}`} className="min-w-0 flex-1 cursor-pointer">
              <span className="block text-sm font-medium">{row.label}</span>
              <span className="block text-[13px] text-muted-foreground">{row.description}</span>
            </label>
            <Switch
              id={`company-feature-${row.id}`}
              checked={state.features[row.id]}
              disabled={busy !== null}
              onCheckedChange={(checked) => void toggle(row.id, checked)}
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function CompanyPeopleSection({ state }: { state: CompanyAdminState }) {
  const { t } = useLingui();
  return (
    <Section
      title={t`People`}
      description={t`Admins come from the server's RAKAZO_ADMIN_EMAILS setting.`}
    >
      <div className="space-y-2 text-sm">
        <p>
          <Plural value={state.staff.accounts} one="# account" other="# accounts" />
          {state.staff.withOwnModels > 0 ? (
            <span className="text-muted-foreground">
              {" · "}
              <Plural
                value={state.staff.withOwnModels}
                one="# still has their own model connection"
                other="# still have their own model connections"
              />
            </span>
          ) : null}
        </p>
        <ul className="flex flex-wrap gap-2">
          {state.admins.map((email) => (
            <li key={email}>
              <Badge variant="outline">{email}</Badge>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to="/admin/plugins" className={buttonVariants({ variant: "outline", size: "sm" })}>
          <Trans>Company plugins</Trans>
        </Link>
      </div>
    </Section>
  );
}
