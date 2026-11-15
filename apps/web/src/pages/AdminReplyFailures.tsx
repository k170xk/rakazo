import { Trans, useLingui } from "@lingui/react/macro";
import type { ReplyFailurePeriod, ReplyFailures } from "@rakazo/contracts";
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

/** Replies that failed each day and for which agent, split by why they failed. */
export function ReplyFailuresSection() {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const [period, setPeriod] = useState<ReplyFailurePeriod>("30d");
  const failures = useQuery({
    ...queries.companyAdmin.replyFailures.queryOptions({ input: { period } }),
    refetchInterval: 60_000,
  });
  const count = new Intl.NumberFormat(i18n.locale);
  const percent = new Intl.NumberFormat(i18n.locale, {
    style: "percent",
    maximumFractionDigits: 1,
  });
  const date = new Intl.DateTimeFormat(i18n.locale, { dateStyle: "medium" });
  const periods: { value: ReplyFailurePeriod; label: string }[] = [
    { value: "7d", label: t`Last 7 days` },
    { value: "30d", label: t`Last 30 days` },
    { value: "90d", label: t`Last 90 days` },
  ];
  const data = failures.data;
  const failed = data ? data.totals.context + data.totals.output + data.totals.other : 0;
  const share = data?.totals.finished ? percent.format(failed / data.totals.finished) : "";
  const finished = data ? count.format(data.totals.finished) : "";

  return (
    <section className="space-y-4" data-testid="reply-failures">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">
            <Trans>Reply failures</Trans>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            <Trans>
              Replies that did not finish, by day and agent. Too much to read means the message,
              images or tool results did not fit the model; output limit means the model ran out of
              room to answer. Updates every minute.
            </Trans>
          </p>
        </div>
        <NativeSelect
          aria-label={t`Period`}
          value={period}
          onChange={(event) => setPeriod(event.target.value as ReplyFailurePeriod)}
        >
          {periods.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {failures.isPending ? (
        <div className="grid place-items-center py-8">
          <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
        </div>
      ) : failures.isError ? (
        <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
          {errorText(failures.error, t`Couldn't load reply failures`)}
          <Button variant="outline" size="sm" onClick={() => void failures.refetch()}>
            <Trans>Retry</Trans>
          </Button>
        </div>
      ) : data ? (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              {
                label: t`Failed replies`,
                value: count.format(failed),
                note: data.totals.finished ? t`${share} of ${finished} replies` : null,
              },
              { label: t`Too much to read`, value: count.format(data.totals.context), note: null },
              { label: t`Output limit`, value: count.format(data.totals.output), note: null },
              { label: t`Other failures`, value: count.format(data.totals.other), note: null },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-border px-4 py-3">
                <dt className="text-[12.5px] text-muted-foreground">{stat.label}</dt>
                <dd className="mt-1 text-[18px] font-medium tabular-nums">{stat.value}</dd>
                {stat.note ? (
                  <dd className="text-[12px] text-muted-foreground tabular-nums">{stat.note}</dd>
                ) : null}
              </div>
            ))}
          </dl>
          <FailureChart days={data.days} format={(day) => date.format(new Date(day))} />
          {data.agents.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              <Trans>No failed replies in this period.</Trans>
            </p>
          ) : (
            <div className="rounded-xl border border-border px-2">
              <Table className="text-[13.5px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-muted-foreground">
                      <Trans>Agent</Trans>
                    </TableHead>
                    <TableHead className="text-right text-muted-foreground">
                      <Trans>Too much to read</Trans>
                    </TableHead>
                    <TableHead className="text-right text-muted-foreground">
                      <Trans>Output limit</Trans>
                    </TableHead>
                    <TableHead className="text-right text-muted-foreground">
                      <Trans>Other</Trans>
                    </TableHead>
                    <TableHead className="hidden text-right text-muted-foreground md:table-cell">
                      <Trans>Last failed</Trans>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.agents.map((agent) => (
                    <TableRow key={agent.botId}>
                      <TableCell>
                        <span className="block text-foreground">{agent.name}</span>
                        {agent.owner ? (
                          <span className="block text-[12px] text-muted-foreground">
                            {agent.owner}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {count.format(agent.context)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {count.format(agent.output)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {count.format(agent.other)}
                      </TableCell>
                      <TableCell className="hidden text-right text-muted-foreground md:table-cell">
                        {agent.lastFailedAt ? date.format(new Date(agent.lastFailedAt)) : "—"}
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

function FailureChart({
  days,
  format,
}: {
  days: ReplyFailures["days"];
  format: (day: string) => string;
}) {
  const { t } = useLingui();
  const max = Math.max(1, ...days.map((day) => day.context + day.output + day.other));
  const kinds = [
    { key: "context", label: t`Too much to read`, className: "bg-destructive/80" },
    { key: "output", label: t`Output limit`, className: "bg-amber-500/80" },
    { key: "other", label: t`Other`, className: "bg-muted-foreground/50" },
  ] as const;
  return (
    <figure className="rounded-xl border border-border px-4 py-3">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted-foreground">
        <Trans>Failed replies per day</Trans>
        <span className="flex gap-3">
          {kinds.map((kind) => (
            <span key={kind.key} className="flex items-center gap-1">
              <span className={`size-2 rounded-sm ${kind.className}`} aria-hidden />
              {kind.label}
            </span>
          ))}
        </span>
      </figcaption>
      <div
        className="mt-3 flex h-28 items-end gap-[2px]"
        role="img"
        aria-label={t`Failed replies per day`}
      >
        {days.map((day) => {
          const total = day.context + day.output + day.other;
          return (
            <div
              key={day.day}
              title={`${format(day.day)}: ${kinds.map((kind) => `${kind.label} ${day[kind.key]}`).join(", ")}`}
              className="flex flex-1 flex-col-reverse overflow-hidden rounded-t-sm bg-muted"
              style={{ height: `${total ? Math.max(6, (total / max) * 100) : 1}%` }}
            >
              {kinds.map((kind) =>
                day[kind.key] ? (
                  <div
                    key={kind.key}
                    className={kind.className}
                    style={{ height: `${(day[kind.key] / total) * 100}%` }}
                  />
                ) : null,
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[11.5px] text-muted-foreground">
        <span>{days[0] ? format(days[0].day) : ""}</span>
        <span>{days.at(-1) ? format(days.at(-1)?.day ?? "") : ""}</span>
      </div>
    </figure>
  );
}
