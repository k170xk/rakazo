import { Trans, useLingui } from "@lingui/react/macro";
import type { RoutineActivity, RoutineActivityPeriod } from "@rakazo/contracts";
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
import { useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { errorText } from "../lib/user-error";

/** Routines created over time, per person, with how many are on and how often they ran. */
export function RoutineActivitySection() {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const [period, setPeriod] = useState<RoutineActivityPeriod>("30d");
  const activity = useQuery({
    ...queries.companyAdmin.routineActivity.queryOptions({ input: { period } }),
    refetchInterval: 60_000,
  });
  const count = new Intl.NumberFormat(i18n.locale);
  const date = new Intl.DateTimeFormat(i18n.locale, { dateStyle: "medium" });
  const periods: { value: RoutineActivityPeriod; label: string }[] = [
    { value: "7d", label: t`Last 7 days` },
    { value: "30d", label: t`Last 30 days` },
    { value: "90d", label: t`Last 90 days` },
  ];
  const data = activity.data;

  return (
    <section className="space-y-4" data-testid="routine-activity">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">
            <Trans>Routines</Trans>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            <Trans>
              Routines created each day and by whom, including ones since deleted. Updates every
              minute.
            </Trans>
          </p>
        </div>
        <NativeSelect
          aria-label={t`Period`}
          value={period}
          onChange={(event) => setPeriod(event.target.value as RoutineActivityPeriod)}
        >
          {periods.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {activity.isPending ? (
        <div className="grid place-items-center py-8">
          <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
        </div>
      ) : activity.isError ? (
        <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
          {errorText(activity.error, t`Couldn't load routine activity`)}
          <Button variant="outline" size="sm" onClick={() => void activity.refetch()}>
            <Trans>Retry</Trans>
          </Button>
        </div>
      ) : data ? (
        <>
          <dl className="grid grid-cols-3 gap-3">
            {[
              { label: t`Created`, value: count.format(data.totals.created) },
              { label: t`Switched on now`, value: count.format(data.totals.active) },
              { label: t`Runs`, value: count.format(data.totals.runs) },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-border px-4 py-3">
                <dt className="text-[12.5px] text-muted-foreground">{stat.label}</dt>
                <dd className="mt-1 text-[18px] font-medium tabular-nums">{stat.value}</dd>
              </div>
            ))}
          </dl>
          <CreatedChart days={data.days} format={(day) => date.format(new Date(day))} />
          {data.people.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              <Trans>No routines in this period.</Trans>
            </p>
          ) : (
            <div className="rounded-xl border border-border px-2">
              <Table className="text-[13.5px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-muted-foreground">
                      <Trans>Person</Trans>
                    </TableHead>
                    <TableHead className="hidden text-muted-foreground sm:table-cell">
                      <Trans>Trend</Trans>
                    </TableHead>
                    <TableHead className="text-right text-muted-foreground">
                      <Trans>Created</Trans>
                    </TableHead>
                    <TableHead className="text-right text-muted-foreground">
                      <Trans>On now</Trans>
                    </TableHead>
                    <TableHead className="text-right text-muted-foreground">
                      <Trans>Runs</Trans>
                    </TableHead>
                    <TableHead className="hidden text-right text-muted-foreground md:table-cell">
                      <Trans>Last created</Trans>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.people.map((person) => (
                    <TableRow key={person.userId}>
                      <TableCell>
                        <span className="block text-foreground">{person.name}</span>
                        {person.email && person.email !== person.name ? (
                          <span className="block text-[12px] text-muted-foreground">
                            {person.email}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Sparkline values={person.daily} />
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {count.format(person.created)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {count.format(person.active)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {count.format(person.runs)}
                      </TableCell>
                      <TableCell className="hidden text-right text-muted-foreground md:table-cell">
                        {person.lastCreatedAt ? date.format(new Date(person.lastCreatedAt)) : "—"}
                      </TableCell>
                    </TableRow>
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

function CreatedChart({
  days,
  format,
}: {
  days: RoutineActivity["days"];
  format: (day: string) => string;
}) {
  const { t } = useLingui();
  const max = Math.max(1, ...days.map((day) => day.created));
  return (
    <figure className="rounded-xl border border-border px-4 py-3">
      <figcaption className="text-[12.5px] text-muted-foreground">
        <Trans>Routines created per day</Trans>
      </figcaption>
      <div
        className="mt-3 flex h-28 items-end gap-[2px]"
        role="img"
        aria-label={t`Routines created per day`}
      >
        {days.map((day) => (
          <div
            key={day.day}
            title={`${format(day.day)}: ${day.created}`}
            className="flex-1 rounded-t-sm bg-primary/70 hover:bg-primary"
            style={{ height: `${Math.max(day.created ? 6 : 1, (day.created / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11.5px] text-muted-foreground">
        <span>{days[0] ? format(days[0].day) : ""}</span>
        <span>{days.at(-1) ? format(days.at(-1)?.day ?? "") : ""}</span>
      </div>
    </figure>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-6 w-28 items-end gap-px" aria-hidden>
      {values.map((value, index) => (
        <div
          key={index}
          className={value ? "flex-1 bg-primary/70" : "flex-1 bg-muted"}
          style={{ height: `${value ? Math.max(15, (value / max) * 100) : 8}%` }}
        />
      ))}
    </div>
  );
}
