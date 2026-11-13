/**
 * The newer kit pieces and the size budget, appended to the App Studio guide that save_app
 * {help: true} returns. Kept apart from guide.ts so each can change without the other.
 */
export const APP_KIT_GUIDE_EXTRAS = `## More of @ocsc/ui
Look: <Theme preset? green? radius? density?/> once at the top of App (renders nothing; light and dark both
  follow). preset "evolve" (default) | "crisp" (white, firm lines: registers, finance) | "soft" (warm stone,
  rounder: people, onboarding) | "forest" (green-tinted neutrals: sustainability, sites) | "contrast" (site
  tablets, bright rooms). green "ocsc"|"emerald"|"lime"|"teal"|"moss" (greens only), radius
  "none"|"sm"|"md"|"lg"|"xl", density "compact" (dense tables)|"comfortable"|"spacious".
Shell: pages are always tabs along the top of AppShell. Never build a menu, rail or navigation column down
  the left (or right) side, whatever the number of pages; group pages or use ⌘K instead. commands adds ⌘K search over the pages — pass [{id, label, group?, hint?, icon?,
  keywords?, shortcut?, run}] to add records and actions ("New project", each client). CommandPalette
  {commands, open?, onOpenChange?} and useHotkey("n", fn) work on their own too.
Pickers (inside Field pass the id: {(id) => <DatePicker id={id} …/>}): DatePicker {value "YYYY-MM-DD"|"",
  onChange, min?, max?}, DateRangePicker {value {from, to}|null, onChange} with quick ranges (last 7 days,
  this month, this quarter), Combobox {options: string[] or [{value, label?, hint?, icon?}], value, onChange,
  multiple?, onCreate?} — searchable, accent-insensitive; use it instead of Select past ~8 options (people,
  projects, clients). Slider {value, onChange, min?, max?, step?, label?, format?}. Popover {trigger,
  children or (close) => …, align?} for any floating panel; Tooltip {content} for icon buttons.
Content: Accordion {items: [{id, title, content, icon?, hint?}], multiple?, defaultOpen?} (FAQs, sections),
  Carousel {children, autoPlay?, slideClassName?} (photos, highlights), SortableList {items, onReorder,
  getKey, render} (drag to set priorities or running order; save the new order), Markdown {children: text}
  renders ai.ask answers and notes safely (headings, lists, tables, links), Typewriter {text, markdown?}
  types an answer out as it arrives.
Effects (sparingly: one or two per screen): Aurora (soft moving green light behind a hero or header),
  TextReveal {text, as?, gradient?} (headline words blur in), SpotlightCard (light follows the pointer),
  GlowCard (turning green border for the one thing to notice), BentoGrid + BentoCard {size "1x1"|"2x1"|"1x2"|
  "2x2"|"3x1", title, description?, icon?, background?, onClick?} for overview tiles, Marquee {children,
  speed?} (client logos, live highlights), Reveal {delay?} (fade up on first scroll into view), celebrate()
  (confetti for a won tender or finished checklist). Utilities: bg-dots, bg-grid, text-gradient, glass.
Maps: MapView {markers: [{id?, lat, lon, label?, tone?, detail?}], lines?: [{points: [[lat, lon]…], tone?,
  dashed?}], areas?: [{points, tone?}], center?: [lat, lon], zoom?, mapStyle? "auto" (light/dark with the
  theme) | "streets" | "satellite" | "terrain", height?, selected?, onSelect?(marker), onMapClick?([lat, lon]),
  cluster?} for sites, inspections, projects and visits by place: drag, scroll or pinch, pins open a card with
  detail, many pins group into numbers, a switcher offers satellite and terrain. Free tiles (OpenStreetMap,
  Esri, OpenTopoMap) the host fetches: no keys, no cost, a few KB. PlaceSearch {onPick(place {label, lat, lon})}
  finds addresses, Eircodes and postcodes; maps.find(query) from @ocsc/app does it in code (geocode a new
  row's address when it is saved; set center to the picked place to fly there). Keep lat and lon as number columns. Never import a map library or use
  a picture of a map.

## Together, live and at scale (@ocsc/app and @ocsc/ui)
Live: everyone sees each other's saves within a couple of seconds; only the changed rows travel.
Presence: <PresenceStack/> shows the faces of others who have the app open (put it in AppShell actions);
  usePresence() → {others: [{id, name, focus}], me}. useFocus(table, rowId) while a row is open tells
  others which row you are on; <PresenceStack table="jobs" rowId={id}/> shows who else is on it.
Comments and history: <RowActivity table="jobs" rowId={id} schema={schema}/> gives a row a comment thread
  and a timeline of who changed what (old → new). Or the parts: <Comments table rowId/>, <RowHistory table
  rowId schema?/>, useComments(table, rowId) → {comments, add(body), remove(id), canComment},
  useCommentCounts(table) → {rowId: n} for badges, useRowHistory(table, rowId) → {changes}. TableView adds
  them to its drawer, with presence, on its own. Visitors with only the password read but do not comment.
Large tables: mark a big table schema {large: true} (thousands of rows: registers, logs, transactions).
  Its rows are not sent to the page (useTable gives rows [] and count); the server searches, filters, sorts
  and pages instead. TableView handles it on its own. In custom screens: useRows(table, {search?, filters?:
  [{column, op: "eq"|"ne"|"lt"|"lte"|"gt"|"gte"|"contains"|"in"|"empty"|"filled", value?}], sort?: {column,
  dir}, page? (0-based), pageSize? ≤200}) → {rows, total, pages, loading}; useAggregate(table, {filters?,
  groupBy?, bucket? "day"|"week"|"month"|"year", metrics: [{op: "count"|"sum"|"avg"|"min"|"max", column?,
  as?}]}) → {groups: [{key, values}], total} for KPIs and charts. Both stay live. They work on small tables
  too.
Evolve data: evolve.available() / await evolve.read(tool, args) or useEvolve(tool, args) → {data, loading,
  error, refresh} read OCSC Evolve records (projects, deadlines, people…) with read-only tools, as the person
  viewing, so each sees only what Evolve lets them see. Only the owner's own apps may in Evolve. When a
  colleague opens an app that shows them Evolve data, that copy stops saving, commenting and opening links
  until reopened, so keep Evolve screens read-only and put editing on other pages.
Free data (no keys, no cost): services.weather(lat, lon, days?) → {current, days: [{date, max, min, rain,
  rainChance, wind, summary}]}, services.rates(base?, to?) → {date, rates} (ECB), services.holidays(country?,
  year?) → [{date, name, regions}]; useService(() => services.weather(lat, lon), [lat, lon]) → {data,
  loading}. services.available() is false for visitors.

## Size
Apps load on phones on site, so keep them light. The kit charts are drawn in-house in a few kilobytes:
importing recharts yourself adds about 380 KB, so only do it for a chart the kit truly lacks (say why).
Keep data in tables, not in code. save_app reports the app's size and what makes it heavy when it is large.`;
