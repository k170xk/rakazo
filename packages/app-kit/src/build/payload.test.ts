import { describe, expect, it } from "vitest";
import { APP_KIT_GUIDE_EXTRAS } from "../guide-extras.js";
import { bundleWeight, buildApp } from "./index.js";

const CHARTS = `
import { AppShell, AreaChart, BarChart, DonutChart, LineChart, ScatterChart } from "@ocsc/ui";
const data = [{ m: "Jan", a: 1, b: 2 }, { m: "Feb", a: 3, b: 1 }];
export default function App() {
  return (
    <AppShell title="Charts">
      <AreaChart data={data} x="m" series={["a", "b"]} stacked legend />
      <BarChart data={data} x="m" series={["a"]} horizontal />
      <LineChart data={data} x="m" series={["b"]} />
      <DonutChart data={[{ label: "x", value: 1 }]} />
      <ScatterChart data={data} x="a" y="b" />
    </AppShell>
  );
}`;

describe("app payload", () => {
  it("draws the kit charts without bundling recharts", async () => {
    const built = await buildApp({ "App.tsx": CHARTS });
    expect(built.ok ? [] : built.errors).toEqual([]);
    if (!built.ok) return;
    expect(built.weight.map((item) => item.part)).not.toContain("recharts");
    expect(built.bytes).toBeLessThan(600_000);
  }, 30_000);

  it("reports recharts when an app imports it directly", async () => {
    const built = await buildApp({
      "App.tsx": 'import { LineChart, Line } from "recharts";\nexport default function App() { return <LineChart width={300} height={200} data={[]}><Line dataKey="v" /></LineChart>; }',
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const recharts = built.weight.find((item) => item.part === "recharts");
    expect(recharts?.kb).toBeGreaterThan(150);
  }, 30_000);

  it("generates CSS only for the kit components an app uses", async () => {
    const plain = await buildApp({ "App.tsx": 'export default function App() { return <div className="p-4">Hi</div>; }' });
    const marquee = await buildApp({
      "App.tsx": 'import { Marquee } from "@ocsc/ui";\nexport default function App() { return <Marquee><span>Dublin</span></Marquee>; }',
    });
    expect(plain.ok && marquee.ok).toBe(true);
    if (!plain.ok || !marquee.ok) return;
    expect(plain.css.length).toBeLessThan(15_000);
    expect(plain.css).not.toContain("@keyframes marquee");
    expect(plain.css).not.toContain(".glass");
    expect(marquee.css).toContain("@keyframes marquee");
  }, 30_000);

  it("groups bundle bytes by what pulled them in", () => {
    const weight = bundleWeight({
      "app:App.tsx": { bytesInOutput: 4_000 },
      "node_modules/.pnpm/react-dom@19/node_modules/react-dom/cjs/react-dom.production.js": { bytesInOutput: 170_000 },
      "node_modules/.pnpm/scheduler@0.27/node_modules/scheduler/index.js": { bytesInOutput: 4_000 },
      "node_modules/.pnpm/d3-shape@3/node_modules/d3-shape/src/line.js": { bytesInOutput: 12_000 },
      "node_modules/.pnpm/recharts@3/node_modules/recharts/es6/index.js": { bytesInOutput: 250_000 },
      "packages/app-kit/src/ui/basic.tsx": { bytesInOutput: 9_000 },
      "packages/app-kit/src/sdk/index.tsx": { bytesInOutput: 5_000 },
    });
    expect(weight).toEqual([
      { part: "recharts", kb: 262 },
      { part: "react", kb: 174 },
      { part: "@ocsc/ui", kb: 9 },
      { part: "@ocsc/app", kb: 5 },
      { part: "app code", kb: 4 },
    ]);
  });
});

describe("guide extras", () => {
  it("documents every new export the kit offers", async () => {
    const kit = await import("../ui/index.js");
    for (const name of [
      "Theme",
      "CommandPalette",
      "useHotkey",
      "DatePicker",
      "DateRangePicker",
      "Combobox",
      "Slider",
      "Popover",
      "Tooltip",
      "Accordion",
      "Carousel",
      "SortableList",
      "Markdown",
      "Typewriter",
      "Aurora",
      "TextReveal",
      "SpotlightCard",
      "GlowCard",
      "BentoGrid",
      "BentoCard",
      "Marquee",
      "Reveal",
      "celebrate",
      "MapView",
      "PlaceSearch",
      "PresenceStack",
      "RowActivity",
      "Comments",
      "RowHistory",
    ]) {
      expect(kit, name).toHaveProperty(name);
      expect(APP_KIT_GUIDE_EXTRAS, name).toContain(name);
    }
    const sdk = await import("../sdk/index.js");
    for (const name of [
      "usePresence",
      "useFocus",
      "useComments",
      "useCommentCounts",
      "useRowHistory",
      "useRows",
      "useAggregate",
      "evolve",
      "useEvolve",
      "services",
      "useService",
    ]) {
      expect(sdk, name).toHaveProperty(name);
      expect(APP_KIT_GUIDE_EXTRAS, name).toContain(name);
    }
  });

  it("keeps navigation along the top and tells the AI never to put a menu down the side", () => {
    expect(APP_KIT_GUIDE_EXTRAS).not.toContain('layout="sidebar"');
    expect(APP_KIT_GUIDE_EXTRAS).toContain("Never build a menu, rail or navigation column down");
  });

  it("builds an app written the way the extras describe", async () => {
    const app = `
import { AppShell, Aurora, BentoCard, BentoGrid, Combobox, DatePicker, DateRangePicker, Field, Markdown, SortableList, TextReveal, Theme, celebrate } from "@ocsc/ui";
import { useState } from "react";
export default function App() {
  const [due, setDue] = useState("");
  const [owner, setOwner] = useState("");
  const [range, setRange] = useState(null);
  const [steps, setSteps] = useState([{ id: "a", label: "Survey" }]);
  return (
    <>
      <Theme preset="soft" green="emerald" radius="lg" />
      <AppShell title="Jobs" commands={[{ id: "new", label: "New job", run: () => celebrate() }]}
        pages={[{ id: "home", label: "Home", render: () => (
          <Aurora>
            <TextReveal text="Jobs this week" gradient />
            <Field label="Due">{(id) => <DatePicker id={id} value={due} onChange={setDue} />}</Field>
            <Combobox options={["Aoife", "Seán"]} value={owner} onChange={setOwner} />
            <DateRangePicker value={range} onChange={setRange} />
            <BentoGrid><BentoCard size="2x1" title="Steps"><SortableList items={steps} onReorder={setSteps} getKey={(s) => s.id} render={(s) => s.label} /></BentoCard></BentoGrid>
            <Markdown>{"**Done**"}</Markdown>
          </Aurora>
        ) }]} />
    </>
  );
}`;
    const built = await buildApp({ "App.tsx": app });
    expect(built.ok ? [] : built.errors).toEqual([]);
  }, 30_000);

  it("builds a live, large-table app with comments, Evolve data and weather", async () => {
    const app = `
import { AppShell, DataTable, KpiCard, PresenceStack, RowActivity, TableView } from "@ocsc/ui";
import { evolve, services, useAggregate, useFocus, useRows, useService, useTable } from "@ocsc/app";
import { useState } from "react";
export default function App() {
  const log = useTable("log");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(null);
  const page = useRows("log", { search, sort: { column: "date", dir: "desc" }, pageSize: 50 });
  const totals = useAggregate("log", { groupBy: "date", bucket: "month", metrics: [{ op: "sum", column: "hours", as: "hours" }] });
  const weather = useService(() => services.weather(53.35, -6.26, 3), []);
  useFocus("log", open);
  return (
    <AppShell title="Site log" actions={<PresenceStack />} pages={[
      { id: "all", label: "All", render: () => <TableView table={log} filterBy="kind" /> },
      { id: "find", label: "Find", render: () => (
        <>
          <KpiCard label="Months" value={totals.groups.length} />
          <KpiCard label="Today" value={weather.data?.current?.temperature ?? 0} />
          <DataTable rows={page.rows} remote={{ total: page.total, onQuery: (q) => setSearch(q.search) }} onRowClick={(r) => setOpen(r._id)} />
          {open && <RowActivity table="log" rowId={open} schema={log.schema} />}
          {evolve.available() && <button type="button" onClick={() => void evolve.read("list_projects", {})}>Projects</button>}
        </>
      ) },
    ]} />
  );
}`;
    const built = await buildApp({ "App.tsx": app });
    expect(built.ok ? [] : built.errors).toEqual([]);
  }, 30_000);
});
