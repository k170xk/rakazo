import { Trans, useLingui } from "@lingui/react/macro";
import type {
  ModelCatalogEntry,
  StaffLimits,
  StaffLimitsState,
  StaffPersonLimits,
} from "@rakazo/contracts";
import {
  allowedModelKey,
  MAX_ACTIVE_ROUTINES_MAX,
  MONTHLY_BUDGET_USD_MAX,
  ROUTINE_RUNS_PER_DAY_MAX,
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
  toast,
} from "@rakazo/ui-web";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rakazo/ui-web/components/ui/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { Fragment, useMemo, useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

type Person = StaffLimitsState["people"][number];

function wholeNumber(text: string, min: number, max: number): number | null {
  const value = Number(text);
  return text.trim() && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function dollars(text: string): number | null {
  const value = Number(text);
  return text.trim() && Number.isFinite(value) && value >= 0 && value <= MONTHLY_BUDGET_USD_MAX
    ? Math.round(value * 100) / 100
    : null;
}

/** Routine and spend limits for everyone, and each person's overrides. */
export function StaffLimitsSection() {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const state = useQuery(queries.companyAdmin.staffLimits.get.queryOptions());
  const catalog = useQuery({
    queryKey: ["company-admin", "catalog"],
    queryFn: () => rpc.models.list(),
    staleTime: 60_000,
  });
  const [open, setOpen] = useState<string | null>(null);
  const usd = new Intl.NumberFormat(i18n.locale, { style: "currency", currency: "USD" });

  function saved(next: StaffLimitsState) {
    queryClient.setQueryData(queries.companyAdmin.staffLimits.get.queryKey(), next);
    void queryClient.invalidateQueries({ queryKey: queries.me.key() });
  }

  const models = useMemo(
    () =>
      (catalog.data ?? []).filter(
        (entry: ModelCatalogEntry) => !entry.placeholder && entry.auth !== "oauth",
      ),
    [catalog.data],
  );

  if (state.isPending)
    return (
      <div className="grid place-items-center py-8">
        <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
      </div>
    );
  if (state.isError)
    return (
      <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
        {errorText(state.error, t`Couldn't load staff limits`)}
        <Button variant="outline" size="sm" onClick={() => void state.refetch()}>
          <Trans>Retry</Trans>
        </Button>
      </div>
    );
  const data = state.data;

  return (
    <section className="space-y-8" data-testid="staff-limits">
      <CompanyLimitsForm defaults={data.defaults} onSaved={saved} />
      <div className="space-y-3">
        <div>
          <h2 className="text-base font-medium">
            <Trans>People</Trans>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            <Trans>
              Give one person different limits, let them choose models or not, and pick which models
              they may use. Admins follow these limits too.
            </Trans>
          </p>
        </div>
        <div className="rounded-xl border border-border px-2">
          <Table className="text-[13.5px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-muted-foreground">
                  <Trans>Person</Trans>
                </TableHead>
                <TableHead className="text-right text-muted-foreground">
                  <Trans>Routines on</Trans>
                </TableHead>
                <TableHead className="text-right text-muted-foreground">
                  <Trans>Spent this month</Trans>
                </TableHead>
                <TableHead className="hidden text-muted-foreground md:table-cell">
                  <Trans>Models</Trans>
                </TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.people.map((person) => (
                <Fragment key={person.userId}>
                  <PersonRow
                    person={person}
                    state={data}
                    usd={usd}
                    expanded={open === person.userId}
                    onToggle={() => setOpen(open === person.userId ? null : person.userId)}
                  />
                  {open === person.userId ? (
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={5} className="p-4">
                        <PersonEditor
                          person={person}
                          state={data}
                          models={models}
                          modelsLoading={catalog.isPending}
                          onSaved={(next) => {
                            saved(next);
                            setOpen(null);
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  );
}

function CompanyLimitsForm({
  defaults,
  onSaved,
}: {
  defaults: StaffLimits;
  onSaved: (next: StaffLimitsState) => void;
}) {
  const { t } = useLingui();
  const [runs, setRuns] = useState(String(defaults.routineRunsPerDay));
  const [routines, setRoutines] = useState(String(defaults.maxActiveRoutines));
  const [budget, setBudget] = useState(
    defaults.monthlyBudgetUsd === null ? "" : String(defaults.monthlyBudgetUsd),
  );
  const [busy, setBusy] = useState(false);
  const runsValue = wholeNumber(runs, 1, ROUTINE_RUNS_PER_DAY_MAX);
  const routinesValue = wholeNumber(routines, 0, MAX_ACTIVE_ROUTINES_MAX);
  const budgetValue = budget.trim() ? dollars(budget) : null;
  const valid =
    runsValue !== null && routinesValue !== null && (!budget.trim() || budgetValue !== null);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      onSaved(
        await rpc.companyAdmin.staffLimits.setDefaults({
          routineRunsPerDay: runsValue,
          maxActiveRoutines: routinesValue,
          monthlyBudgetUsd: budgetValue,
        }),
      );
      toast.success(t`Company limits saved`);
    } catch (error) {
      toast.error(errorText(error, t`Could not save the company limits`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div>
        <h2 className="text-base font-medium">
          <Trans>Company limits</Trans>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <Trans>
            Everyone follows these unless you set something different for them below. Changes apply
            within a minute.
          </Trans>
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="limit-runs">
            <Trans>Runs per routine per day</Trans>
          </FieldLabel>
          <Input
            id="limit-runs"
            inputMode="numeric"
            value={runs}
            onChange={(event) => setRuns(event.target.value)}
            aria-invalid={runsValue === null}
          />
          <FieldDescription>
            <Trans>
              Covers schedules, change checks, webhooks and messages. A run past the limit waits
              until the day's window clears.
            </Trans>
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="limit-routines">
            <Trans>Routines switched on per person</Trans>
          </FieldLabel>
          <Input
            id="limit-routines"
            inputMode="numeric"
            value={routines}
            onChange={(event) => setRoutines(event.target.value)}
            aria-invalid={routinesValue === null}
          />
          <FieldDescription>
            <Trans>0 stops people switching on routines.</Trans>
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="limit-budget">
            <Trans>Monthly AI budget per person (USD)</Trans>
          </FieldLabel>
          <Input
            id="limit-budget"
            inputMode="decimal"
            placeholder={t`No budget`}
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
            aria-invalid={Boolean(budget.trim()) && budgetValue === null}
          />
          <FieldDescription>
            <Trans>
              When someone reaches it, their chats and routines stop until next month or until you
              raise it. Leave empty for no budget.
            </Trans>
          </FieldDescription>
        </Field>
      </div>
      <Button type="submit" disabled={!valid || busy}>
        {busy ? <Spinner className="me-1 size-3.5" /> : null}
        <Trans>Save company limits</Trans>
      </Button>
    </form>
  );
}

function PersonRow({
  person,
  state,
  usd,
  expanded,
  onToggle,
}: {
  person: Person;
  state: StaffLimitsState;
  usd: Intl.NumberFormat;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useLingui();
  const maxRoutines = person.maxActiveRoutines ?? state.defaults.maxActiveRoutines;
  const budget =
    person.monthlyBudgetUsd === "none"
      ? null
      : (person.monthlyBudgetUsd ?? state.defaults.monthlyBudgetUsd);
  const chooses =
    person.modelAccess === null ? state.memberModels : person.modelAccess === "choose";
  const overBudget = budget !== null && person.spentThisMonthUsd >= budget;
  return (
    <TableRow>
      <TableCell>
        <span className="block text-foreground">{person.name}</span>
        {person.email && person.email !== person.name ? (
          <span className="block text-[12px] text-muted-foreground">{person.email}</span>
        ) : null}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {person.activeRoutines} / {maxRoutines}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <span className={overBudget ? "font-medium text-destructive" : undefined}>
          {usd.format(person.spentThisMonthUsd)}
        </span>
        {budget !== null ? (
          <span className="text-muted-foreground"> / {usd.format(budget)}</span>
        ) : null}
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {chooses ? (
          <Badge variant="secondary">
            {person.allowedModels.length
              ? t`Chooses from ${person.allowedModels.length}`
              : t`Chooses`}
          </Badge>
        ) : (
          <Badge variant="outline">{t`Company model`}</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={onToggle}>
          {expanded ? <Trans>Close</Trans> : <Trans>Edit</Trans>}
        </Button>
      </TableCell>
    </TableRow>
  );
}

type Draft = {
  runs: string;
  routines: string;
  budgetMode: "company" | "none" | "custom";
  budget: string;
  modelAccess: "company" | "choose" | "fixed";
  allowed: Set<string>;
};

function draftFrom(person: Person): Draft {
  return {
    runs: person.routineRunsPerDay === null ? "" : String(person.routineRunsPerDay),
    routines: person.maxActiveRoutines === null ? "" : String(person.maxActiveRoutines),
    budgetMode:
      person.monthlyBudgetUsd === null
        ? "company"
        : person.monthlyBudgetUsd === "none"
          ? "none"
          : "custom",
    budget: typeof person.monthlyBudgetUsd === "number" ? String(person.monthlyBudgetUsd) : "",
    modelAccess: person.modelAccess ?? "company",
    allowed: new Set(person.allowedModels),
  };
}

function PersonEditor({
  person,
  state,
  models,
  modelsLoading,
  onSaved,
}: {
  person: Person;
  state: StaffLimitsState;
  models: ModelCatalogEntry[];
  modelsLoading: boolean;
  onSaved: (next: StaffLimitsState) => void;
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState(() => draftFrom(person));
  const [busy, setBusy] = useState(false);
  const runs = draft.runs.trim() ? wholeNumber(draft.runs, 1, ROUTINE_RUNS_PER_DAY_MAX) : null;
  const routines = draft.routines.trim()
    ? wholeNumber(draft.routines, 0, MAX_ACTIVE_ROUTINES_MAX)
    : null;
  const budget = draft.budgetMode === "custom" ? dollars(draft.budget) : null;
  const valid =
    (!draft.runs.trim() || runs !== null) &&
    (!draft.routines.trim() || routines !== null) &&
    (draft.budgetMode !== "custom" || budget !== null);
  const chooses =
    draft.modelAccess === "company" ? state.memberModels : draft.modelAccess === "choose";
  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const companyBudget = state.defaults.monthlyBudgetUsd;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const input: StaffPersonLimits & { userId: string } = {
        userId: person.userId,
        routineRunsPerDay: runs,
        maxActiveRoutines: routines,
        monthlyBudgetUsd:
          draft.budgetMode === "company" ? null : draft.budgetMode === "none" ? "none" : budget,
        modelAccess: draft.modelAccess === "company" ? null : draft.modelAccess,
        allowedModels: [...draft.allowed],
      };
      onSaved(await rpc.companyAdmin.staffLimits.setPerson(input));
      toast.success(t`Limits saved for ${person.name}`);
    } catch (error) {
      toast.error(errorText(error, t`Could not save these limits`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4" data-testid="person-limits-editor">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field>
          <FieldLabel htmlFor={`runs-${person.userId}`}>
            <Trans>Runs per routine per day</Trans>
          </FieldLabel>
          <Input
            id={`runs-${person.userId}`}
            inputMode="numeric"
            placeholder={t`Company (${state.defaults.routineRunsPerDay})`}
            value={draft.runs}
            onChange={(event) => update({ runs: event.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`routines-${person.userId}`}>
            <Trans>Routines switched on</Trans>
          </FieldLabel>
          <Input
            id={`routines-${person.userId}`}
            inputMode="numeric"
            placeholder={t`Company (${state.defaults.maxActiveRoutines})`}
            value={draft.routines}
            onChange={(event) => update({ routines: event.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`budget-${person.userId}`}>
            <Trans>Monthly AI budget</Trans>
          </FieldLabel>
          <div className="flex gap-2">
            <NativeSelect
              id={`budget-${person.userId}`}
              value={draft.budgetMode}
              onChange={(event) =>
                update({ budgetMode: event.target.value as Draft["budgetMode"] })
              }
            >
              <NativeSelectOption value="company">
                {companyBudget === null ? t`Company (none)` : t`Company ($${companyBudget})`}
              </NativeSelectOption>
              <NativeSelectOption value="none">{t`No budget`}</NativeSelectOption>
              <NativeSelectOption value="custom">{t`Set amount`}</NativeSelectOption>
            </NativeSelect>
            {draft.budgetMode === "custom" ? (
              <Input
                aria-label={t`Budget in US dollars`}
                inputMode="decimal"
                className="w-28"
                value={draft.budget}
                onChange={(event) => update({ budget: event.target.value })}
                aria-invalid={budget === null}
              />
            ) : null}
          </div>
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor={`models-${person.userId}`}>
          <Trans>Model choice</Trans>
        </FieldLabel>
        <NativeSelect
          id={`models-${person.userId}`}
          value={draft.modelAccess}
          onChange={(event) => update({ modelAccess: event.target.value as Draft["modelAccess"] })}
        >
          <NativeSelectOption value="company">
            {state.memberModels
              ? t`Company setting (may choose)`
              : t`Company setting (company model)`}
          </NativeSelectOption>
          <NativeSelectOption value="choose">{t`May choose models`}</NativeSelectOption>
          <NativeSelectOption value="fixed">{t`Always uses the company model`}</NativeSelectOption>
        </NativeSelect>
        <FieldDescription>
          <Trans>
            Someone who may choose can change their assistants' and routines' models. Anyone else
            runs on the company model.
          </Trans>
        </FieldDescription>
      </Field>
      {chooses ? (
        <AllowedModelsPicker
          models={models}
          loading={modelsLoading}
          allowed={draft.allowed}
          onChange={(allowed) => update({ allowed })}
        />
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={!valid || busy}>
          {busy ? <Spinner className="me-1 size-3.5" /> : null}
          <Trans>Save</Trans>
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() =>
            setDraft({
              runs: "",
              routines: "",
              budgetMode: "company",
              budget: "",
              modelAccess: "company",
              allowed: new Set(),
            })
          }
        >
          <Trans>Use company settings</Trans>
        </Button>
      </div>
    </form>
  );
}

function AllowedModelsPicker({
  models,
  loading,
  allowed,
  onChange,
}: {
  models: ModelCatalogEntry[];
  loading: boolean;
  allowed: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const { t } = useLingui();
  const [filter, setFilter] = useState("");
  const shown = models.filter((entry) => {
    const text = `${entry.providerName ?? entry.provider} ${entry.label || entry.id}`.toLowerCase();
    return text.includes(filter.trim().toLowerCase());
  });
  const toggle = (key: string, on: boolean) => {
    const next = new Set(allowed);
    if (on) next.add(key);
    else next.delete(key);
    onChange(next);
  };
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">
        <Trans>Models they may pick</Trans>
      </legend>
      <p className="text-[12.5px] text-muted-foreground">
        {allowed.size === 0 ? (
          <Trans>None ticked: every model is allowed.</Trans>
        ) : (
          <Trans>Only the ticked models are allowed.</Trans>
        )}
      </p>
      <Input
        aria-label={t`Filter models`}
        placeholder={t`Filter models`}
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        className="max-w-xs"
      />
      {loading ? (
        <Spinner className="size-4 text-muted-foreground" aria-label={t`Loading…`} />
      ) : (
        <div className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2">
          {shown.map((entry) => {
            const key = allowedModelKey(entry.provider, entry.id);
            return (
              <label
                key={key}
                htmlFor={`allowed-${key}`}
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-muted"
              >
                <Checkbox
                  id={`allowed-${key}`}
                  checked={allowed.has(key)}
                  onCheckedChange={(checked) => toggle(key, checked === true)}
                />
                <span className="min-w-0">
                  <span className="block truncate">{entry.label || entry.id}</span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {entry.providerName ?? entry.provider}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
