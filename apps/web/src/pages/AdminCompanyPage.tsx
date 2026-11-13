import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type {
  Audience,
  AudienceFeatureId,
  CompanyAdminState,
  CompanyFeatureId,
  CompanyFeatures,
  ModelCatalogEntry,
} from "@rakazo/contracts";
import { isAudienceFeature } from "@rakazo/contracts";
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
import type { LucideIcon } from "lucide-react";
import {
  ChevronLeft,
  Cpu,
  FileText,
  Gauge,
  HardDrive,
  KeyRound,
  LayoutGrid,
  MessageSquare,
  Mic,
  Monitor,
  Receipt,
  Repeat,
  Server,
  Share2,
  ShieldCheck,
  ToggleRight,
  Users,
  Wrench,
} from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { PageLoading } from "../components/PageLoading";
import { thinkingLevelLabel } from "../lib/model-catalog";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { AccessGroupsSection, AudienceControl } from "./AdminAccess";
import { AppsList } from "./AdminApps";
import { CompanyAssistantModelsSection } from "./AdminAssistantModels";
import { CompanyToolsSection } from "./AdminCompanyTools";
import { CompanyVaultSection, CompanyVoiceSection } from "./AdminCompanyVoice";
import { CompanyComputerAccessSection, CompanyStorageSection } from "./AdminComputerAccess";
import { DocumentLibrarySection } from "./AdminDocumentLibrary";
import { EvolveSafeguardsSection } from "./AdminEvolveSafeguards";
import { RoutineActivitySection } from "./AdminRoutineActivity";
import { SharedAppsSection } from "./AdminSharedApps";
import { StaffLimitsSection } from "./AdminStaffLimits";
import { StaffSpendingSection } from "./AdminStaffSpending";
import { WindowChrome } from "./WindowChrome";

const ADMIN_SECTIONS = [
  "models",
  "features",
  "integrations",
  "mcp",
  "chat",
  "tools",
  "voice",
  "vault",
  "library",
  "safeguards",
  "apps",
  "computer",
  "storage",
  "people",
  "limits",
  "routines",
  "spending",
] as const;
type AdminSection = (typeof ADMIN_SECTIONS)[number];

function adminSectionFrom(hash: string): AdminSection {
  const id = hash.replace(/^#/, "");
  return (ADMIN_SECTIONS as readonly string[]).includes(id) ? (id as AdminSection) : "models";
}

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
      <CompanyAdminPanels />
    </div>
  );
}

function CompanyAdminPanels() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const state = useQuery(queries.companyAdmin.get.queryOptions());
  const { hash } = useLocation();
  const navigate = useNavigate();
  const section = adminSectionFrom(hash);
  const mainRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
    navRef.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [section]);

  const nav: { id: AdminSection; label: string; icon: LucideIcon }[] = [
    { id: "models", label: t`Model`, icon: Cpu },
    { id: "features", label: t`Features`, icon: ToggleRight },
    { id: "integrations", label: t`Apps`, icon: LayoutGrid },
    { id: "mcp", label: t`MCP servers`, icon: Server },
    { id: "chat", label: t`Chat`, icon: MessageSquare },
    { id: "tools", label: t`Tools and skills`, icon: Wrench },
    { id: "voice", label: t`Voice`, icon: Mic },
    { id: "vault", label: t`Company vault`, icon: KeyRound },
    { id: "library", label: t`Document library`, icon: FileText },
    { id: "safeguards", label: t`AI safeguards`, icon: ShieldCheck },
    { id: "apps", label: t`Shared apps`, icon: Share2 },
    { id: "computer", label: t`Computers`, icon: Monitor },
    { id: "storage", label: t`Storage and cleanup`, icon: HardDrive },
    { id: "people", label: t`People`, icon: Users },
    { id: "limits", label: t`Staff limits`, icon: Gauge },
    { id: "routines", label: t`Routines`, icon: Repeat },
    { id: "spending", label: t`Spending`, icon: Receipt },
  ];

  async function saved(next: CompanyAdminState) {
    queryClient.setQueryData(queries.companyAdmin.get.queryKey(), next);
    // Me carries the switches and model readiness the rest of the app reads, and the skill list
    // drops built-in skills and OCSC Tools that are switched off.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queries.me.key() }),
      queryClient.invalidateQueries({ queryKey: queries.agentSkills.list.queryKey() }),
    ]);
  }

  function panel(data: CompanyAdminState) {
    switch (section) {
      case "models":
        return (
          <div className="space-y-10">
            <CompanyModelSection state={data} onSaved={saved} />
            <CompanyAssistantModelsSection state={data} onSaved={saved} />
          </div>
        );
      case "features":
        return <CompanyFeaturesSection state={data} onSaved={saved} />;
      case "integrations":
        return <CompanyAppsSection state={data} onSaved={saved} />;
      case "mcp":
        return <CompanyMcpSection state={data} onSaved={saved} />;
      case "chat":
        return <CompanyChatSection state={data} onSaved={saved} />;
      case "tools":
        return <CompanyToolsSection state={data} onSaved={saved} />;
      case "voice":
        return <CompanyVoiceSection state={data} onSaved={saved} />;
      case "vault":
        return <CompanyVaultSection />;
      case "library":
        return <DocumentLibrarySection />;
      case "safeguards":
        return <EvolveSafeguardsSection />;
      case "apps":
        return <SharedAppsSection />;
      case "computer":
        return <CompanyComputerAccessSection state={data} onSaved={saved} />;
      case "storage":
        return <CompanyStorageSection state={data} onSaved={saved} />;
      case "people":
        return (
          <div className="space-y-10">
            <CompanyPeopleSection state={data} />
            <AccessGroupsSection state={data} onSaved={saved} />
          </div>
        );
      case "limits":
        return <StaffLimitsSection />;
      case "routines":
        return <RoutineActivitySection />;
      case "spending":
        return <StaffSpendingSection />;
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav
        ref={navRef}
        data-testid="admin-nav"
        aria-label={t`Company admin sections`}
        className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-border px-3 py-2 md:w-[220px] md:flex-col md:overflow-y-auto md:border-e md:border-b-0 md:bg-sidebar md:py-4"
      >
        {nav.map((item) => {
          const Icon = item.icon;
          const active = item.id === section;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`admin-nav-${item.id}`}
              aria-current={active ? "page" : undefined}
              onClick={() => navigate({ hash: item.id }, { replace: true })}
              className={`flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[13.5px] transition-colors ${
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.75} />
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          );
        })}
      </nav>
      <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
          {state.isPending ? (
            <div className="grid place-items-center py-10">
              <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
            </div>
          ) : state.isError ? (
            <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
              {errorText(state.error, t`Couldn't load company settings`)}
              <Button variant="outline" size="sm" onClick={() => void state.refetch()}>
                <Trans>Retry</Trans>
              </Button>
            </div>
          ) : (
            panel(state.data)
          )}
        </div>
      </main>
    </div>
  );
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 space-y-4">
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

  const active = current
    ? { provider: current.provider, modelId: current.modelId }
    : state.environmentModel;
  const thinkingLevels = (
    (catalog.data ?? []).find(
      (entry: ModelCatalogEntry) =>
        entry.provider === active?.provider && entry.id === active?.modelId,
    )?.thinkingLevels ?? []
  ).filter((level) => level !== "off");
  const [savingThinking, setSavingThinking] = useState(false);

  async function saveThinking(value: string) {
    setSavingThinking(true);
    try {
      const thinkingLevel = (thinkingLevels.find((level) => level === value) ??
        null) as CompanyAdminState["thinkingLevel"];
      await onSaved(await rpc.companyAdmin.setThinkingLevel({ thinkingLevel }));
      toast.success(t`Every bot now thinks at this level`);
    } catch (err) {
      toast.error(errorText(err, t`Could not save the thinking level`));
    } finally {
      setSavingThinking(false);
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
      id="models"
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
      {thinkingLevels.length ? (
        <Field className="max-w-sm">
          <FieldLabel htmlFor="company-thinking">
            <Trans>Thinking</Trans>
          </FieldLabel>
          <NativeSelect
            id="company-thinking"
            value={state.thinkingLevel ?? ""}
            disabled={savingThinking}
            onChange={(event) => void saveThinking(event.target.value)}
          >
            <NativeSelectOption value="">{t`Model default`}</NativeSelectOption>
            {thinkingLevels.map((level) => (
              <NativeSelectOption key={level} value={level}>
                {thinkingLevelLabel(level)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldDescription>
            <Trans>
              How hard every bot thinks before answering. Higher is better for hard problems but
              slower and costs more.
            </Trans>
          </FieldDescription>
        </Field>
      ) : null}
    </Section>
  );
}

type FeatureGroup = "models" | "computers" | "apps" | "people";

function CompanyFeaturesSection({
  state,
  onSaved,
}: {
  state: CompanyAdminState;
  onSaved: (next: CompanyAdminState) => Promise<void>;
}) {
  const { t } = useLingui();
  const rows: (CompanySwitchRow & { group: FeatureGroup })[] = [
    {
      id: "memberModels",
      group: "models",
      label: t`Members choose models`,
      description: t`Off: only admins connect models or change a bot's model; everyone runs on the company model.`,
    },
    {
      id: "computers",
      group: "computers",
      label: t`Computers`,
      description: t`Each assistant's cloud computer, browser and routines. Word, PowerPoint, Excel, PDF and video files keep working when off: they run on the company tool runners.`,
    },
    {
      id: "messaging",
      group: "apps",
      label: t`Messaging`,
      description: t`Members link Slack, Telegram and other chat apps to their assistants.`,
    },
    {
      id: "routines",
      group: "computers",
      label: t`Routines`,
      description: t`Scheduled and recurring tasks.`,
    },
    {
      id: "evolvePlugins",
      group: "apps",
      label: t`Evolve plugins`,
      description: t`Staff with the Plugin builder privilege in Evolve build mini-apps here and send them to Evolve for review.`,
    },
    {
      id: "outlookSend",
      group: "apps",
      label: t`Send Outlook email`,
      description: t`In their own private chat, assistants draft Outlook emails and replies as cards. The person edits the card and only their own press of Send sends it; assistants can never send. People without it are never offered drafting. Limit this to chosen people below.`,
    },
    {
      id: "accountData",
      group: "people",
      label: t`Export, import and delete accounts`,
      description: t`People see a Data section in their settings to export or import their account, import agents from other apps and delete their account.`,
    },
    {
      id: "staffSkills",
      group: "people",
      label: t`Staff skills`,
      description: t`Staff can write their own skills, browse skill packs and add them from GitHub. Off: only admins see those, and you add the skills. Each OCSC tool and built-in skill still has its own switch.`,
    },
    {
      id: "personalVault",
      group: "people",
      label: t`My vault`,
      description: t`People keep their own logins, cards, API keys and contacts, and their assistants can use them. Off for everyone until you turn this on. The company vault on this page is separate and stays available.`,
    },
    {
      id: "cursorAgents",
      group: "models",
      label: t`Cursor cloud agents`,
      description: t`Assistants can hand coding work to Cursor cloud agents on the company's Cursor key, up to the monthly run cap.`,
    },
    {
      id: "chatFileSearch",
      group: "models",
      label: t`Search chat files`,
      description: t`Word, PDF, PowerPoint and text files attached to a chat are indexed with OpenAI in the background, so assistants find the right passages quickly instead of rereading every file. Works while the company model runs on OpenAI. Off stops indexing and removes the indexes.`,
    },
  ];

  const groups: { id: FeatureGroup; title: string }[] = [
    { id: "models", title: t`Models and agents` },
    { id: "computers", title: t`Computers and routines` },
    { id: "apps", title: t`Messaging and Evolve` },
    { id: "people", title: t`What people manage themselves` },
  ];

  return (
    <Section
      title={t`Features`}
      description={t`Changes take effect within a few seconds. A switch that is on can be limited to chosen people and groups; admins can always use everything.`}
    >
      {groups.map((group) => (
        <div key={group.id} className="space-y-2">
          <h3 className="px-1 text-sm font-medium">{group.title}</h3>
          <CompanySwitchList
            rows={rows.filter((row) => row.group === group.id)}
            state={state}
            onSaved={onSaved}
          />
        </div>
      ))}
    </Section>
  );
}

function CompanyAppsSection({
  state,
  onSaved,
}: {
  state: CompanyAdminState;
  onSaved: (next: CompanyAdminState) => Promise<void>;
}) {
  const { t } = useLingui();
  return (
    <Section
      title={t`Apps`}
      description={t`Every app, plugin and directory service staff can add in Integrations, in one list.`}
    >
      <CompanySwitchList
        rows={[
          {
            id: "staffIntegrations",
            label: t`Integrations for staff`,
            description: t`Off: staff see Integrations as Coming soon and cannot add anything. Admins always can, to test.`,
          },
        ]}
        state={state}
        onSaved={onSaved}
      />
      <AppsList state={state} onSaved={onSaved} />
      <details className="group rounded-xl border border-border">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          <Trans>Switches for a whole kind of app</Trans>
        </summary>
        <div className="space-y-2 px-4 pb-4">
          <p className="text-[13px] text-muted-foreground">
            <Trans>
              These stop every app of one kind, even ones that are on in the list. Most companies
              leave them on.
            </Trans>
          </p>
          <CompanySwitchList
            rows={[
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
            ]}
            state={state}
            onSaved={onSaved}
          />
        </div>
      </details>
    </Section>
  );
}

function CompanyMcpSection({
  state,
  onSaved,
}: {
  state: CompanyAdminState;
  onSaved: (next: CompanyAdminState) => Promise<void>;
}) {
  const { t } = useLingui();
  return (
    <Section
      title={t`MCP servers`}
      description={t`MCP servers from the directory and company apps such as InfraGrid 3D are turned on under Apps.`}
    >
      <CompanySwitchList
        rows={[
          {
            id: "mcpServers",
            label: t`Add your own MCP server`,
            description: t`Shows Add custom in Integrations, so people can add any MCP server by its address. Limit it to chosen people and groups; admins see it only when they are included.`,
          },
        ]}
        state={state}
        onSaved={onSaved}
      />
    </Section>
  );
}

function CompanyChatSection({
  state,
  onSaved,
}: {
  state: CompanyAdminState;
  onSaved: (next: CompanyAdminState) => Promise<void>;
}) {
  const { t } = useLingui();
  const rows: CompanySwitchRow[] = [
    {
      id: "sendWithEnter",
      label: t`Send with Enter`,
      description: t`Enter sends a message on computers. On phones and tablets Enter always adds a new line.`,
    },
    {
      id: "streamReplies",
      label: t`Stream replies`,
      description: t`Replies appear as they are written instead of all at once.`,
    },
    {
      id: "toolActivity",
      label: t`Show tool activity`,
      description: t`Chats show a card for each tool a bot runs.`,
    },
    {
      id: "webImages",
      label: t`Load web images automatically`,
      description: t`Images from websites show in chats without a tap.`,
    },
  ];
  return (
    <Section
      title={t`Chat`}
      description={t`How chats behave for everyone in the company. People cannot change these.`}
    >
      <CompanySwitchList rows={rows} state={state} onSaved={onSaved} />
    </Section>
  );
}

type CompanySwitchRow = { id: CompanyFeatureId; label: string; description: string };

function CompanySwitchList({
  rows,
  state,
  onSaved,
}: {
  rows: CompanySwitchRow[];
  state: CompanyAdminState;
  onSaved: (next: CompanyAdminState) => Promise<void>;
}) {
  const { t } = useLingui();
  const [busy, setBusy] = useState<CompanyFeatureId | null>(null);

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

  async function limit(id: AudienceFeatureId, audience: Audience | undefined) {
    setBusy(id);
    try {
      const featureAudiences = { ...state.access.featureAudiences };
      if (audience) featureAudiences[id] = audience;
      else delete featureAudiences[id];
      await onSaved(await rpc.companyAdmin.setTools({ featureAudiences }));
    } catch (err) {
      toast.error(errorText(err, t`Could not update who can use this`));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-4 px-4 py-3">
          <div className="min-w-0 flex-1 space-y-2">
            <label htmlFor={`company-feature-${row.id}`} className="block cursor-pointer">
              <span className="block text-sm font-medium">{row.label}</span>
              <span className="block text-[13px] text-muted-foreground">{row.description}</span>
            </label>
            {isAudienceFeature(row.id) && state.features[row.id] ? (
              <AudienceControl
                name={row.label}
                audience={state.access.featureAudiences[row.id]}
                state={state}
                disabled={busy !== null}
                onChange={(audience) => limit(row.id as AudienceFeatureId, audience)}
              />
            ) : null}
          </div>
          <Switch
            id={`company-feature-${row.id}`}
            checked={state.features[row.id]}
            disabled={busy !== null}
            onCheckedChange={(checked) => void toggle(row.id, checked)}
          />
        </li>
      ))}
    </ul>
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
