/** Returned by save_app {"help": true}, so ordinary turns do not pay for it. */
export const APP_KIT_GUIDE = `# OCSC App Studio guide

An app is a multi-file React + TypeScript workbench with its own live tables. It runs sandboxed (no network,
no fetch, no storage); every read and write goes through the host, which checks who is looking.
It opens full screen, by link or password (Share), in Evolve as a published plugin, and in the App Studio
where its owner edits data and code. Build software staff genuinely love opening every day — never a bare
two-tab CRUD table. Even when someone asks for a "basic" or "simple" tool, keep it effortless to use while
giving Version 1 the visual craft, charts, interactive views and polish of a flagship product.
Never build anything that asks for passwords or sign-in details, imitates another company's or
OCSC's own sign-in, or exists to deceive, harass or break the law; saves with a password field are refused.

## Planning & V1 Blueprint (pick concrete @ocsc/ui pieces before you build)
Every strong v1 combines **3–4 job-focused pages** (with icons and counts on \`AppShell\`), \`<Theme />\`, \`commands\` (\`⌘K\`),
live visual insight, and populated data on day one:
- **Registers, BIM / Document / Asset Logs, Compliance**: \`<Theme preset="crisp" density="comfortable" />\` · Overview (\`DonutChart\` + \`BarList\`/\`Gauge\` + Needs-Attention \`SpotlightCard\`) · Review \`Kanban\` or \`GalleryView\` · \`TableView\` with \`renderDetail\` · \`PrintButton\` OCSC PDF register export + \`commands\`.
- **Project / Programme / Tender Trackers**: \`<Theme preset="evolve" />\` · Overview (\`Aurora\`, 4 \`KpiCard\`s with \`delta\`/\`trend\`, \`PeriodFilter\`, \`AreaChart\` + \`DonutChart\`) · Stage \`Kanban\` · Draggable \`Gantt\` or \`CalendarMonth\` · \`TableView\` + \`PrintButton\` portfolio PDF.
- **CRM / Client / Fee Pipelines**: \`<Theme preset="evolve" />\` · Overview (\`FunnelChart\`, horizontal \`BarChart\` by owner, weighted \`KpiCard\`s, \`PeriodFilter\`) · Deal \`Kanban\` · Follow-up \`CalendarMonth\`/\`ActivityFeed\` · \`TableView\`.
- **Site Inspections, Snagging, Audits, Field Diaries**: \`<Theme preset="forest" />\` (or \`"contrast"\` for outdoor tablets) · Overview (\`Gauge\` pass rate, \`CalendarHeatmap\`, \`PhotoMap\`/\`MapView\`) · Guided \`Steps\` + \`Checklist\` (\`PhotoInput\` with \`markup\`, \`SignaturePad\`, \`PlaceSearch\`) · \`GalleryView\`/\`CompareImages\` · \`TableView\` + \`PrintButton\` site report.
- **Timesheets, Rotas, Leave, Resource Planning**: \`<Theme preset="soft" />\` · Personal quick-entry + \`CalendarHeatmap\` · Team \`Heatmap\` + \`BarList\` · \`CalendarMonth\`/\`Gantt\` · \`TableView\`.
- **Workshops, Strategy, Architecture, Option Studies**: \`<Theme preset="evolve" />\` · \`BentoGrid\`/\`BentoCard\` overview · Collaborative \`Whiteboard\` or \`SortableList\`/\`TreeView\`/\`OrgChart\` · Action \`Kanban\` · \`TableView\` with \`MarkdownEditor\`.

## Day-1 Data Rule (never ship a dead, zero-row screen unless asked)
- **Real data first**: if the app is for an attached spreadsheet (\`workbook\`) or live Evolve data (\`evolve\` tools / \`useEvolve\`), load the real records. Never invent company facts as real records.
- **Starter sample set when starting fresh**: when no real records exist yet (unless the user explicitly asked for an empty blank slate), add \`{ key: "is_sample", label: "Sample", type: "boolean", hidden: true }\` to the main table schema, seed **8–12 realistic OCSC engineering/project sample rows** (\`is_sample: true\`) spanning statuses, categories, dates and amounts, and place \`<SampleBanner tables={[mainTable]} />\` near the top of Overview. Charts, KPIs, boards and \`app_look\` screenshots then come alive immediately, and the user clears all sample rows in one click while keeping any records they added. Mention in chat that illustrative sample rows are loaded and one-click clearable.

## Saving & Craft Loop
- \`save_app {title, brief, icon, files: {"App.tsx": "...", "Overview.tsx": "..."}, tables: [...]}\` creates an app. \`App.tsx\` must \`export default function App()\`. Split larger apps (>250 lines) into clean modules (\`./Overview\`, \`./BoardView\`, \`./report\`).
- Change an app with \`{appId, summary: "Added Kanban board and PDF export.", edits: [{file, find, replace}]}\` (all apply or none; each find occurs once), or \`{appId, summary, files: {...}}\` to replace whole files (files you omit stay), \`deleteFiles: ["Old.tsx"]\`. Always pass a concise \`summary\` on updates so the compact update card in chat explains what changed.
- Every save keeps \`<AppShell>\`, the \`@ocsc/ui\` import and \`<Theme />\`. A new app without them is refused. A later save that removes them is refused and the previous version stays, including when an earlier version had the shell and the current files do not. The screens must be inside the shell: \`pages={[{ id, label, render: () => (...) }]}\` or as children between \`<AppShell>\` and \`</AppShell>\`. \`tabs\`, \`activeTab\`, \`onTabChange\`, \`activePage\` and \`onPageChange\` are not props. A self-closing \`<AppShell />\` with the screens written after it is refused, because the person then sees a blank window. \`pages\` entries without \`render: () => (...)\` also leave a blank window. Edit inside the shell. Do not replace App.tsx with a hand-written page.
- \`save_app {template: "project-tracker"|"client-pipeline"|"site-inspection"|"timesheet"|"asset-register", title?}\` starts from a starter with its tables; read it and tailor its screens, columns and starter rows to the job.
- \`{appId}\` alone returns its files, tables (schemas, counts, sample rows) and pictures. Read before editing.
- Every save compiles first (\`file:line:column\` on error), runs \`runCheck\` across every page on desktop and phone, and returns \`craftNotes\` flagging bare structure, missing kit charts, empty tables or dark-mode token mistakes. Fix every \`runCheck\` problem and \`craftNotes\` item before replying. When a save is refused, or \`runCheck\` reports blank/crashed screens, treat it like Lovable: fix and call \`save_app\` again — never tell the person the app is ready while the first version is still blank. A blank/crashed check skips the chat card until a later save keeps screens visible.
- Always call \`app_look {appId, pages: ["overview", ...], phone: true}\` across the main tabs (up to 4) + phone after building and after design edits. Critique hierarchy, chart clarity, card balance and spacing like a design director, refine with \`save_app\` edits, and look again.
- Data is separate from code: \`app_data\` reads and changes rows (routines refresh data there), and restoring an older code version keeps today's rows.

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

## Imports allowed
react, motion/react (or framer-motion — both resolve to Motion), lucide-react (icons), recharts (only if the kit charts can't do it),
@ocsc/ui (the component kit), @ocsc/app (data and host), @ocsc/calc (workbook calculators), @ocsc/python
(deterministic Python calculations), @ocsc/eng (units, numerics, sections, beams), @ocsc/math (LaTeX and
calculation sheets), @ocsc/plot (engineering charts and drawings), @ocsc/dxf (write and read DXF drawings),
@ocsc/sheets (CSV and Excel), @ocsc/ifc (open an IFC model; the engine stays on the host), and the app's own .py files as text. Nothing else resolves.

## @ocsc/python (deterministic Python for engineering calculations)
Use it for numerics TypeScript does badly: stiffness/matrix analysis (frames, grillages, FEA-lite), hydraulics
(Colebrook, pipe networks), optimisation and root finding, statistics, curve fitting, signals and sympy
derivations. Keep simple arithmetic in TypeScript and workbook maths in @ocsc/calc.
- Write the calculation as a file such as beam.py defining calc(inputs) that returns a dict, and import it
  as text: import beamPy from "./beam.py". One file per calculation; it cannot import the app's other .py files.
- usePython(beamPy, inputs) → {status: "running"|"ready"|"error"|"unavailable", result, error, loading}; it
  reruns when inputs change by value and keeps the last result meanwhile. result = {outputs, stdout, stderr,
  versions, key, hash}. loading is 0-1 while the runtime downloads the first time (tens of MB, then cached):
  show <Progress value={loading * 100} />. runPython(code, inputs) → Promise<result> for a button.
- Packages: numpy, scipy, pandas, sympy at pinned versions (found from the imports) plus the standard library.
- Determinism is enforced: the same code and inputs give the same outputs and hash on every machine running
  the pinned runtime. Seeds reset before each run (random and numpy's global generator to 0); seed your own
  generators (np.random.default_rng(42)). Saves are refused when a .py reads the clock (time.time,
  datetime.now), uses unseeded randomness, or imports js, pyodide, urllib, http, socket, subprocess,
  threading or asyncio. Pass dates in as inputs.
- Inputs arrive as JSON: a whole number like 3 is an int, so use float(x) or np.asarray(x, dtype=float).
  Return numbers, text, booleans, lists, dicts, numpy arrays and scalars (lists and numbers), pandas DataFrame
  ({columns, index, data}) or Series ({name, index, data}), and sympy expressions ({text, tex, value?}).
  Turn a DataFrame into a file with @ocsc/sheets: frameRows(result.outputs.table) then downloadCsv, or
  downloadWorkbook for .xlsx.
  Floats come back exactly (shortest round-trip), NaN and ±inf as NaN and ±Infinity; round only for display.
- error.message names the line ("calc.py line 12: ZeroDivisionError: division by zero"); print() goes to stdout.
  On a phone that runs short of memory the error says so in plain words; show error.message as it is.
  Only the packages a .py file imports download, so import scipy or pandas only where the maths needs them.
- Present results with @ocsc/math (CalcSheet, CalcStep, Check, and Tex for a sympy result's tex) and plot
  them with @ocsc/plot or the @ocsc/ui charts. Print result.versions.runtime and result.hash.slice(0, 12) on
  the calc sheet so a checker can reproduce it. LAPACK results (solve, eig, lstsq) agree with desktop CPython
  only to about 1e-14, so compare checks against limits, never with ===.
- app_look runs the calculations and photographs each page once they answer; where its result says Python is
  not installed, and in Evolve plugins, status is "unavailable": keep that state a quiet placeholder.
\`\`\`py
import numpy as np
from scipy import linalg


def calc(inputs):
    spans = int(inputs["spans"])
    length = float(inputs["length"])  # m
    load = float(inputs["load"])  # kN/m
    ei = float(inputs["ei"])  # kNm2
    k = ei / length * np.array([[4.0, 2.0], [2.0, 4.0]])
    fixed = load * length**2 / 12 * np.array([1.0, -1.0])
    K = np.zeros((spans + 1, spans + 1))
    F = np.zeros(spans + 1)
    for i in range(spans):
        K[i : i + 2, i : i + 2] += k
        F[i : i + 2] -= fixed
    rotations = linalg.solve(K, F)
    moments = [0.0] + [float(-(k @ rotations[i : i + 2] + fixed)[1]) for i in range(spans)]
    moments[-1] = 0.0
    return {"support_moments": moments, "peak": max(moments), "rotations": rotations}
\`\`\`
\`\`\`tsx
import { useState } from "react";
import { usePython } from "@ocsc/python";
import { Callout, Card, CardBody, CardHeader, Field, Input, KpiCard, Progress } from "@ocsc/ui";
import beamPy from "./beam.py";

export default function BeamCheck() {
  const [load, setLoad] = useState(25);
  const beam = usePython<{ support_moments: number[]; peak: number }>(beamPy, { spans: 3, length: 6, load, ei: 42000 });
  return (
    <Card>
      <CardHeader title="Continuous beam" />
      <CardBody className="flex flex-col gap-4">
        <Field label="Load (kN/m)">{(id) => <Input id={id} type="number" inputMode="decimal" value={load} onChange={(event) => setLoad(Number(event.target.value))} />}</Field>
        {beam.loading !== null && <Progress value={beam.loading * 100} />}
        {beam.error && <Callout tone="danger">{beam.error.message}</Callout>}
        {beam.result && <KpiCard label="Support moment (kNm)" value={beam.result.outputs.peak} />}
      </CardBody>
    </Card>
  );
}
\`\`\`

## Engineering calculations (@ocsc/eng, @ocsc/math, @ocsc/plot)
Engineers check and sign these apps, so:
- Every number shown carries its unit, every design step names its source (code clause, table, text) in \`reference\`, and every limit is a \`Check\` showing utilisation.
- Compute once in plain functions or useMemo and pass the numbers in; CalcStep, Check and the plots display them and never recompute. Same inputs, same output: no random or date-dependent results.
- Round only for display (\`style={{ sf: 4 }}\` is the default, or \`{ dp: 2 }\`). Utilisation rounds up, so a failing check never shows 1.00.
- Convert with \`convert()\`; never type a conversion factor.
- Workbook logic belongs in @ocsc/calc and heavy numerics (matrices, FE, optimisation, SciPy) in @ocsc/python; present both with @ocsc/math and @ocsc/plot.

@ocsc/eng (pure functions):
- \`convert(12, "kN/m2", "kPa")\`, \`compatible(a, b)\`, \`q(5, "kN").div(q(2, "m2")).to("kPa")\` (dimensions are checked; a mismatch throws). SI with prefixes (kN, MPa, mm4, kWh, kVA, tCO2e), °C/°F, imperial (ft, lbf, ksi, psf, BTU, hp), m3/h, W/m2K, kgCO2e/m2.
- \`fmt(x, { sf | dp })\`, \`round\`/\`roundUp\`/\`roundDown\` (Excel ROUND), \`engNotation\`, \`siPrefix(4.7e-6, "F")\` → "4.7 µF", \`check(value, limit, "max" | "min")\` → \`{ utilisation, pass, shown }\`.
- \`interpolate(xs, ys, x, "error" | "clamp" | "extrapolate")\`, \`interpolate2d(xs, ys, table, x, y)\`, \`linspace\`, \`bisect\`/\`brent(f, a, b)\`, \`simpson(f, a, b, n)\`, \`trapz\`, \`solve(A, b)\`, \`luDecompose\`/\`luSolve\`, \`det\`.
- \`sectionProps({ type: "rect" | "circle" | "chs" | "rhs" | "i" | "t", ... })\` → \`{ A, yc, Ix, Iy, Zt, Zb, Zp, rx, ry }\` in mm; \`barRow\`, \`barArea\`.
- \`analyseBeam({ length, supports: [{ x, type: "pin" | "roller" | "fixed" }], loads: [{ type: "point", x, P } | { type: "udl", w, from?, to? } | { type: "linear", w1, w2, from, to } | { type: "moment", x, M }], EI? })\` in m, kN, kN/m, kNm and kNm² (loads down positive) → \`{ x, shear, moment (sagging +), deflection (mm, up +), reactions, max }\`, for continuous, propped and fixed beams; throws when the beam is unstable.

@ocsc/math (KaTeX with its fonts bundled):
- \`<Tex math="\\sigma = \\frac{M}{Z}" />\` inline, \`block\` for display. LaTeX goes as is in JSX attributes; in JS strings double each backslash ("\\\\frac").
- \`<CalcSheet title job by checked date revision actions>\` holds \`<CalcSection title reference>\`, \`<CalcStep label symbol formula values result unit style reference note>\` (formula = substituted numbers = result; \`values\` keyed by the formula's symbols, e.g. \`{ "f_{ck}": 30 }\`), \`<Check label symbol limitSymbol value limit mode unit reference>\` and \`<CalcNote>\`. \`<CheckSummary checks>\` lists utilisations with the governing one in bold.
- Write the rows once as \`CalcRow\` data: \`<CalcRows rows={rows} />\` shows them and \`calcPdfBlocks(rows)\` prints them through PrintButton. \`texText(latex)\` gives plain text.
- With @ocsc/calc too, \`import { CalcSheet as CalcPad } from "@ocsc/math"\` (both export CalcSheet).

@ocsc/plot (SVG in theme colours; prints light; each has an SVG download):
- \`<Plot series={[{ name, data: [[x, y]], type: "line" | "scatter" | "area" | "bar" | "step", axis: "right", color: 1-6 or a tone, dash, marker }]} x={{ label, unit, scale: "log", min, max }} y={...} y2={...} annotations={[{ type: "hline", y, label, tone: "danger" }, { type: "band", y: [a, b] }, { type: "point", x, y, label }]} equal />\`
- \`<ContourPlot grid={{ x, y, z }} levels zLabel />\`, \`<PolarPlot series={[{ name, data: [[deg, r]] }]} />\`, \`<InteractionDiagram curve={[[M, N]]} points={[{ M, N, label }]} />\`.
- \`<BeamResults beam result />\` (loads, shear, moment and deflection aligned), \`<BeamDiagram>\`, \`<ForceDiagram>\`, \`<SectionDrawing shape bars link />\`, and \`<Drawing bounds={[x0, y0, x1, y1]} units="mm">\` at true scale with DrawingLine, DrawingPoly, DrawingCircle, DrawingText and \`<Dim from to offset label />\`.
- \`await plotImage(element)\` → PNG for a PDF \`{ type: "image", src }\` block (every chart inside the element, stacked).
- Size: @ocsc/math adds about 500 KB, eng and plot about 15 KB each; import @ocsc/math only where formulas show.

## Drawings (@ocsc/dxf)
Apps can write and read DXF. writeDxf and downloadDxf (call download from a click) make an AutoCAD R12
file: lines, polylines, circles, arcs, text and points, on named layers, in millimetres by default
(units: "mm" | "m" | "unitless"). parseDxf reads those same entities back from a file the person drops
in (read it with FileReader.readAsText). A layer colour is an AutoCAD colour index, 1 to 255.
Show the same geometry on screen with @ocsc/plot Drawing. @ocsc/dxf adds a few KB.
\`\`\`tsx
import { downloadDxf } from "@ocsc/dxf";
import { Button } from "@ocsc/ui";

<Button onClick={() => downloadDxf("grid.dxf", {
  units: "mm",
  layers: [{ name: "GRID", color: 8 }],
  entities: [
    { type: "line", layer: "GRID", from: { x: 0, y: 0 }, to: { x: 6000, y: 0 } },
    { type: "circle", layer: "GRID", center: { x: 3000, y: 2000 }, radius: 150 },
    { type: "text", layer: "GRID", at: { x: 100, y: 100 }, text: "A", height: 250 },
  ],
})}>Download DXF</Button>
\`\`\`

## Spreadsheets (@ocsc/sheets)
Use this for CSV and Excel the app calculates or the person drops in. A stored table already has
exportFile("csv" | "xlsx"); this is for everything else (a take-off, a Python result, a file they attach).
- toCsv(rows) and parseCsv(text). downloadCsv(filename, rows) from a click.
- readSheets(arrayBuffer) → [{name, rows}] and writeSheets(sheets) → bytes. downloadWorkbook(filename, sheets)
  saves .xlsx. A cell is a string, number, boolean or null. Up to 30 sheets, 20,000 rows and 200 columns.
- frameRows(dataframe) turns a @ocsc/python pandas DataFrame ({columns, data}) into rows.
- Import @ocsc/sheets only in an app that reads or writes a workbook: the Excel reader adds about 400 KB.
  CSV alone is tiny, but it lives in the same import.

## Models (@ocsc/ifc)
An IFC model is a file, never part of the app's code. \`<IfcView />\` lets someone drop a .ifc file.
\`<IfcView asset="…" />\` opens one stored with app_asset, and \`<IfcView bytes={bytes} />\` opens bytes the
app already has. The viewer engine is served by the host the way Python is, and only when a model is
opened, so it does not count towards the app's size. Do not import three, web-ifc or @thatopen packages.
Where the engine is not installed, and inside an Evolve plugin, IfcView stays a quiet placeholder.
The engine files are read once and kept. Opening a model uses the person's computer and can take as long as the model needs.
A file kept with the app is still stored with the app's other files. Drag turns the model. It shows the shape, not every property.

## Engineering example
\`\`\`tsx
import { useMemo, useRef, useState } from "react";
import { analyseBeam, barArea, barRow, convert, type BeamInput } from "@ocsc/eng";
import { CalcRows, CalcSheet, CheckSummary, calcPdfBlocks, type CalcRow } from "@ocsc/math";
import { BeamResults, SectionDrawing, plotImage } from "@ocsc/plot";
import { AppShell, Card, CardBody, CardHeader, Field, Grid, Input, PrintButton, Theme } from "@ocsc/ui";
import { Calculator } from "lucide-react";

export default function App() {
  const [span, setSpan] = useState(6);
  const [w, setW] = useState(25);
  const diagrams = useRef<HTMLDivElement>(null);
  const b = 300, h = 550, fck = 30, fyk = 500;
  const bars = barRow({ n: 3, dia: 20, b, h, cover: 30, link: 10 });
  const As = barArea(3, 20);
  const d = h - bars[0]!.y;
  const beam: BeamInput = useMemo(() => ({
    length: span,
    supports: [{ x: 0, type: "pin" }, { x: span, type: "roller" }],
    loads: [{ type: "udl", w }],
    EI: convert(33, "GPa", "kN/m2") * convert((b * h ** 3) / 12, "mm4", "m4"),
  }), [span, w]);
  const result = useMemo(() => analyseBeam(beam), [beam]);
  const MEd = result.max.sagging.value;
  const K = (MEd * 1e6) / (b * d ** 2 * fck);
  const z = Math.min(0.95 * d, (d / 2) * (1 + Math.sqrt(1 - 3.53 * K)));
  const MRd = (0.87 * fyk * As * z) / 1e6;
  const delta = Math.abs(result.max.deflection?.value ?? 0);
  const limit = (span * 1000) / 250;
  const rows: CalcRow[] = [
    { kind: "section", title: "Actions", reference: "EN 1990" },
    { kind: "step", label: "Design moment", symbol: "M_{Ed}", formula: "\\\\frac{w L^2}{8}", values: { w, L: span }, result: MEd, unit: "kNm" },
    { kind: "section", title: "Bending", reference: "EN 1992-1-1 6.1" },
    { kind: "step", symbol: "K", formula: "\\\\frac{M_{Ed}}{b d^2 f_{ck}}", values: { "M_{Ed}": MEd * 1e6, b, d, "f_{ck}": fck }, result: K, style: { dp: 3 } },
    { kind: "step", symbol: "z", formula: "\\\\frac{d}{2}\\\\left(1 + \\\\sqrt{1 - 3.53 K}\\\\right)", values: { d, K }, result: z, unit: "mm", style: { dp: 0 }, note: "z ≤ 0.95d" },
    { kind: "step", symbol: "M_{Rd}", formula: "0.87 f_{yk} A_s z", values: { "f_{yk}": fyk, A_s: As, z }, result: MRd, unit: "kNm", reference: "3.1.7" },
    { kind: "check", label: "Bending", symbol: "M_{Ed}", limitSymbol: "M_{Rd}", value: MEd, limit: MRd, unit: "kNm" },
    { kind: "check", label: "Deflection", symbol: "\\\\delta", limitSymbol: "L/250", value: delta, limit, unit: "mm", reference: "7.4" },
  ];
  return (
    <>
      <Theme preset="crisp" />
      <AppShell
        title="RC beam"
        actions={
          <PrintButton
            size="sm"
            document={async () => ({
              title: "Beam B1",
              kind: "CALCULATION",
              blocks: [...calcPdfBlocks(rows), { type: "image", src: await plotImage(diagrams.current), caption: "Actions and effects" }],
            })}
          />
        }
        pages={[{
          id: "calc",
          label: "Calculation",
          icon: <Calculator />,
          render: () => (
            <div className="flex flex-col gap-4">
              <Grid cols={2}>
                <Field label="Span (m)">{(id) => <Input id={id} type="number" inputMode="decimal" value={span} onChange={(e) => setSpan(Math.max(1, Number(e.target.value) || 1))} />}</Field>
                <Field label="Load w (kN/m)">{(id) => <Input id={id} type="number" inputMode="decimal" value={w} onChange={(e) => setW(Number(e.target.value) || 0)} />}</Field>
              </Grid>
              <CheckSummary checks={[{ label: "Bending", value: MEd, limit: MRd }, { label: "Deflection", value: delta, limit }]} />
              <CalcSheet title="Beam B1" job="J-1001" by="AB">
                <CalcRows rows={rows} />
              </CalcSheet>
              <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
                <Card><CardHeader title="Actions and effects" /><CardBody><div ref={diagrams}><BeamResults beam={beam} result={result} /></div></CardBody></Card>
                <Card><CardHeader title="Section" /><CardBody><SectionDrawing shape={{ type: "rect", b, h }} bars={bars} link={{ cover: 30, dia: 10 }} /></CardBody></Card>
              </div>
            </div>
          ),
        }]}
      />
    </>
  );
}
\`\`\`

## @ocsc/calc (apps made from a calculating workbook)
The import compiles the workbook into a model kept with the app (const MODEL in App.tsx) and checks every
formula against the results Excel saved. Keep MODEL and leave the maths to the model: never retype a
workbook formula in code, read results from cells instead.
- useCalc(MODEL) → {status, inputs, value("Sheet!B3"), text("Sheet!B3") (as Excel shows it),
  display("Sheet!B3") (text, General figures to 4 significant figures, for results), set(address, value),
  initial(address) (the workbook's value), range("Sheet!B3:B20"), options(input), reset(), changed}.
  inputs: [{address, sheetName, label, unit, kind, options, min, max, help}]. Each person's inputs are remembered
  in the personal table calc_inputs (keep it); reset() puts back the workbook's values.
- <CalcForm calc={calc} sheet="Name" title? actions?/> is a sheet as an app page: verdict banner, key-result
  cards, sections from its headings with typed fields (lists, switches, numbers with units and ranges),
  tables, the workbook's charts redrawn live in their sections, and a Print to PDF of the calculation.
  Clause references beside a row (cl 6.2.2, Equn (9.1N)) show as a badge, not in its label. Give pages only
  to the sheets people work in; reference, lookup and chart-data sheets stay in CalcDetails.
  <CalcDetails calc={calc}/> is every sheet, searchable, as the app reads it or exactly as the workbook lays it out (<CalcSheet calc={calc} sheet="Name"/>).
- Pieces for a custom page: useCalcLayout(calc, sheet) → {sections, key, statuses, checks, charts}; <CalcSummary
  calc layout/>, <CalcResult calc field/>, <CalcField calc field/>, <CalcStatus calc address/>, <CalcChart calc chart/>,
  <CalcPrintButton calc sheet/>; <CalcInputs calc sheet?/> is a plain form. KpiCard value={calc.display("Out!D9")}.
  Name a field with calcLabel(calc, field), not field.label: labels a formula writes ("Span 2") follow its result.

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

## @ocsc/ui (Tailwind classes work everywhere; use semantic tokens, never raw hex or light-only slate/white)
Layout: AppShell {title, subtitle?, icon?, actions?, commands?, active?, onNavigate?, pages: [{id, label, icon?, count?, render}], wide?} —
  frosted top bar, animated spring tabs, optional ⌘K command palette; pass active={tab} onNavigate={setTab} when KpiCards or buttons jump between tabs (never querySelector tabs). PageHeader {eyebrow?, title,
  description?, actions?}, Section {title?, description?, actions?}, Grid {cols 1-6}, Split {main, aside},
  Stagger/StaggerItem (children fade up in sequence), Hero {eyebrow?, title, description?, asset?, actions?}.
Numbers: KpiCard {label, value, format?: "number"|"currency"|"percent"|"compact" or (n) => string, currency?,
  delta? (% vs last period), deltaLabel?, downIsGood?, trend?: number[], icon?, hint?, tone?, onClick?}.
  CountUp, Sparkline, Stat, Progress {value 0-100, tone?}, Ring {value 0-100, label?}, formatNumber(value, format, currency).
  Percent scale: percent columns store 0.25 for 25%, but KpiCard/formatNumber "percent", Progress and Ring take 25;
  multiply a percent column or a ratio by 100 before passing it. Gauge takes a 0-1 ratio (or value with max).
Charts (animated, themed, few KB): AreaChart/BarChart/LineChart {data, x, series: ["fee"] or [{key, label, color?}],
  format?, stacked?, horizontal? (bar), legend?, height?}, DonutChart {data, label="label", value="value", centerLabel?},
  BarList {data, label, value, format?, onSelect?}. Helpers: byMonth(rows, dateKey, [valueKeys]) → [{month,...}],
  countBy(rows, key) → [{label, value}], sumBy(rows, field) → total or sumBy(rows, field, byKey) →
  [{label, value}], groupBy(rows, key) → Map. Never hand-roll div progress bars where BarList, DonutChart, BarChart or Gauge fits.
More charts: Gauge {value 0-1 or value+max, label?, format?, tone?, hint?} (budget used, pass rate, capacity),
  FunnelChart {data, label, value, format?, onSelect?} (enquiry → quote → won with conversion),
  ScatterChart {data, x, y, size?, groupBy?, labelKey?, xLabel?, yLabel?, xFormat?, yFormat?, onSelect?},
  CalendarHeatmap {rows, dateKey, valueKey?, weeks?=52, onSelect?(day, rows)} (activity per day),
  Heatmap {rows, x, y, valueKey?, format?, onSelect?({x, y, rows})} (office × month, discipline × stage).
Periods: PeriodFilter {value, onChange} with Period "7d"|"30d"|"90d"|"ytd"|"12m"|"all"; inPeriod(rows,
  dateKey, period) filters, periodChange(rows, dateKey, period, field?) → {value, previous, delta} feeds
  KpiCard straight away: <KpiCard label="Fees" value={fees.value} delta={fees.delta} deltaLabel="vs previous" />.
Data: TableView {table: useTable(...), columns?: ["name", "stage", {key, label, render}], filterBy?: "stage",
  formColumns?, title?, newLabel?, renderDetail?, toolbar?} — search, filter chips, sort, paging, a drawer to
  view/edit (with PresenceStack and RowActivity comments/history built in), add, delete with confirm and export.
  DataTable {rows, columns or schema, search?, filterBy?, onRowClick?} for read-only lists. CellValue {column, value}.
  RecordForm {schema, value, onChange, columns?} and RecordDetail {schema, row} (columns with hidden: true stay hidden).
Views & Lists: Kanban {rows, groupBy: "stage", orderBy? (a number column), columns?, renderCard, onMove(row, value,
  drop {index, order}), onOpen?, onAdd?(value)} — drag with mouse, press-and-hold on touch, or Alt+arrows.
  CalendarMonth {rows, dateKey, titleKey, subtitleKey?, toneKey?, defaultView?: "month"|"week"|"agenda", onOpen?}
  (built-in Month · Week · Agenda switcher), Timeline {rows, startKey, endKey, titleKey},
  ActionList {items: [{id, title, subtitle?, meta?, badge?, tone?, avatar?, icon?, actions?, onClick?}]}
  (animated interactive list with hover lift & accent bar — use for priority queues, recent items and team lists instead of raw divs),
  ActivityFeed {items: [{id, title, description?, date?, badge?, tone?, icon?, onClick?}]}. Gantt (see below) is the interactive planner.
Flows: Steps {steps: [{id, label, description?, render: () => fields, valid?}], onFinish, finishLabel?,
  onCancel?} for guided multi-step entry. Checklist {items: [{id, label, hint?, section?}], value, onChange, readOnly?}
  for inspections and audits (pass/fail/N-A, note on fail); keep in a hidden longtext column as JSON.stringify(value)
  and read with readJson(row.checks, {}); checklistSummary(items, value) → {total, answered, passed, failed, complete}.
Controls & Banners: Button {variant: "primary"|"secondary"|"outline"|"ghost"|"danger"|"link", size: "sm"|"md"|"lg"|"icon", icon?, loading?},
  Badge {tone?, dot?}, Callout {tone?, title?, icon?, action?, children} (theme-safe light/dark banner — never raw bg-amber-50),
  SampleBanner {tables: [table], label?, onCleared?} (auto-hides once is_sample rows are cleared),
  Card {interactive?} with CardHeader {title, description?, action?, icon?} and CardBody,
  Field {label, hint?, error?, children: (id) => <Input id={id}/>}, Input, Textarea, Select {options},
  SearchInput {value, onChange}, Switch, Checkbox {checked, onChange, label?}, Tabs {value, onChange, items},
  FilterChips {options, value, onChange}, Avatar {name}, AvatarStack {names}, Skeleton, EmptyState
  {icon?, title, description?, action?}, Divider, Menu {trigger, items}.
Overlays: Dialog {open, onClose, title, footer?, size?}, Drawer {open, onClose, title, footer?},
  ConfirmDialog {open, onClose, onConfirm, danger?}, toast("Saved") / toast.success / toast.error.
Pictures: AssetImage {asset, fit?}, ImageCard {asset?, title, description?, footer?}, Gallery {assets: [{id, caption?}]}
  (opens full size), Lightbox {ids, index, onIndex}, PhotoInput {value, onChange, onPhoto?, markup?, max?, label?}, Photos {value,
  size?: "sm"|"md"|"lg", limit?}.
Motion: motion from "motion/react" with motionPresets (fadeUp, fade, pop, spring), stagger.container /
  stagger.item variants, ease.
cn(...classes) merges classes, later wins.

## Design Craft (OCSC Evolve)
- Urbanist, brand green primary, light and dark both work automatically when you stick to semantic tokens.
- Tokens ONLY: bg-surface, bg-background, bg-card, bg-muted, text-foreground, text-muted-foreground, border-border,
  text-primary, bg-primary/10, chart-1..6, shadow-soft/shadow-card/shadow-lift/shadow-glow, rounded-xl/2xl.
  NEVER use bg-white, bg-slate-*, text-slate-*, bg-gray-*, blue/purple classes, black primary buttons, or raw #hex strings.
- Composition: set <Theme /> at the top; pass commands and actions (PresenceStack, PrintButton, primary CTA) on AppShell;
  give every tab an icon; lead Overview with Aurora or PageHeader, 3–4 KpiCards (with delta/trend/onClick), 2 complementary
  charts (e.g. 2fr time-series + 1fr DonutChart/BarList), and a focused SpotlightCard or priority slice.

## Phones (most people open apps in the OCSC iPhone and Android app, often on site)
Design the phone screen as carefully as the desktop one; the kit handles the basics only if you use it.
- Width: build for 360-390px first, then add sm:/md:/lg: columns. Grid, Split and AppShell stack on their
  own; never set fixed widths (w-[600px], min-w-[...]) on page content. Wide tables use TableView or sit in
  overflow-x-auto; long words and numbers get min-w-0 and truncate or break-words.
- Fingers: every control at least 40px tall (kit Button md, or size "icon"; never a bare icon in a
  span). Keep 8px between neighbouring controls. Put the main action where a thumb reaches: in the page's
  actions or a full-width Button at the end of a form.
- Reading: body text 14px or more, nothing under 12px (text-xs). Key figures first; keep a phone card to
  one idea. Kit inputs (Input, SearchInput, Select, Textarea, DatePicker, Combobox) are already 16px on
  phones and touch screens even with compact density, so never add <style> font-size !important overrides.
- Touch only: there is no hover on a phone, so never hide actions or details behind hover. Long lists
  get a SearchInput and FilterChips. Dialogs open as bottom sheets and Drawers fill the phone; keep forms in one column
  with the right input types (type="tel", "email", "number", "date"; inputMode="decimal" for amounts).
- The app sits inside the OCSC app below its header, so never add your own status-bar or notch padding
  and never use 100vh layouts or position: fixed bars; let the page scroll.
- After each save the phone check reports sideways scrolling (naming the element), fields iOS would
  zoom into, controls under 32px and text under 11px. Fix every one, then app_look with phone: true.

## Example
\`\`\`tsx
import { useMemo, useState } from "react";
import {
  ActionList, AppShell, AreaChart, Aurora, Badge, BarList, Card, CardBody, CardHeader, DonutChart,
  Gantt, Grid, Kanban, KpiCard, PageHeader, PeriodFilter, PresenceStack, PrintButton,
  Progress, SampleBanner, SpotlightCard, TableView, Theme, byMonth, countBy,
  formatNumber, inPeriod, periodChange, sumBy, toast, type Period,
} from "@ocsc/ui";
import { useTable } from "@ocsc/app";
import { Briefcase, CalendarClock, Euro, GanttChart, Gauge, KanbanSquare, LayoutDashboard, Table2 } from "lucide-react";

const STAGES = ["Pipeline", "Design", "Tender", "Construction", "Complete"];

export default function App() {
  const jobs = useTable("jobs");
  const [period, setPeriod] = useState<Period>("12m");
  const [tab, setTab] = useState("overview");
  const scoped = useMemo(() => inPeriod(jobs.rows, "start", period), [jobs.rows, period]);
  const live = jobs.rows.filter((r) => r.stage !== "Complete");
  const fees = periodChange(jobs.rows, "start", period, "fee");
  const monthly = useMemo(() => byMonth(scoped, "start", ["fee"]), [scoped]);
  const avgProgress = live.length ? (sumBy(live, "progress") / live.length) * 100 : 0;

  return (
    <>
      <Theme preset="crisp" density="comfortable" />
      <AppShell
        title="Portfolio Delivery"
        subtitle="Dublin & Cork engineering programmes"
        active={tab}
        onNavigate={setTab}
        commands={[
          { id: "go-board", label: "Open stage board", group: "Workflow", run: () => setTab("board") },
          { id: "go-programme", label: "Open Gantt programme", group: "Workflow", run: () => setTab("programme") },
        ]}
        actions={
          <>
            <PresenceStack />
            <PrintButton
              size="sm"
              document={() => ({
                title: "Portfolio Delivery Summary",
                kind: "PORTFOLIO REPORT",
                blocks: [
                  { type: "stats", items: [{ label: "Live jobs", value: String(live.length) }, { label: "Fees", value: formatNumber(sumBy(live, "fee"), "currency") }] },
                  { type: "table", columns: ["Job", "Client", "Stage", { label: "Fee", align: "right" }], rows: live.map((r) => [String(r.name ?? ""), String(r.client ?? ""), String(r.stage ?? ""), formatNumber(Number(r.fee ?? 0), "currency")]) },
                ],
              })}
            />
          </>
        }
        pages={[
          {
            id: "overview",
            label: "Overview",
            icon: <LayoutDashboard />,
            render: () => (
              <div className="flex flex-col gap-5">
                <SampleBanner tables={[jobs]} />
                <Aurora className="rounded-2xl border border-border/70 bg-card p-5">
                  <PageHeader
                    className="mb-0"
                    eyebrow="Engineering Portfolio"
                    title="Delivery & fee performance"
                    description="Live stages, fee velocity and milestone readiness across active commissions."
                    actions={<PeriodFilter value={period} onChange={setPeriod} />}
                  />
                </Aurora>
                <Grid cols={4}>
                  <KpiCard label="Live commissions" value={live.length} icon={<Briefcase />} hint="Click to open board" onClick={() => setTab("board")} />
                  <KpiCard label="Booked fees" value={fees.value} format="currency" delta={fees.delta} deltaLabel="vs prior period" icon={<Euro />} trend={monthly.map((m) => Number(m.fee ?? 0))} />
                  <KpiCard label="Average progress" value={avgProgress} format="percent" icon={<Gauge />} tone="success" />
                  <KpiCard label="In construction" value={live.filter((r) => r.stage === "Construction").length} icon={<CalendarClock />} tone="info" onClick={() => setTab("programme")} />
                </Grid>
                <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
                  <Card><CardHeader title="Fee profile by start month" description="Committed fees across the selected window" /><CardBody><AreaChart data={monthly} x="month" series={[{ key: "fee", label: "Fee" }]} format="currency" /></CardBody></Card>
                  <Card><CardHeader title="Commissions by stage" description="Current delivery balance" /><CardBody><DonutChart data={countBy(jobs.rows, "stage")} centerLabel="Jobs" /></CardBody></Card>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card><CardHeader title="Fee concentration by client" /><CardBody><BarList data={sumBy(live, "fee", "client").slice(0, 6)} format="currency" /></CardBody></Card>
                  <Card><CardHeader title="Priority commissions" description="Click any commission to inspect the schedule" /><CardBody><ActionList items={live.slice(0, 4).map((r) => ({ id: r._id, title: String(r.name ?? "Untitled"), subtitle: String(r.client ?? "OCSC"), badge: String(r.stage ?? "Live"), meta: formatNumber(Number(r.fee ?? 0), "currency"), onClick: () => setTab("programme") }))} /></CardBody></Card>
                </div>
                <SpotlightCard className="p-5" onClick={() => setTab("programme")}>
                  <p className="text-xs font-bold tracking-wider text-primary uppercase">Programme Watch</p>
                  <p className="mt-1 text-base font-bold">Interactive Gantt schedule</p>
                  <p className="mt-1 text-sm text-muted-foreground">Drag bars to re-sequence dates and inspect stage progress across every commission.</p>
                </SpotlightCard>
              </div>
            ),
          },
          {
            id: "board",
            label: "Board",
            icon: <KanbanSquare />,
            render: () => (
              <Kanban
                rows={jobs.rows}
                groupBy="stage"
                columns={STAGES.map((value) => ({ value }))}
                onMove={jobs.canEdit ? (row, stage) => void jobs.update(row._id, { stage }).catch(() => toast.error("Not moved")) : undefined}
                renderCard={(row) => (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold">{String(row.name ?? "Untitled")}</p>
                      <Badge tone="accent">{String(row.client ?? "OCSC")}</Badge>
                    </div>
                    <Progress value={Number(row.progress ?? 0) * 100} />
                    <span className="text-xs font-semibold tabular text-muted-foreground">{formatNumber(Number(row.fee ?? 0), "currency")}</span>
                  </div>
                )}
              />
            ),
          },
          {
            id: "programme",
            label: "Programme",
            icon: <GanttChart />,
            render: () => (
              <Card>
                <CardHeader title="Commission programme" description="Drag bars or bar ends to adjust dates." />
                <CardBody>
                  <Gantt
                    rows={live}
                    startKey="start"
                    endKey="due"
                    titleKey="name"
                    groupKey="stage"
                    progressKey="progress"
                    toneKey="stage"
                    onChange={jobs.canEdit ? (row, dates) => void jobs.update(row._id, dates) : undefined}
                  />
                </CardBody>
              </Card>
            ),
          },
          {
            id: "jobs",
            label: "Register",
            icon: <Table2 />,
            count: jobs.rows.length,
            render: () => <TableView table={jobs} filterBy="stage" newLabel="New commission" />,
          },
        ]}
      />
    </>
  );
}
\`\`\`
`;
