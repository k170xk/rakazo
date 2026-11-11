import type { Column, TableSchema } from "../schema.js";

/**
 * Writes an app for a set of tables, the same way for the same tables: an overview dashboard of
 * the largest table, a screen per table with search, filters, editing and export, a board for a
 * table with a status column and a calendar for one with dates. The code is plain and readable
 * so the agent or a person can carry on from it.
 */

const ident = (name: string) =>
  name.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
const str = (text: string) => JSON.stringify(text);

const MONEY = (column: Column) => column.type === "currency";
const STATUS = /status|stage|state|phase|rag|priority|progress/i;

function statusColumn(schema: TableSchema): Column | undefined {
  const enums = schema.columns.filter(
    (column) => column.type === "enum" && (column.options?.length ?? 0) <= 10,
  );
  return enums.find((column) => STATUS.test(column.label)) ?? enums[0];
}

function groupColumn(schema: TableSchema, skip?: Column): Column | undefined {
  return (
    schema.columns.find((column) => column.type === "person") ??
    schema.columns.find(
      (column) => (column.type === "enum" || column.type === "relation") && column !== skip,
    ) ??
    schema.columns.find(
      (column) =>
        column.type === "text" &&
        /client|type|category|office|discipline|sector|region/i.test(column.label),
    )
  );
}

function dateColumn(schema: TableSchema): Column | undefined {
  const dates = schema.columns.filter((column) => column.type === "date");
  return (
    dates.find((column) => /due|deadline|start|date|issued|submitted/i.test(column.label)) ??
    dates[0]
  );
}

function currencyIcon(column: Column | undefined) {
  return column?.currency === "GBP"
    ? "PoundSterling"
    : column?.currency === "USD"
      ? "DollarSign"
      : "Euro";
}

function overview(main: TableSchema, variable: string, icons: Set<string>): string {
  const money = main.columns.filter(MONEY).slice(0, 2);
  const status = statusColumn(main);
  const group = groupColumn(main, status);
  const date = dateColumn(main);
  const numeric = main.columns.find((column) => column.type === "number" && !column.hidden);
  icons.add("Layers");
  const kpis: string[] = [
    `        <KpiCard label=${str(main.label)} value={rows.length} icon={<Layers />} hint="rows" />`,
  ];
  for (const column of money) {
    const icon = currencyIcon(column);
    icons.add(icon);
    kpis.push(
      `        <KpiCard label=${str(`Total ${column.label.toLowerCase()}`)} value={sumBy(rows, ${str(column.key)})} format="currency" currency=${str(column.currency ?? "EUR")} icon={<${icon} />} />`,
    );
  }
  if (status) {
    icons.add("ListChecks");
    const options = status.options?.map((option) => option.value) ?? [];
    const top = options[0];
    kpis.push(
      `        <KpiCard label=${str(`Most common ${status.label.toLowerCase()}`)} value={countBy(rows, ${str(status.key)})[0]?.label ?? "—"} icon={<ListChecks />} tone="info" hint={\`\${countBy(rows, ${str(status.key)})[0]?.value ?? 0} rows\`} />`,
    );
    void top;
  } else if (numeric) {
    icons.add("Hash");
    kpis.push(
      `        <KpiCard label=${str(`Total ${numeric.label.toLowerCase()}`)} value={sumBy(rows, ${str(numeric.key)})} icon={<Hash />} tone="info" />`,
    );
  }
  if (date) {
    icons.add("CalendarDays");
    kpis.push(
      `        <KpiCard label=${str(`Latest ${date.label.toLowerCase()}`)} value={latest(rows, ${str(date.key)})} icon={<CalendarDays />} tone="neutral" />`,
    );
  }
  const charts: string[] = [];
  const trendField = money[0] ?? numeric;
  if (date) {
    const series = trendField
      ? `[{ key: ${str(trendField.key)}, label: ${str(trendField.label)} }]`
      : `[{ key: "count", label: "Rows" }]`;
    const fields = trendField ? `[${str(trendField.key)}]` : "[]";
    charts.push(`          <Card>
            <CardHeader title=${str(trendField ? `${trendField.label} by month` : `${main.label} by month`)} description=${str(`By ${date.label.toLowerCase()}`)} />
            <CardBody>
              <AreaChart data={byMonth(rows, ${str(date.key)}, ${fields})} x="month" series={${series}}${trendField?.type === "currency" ? ` format="currency" currency=${str(trendField.currency ?? "EUR")}` : ""} />
            </CardBody>
          </Card>`);
  } else if (group && trendField) {
    charts.push(`          <Card>
            <CardHeader title=${str(`${trendField.label} by ${group.label.toLowerCase()}`)} />
            <CardBody>
              <BarChart data={sumBy(rows, ${str(trendField.key)}, ${str(group.key)})} x="label" series={[{ key: "value", label: ${str(trendField.label)} }]}${trendField.type === "currency" ? ` format="currency" currency=${str(trendField.currency ?? "EUR")}` : ""} />
            </CardBody>
          </Card>`);
  }
  if (status) {
    charts.push(`          <Card>
            <CardHeader title=${str(`By ${status.label.toLowerCase()}`)} />
            <CardBody>
              <DonutChart data={countBy(rows, ${str(status.key)})} height={190} />
            </CardBody>
          </Card>`);
  }
  const lower: string[] = [];
  if (group) {
    const value = trendField
      ? `sumBy(rows, ${str(trendField.key)}, ${str(group.key)})`
      : `countBy(rows, ${str(group.key)})`;
    lower.push(`          <Card>
            <CardHeader title=${str(trendField ? `${trendField.label} by ${group.label.toLowerCase()}` : `${main.label} by ${group.label.toLowerCase()}`)} description="Largest first" />
            <CardBody>
              <BarList data={${value}}${trendField?.type === "currency" ? ` format="currency" currency=${str(trendField.currency ?? "EUR")}` : ""} />
            </CardBody>
          </Card>`);
  }
  const listed = [main.title ?? main.key, status?.key, money[0]?.key, date?.key].filter(
    (key, index, all): key is string => !!key && all.indexOf(key) === index,
  );
  lower.push(`          <Card>
            <CardHeader title=${str(date ? `Latest ${main.label.toLowerCase()}` : main.label)} />
            <DataTable plain search={false} rows={${date ? `[...rows].sort((a, b) => String(b[${str(date.key)}] ?? "").localeCompare(String(a[${str(date.key)}] ?? "")))` : "rows"}.slice(0, 6)} schema={${variable}.schema} columns={columnsFromSchema(${variable}.schema!, ${JSON.stringify(listed)})} />
          </Card>`);
  const chartGrid = charts.length === 2 ? "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : "";
  return `function Overview({ ${variable} }: { ${variable}: TableApi }) {
  const rows = ${variable}.rows;
  return (
    <>
      <PageHeader eyebrow="Overview" title=${str(main.label)} description={\`\${rows.length} rows, live from this app's data.\`} />
      <Grid cols={${Math.min(4, kpis.length) as number}}>
${kpis.slice(0, 4).join("\n")}
      </Grid>
${
  charts.length
    ? `      <div className="mt-4 grid gap-4 ${chartGrid}">
${charts.join("\n")}
      </div>
`
    : ""
}      <div className="mt-4 grid gap-4 lg:grid-cols-2">
${lower.join("\n")}
      </div>
    </>
  );
}`;
}

/** App.tsx for these tables. */
export function scaffoldApp(
  title: string,
  tables: TableSchema[],
  source?: string,
): Record<string, string> {
  if (!tables.length) throw new Error("An app needs at least one table to scaffold from.");
  const icons = new Set<string>(["LayoutDashboard", "Table2"]);
  const sized = [...tables];
  const main = sized[0]!;
  const variables = new Map(tables.map((table) => [table.name, ident(table.name)]));
  const mainVar = variables.get(main.name)!;
  const pages: string[] = [
    `        { id: "overview", label: "Overview", icon: <LayoutDashboard />, render: () => <Overview ${mainVar}={${mainVar}} /> },`,
  ];
  for (const table of tables) {
    const variable = variables.get(table.name)!;
    const status = statusColumn(table);
    const filter = status ? ` filterBy=${str(status.key)}` : "";
    pages.push(`        {
          id: ${str(table.name)},
          label: ${str(table.label)},
          icon: <Table2 />,
          count: ${variable}.rows.length,
          render: () => (
            <>
              <PageHeader title=${str(table.label)} description="Search, filter, open a row to see or change it, and export." />
              <TableView table={${variable}}${filter} />
            </>
          ),
        },`);
  }
  const board = statusColumn(main);
  if (board) {
    icons.add("SquareKanban");
    const titleKey = main.title ?? main.key ?? main.columns[0]!.key;
    const extra =
      main.columns.find((column) => column.type === "currency") ??
      main.columns.find((column) => column.type === "person");
    pages.push(`        {
          id: "board",
          label: "Board",
          icon: <SquareKanban />,
          render: () => (
            <>
              <PageHeader title=${str(`${main.label} by ${board.label.toLowerCase()}`)} description=${str(main ? `Drag a card to change its ${board.label.toLowerCase()}.` : "")} />
              <Kanban
                rows={${mainVar}.rows}
                groupBy=${str(board.key)}
                columns={${JSON.stringify((board.options ?? []).map((option) => ({ value: option.value })))}}
                onMove={${mainVar}.canEdit ? (row, value) => void ${mainVar}.update(row._id, { ${board.key}: value }).catch(() => toast.error("Not moved")) : undefined}
                renderCard={(row) => (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-semibold leading-snug">{String(row[${str(titleKey)}] ?? "Untitled")}</p>
${
  extra
    ? `                    <div className="text-[13px] text-muted-foreground">
                      <CellValue column={${mainVar}.schema!.columns.find((column) => column.key === ${str(extra.key)})!} value={row[${str(extra.key)}]} />
                    </div>
`
    : ""
}                  </div>
                )}
              />
            </>
          ),
        },`);
  }
  const dated = tables.find((table) => dateColumn(table));
  if (dated) {
    icons.add("CalendarDays");
    const date = dateColumn(dated)!;
    const variable = variables.get(dated.name)!;
    const status = statusColumn(dated);
    const titleKey = dated.title ?? dated.key ?? dated.columns[0]!.key;
    pages.push(`        {
          id: "calendar",
          label: "Calendar",
          icon: <CalendarDays />,
          render: () => (
            <>
              <PageHeader title=${str(`${dated.label} by ${date.label.toLowerCase()}`)} />
              <CalendarMonth rows={${variable}.rows} dateKey=${str(date.key)} titleKey=${str(titleKey)}${status ? ` toneKey=${str(status.key)}` : ""} initialMonth={latest(${variable}.rows, ${str(date.key)}, true)} />
            </>
          ),
        },`);
  }
  const tableHooks = tables
    .map((table) => `  const ${variables.get(table.name)} = useTable(${str(table.name)});`)
    .join("\n");
  const app = `import {
  AppShell,
  AreaChart,
  BarChart,
  BarList,
  byMonth,
  CalendarMonth,
  Card,
  CardBody,
  CardHeader,
  CellValue,
  columnsFromSchema,
  countBy,
  DataTable,
  DonutChart,
  Grid,
  Kanban,
  KpiCard,
  PageHeader,
  sumBy,
  TableView,
  toast,
} from "@ocsc/ui";
import { type TableApi, useTable } from "@ocsc/app";
import { ${[...icons].sort().join(", ")} } from "lucide-react";

export default function App() {
${tableHooks}
  return (
    <AppShell
      title=${str(title)}
      subtitle=${str(source ? `From ${source}` : "OCSC app")}
      pages={[
${pages.join("\n")}
      ]}
    />
  );
}

/** The newest date in a column, shown as "12 Mar 2026" (or as YYYY-MM-DD with iso). */
function latest(rows: Array<Record<string, unknown>>, key: string, iso = false): string {
  const dates = rows.map((row) => String(row[key] ?? "")).filter(Boolean).sort();
  const last = dates.at(-1);
  if (!last) return iso ? "" : "—";
  return iso ? last : new Date(\`\${last.slice(0, 10)}T00:00:00\`).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
}

${overview(main, mainVar, icons)}
`;
  // Icons collected while writing the overview must be imported too.
  return {
    "App.tsx": app.replace(
      /import \{ [^}]+ \} from "lucide-react";/,
      `import { ${[...icons].sort().join(", ")} } from "lucide-react";`,
    ),
  };
}
