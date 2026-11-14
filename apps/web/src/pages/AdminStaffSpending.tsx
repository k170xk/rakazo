import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { StaffSpending, StaffSpendingPeriod } from "@rakazo/contracts";
import { Button, NativeSelect, NativeSelectOption, Spinner } from "@rakazo/ui-web";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rakazo/ui-web/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { Fragment, useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { errorText } from "../lib/user-error";

type Person = StaffSpending["people"][number];

/** Model spending per person across the company, with each person's models on expand. */
export function StaffSpendingSection() {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const [period, setPeriod] = useState<StaffSpendingPeriod>("30d");
  const [open, setOpen] = useState<string | null>(null);
  const spending = useQuery({
    ...queries.companyAdmin.spending.queryOptions({ input: { period } }),
    refetchInterval: 60_000,
  });
  const count = new Intl.NumberFormat(i18n.locale);
  const usd = new Intl.NumberFormat(i18n.locale, { style: "currency", currency: "USD" });
  const number = (value: number | null) => (value == null ? "—" : count.format(value));
  const cost = (value: number | null) =>
    value == null ? "—" : value > 0 && value < 0.01 ? `<${usd.format(0.01)}` : usd.format(value);
  const date = new Intl.DateTimeFormat(i18n.locale, { dateStyle: "medium", timeStyle: "short" });
  const periods: { value: StaffSpendingPeriod; label: string }[] = [
    { value: "7d", label: t`Last 7 days` },
    { value: "30d", label: t`Last 30 days` },
    { value: "90d", label: t`Last 90 days` },
    { value: "all", label: t`All time` },
  ];
  const data = spending.data;

  return (
    <section className="space-y-4" data-testid="staff-spending">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">
            <Trans>Staff spending</Trans>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            <Trans>
              What each person's chats, agents and routines have cost in model usage. Updates every
              minute.
            </Trans>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <NativeSelect
            aria-label={t`Period`}
            value={period}
            onChange={(event) => setPeriod(event.target.value as StaffSpendingPeriod)}
          >
            {periods.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            variant="outline"
            size="sm"
            disabled={!data?.people.length}
            onClick={() => data && downloadCsv(data)}
          >
            <Download className="me-1 size-3.5" />
            <Trans>CSV</Trans>
          </Button>
        </div>
      </div>

      {spending.isPending ? (
        <div className="grid place-items-center py-8">
          <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
        </div>
      ) : spending.isError ? (
        <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
          {errorText(spending.error, t`Couldn't load staff spending`)}
          <Button variant="outline" size="sm" onClick={() => void spending.refetch()}>
            <Trans>Retry</Trans>
          </Button>
        </div>
      ) : data ? (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: t`Total cost`, value: cost(data.totals.costUsd) },
              { label: t`People`, value: number(data.totals.people) },
              { label: t`Model calls`, value: number(data.totals.modelCalls) },
              { label: t`Tokens`, value: number(data.totals.totalTokens) },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-border px-4 py-3">
                <dt className="text-[12.5px] text-muted-foreground">{stat.label}</dt>
                <dd className="mt-1 text-[18px] font-medium tabular-nums">{stat.value}</dd>
              </div>
            ))}
          </dl>
          {data.totals.unmeasuredCalls > 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              <Plural
                value={data.totals.unmeasuredCalls}
                one="# call reported no cost, usually because it failed before the model replied, and is left out of the totals."
                other="# calls reported no cost, usually because they failed before the model replied, and are left out of the totals."
              />
            </p>
          ) : null}
          {data.people.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              <Trans>No model usage in this period.</Trans>
            </p>
          ) : (
            <div className="rounded-xl border border-border px-2">
              <Table className="text-[13.5px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-muted-foreground">
                      <Trans>Person</Trans>
                    </TableHead>
                    <TableHead className="text-right text-muted-foreground">
                      <Trans>Calls</Trans>
                    </TableHead>
                    <TableHead className="text-right text-muted-foreground">
                      <Trans>Tokens</Trans>
                    </TableHead>
                    <TableHead className="text-right text-muted-foreground">
                      <Trans>Cost</Trans>
                    </TableHead>
                    <TableHead className="hidden text-right text-muted-foreground sm:table-cell">
                      <Trans>Last used</Trans>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.people.map((person) => (
                    <Fragment key={person.userId}>
                      <PersonRow
                        person={person}
                        expanded={open === person.userId}
                        onToggle={() => setOpen(open === person.userId ? null : person.userId)}
                        number={number}
                        cost={cost}
                        lastUsed={date.format(new Date(person.lastUsedAt))}
                      />
                      {open === person.userId
                        ? person.models.map((model) => (
                            <TableRow
                              key={`${model.provider}:${model.model}`}
                              className="bg-muted/40 hover:bg-muted/40"
                            >
                              <TableCell className="ps-10">
                                <div>{model.model}</div>
                                <div className="text-[12px] text-muted-foreground">
                                  {model.provider}
                                </div>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {number(model.modelCalls)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {number(model.totalTokens)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {cost(model.costUsd)}
                              </TableCell>
                              <TableCell className="hidden sm:table-cell" />
                            </TableRow>
                          ))
                        : null}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

function PersonRow({
  person,
  expanded,
  onToggle,
  number,
  cost,
  lastUsed,
}: {
  person: Person;
  expanded: boolean;
  onToggle: () => void;
  number: (value: number | null) => string;
  cost: (value: number | null) => string;
  lastUsed: string;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <TableRow className="cursor-pointer" onClick={onToggle}>
      <TableCell>
        <button
          type="button"
          className="flex items-center gap-2 text-start"
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          <Chevron className="size-4 shrink-0 text-muted-foreground" />
          <span>
            <span className="block text-foreground">{person.name}</span>
            {person.email && person.email !== person.name ? (
              <span className="block text-[12px] text-muted-foreground">{person.email}</span>
            ) : null}
          </span>
        </button>
      </TableCell>
      <TableCell className="text-right tabular-nums">{number(person.modelCalls)}</TableCell>
      <TableCell className="text-right tabular-nums">{number(person.totalTokens)}</TableCell>
      <TableCell className="text-right font-medium tabular-nums">{cost(person.costUsd)}</TableCell>
      <TableCell className="hidden text-right text-muted-foreground sm:table-cell">
        {lastUsed}
      </TableCell>
    </TableRow>
  );
}

function downloadCsv(data: StaffSpending) {
  const cell = (value: string | number | null) => {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const rows = [
    ["Name", "Email", "Model", "Provider", "Calls", "Input tokens", "Output tokens", "Cost (USD)"],
    ...data.people.flatMap((person) =>
      person.models.map((model) => [
        person.name,
        person.email,
        model.model,
        model.provider,
        model.modelCalls,
        model.inputTokens,
        model.outputTokens,
        model.costUsd == null ? null : model.costUsd.toFixed(4),
      ]),
    ),
  ];
  const blob = new Blob([rows.map((row) => row.map(cell).join(",")).join("\n")], {
    type: "text/csv",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `staff-spending-${data.period}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
