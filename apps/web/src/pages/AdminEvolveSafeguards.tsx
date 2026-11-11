import { Trans, useLingui } from "@lingui/react/macro";
import type { EvolveChangeTool, EvolveSafeguards, EvolveSafeguardsState } from "@rakazo/contracts";
import { EVOLVE_CHANGE_TOOLS } from "@rakazo/contracts";
import {
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  Spinner,
  Switch,
  toast,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useId, useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

type Limit = EvolveSafeguards["limits"][EvolveChangeTool];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const LIMIT_BOUNDS: Record<keyof Limit, [number, number]> = {
  hour: [0, 1000],
  day: [0, 5000],
  projects: [1, 500],
};
const clamp = (value: number, [min, max]: [number, number]) =>
  Number.isFinite(value) ? Math.min(Math.max(Math.round(value), min), max) : min;

/**
 * Who may add, change and delete Evolve deadlines and work packages through the AI, and how much
 * one person may change. Stored and enforced in Evolve; only Evolve admins can read or set it.
 */
export function EvolveSafeguardsSection() {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const state = useQuery(queries.companyAdmin.evolveSafeguards.get.queryOptions());
  const [form, setForm] = useState<EvolveSafeguards | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (state.data) setForm(state.data.settings);
  }, [state.data]);

  const toolName: Record<EvolveChangeTool, string> = {
    add_project_deadline: t`Add deadlines`,
    update_project_deadline: t`Change deadlines`,
    add_work_package: t`Add work packages`,
    update_work_package: t`Change work packages`,
    delete_work_package: t`Delete work packages`,
  };

  if (state.isPending) return <Spinner />;
  if (state.error || !state.data || !form) {
    return (
      <Frame>
        <p role="alert" className="text-sm text-destructive">
          {errorText(state.error, t`Could not read the safeguards from Evolve`)}
        </p>
      </Frame>
    );
  }
  const data = state.data;
  const dirty = !same(form, data.settings);
  const set = <K extends keyof EvolveSafeguards>(key: K, value: EvolveSafeguards[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));
  const setLimit = (tool: EvolveChangeTool, key: keyof Limit, value: number) =>
    setForm((current) =>
      current
        ? {
            ...current,
            limits: {
              ...current.limits,
              [tool]: { ...current.limits[tool], [key]: clamp(value, LIMIT_BOUNDS[key]) },
            },
          }
        : current,
    );

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const next = await rpc.companyAdmin.evolveSafeguards.set(form);
      queryClient.setQueryData(queries.companyAdmin.evolveSafeguards.get.queryKey(), next);
      toast.success(t`Safeguards saved in Evolve`);
    } catch (err) {
      toast.error(errorText(err, t`Could not save the safeguards`));
    } finally {
      setSaving(false);
    }
  }

  const updated = data.updatedAt
    ? i18n.date(new Date(data.updatedAt), { dateStyle: "medium", timeStyle: "short" })
    : null;

  return (
    <Frame>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">
          <Trans>Who can change projects</Trans>
        </h3>
        <ul className="divide-y divide-border rounded-xl border border-border">
          <ToggleRow
            label={t`Deadlines: Design Team only`}
            detail={t`Only people on the project's Design Team, and Evolve admins, can add or change its deadlines.`}
            checked={form.deadlinesTeamOnly}
            onChange={(on) => set("deadlinesTeamOnly", on)}
          />
          <ToggleRow
            label={t`Work packages: Design Team only`}
            detail={t`Only people on the project's Design Team, and Evolve admins, can add, change or delete its work packages.`}
            checked={form.workPackagesTeamOnly}
            onChange={(on) => set("workPackagesTeamOnly", on)}
          />
          <ToggleRow
            label={t`Requester and assignee can change their own`}
            detail={t`A work package's requester and assignee can change it, and anyone can add one assigned to themselves, even when they are not on the team.`}
            checked={form.involvedMayChange}
            onChange={(on) => set("involvedMayChange", on)}
          />
          <SelectRow
            label={t`Projects with no Design Team`}
            detail={t`About one in ten projects has no Design Team set in Evolve.`}
            value={form.noTeamProjects}
            options={[
              { value: "open", label: t`Any active staff member` },
              { value: "admins", label: t`Evolve admins only` },
            ]}
            onChange={(value) => set("noTeamProjects", value as EvolveSafeguards["noTeamProjects"])}
          />
        </ul>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">
          <Trans>Limits per person</Trans>
        </h3>
        <p className="text-[13px] text-muted-foreground">
          <Trans>
            Counted from the changes each person has saved through the AI. Set a tool's hourly limit
            to 0 to pause it for everyone. Deletes count projects over 24 hours, everything else
            over an hour.
          </Trans>
        </p>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm" data-testid="safeguard-limits">
            <thead className="border-b border-border text-left text-[12.5px] text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">
                  <Trans>Change</Trans>
                </th>
                <th className="px-2 py-2 font-medium">
                  <Trans>Per hour</Trans>
                </th>
                <th className="px-2 py-2 font-medium">
                  <Trans>Per day</Trans>
                </th>
                <th className="px-2 py-2 font-medium">
                  <Trans>Projects</Trans>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {EVOLVE_CHANGE_TOOLS.map((tool) => (
                <tr key={tool}>
                  <td className="px-4 py-2">{toolName[tool]}</td>
                  {(["hour", "day", "projects"] as const).map((key) => (
                    <td key={key} className="px-2 py-2">
                      <Input
                        type="number"
                        min={key === "projects" ? 1 : 0}
                        max={key === "hour" ? 1000 : key === "day" ? 5000 : 500}
                        aria-label={`${toolName[tool]}: ${key}`}
                        className="h-8 w-24"
                        value={form.limits[tool][key]}
                        onChange={(event) => setLimit(tool, key, Number(event.target.value))}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="divide-y divide-border rounded-xl border border-border">
          <ToggleRow
            label={t`Limits apply to admins too`}
            detail={t`Keeps the limits on everyone, so one admin account cannot change Evolve in bulk either.`}
            checked={form.limitsApplyToAdmins}
            onChange={(on) => set("limitsApplyToAdmins", on)}
          />
          <ToggleRow
            label={t`Refuse duplicate deadlines`}
            detail={t`A deadline with the same name and date as one already on the project is not added again.`}
            checked={form.refuseDuplicateDeadlines}
            onChange={(on) => set("refuseDuplicateDeadlines", on)}
          />
          <NumberRow
            label={t`Most deadlines a project may hold`}
            value={form.maxDeadlinesPerProject}
            min={10}
            max={5000}
            onChange={(value) => set("maxDeadlinesPerProject", value)}
          />
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? <Trans>Saving…</Trans> : <Trans>Save safeguards</Trans>}
        </Button>
        <Button
          variant="outline"
          disabled={!dirty || saving}
          onClick={() => setForm(data.settings)}
        >
          <Trans>Discard changes</Trans>
        </Button>
        <Button
          variant="ghost"
          disabled={saving || same(form, data.defaults)}
          onClick={() => setForm(data.defaults)}
        >
          <Trans>Use recommended settings</Trans>
        </Button>
        <span className="text-[13px] text-muted-foreground">
          {updated ? (
            data.updatedBy ? (
              <Trans>
                Last changed by {data.updatedBy}, {updated}. Earlier versions are kept in Evolve.
              </Trans>
            ) : (
              <Trans>Last changed {updated}. Earlier versions are kept in Evolve.</Trans>
            )
          ) : (
            <Trans>Using the recommended settings.</Trans>
          )}
        </span>
      </div>

      <RecentChanges recent={data.recent} toolName={toolName} />
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <section className="space-y-6" data-testid="evolve-safeguards">
      <div>
        <h2 className="text-base font-medium">
          <Trans>AI safeguards</Trans>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <Trans>
            Who can add, change and delete Evolve deadlines and work packages through the AI, and
            how much one person can change. Every change also needs the person's approval on a card.
            Evolve enforces these, and only Evolve admins can change them.
          </Trans>
        </p>
      </div>
      {children}
    </section>
  );
}

function ToggleRow({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <li className="flex items-center gap-4 px-4 py-3">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-[13px] text-muted-foreground">{detail}</span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </li>
  );
}

function SelectRow({
  label,
  detail,
  value,
  options,
  onChange,
}: {
  label: string;
  detail: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <li className="flex flex-wrap items-center gap-4 px-4 py-3">
      <label htmlFor={id} className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-[13px] text-muted-foreground">{detail}</span>
      </label>
      <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </li>
  );
}

function NumberRow({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <li className="flex items-center gap-4 px-4 py-3">
      <label htmlFor={id} className="min-w-0 flex-1 text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        className="h-8 w-24"
        value={value}
        onChange={(event) => onChange(clamp(Number(event.target.value), [min, max]))}
      />
    </li>
  );
}

function RecentChanges({
  recent,
  toolName,
}: {
  recent: EvolveSafeguardsState["recent"];
  toolName: Record<EvolveChangeTool, string>;
}) {
  const { t, i18n } = useLingui();
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">
        <Trans>Recent AI changes in Evolve</Trans>
      </h3>
      {recent.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          <Trans>No deadline or work package has been changed through the AI yet.</Trans>
        </p>
      ) : (
        <ul
          className="divide-y divide-border rounded-xl border border-border"
          data-testid="safeguard-recent"
        >
          {recent.map((change) => (
            <li
              key={change.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5"
            >
              <span className="text-sm font-medium">
                {toolName[change.tool as EvolveChangeTool] ?? change.tool}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {[change.project, change.label].filter(Boolean).join(" · ")}
              </span>
              <span className="text-[12.5px] text-muted-foreground">
                {change.person ?? t`Unknown person`} ·{" "}
                {i18n.date(new Date(change.at), { dateStyle: "medium", timeStyle: "short" })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
