import { Trans, useLingui } from "@lingui/react/macro";
import type { CompanyAdminState, ComputerAccess } from "@rakazo/contracts";
import { Input, NativeSelect, NativeSelectOption, toast } from "@rakazo/ui-web";
import { useState } from "react";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

/** Who may use a computer beyond the company tools, and how busy the shared capacity is. */
export function CompanyComputerAccessSection({
  state,
  onSaved,
}: {
  state: CompanyAdminState;
  onSaved: (next: CompanyAdminState) => Promise<void>;
}) {
  const { t } = useLingui();
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const { defaultAccess, people, capacity } = state.computers;
  const computersOn = state.features.computers;

  const levels: Record<ComputerAccess, string> = {
    full: t`Full computer`,
    tools: t`Tools only`,
    none: t`No computer`,
  };

  async function run(key: string, action: () => Promise<CompanyAdminState>) {
    setBusy(key);
    try {
      await onSaved(await action());
    } catch (err) {
      toast.error(errorText(err, t`Could not update computer access`));
    } finally {
      setBusy(null);
    }
  }

  const query = filter.trim().toLowerCase();
  const shown = query
    ? people.filter(
        (person) =>
          person.name.toLowerCase().includes(query) || person.email.toLowerCase().includes(query),
      )
    : people;

  return (
    <section className="space-y-4" data-testid="company-computer-access">
      <div>
        <h2 className="text-base font-medium">
          <Trans>Computer access</Trans>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <Trans>
            Tools only: assistants make Word, PowerPoint, Excel, PDF and video files on the person's
            own private computer, with no shell, browser, screen or routines. Full: everything,
            including browsing and routines. No computer: chat and Evolve tools only. Every person's
            computer and files stay their own.
          </Trans>
        </p>
      </div>

      {computersOn ? null : (
        <p className="text-sm text-muted-foreground">
          <Trans>Computers are switched off above, so nobody has one.</Trans>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="computer-access-default" className="flex-1 text-sm font-medium">
          <Trans>Everyone without their own level</Trans>
        </label>
        <AccessSelect
          id="computer-access-default"
          value={defaultAccess}
          levels={levels}
          disabled={busy !== null || !computersOn}
          onChange={(access) =>
            void run("default", () =>
              rpc.companyAdmin.setTools({ defaultComputerAccess: access as ComputerAccess }),
            )
          }
        />
      </div>

      <dl className="grid grid-cols-3 gap-2 text-sm">
        <Stat label={t`Computers running`} value={String(capacity.runningComputers)} />
        <Stat
          label={t`Video renders`}
          value={`${capacity.videoRendering} / ${capacity.videoSlots}`}
        />
        <Stat label={t`Renders waiting`} value={String(capacity.videoQueued)} />
      </dl>

      {people.length > 8 ? (
        <Input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t`Find a person`}
          aria-label={t`Find a person`}
        />
      ) : null}
      <ul className="divide-y divide-border rounded-xl border border-border">
        {shown.map((person) => {
          const id = `computer-access-${person.userId}`;
          return (
            <li key={person.userId} className="flex items-center gap-4 px-4 py-3">
              <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                <span className="block truncate text-sm font-medium">{person.name}</span>
                <span className="block truncate text-[13px] text-muted-foreground">
                  {person.email}
                </span>
              </label>
              <AccessSelect
                id={id}
                value={person.access ?? "default"}
                levels={{
                  default: t`Company default (${levels[defaultAccess]})`,
                  ...levels,
                }}
                disabled={busy !== null || !computersOn}
                onChange={(access) =>
                  void run(`person:${person.userId}`, () =>
                    rpc.companyAdmin.setComputerAccess({
                      userId: person.userId,
                      access: access === "default" ? null : (access as ComputerAccess),
                    }),
                  )
                }
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AccessSelect({
  id,
  value,
  levels,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  levels: Record<string, string>;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <NativeSelect
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="w-56 max-w-full"
    >
      {Object.entries(levels).map(([level, label]) => (
        <NativeSelectOption key={level} value={level}>
          {label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/50 px-3 py-2">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="text-base font-medium tabular-nums">{value}</dd>
    </div>
  );
}
