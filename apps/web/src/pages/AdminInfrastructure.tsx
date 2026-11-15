import { Trans, useLingui } from "@lingui/react/macro";
import type {
  InfraLane,
  InfraPeriod,
  InfraSeriesKey,
  InfraServer,
  Infrastructure,
} from "@rakazo/contracts";
import { Button, NativeSelect, NativeSelectOption, Spinner } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { errorText } from "../lib/user-error";

type Focus = "computers" | "storage" | "routines";
type Line = { key: InfraSeriesKey; label: string; className: string };

function size(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function share(used: number | null, total: number | null) {
  return used !== null && total ? used / total : null;
}

/** Live and historical load of the servers behind one admin section, from the worker's readings. */
export function InfrastructurePanel({ focus }: { focus: Focus }) {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const [period, setPeriod] = useState<InfraPeriod>("24h");
  const infra = useQuery({
    ...queries.companyAdmin.infrastructure.queryOptions({ input: { period } }),
    refetchInterval: 60_000,
  });
  const time = new Intl.DateTimeFormat(i18n.locale, { timeStyle: "short" });
  const periods: { value: InfraPeriod; label: string }[] = [
    { value: "24h", label: t`Last 24 hours` },
    { value: "7d", label: t`Last 7 days` },
    { value: "30d", label: t`Last 30 days` },
  ];
  const data = infra.data;
  const latest = data?.latest;
  const sampledAt = latest ? time.format(new Date(latest.sampledAt)) : "";

  return (
    <div className="space-y-3" data-testid={`infrastructure-${focus}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="px-1 text-sm font-medium">
            <Trans>Servers</Trans>
          </h3>
          <p className="px-1 text-[12.5px] text-muted-foreground">
            {latest ? (
              <Trans>Read every minute. Last reading {sampledAt}. Charts show the peak.</Trans>
            ) : (
              <Trans>
                No readings yet. The first arrives within a minute of the worker starting.
              </Trans>
            )}
          </p>
        </div>
        <NativeSelect
          aria-label={t`Period`}
          value={period}
          onChange={(event) => setPeriod(event.target.value as InfraPeriod)}
        >
          {periods.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {infra.isPending ? (
        <div className="grid place-items-center py-6">
          <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
        </div>
      ) : infra.isError ? (
        <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
          {errorText(infra.error, t`Couldn't load server readings`)}
          <Button variant="outline" size="sm" onClick={() => void infra.refetch()}>
            <Trans>Retry</Trans>
          </Button>
        </div>
      ) : data ? (
        focus === "computers" ? (
          <ComputersView data={data} />
        ) : focus === "storage" ? (
          <StorageView data={data} />
        ) : (
          <RoutinesView data={data} />
        )
      ) : null}
    </div>
  );
}

function ComputersView({ data }: { data: Infrastructure }) {
  const { t } = useLingui();
  const sample = data.latest?.sample;
  const app = sample?.runners.app;
  const routines = sample?.runners.routines;
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-3">
        <ServerCard title={t`App server`} server={sample?.app} />
        <div className="rounded-xl border border-border px-3 py-2 text-[13px]">
          <div className="flex items-center justify-between">
            <span className="font-medium">
              <Trans>Computer host (Incus)</Trans>
            </span>
            <UpDot up={sample?.incus.up ?? false} />
          </div>
          <dl className="mt-1 space-y-0.5 text-muted-foreground">
            <Row label={t`Computers on`} value={String(sample?.incus.running ?? "—")} />
            <Row label={t`Computers off`} value={String(sample?.incus.stopped ?? "—")} />
            <Row
              label={t`Memory`}
              value={`${size(sample?.incus.memUsedBytes)} / ${size(sample?.incus.memTotalBytes)}`}
              warn={
                (share(sample?.incus.memUsedBytes ?? null, sample?.incus.memTotalBytes ?? null) ??
                  0) > 0.85
              }
            />
          </dl>
        </div>
        <ServerCard title={t`Routine server`} server={sample?.routines} />
      </div>
      <div className="rounded-xl border border-border px-3 py-2 text-[13px]">
        <div className="font-medium">
          <Trans>Tool runners</Trans>
        </div>
        <dl className="mt-1 grid gap-x-6 gap-y-0.5 text-muted-foreground sm:grid-cols-2">
          <LaneRow label={t`App: documents and tools`} lane={app?.tools} />
          <LaneRow label={t`App: large documents`} lane={app?.large} />
          <LaneRow label={t`App: video`} lane={app?.video} />
          <LaneRow label={t`Routine server: tools and overflow`} lane={routines?.tools} />
        </dl>
      </div>
      <Chart
        data={data}
        title={t`CPU busy`}
        percent
        lines={[
          { key: "appCpu", label: t`App server`, className: "stroke-primary" },
          { key: "routinesCpu", label: t`Routine server`, className: "stroke-amber-500" },
        ]}
      />
      <Chart
        data={data}
        title={t`Tool commands`}
        lines={[
          { key: "appToolsRunning", label: t`Running on app server`, className: "stroke-primary" },
          { key: "appToolsQueued", label: t`Waiting`, className: "stroke-destructive" },
          {
            key: "routinesToolsRunning",
            label: t`Running on routine server`,
            className: "stroke-amber-500",
          },
        ]}
      />
      <Chart
        data={data}
        title={t`Computers on and replies in progress`}
        lines={[
          { key: "incusRunning", label: t`Computers on`, className: "stroke-primary" },
          { key: "chatRuns", label: t`Chat replies`, className: "stroke-sky-500" },
          { key: "queuedRuns", label: t`Waiting to start`, className: "stroke-destructive" },
        ]}
      />
    </>
  );
}

function StorageView({ data }: { data: Infrastructure }) {
  const { t } = useLingui();
  const sample = data.latest?.sample;
  const disks: {
    title: string;
    series: InfraSeriesKey;
    used: number | null;
    total: number | null;
  }[] = [
    {
      title: t`App server`,
      series: "appDiskUsed",
      used: sample?.app.diskUsedBytes ?? null,
      total: sample?.app.diskTotalBytes ?? null,
    },
    {
      title: t`Computer host (Incus)`,
      series: "incusDiskUsed",
      used: sample?.incus.diskUsedBytes ?? null,
      total: sample?.incus.diskTotalBytes ?? null,
    },
    {
      title: t`Routine server`,
      series: "routinesDiskUsed",
      used: sample?.routines.diskUsedBytes ?? null,
      total: sample?.routines.diskTotalBytes ?? null,
    },
  ];
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-3">
        {disks.map((disk) => (
          <DiskCard key={disk.series} data={data} {...disk} />
        ))}
      </div>
      <Chart
        data={data}
        title={t`Disk used`}
        bytes
        lines={[
          { key: "appDiskUsed", label: t`App server`, className: "stroke-primary" },
          { key: "incusDiskUsed", label: t`Computer host (Incus)`, className: "stroke-sky-500" },
          { key: "routinesDiskUsed", label: t`Routine server`, className: "stroke-amber-500" },
        ]}
      />
    </>
  );
}

function RoutinesView({ data }: { data: Infrastructure }) {
  const { t } = useLingui();
  const sample = data.latest?.sample;
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2">
        <ServerCard title={t`Routine server`} server={sample?.routines} />
        <div className="rounded-xl border border-border px-3 py-2 text-[13px]">
          <div className="font-medium">
            <Trans>Routine server runner</Trans>
          </div>
          <dl className="mt-1 space-y-0.5 text-muted-foreground">
            <LaneRow label={t`Tools and overflow`} lane={sample?.runners.routines?.tools} />
            <LaneRow label={t`Large documents`} lane={sample?.runners.routines?.large} />
            <Row label={t`Routines running now`} value={String(sample?.fleet.routineRuns ?? "—")} />
          </dl>
        </div>
      </div>
      <Chart
        data={data}
        title={t`Routines running`}
        lines={[{ key: "routineRuns", label: t`Routines running`, className: "stroke-primary" }]}
      />
      <Chart
        data={data}
        title={t`Routine server load`}
        percent
        lines={[{ key: "routinesCpu", label: t`CPU busy`, className: "stroke-amber-500" }]}
      />
      <Chart
        data={data}
        title={t`Routine server tool commands`}
        lines={[
          { key: "routinesToolsRunning", label: t`Running`, className: "stroke-primary" },
          { key: "routinesToolsQueued", label: t`Waiting`, className: "stroke-destructive" },
        ]}
      />
    </>
  );
}

function UpDot({ up }: { up: boolean }) {
  const { t } = useLingui();
  return (
    <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
      <span className={`size-2 rounded-full ${up ? "bg-emerald-500" : "bg-destructive"}`} />
      {up ? t`Answering` : t`Not answering`}
    </span>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className={`tabular-nums ${warn ? "text-destructive" : "text-foreground"}`}>{value}</dd>
    </div>
  );
}

function LaneRow({ label, lane }: { label: string; lane: InfraLane | undefined }) {
  const { t } = useLingui();
  if (!lane) return <Row label={label} value="—" />;
  const running = `${lane.running} / ${lane.slots}`;
  const waiting = lane.queued;
  return (
    <Row
      label={label}
      value={waiting ? t`${running} running, ${waiting} waiting` : t`${running} running`}
      warn={waiting > 0}
    />
  );
}

function ServerCard({ title, server }: { title: string; server: InfraServer | undefined }) {
  const { t } = useLingui();
  const cpu = server?.cpuPercent;
  const memory = share(server?.memUsedBytes ?? null, server?.memTotalBytes ?? null);
  return (
    <div className="rounded-xl border border-border px-3 py-2 text-[13px]">
      <div className="flex items-center justify-between">
        <span className="font-medium">{title}</span>
        <UpDot up={server?.up ?? false} />
      </div>
      <dl className="mt-1 space-y-0.5 text-muted-foreground">
        <Row
          label={t`CPU busy`}
          value={cpu === null || cpu === undefined ? "—" : `${Math.round(cpu)}%`}
          warn={(cpu ?? 0) > 85}
        />
        <Row
          label={t`Load (1 min)`}
          value={
            server?.load1 === null || server?.load1 === undefined
              ? "—"
              : `${server.load1.toFixed(1)} / ${server.cpus ?? "?"}`
          }
        />
        <Row
          label={t`Memory`}
          value={`${size(server?.memUsedBytes)} / ${size(server?.memTotalBytes)}`}
          warn={(memory ?? 0) > 0.85}
        />
      </dl>
    </div>
  );
}

function DiskCard({
  data,
  title,
  series,
  used,
  total,
}: {
  data: Infrastructure;
  title: string;
  series: InfraSeriesKey;
  used: number | null;
  total: number | null;
}) {
  const { t } = useLingui();
  const values = data.points
    .map((point) => ({ at: Date.parse(point.at), value: point.values[series] }))
    .filter((point): point is { at: number; value: number } => point.value !== null);
  const first = values[0];
  const last = values.at(-1);
  const grown = first && last && last !== first ? last.value - first.value : null;
  const perDay =
    first && last && grown !== null && last.at > first.at
      ? (grown / (last.at - first.at)) * 86_400_000
      : null;
  const daysLeft =
    perDay && perDay > 0 && used !== null && total !== null
      ? Math.floor((total - used) / perDay)
      : null;
  const fraction = share(used, total);
  const change = grown === null ? "" : `${grown >= 0 ? "+" : "−"}${size(Math.abs(grown))}`;
  return (
    <div className="rounded-xl border border-border px-3 py-2 text-[13px]">
      <div className="font-medium">{title}</div>
      <dl className="mt-1 space-y-0.5 text-muted-foreground">
        <Row
          label={t`Used`}
          value={`${size(used)} / ${size(total)}`}
          warn={(fraction ?? 0) > 0.8}
        />
        <Row label={t`Change in period`} value={change || "—"} />
        <Row
          label={t`Full in`}
          value={daysLeft === null ? "—" : t`about ${daysLeft} days`}
          warn={daysLeft !== null && daysLeft < 30}
        />
      </dl>
      {fraction !== null ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={fraction > 0.8 ? "h-full bg-destructive" : "h-full bg-primary"}
            style={{ width: `${Math.min(100, fraction * 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

const WIDTH = 600;
const HEIGHT = 96;

function Chart({
  data,
  title,
  lines,
  percent,
  bytes,
}: {
  data: Infrastructure;
  title: string;
  lines: Line[];
  percent?: boolean;
  bytes?: boolean;
}) {
  const { i18n } = useLingui();
  const date = new Intl.DateTimeFormat(i18n.locale, {
    dateStyle: data.period === "24h" ? undefined : "short",
    timeStyle: "short",
  });
  const format = (value: number) =>
    percent ? `${Math.round(value)}%` : bytes ? size(value) : String(Math.round(value));
  const times = data.points.map((point) => Date.parse(point.at));
  const start = times[0] ?? 0;
  const span = Math.max(1, (times.at(-1) ?? 0) - start);
  const peaks = lines.map((line) =>
    Math.max(0, ...data.points.map((point) => point.values[line.key] ?? 0)),
  );
  const top = percent ? 100 : Math.max(1, ...peaks) * (bytes ? 1.05 : 1.15);
  return (
    <figure className="rounded-xl border border-border px-4 py-3">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted-foreground">
        <span className="text-foreground">{title}</span>
        <span className="flex flex-wrap gap-3">
          {lines.map((line, index) => (
            <span key={line.key} className="flex items-center gap-1">
              <svg className="size-2.5" viewBox="0 0 10 10" aria-hidden>
                <line x1="0" y1="5" x2="10" y2="5" strokeWidth="3" className={line.className} />
              </svg>
              {line.label}
              <span className="tabular-nums text-foreground">{format(peaks[index] ?? 0)}</span>
            </span>
          ))}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="mt-2 h-24 w-full"
        role="img"
        aria-label={title}
      >
        {lines.map((line) => {
          const segments: string[] = [];
          let current = "";
          data.points.forEach((point, index) => {
            const value = point.values[line.key];
            if (value === null) {
              if (current) segments.push(current);
              current = "";
              return;
            }
            const x = (((times[index] ?? start) - start) / span) * WIDTH;
            const y = HEIGHT - (Math.min(value, top) / top) * (HEIGHT - 4) - 2;
            current += `${current ? " L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
          });
          if (current) segments.push(current);
          return (
            <path
              key={line.key}
              d={segments.join(" ")}
              fill="none"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              className={line.className}
            />
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[11.5px] text-muted-foreground">
        <span>{times.length ? date.format(new Date(start)) : ""}</span>
        <span>{times.length ? date.format(new Date(times.at(-1) ?? start)) : ""}</span>
      </div>
    </figure>
  );
}
