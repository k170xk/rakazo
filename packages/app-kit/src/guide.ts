/** Returned by save_app {"help": true}, so ordinary turns do not pay for it. */
export const APP_KIT_GUIDE = `# OCSC App Studio guide

An app is a small React + TypeScript project with its own live tables. It runs sandboxed (no network,
no fetch, no storage); every read and write goes through the host, which checks who is looking.
It opens from the chat, by link or password (Share), and in the App Studio where its owner edits data
and code. Build apps people use every day, not reports: real screens, real actions, real data.

## Saving
- save_app {title, files: {"App.tsx": "..."}, tables: [...]} creates an app. App.tsx must
  \`export default function App()\`. Other files (Board.tsx, lib.ts, theme.css) import with "./Board".
- Change an app with {appId, edits: [{file, find, replace}]} (all apply or none; each find occurs once),
  or {appId, files: {...}} to replace whole files (files you omit stay), deleteFiles: ["Old.tsx"].
- {appId} alone returns its files, tables (schemas, counts, sample rows) and pictures. Read before editing.
- Every save builds first: problems come back with file:line:column and nothing is saved. Fix and resend.
- Data is separate from code: app_data reads and changes rows (routines refresh data there), and
  restoring an older code version keeps today's rows.

## Tables
tables: [{schema, rows?, mode?}] defines or changes tables in the same save. mode: "replace" (default when
rows are sent), "append", or "upsert" (match on schema.key). Sending a schema without rows keeps rows.
schema = {name: "projects", label: "Projects", key?: "job_no", title?: "name", columns: [...]}
column = {key, label, type, options?, currency?, relation?, formula?, required?, hidden?}
types: text, longtext, number, currency (currency: "EUR"|"GBP"), percent (0.25 = 25%), date (YYYY-MM-DD),
boolean, enum (options: [{value: "Live", tone: "success"}], tones: neutral success warning danger info accent),
email, url, person (a name), relation (relation: "clients" — stores the other table's key or row _id).
formula: arithmetic over the row's number columns, e.g. "fee * progress" or "(hours - budget) / budget";
formula columns are computed, never stored. Rows carry _id and _updatedAt. Up to 30 tables, 20,000 rows each.
Use the real data: gather it with your tools, or the person's spreadsheet. Never invent figures.

## Imports allowed
react, motion/react (animation), lucide-react (icons), recharts (only if the kit charts can't do it),
@ocsc/ui (the component kit), @ocsc/app (data and host). Nothing else resolves.

## @ocsc/app
- useTable(name) → {rows, schema, loading, canEdit, insert(row), update(id, patch), remove(id), exportFile("xlsx"|"csv"), canExport}
  Live: colleagues' edits and routine refreshes arrive on their own. Writes show at once and roll back
  if refused. Hide add/edit/delete when canEdit is false (visitors, read-only viewers).
- useTables() → every table. useApp() → {ready, app: {id, title, version}, viewer: {name, canEdit, role}, theme}.
- useAppState(key, initial) → [value, set]: small shared settings for the app (not per person).
- useAsset(id) → an image URL for a picture added with app_asset (or <AssetImage asset={id}/>).
- ai.available() / await ai.ask(prompt, {json?}) → a short answer from the company model, no tools or
  data access: pass the rows it needs in the prompt. Use for summaries, drafting, classification.
- download(filename, text, mime) and openLink(url): call from a click.

## @ocsc/ui (Tailwind classes work everywhere; use the tokens, never raw hex)
Layout: AppShell {title, subtitle?, icon?, actions?, pages: [{id, label, icon?, count?, render}], wide?} — the
  frame for every app (frosted top bar, animated tabs, remembers the open tab). PageHeader {eyebrow?, title,
  description?, actions?}, Section {title?, description?, actions?}, Grid {cols 1-6}, Split {main, aside},
  Stagger/StaggerItem (children fade up in sequence), Hero {eyebrow?, title, description?, asset?, actions?}.
Numbers: KpiCard {label, value, format?: "number"|"currency"|"percent"|"compact" or (n) => string, currency?,
  delta? (% vs last period), downIsGood?, trend?: number[], icon?, hint?, tone?, onClick?}. CountUp, Sparkline,
  Stat, Progress {value 0-1, tone?}, Ring {value 0-1, label?}, formatNumber(value, format, currency).
Charts (animated, themed): AreaChart/BarChart/LineChart {data, x, series: ["fee"] or [{key, label, color?}],
  format?, stacked?, horizontal? (bar), height?}, DonutChart {data, label="label", value="value", centerLabel?},
  BarList {data, label, value, format?, onSelect?}. Helpers: byMonth(rows, dateKey, [valueKeys]) → [{month,...}],
  countBy(rows, key) → [{label, value}], sumBy(rows, field) → total or sumBy(rows, field, byKey) →
  [{label, value}], groupBy(rows, key) → Map.
Data: TableView {table: useTable(...), columns?: ["name", "stage", {key, label, render}], filterBy?: "stage",
  formColumns?, title?, renderDetail?, toolbar?} — search, filter chips, sort, paging, a drawer to view/edit,
  add, delete with confirm and export, all wired to the table. DataTable {rows, columns or schema, search?,
  filterBy?, onRowClick?} for read-only lists. CellValue {column, value} renders a typed value.
  RecordForm {schema, value, onChange, columns?} and RecordDetail {schema, row}.
Views: Kanban {rows, groupBy: "stage", columns?, renderCard, onMove(row, value), onOpen?},
  CalendarMonth {rows, dateKey, titleKey, toneKey?, onOpen?}, Timeline {rows, startKey, endKey, titleKey},
  ActivityFeed {items: [{id, title, description?, date?, tone?, icon?}]}.
Controls: Button {variant: "primary"|"secondary"|"outline"|"ghost"|"danger"|"link", size: "sm"|"md"|"lg"|"icon", icon?, loading?},
  Badge {tone?, dot?}, Card {interactive?} with CardHeader {title, description?, action?, icon?} and CardBody,
  Field {label, hint?, error?, children: (id) => <Input id={id}/>}, Input, Textarea, Select {options},
  SearchInput {value, onChange}, Switch, Checkbox {checked, onChange, label?}, Tabs {value, onChange, items},
  FilterChips {options, value, onChange}, Avatar {name}, AvatarStack {names}, Skeleton, EmptyState
  {icon?, title, description?, action?}, Divider, Menu {trigger, items}.
Overlays: Dialog {open, onClose, title, footer?, size?}, Drawer {open, onClose, title, footer?},
  ConfirmDialog {open, onClose, onConfirm, danger?}, toast("Saved") / toast.success / toast.error.
Pictures: AssetImage {asset, fit?}, ImageCard {asset?, title, description?}, Gallery {assets: [{id, caption?}]}.
Motion: motion from "motion/react" with motionPresets (fadeUp, fade, pop, spring), stagger.container /
  stagger.item variants, ease.
cn(...classes) merges classes, later wins.

## Design (OCSC Evolve)
- Urbanist, brand green primary, light and dark both work (the kit follows the host theme).
- Tokens: bg-background, bg-card, bg-muted, text-foreground, text-muted-foreground, border-border,
  text-primary, bg-primary/10, chart-1..6, shadow-soft/shadow-card/shadow-glow, rounded-xl/2xl. Never
  blue or purple themes, black primary buttons, or raw colours.
- Start with AppShell. Overview first: a Hero or PageHeader, 3-4 KpiCards with trends, one or two charts,
  then the work list. A tab per job to be done (Board, Calendar, Table, Settings), not per table.
- Make it feel alive: Stagger the cards, counts that change, empty states with an action, toasts on save,
  detail drawers on click, keyboard-friendly forms. Group, filter and sort for the person's real questions.
- Mobile works: Grid stacks, AppShell tabs scroll; avoid fixed widths.

## Example
\`\`\`tsx
import { AppShell, Grid, KpiCard, Card, CardHeader, CardBody, AreaChart, DonutChart, TableView, Kanban, Badge, byMonth, countBy } from "@ocsc/ui";
import { useTable } from "@ocsc/app";
import { Briefcase, Euro } from "lucide-react";
export default function App() {
  const jobs = useTable("jobs");
  const fees = jobs.rows.reduce((sum, row) => sum + Number(row.fee ?? 0), 0);
  return <AppShell title="Job tracker" subtitle="Dublin office" pages={[
    { id: "overview", label: "Overview", render: () => <>
      <Grid cols={2}>
        <KpiCard label="Live jobs" value={jobs.rows.length} icon={<Briefcase />} />
        <KpiCard label="Fees" value={fees} format="currency" icon={<Euro />} />
      </Grid>
      <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card><CardHeader title="Fees by month" /><CardBody><AreaChart data={byMonth(jobs.rows, "start", ["fee"])} x="month" series={["fee"]} format="currency" /></CardBody></Card>
        <Card><CardHeader title="By stage" /><CardBody><DonutChart data={countBy(jobs.rows, "stage")} /></CardBody></Card>
      </div>
    </> },
    { id: "board", label: "Board", render: () => <Kanban rows={jobs.rows} groupBy="stage"
        onMove={(row, stage) => jobs.update(row._id, { stage })}
        renderCard={(row) => <div className="font-medium">{String(row.name)} <Badge tone="info">{String(row.client)}</Badge></div>} /> },
    { id: "jobs", label: "Jobs", count: jobs.rows.length, render: () => <TableView table={jobs} filterBy="stage" /> },
  ]} />;
}
\`\`\`
`;
