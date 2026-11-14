/** Returned by save_app {"help": true}, so ordinary turns do not pay for it. */
export const APP_KIT_GUIDE = `# OCSC App Studio guide

An app is a small React + TypeScript project with its own live tables. It runs sandboxed (no network,
no fetch, no storage); every read and write goes through the host, which checks who is looking.
It opens from the chat, by link or password (Share), and in the App Studio where its owner edits data
and code. Build apps people use every day, not reports: real screens, real actions, real data.
Never build anything that asks for passwords or sign-in details, imitates another company's or
OCSC's own sign-in, or exists to deceive, harass or break the law; saves with a password field are refused.

## Saving
- save_app {title, files: {"App.tsx": "..."}, tables: [...]} creates an app. App.tsx must
  \`export default function App()\`. Other files (Board.tsx, lib.ts, theme.css) import with "./Board".
- Change an app with {appId, edits: [{file, find, replace}]} (all apply or none; each find occurs once),
  or {appId, files: {...}} to replace whole files (files you omit stay), deleteFiles: ["Old.tsx"].
- save_app {template: "project-tracker"|"client-pipeline"|"site-inspection"|"timesheet"|"asset-register",
  title?} starts from a polished starter with its tables; then read it and fit it to the person with edits.
  site-inspection and timesheet let colleagues add their own rows (contribute access).
- {appId} alone returns its files, tables (schemas, counts, sample rows) and pictures. Read before editing.
- Every save builds first: problems come back with file:line:column and nothing is saved. Fix and resend.
- Each code save then opens the app and clicks through every page on a desktop and a phone: runCheck
  lists crashes, console errors, blank pages and sideways scrolling. Fix them before you reply.
- app_look {appId, pages?: ["overview", "board"], phone?: true, theme?: "dark"} returns screenshots
  with the real data. Look after the first build and after design changes; judge hierarchy, spacing,
  empty or cramped areas and charts that say nothing; fix with edits and look again.
- Data is separate from code: app_data reads and changes rows (routines refresh data there), and
  restoring an older code version keeps today's rows.

## Tables
tables: [{schema, rows?, mode?}] defines or changes tables in the same save. mode: "replace" (default when
rows are sent), "append", or "upsert" (match on schema.key). Sending a schema without rows keeps rows.
schema = {name: "projects", label: "Projects", key?: "job_no", title?: "name", personal?: true, shared?: true, large?: true, columns: [...]}
large: true for tables past a few thousand rows: the server pages them (see "Large tables" below).
personal: true keeps each person's rows private: colleagues see and change only the rows they added, the
owner (and their routines) sees everyone's, visitors see none. The server enforces it. Use it when people
must not see each other's entries (their own inspections, expenses, reviews), with colleagues allowed to add
rows (contribute or company). Keep shared lists (checklists, sites, rates) in ordinary tables of the same app.

## Who the app is for
A new app in a chat starts only after the person answers the ask_app_scope card.
Individual user app: one person, one set of rows. Example: their private site diary of visits,
notes and photos. Leave workspaces off.
Tenant app: one tool the company reuses, with a separate set of data for each project, bridge or
site and the people on it. Example: a bridge inspection tool, where Athlone Bridge, Kells Bridge and
Sligo Bridge each keep their own inspections, defects and team. Pass workspaces and build the screens for one.

## Workspaces (separate data per project, bridge or site)
An app either keeps one set of data, or (workspaces on) a separate set per project, bridge, site or
client: each workspace's rows are seen only by the people added to it, as lead (changes everything and
chooses who is in it), member (adds and changes entries; only their own in contribute mode or personal
tables) or viewer (reads). The owner sees every workspace. Turn them on whenever the person says the app
is for many projects/sites/teams or "each one has its own data": save_app workspaces: {label: "Bridge",
create: "anyone"} (colleagues start their own) or "owner" (only the owner starts them and adds people).
The kit then shows a slim bar above the app to switch, start one and manage people, and a "not in one yet"
screen, so never build workspace pickers, member lists or your own project filter for this; build the app
as if it holds one bridge's data. Mark tables everyone needs (staff, rates, checklists, sites list)
schema shared: true so they stay app-wide. useWorkspace() says which one is open. In the owner's "All"
view rows carry _workspace (its name): group or filter by it on overview pages, and adding rows waits until
one is opened (useTable's canAdd is false; show a hint). useAppState is app-wide; keep per-workspace
settings in a table. Load a workspace's rows with app_data workspace: "<name>".
column = {key, label, type, options?, currency?, relation?, formula?, required?, hidden?}
types: text, longtext, number, currency (currency: "EUR"|"GBP"), percent (0.25 = 25%), date (YYYY-MM-DD),
boolean, enum (options: [{value: "Live", tone: "success"}], tones: neutral success warning danger info accent),
email, url, person (a name), relation (relation: "clients" — stores the other table's key or row _id),
image (photos people add in the app: up to 12 picture ids joined by commas; TableView, RecordForm and
RecordDetail show and take them on their own).
formula: arithmetic over the row's number columns, e.g. "fee * progress" or "(hours - budget) / budget";
formula columns are computed, never stored. Rows carry _id and _updatedAt. Up to 30 tables, 20,000 rows each.
Use the real data: gather it with your tools, or the person's spreadsheet. Never invent figures.

## Imports allowed
react, motion/react (animation), lucide-react (icons), recharts (only if the kit charts can't do it),
@ocsc/ui (the component kit), @ocsc/app (data and host). Nothing else resolves.

## @ocsc/app
- useTable(name) → {rows, schema, loading, canEdit, canEditRow(row), insert(row), update(id, patch), remove(id), exportFile("xlsx"|"csv"), canExport}
  Live: colleagues' edits and routine refreshes arrive on their own. Writes show at once and roll back
  if refused. Hide add/edit/delete when canEdit is false (visitors, read-only viewers).
  When the owner lets colleagues contribute (Settings: "Colleagues add their own"), anyone signed in adds
  rows but changes only their own: gate per-row edit/delete with canEditRow(row). Rows people added carry
  _mine (true for the viewer's own) and _by (who added it), so "My entries" is rows.filter((r) => r._mine)
  and the owner can group by _by. Forms, timesheets, inspections and surveys suit this mode. Everyone
  still sees all rows here; for private rows mark the table personal. In a personal table a colleague's
  rows are all their own, so write the screens for "my entries" and give the owner (viewer.role "owner")
  the team view, grouped by _by.
- useTables() → every table. useApp() → {ready, app: {id, title, version}, viewer: {name, canEdit, role}, theme}.
- useWorkspace() → {enabled, label, current: {id, name, role} | null, workspaces, canCreate, canManage}
  (the kit's bar already switches and manages; use it for headings like "Inspections — {current.name}").
  useTable(name).canAdd is false when the viewer can't add here (viewers, the owner's All view).
- useAppState(key, initial) → [value, set]: small shared settings for the app (not per person).
- useAsset(id) → an image URL for a picture added with app_asset (or <AssetImage asset={id}/>).
- Photos from the people using the app (site photos, defects, receipts): an image column with
  <PhotoInput value={row.photos} onChange={(photos) => ...}/> (camera or library, shrunk before sending),
  shown with <Photos value={row.photos}/> (thumbnails that open full size). useCanUpload() says whether this
  viewer may add them; uploadImage(file) → picture id for custom pickers. Never ask for photos as URLs.
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
  Stat, Progress {value 0-100, tone?}, Ring {value 0-100, label?}, formatNumber(value, format, currency).
  Percent scale: percent columns store 0.25 for 25%, but KpiCard/formatNumber "percent", Progress and Ring take 25;
  multiply a percent column or a ratio by 100 before passing it. Gauge takes a 0-1 ratio (or value with max).
Charts (animated, themed): AreaChart/BarChart/LineChart {data, x, series: ["fee"] or [{key, label, color?}],
  format?, stacked?, horizontal? (bar), height?}, DonutChart {data, label="label", value="value", centerLabel?},
  BarList {data, label, value, format?, onSelect?}. Helpers: byMonth(rows, dateKey, [valueKeys]) → [{month,...}],
  countBy(rows, key) → [{label, value}], sumBy(rows, field) → total or sumBy(rows, field, byKey) →
  [{label, value}], groupBy(rows, key) → Map.
More charts: Gauge {value 0-1 or value+max, label?, format?, tone?, hint?} (budget used, capacity),
  FunnelChart {data, label, value, format?, onSelect?} (enquiry → quote → won with conversion),
  ScatterChart {data, x, y, size?, groupBy?, labelKey?, xLabel?, yLabel?, xFormat?, yFormat?, onSelect?},
  CalendarHeatmap {rows, dateKey, valueKey?, weeks?=52, onSelect?(day, rows)} (activity per day),
  Heatmap {rows, x, y, valueKey?, format?, onSelect?({x, y, rows})} (office × month, discipline × stage).
Periods: PeriodFilter {value, onChange} with Period "7d"|"30d"|"90d"|"ytd"|"12m"|"all"; inPeriod(rows,
  dateKey, period) filters, periodChange(rows, dateKey, period, field?) → {value, previous, delta} feeds
  KpiCard straight away: <KpiCard label="Fees" value={fees.value} delta={fees.delta} deltaLabel="vs previous" />.
Data: TableView {table: useTable(...), columns?: ["name", "stage", {key, label, render}], filterBy?: "stage",
  formColumns?, title?, renderDetail?, toolbar?} — search, filter chips, sort, paging, a drawer to view/edit,
  add, delete with confirm and export, all wired to the table. DataTable {rows, columns or schema, search?,
  filterBy?, onRowClick?} for read-only lists. CellValue {column, value} renders a typed value.
  RecordForm {schema, value, onChange, columns?} and RecordDetail {schema, row}.
Views: Kanban {rows, groupBy: "stage", orderBy? (a number column), columns?, renderCard, onMove(row, value,
  drop {index, order}), onOpen?, onAdd?(value)} — drag with a mouse, press and hold on touch, or Alt+arrows;
  with orderBy cards also reorder in a column: save {[groupBy]: value, [orderBy]: drop.order}.
  CalendarMonth {rows, dateKey, titleKey, toneKey?, onOpen?}, Timeline {rows, startKey, endKey, titleKey},
  ActivityFeed {items: [{id, title, description?, date?, tone?, icon?}]}. Gantt (see below) is the planner.
Flows: Steps {steps: [{id, label, description?, render: () => fields, valid?}], onFinish, finishLabel?,
  onCancel?} for multi-step forms (put it in a Dialog or a page). Checklist {items: [{id, label, hint?,
  section?}], value, onChange, readOnly?} for inspections and audits (pass/fail/N-A, a note on fail); keep its
  value in a longtext column as JSON.stringify(value) and read it with readJson(row.checks, {});
  checklistSummary(items, value) → {total, answered, passed, failed, complete}.
Controls: Button {variant: "primary"|"secondary"|"outline"|"ghost"|"danger"|"link", size: "sm"|"md"|"lg"|"icon", icon?, loading?},
  Badge {tone?, dot?}, Card {interactive?} with CardHeader {title, description?, action?, icon?} and CardBody,
  Field {label, hint?, error?, children: (id) => <Input id={id}/>}, Input, Textarea, Select {options},
  SearchInput {value, onChange}, Switch, Checkbox {checked, onChange, label?}, Tabs {value, onChange, items},
  FilterChips {options, value, onChange}, Avatar {name}, AvatarStack {names}, Skeleton, EmptyState
  {icon?, title, description?, action?}, Divider, Menu {trigger, items}.
Overlays: Dialog {open, onClose, title, footer?, size?}, Drawer {open, onClose, title, footer?},
  ConfirmDialog {open, onClose, onConfirm, danger?}, toast("Saved") / toast.success / toast.error.
Pictures: AssetImage {asset, fit?}, ImageCard {asset?, title, description?}, Gallery {assets: [{id, caption?}]}
  (opens full size), Lightbox {ids, index, onIndex}, PhotoInput {value, onChange, onPhoto?, markup?, max?, label?}, Photos {value,
  size?: "sm"|"md"|"lg", limit?}.
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

## Phones (most people open apps in the OCSC iPhone and Android app, often on site)
Design the phone screen as carefully as the desktop one; the kit handles the basics only if you use it.
- Width: build for 360-390px first, then add sm:/md:/lg: columns. Grid, Split and AppShell stack on their
  own; never set fixed widths (w-[600px], min-w-[...]) on page content. Wide tables use TableView or sit in
  overflow-x-auto; long words and numbers get min-w-0 and truncate or break-words.
- Fingers: every control at least 40px tall (kit Button md, or size "icon"; never a bare icon in a
  span). Keep 8px between neighbouring controls. Put the main action where a thumb reaches: in the page's
  actions or a full-width Button at the end of a form.
- Reading: body text 14px or more, nothing under 12px (text-xs). Key figures first; keep a phone card to
  one idea. Text inputs use the kit fields, which are 16px on touch screens so iPhone does not zoom in
  on tap; a raw <input> needs text-base.
- Touch only: there is no hover on a phone, so never hide actions or details behind hover. Long lists
  get a SearchInput and FilterChips. Dialogs open as bottom sheets and Drawers fill the phone; keep forms in one column
  with the right input types (type="tel", "email", "number", "date"; inputMode="decimal" for amounts).
- The app sits inside the OCSC app below its header, so never add your own status-bar or notch padding
  and never use 100vh layouts or position: fixed bars; let the page scroll.
- After each save the phone check reports sideways scrolling (naming the element), fields iOS would
  zoom into, controls under 32px and text under 11px. Fix every one, then app_look with phone: true.

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
