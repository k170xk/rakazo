import { Trans, useLingui } from "@lingui/react/macro";
import type {
  CompanyAdminState,
  CompanyAssistantModel,
  EvolveAssistant,
  ModelCatalogEntry,
} from "@rakazo/contracts";
import { Badge, NativeSelect, NativeSelectOption, toast } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { thinkingLevelLabel } from "../lib/model-catalog";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

/** Per Evolve assistant, the model its bots run on instead of the company model. */
export function CompanyAssistantModelsSection({
  state,
  onSaved,
}: {
  state: CompanyAdminState;
  onSaved: (next: CompanyAdminState) => Promise<void>;
}) {
  const { t } = useLingui();
  const assistants = useQuery({
    queryKey: ["company-admin", "evolve-assistants"],
    queryFn: () => rpc.bots.evolveAssistants(),
    staleTime: 60_000,
  });
  const catalog = useQuery({
    queryKey: ["company-admin", "catalog"],
    queryFn: () => rpc.models.list(),
    staleTime: 60_000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const company = state.model;
  const models = (catalog.data ?? []).filter(
    (entry: ModelCatalogEntry) =>
      entry.provider === company?.provider && entry.auth !== "oauth" && !entry.placeholder,
  );

  async function save(assistantId: string, chosen: CompanyAssistantModel | null) {
    const next = { ...state.assistantModels };
    if (chosen) next[assistantId] = chosen;
    else delete next[assistantId];
    setBusy(assistantId);
    try {
      await onSaved(await rpc.companyAdmin.setTools({ assistantModels: next }));
      toast.success(t`Saved`);
    } catch (err) {
      toast.error(errorText(err, t`Could not save the assistant model`));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-medium">
          <Trans>Evolve assistant models</Trans>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <Trans>
            Agents people start from one of these assistants run on the model chosen here, using the
            company key. Blank agents, and assistants left on the company model, use the company model
            above.
          </Trans>
        </p>
      </div>
      {!company ? (
        <p className="text-sm text-muted-foreground">
          <Trans>Save a company model first; assistant models run on its key.</Trans>
        </p>
      ) : assistants.isPending ? (
        <p className="text-sm text-muted-foreground">
          <Trans>Loading assistants…</Trans>
        </p>
      ) : !assistants.data?.length ? (
        <p className="text-sm text-muted-foreground">
          <Trans>No Evolve assistants are available. Check that Evolve is linked.</Trans>
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {assistants.data.map((assistant) => (
            <AssistantModelRow
              key={assistant.id}
              assistant={assistant}
              chosen={
                state.assistantModels[assistant.id]?.provider === company.provider
                  ? (state.assistantModels[assistant.id] ?? null)
                  : null
              }
              provider={company.provider}
              companyModelId={company.modelId}
              models={models}
              busy={busy === assistant.id}
              onSave={(chosen) => void save(assistant.id, chosen)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function AssistantModelRow({
  assistant,
  chosen,
  provider,
  companyModelId,
  models,
  busy,
  onSave,
}: {
  assistant: EvolveAssistant;
  chosen: CompanyAssistantModel | null;
  provider: string;
  companyModelId: string;
  models: ModelCatalogEntry[];
  busy: boolean;
  onSave: (chosen: CompanyAssistantModel | null) => void;
}) {
  const { t } = useLingui();
  const thinkingLevels = (
    models.find((entry) => entry.id === chosen?.modelId)?.thinkingLevels ?? []
  ).filter((level) => level !== "off");
  const companyLabel = models.find((entry) => entry.id === companyModelId)?.label ?? companyModelId;

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{assistant.name}</span>
          {assistant.knowledge ? (
            <Badge variant="secondary">
              <Trans>Knowledge files</Trans>
            </Badge>
          ) : null}
        </div>
        {assistant.description ? (
          <p className="truncate text-xs text-muted-foreground">{assistant.description}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <NativeSelect
          className="w-72 max-w-full"
          aria-label={t`Model for ${assistant.name}`}
          data-testid={`assistant-model-${assistant.id}`}
          value={chosen?.modelId ?? ""}
          disabled={busy || !models.length}
          onChange={(event) =>
            onSave(
              event.target.value
                ? { provider, modelId: event.target.value, thinkingLevel: null }
                : null,
            )
          }
        >
          <NativeSelectOption value="">{t`Company model (${companyLabel})`}</NativeSelectOption>
          {models
            .filter((entry) => entry.id !== companyModelId || entry.id === chosen?.modelId)
            .map((entry) => (
              <NativeSelectOption key={entry.id} value={entry.id}>
                {entry.label}
              </NativeSelectOption>
            ))}
        </NativeSelect>
        {chosen && thinkingLevels.length ? (
          <NativeSelect
            className="w-44"
            aria-label={t`Thinking for ${assistant.name}`}
            value={chosen.thinkingLevel ?? ""}
            disabled={busy}
            onChange={(event) =>
              onSave({
                ...chosen,
                thinkingLevel: thinkingLevels.find((level) => level === event.target.value) ?? null,
              })
            }
          >
            <NativeSelectOption value="">{t`Company thinking`}</NativeSelectOption>
            {thinkingLevels.map((level) => (
              <NativeSelectOption key={level} value={level}>
                {thinkingLevelLabel(level)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : null}
      </div>
    </li>
  );
}
