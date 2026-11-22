import { Trans, useLingui } from "@lingui/react/macro";
import type {
  AdminDefaultAgent,
  AdminDefaultAgentsState,
  AdminVectorStore,
  AssistantSkillAttachment,
  CompanyAdminState,
  CompanyAssistantModel,
  ModelCatalogEntry,
  ThinkingLevel,
} from "@rakazo/contracts";
import {
  Badge,
  Button,
  Checkbox,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bot,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  Lock,
  Plus,
  ScrollText,
  Sliders,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { ChangeEvent } from "react";
import { useMemo, useRef, useState } from "react";
import { thinkingLevelLabel } from "../lib/model-catalog";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { CompanySkillEditorDialog } from "./AdminCompanySkills";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

type AgentDraft = {
  id: string | null;
  name: string;
  description: string;
  evolveModel: string;
  instructions: string;
  systemInstructions: string;
  standingInstructions: string;
  fileSearchEnabled: boolean;
  vectorStoreIds: string[];
  enablePeople: boolean;
  enableResponses: boolean;
  allowedGroupIds: string[];
  allowedUsers: number[];
  isLineManagerOnly: boolean;
  rakazoModel: CompanyAssistantModel | null;
  skills: AssistantSkillAttachment[];
  temperature: string;
  maxTokens: string;
  disabledBuiltinTools: string[];
  disabledEvolveTools: string[];
  disabledSkills: string[];
  hidden: boolean;
};

function draftFromAgent(agent: AdminDefaultAgent): AgentDraft {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    evolveModel: agent.evolveModel || "gpt-5",
    instructions: agent.instructions,
    systemInstructions: agent.systemInstructions,
    standingInstructions: agent.config.standingInstructions ?? "",
    fileSearchEnabled: agent.fileSearchEnabled,
    vectorStoreIds: [...agent.vectorStoreIds],
    enablePeople: agent.enablePeople,
    enableResponses: agent.enableResponses,
    allowedGroupIds: [...agent.allowedGroupIds],
    allowedUsers: [...agent.allowedUsers],
    isLineManagerOnly: agent.isLineManagerOnly,
    rakazoModel: agent.rakazoModel ? { ...agent.rakazoModel } : null,
    skills: (agent.config.skills ?? []).map((s) => ({ ...s })),
    temperature: agent.config.temperature != null ? String(agent.config.temperature) : "",
    maxTokens: agent.config.maxTokens != null ? String(agent.config.maxTokens) : "",
    disabledBuiltinTools: [...(agent.config.disabledBuiltinTools ?? [])],
    disabledEvolveTools: [...(agent.config.disabledEvolveTools ?? [])],
    disabledSkills: [...(agent.config.disabledSkills ?? [])],
    hidden: agent.config.hidden === true,
  };
}

function emptyDraft(defaultModelId: string): AgentDraft {
  return {
    id: null,
    name: "",
    description: "",
    evolveModel: defaultModelId || "gpt-5",
    instructions: "",
    systemInstructions: "",
    standingInstructions: "",
    fileSearchEnabled: true,
    vectorStoreIds: [],
    enablePeople: false,
    enableResponses: false,
    allowedGroupIds: [],
    allowedUsers: [],
    isLineManagerOnly: false,
    rakazoModel: null,
    skills: [],
    temperature: "",
    maxTokens: "",
    disabledBuiltinTools: [],
    disabledEvolveTools: [],
    disabledSkills: [],
    hidden: false,
  };
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function toggleString(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function toggleNumber(list: number[], value: number): number[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function AdminDefaultAgentsSection({ state }: { state: CompanyAdminState }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const agentsQuery = useQuery({
    queryKey: ["company-admin", "default-agents"],
    queryFn: () => rpc.companyAdmin.defaultAgents.list(),
    staleTime: 30_000,
  });
  const catalogQuery = useQuery({
    queryKey: ["company-admin", "catalog"],
    queryFn: () => rpc.models.list(),
    staleTime: 60_000,
  });
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<AgentDraft | null>(null);

  async function refreshAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["company-admin", "default-agents"] }),
      queryClient.invalidateQueries({ queryKey: ["company-admin", "evolve-assistants"] }),
      queryClient.invalidateQueries({ queryKey: ["company-admin", "skills"] }),
      queryClient.invalidateQueries({ queryKey: queries.companyAdmin.get.queryKey() }),
    ]);
  }

  if (draft && agentsQuery.data) {
    return (
      <DefaultAgentEditor
        draft={draft}
        setDraft={setDraft}
        adminState={state}
        data={agentsQuery.data}
        catalog={catalogQuery.data ?? []}
        onBack={() => setDraft(null)}
        onSaved={async (saved) => {
          await refreshAll();
          setDraft(draftFromAgent(saved));
        }}
        onDeleted={async () => {
          await refreshAll();
          setDraft(null);
        }}
        onSkillsChanged={refreshAll}
      />
    );
  }

  const agents = agentsQuery.data?.agents ?? [];
  const filtered = search.trim()
    ? agents.filter((agent) => {
        const needle = search.trim().toLowerCase();
        return (
          agent.name.toLowerCase().includes(needle) ||
          agent.description.toLowerCase().includes(needle)
        );
      })
    : agents;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">
            <Trans>Default agents</Trans>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            <Trans>
              Manage the default agents staff can start from. Synced with Evolve assistants, with
              company standing instructions, required skills, vector stores, model tuning, and
              access controls.
            </Trans>
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={!agentsQuery.data}
          onClick={() => setDraft(emptyDraft(state.model?.modelId ?? "gpt-5"))}
        >
          <Plus className="mr-1.5 size-4" />
          <Trans>New default agent</Trans>
        </Button>
      </div>

      {agentsQuery.isPending ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Spinner />
          <Trans>Loading default agents…</Trans>
        </div>
      ) : agentsQuery.isError ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {errorText(
            agentsQuery.error,
            t`Could not load default agents. Check that Evolve is linked and you are an Evolve admin.`,
          )}
        </div>
      ) : (
        <>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t`Filter default agents…`}
            className="max-w-sm"
          />

          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {agents.length === 0 ? (
                <Trans>No default agents yet. Create your first default agent above.</Trans>
              ) : (
                <Trans>No default agents match that filter.</Trans>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {filtered.map((agent) => {
                const requiredSkills = (agent.config.skills ?? []).filter(
                  (s) => s.mode === "required",
                ).length;
                const availableSkills = (agent.config.skills ?? []).filter(
                  (s) => s.mode === "available",
                ).length;
                const restricted =
                  agent.isLineManagerOnly ||
                  agent.allowedGroupIds.length > 0 ||
                  agent.allowedUsers.length > 0;
                return (
                  <li key={agent.id}>
                    <button
                      type="button"
                      onClick={() => setDraft(draftFromAgent(agent))}
                      className="flex w-full items-start justify-between gap-4 px-4 py-3.5 text-left transition-colors hover:bg-muted/50"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Bot className="size-4 shrink-0 text-muted-foreground" />
                          <span className="font-medium text-foreground">{agent.name}</span>
                          {agent.config.hidden ? (
                            <Badge variant="outline">
                              <Trans>Hidden</Trans>
                            </Badge>
                          ) : null}
                          {restricted ? (
                            <Badge variant="secondary" className="gap-1">
                              <Lock className="size-3" />
                              <Trans>Restricted</Trans>
                            </Badge>
                          ) : null}
                        </div>
                        {agent.description ? (
                          <p className="line-clamp-2 text-xs text-muted-foreground">
                            {agent.description}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          {agent.fileSearchEnabled && agent.vectorStoreIds.length > 0 ? (
                            <Badge variant="secondary" className="gap-1 font-normal">
                              <Database className="size-3" />
                              <Trans>{agent.vectorStoreIds.length} knowledge store(s)</Trans>
                            </Badge>
                          ) : null}
                          {requiredSkills > 0 ? (
                            <Badge variant="default" className="gap-1 font-normal">
                              <ScrollText className="size-3" />
                              <Trans>{requiredSkills} required skill(s)</Trans>
                            </Badge>
                          ) : null}
                          {availableSkills > 0 ? (
                            <Badge variant="outline" className="font-normal">
                              <Trans>{availableSkills} available skill(s)</Trans>
                            </Badge>
                          ) : null}
                          {agent.config.standingInstructions ? (
                            <Badge variant="outline" className="font-normal">
                              <Trans>Live rules</Trans>
                            </Badge>
                          ) : null}
                          {agent.rakazoModel ? (
                            <Badge variant="outline" className="gap-1 font-normal">
                              <Sliders className="size-3" />
                              {agent.rakazoModel.modelId}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function DefaultAgentEditor({
  draft,
  setDraft,
  adminState,
  data,
  catalog,
  onBack,
  onSaved,
  onDeleted,
  onSkillsChanged,
}: {
  draft: AgentDraft;
  setDraft: React.Dispatch<React.SetStateAction<AgentDraft | null>>;
  adminState: CompanyAdminState;
  data: AdminDefaultAgentsState;
  catalog: ModelCatalogEntry[];
  onBack: () => void;
  onSaved: (agent: AdminDefaultAgent) => Promise<void>;
  onDeleted: () => Promise<void>;
  onSkillsChanged: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [peopleFilter, setPeopleFilter] = useState("");
  const [toolFilter, setToolFilter] = useState("");
  const [showToolOverrides, setShowToolOverrides] = useState(
    draft.disabledBuiltinTools.length > 0 ||
      draft.disabledEvolveTools.length > 0 ||
      draft.disabledSkills.length > 0,
  );
  const [showSystemPrompt, setShowSystemPrompt] = useState(
    draft.systemInstructions.trim().length > 0,
  );

  const company = adminState.model;
  const providerModels = useMemo(
    () =>
      catalog.filter(
        (entry) =>
          entry.provider === company?.provider && entry.auth !== "oauth" && !entry.placeholder,
      ),
    [catalog, company?.provider],
  );
  const selectedModelEntry = useMemo(
    () =>
      providerModels.find(
        (entry) => entry.id === (draft.rakazoModel?.modelId ?? company?.modelId),
      ) ?? null,
    [providerModels, draft.rakazoModel?.modelId, company?.modelId],
  );
  const selectedThinkingLevels = (selectedModelEntry?.thinkingLevels ?? []).filter(
    (level) => level !== "off",
  );

  function update(patch: Partial<AgentDraft>) {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function save() {
    if (!draft.name.trim()) {
      toast.error(t`Name is required`);
      return;
    }
    const parsedTemp = draft.temperature.trim() === "" ? null : Number(draft.temperature.trim());
    if (parsedTemp !== null && (!Number.isFinite(parsedTemp) || parsedTemp < 0 || parsedTemp > 2)) {
      toast.error(t`Temperature must be between 0 and 2`);
      return;
    }
    const parsedMaxTokens = draft.maxTokens.trim() === "" ? null : Number(draft.maxTokens.trim());
    if (
      parsedMaxTokens !== null &&
      (!Number.isInteger(parsedMaxTokens) || parsedMaxTokens < 256 || parsedMaxTokens > 200_000)
    ) {
      toast.error(t`Max output tokens must be an integer between 256 and 200000`);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        evolveModel: draft.evolveModel.trim() || "gpt-5",
        instructions: draft.instructions,
        systemInstructions: draft.systemInstructions,
        fileSearchEnabled: draft.fileSearchEnabled,
        vectorStoreIds: draft.vectorStoreIds,
        enablePeople: draft.enablePeople,
        enableResponses: draft.enableResponses,
        allowedGroupIds: draft.allowedGroupIds,
        allowedUsers: draft.allowedUsers,
        isLineManagerOnly: draft.isLineManagerOnly,
        rakazoModel: draft.rakazoModel,
        config: {
          standingInstructions: draft.standingInstructions.trim() || undefined,
          skills: draft.skills,
          temperature: parsedTemp,
          maxTokens: parsedMaxTokens,
          disabledBuiltinTools: draft.disabledBuiltinTools,
          disabledEvolveTools: draft.disabledEvolveTools,
          disabledSkills: draft.disabledSkills,
          hidden: draft.hidden || undefined,
        },
      };
      const saved = draft.id
        ? await rpc.companyAdmin.defaultAgents.update({ id: draft.id, ...payload })
        : await rpc.companyAdmin.defaultAgents.create(payload);
      await onSaved(saved);
      toast.success(draft.id ? t`Default agent saved` : t`Default agent created`);
    } catch (err) {
      toast.error(errorText(err, t`Could not save default agent`));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft.id) return;
    setDeleting(true);
    try {
      await rpc.companyAdmin.defaultAgents.remove({ id: draft.id });
      toast.success(t`Default agent deleted`);
      await onDeleted();
    } catch (err) {
      toast.error(errorText(err, t`Could not delete default agent`));
    } finally {
      setDeleting(false);
    }
  }

  const attachedKeySet = new Set(draft.skills.map((s) => s.skillKey));
  const companySkillById = useMemo(
    () => new Map(data.companySkills.map((s) => [s.id, s] as const)),
    [data.companySkills],
  );
  const builtinSkillByName = useMemo(
    () => new Map(data.builtinSkills.map((s) => [s.name, s] as const)),
    [data.builtinSkills],
  );

  function attachSkill(skillKey: string, mode: "required" | "available") {
    if (attachedKeySet.has(skillKey)) return;
    update({ skills: [...draft.skills, { skillKey, mode }] });
  }

  function setSkillMode(skillKey: string, mode: "required" | "available") {
    update({
      skills: draft.skills.map((entry) =>
        entry.skillKey === skillKey ? { ...entry, mode } : entry,
      ),
    });
  }

  function detachSkill(skillKey: string) {
    update({ skills: draft.skills.filter((entry) => entry.skillKey !== skillKey) });
  }

  const filteredPeople = useMemo(() => {
    const q = peopleFilter.trim().toLowerCase();
    if (!q) return data.people;
    return data.people.filter(
      (person) => person.name.toLowerCase().includes(q) || person.email.toLowerCase().includes(q),
    );
  }, [data.people, peopleFilter]);

  const evolveTools = adminState.tools.evolve.tools;
  const filteredBuiltinTools = useMemo(() => {
    const q = toolFilter.trim().toLowerCase();
    if (!q) return data.builtinTools;
    return data.builtinTools.filter(
      (tool) => tool.name.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q),
    );
  }, [data.builtinTools, toolFilter]);

  const filteredEvolveTools = useMemo(() => {
    const q = toolFilter.trim().toLowerCase();
    if (!q) return evolveTools;
    return evolveTools.filter(
      (tool) => tool.name.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q),
    );
  }, [evolveTools, toolFilter]);

  const isRestricted =
    draft.isLineManagerOnly || draft.allowedGroupIds.length > 0 || draft.allowedUsers.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-1 size-4" />
            <Trans>Default agents</Trans>
          </Button>
          <span className="text-muted-foreground">/</span>
          <h2 className="text-base font-medium">
            {draft.name.trim() || <Trans>New default agent</Trans>}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {draft.id ? (
            confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={deleting}
                  onClick={() => void remove()}
                >
                  {deleting ? <Spinner className="mr-1.5" /> : null}
                  <Trans>Confirm delete</Trans>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={deleting}
                  onClick={() => setConfirmDelete(false)}
                >
                  <Trans>Cancel</Trans>
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="mr-1.5 size-4" />
                <Trans>Delete</Trans>
              </Button>
            )
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={saving || !draft.name.trim()}
            onClick={() => void save()}
          >
            {saving ? <Spinner className="mr-1.5" /> : null}
            {draft.id ? <Trans>Save changes</Trans> : <Trans>Create default agent</Trans>}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="basics" className="space-y-5">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="basics">
            <Trans>Basics & prompts</Trans>
          </TabsTrigger>
          <TabsTrigger value="skills">
            <Trans>Skills</Trans>
            {draft.skills.length > 0 ? (
              <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[11px]">
                {draft.skills.length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="knowledge">
            <Trans>Knowledge</Trans>
            {draft.vectorStoreIds.length > 0 ? (
              <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[11px]">
                {draft.vectorStoreIds.length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="model">
            <Trans>Model & tools</Trans>
          </TabsTrigger>
          <TabsTrigger value="access">
            <Trans>Access</Trans>
          </TabsTrigger>
        </TabsList>

        {/* ---------------- BASICS & PROMPTS ---------------- */}
        <TabsContent value="basics" className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="default-agent-name">
                <Trans>Name</Trans>
              </FieldLabel>
              <Input
                id="default-agent-name"
                value={draft.name}
                maxLength={160}
                onChange={(event) => update({ name: event.target.value })}
                placeholder={t`e.g. OCSC Civil Intelligence`}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="default-agent-desc">
                <Trans>Short description</Trans>
              </FieldLabel>
              <Input
                id="default-agent-desc"
                value={draft.description}
                maxLength={2000}
                onChange={(event) => update({ description: event.target.value })}
                placeholder={t`Shown in the New Agent picker`}
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="default-agent-standing">
              <Trans>Company standing instructions (live)</Trans>
            </FieldLabel>
            <FieldDescription>
              <Trans>
                Always enforced on every reply for both existing and new agents started from this
                default agent. Changes take effect immediately; staff cannot overwrite these.
              </Trans>
            </FieldDescription>
            <Textarea
              id="default-agent-standing"
              rows={6}
              value={draft.standingInstructions}
              onChange={(event) => update({ standingInstructions: event.target.value })}
              placeholder={t`Non-negotiable company rules, tone, compliance checks, or output structure...`}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="default-agent-starter">
              <Trans>Starter prompt (copied on creation)</Trans>
            </FieldLabel>
            <FieldDescription>
              <Trans>
                Synced with Evolve. Copied into a new agent's instructions when a staff member
                starts one from here; they can personalise their own copy afterwards.
              </Trans>
            </FieldDescription>
            <Textarea
              id="default-agent-starter"
              rows={8}
              value={draft.instructions}
              onChange={(event) => update({ instructions: event.target.value })}
              placeholder={t`Describe the default role, goals, and helpful starting guidance...`}
            />
          </Field>

          <div className="space-y-2 rounded-xl border border-border p-3.5">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left text-sm font-medium"
              onClick={() => setShowSystemPrompt((open) => !open)}
            >
              <span>
                <Trans>Evolve system prompt (shared with Evolve Chat)</Trans>
              </span>
              {showSystemPrompt ? (
                <ChevronDown className="size-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-4 text-muted-foreground" />
              )}
            </button>
            {showSystemPrompt ? (
              <div className="pt-2">
                <Textarea
                  rows={5}
                  value={draft.systemInstructions}
                  onChange={(event) => update({ systemInstructions: event.target.value })}
                  placeholder={t`Optional system instructions stored on Evolve's assistants.system_instructions column`}
                />
              </div>
            ) : null}
          </div>

          <div className="divide-y divide-border rounded-xl border border-border">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <div className="text-sm font-medium">
                  <Trans>Show in New Agent picker</Trans>
                </div>
                <div className="text-xs text-muted-foreground">
                  <Trans>
                    Turn off to hide this default agent from staff in Rakazo without deleting it in
                    Evolve.
                  </Trans>
                </div>
              </div>
              <Switch
                checked={!draft.hidden}
                onCheckedChange={(checked) => update({ hidden: !checked })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <div className="text-sm font-medium">
                  <Trans>Offer People & CV references</Trans>
                </div>
                <div className="text-xs text-muted-foreground">
                  <Trans>Lets staff attach staff profiles and CVs from Evolve in chat.</Trans>
                </div>
              </div>
              <Switch
                checked={draft.enablePeople}
                onCheckedChange={(checked) => update({ enablePeople: checked })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <div className="text-sm font-medium">
                  <Trans>Offer Tender exemplar references</Trans>
                </div>
                <div className="text-xs text-muted-foreground">
                  <Trans>Lets staff attach approved tender exemplar responses from Evolve.</Trans>
                </div>
              </div>
              <Switch
                checked={draft.enableResponses}
                onCheckedChange={(checked) => update({ enableResponses: checked })}
              />
            </div>
          </div>
        </TabsContent>

        {/* ---------------- SKILLS ---------------- */}
        <TabsContent value="skills" className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">
                <Trans>Attached default skills</Trans>
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                <Trans>
                  Required skills are injected in full on every turn so the agent must always follow
                  them. Available skills appear in the agent's skill catalog to read on demand.
                </Trans>
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCreatingSkill(true)}
            >
              <Plus className="mr-1.5 size-4" />
              <Trans>New company skill</Trans>
            </Button>
          </div>

          {draft.skills.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
              <Trans>
                No default skills attached yet. Pick a company or built-in skill below, or create a
                new company skill.
              </Trans>
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {draft.skills.map((entry) => {
                const isCompany = entry.skillKey.startsWith("company:");
                const rawKey = isCompany
                  ? entry.skillKey.slice("company:".length)
                  : entry.skillKey.slice("builtin:".length);
                const meta = isCompany
                  ? companySkillById.get(rawKey)
                  : builtinSkillByName.get(rawKey);
                return (
                  <li
                    key={entry.skillKey}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{meta?.name ?? rawKey}</span>
                        <Badge variant="secondary" className="text-[11px] font-normal">
                          {isCompany ? <Trans>Company</Trans> : <Trans>Built-in</Trans>}
                        </Badge>
                      </div>
                      {meta?.description ? (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {meta.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <NativeSelect
                        aria-label={t`Skill enforcement mode`}
                        value={entry.mode}
                        onChange={(event) =>
                          setSkillMode(
                            entry.skillKey,
                            event.target.value === "available" ? "available" : "required",
                          )
                        }
                      >
                        <NativeSelectOption value="required">
                          {t`Required (must use)`}
                        </NativeSelectOption>
                        <NativeSelectOption value="available">
                          {t`Available (on demand)`}
                        </NativeSelectOption>
                      </NativeSelect>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t`Remove`}
                        onClick={() => detachSkill(entry.skillKey)}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 rounded-xl border border-border p-4">
              <div className="text-sm font-medium">
                <Trans>Add company skill</Trans>
              </div>
              {data.companySkills.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    No company skills yet. Click "New company skill" above to create one.
                  </Trans>
                </p>
              ) : (
                <ul className="max-h-64 space-y-1.5 overflow-y-auto">
                  {data.companySkills.map((skill) => {
                    const key = `company:${skill.id}`;
                    const attached = attachedKeySet.has(key);
                    return (
                      <li
                        key={skill.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{skill.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {skill.description}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={attached}
                          onClick={() => attachSkill(key, "required")}
                        >
                          {attached ? <Trans>Added</Trans> : <Trans>Add</Trans>}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="space-y-2 rounded-xl border border-border p-4">
              <div className="text-sm font-medium">
                <Trans>Add built-in skill</Trans>
              </div>
              <ul className="max-h-64 space-y-1.5 overflow-y-auto">
                {data.builtinSkills.map((skill) => {
                  const key = `builtin:${skill.name}`;
                  const attached = attachedKeySet.has(key);
                  return (
                    <li
                      key={skill.name}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{skill.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {skill.description}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={attached}
                        onClick={() => attachSkill(key, "required")}
                      >
                        {attached ? <Trans>Added</Trans> : <Trans>Add</Trans>}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </TabsContent>

        {/* ---------------- KNOWLEDGE & VECTOR STORES ---------------- */}
        <TabsContent value="knowledge" className="space-y-5">
          <VectorStoresTab
            fileSearchEnabled={draft.fileSearchEnabled}
            vectorStoreIds={draft.vectorStoreIds}
            onToggleFileSearch={(enabled) => update({ fileSearchEnabled: enabled })}
            onChangeVectorStores={(ids) => update({ vectorStoreIds: ids })}
          />
        </TabsContent>

        {/* ---------------- MODEL & FINE-TUNING ---------------- */}
        <TabsContent value="model" className="space-y-5">
          <div className="space-y-4 rounded-xl border border-border p-4">
            <div>
              <h3 className="text-sm font-medium">
                <Trans>Model & generation settings</Trans>
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                <Trans>
                  Agents started from this default agent run on the chosen model using the company
                  API key. Leave blank to inherit the company default.
                </Trans>
              </p>
            </div>

            {!company ? (
              <p className="text-sm text-muted-foreground">
                <Trans>Save a company model first under Model to set a per-agent override.</Trans>
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="default-agent-model">
                    <Trans>Model override</Trans>
                  </FieldLabel>
                  <NativeSelect
                    id="default-agent-model"
                    value={
                      draft.rakazoModel?.provider === company.provider
                        ? draft.rakazoModel.modelId
                        : ""
                    }
                    onChange={(event) => {
                      const modelId = event.target.value;
                      if (!modelId) {
                        update({ rakazoModel: null });
                        return;
                      }
                      const entry = providerModels.find((m) => m.id === modelId);
                      const keptThinking =
                        draft.rakazoModel?.thinkingLevel &&
                        (entry?.thinkingLevels ?? []).includes(draft.rakazoModel.thinkingLevel)
                          ? draft.rakazoModel.thinkingLevel
                          : null;
                      update({
                        rakazoModel: {
                          provider: company.provider,
                          modelId,
                          thinkingLevel: keptThinking,
                        },
                      });
                    }}
                  >
                    <NativeSelectOption value="">
                      {t`Company model (${company.modelId})`}
                    </NativeSelectOption>
                    {providerModels.map((entry) => (
                      <NativeSelectOption key={entry.id} value={entry.id}>
                        {entry.label} ({entry.id})
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>

                <Field>
                  <FieldLabel htmlFor="default-agent-thinking">
                    <Trans>Thinking effort</Trans>
                  </FieldLabel>
                  <NativeSelect
                    id="default-agent-thinking"
                    disabled={
                      !draft.rakazoModel ||
                      draft.rakazoModel.provider !== company.provider ||
                      selectedThinkingLevels.length === 0
                    }
                    value={draft.rakazoModel?.thinkingLevel ?? ""}
                    onChange={(event) => {
                      if (!draft.rakazoModel) return;
                      const level = (event.target.value || null) as ThinkingLevel | null;
                      update({ rakazoModel: { ...draft.rakazoModel, thinkingLevel: level } });
                    }}
                  >
                    <NativeSelectOption value="">{t`Company default`}</NativeSelectOption>
                    {selectedThinkingLevels.map((level) => (
                      <NativeSelectOption key={level} value={level}>
                        {thinkingLevelLabel(level)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="default-agent-temp">
                  <Trans>Temperature (0–2)</Trans>
                </FieldLabel>
                <Input
                  id="default-agent-temp"
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={draft.temperature}
                  onChange={(event) => update({ temperature: event.target.value })}
                  placeholder={t`Model default`}
                />
                <FieldDescription>
                  <Trans>
                    Lower is more deterministic. Automatically ignored by reasoning models.
                  </Trans>
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="default-agent-max-tokens">
                  <Trans>Max output tokens</Trans>
                </FieldLabel>
                <Input
                  id="default-agent-max-tokens"
                  type="number"
                  min={256}
                  max={200000}
                  step={256}
                  value={draft.maxTokens}
                  onChange={(event) => update({ maxTokens: event.target.value })}
                  placeholder={t`Model default`}
                />
                <FieldDescription>
                  <Trans>Optional per-reply token cap (256–200,000).</Trans>
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="default-agent-evolve-model">
                  <Trans>Evolve Chat model</Trans>
                </FieldLabel>
                <Input
                  id="default-agent-evolve-model"
                  value={draft.evolveModel}
                  onChange={(event) => update({ evolveModel: event.target.value })}
                  placeholder="gpt-5"
                />
                <FieldDescription>
                  <Trans>Model ID stored in Evolve for Evolve Chat.</Trans>
                </FieldDescription>
              </Field>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-border p-4">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => setShowToolOverrides((open) => !open)}
            >
              <div>
                <div className="text-sm font-medium">
                  <Trans>Per-agent tool & skill restrictions</Trans>
                </div>
                <div className="text-xs text-muted-foreground">
                  <Trans>
                    Turn off specific built-in tools, Evolve tools, or built-in skills for agents
                    started from this default agent.
                  </Trans>
                </div>
              </div>
              {showToolOverrides ? (
                <ChevronDown className="size-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-4 text-muted-foreground" />
              )}
            </button>

            {showToolOverrides ? (
              <div className="space-y-4 pt-2">
                <Input
                  value={toolFilter}
                  onChange={(event) => setToolFilter(event.target.value)}
                  placeholder={t`Filter tools…`}
                  className="max-w-sm"
                />

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground uppercase">
                      <Trans>Built-in tools</Trans>
                    </div>
                    <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                      {filteredBuiltinTools.map((tool) => {
                        const enabled = !draft.disabledBuiltinTools.includes(tool.name);
                        return (
                          <li
                            key={tool.name}
                            className="flex items-center justify-between gap-3 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <div className="truncate font-mono text-xs">{tool.name}</div>
                              <div className="truncate text-[11px] text-muted-foreground">
                                {tool.description}
                              </div>
                            </div>
                            <Switch
                              checked={enabled}
                              onCheckedChange={() =>
                                update({
                                  disabledBuiltinTools: toggleString(
                                    draft.disabledBuiltinTools,
                                    tool.name,
                                  ),
                                })
                              }
                            />
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground uppercase">
                      <Trans>Evolve tools</Trans>
                    </div>
                    {filteredEvolveTools.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        <Trans>No Evolve tools match this filter.</Trans>
                      </p>
                    ) : (
                      <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                        {filteredEvolveTools.map((tool) => {
                          const enabled = !draft.disabledEvolveTools.includes(tool.name);
                          return (
                            <li
                              key={tool.name}
                              className="flex items-center justify-between gap-3 px-3 py-2"
                            >
                              <div className="min-w-0">
                                <div className="truncate font-mono text-xs">{tool.name}</div>
                                <div className="truncate text-[11px] text-muted-foreground">
                                  {tool.description}
                                </div>
                              </div>
                              <Switch
                                checked={enabled}
                                onCheckedChange={() =>
                                  update({
                                    disabledEvolveTools: toggleString(
                                      draft.disabledEvolveTools,
                                      tool.name,
                                    ),
                                  })
                                }
                              />
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </TabsContent>

        {/* ---------------- ACCESS CONTROL ---------------- */}
        <TabsContent value="access" className="space-y-5">
          <div className="rounded-xl border border-border p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium">
                  <Trans>Who can use this default agent</Trans>
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <Trans>
                    Synced with Evolve Access Control. Leave all grants empty to make this default
                    agent open to everyone. Admins always have access.
                  </Trans>
                </p>
              </div>
              {isRestricted ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    update({
                      isLineManagerOnly: false,
                      allowedGroupIds: [],
                      allowedUsers: [],
                    })
                  }
                >
                  <Trans>Open to everyone</Trans>
                </Button>
              ) : (
                <Badge variant="secondary">
                  <Trans>Open to everyone</Trans>
                </Badge>
              )}
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3.5 py-2.5">
              <div>
                <div className="text-sm font-medium">
                  <Trans>Line managers</Trans>
                </div>
                <div className="text-xs text-muted-foreground">
                  <Trans>Allow all active line managers in Evolve.</Trans>
                </div>
              </div>
              <Switch
                checked={draft.isLineManagerOnly}
                onCheckedChange={(checked) => update({ isLineManagerOnly: checked })}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground uppercase">
                  <Trans>Evolve visibility groups</Trans>
                </div>
                {data.groups.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    <Trans>No visibility groups configured in Evolve.</Trans>
                  </p>
                ) : (
                  <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                    {data.groups.map((group) => {
                      const checked = draft.allowedGroupIds.includes(group.id);
                      const checkboxId = `default-agent-group-${group.id}`;
                      return (
                        <li key={group.id}>
                          <label
                            htmlFor={checkboxId}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/60"
                          >
                            <Checkbox
                              id={checkboxId}
                              checked={checked}
                              onCheckedChange={() =>
                                update({
                                  allowedGroupIds: toggleString(draft.allowedGroupIds, group.id),
                                })
                              }
                            />
                            <span className="truncate">{group.name}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground uppercase">
                  <Trans>Specific people</Trans>
                </div>
                <Input
                  value={peopleFilter}
                  onChange={(event) => setPeopleFilter(event.target.value)}
                  placeholder={t`Filter people…`}
                />
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                  {filteredPeople.map((person) => {
                    const checked = draft.allowedUsers.includes(person.id);
                    const checkboxId = `default-agent-person-${person.id}`;
                    return (
                      <li key={person.id}>
                        <label
                          htmlFor={checkboxId}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/60"
                        >
                          <Checkbox
                            id={checkboxId}
                            checked={checked}
                            onCheckedChange={() =>
                              update({
                                allowedUsers: toggleNumber(draft.allowedUsers, person.id),
                              })
                            }
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {person.name}
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {person.email}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {creatingSkill ? (
        <CompanySkillEditorDialog
          open
          skill={null}
          onClose={() => setCreatingSkill(false)}
          onSaved={async (created) => {
            await onSkillsChanged();
            attachSkill(`company:${created.id}`, "required");
          }}
        />
      ) : null}
    </div>
  );
}

function VectorStoresTab({
  fileSearchEnabled,
  vectorStoreIds,
  onToggleFileSearch,
  onChangeVectorStores,
}: {
  fileSearchEnabled: boolean;
  vectorStoreIds: string[];
  onToggleFileSearch: (enabled: boolean) => void;
  onChangeVectorStores: (ids: string[]) => void;
}) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const storesQuery = useQuery({
    queryKey: ["company-admin", "vector-stores"],
    queryFn: () => rpc.companyAdmin.vectorStores.list(),
    staleTime: 30_000,
  });
  const [selectedToAdd, setSelectedToAdd] = useState("");
  const [newStoreName, setNewStoreName] = useState("");
  const [creatingStore, setCreatingStore] = useState(false);
  const [expandedStoreId, setExpandedStoreId] = useState<string | null>(vectorStoreIds[0] ?? null);

  const storeById = useMemo(
    () => new Map((storesQuery.data ?? []).map((store) => [store.id, store] as const)),
    [storesQuery.data],
  );
  const availableToAttach = useMemo(
    () => (storesQuery.data ?? []).filter((store) => !vectorStoreIds.includes(store.id)),
    [storesQuery.data, vectorStoreIds],
  );

  async function createStore() {
    const trimmed = newStoreName.trim();
    if (!trimmed) return;
    setCreatingStore(true);
    try {
      const created = await rpc.companyAdmin.vectorStores.create({ name: trimmed });
      await queryClient.invalidateQueries({ queryKey: ["company-admin", "vector-stores"] });
      onChangeVectorStores([...vectorStoreIds, created.id]);
      setExpandedStoreId(created.id);
      setNewStoreName("");
      toast.success(t`Vector store created and attached`);
    } catch (err) {
      toast.error(errorText(err, t`Could not create vector store`));
    } finally {
      setCreatingStore(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3">
        <div>
          <div className="text-sm font-medium">
            <Trans>Enable knowledge file search</Trans>
          </div>
          <div className="text-xs text-muted-foreground">
            <Trans>
              Lets agents started from this default agent search all attached OpenAI vector stores.
            </Trans>
          </div>
        </div>
        <Switch checked={fileSearchEnabled} onCheckedChange={onToggleFileSearch} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 rounded-xl border border-border p-4">
          <FieldLabel htmlFor="attach-vector-store">
            <Trans>Attach existing vector store</Trans>
          </FieldLabel>
          <div className="flex gap-2">
            <NativeSelect
              id="attach-vector-store"
              className="flex-1"
              value={selectedToAdd}
              disabled={storesQuery.isPending || availableToAttach.length === 0}
              onChange={(event) => setSelectedToAdd(event.target.value)}
            >
              <NativeSelectOption value="">
                {storesQuery.isPending
                  ? t`Loading vector stores…`
                  : availableToAttach.length === 0
                    ? t`No other vector stores available`
                    : t`Choose a vector store…`}
              </NativeSelectOption>
              {availableToAttach.map((store) => (
                <NativeSelectOption key={store.id} value={store.id}>
                  {store.name} ({store.fileCount})
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button
              type="button"
              variant="outline"
              disabled={!selectedToAdd}
              onClick={() => {
                if (!selectedToAdd) return;
                onChangeVectorStores([...vectorStoreIds, selectedToAdd]);
                setExpandedStoreId(selectedToAdd);
                setSelectedToAdd("");
              }}
            >
              <Trans>Attach</Trans>
            </Button>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-border p-4">
          <FieldLabel htmlFor="new-vector-store-name">
            <Trans>Create new vector store</Trans>
          </FieldLabel>
          <div className="flex gap-2">
            <Input
              id="new-vector-store-name"
              value={newStoreName}
              maxLength={160}
              onChange={(event) => setNewStoreName(event.target.value)}
              placeholder={t`e.g. Drainage Design Standards`}
            />
            <Button
              type="button"
              variant="outline"
              disabled={creatingStore || !newStoreName.trim()}
              onClick={() => void createStore()}
            >
              {creatingStore ? <Spinner className="mr-1.5" /> : <Plus className="mr-1 size-4" />}
              <Trans>Create</Trans>
            </Button>
          </div>
        </div>
      </div>

      {vectorStoreIds.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          <Trans>
            No vector stores attached. Attach one or more existing stores or create a new store to
            upload knowledge files.
          </Trans>
        </div>
      ) : (
        <div className="space-y-3">
          {vectorStoreIds.map((storeId) => (
            <AttachedVectorStoreCard
              key={storeId}
              storeId={storeId}
              store={storeById.get(storeId) ?? null}
              expanded={expandedStoreId === storeId}
              onToggleExpand={() =>
                setExpandedStoreId((current) => (current === storeId ? null : storeId))
              }
              onDetach={() => onChangeVectorStores(vectorStoreIds.filter((id) => id !== storeId))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AttachedVectorStoreCard({
  storeId,
  store,
  expanded,
  onToggleExpand,
  onDetach,
}: {
  storeId: string;
  store: AdminVectorStore | null;
  expanded: boolean;
  onToggleExpand: () => void;
  onDetach: () => void;
}) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removingFileId, setRemovingFileId] = useState<string | null>(null);

  const filesQuery = useQuery({
    queryKey: ["company-admin", "vector-stores", storeId, "files"],
    queryFn: () => rpc.companyAdmin.vectorStores.files({ vectorStoreId: storeId }),
    enabled: expanded,
    staleTime: 15_000,
  });

  async function onPickFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (picked.length === 0) return;
    setUploading(true);
    try {
      for (const file of picked) {
        if (file.size > MAX_UPLOAD_BYTES) {
          toast.error(t`${file.name} exceeds the 20 MB limit.`);
          continue;
        }
        const contentBase64 = await readFileAsBase64(file);
        await rpc.companyAdmin.vectorStores.uploadFile({
          vectorStoreId: storeId,
          filename: file.name,
          contentBase64,
          mimeType: file.type || undefined,
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["company-admin", "vector-stores", storeId, "files"],
        }),
        queryClient.invalidateQueries({ queryKey: ["company-admin", "vector-stores"] }),
      ]);
      toast.success(t`File uploaded to vector store`);
    } catch (err) {
      toast.error(errorText(err, t`Could not upload file`));
    } finally {
      setUploading(false);
    }
  }

  async function removeFile(fileId: string) {
    setRemovingFileId(fileId);
    try {
      await rpc.companyAdmin.vectorStores.removeFile({ vectorStoreId: storeId, fileId });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["company-admin", "vector-stores", storeId, "files"],
        }),
        queryClient.invalidateQueries({ queryKey: ["company-admin", "vector-stores"] }),
      ]);
      toast.success(t`File removed`);
    } catch (err) {
      toast.error(errorText(err, t`Could not remove file`));
    } finally {
      setRemovingFileId(null);
    }
  }

  return (
    <div className="rounded-xl border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={onToggleExpand}
        >
          {expanded ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
          <Database className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{store?.name ?? storeId}</div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">
              {storeId}
              {store ? ` · ${store.fileCount} file(s)` : ""}
            </div>
          </div>
        </button>

        <div className="flex items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => void onPickFiles(event)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Spinner className="mr-1.5" /> : <Upload className="mr-1.5 size-3.5" />}
            <Trans>Upload file</Trans>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t`Detach vector store`}
            onClick={onDetach}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-border px-4 py-3">
          {filesQuery.isPending ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner />
              <Trans>Loading files…</Trans>
            </div>
          ) : filesQuery.isError ? (
            <p className="text-xs text-destructive">
              {errorText(filesQuery.error, t`Could not load files in this store`)}
            </p>
          ) : !filesQuery.data?.length ? (
            <p className="text-xs text-muted-foreground">
              <Trans>No files in this vector store yet. Upload files above.</Trans>
            </p>
          ) : (
            <ul className="divide-y divide-border/70">
              {filesQuery.data.map((file) => (
                <li key={file.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium text-foreground">{file.filename}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatBytes(file.bytes)}
                    </span>
                    {file.status !== "completed" ? (
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                        {file.status}
                      </Badge>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={removingFileId === file.id}
                    aria-label={t`Remove file`}
                    onClick={() => void removeFile(file.id)}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
