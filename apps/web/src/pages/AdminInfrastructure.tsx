import { Trans, useLingui } from "@lingui/react/macro";
import type {
  InfraIncusMember,
  InfraLane,
  InfraPeriod,
  InfraSeriesKey,
  InfraServer,
  InfraToolRunnerNode,
  Infrastructure,
} from "@rakazo/contracts";
import { Button, NativeSelect, NativeSelectOption, Spinner } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Cpu,
  HardDrive,
  MapPin,
  Monitor,
  RefreshCw,
  Server,
  Wrench,
} from "lucide-react";
import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useSpaceQueries } from "../lib/query";
import { errorText } from "../lib/user-error";

type Focus = "computers" | "storage" | "routines";

type Line = {
  key: InfraSeriesKey;
  label: string;
  strokeClass: string;
  dotClass: string;
  fillColor: string;
};

function size(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function share(used: number | null | undefined, total: number | null | undefined) {
  return used !== null && used !== undefined && total ? used / total : null;
}

function meterTone(fraction: number | null) {
  if (fraction === null) return "bg-primary";
  if (fraction >= 0.85) return "bg-destructive";
  if (fraction >= 0.7) return "bg-amber-500";
  return "bg-primary";
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/** Live and historical load of the servers behind one admin section, from the worker's readings. */
export function InfrastructurePanel({ focus }: { focus: Focus }) {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const [period, setPeriod] = useState<InfraPeriod>("24h");
  const infra = useQuery({
    ...queries.companyAdmin.infrastructure.queryOptions({ input: { period } }),
    refetchInterval: 30_000,
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
    <div className="space-y-4" data-testid={`infrastructure-${focus}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="px-1 text-sm font-medium">
            <Trans>Servers</Trans>
          </h3>
          <p className="px-1 text-[12.5px] text-muted-foreground">
            {latest ? (
              <Trans>
                Read every minute. Last reading {sampledAt}. Hover any chart to inspect exact
                values.
              </Trans>
            ) : (
              <Trans>
                No readings yet. The first arrives within a minute of the worker starting.
              </Trans>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void infra.refetch()}
            disabled={infra.isFetching}
            className="gap-1.5"
          >
            <RefreshCw className={`size-3.5 ${infra.isFetching ? "animate-spin" : ""}`} />
            <Trans>Refresh</Trans>
          </Button>
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
  const appLanes = sample?.runners.app;
  const routineLanes = sample?.runners.routines;
  const toolNodes = sample?.toolNodes ?? [];
  const incusNodes = sample?.incus.nodes ?? [];

  // Count distinct fleet nodes (avoid double-counting a shared Incus + tool runner host by name).
  const fleetStats = useMemo(() => {
    if (!sample) return null;
    const seen = new Map<
      string,
      { up: boolean; cpus: number; memUsed: number; memTotal: number; dc?: string }
    >();
    const addNode = (
      key: string,
      node: {
        up: boolean;
        cpus: number | null;
        memUsedBytes: number | null;
        memTotalBytes: number | null;
        datacenter?: string;
      },
    ) => {
      const norm = key.toLowerCase();
      if (seen.has(norm)) return;
      seen.set(norm, {
        up: node.up,
        cpus: node.cpus ?? 0,
        memUsed: node.memUsedBytes ?? 0,
        memTotal: node.memTotalBytes ?? 0,
        dc: node.datacenter,
      });
    };
    addNode(sample.app.name || "app", sample.app);
    if (toolNodes.length > 0) {
      for (const node of toolNodes) addNode(node.name || node.id, node);
    } else if (sample.tools) {
      addNode(sample.tools.name || "tools", sample.tools);
    }
    if (incusNodes.length > 0) {
      for (const node of incusNodes) addNode(node.name, node);
    } else if (sample.incus.up) {
      addNode("incus", {
        up: sample.incus.up,
        cpus: sample.incus.cpus,
        memUsedBytes: sample.incus.memUsedBytes,
        memTotalBytes: sample.incus.memTotalBytes,
      });
    }
    addNode(sample.routines.name || "routines", sample.routines);

    let online = 0;
    let cpus = 0;
    let memUsed = 0;
    let memTotal = 0;
    const dcs: Array<string | undefined> = [];
    for (const entry of seen.values()) {
      if (entry.up) online += 1;
      cpus += entry.cpus;
      memUsed += entry.memUsed;
      memTotal += entry.memTotal;
      dcs.push(entry.dc);
    }
    return {
      online,
      total: seen.size,
      cpus,
      memUsed,
      memTotal,
      datacenters: uniqueStrings(dcs),
    };
  }, [sample, toolNodes, incusNodes]);

  const toolRegions = uniqueStrings(
    toolNodes.length > 0
      ? toolNodes.map((node) => node.datacenter)
      : [sample?.tools?.datacenter],
  );
  const incusRegions = uniqueStrings(incusNodes.map((node) => node.datacenter));
  const toolOnlineCount = toolNodes.filter((node) => node.up).length;
  const incusOnlineCount =
    incusNodes.length > 0
      ? incusNodes.filter((node) => node.up).length
      : (sample?.incus.members ?? (sample?.incus.up ? 1 : 0));
  const incusTotalCount = incusNodes.length > 0 ? incusNodes.length : incusOnlineCount;

  const hasToolsSeries = data.points.some((point) => point.values.toolsCpu !== null);

  return (
    <div className="space-y-4">
      {fleetStats ? (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryTile
            icon={<Server className="size-4 text-primary" />}
            label={t`Fleet servers`}
            value={t`${fleetStats.online} / ${fleetStats.total} online`}
            sub={
              fleetStats.datacenters.length > 0
                ? fleetStats.datacenters.join(" · ")
                : t`${fleetStats.cpus} vCPUs total`
            }
            warn={fleetStats.online < fleetStats.total}
          />
          <SummaryTile
            icon={<Wrench className="size-4 text-primary" />}
            label={t`Document runners`}
            value={
              appLanes
                ? t`${appLanes.tools.running} / ${appLanes.tools.slots} active`
                : "—"
            }
            sub={
              appLanes
                ? t`${appLanes.large.slots} large · ${appLanes.video.slots} video · ${appLanes.tools.queued} waiting`
                : t`No runner data`
            }
            warn={(appLanes?.tools.queued ?? 0) > 0}
          />
          <SummaryTile
            icon={<Monitor className="size-4 text-sky-500" />}
            label={t`Cloud computers`}
            value={t`${sample?.incus.running ?? 0} on`}
            sub={t`${sample?.incus.stopped ?? 0} off · ${incusOnlineCount} Incus host(s)`}
          />
          <SummaryTile
            icon={<Cpu className="size-4 text-amber-500" />}
            label={t`Fleet compute`}
            value={t`${fleetStats.cpus} vCPUs`}
            sub={t`${size(fleetStats.memUsed)} / ${size(fleetStats.memTotal)} RAM · ${sample?.fleet.chatRuns ?? 0} replies`}
            warn={(share(fleetStats.memUsed, fleetStats.memTotal) ?? 0) > 0.85}
          />
        </div>
      ) : null}

      <div className="@container">
        <div className="grid gap-3 @3xl:grid-cols-2 @5xl:grid-cols-4">
          <ServerCard
            title={t`App server`}
            role={t`Site and database`}
            computeName={sample?.app.name}
            datacenter={sample?.app.datacenter}
            server={sample?.app}
          />
          {sample?.tools ? (
            <ServerCard
              title={t`Tool runners`}
              role={
                toolNodes.length > 1
                  ? t`${toolOnlineCount} of ${toolNodes.length} servers · Docs, PDFs & video`
                  : t`Documents, spreadsheets, PDFs and video`
              }
              computeName={toolNodes.length === 1 ? toolNodes[0]?.name : undefined}
              datacenter={toolRegions.join(" · ") || undefined}
              server={sample.tools}
            >
              <LaneRow label={t`Documents`} lane={appLanes?.tools} />
              <LaneRow label={t`Large documents`} lane={appLanes?.large} />
              <LaneRow label={t`Video`} lane={appLanes?.video} />
            </ServerCard>
          ) : null}
          <div className="rounded-xl border border-border bg-card/40 px-3.5 py-3 text-[13px]">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium leading-tight">
                  <Trans>Computer hosts (Incus)</Trans>
                </div>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  <Trans>People&apos;s computers</Trans>
                </p>
              </div>
              <UpDot up={sample?.incus.up ?? false} />
            </div>
            {incusRegions.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <LocationBadge text={incusRegions.join(" · ")} />
              </div>
            ) : null}
            <dl className="mt-2.5 space-y-1.5 text-muted-foreground">
              <Row
                label={t`Servers`}
                value={
                  incusTotalCount > 0 ? `${incusOnlineCount} / ${incusTotalCount}` : "—"
                }
                warn={incusTotalCount > 0 && incusOnlineCount < incusTotalCount}
              />
              <Row
                label={t`vCPUs`}
                value={sample?.incus.cpus !== null && sample?.incus.cpus !== undefined ? String(sample.incus.cpus) : "—"}
              />
              <Row label={t`Computers on`} value={String(sample?.incus.running ?? "—")} />
              <Row label={t`Computers off`} value={String(sample?.incus.stopped ?? "—")} />
              <MeterRow
                label={t`Memory`}
                value={`${size(sample?.incus.memUsedBytes)} / ${size(sample?.incus.memTotalBytes)}`}
                fraction={share(sample?.incus.memUsedBytes, sample?.incus.memTotalBytes)}
                warn={(share(sample?.incus.memUsedBytes, sample?.incus.memTotalBytes) ?? 0) > 0.85}
              />
              <MeterRow
                label={t`Disk`}
                value={`${size(sample?.incus.diskUsedBytes)} / ${size(sample?.incus.diskTotalBytes)}`}
                fraction={share(sample?.incus.diskUsedBytes, sample?.incus.diskTotalBytes)}
                warn={(share(sample?.incus.diskUsedBytes, sample?.incus.diskTotalBytes) ?? 0) > 0.8}
              />
            </dl>
          </div>
          <ServerCard
            title={t`Routine server`}
            role={t`Routines and overflow runners`}
            computeName={sample?.routines.name}
            datacenter={sample?.routines.datacenter}
            server={sample?.routines}
          >
            <LaneRow label={t`Overflow`} lane={routineLanes?.tools} />
            <LaneRow label={t`Large overflow`} lane={routineLanes?.large} />
          </ServerCard>
        </div>
      </div>

      {toolNodes.length > 0 ? (
        <section className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div>
              <h4 className="text-[13px] font-medium">
                <Trans>Tool runner compute nodes</Trans>
              </h4>
              <p className="text-[12px] text-muted-foreground">
                <Trans>
                  Word, PowerPoint, Excel, PDF, and video commands spread across the least-busy
                  dedicated runner before using routine overflow.
                </Trans>
              </p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11.5px] font-medium text-muted-foreground tabular-nums">
              {t`${toolOnlineCount} / ${toolNodes.length} active`}
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {toolNodes.map((node) => (
              <ToolNodeCard key={node.id} node={node} />
            ))}
          </div>
        </section>
      ) : null}

      {incusNodes.length > 0 ? (
        <section className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div>
              <h4 className="text-[13px] font-medium">
                <Trans>Incus computer cluster nodes</Trans>
              </h4>
              <p className="text-[12px] text-muted-foreground">
                <Trans>
                  Individual KVM servers hosting staff cloud computers across the OVN cluster.
                </Trans>
              </p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11.5px] font-medium text-muted-foreground tabular-nums">
              {t`${incusOnlineCount} / ${incusNodes.length} online`}
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {incusNodes.map((node) => (
              <IncusNodeCard key={node.name} node={node} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="space-y-3 pt-1">
        <InteractiveChart
          data={data}
          title={t`CPU busy`}
          subtitle={t`Peak CPU utilisation across server pools`}
          percent
          lines={[
            {
              key: "appCpu",
              label: sample?.app.name ? t`App (${sample.app.name})` : t`App server`,
              strokeClass: "stroke-primary",
              dotClass: "fill-primary",
              fillColor: "var(--primary)",
            },
            ...(hasToolsSeries || sample?.tools
              ? [
                  {
                    key: "toolsCpu" as const,
                    label: t`Tool runners`,
                    strokeClass: "stroke-sky-500",
                    dotClass: "fill-sky-500",
                    fillColor: "#0ea5e9",
                  },
                ]
              : []),
            {
              key: "routinesCpu",
              label: sample?.routines.name
                ? t`Routines (${sample.routines.name})`
                : t`Routine server`,
              strokeClass: "stroke-amber-500",
              dotClass: "fill-amber-500",
              fillColor: "#f59e0b",
            },
          ]}
        />

        <InteractiveChart
          data={data}
          title={t`Memory used`}
          subtitle={t`RAM consumption across each server pool`}
          bytes
          lines={[
            {
              key: "appMemUsed",
              label: t`App server`,
              strokeClass: "stroke-primary",
              dotClass: "fill-primary",
              fillColor: "var(--primary)",
            },
            ...(hasToolsSeries || sample?.tools
              ? [
                  {
                    key: "toolsMemUsed" as const,
                    label: t`Tool runners`,
                    strokeClass: "stroke-sky-500",
                    dotClass: "fill-sky-500",
                    fillColor: "#0ea5e9",
                  },
                ]
              : []),
            {
              key: "incusMemUsed",
              label: t`Incus cluster`,
              strokeClass: "stroke-violet-500",
              dotClass: "fill-violet-500",
              fillColor: "#8b5cf6",
            },
            {
              key: "routinesMemUsed",
              label: t`Routine server`,
              strokeClass: "stroke-amber-500",
              dotClass: "fill-amber-500",
              fillColor: "#f59e0b",
            },
          ]}
        />

        <InteractiveChart
          data={data}
          title={t`Tool commands`}
          subtitle={t`Concurrent documents, large files, video renders, and queue depth`}
          lines={[
            {
              key: "appToolsRunning",
              label: t`Documents running`,
              strokeClass: "stroke-primary",
              dotClass: "fill-primary",
              fillColor: "var(--primary)",
            },
            {
              key: "appLargeRunning",
              label: t`Large docs`,
              strokeClass: "stroke-sky-500",
              dotClass: "fill-sky-500",
              fillColor: "#0ea5e9",
            },
            {
              key: "appVideoRunning",
              label: t`Video renders`,
              strokeClass: "stroke-violet-500",
              dotClass: "fill-violet-500",
              fillColor: "#8b5cf6",
            },
            {
              key: "appToolsQueued",
              label: t`Waiting`,
              strokeClass: "stroke-destructive",
              dotClass: "fill-destructive",
              fillColor: "var(--destructive)",
            },
            {
              key: "routinesToolsRunning",
              label: t`Routine overflow`,
              strokeClass: "stroke-amber-500",
              dotClass: "fill-amber-500",
              fillColor: "#f59e0b",
            },
          ]}
        />

        <InteractiveChart
          data={data}
          title={t`Computers on and replies in progress`}
          subtitle={t`Active Incus containers, chat replies, routines, and queued runs`}
          lines={[
            {
              key: "incusRunning",
              label: t`Computers on`,
              strokeClass: "stroke-primary",
              dotClass: "fill-primary",
              fillColor: "var(--primary)",
            },
            {
              key: "chatRuns",
              label: t`Chat replies`,
              strokeClass: "stroke-sky-500",
              dotClass: "fill-sky-500",
              fillColor: "#0ea5e9",
            },
            {
              key: "routineRuns",
              label: t`Routines`,
              strokeClass: "stroke-amber-500",
              dotClass: "fill-amber-500",
              fillColor: "#f59e0b",
            },
            {
              key: "queuedRuns",
              label: t`Waiting to start`,
              strokeClass: "stroke-destructive",
              dotClass: "fill-destructive",
              fillColor: "var(--destructive)",
            },
          ]}
        />
      </div>
    </div>
  );
}

function StorageView({ data }: { data: Infrastructure }) {
  const { t } = useLingui();
  const sample = data.latest?.sample;
  const disks: {
    title: string;
    subtitle?: string;
    series: InfraSeriesKey;
    used: number | null;
    total: number | null;
  }[] = [
    {
      title: t`App server`,
      subtitle: [sample?.app.name, sample?.app.datacenter].filter(Boolean).join(" · ") || undefined,
      series: "appDiskUsed",
      used: sample?.app.diskUsedBytes ?? null,
      total: sample?.app.diskTotalBytes ?? null,
    },
    ...(sample?.tools
      ? [
          {
            title: t`Tool runners`,
            subtitle:
              sample.toolNodes && sample.toolNodes.length > 1
                ? t`${sample.toolNodes.length} servers`
                : [sample.tools.name, sample.tools.datacenter].filter(Boolean).join(" · ") ||
                  undefined,
            series: "toolsDiskUsed" as const,
            used: sample.tools.diskUsedBytes ?? null,
            total: sample.tools.diskTotalBytes ?? null,
          },
        ]
      : []),
    {
      title: t`Computer hosts (Incus)`,
      subtitle:
        sample?.incus.nodes && sample.incus.nodes.length > 0
          ? t`${sample.incus.nodes.length} servers`
          : undefined,
      series: "incusDiskUsed",
      used: sample?.incus.diskUsedBytes ?? null,
      total: sample?.incus.diskTotalBytes ?? null,
    },
    {
      title: t`Routine server`,
      subtitle:
        [sample?.routines.name, sample?.routines.datacenter].filter(Boolean).join(" · ") ||
        undefined,
      series: "routinesDiskUsed",
      used: sample?.routines.diskUsedBytes ?? null,
      total: sample?.routines.diskTotalBytes ?? null,
    },
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {disks.map((disk) => (
          <DiskCard key={disk.series} data={data} {...disk} />
        ))}
      </div>
      <InteractiveChart
        data={data}
        title={t`Disk used`}
        subtitle={t`Storage growth across server pools`}
        bytes
        lines={[
          {
            key: "appDiskUsed",
            label: t`App server`,
            strokeClass: "stroke-primary",
            dotClass: "fill-primary",
            fillColor: "var(--primary)",
          },
          ...(sample?.tools
            ? [
                {
                  key: "toolsDiskUsed" as const,
                  label: t`Tool runners`,
                  strokeClass: "stroke-violet-500",
                  dotClass: "fill-violet-500",
                  fillColor: "#8b5cf6",
                },
              ]
            : []),
          {
            key: "incusDiskUsed",
            label: t`Incus cluster`,
            strokeClass: "stroke-sky-500",
            dotClass: "fill-sky-500",
            fillColor: "#0ea5e9",
          },
          {
            key: "routinesDiskUsed",
            label: t`Routine server`,
            strokeClass: "stroke-amber-500",
            dotClass: "fill-amber-500",
            fillColor: "#f59e0b",
          },
        ]}
      />
    </div>
  );
}

function RoutinesView({ data }: { data: Infrastructure }) {
  const { t } = useLingui();
  const sample = data.latest?.sample;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <ServerCard
          title={t`Routine server`}
          role={t`Routines and overflow document runners`}
          computeName={sample?.routines.name}
          datacenter={sample?.routines.datacenter}
          server={sample?.routines}
        />
        <div className="rounded-xl border border-border bg-card/40 px-3.5 py-3 text-[13px]">
          <div className="flex items-center gap-1.5 font-medium">
            <Activity className="size-4 text-primary" />
            <Trans>Routine server runner</Trans>
          </div>
          <dl className="mt-2.5 space-y-1.5 text-muted-foreground">
            <LaneRow label={t`Tools and overflow`} lane={sample?.runners.routines?.tools} />
            <LaneRow label={t`Large documents`} lane={sample?.runners.routines?.large} />
            <Row label={t`Routines running now`} value={String(sample?.fleet.routineRuns ?? "—")} />
          </dl>
        </div>
      </div>
      <InteractiveChart
        data={data}
        title={t`Routines running`}
        lines={[
          {
            key: "routineRuns",
            label: t`Routines running`,
            strokeClass: "stroke-primary",
            dotClass: "fill-primary",
            fillColor: "var(--primary)",
          },
        ]}
      />
      <InteractiveChart
        data={data}
        title={t`Routine server load`}
        percent
        lines={[
          {
            key: "routinesCpu",
            label: t`CPU busy`,
            strokeClass: "stroke-amber-500",
            dotClass: "fill-amber-500",
            fillColor: "#f59e0b",
          },
        ]}
      />
      <InteractiveChart
        data={data}
        title={t`Routine server tool commands`}
        lines={[
          {
            key: "routinesToolsRunning",
            label: t`Running`,
            strokeClass: "stroke-primary",
            dotClass: "fill-primary",
            fillColor: "var(--primary)",
          },
          {
            key: "routinesToolsQueued",
            label: t`Waiting`,
            strokeClass: "stroke-destructive",
            dotClass: "fill-destructive",
            fillColor: "var(--destructive)",
          },
        ]}
      />
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  sub,
  warn,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/50 px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
        <span>{label}</span>
        {icon}
      </div>
      <div
        className={`mt-1 text-base font-semibold tracking-tight tabular-nums ${
          warn ? "text-destructive" : "text-foreground"
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function LocationBadge({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <MapPin className="size-3 shrink-0 text-primary" />
      <span className="truncate">{text}</span>
    </span>
  );
}

function NameBadge({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[11px] text-foreground">
      {text}
    </span>
  );
}

function UpDot({ up }: { up: boolean }) {
  const { t } = useLingui();
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground">
      <span
        className={`size-2 rounded-full ${
          up ? "bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.2)]" : "bg-destructive"
        }`}
      />
      {up ? t`Answering` : t`Not answering`}
    </span>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="truncate">{label}</dt>
      <dd className={`shrink-0 tabular-nums ${warn ? "font-medium text-destructive" : "text-foreground"}`}>
        {value}
      </dd>
    </div>
  );
}

function MeterRow({
  label,
  value,
  fraction,
  warn,
}: {
  label: string;
  value: string;
  fraction: number | null;
  warn?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Row label={label} value={value} warn={warn} />
      {fraction !== null ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${meterTone(fraction)}`}
            style={{ width: `${Math.min(100, Math.max(2, fraction * 100))}%` }}
          />
        </div>
      ) : null}
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

function ServerCard({
  title,
  role,
  computeName,
  datacenter,
  server,
  children,
}: {
  title: string;
  role: string;
  computeName?: string;
  datacenter?: string;
  server: InfraServer | undefined;
  children?: ReactNode;
}) {
  const { t } = useLingui();
  const cpu = server?.cpuPercent;
  const cpuFraction = cpu !== null && cpu !== undefined ? cpu / 100 : null;
  const memory = share(server?.memUsedBytes, server?.memTotalBytes);
  const disk = share(server?.diskUsedBytes, server?.diskTotalBytes);
  return (
    <div className="rounded-xl border border-border bg-card/40 px-3.5 py-3 text-[13px]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium leading-tight">{title}</div>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{role}</p>
        </div>
        <UpDot up={server?.up ?? false} />
      </div>
      {computeName || datacenter ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {computeName ? <NameBadge text={computeName} /> : null}
          {datacenter ? <LocationBadge text={datacenter} /> : null}
        </div>
      ) : null}
      <dl className="mt-2.5 space-y-1.5 text-muted-foreground">
        <MeterRow
          label={t`CPU busy`}
          value={cpu === null || cpu === undefined ? "—" : `${Math.round(cpu)}%`}
          fraction={cpuFraction}
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
        <MeterRow
          label={t`Memory`}
          value={`${size(server?.memUsedBytes)} / ${size(server?.memTotalBytes)}`}
          fraction={memory}
          warn={(memory ?? 0) > 0.85}
        />
        <MeterRow
          label={t`Disk`}
          value={`${size(server?.diskUsedBytes)} / ${size(server?.diskTotalBytes)}`}
          fraction={disk}
          warn={(disk ?? 0) > 0.8}
        />
        {children}
      </dl>
    </div>
  );
}

function ToolNodeCard({ node }: { node: InfraToolRunnerNode }) {
  const { t } = useLingui();
  const cpu = node.cpuPercent;
  const cpuFraction = cpu !== null ? cpu / 100 : null;
  const memory = share(node.memUsedBytes, node.memTotalBytes);
  const disk = share(node.diskUsedBytes, node.diskTotalBytes);
  return (
    <div className="rounded-xl border border-border bg-card/50 px-3.5 py-3 text-[13px]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[13px] font-semibold text-foreground">{node.name}</span>
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10.5px] font-medium text-primary">
              {node.primary ? t`Primary` : t`Pool`}
            </span>
          </div>
          {node.datacenter ? (
            <div className="mt-1">
              <LocationBadge text={node.datacenter} />
            </div>
          ) : null}
        </div>
        <UpDot up={node.up} />
      </div>
      <dl className="mt-3 space-y-1.5 text-muted-foreground">
        <MeterRow
          label={t`CPU busy`}
          value={cpu === null ? "—" : `${Math.round(cpu)}%`}
          fraction={cpuFraction}
          warn={(cpu ?? 0) > 85}
        />
        <Row
          label={t`Load (1 min)`}
          value={
            node.load1 === null ? "—" : `${node.load1.toFixed(1)} / ${node.cpus ?? "?"} vCPUs`
          }
        />
        <MeterRow
          label={t`Memory`}
          value={`${size(node.memUsedBytes)} / ${size(node.memTotalBytes)}`}
          fraction={memory}
          warn={(memory ?? 0) > 0.85}
        />
        <MeterRow
          label={t`Disk`}
          value={`${size(node.diskUsedBytes)} / ${size(node.diskTotalBytes)}`}
          fraction={disk}
          warn={(disk ?? 0) > 0.8}
        />
        <div className="my-1.5 border-t border-border/60 pt-1.5 space-y-1">
          <LaneRow label={t`Documents`} lane={node.lanes?.tools} />
          <LaneRow label={t`Large documents`} lane={node.lanes?.large} />
          <LaneRow label={t`Video`} lane={node.lanes?.video} />
        </div>
      </dl>
    </div>
  );
}

function IncusNodeCard({ node }: { node: InfraIncusMember }) {
  const { t } = useLingui();
  const memory = share(node.memUsedBytes, node.memTotalBytes);
  const disk = share(node.diskUsedBytes, node.diskTotalBytes);
  return (
    <div className="rounded-xl border border-border bg-card/50 px-3.5 py-3 text-[13px]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[13px] font-semibold text-foreground">{node.name}</span>
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10.5px] font-medium text-sky-600 dark:text-sky-400">
              Incus
            </span>
          </div>
          {node.datacenter ? (
            <div className="mt-1">
              <LocationBadge text={node.datacenter} />
            </div>
          ) : null}
        </div>
        <UpDot up={node.up} />
      </div>
      <dl className="mt-3 space-y-1.5 text-muted-foreground">
        <Row label={t`vCPUs`} value={node.cpus !== null ? String(node.cpus) : "—"} />
        <Row
          label={t`Computers`}
          value={
            node.running !== null
              ? t`${node.running} on · ${node.stopped ?? 0} off`
              : "—"
          }
        />
        <MeterRow
          label={t`Memory`}
          value={`${size(node.memUsedBytes)} / ${size(node.memTotalBytes)}`}
          fraction={memory}
          warn={(memory ?? 0) > 0.85}
        />
        <MeterRow
          label={t`Storage pool`}
          value={`${size(node.diskUsedBytes)} / ${size(node.diskTotalBytes)}`}
          fraction={disk}
          warn={(disk ?? 0) > 0.8}
        />
      </dl>
    </div>
  );
}

function DiskCard({
  data,
  title,
  subtitle,
  series,
  used,
  total,
}: {
  data: Infrastructure;
  title: string;
  subtitle?: string;
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
    <div className="rounded-xl border border-border bg-card/40 px-3.5 py-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{title}</div>
        <HardDrive className="size-3.5 text-muted-foreground" />
      </div>
      {subtitle ? <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{subtitle}</p> : null}
      <dl className="mt-2 space-y-1 text-muted-foreground">
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
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${meterTone(fraction)}`}
            style={{ width: `${Math.min(100, Math.max(2, fraction * 100))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

const CHART_WIDTH = 640;
const CHART_HEIGHT = 136;
const PAD_TOP = 10;
const PAD_BOTTOM = 10;
const PLOT_HEIGHT = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

function InteractiveChart({
  data,
  title,
  subtitle,
  lines,
  percent,
  bytes,
}: {
  data: Infrastructure;
  title: string;
  subtitle?: string;
  lines: Line[];
  percent?: boolean;
  bytes?: boolean;
}) {
  const { t, i18n } = useLingui();
  const chartId = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});

  const date = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.locale, {
        dateStyle: data.period === "24h" ? undefined : "short",
        timeStyle: "short",
      }),
    [i18n.locale, data.period],
  );
  const fullDate = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [i18n.locale],
  );

  const format = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "—";
    if (percent) return `${value >= 10 || value === 0 ? Math.round(value) : value.toFixed(1)}%`;
    if (bytes) return size(value);
    return String(Math.round(value));
  };

  const times = useMemo(() => data.points.map((point) => Date.parse(point.at)), [data.points]);
  const start = times[0] ?? 0;
  const end = times.at(-1) ?? start;
  const span = Math.max(1, end - start);

  const activeLines = lines.filter((line) => !hidden[line.key]);

  const peaks = useMemo(
    () =>
      lines.map((line) => {
        let max: number | null = null;
        for (const point of data.points) {
          const v = point.values[line.key];
          if (v !== null && v !== undefined && (max === null || v > max)) max = v;
        }
        return max;
      }),
    [data.points, lines],
  );

  const latestValues = useMemo(
    () =>
      lines.map((line) => {
        for (let i = data.points.length - 1; i >= 0; i -= 1) {
          const v = data.points[i]?.values[line.key];
          if (v !== null && v !== undefined) return v;
        }
        return null;
      }),
    [data.points, lines],
  );

  const visiblePeak = useMemo(() => {
    let max = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (hidden[lines[i]!.key]) continue;
      max = Math.max(max, peaks[i] ?? 0);
    }
    return max;
  }, [lines, peaks, hidden]);

  const top = percent ? 100 : Math.max(1, visiblePeak) * (bytes ? 1.08 : 1.2);

  const xOf = (index: number) =>
    times.length <= 1 ? CHART_WIDTH / 2 : (((times[index] ?? start) - start) / span) * CHART_WIDTH;
  const yOf = (value: number) =>
    PAD_TOP + PLOT_HEIGHT - (Math.min(Math.max(0, value), top) / top) * PLOT_HEIGHT;

  const updateHoverFromClientX = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg || times.length === 0) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const targetTime = start + ratio * span;
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < times.length; i += 1) {
      const dist = Math.abs((times[i] ?? start) - targetTime);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    setHoverIndex(best);
  };

  const handlePointer = (event: PointerEvent<SVGSVGElement>) => {
    updateHoverFromClientX(event.clientX);
  };

  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (times.length === 0) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setHoverIndex((prev) => (prev === null ? 0 : Math.min(times.length - 1, prev + 1)));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setHoverIndex((prev) =>
        prev === null ? times.length - 1 : Math.max(0, prev - 1),
      );
    } else if (event.key === "Escape") {
      setHoverIndex(null);
    }
  };

  const toggleLine = (key: InfraSeriesKey) => {
    setHidden((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // Keep at least one line visible.
      if (lines.every((line) => next[line.key])) return prev;
      return next;
    });
  };

  const hoveredPoint = hoverIndex !== null ? data.points[hoverIndex] : null;
  const hoverX = hoverIndex !== null ? xOf(hoverIndex) : null;
  const hoverFraction = hoverX !== null ? hoverX / CHART_WIDTH : 0;
  const gridTicks = [0, 0.5, 1];

  return (
    <figure className="rounded-xl border border-border bg-card/40 px-4 py-3.5">
      <figcaption className="flex flex-wrap items-start justify-between gap-2 text-[12.5px]">
        <div>
          <div className="font-medium text-foreground">{title}</div>
          {subtitle ? <div className="text-[11.5px] text-muted-foreground">{subtitle}</div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {lines.map((line, index) => {
            const isHidden = Boolean(hidden[line.key]);
            const displayValue = hoveredPoint
              ? hoveredPoint.values[line.key]
              : latestValues[index];
            const peakValue = peaks[index];
            return (
              <button
                key={line.key}
                type="button"
                aria-pressed={!isHidden}
                onClick={() => toggleLine(line.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] transition-opacity ${
                  isHidden
                    ? "border-border/50 bg-transparent text-muted-foreground opacity-45"
                    : "border-border bg-background/80 text-muted-foreground hover:border-foreground/25"
                }`}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: line.fillColor }}
                />
                <span>{line.label}</span>
                <span className="font-medium tabular-nums text-foreground">
                  {format(displayValue)}
                </span>
                {!hoveredPoint && peakValue !== null && peakValue !== displayValue ? (
                  <span className="text-[10.5px] tabular-nums text-muted-foreground/80">
                    ({t`max`} {format(peakValue)})
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </figcaption>

      <div className="relative mt-3 select-none">
        {data.points.length === 0 ? (
          <div className="grid h-32 place-items-center rounded-lg border border-dashed border-border/70 text-[12px] text-muted-foreground">
            <Trans>Waiting for samples in this period…</Trans>
          </div>
        ) : (
          <div className="relative flex gap-2">
            <div className="flex w-12 shrink-0 flex-col justify-between py-1 text-right text-[10.5px] tabular-nums text-muted-foreground/80">
              <span>{format(top)}</span>
              <span>{format(top * 0.5)}</span>
              <span>{format(0)}</span>
            </div>
            <div className="relative min-w-0 flex-1">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                preserveAspectRatio="none"
                tabIndex={0}
                onPointerMove={handlePointer}
                onPointerDown={handlePointer}
                onPointerLeave={() => setHoverIndex(null)}
                onBlur={() => setHoverIndex(null)}
                onKeyDown={handleKeyDown}
                className="h-32 w-full cursor-crosshair overflow-visible outline-none focus-visible:ring-1 focus-visible:ring-primary/50 rounded"
                role="img"
                aria-label={title}
              >
                <defs>
                  {lines.map((line) => (
                    <linearGradient
                      key={line.key}
                      id={`grad-${chartId}-${line.key}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor={line.fillColor} stopOpacity="0.18" />
                      <stop offset="100%" stopColor={line.fillColor} stopOpacity="0.0" />
                    </linearGradient>
                  ))}
                </defs>

                {gridTicks.map((ratio) => {
                  const y = PAD_TOP + PLOT_HEIGHT * (1 - ratio);
                  return (
                    <line
                      key={ratio}
                      x1="0"
                      y1={y}
                      x2={CHART_WIDTH}
                      y2={y}
                      stroke="currentColor"
                      strokeOpacity="0.1"
                      strokeDasharray={ratio === 0 ? undefined : "3 3"}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}

                {activeLines.map((line) => {
                  const lineSegments: string[] = [];
                  const areaSegments: string[] = [];
                  let currentLine = "";
                  let firstX: number | null = null;
                  let lastX: number | null = null;
                  const baseY = PAD_TOP + PLOT_HEIGHT;

                  const flush = () => {
                    if (currentLine && firstX !== null && lastX !== null) {
                      lineSegments.push(currentLine);
                      areaSegments.push(
                        `${currentLine} L${lastX.toFixed(1)},${baseY} L${firstX.toFixed(1)},${baseY} Z`,
                      );
                    }
                    currentLine = "";
                    firstX = null;
                    lastX = null;
                  };

                  data.points.forEach((point, index) => {
                    const value = point.values[line.key];
                    if (value === null || value === undefined) {
                      flush();
                      return;
                    }
                    const x = xOf(index);
                    const y = yOf(value);
                    if (firstX === null) firstX = x;
                    lastX = x;
                    currentLine += `${currentLine ? " L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
                  });
                  flush();

                  return (
                    <g key={line.key}>
                      {areaSegments.map((d, idx) => (
                        <path
                          key={`area-${idx}`}
                          d={d}
                          fill={`url(#grad-${chartId}-${line.key})`}
                        />
                      ))}
                      <path
                        d={lineSegments.join(" ")}
                        fill="none"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                        className={line.strokeClass}
                      />
                    </g>
                  );
                })}

                {hoverX !== null ? (
                  <line
                    x1={hoverX}
                    y1={PAD_TOP}
                    x2={hoverX}
                    y2={PAD_TOP + PLOT_HEIGHT}
                    stroke="currentColor"
                    strokeOpacity="0.35"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
              </svg>

              {/* Crisp circular hover markers (outside preserveAspectRatio="none" so dots stay round) */}
              {hoveredPoint && hoverIndex !== null ? (
                <div className="pointer-events-none absolute inset-0">
                  {activeLines.map((line) => {
                    const value = hoveredPoint.values[line.key];
                    if (value === null || value === undefined) return null;
                    const leftPct = hoverFraction * 100;
                    const topPct = (yOf(value) / CHART_HEIGHT) * 100;
                    return (
                      <span
                        key={line.key}
                        className="absolute -translate-x-1/2 -translate-y-1/2 size-2.5 rounded-full ring-2 ring-background"
                        style={{
                          left: `${leftPct}%`,
                          top: `${topPct}%`,
                          backgroundColor: line.fillColor,
                        }}
                      />
                    );
                  })}

                  <div
                    className="absolute top-1 z-20 min-w-[175px] rounded-lg border border-border bg-popover/95 px-2.5 py-2 text-[11.5px] text-popover-foreground shadow-md backdrop-blur-xs"
                    style={
                      hoverFraction > 0.62
                        ? { right: `${Math.max(2, (1 - hoverFraction) * 100 + 2)}%` }
                        : { left: `${Math.min(72, hoverFraction * 100 + 2)}%` }
                    }
                  >
                    <div className="mb-1 border-b border-border/60 pb-1 font-medium text-foreground">
                      {fullDate.format(new Date(hoveredPoint.at))}
                    </div>
                    <div className="space-y-0.5">
                      {activeLines.map((line) => (
                        <div key={line.key} className="flex items-center justify-between gap-3">
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: line.fillColor }}
                            />
                            <span className="truncate">{line.label}</span>
                          </span>
                          <span className="font-medium tabular-nums text-foreground">
                            {format(hoveredPoint.values[line.key])}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <div className="mt-1.5 flex justify-between pl-14 text-[11px] text-muted-foreground">
        <span>{times.length ? date.format(new Date(start)) : ""}</span>
        <span>
          {times.length > 2
            ? date.format(new Date(start + span / 2))
            : ""}
        </span>
        <span>{times.length ? date.format(new Date(end)) : ""}</span>
      </div>
    </figure>
  );
}
