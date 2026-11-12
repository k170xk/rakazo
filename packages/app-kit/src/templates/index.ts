import type { TableSchema } from "../schema.js";

/**
 * Starter apps for the App Studio and the agent: a polished App.tsx and its tables, empty so the
 * first rows are the person's real records. Contribute starters let colleagues add their own rows.
 */
export type AppTemplate = {
  id: string;
  title: string;
  description: string;
  /** Who may change rows when it is made; contribute suits forms people fill in. */
  access: "owner" | "contribute";
  files: Record<string, string>;
  tables: TableSchema[];
};

const projectTracker = String.raw`import { useMemo } from "react";
import { AppShell, AreaChart, Badge, Card, CardBody, CardHeader, DonutChart, EmptyState, Grid, KpiCard, Kanban, PageHeader, Progress, TableView, Timeline, byMonth, countBy, formatNumber, sumBy, toast } from "@ocsc/ui";
import { useTable } from "@ocsc/app";
import { Briefcase, CalendarClock, Euro, Gauge as GaugeIcon, Plus } from "lucide-react";

const STAGES = ["Pipeline", "Design", "Tender", "Construction", "Complete", "On hold"];
const DAY = 86400000;

export default function App() {
  const projects = useTable("projects");
  const live = projects.rows.filter((row) => row.stage !== "Complete");
  const dueSoon = live.filter((row) => {
    const due = Date.parse(String(row.due ?? ""));
    return !Number.isNaN(due) && due - Date.now() < 30 * DAY;
  });
  const progress = live.length ? live.reduce((total, row) => total + Number(row.progress ?? 0), 0) / live.length : 0;
  const monthly = useMemo(() => byMonth(projects.rows, "start", ["fee"]), [projects.rows]);
  const empty = !projects.loading && projects.rows.length === 0;

  const overview = () => (
    <>
      <PageHeader eyebrow="Portfolio" title="Projects at a glance" description="Fees, stages and deadlines across every live job." />
      {empty ? (
        <EmptyState icon={<Briefcase />} title="No projects yet" description="Add your first project, or ask OCSC Intelligence to load them from a spreadsheet." />
      ) : (
        <div className="flex flex-col gap-4">
          <Grid cols={4}>
            <KpiCard label="Live projects" value={live.length} icon={<Briefcase />} />
            <KpiCard label="Fees" value={sumBy(live, "fee")} format="currency" icon={<Euro />} />
            <KpiCard label="Due in 30 days" value={dueSoon.length} tone={dueSoon.length ? "warning" : "success"} icon={<CalendarClock />} />
            <KpiCard label="Average progress" value={progress * 100} format="percent" icon={<GaugeIcon />} />
          </Grid>
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <Card>
              <CardHeader title="Fees by start month" />
              <CardBody>
                <AreaChart data={monthly} x="month" series={[{ key: "fee", label: "Fee" }]} format="currency" />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="By stage" />
              <CardBody>
                <DonutChart data={countBy(projects.rows, "stage")} centerLabel="Projects" />
              </CardBody>
            </Card>
          </div>
          <Card>
            <CardHeader title="Due soonest" />
            <CardBody className="flex flex-col gap-3">
              {[...live]
                .sort((a, b) => String(a.due ?? "9").localeCompare(String(b.due ?? "9")))
                .slice(0, 6)
                .map((row) => (
                  <div key={row._id} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{String(row.name ?? "Untitled")}</p>
                      <p className="text-xs text-muted-foreground">{String(row.client ?? "")}</p>
                    </div>
                    <Progress value={Number(row.progress ?? 0) * 100} className="w-28" />
                    <Badge tone="neutral">{row.due ? new Date(String(row.due)).toLocaleDateString("en-IE", { day: "numeric", month: "short" }) : "No date"}</Badge>
                  </div>
                ))}
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );

  return (
    <AppShell
      title="Project tracker"
      subtitle="Every live job in one place"
      pages={[
        { id: "overview", label: "Overview", render: overview },
        {
          id: "board",
          label: "Board",
          render: () => (
            <Kanban
              rows={projects.rows}
              groupBy="stage"
              columns={STAGES.map((value) => ({ value }))}
              onMove={projects.canEdit ? (row, stage) => void projects.update(row._id, { stage }).catch(() => toast.error("Not moved")) : undefined}
              renderCard={(row) => (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-semibold">{String(row.name ?? "Untitled")}</p>
                  <p className="text-xs text-muted-foreground">{String(row.client ?? "")}</p>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold tabular">{row.fee ? formatNumber(Number(row.fee), "currency") : ""}</span>
                    <span className="text-muted-foreground">{String(row.lead ?? "")}</span>
                  </div>
                  <Progress value={Number(row.progress ?? 0) * 100} />
                </div>
              )}
            />
          ),
        },
        {
          id: "plan",
          label: "Plan",
          render: () => (
            <Card>
              <CardHeader title="Programme" description="Start to due date for each project" />
              <CardBody>
                <Timeline rows={projects.rows} startKey="start" endKey="due" titleKey="name" toneKey="stage" />
              </CardBody>
            </Card>
          ),
        },
        {
          id: "projects",
          label: "Projects",
          count: projects.rows.length,
          render: () => <TableView table={projects} filterBy="stage" columns={["name", "client", "stage", "lead", "fee", "due", "progress"]} newLabel="New project" />,
        },
      ]}
    />
  );
}
`;

const clientPipeline = String.raw`import { useState } from "react";
import { AppShell, BarChart, Card, CardBody, CardHeader, EmptyState, FunnelChart, Grid, KpiCard, Kanban, PageHeader, PeriodFilter, TableView, formatNumber, inPeriod, periodChange, sumBy, toast, type Period } from "@ocsc/ui";
import { useTable } from "@ocsc/app";
import { Handshake, Percent, Target, Trophy } from "lucide-react";

const STAGES = [
  { value: "Lead", tone: "neutral" as const },
  { value: "Qualified", tone: "info" as const },
  { value: "Proposal", tone: "accent" as const },
  { value: "Negotiation", tone: "warning" as const },
  { value: "Won", tone: "success" as const },
  { value: "Lost", tone: "danger" as const },
];
const OPEN = new Set(["Lead", "Qualified", "Proposal", "Negotiation"]);

export default function App() {
  const deals = useTable("deals");
  const [period, setPeriod] = useState<Period>("12m");
  const open = deals.rows.filter((row) => OPEN.has(String(row.stage)));
  const weighted = open.reduce((total, row) => total + Number(row.value ?? 0) * Number(row.probability ?? 0), 0);
  const closed = inPeriod(deals.rows, "close_date", period).filter((row) => row.stage === "Won" || row.stage === "Lost");
  const won = closed.filter((row) => row.stage === "Won");
  const wonValue = periodChange(deals.rows.filter((row) => row.stage === "Won"), "close_date", period, "value");
  const funnel = STAGES.slice(0, 5).map((stage, index) => ({
    label: stage.value,
    value: deals.rows.filter((row) => {
      const at = STAGES.findIndex((item) => item.value === row.stage);
      return at >= index && row.stage !== "Lost";
    }).length,
  }));
  const empty = !deals.loading && deals.rows.length === 0;

  return (
    <AppShell
      title="Client pipeline"
      subtitle="Opportunities from first contact to won"
      pages={[
        {
          id: "overview",
          label: "Overview",
          render: () => (
            <>
              <PageHeader eyebrow="Business development" title="Pipeline" description="What is open, what it is worth and how often we win." actions={<PeriodFilter value={period} onChange={setPeriod} />} />
              {empty ? (
                <EmptyState icon={<Handshake />} title="No opportunities yet" description="Add the first one on the Deals tab." />
              ) : (
                <div className="flex flex-col gap-4">
                  <Grid cols={4}>
                    <KpiCard label="Open pipeline" value={sumBy(open, "value")} format="currency" icon={<Handshake />} hint={open.length + " open"} />
                    <KpiCard label="Weighted" value={weighted} format="currency" icon={<Target />} hint="Value × probability" />
                    <KpiCard label="Won" value={wonValue.value} format="currency" delta={wonValue.delta} deltaLabel="vs previous" icon={<Trophy />} />
                    <KpiCard label="Win rate" value={closed.length ? (won.length / closed.length) * 100 : 0} format="percent" icon={<Percent />} hint={closed.length + " decided"} />
                  </Grid>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                      <CardHeader title="Conversion" description="Deals that reached each stage" />
                      <CardBody><FunnelChart data={funnel} /></CardBody>
                    </Card>
                    <Card>
                      <CardHeader title="Open value by owner" />
                      <CardBody><BarChart data={sumBy(open, "value", "owner")} x="label" series={[{ key: "value", label: "Value" }]} format="currency" horizontal /></CardBody>
                    </Card>
                  </div>
                </div>
              )}
            </>
          ),
        },
        {
          id: "board",
          label: "Board",
          render: () => (
            <Kanban
              rows={deals.rows}
              groupBy="stage"
              columns={STAGES}
              onMove={deals.canEdit ? (row, stage) => void deals.update(row._id, { stage }).catch(() => toast.error("Not moved")) : undefined}
              renderCard={(row) => (
                <div className="flex flex-col gap-1.5">
                  <p className="text-sm font-semibold">{String(row.name ?? "Untitled")}</p>
                  <p className="text-xs text-muted-foreground">{String(row.client ?? "")}</p>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold tabular">{formatNumber(Number(row.value ?? 0), "currency")}</span>
                    <span className="text-muted-foreground">{formatNumber(Number(row.probability ?? 0) * 100, "percent")}</span>
                  </div>
                </div>
              )}
            />
          ),
        },
        {
          id: "deals",
          label: "Deals",
          count: open.length,
          render: () => <TableView table={deals} filterBy="stage" columns={["name", "client", "stage", "value", "probability", "owner", "close_date"]} newLabel="New deal" />,
        },
      ]}
    />
  );
}
`;

const siteInspection = String.raw`import { useMemo, useState } from "react";
import { AppShell, Badge, CalendarHeatmap, Card, CardBody, CardHeader, Checklist, Dialog, EmptyState, Field, Gauge, Grid, Input, KpiCard, PageHeader, PeriodFilter, PhotoInput, Select, Steps, TableView, Textarea, checklistSummary, inPeriod, readJson, toast, type ChecklistItem, type ChecklistValue, type Period } from "@ocsc/ui";
import { useApp, useTable } from "@ocsc/app";
import { AlertTriangle, ClipboardCheck, ClipboardPlus, ShieldCheck } from "lucide-react";

const CHECKS: ChecklistItem[] = [
  { id: "ppe", label: "PPE worn by everyone on site", section: "Safety" },
  { id: "access", label: "Safe access and egress", section: "Safety" },
  { id: "edges", label: "Edge protection and openings covered", section: "Safety" },
  { id: "fire", label: "Fire points clear and signed", section: "Safety" },
  { id: "drawings", label: "Work matches current drawings", section: "Quality", hint: "Check the revision on site" },
  { id: "materials", label: "Materials stored and protected", section: "Quality" },
  { id: "records", label: "Pour, test and sign-off records complete", section: "Quality" },
  { id: "housekeeping", label: "Housekeeping and waste", section: "Site" },
];

function resultOf(checks: ChecklistValue): string {
  const summary = checklistSummary(CHECKS, checks);
  if (summary.failed >= 3) return "Major";
  if (summary.failed > 0) return "Minor";
  return "Pass";
}

export default function App() {
  const inspections = useTable("inspections");
  const { viewer } = useApp();
  const [period, setPeriod] = useState<Period>("90d");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ site: string; date: string; discipline: string; checks: ChecklistValue; photos: string | null; notes: string }>({ site: "", date: new Date().toISOString().slice(0, 10), discipline: "", checks: {}, photos: null, notes: "" });
  const rows = inPeriod(inspections.rows, "date", period);
  const passed = rows.filter((row) => row.result === "Pass").length;
  const major = rows.filter((row) => row.result === "Major").length;
  const mine = useMemo(() => inspections.rows.filter((row) => row._mine === true), [inspections.rows]);

  const submit = async () => {
    try {
      await inspections.insert({
        site: draft.site,
        date: draft.date,
        discipline: draft.discipline || null,
        inspector: viewer.name,
        result: resultOf(draft.checks),
        checks: JSON.stringify(draft.checks),
        photos: draft.photos,
        notes: draft.notes || null,
      });
      toast.success("Inspection saved");
      setOpen(false);
      setDraft({ site: "", date: new Date().toISOString().slice(0, 10), discipline: "", checks: {}, photos: null, notes: "" });
    } catch (error) {
      toast.error("Not saved", error instanceof Error ? error.message : undefined);
    }
  };

  const start = inspections.canEdit ? (
    <button type="button" onClick={() => setOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-card">
      <ClipboardPlus className="size-4" /> New inspection
    </button>
  ) : null;

  return (
    <>
      <AppShell
        title="Site inspections"
        subtitle="Safety and quality on every visit"
        actions={start}
        pages={[
          {
            id: "overview",
            label: "Overview",
            render: () => (
              <>
                <PageHeader eyebrow="Inspections" title="How sites are doing" actions={<PeriodFilter value={period} onChange={setPeriod} />} />
                {!inspections.loading && inspections.rows.length === 0 ? (
                  <EmptyState icon={<ClipboardCheck />} title="No inspections yet" description="Start the first one: pick the site, work through the checks and add photos." action={start} />
                ) : (
                  <div className="flex flex-col gap-4">
                    <Grid cols={3}>
                      <KpiCard label="Inspections" value={rows.length} icon={<ClipboardCheck />} />
                      <KpiCard label="Major findings" value={major} tone={major ? "danger" : "success"} icon={<AlertTriangle />} />
                      <KpiCard label="Mine" value={mine.length} icon={<ShieldCheck />} hint="Inspections you added" />
                    </Grid>
                    <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
                      <Card>
                        <CardHeader title="Pass rate" />
                        <CardBody><Gauge value={rows.length ? passed / rows.length : 0} tone={rows.length && passed / rows.length < 0.7 ? "danger" : "accent"} label={passed + " of " + rows.length + " passed"} /></CardBody>
                      </Card>
                      <Card>
                        <CardHeader title="Inspections per day" />
                        <CardBody><CalendarHeatmap rows={inspections.rows} dateKey="date" label="inspections" /></CardBody>
                      </Card>
                    </div>
                  </div>
                )}
              </>
            ),
          },
          {
            id: "inspections",
            label: "Inspections",
            count: inspections.rows.length,
            render: () => (
              <TableView
                table={inspections}
                filterBy="result"
                columns={["site", "date", "inspector", "result", "photos"]}
                formColumns={["site", "date", "discipline", "result", "photos", "notes"]}
                renderDetail={(row) => (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">Checks</p>
                    <Checklist items={CHECKS} value={readJson<ChecklistValue>(row.checks, {})} readOnly />
                  </div>
                )}
              />
            ),
          },
        ]}
      />
      <Dialog open={open} onClose={() => setOpen(false)} title="New inspection" size="lg">
        <Steps
          onCancel={() => setOpen(false)}
          onFinish={submit}
          finishLabel="Save inspection"
          steps={[
            {
              id: "site",
              label: "Site",
              description: "Where and when",
              valid: draft.site.trim().length > 0,
              render: () => (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Site">{(id) => <Input id={id} value={draft.site} onChange={(event) => setDraft({ ...draft, site: event.target.value })} placeholder="e.g. Grangegorman Block B" />}</Field>
                  <Field label="Date">{(id) => <Input id={id} type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} />}</Field>
                  <Field label="Discipline">{(id) => <Select id={id} value={draft.discipline} onChange={(event) => setDraft({ ...draft, discipline: event.target.value })} placeholder="Choose…" options={["Civil", "Structural", "MEP", "Fire", "Architecture"]} />}</Field>
                </div>
              ),
            },
            { id: "checks", label: "Checks", description: "Pass, fail or not applicable", render: () => <Checklist items={CHECKS} value={draft.checks} onChange={(checks) => setDraft({ ...draft, checks })} /> },
            {
              id: "photos",
              label: "Photos and notes",
              render: () => (
                <div className="flex flex-col gap-4">
                  <PhotoInput value={draft.photos} onChange={(photos) => setDraft({ ...draft, photos })} />
                  <Field label="Notes">{(id) => <Textarea id={id} rows={4} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Actions, who is responsible and by when" />}</Field>
                  <p className="text-sm">Result: <Badge tone={resultOf(draft.checks) === "Pass" ? "success" : resultOf(draft.checks) === "Minor" ? "warning" : "danger"}>{resultOf(draft.checks)}</Badge></p>
                </div>
              ),
            },
          ]}
        />
      </Dialog>
    </>
  );
}
`;

const timesheet = String.raw`import { useMemo, useState } from "react";
import { AppShell, BarList, Button, CalendarHeatmap, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, Grid, Heatmap, Input, KpiCard, PageHeader, TableView, sumBy, toast } from "@ocsc/ui";
import { useApp, useTable } from "@ocsc/app";
import { Clock, Plus, Receipt, Users } from "lucide-react";

const DAY = 86400000;

function weekStart(date = new Date()) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

function weekLabel(value: unknown) {
  const time = Date.parse(String(value ?? ""));
  if (Number.isNaN(time)) return "—";
  return "w/c " + weekStart(new Date(time)).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
}

export default function App() {
  const entries = useTable("entries");
  const { viewer } = useApp();
  const [draft, setDraft] = useState({ date: new Date().toISOString().slice(0, 10), project: "", task: "", hours: "", billable: true });
  const [saving, setSaving] = useState(false);
  const monday = weekStart().getTime();
  const mine = entries.rows.filter((row) => row._mine === true);
  const thisWeek = mine.filter((row) => Date.parse(String(row.date)) >= monday);
  const teamWeek = entries.rows.filter((row) => Date.parse(String(row.date)) >= monday);
  const byWeek = useMemo(() => entries.rows.filter((row) => Date.parse(String(row.date)) >= monday - 7 * 7 * DAY).map((row) => ({ ...row, week: weekLabel(row.date) })), [entries.rows, monday]);
  const billable = teamWeek.filter((row) => row.billable === true);

  const add = async () => {
    const hours = Number(draft.hours);
    if (!draft.project.trim() || !(hours > 0)) return toast.error("Add a project and the hours");
    setSaving(true);
    try {
      await entries.insert({ date: draft.date, person: viewer.name, project: draft.project.trim(), task: draft.task || null, hours, billable: draft.billable });
      toast.success("Logged " + hours + " h");
      setDraft({ ...draft, task: "", hours: "" });
    } catch (error) {
      toast.error("Not saved", error instanceof Error ? error.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell
      title="Timesheets"
      subtitle="Hours by person and project"
      pages={[
        {
          id: "mine",
          label: "My week",
          render: () => (
            <div className="flex flex-col gap-4">
              <PageHeader eyebrow={viewer.name ?? "You"} title="This week" description="Log time as you go; only you can change your entries." />
              <Grid cols={3}>
                <KpiCard label="My hours this week" value={sumBy(thisWeek, "hours")} icon={<Clock />} hint="Target 37.5" />
                <KpiCard label="Billable" value={sumBy(thisWeek.filter((row) => row.billable === true), "hours")} icon={<Receipt />} />
                <KpiCard label="Entries" value={thisWeek.length} />
              </Grid>
              {entries.canEdit && (
                <Card>
                  <CardHeader title="Log time" />
                  <CardBody>
                    <div className="grid gap-3 sm:grid-cols-[150px_1fr_1fr_100px_auto_auto] sm:items-end">
                      <Field label="Date">{(id) => <Input id={id} type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} />}</Field>
                      <Field label="Project">{(id) => <Input id={id} value={draft.project} onChange={(event) => setDraft({ ...draft, project: event.target.value })} placeholder="Job number or name" />}</Field>
                      <Field label="Task">{(id) => <Input id={id} value={draft.task} onChange={(event) => setDraft({ ...draft, task: event.target.value })} placeholder="Optional" />}</Field>
                      <Field label="Hours">{(id) => <Input id={id} type="number" step="0.25" min="0" value={draft.hours} onChange={(event) => setDraft({ ...draft, hours: event.target.value })} />}</Field>
                      <div className="pb-2"><Checkbox checked={draft.billable} onChange={(billable) => setDraft({ ...draft, billable })} label="Billable" /></div>
                      <Button icon={<Plus />} loading={saving} onClick={() => void add()}>Log</Button>
                    </div>
                  </CardBody>
                </Card>
              )}
              <Card>
                <CardHeader title="My last weeks" />
                <CardBody><CalendarHeatmap rows={mine} dateKey="date" valueKey="hours" weeks={20} label="hours" /></CardBody>
              </Card>
            </div>
          ),
        },
        {
          id: "team",
          label: "Team",
          render: () =>
            entries.rows.length === 0 ? (
              <EmptyState icon={<Users />} title="No time logged yet" />
            ) : (
              <div className="flex flex-col gap-4">
                <Grid cols={3}>
                  <KpiCard label="Team hours this week" value={sumBy(teamWeek, "hours")} icon={<Users />} />
                  <KpiCard label="Billable share" value={sumBy(teamWeek, "hours") ? (sumBy(billable, "hours") / sumBy(teamWeek, "hours")) * 100 : 0} format="percent" icon={<Receipt />} />
                  <KpiCard label="People logging" value={new Set(teamWeek.map((row) => row._by ?? row.person)).size} />
                </Grid>
                <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
                  <Card>
                    <CardHeader title="Hours by project" description="This week" />
                    <CardBody><BarList data={sumBy(teamWeek, "hours", "project").sort((a, b) => b.value - a.value)} /></CardBody>
                  </Card>
                  <Card>
                    <CardHeader title="Hours per person per week" />
                    <CardBody><Heatmap rows={byWeek} x="week" y="person" valueKey="hours" /></CardBody>
                  </Card>
                </div>
              </div>
            ),
        },
        {
          id: "entries",
          label: "Entries",
          count: entries.rows.length,
          render: () => <TableView table={entries} filterBy="project" columns={["date", "person", "project", "task", "hours", "billable"]} newLabel="Log time" />,
        },
      ]}
    />
  );
}
`;

const assetRegister = String.raw`import { AppShell, BarList, Badge, Card, CardBody, CardHeader, DonutChart, EmptyState, Grid, ImageCard, KpiCard, PageHeader, TableView, countBy, formatNumber, sumBy } from "@ocsc/ui";
import { useTable } from "@ocsc/app";
import { Boxes, Euro, Wrench, CalendarClock } from "lucide-react";
import { imageIdsOf } from "./photos";

const DAY = 86400000;

export default function App() {
  const assets = useTable("assets");
  const active = assets.rows.filter((row) => row.status !== "Retired");
  const due = active
    .filter((row) => {
      const next = Date.parse(String(row.next_service ?? ""));
      return !Number.isNaN(next) && next - Date.now() < 30 * DAY;
    })
    .sort((a, b) => String(a.next_service).localeCompare(String(b.next_service)));
  const repair = active.filter((row) => row.status === "Repair");

  return (
    <AppShell
      title="Asset register"
      subtitle="Equipment, where it is and when it is due"
      pages={[
        {
          id: "overview",
          label: "Overview",
          render: () =>
            !assets.loading && assets.rows.length === 0 ? (
              <EmptyState icon={<Boxes />} title="No assets yet" description="Add equipment on the Register tab, with a photo of each tag." />
            ) : (
              <div className="flex flex-col gap-4">
                <PageHeader eyebrow="Equipment" title="Register" description="Value, condition and service dates." />
                <Grid cols={4}>
                  <KpiCard label="Assets in use" value={active.length} icon={<Boxes />} />
                  <KpiCard label="Value" value={sumBy(active, "cost")} format="currency" icon={<Euro />} />
                  <KpiCard label="Service due in 30 days" value={due.length} tone={due.length ? "warning" : "success"} icon={<CalendarClock />} />
                  <KpiCard label="In repair" value={repair.length} tone={repair.length ? "danger" : "neutral"} icon={<Wrench />} />
                </Grid>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card><CardHeader title="By category" /><CardBody><DonutChart data={countBy(active, "category")} centerLabel="Assets" /></CardBody></Card>
                  <Card><CardHeader title="By location" /><CardBody><BarList data={countBy(active, "location")} /></CardBody></Card>
                </div>
              </div>
            ),
        },
        {
          id: "service",
          label: "Service due",
          count: due.length,
          render: () =>
            due.length === 0 ? (
              <EmptyState icon={<CalendarClock />} title="Nothing due in the next 30 days" />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {due.map((row) => (
                  <ImageCard
                    key={row._id}
                    asset={imageIdsOf(row.photo)[0] ?? null}
                    title={String(row.name ?? row.tag ?? "Asset")}
                    description={[row.tag, row.location, row.assigned].filter(Boolean).join(" · ")}
                    footer={<Badge tone={Date.parse(String(row.next_service)) < Date.now() ? "danger" : "warning"} dot>Service {new Date(String(row.next_service)).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}</Badge>}
                  />
                ))}
              </div>
            ),
        },
        {
          id: "register",
          label: "Register",
          count: assets.rows.length,
          render: () => <TableView table={assets} filterBy="status" columns={["tag", "name", "category", "location", "assigned", "status", "next_service", "photo"]} newLabel="New asset" />,
        },
      ]}
    />
  );
}
`;

const assetPhotos = String.raw`export function imageIdsOf(value: unknown): string[] {
  return typeof value === "string" ? value.split(",").filter(Boolean) : [];
}
`;

const text = (key: string, label: string, required = false) => ({
  key,
  label,
  type: "text" as const,
  ...(required ? { required } : {}),
});

export const APP_TEMPLATES: AppTemplate[] = [
  {
    id: "project-tracker",
    title: "Project tracker",
    description:
      "Live jobs with fees, stages, leads and due dates: overview, board, programme and list.",
    access: "owner",
    files: { "App.tsx": projectTracker },
    tables: [
      {
        name: "projects",
        label: "Projects",
        title: "name",
        columns: [
          text("name", "Project", true),
          text("client", "Client"),
          {
            key: "stage",
            label: "Stage",
            type: "enum",
            options: [
              { value: "Pipeline", tone: "neutral" },
              { value: "Design", tone: "info" },
              { value: "Tender", tone: "accent" },
              { value: "Construction", tone: "warning" },
              { value: "Complete", tone: "success" },
              { value: "On hold", tone: "danger" },
            ],
          },
          { key: "lead", label: "Lead", type: "person" },
          { key: "fee", label: "Fee", type: "currency", currency: "EUR" },
          { key: "start", label: "Start", type: "date" },
          { key: "due", label: "Due", type: "date" },
          { key: "progress", label: "Progress", type: "percent" },
          { key: "notes", label: "Notes", type: "longtext" },
        ],
      },
    ],
  },
  {
    id: "client-pipeline",
    title: "Client pipeline",
    description:
      "Opportunities by stage with value, probability and owner: funnel, win rate and board.",
    access: "owner",
    files: { "App.tsx": clientPipeline },
    tables: [
      {
        name: "deals",
        label: "Deals",
        title: "name",
        columns: [
          text("name", "Opportunity", true),
          text("client", "Client"),
          {
            key: "stage",
            label: "Stage",
            type: "enum",
            options: [
              { value: "Lead", tone: "neutral" },
              { value: "Qualified", tone: "info" },
              { value: "Proposal", tone: "accent" },
              { value: "Negotiation", tone: "warning" },
              { value: "Won", tone: "success" },
              { value: "Lost", tone: "danger" },
            ],
          },
          { key: "value", label: "Value", type: "currency", currency: "EUR" },
          { key: "probability", label: "Probability", type: "percent" },
          { key: "owner", label: "Owner", type: "person" },
          { key: "close_date", label: "Close date", type: "date" },
          {
            key: "source",
            label: "Source",
            type: "enum",
            options: [
              { value: "Referral" },
              { value: "Framework" },
              { value: "Tender portal" },
              { value: "Repeat client" },
              { value: "Direct" },
            ],
          },
          { key: "notes", label: "Notes", type: "longtext" },
        ],
      },
    ],
  },
  {
    id: "site-inspection",
    title: "Site inspections",
    description:
      "A step-by-step inspection with a safety and quality checklist and photos; colleagues add their own.",
    access: "contribute",
    files: { "App.tsx": siteInspection },
    tables: [
      {
        name: "inspections",
        label: "Inspections",
        title: "site",
        columns: [
          text("site", "Site", true),
          { key: "date", label: "Date", type: "date", required: true },
          {
            key: "discipline",
            label: "Discipline",
            type: "enum",
            options: [
              { value: "Civil" },
              { value: "Structural" },
              { value: "MEP" },
              { value: "Fire" },
              { value: "Architecture" },
            ],
          },
          { key: "inspector", label: "Inspector", type: "person" },
          {
            key: "result",
            label: "Result",
            type: "enum",
            options: [
              { value: "Pass", tone: "success" },
              { value: "Minor", tone: "warning" },
              { value: "Major", tone: "danger" },
            ],
          },
          { key: "checks", label: "Checks", type: "longtext", hidden: true },
          { key: "photos", label: "Photos", type: "image" },
          { key: "notes", label: "Notes", type: "longtext" },
        ],
      },
    ],
  },
  {
    id: "timesheet",
    title: "Timesheets",
    description:
      "Everyone logs their own hours by project; the team view shows hours per person and project.",
    access: "contribute",
    files: { "App.tsx": timesheet },
    tables: [
      {
        name: "entries",
        label: "Time entries",
        title: "project",
        columns: [
          { key: "date", label: "Date", type: "date", required: true },
          { key: "person", label: "Person", type: "person" },
          text("project", "Project", true),
          text("task", "Task"),
          { key: "hours", label: "Hours", type: "number", required: true },
          { key: "billable", label: "Billable", type: "boolean" },
        ],
      },
    ],
  },
  {
    id: "asset-register",
    title: "Asset register",
    description:
      "Equipment with tags, photos, locations, owners and service dates, and what is due next.",
    access: "owner",
    files: { "App.tsx": assetRegister, "photos.ts": assetPhotos },
    tables: [
      {
        name: "assets",
        label: "Assets",
        key: "tag",
        title: "name",
        columns: [
          text("tag", "Tag", true),
          text("name", "Name", true),
          {
            key: "category",
            label: "Category",
            type: "enum",
            options: [
              { value: "IT" },
              { value: "Survey" },
              { value: "Safety" },
              { value: "Vehicle" },
              { value: "Plant" },
              { value: "Furniture" },
            ],
          },
          text("location", "Location"),
          { key: "assigned", label: "Assigned to", type: "person" },
          {
            key: "status",
            label: "Status",
            type: "enum",
            options: [
              { value: "In use", tone: "success" },
              { value: "Spare", tone: "info" },
              { value: "Repair", tone: "warning" },
              { value: "Retired", tone: "neutral" },
            ],
          },
          { key: "purchased", label: "Purchased", type: "date" },
          { key: "cost", label: "Cost", type: "currency", currency: "EUR" },
          { key: "next_service", label: "Next service", type: "date" },
          { key: "photo", label: "Photo", type: "image" },
        ],
      },
    ],
  },
];

export function findTemplate(id: string): AppTemplate | undefined {
  return APP_TEMPLATES.find((template) => template.id === id);
}
