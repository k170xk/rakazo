import { describe, expect, it, vi } from "vitest";
import { isBlocking, newTypeErrors, type TypecheckResult, typecheckApp } from "./typecheck.js";

const app = (body: string, imports = "") => ({
  "App.tsx": `import { useState } from "react";
import { AppShell, Theme } from "@ocsc/ui";
${imports}
export default function App() {
${body}
}
`,
});

const messages = (result: TypecheckResult) => result.errors.map((error) => error.message);

describe("isBlocking", () => {
  it("blocks missing modules and exports wherever they are", () => {
    for (const code of [2305, 2307, 2613, 2614, 2694, 2724]) expect(isBlocking(code, { kit: false })).toBe(true);
  });

  it("blocks wrong props and arguments only when the target is the kit", () => {
    for (const code of [2322, 2345, 2353, 2559, 2739, 2740, 2741, 2769]) {
      expect(isBlocking(code, { kit: true })).toBe(true);
      expect(isBlocking(code, { kit: false })).toBe(false);
    }
  });

  it("warns, not blocks, on a kit callback prop whose handler type differs", () => {
    expect(isBlocking(2322, { kit: true, callback: true })).toBe(false);
  });

  it("leaves everything else as a warning", () => {
    for (const code of [2339, 7006, 2531, 2367, 18046]) expect(isBlocking(code, { kit: true })).toBe(false);
  });
});

describe("typecheckApp: wrong kit props", () => {
  it("<Tabs tabs> names the real prop items", async () => {
    const result = await typecheckApp(
      app(
        `  const [tab, setTab] = useState("a");
  return <Tabs value={tab} onChange={setTab} tabs={[{ id: "a", label: "A" }]} />;`,
        'import { Tabs } from "@ocsc/ui";',
      ),
    );
    expect(messages(result)).toEqual([
      'App.tsx:6:46 <Tabs> has no prop "tabs"; its props are value, onChange, items, className (required: value, onChange, items)',
    ]);
    expect(result.errors[0]).toMatchObject({ file: "App.tsx", line: 6, column: 46, code: 2322 });
  });

  it("<Tabs items> with id instead of value is told the item fields", async () => {
    const result = await typecheckApp(
      app(
        `  const [tab, setTab] = useState("a");
  return <Tabs value={tab} onChange={setTab} items={[{ id: "a", label: "A" }]} />;`,
        'import { Tabs } from "@ocsc/ui";',
      ),
    );
    expect(messages(result)[0]).toMatch(/<Tabs> prop "items": unknown field "id".*fields value, label/);
  });

  it("<Theme> with children is accepted, because the kit's Theme renders its children", async () => {
    const result = await typecheckApp(app(`  return <Theme preset="evolve"><AppShell title="X" /></Theme>;`));
    expect(result.errors).toEqual([]);
  });

  it("charts with xKey/yKey name x and series", async () => {
    const result = await typecheckApp(
      app(`  return <BarChart data={[]} xKey="month" yKey="total" />;`, 'import { BarChart } from "@ocsc/ui";'),
    );
    expect(messages(result)[0]).toMatch(/<BarChart> has no props "xKey", "yKey"; its props are data, x, series/);
    expect(messages(result)[0]).not.toMatch(/did you mean/i);
  });

  it("<SampleBanner tables={['name']}> says tables are useTable results", async () => {
    const result = await typecheckApp(
      app(`  return <SampleBanner tables={["jobs"]} />;`, 'import { SampleBanner } from "@ocsc/ui";'),
    );
    expect(messages(result)[0]).toMatch(
      /<SampleBanner> prop "tables": Type 'string' is not assignable to type 'SampleTableLike'; SampleTableLike has fields rows/,
    );
  });

  it('<KpiCard trend="up"> says trend is number[]', async () => {
    const result = await typecheckApp(
      app(`  return <KpiCard label="Jobs" value={4} trend="up" />;`, 'import { KpiCard } from "@ocsc/ui";'),
    );
    expect(messages(result)[0]).toMatch(/<KpiCard> prop "trend": Type 'string' is not assignable to type 'number\[\]'/);
  });

  it("<CalendarHeatmap data> names rows and dateKey", async () => {
    const result = await typecheckApp(
      app(`  return <CalendarHeatmap data={[]} />;`, 'import { CalendarHeatmap } from "@ocsc/ui";'),
    );
    expect(messages(result)[0]).toMatch(/<CalendarHeatmap> has no prop "data"; its props are rows, dateKey/);
  });

  it("<DrawingCircle center radius> names c and r", async () => {
    const result = await typecheckApp(
      app(
        `  return <Drawing width={10} height={10}><DrawingCircle center={[0, 0]} radius={2} /></Drawing>;`,
        'import { Drawing, DrawingCircle } from "@ocsc/plot";',
      ),
    );
    expect(messages(result).join("\n")).toMatch(/<DrawingCircle> has no props "center", "radius"; its props are c, r/);
  });

  it("<TreeView items> names rows, parentKey and titleKey", async () => {
    const result = await typecheckApp(
      app(`  return <TreeView items={[]} />;`, 'import { TreeView } from "@ocsc/ui";'),
    );
    expect(messages(result)[0]).toMatch(
      /<TreeView> has no prop "items"; its props are rows, parentKey, titleKey.*\(required: rows, parentKey, titleKey\)/,
    );
  });

  it("AppShell activePage/onPageChange/tabs are listed together with the real props", async () => {
    const result = await typecheckApp(
      app(`  return <AppShell title="X" activePage="a" onPageChange={() => {}} tabs={[]} />;`),
    );
    expect(messages(result)[0]).toMatch(
      /<AppShell> has no props "activePage", "onPageChange", "tabs"; its props are title, .*pages, .*active, onNavigate/,
    );
  });

  it("commands {label, action} name the Command fields id, label and run", async () => {
    const result = await typecheckApp(
      app(`  return <AppShell title="X" commands={[{ label: "New job", action: () => {} }]} />;`),
    );
    expect(messages(result)[0]).toMatch(
      /<AppShell> prop "commands": unknown field "action"; Command has fields id, label, .*run \(required: id, label, run\)/,
    );
  });

  it("an AppShell page without render is reported as a missing field", async () => {
    const result = await typecheckApp(app(`  return <AppShell title="X" pages={[{ id: "a", label: "A" }]} />;`));
    expect(messages(result)[0]).toMatch(/<AppShell>.*"render"/);
  });

  it("wrong arguments to a kit function are errors naming the function", async () => {
    const result = await typecheckApp(
      app(
        `  return <button onClick={() => downloadDxf("plan", { entities: [{ type: "circle", c: { x: 0, y: 0 }, r: 1 }] })}>Save</button>;`,
        'import { downloadDxf } from "@ocsc/dxf";',
      ),
    );
    expect(messages(result)[0]).toMatch(/^App\.tsx:\d+:\d+ downloadDxf\(\): /);
  });

  it("a missing kit export and an unknown module are errors", async () => {
    const result = await typecheckApp(
      app(`  return <AppShell title="X" />;`, 'import { DataGrid } from "@ocsc/ui";\nimport axios from "axios";'),
    );
    const codes = result.errors.map((error) => error.code).sort();
    expect(codes).toEqual([2305, 2307]);
    expect(messages(result).join("\n")).toMatch(/has no exported member 'DataGrid'/);
  });

  it("keeps TypeScript's did-you-mean for a misspelt export", async () => {
    const result = await typecheckApp(app(`  return <AppShell title="X" />;`, 'import { KPICard } from "@ocsc/ui";'));
    expect(messages(result)[0]).toMatch(/Did you mean 'KpiCard'\?/);
  });

  it("checks imported app files too, with their own file name", async () => {
    const result = await typecheckApp({
      ...app(`  return <AppShell title="X" pages={[{ id: "a", label: "A", render: () => <Panel /> }]} />;`, 'import { Panel } from "./Panel";'),
      "Panel.tsx": `import { Tabs } from "@ocsc/ui";\nexport function Panel() {\n  return <Tabs value="a" onChange={() => {}} tabs={[]} />;\n}\n`,
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ file: "Panel.tsx", line: 3 });
    expect(result.errors[0]!.message).toMatch(/^Panel\.tsx:3:\d+ <Tabs> has no prop "tabs"/);
  });

  it("caps the error list at 12 and each message at 300 characters", async () => {
    const lines = Array.from({ length: 20 }, () => '<TreeView items={[]} />').join("\n");
    const result = await typecheckApp(app(`  return <>${lines}</>;`, 'import { TreeView } from "@ocsc/ui";'));
    expect(result.errors).toHaveLength(12);
    for (const error of result.errors) expect(error.message.length).toBeLessThanOrEqual(300);
  });
});

const CORRECT_APP = `import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Briefcase } from "lucide-react";
import {
  AppShell,
  AreaChart,
  BarChart,
  Button,
  Card,
  DonutChart,
  Gantt,
  Kanban,
  KpiCard,
  LineChart,
  SampleBanner,
  TableView,
  Tabs,
  Theme,
} from "@ocsc/ui";
import { useTable } from "@ocsc/app";
import { CalcSheet, useCalc } from "@ocsc/calc";
import { downloadDxf } from "@ocsc/dxf";
import { downloadWorkbook } from "@ocsc/sheets";
import { IfcView } from "@ocsc/ifc";
import { Plot } from "@ocsc/plot";
import { Overview } from "./Overview";
import loads from "./loads.py";

type Job = { title: string; status: string; start: string; end: string; value: number };

export default function App() {
  const jobs = useTable<Job>("jobs");
  const calc = useCalc("asset-1");
  const [tab, setTab] = useState<"list" | "board">("list");
  const byMonth = useMemo(() => [{ month: "Jan", value: 3 }], []);
  return (
    <>
      <Theme preset="evolve" />
      <AppShell
        title="Jobs"
        icon={<Briefcase />}
        commands={[{ id: "new", label: "New job", run: () => jobs.insert({ title: "New" }) }]}
        pages={[
          { id: "overview", label: "Overview", render: () => <Overview rows={jobs.rows} /> },
          {
            id: "jobs",
            label: "Jobs",
            render: () => (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <SampleBanner tables={[jobs]} />
                <Tabs value={tab} onChange={setTab} items={[{ value: "list", label: "List" }, { value: "board", label: "Board" }]} />
                {tab === "list" ? (
                  <TableView table={jobs} columns={["title", "status"]} />
                ) : (
                  <Kanban rows={jobs.rows} groupBy="status" renderCard={(row) => <Card>{row.title}</Card>} />
                )}
              </motion.div>
            ),
          },
          {
            id: "plan",
            label: "Plan",
            render: () => <Gantt rows={jobs.rows} startKey="start" endKey="end" titleKey="title" />,
          },
          {
            id: "charts",
            label: "Charts",
            render: () => (
              <>
                <KpiCard label="Jobs" value={jobs.rows.length} delta={4} trend={[1, 2, 3]} />
                <AreaChart data={byMonth} x="month" series={["value"]} />
                <BarChart data={byMonth} x="month" series={[{ key: "value", label: "Jobs" }]} />
                <LineChart data={byMonth} x="month" series={["value"]} />
                <DonutChart data={byMonth} label="month" value="value" />
                <Plot series={[{ name: "Load", data: [[0, 0], [1, 2]] }]} x={{ label: "x" }} />
              </>
            ),
          },
          {
            id: "files",
            label: "Files",
            render: () => (
              <>
                <IfcView asset="model-1" />
                <CalcSheet calc={calc} sheet="Sheet1" />
                <p>{loads.length} lines of Python</p>
                <Button onClick={() => downloadDxf("plan", { entities: [{ type: "circle", center: { x: 0, y: 0 }, radius: 1 }] })}>DXF</Button>
                <Button onClick={() => downloadWorkbook("jobs", [{ name: "Jobs", rows: [["Title"], ["A"]] }])}>Excel</Button>
              </>
            ),
          },
        ]}
      />
    </>
  );
}
`;

const OVERVIEW = `import { BarList, Stat } from "@ocsc/ui";

export function Overview({ rows }: { rows: Array<{ status: string }> }) {
  const counts = rows.reduce((all, row) => ({ ...all, [row.status]: (all[row.status] ?? 0) + 1 }), {});
  return (
    <div className="grid gap-4">
      <Stat label="Open" value={rows.length} />
      <BarList data={Object.entries(counts).map(([name, value]) => ({ name, value: Number(value) }))} label="name" value="value" />
    </div>
  );
}
`;

describe("typecheckApp: correct apps and app-logic slop", () => {
  it("a correct app using the common kit components has no errors", async () => {
    const result = await typecheckApp({
      "App.tsx": CORRECT_APP,
      "Overview.tsx": OVERVIEW,
      "loads.py": "def total(xs):\n    return sum(xs)\n",
      "styles.css": ".x { color: red }",
      "README.md": "# Jobs",
    });
    expect(result.errors).toEqual([]);
  });

  it("the app's own loose typing is only a warning", async () => {
    const result = await typecheckApp(
      app(`  const x: number = "a";
  const rows = [];
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  function score(a, b) { return a.points - b.points; }
  const [count, setCount] = useState(0);
  setCount("many");
  return <AppShell title={String(x + total + score({}, {}) + count)} />;`),
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toContain(2322);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("a wrong type inside a handler given to a kit prop is the app's own logic", async () => {
    const result = await typecheckApp(
      app(
        `  const [tab, setTab] = useState("a");
  return <Tabs value={tab} items={[{ value: "a", label: "A" }]} onChange={(next) => { const n: number = next; setTab(next); }} />;`,
        'import { Tabs } from "@ocsc/ui";',
      ),
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it("a .py import types as string", async () => {
    const result = await typecheckApp({
      ...app(`  const n: number = source;\n  return <AppShell title={source.toUpperCase()} />;`, 'import source from "./calc.py";'),
      "calc.py": "x = 1\n",
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((warning) => warning.message)).toEqual([
      "App.tsx:5:9 Type 'string' is not assignable to type 'number'.",
    ]);
  });

  it("gives up with a warning instead of hanging when a check runs too long", async () => {
    const result = await typecheckApp({ "App.tsx": CORRECT_APP, "Overview.tsx": OVERVIEW, "loads.py": "" }, { timeoutMs: 0 });
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((warning) => warning.message)).toEqual(["type check skipped (slow)"]);
    const after = await typecheckApp({ "App.tsx": CORRECT_APP, "Overview.tsx": OVERVIEW, "loads.py": "" });
    expect(after.errors).toEqual([]);
    expect(after.warnings.map((warning) => warning.message)).not.toContain("type check skipped (slow)");
  });

  it("never throws on broken input", async () => {
    const result = await typecheckApp({ "App.tsx": "export default function App( {" });
    expect(result.errors).toEqual([]);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("a second check is faster than the first", async () => {
    vi.resetModules();
    const fresh = await import("./typecheck.js");
    const files = { "App.tsx": CORRECT_APP, "Overview.tsx": OVERVIEW, "loads.py": "x = 1\n" };
    const first = await fresh.typecheckApp(files);
    const second = await fresh.typecheckApp({ ...files, "App.tsx": CORRECT_APP.replace('"Jobs"', '"Tasks"') });
    expect(first.errors).toEqual([]);
    expect(second.errors).toEqual([]);
    expect(second.ms).toBeLessThan(first.ms);
    expect(second.ms).toBeLessThan(2000);
  });
});

describe("newTypeErrors", () => {
  const problem = (line: number, message: string) => ({
    file: "App.tsx",
    line,
    column: 1,
    code: 2322,
    message: `App.tsx:${line}:1 ${message}`,
  });

  it("treats moved problems as existing and only new ones as added", () => {
    const { added, existing } = newTypeErrors(
      [problem(4, "<KpiCard> has no prop \"title\"")],
      [problem(9, "<KpiCard> has no prop \"title\""), problem(12, "<AreaChart> has no props \"xKey\"")],
    );
    expect(existing.map((item) => item.line)).toEqual([9]);
    expect(added.map((item) => item.line)).toEqual([12]);
  });
});
