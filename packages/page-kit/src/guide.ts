/** Returned by save_page {"help": true}, so ordinary turns do not pay for it. */
export const PAGE_KIT_GUIDE = `# Pages

Pages are for one-off reports and briefings. If the person wants an app, tool, tracker, register, dashboard or form, stop and build it with save_app instead (live tables, Studio editing, data and code views).

A page is a small app: JSX source whose default export is a React component. It renders in an isolated viewer in the user's light or dark theme, prints cleanly, keeps what its readers save, and can be shared with staff or, with a password, with anyone. Build something people use every week, not a static report.

## Build an app, not a report
Before writing, decide in one line each: who uses it, what they do here (find, check, tick off, plan, compare, estimate), which 2 to 4 views that needs, and what they change. Then build it so:
- The first screen answers the main question: Metrics or a toned Callout computed from the data (useMemo), never typed in by hand.
- Views switch with Segmented along the top; each tab shows a count when it is a list ({value, label, count}).
- Lists can be searched and narrowed: an Input type="search" plus a Select or Segmented filter in the Section actions, filtering in useMemo. Show "No jobs match" style empty states (a short Text or Callout), never a blank card.
- Rows open detail: Table or Rows with onSelect and selected; the picked item's detail (Properties, Checklist of Toggles, notes, actions) sits beside the list in a Grid columns={2} on wide pages, or below it on column pages. A table beside a detail panel keeps to 3 or 4 short columns; the rest goes in the detail. Pick the first item by default so the detail is never empty.
- What people change is kept with usePageState: ticks, statuses, owners, notes, added items, chosen filters worth remembering. Show "Saved" or "Only for this visit" from its status where it matters.
- Data that changes lives in useSource snapshots so a routine can refresh it without touching the code; everything else is derived from it.
- Forms are an Input or Select per field and one primary Button that adds or saves; clear the inputs after adding.
- Calculators and estimators update live as inputs change and show the result as Metrics.
- Give it a purposeful title and a one-line summary naming the data and when it was read.

## Rules
- Everything below is already in scope: React, Fragment, useState, useMemo, useEffect, useRef, useCallback, useReducer, the kit components and its helpers. Imports are optional; only "react" and "rakazo/page" (the kit) are allowed. No require, network or CSS files.
- Exactly one \`export default\` (your top component). Helper components and data objects in the same file are fine.
- Do not name your own component after a kit component (Page, Status, Table, Rows...): it replaces the kit's in the whole file, so using that kit component inside it renders itself forever, and the check refuses it. Call it StatusPage, BotTable and so on.
- Gather data first and keep it in one object at the top. Write figures already formatted ("$12,400", "4.8%") and write plain characters, not HTML escapes ("<800ms", not "&lt;800ms").
- Plain HTML and SVG elements (div, span, svg, path, rect, circle, text, linearGradient, animate...) with style={{...}} are allowed for custom visuals; take colours from useTheme() so they match both themes. script, style, iframe, object, embed and foreignObject are not allowed, and handlers are functions, never strings. Images are data: URIs only.
- Save with save_page {title, source}. To change it later, pass the pageId you got back with edits [{find, replace}] (all apply or none do) or the whole new source; pass only pageId to read the current source and what readers saved (state).
- To refresh the figures (a routine's job), pass pageId with data {sourceId: newSnapshot}: only those snapshots change, stamped with the save time, and the code and readers' saved state stay as they are.

## Design rules (OCSC / Evolve branding)
Pages must look like Evolve (the OCSC CV Generator app), not a generic AI dashboard. Every page already shows an OCSC brand mark in brand green above the title — keep that feel through the rest of the layout.
- Type: Urbanist is already the kit font. Do not set fontFamily to Inter, Roboto, Arial or a system stack, and do not load fonts from the web.
- Colour: use kit components and useTheme() only. Brand green is primary (fill.primary, Button variant="primary", Status/Callout tone="accent" or "success", chart series). Links and info accents are green too. No hex colours, no purple/indigo/blue marketing themes, no gradients or glows, no emoji as icons or bullets. Tones (success, warning, danger, info) are for meaning, not decoration. Never paint a full-bleed grey banner with bg.subtle / muted fills; use Callout (with tone) instead.
- Light and dark: the viewer follows the reader's theme. Always take colours from useTheme() for custom SVG/HTML so both modes work; never hard-code white/black backgrounds.
- Layout: section menus and view switches go along the top with Segmented (muted pill tabs with a green selected state, like Evolve's feature tabs). Evolve already has a left drawer outside the page — do not invent a side navigation rail. Put Segmented in the first Section's actions (or just under the title) so the top of the page reads as the menu.
- Tables: always use the kit Table with columns as string[] and rows as cell[][] (e.g. columns={["Project","Stage"]} rows={[["W407","Stage 5"]]}). Do not pass {key,label} column objects or row objects, and do not hand-roll HTML <table> or div grids that look like tables.
- Dashboards: use width "wide". Top-level headed Sections are bordered cards automatically on wide/full pages. Prefer kit Input/Select/Button (variant="primary" for the main action) over raw <input>/<select> styled by hand.
- Show, don't narrate: pick the richest component that fits the data. Numbers become Metrics, trends a LineChart, comparisons Bars, shares a Pie, flows a Diagram, sequences Steps, options ProsCons, statuses toned Status pills. A paragraph is for the one thing a visual cannot say.
- Lead with the answer: a Callout (lead + tone) or Metrics first, evidence below. The reader should get the point in two seconds.
- Long pages (five or more sections) start with a TableOfContents whose ids match the Section ids. Number sections in reading order when the order matters.
- Avoid walls of text and walls of identical cards: mix open sections, a Grid of two or three cells and one or two tables. Break prose into BulletList / NumberedList items.
- Every chart sits in a Section with a heading and, when useful, a caption naming the unit, the period and the source. Omit a section rather than show empty data or placeholder text.
- A LineChart axis starts at 0 unless floor is set: for a narrow range (3.05% to 3.41%) set floor and ceiling just around the data. Chart series take palette colours in order, never tones; to make a part mean "failed", put that colour first with Page palette (from useTheme).
- Custom SVG with text gets a fixed width and height plus style={{maxWidth: "100%"}}; a small viewBox at width "100%" scales its text with the page.
- End research with LinkCards of the sources (site and date), after a Divider.

## Recipes
- Register or tracker app (width "wide"): Metrics computed from the data -> Section "Jobs" with search Input and a status Segmented in actions -> Grid columns={2}: Table with onSelect on the left, the selected job's Properties, a Checklist of Toggles kept with usePageState and a notes Input on the right.
- Planner or board: Segmented for the week or stage -> Grid columns={3} of Sections (To do, In progress, Done), each a Rows list; a Button per row moves it, kept with usePageState -> MonthView for dates.
- Calculator or estimator: Inputs and Selects on one side, live Metrics and a Bars breakdown on the other, a CopyButton for the result.
- Dashboard (width "wide"): first Section with Segmented view switch in actions -> Metrics -> kit Table (columns string[], rows cell[][]) with toned Status cells and Button variant="primary" for open actions -> Callout for priority notes -> more Sections for detail.
- Report or research dossier: TableOfContents -> Callout summary (lead + tone) -> numbered Sections, each a short Text plus a Table, Bars or BulletList -> Quote for primary evidence -> ProsCons for trade-offs -> Divider -> LinkCards (numbered) of sources -> Footnote for method notes.
- Tracker: Metrics of progress -> Checklist or Rows with Status -> Steps for what is next -> Properties for owners and dates.
- Plan: Callout with the goal -> Steps or a Diagram of the phases -> Table of milestones with Status -> NumberedList of open questions.
- Long reference: TableOfContents -> collapsible Sections (collapsible, defaultOpen for the first) so the reader opens what they need.

## Components
Text props and list items accept **bold**, *italic* or _italic_, \`code\` and bare https:// or www. links. Tones: "success" | "warning" | "danger" | "accent" | "info".

### Structure
- Page {title, summary?, width?: "column" | "wide" | "full", lang?, palette?: [colour], sources?: [url]}: the page. "column" (default) for reading, "wide" for dashboards; palette replaces the first chart colours; sources become a footer of links. lang is the content's language tag ("fr", "he"); the kit's own buttons, empty states, dates and numbers follow it, and Hebrew or Arabic read right to left. A PageHero given first sits above the title.
- PageHero {eyebrow?, eyebrowMark?}: a small label and any art above the title. PageMeta: a byline or date line. Footnote: a small trailing note.
- Section {heading?, id?, caption?, actions?, collapsible?, defaultOpen?}: a block with a heading; nesting steps the heading down a level; inside a Grid it becomes a card. id (else the heading) is the anchor a TableOfContents links to. caption sits under the first table or chart, else under the first block. actions sits on the heading line (put a Segmented there). collapsible folds it behind its heading, closed unless defaultOpen.
- TableOfContents {items: [{label, id, depth?}], title?}: "On this page" links that follow the reader's position; long lists fold, phones get a compact menu.
- Grid {columns}: side by side (1 to 4 columns); stacks on phones.
- Divider: a hairline between parts. Floating {edge?: "bottom" | "top", align?: "start" | "center" | "end", bar?}: a row of controls pinned while scrolling. BackToTop {label?}: a button back to the top.

### Text and lists
- Text: a paragraph. Callout {lead?, tone?}: a tinted note; children are the body.
- Quote {cite?}: a quotation with its source.
- BulletList {items, marker?: "pro" | "con"} and NumberedList {items}: an item is a string or {text, items?} for a nested list.
- ProsCons {pros, cons, prosHeading?, consHeading?}: two cards of plus and minus points.
- LinkCards {links: [{title, href, site?, date?}], numbered?}: a list of sources or related pages; the site defaults to the link's address.
- Legend {names: [string], comparison?: [index], dots?}: series names in chart colours, for a custom visual; comparison lists indexes of names drawn as grey dashed lines.

### Math
- Equation {label?}: a centred formula; children are terms. Frac {num, den}, Pow {base, exp}, Sqrt, Sum {from?, to?, sign?}, Paren {open?, close?}. Example: <Equation label="Break-even">Sales = <Frac num="fixed costs" den="margin" /></Equation>.

### Data
- Metrics {metrics: [{value, label, detail?, tone?, delta?, better?, trend?}]}: headline numbers, up to four a row; tone colours the detail. delta ("+12%" or -3) adds an up or down mark, green when it moves the good way (better: "up" default, or "down" for churn and cost); trend (numbers) adds a small line under the figure.
- Properties {items: [{label, value}]}: label and value pairs; value may be a Status.
- Status {tone?}: a short status word in a tinted pill, e.g. <Status tone="success">Shipped</Status>; tone "neutral" or none is grey.
- Rows {rows: [{title, lead?, detail?, meta?, status?: {label, tone}}], onSelect?: (index) => void, selected?: index}: a list; lead sits in a narrow column before the title, the status follows the title in its tone, meta sits at the right. With onSelect rows can be clicked or picked with Enter, and selected highlights one in green.
- Steps {steps: [{title, detail?}]}: a numbered sequence. Checklist {items: [{text, done, meta?}]}: read-only progress.
- Table {columns: string[], rows: cell[][], align?: ("auto" | "start" | "end" | "center")[], emphasis?: column, sortable?: boolean, onSelect?: (index) => void, selected?: index}: a cell is text, a number, {text, tone?} or a Status. Figures and single short words align to the end. Wide tables scroll sideways; long ones get a filter box and a sticky header; sortable makes headers sort. onSelect makes rows clickable and gets the row's index in rows (whatever the sort); selected highlights that row. Filter rows yourself and keep an index back to your data so selection follows it.

### Charts
- LineChart {points: [{label, value}], floor?, ceiling?, unit?, format?: (n) => string, labels?: [seriesName], lines?: [{label, values}], secondary?: {label, values}, annotations?: [{at: index | "zero", label}], legend?}: a trend; one series gets an area fill, lines add series, secondary adds a grey dashed comparison. A missing value leaves a gap.
- Bars {bars: [{label, value, display?}], emphasis?: index | "none"}: horizontal bars; the longest is highlighted unless you choose. Negative values draw red.
- Columns {points: [{label, value, display?}], emphasis?}: vertical columns with their value on top, for a few periods or categories; values are 0 or more, so chart losses or other negatives with Bars.
- ColumnSeries {labels: string[], series: [{name, values}], stacked?, unit?, format?, ceiling?, reference?: {value, label}, legend?}: several series per label, side by side or stacked.
- StackedBars {series: string[], bars: [{label, values, display?}]}: one horizontal bar per row split into named parts.
- Pie {parts: [{label, value, display?}], total?: true | text, label?}: a donut of the parts of one whole, listed with their share; total puts the sum (or your text) in the middle over label.
- Scatter {points: [{x, y, size?, label?, series?}], x?: {name, unit, format, floor, ceiling}, y?: {...}, size?: {name}, trend?, legend?}: two measures against each other; trend draws a fitted line and labels points far off it.
- Heatmap {rows: string[], columns: string[], values: number[][], max?}: a grid shaded by value, such as weekday by hour.
- CalendarHeatmap {days: [{date: "YYYY-MM-DD", value}], from?, to?, max?, note?}: daily activity in week columns.
- Venn {sets: [{label, count?, items?}], overlap?}: two or three overlapping groups.
- Matrix2x2 {axes: {x: [low, high], y: [low, high]}, quadrants: [topLeft, topRight, bottomLeft, bottomRight], points: [{label, x, y}]}: items placed from 0 to 1 on two axes.
- SourceStamp {source}: when data was read, "As of Oct 30, 2026" for a snapshot or "Updated 3 min ago" when live.
- Diagram {nodes: [{id, label, detail?, kind?: "box" | "terminal", series?: 0..4}], edges: [{from, to, label?, dashed?}], direction?: "vertical" | "horizontal"}: a flow laid out automatically.
LineChart, Columns, ColumnSeries, Scatter, Heatmap and CalendarHeatmap show exact values on hover and with the arrow keys once focused; Bars, Pie, StackedBars, Venn, Matrix2x2 and Diagram print theirs, so put every figure a reader needs in their labels or display text. Give each a Section heading and say the unit in the heading, caption or unit prop.

### Controls
- Segmented {options: (string | {value, label, count?})[], value, onChange}: tabs for switching views. Wraps onto more lines; the chosen tab always shows.
Keep each control's value in useState. A control placed straight in a Section or Grid is compact; inside your own element it is full size.
- Button {label, onClick, variant?: "quiet" | "primary", disabled?}: one primary per group.
- Select {label?, options: [{value, label}], value, onChange, placeholder?, disabled?}. Input {label?, value, onChange, placeholder?, type?: "text" | "number" | "search"}.
- Toggle {label, value, onChange, disabled?}. Checkbox {label, value}: shows a recorded yes or no; the reader cannot change it, so things the reader ticks off are Toggles. A number the reader steps (servings, quantity) is a row of Button "−", the value and Button "+". Input has no Enter or submit event: act on onChange, or put a Button beside it.
- LinkButton {label, href, variant?: "button" | "text"} and TextLink {href, children}: web or mail links, opened by the app.
- CopyButton {label, text?, copiedLabel?}: copies text (else the label) and shows "Copied"; where copying is blocked it shows the text to select. For your own copy buttons call copyText(text), which resolves true once copied; navigator.clipboard is blocked in pages.
- ReplyButton {label, reply?}: puts reply (or the label), up to 300 characters, in the chat's message box for the reader to send. It is inactive where there is no chat, such as a shared page.

### Media
Pictures, sound and video must be embedded as data: URIs (a blob: the page makes itself also works for sound and video); web addresses never load and the component is left out.
- Image {src, alt, caption?, fit?: "cover" | "contain", width?, height?, ratio?: number | "16/9"}: click to enlarge.
- Gallery {photos: [{src, alt}], height?}: up to 8 photos the reader swipes or steps through.
- PhotoStrip {items: [{image, alt?, title?, price?, note?, href?}], tileWidth?, imageHeight?}: a sideways row of small cards.
- Video {src, alt, poster?, caption?, autoplay?, loop?, controls?, ratio?} and Audio {src, alt, caption?, loop?}.

### Calendar
Dates are "YYYY-MM-DD"; times are hours as numbers (13.5 is 1:30 PM). Mark an event selected for the one that matters, free for open time.
- MonthView {month: "YYYY-MM", events: [{date, title, free?, selected?}], today?}: busy days fold into "+N more".
- WeekView {week: first day, start?, end?, events: [{date, start, end, title, free?, selected?}], today?, now?: hour}.
- DayView {start?, end?, events: [{start, end, title, free?, selected?}], mark?: {at: hour}}: events before the mark are crossed out.

### Cards and people
- ProductCard {title, href?, image?, price?, note?, badge?, store?, rating?, reviews?, compact?}: put several in a CardGrid {label?} (a grid) or CardCarousel {label?} (a row that scrolls on phones).
- ProductRows {items: [same fields]}: products as one list card. RatingSummary {rating: 0 to 5, reviews?}.
- WatchCard {title, detail?, label?, reply}: offers to have the bot keep watch, through the chat like ReplyButton.
- Avatar {name, size?, neutral?} and AvatarStack {people: [name or {name}], max?, label?}: initials in a circle; extra people fold into "+N".

### Helpers
- useTheme(): the current theme as values for custom elements: {kind, bg {base, subtle, elevated}, text {primary, secondary, tertiary, accent, success, warning, danger, ...Deep}, fill, border, font, weight, radius, motion, dataviz {categorical, sequential, diverging, other, negative}}. It follows the reader's light or dark mode.
- computeDAGLayout(nodes, edges, {direction?}): the Diagram's layout, for drawing your own flow.
- useSource(id): reads a snapshot declared in a comment that opens the file: "/* page-sources" on the first line, then a JSON object such as {"jobs": {"snapshot": [...], "asOf": "2026-10-30"}}, then "*/". useSource returns {value, asOf}; put asOf in a SourceStamp {source} so readers see when it was read. save_page with data replaces a snapshot, so keep each source's shape stable. SourceStamp also takes a hand-written {asOf}.
- usePageState(key, initial): like useState, but kept with the page and shared by everyone who opens it: [value, setValue, status]. setValue takes a value or (current) => next. Keys are short names ("done", "notes:W407"); values are plain JSON under 64 KB. status is {ready, canSave, saving, failed}: canSave is false in previews and for readers who opened a shared link with its password, whose changes last for their visit only. Keep state keyed by stable ids (job numbers), not list positions.

## Example
/* page-sources
{"jobs": {"snapshot": [{"id": "W407", "name": "Clonmel Road", "lead": "Aoife K", "stage": "Stage 4", "due": "2026-11-20", "peer": true, "dra": false}, {"id": "W412", "name": "Harbour Quay", "lead": "Shaun D", "stage": "Stage 3", "due": "2026-12-04", "peer": false, "dra": false}, {"id": "W388", "name": "Mill Lane", "lead": "Keith M", "stage": "Stage 5", "due": "2026-11-14", "peer": true, "dra": true}], "asOf": "2026-11-11T08:00:00Z"}}
*/
const CHECKS = [
  { key: "peer", label: "Peer review done" },
  { key: "dra", label: "Design risk assessment" },
  { key: "psdp", label: "PSDP signed" },
];

function ProjectQa() {
  const { value: jobs, asOf } = useSource("jobs");
  const [ticks, setTicks, saved] = usePageState("ticks", {});
  const [notes, setNotes] = usePageState("notes", {});
  const [view, setView] = useState("open");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(jobs[0]?.id);
  const [draft, setDraft] = useState("");
  const done = (job, key) => ticks[job.id]?.[key] ?? job[key] === true;
  const complete = (job) => CHECKS.every((check) => done(job, check.key));
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return jobs.filter((job) =>
      (view === "all" || (view === "open") !== complete(job)) &&
      (!needle || \`\${job.id} \${job.name} \${job.lead}\`.toLowerCase().includes(needle)));
  }, [jobs, view, query, ticks]);
  const open = jobs.filter((job) => !complete(job)).length;
  const job = jobs.find((item) => item.id === picked) ?? shown[0];
  const tick = (key, value) =>
    setTicks((current) => ({ ...current, [job.id]: { ...current[job.id], [key]: value } }));
  return (
    <Page title="Project QA" summary="Peer review, design risk and PSDP status for my projects." width="wide">
      <Metrics metrics={[
        { value: String(open), label: "Need attention", tone: open ? "warning" : "success", detail: open ? "Checks outstanding" : "All clear" },
        { value: String(jobs.length - open), label: "Fully checked" },
        { value: String(jobs.length), label: "Projects" },
      ]} />
      <Section heading="Projects" actions={<Segmented value={view} onChange={setView} options={[
        { value: "open", label: "Open", count: open },
        { value: "all", label: "All", count: jobs.length },
      ]} />}>
        <Input type="search" placeholder="Search job, name or lead" value={query} onChange={setQuery} />
        <Grid columns={2}>
          {shown.length ? (
            <Table
              columns={["Job", "Project", "QA"]}
              rows={shown.map((item) => [item.id, item.name, complete(item) ? <Status tone="success">Done</Status> : <Status tone="warning">Open</Status>])}
              onSelect={(index) => setPicked(shown[index].id)}
              selected={shown.findIndex((item) => item.id === job?.id)}
            />
          ) : (
            <Callout tone="success" lead="Nothing outstanding">Every project here has its checks done.</Callout>
          )}
          {job ? (
            <Section heading={\`\${job.id} \${job.name}\`} caption={saved.canSave ? "Ticks and notes are saved for everyone" : "Changes last for this visit"}>
              <Properties items={[{ label: "Lead", value: job.lead }, { label: "Stage", value: job.stage }, { label: "Due", value: job.due }]} />
              {CHECKS.map((check) => (
                <Toggle key={check.key} label={check.label} value={done(job, check.key)} onChange={(value) => tick(check.key, value)} />
              ))}
              <Input label="Add a note" value={draft} onChange={setDraft} placeholder="e.g. DRA booked for Friday" />
              <Button variant="primary" label="Add note" disabled={!draft.trim()} onClick={() => {
                setNotes((current) => ({ ...current, [job.id]: [...(current[job.id] ?? []), draft.trim()] }));
                setDraft("");
              }} />
              <BulletList items={notes[job.id] ?? []} />
            </Section>
          ) : null}
        </Grid>
        <SourceStamp source={{ asOf }} />
      </Section>
    </Page>
  );
}

export default ProjectQa;
`;
