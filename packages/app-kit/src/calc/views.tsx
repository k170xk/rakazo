import { AlertTriangle, CheckCircle2, Grid3x3, LayoutList, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import type { Tone } from "../schema.js";
import {
  Badge,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Field,
  SearchInput,
  Select,
  Skeleton,
  Switch,
} from "../ui/basic.js";
import { AreaChart, BarChart, DonutChart, LineChart } from "../ui/charts.js";
import { CHART_COLORS, cn } from "../ui/cn.js";
import { SegmentedControl } from "../ui/inputs.js";
import { AXIS_TEXT, axisNumber, GRID_STROKE, truncate, useWidth } from "../ui/plot.js";
import { PrintButton } from "../ui/print.js";
import { PageHeader } from "../ui/shell.js";
import type { Calc, CalcInput } from "./kit.js";
import { CalcSheet, matchOption, TypedEntry } from "./kit.js";
import type {
  LabelSource,
  LayoutBlock,
  LayoutChart,
  LayoutField,
  LayoutSection,
  SheetLayout,
} from "./layout.js";
import { isUnit, liveLabel, sheetLayout, statusTone } from "./layout.js";
import type { ChartSpec } from "./model.js";
import {
  axisTicks,
  calcReport,
  checkSummary,
  detailSheets,
  fieldLanes,
  filterSections,
  looseInputs,
  resultLabel,
  seriesSegments,
  tidyText,
} from "./present.js";
import { XlError } from "./values.js";

const sheetIndexOf = (calc: Calc, sheet: string | number | undefined) => {
  const model = calc.model;
  if (!model) return -1;
  if (typeof sheet === "number") return sheet;
  if (sheet === undefined) return calc.inputs[0]?.sheet ?? 0;
  return model.sheets.findIndex((item) => item.name === sheet);
};

/** How a sheet reads as an app page; recomputed only when the model changes. */
export function useCalcLayout(calc: Calc, sheet?: string | number): SheetLayout | null {
  const index = sheetIndexOf(calc, sheet);
  return useMemo(
    () => (calc.model && index >= 0 ? sheetLayout(calc.model, index) : null),
    [calc.model, index],
  );
}

const TONE_TEXT: Record<"success" | "danger" | "warning", string> = {
  success: "text-success",
  danger: "text-destructive",
  warning: "text-warning",
};

const TONE_ICON = { success: CheckCircle2, danger: XCircle, warning: AlertTriangle };

/** A verdict the sheet calculates (OK, FAIL, VALID DESIGN), coloured by what it says. */
export function CalcStatus({ calc, address }: { calc: Calc; address: string }) {
  const text = calc.text(address).trim();
  if (!text) return <span className="text-muted-foreground">—</span>;
  return <Badge tone={(statusTone(text) ?? "neutral") as Tone}>{tidyText(text)}</Badge>;
}

const ratioOf = (calc: Calc, field: LayoutField) => {
  if (!field.ratio || (field.unit && field.unit !== "%")) return null;
  const value = calc.value(field.address);
  return typeof value === "number" && value >= 0 && value <= 3 ? value : null;
};

function RatioBar({ value }: { value: number }) {
  const tone = value > 1 ? "bg-destructive" : value > 0.9 ? "bg-warning" : "bg-success";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", tone)}
        style={{ width: `${Math.min(value, 1) * 100}%` }}
      />
    </div>
  );
}

/** A label as the sheet names it now, where the sheet calculates its words. */
const shown = (calc: Calc, label: string, live?: LabelSource[]) =>
  tidyText(liveLabel(label, live, calc.text));

/** A field's label as the workbook reads now, where a formula writes it ("Span 2", "Layer 2"). */
export const calcLabel = (calc: Calc, field: LayoutField) =>
  field.labelAddress
    ? tidyText(calc.text(field.labelAddress) || field.label)
    : shown(calc, field.label, field.live);

/** The code clause a figure follows, as a quiet tag after its label. */
const Reference = ({ text, narrow }: { text?: string; narrow?: boolean }) =>
  text ? (
    <span
      title={text}
      className={cn(
        "ml-1.5 inline-block truncate rounded-sm border border-border px-1 align-middle text-xs font-normal leading-4 text-muted-foreground",
        narrow ? "max-w-24" : "max-w-48",
      )}
    >
      {text}
    </span>
  ) : null;

/** A key result as a card: its figure and unit, a verdict's colour, a ratio's bar. */
export function CalcResult({
  calc,
  field,
  label,
}: {
  calc: Calc;
  field: LayoutField;
  label?: string;
}) {
  const text = field.status ? calc.text(field.address) : calc.display(field.address);
  const tone = statusTone(text);
  const ratio = ratioOf(calc, field);
  const Icon = tone ? TONE_ICON[tone] : null;
  const name = label ?? calcLabel(calc, field);
  return (
    <Card className="flex min-w-0 flex-col gap-2 p-4">
      <div className="truncate text-xs font-medium text-muted-foreground" title={name}>
        {name}
      </div>
      <div
        className={cn(
          "flex items-baseline gap-1.5 text-2xl font-semibold tracking-tight tabular-nums",
          tone && TONE_TEXT[tone],
        )}
      >
        {Icon ? <Icon className="size-5 shrink-0 self-center" aria-hidden /> : null}
        <span className="truncate">{field.status ? tidyText(text) || "—" : text || "—"}</span>
        {field.unit && !field.status ? (
          <span className="text-sm font-normal text-muted-foreground">{field.unit}</span>
        ) : null}
      </div>
      {ratio !== null ? <RatioBar value={ratio} /> : null}
    </Card>
  );
}

/** The sheet's overall verdict and its key results, for the top of a page. */
export function CalcSummary({ calc, layout }: { calc: Calc; layout: SheetLayout }) {
  const overall = layout.statuses.find((address) => statusTone(calc.text(address)));
  const summary = overall
    ? checkSummary([calc.text(overall)])
    : checkSummary(
        layout.checks.map((address) => calc.text(address)),
        true,
      );
  const verdict = summary?.text ?? "";
  const tone = summary?.tone ?? null;
  const others = overall ? layout.statuses.filter((address) => address !== overall) : [];
  const key = layout.key.filter((field) => field.address !== overall);
  if (!verdict && !key.length) return null;
  const Icon = tone ? TONE_ICON[tone] : null;
  return (
    <div className="flex flex-col gap-3">
      {verdict ? (
        <div
          role="status"
          className={cn(
            "flex items-center gap-3 rounded-2xl border px-5 py-4",
            tone === "success" && "border-success/30 bg-success/10",
            tone === "danger" && "border-destructive/30 bg-destructive/10",
            tone === "warning" && "border-warning/30 bg-warning/10",
            !tone && "border-border bg-muted/40",
          )}
        >
          {Icon ? (
            <Icon className={cn("size-6 shrink-0", tone && TONE_TEXT[tone])} aria-hidden />
          ) : null}
          <span className={cn("text-lg font-semibold", tone && TONE_TEXT[tone])}>
            {tidyText(verdict)}
          </span>
          {others.length ? (
            <span className="ml-auto flex flex-wrap justify-end gap-1.5">
              {others.slice(0, 5).map((address) => (
                <CalcStatus key={address} calc={calc} address={address} />
              ))}
            </span>
          ) : null}
        </div>
      ) : null}
      {key.length ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {key.map((field) => (
            <CalcResult
              key={field.address}
              calc={calc}
              field={field}
              label={
                field.labelAddress
                  ? undefined
                  : liveLabel(resultLabel(layout, field), field.live, calc.text)
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const inputOf = (calc: Calc, address: string) =>
  calc.inputs.find((input) => input.address === address);

const ENTRY =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-base tabular-nums shadow-xs transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30 sm:text-sm";

const outOfRange = (input: CalcInput, value: unknown) =>
  typeof value === "number" &&
  ((input.min !== undefined && value < input.min) ||
    (input.max !== undefined && value > input.max) ||
    (input.integer && !Number.isInteger(value)));

const rangeText = (input: CalcInput) =>
  input.min !== undefined && input.max !== undefined
    ? `${input.min} – ${input.max}`
    : input.min !== undefined
      ? `≥ ${input.min}`
      : input.max !== undefined
        ? `≤ ${input.max}`
        : "a whole number";

/** An input as the control its kind needs: a list, a switch, or a number box with its unit. */
function CalcEntry({
  calc,
  input,
  id,
  unit,
  compact,
}: {
  calc: Calc;
  input: CalcInput;
  id?: string;
  unit?: string;
  compact?: boolean;
}) {
  const value = calc.value(input.address);
  if (input.kind === "boolean" || typeof value === "boolean") {
    return (
      <Switch
        checked={value === true}
        onChange={(checked) => calc.set(input.address, checked)}
        label={<span className="sr-only">{input.label ?? input.address}</span>}
      />
    );
  }
  const options = input.kind === "choice" ? calc.options(input) : [];
  if (options.length) {
    const current = String(value ?? "");
    const listed = options.map(String);
    return (
      <Select
        id={id}
        aria-label={id ? undefined : (input.label ?? input.address)}
        value={current}
        options={listed.includes(current) || !current ? listed : [current, ...listed]}
        onChange={(event) => calc.set(input.address, matchOption(options, event.target.value))}
        className={compact ? "min-w-24" : undefined}
      />
    );
  }
  const shownUnit = unit ?? (input.unit && isUnit(input.unit) ? input.unit : undefined);
  const wrong = outOfRange(input, value);
  if (!shownUnit) {
    return (
      <TypedEntry
        id={id}
        input={input}
        text={calc.text(input.address)}
        calc={calc}
        className={cn(
          ENTRY,
          compact && "h-9 min-w-20",
          wrong && "border-destructive focus:border-destructive",
        )}
      />
    );
  }
  return (
    <div
      className={cn(
        "flex h-10 w-full min-w-0 items-center rounded-lg border border-input bg-background shadow-xs transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/30",
        compact && "h-9 min-w-24",
        wrong && "border-destructive focus-within:border-destructive",
      )}
    >
      <TypedEntry
        id={id}
        input={input}
        text={calc.text(input.address)}
        calc={calc}
        className="h-full min-w-0 flex-1 bg-transparent pl-3 pr-1.5 text-base tabular-nums focus:outline-none sm:text-sm"
      />
      <span className="shrink-0 pr-3 text-xs text-muted-foreground">{shownUnit}</span>
    </div>
  );
}

const changedDot = (calc: Calc, address: string) => {
  const now = calc.value(address);
  const before = calc.initial(address);
  const same =
    now instanceof XlError || before instanceof XlError
      ? String(now) === String(before)
      : now === before;
  return same ? null : (
    <span
      className="ml-1.5 inline-block size-1.5 rounded-full bg-primary align-middle"
      title="Changed"
    />
  );
};

/** One field: an input as its control, a result as its figure, a verdict as a badge. */
export function CalcField({ calc, field }: { calc: Calc; field: LayoutField }) {
  const input = field.input ? inputOf(calc, field.address) : undefined;
  const hint = field.hintAddress ? calc.text(field.hintAddress) : field.hint;
  if (input) {
    const value = calc.value(input.address);
    return (
      <Field
        label={
          <>
            {calcLabel(calc, field)}
            <Reference text={field.reference} />
            {changedDot(calc, input.address)}
          </>
        }
        hint={hint || input.help}
        error={outOfRange(input, value) ? `Expected ${rangeText(input)}` : undefined}
      >
        {(id) => <CalcEntry calc={calc} input={input} id={id} unit={field.unit} />}
      </Field>
    );
  }
  const ratio = ratioOf(calc, field);
  const verdict = field.hintAddress && hint && statusTone(hint) ? field.hintAddress : undefined;
  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 text-muted-foreground">
          {calcLabel(calc, field)}
          <Reference text={field.reference} />
        </span>
        {field.status ? (
          <CalcStatus calc={calc} address={field.address} />
        ) : (
          <span className="flex shrink-0 items-baseline gap-2">
            <span
              className={cn(
                "text-right tabular-nums text-foreground",
                field.strong && "font-semibold",
              )}
            >
              {calc.display(field.address) || "—"}
              {field.unit ? (
                <span className="ml-1 text-xs font-normal text-muted-foreground">{field.unit}</span>
              ) : null}
            </span>
            {verdict ? <CalcStatus calc={calc} address={verdict} /> : null}
          </span>
        )}
      </div>
      {ratio !== null ? <RatioBar value={ratio} /> : null}
      {hint && !verdict ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function FieldGroup({ calc, fields }: { calc: Calc; fields: LayoutField[] }) {
  const lanes = fieldLanes(fields);
  const render = (list: LayoutField[], laned = false) => {
    const parts: ReactNode[] = [];
    let run: LayoutField[] = [];
    const flush = () => {
      if (!run.length) return;
      const kind = run[0]!.input && inputOf(calc, run[0]!.address);
      parts.push(
        kind ? (
          <div
            key={run[0]!.address}
            className={cn(
              "grid gap-4 py-2",
              laned ? "@3xl:grid-cols-2" : "@sm:grid-cols-2 @2xl:grid-cols-3",
            )}
          >
            {run.map((field) => (
              <CalcField key={field.address} calc={calc} field={field} />
            ))}
          </div>
        ) : (
          <div key={run[0]!.address} className="divide-y divide-border/60">
            {run.map((field) => (
              <CalcField key={field.address} calc={calc} field={field} />
            ))}
          </div>
        ),
      );
      run = [];
    };
    for (const field of list) {
      const entry = !!(field.input && inputOf(calc, field.address));
      if (run.length && !!(run[0]!.input && inputOf(calc, run[0]!.address)) !== entry) flush();
      run.push(field);
    }
    flush();
    return parts;
  };
  if (lanes.length === 1) return <>{render(fields)}</>;
  return (
    <div
      className={cn(
        "grid gap-x-6 gap-y-2",
        lanes.length === 2 ? "@md:grid-cols-2" : "@xl:grid-cols-3",
      )}
    >
      {lanes.map((lane) => (
        <div key={lane[0]!.address} className="min-w-0">
          {render(lane, true)}
        </div>
      ))}
    </div>
  );
}

function TableBlock({
  calc,
  table,
}: {
  calc: Calc;
  table: Extract<LayoutBlock, { kind: "table" }>["table"];
}) {
  const hints = table.rows.some((row) => row.hint || row.hintAddress);
  // Side-by-side copies of a table ("Column 1 | Column 2") read better one under the other.
  if (table.groups && table.groups.length > 1 && table.columns.length >= 6) {
    let from = 0;
    return (
      <div className="flex flex-col gap-4">
        {table.groups.map((group, index) => {
          const start = from;
          from += group.span;
          const pick = <T,>(list: T[]) => list.slice(start, start + group.span);
          return (
            <TableBlock
              key={`${group.label}-${index}`}
              calc={calc}
              table={{
                columns: pick(table.columns),
                groups: [group],
                rows: table.rows.map(({ hint, hintAddress, reference, ...row }) => ({
                  ...row,
                  cells: pick(row.cells),
                  ...(index === 0 && reference ? { reference } : {}),
                  ...(index === table.groups!.length - 1
                    ? { ...(hint ? { hint } : {}), ...(hintAddress ? { hintAddress } : {}) }
                    : {}),
                })),
              }}
            />
          );
        })}
      </div>
    );
  }
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          {table.groups?.length ? (
            <tr className="text-xs text-muted-foreground">
              <th className="px-1 pt-2" />
              {table.groups.map((group, index) => (
                <th
                  key={`${group.label}-${index}`}
                  colSpan={group.span}
                  scope="colgroup"
                  className={cn(
                    "px-2 pt-2 font-semibold text-foreground",
                    table.groups!.length > 1 ? "text-right" : "text-left",
                    group.label && "border-b border-border/60",
                  )}
                >
                  {shown(calc, group.label, table.live)}
                </th>
              ))}
              {hints ? <th className="px-1 pt-2" /> : null}
            </tr>
          ) : null}
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="px-1 py-2 text-left font-medium" />
            {table.columns.map((column, index) => (
              <th key={`${column}-${index}`} className="px-2 py-2 text-right font-medium">
                {shown(calc, column, table.live)}
              </th>
            ))}
            {hints ? <th className="px-1 py-2" /> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {table.rows.map((row, index) => (
            <tr key={`${row.label}-${index}`}>
              <th scope="row" className="px-1 py-1.5 text-left font-normal text-muted-foreground">
                {shown(calc, row.label, row.live)}
                <Reference text={row.reference} narrow />
              </th>
              {row.cells.map((cell, col) => {
                const input = cell?.input ? inputOf(calc, cell.address) : undefined;
                return (
                  <td key={cell?.address ?? col} className="px-2 py-1.5 text-right tabular-nums">
                    {!cell ? null : input ? (
                      <CalcEntry
                        calc={calc}
                        input={{
                          ...input,
                          label: [shown(calc, row.label, row.live), calcLabel(calc, cell)]
                            .filter(Boolean)
                            .join(" · "),
                        }}
                        unit={cell.unit}
                        compact
                      />
                    ) : cell.status ? (
                      <CalcStatus calc={calc} address={cell.address} />
                    ) : (
                      <span className={cn(cell.strong && "font-semibold")}>
                        {calc.display(cell.address) || "—"}
                        {cell.unit ? (
                          <span className="ml-1 text-xs text-muted-foreground">{cell.unit}</span>
                        ) : null}
                      </span>
                    )}
                  </td>
                );
              })}
              {hints ? (
                <td className="px-1 py-1.5 text-xs text-muted-foreground">
                  {row.hintAddress && statusTone(calc.text(row.hintAddress)) ? (
                    <CalcStatus calc={calc} address={row.hintAddress} />
                  ) : row.hintAddress ? (
                    calc.text(row.hintAddress)
                  ) : (
                    row.hint
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionCard({
  calc,
  section,
  charts = [],
}: {
  calc: Calc;
  section: LayoutSection;
  charts?: LayoutChart[];
}) {
  const blocks = section.blocks.filter((block, index) => {
    const before = section.blocks[index - 1];
    return !(
      block.kind === "note" &&
      before?.kind === "note" &&
      noteText(calc, block).trim() === noteText(calc, before).trim()
    );
  });
  const body = [
    ...blocks.map((block, index) =>
      block.kind === "fields" ? (
        <FieldGroup key={index} calc={calc} fields={block.fields} />
      ) : block.kind === "table" ? (
        <TableBlock key={index} calc={calc} table={block.table} />
      ) : (
        <Note key={index} calc={calc} block={block} />
      ),
    ),
    ...charts.map((chart, index) => {
      const title = chart.caption ?? chart.title;
      const repeats =
        !!title && tidyText(title).toLowerCase() === tidyText(section.title).toLowerCase();
      return (
        <ChartBody
          key={`chart-${index}`}
          calc={calc}
          chart={repeats ? { ...chart, caption: "", title: "" } : chart}
          titled
        />
      );
    }),
  ];
  if (!section.title) {
    return (
      <Card className="bg-muted/30">
        <CardBody className="@container pt-4">{body}</CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader
        title={shown(calc, section.title, section.live)}
        action={
          section.inputs ? (
            <Badge tone="accent">
              {section.inputs} {section.inputs === 1 ? "input" : "inputs"}
            </Badge>
          ) : undefined
        }
      />
      <CardBody className="@container flex flex-col gap-2">{body}</CardBody>
    </Card>
  );
}

const noteText = (calc: Calc, block: Extract<LayoutBlock, { kind: "note" }>) =>
  block.address ? calc.text(block.address) : (block.text ?? "");

function Note({ calc, block }: { calc: Calc; block: Extract<LayoutBlock, { kind: "note" }> }) {
  const text = noteText(calc, block);
  if (!text.trim()) return null;
  const tone = block.address ? statusTone(text) : null;
  if (tone) {
    return (
      <Callout tone={tone} className="my-1">
        {tidyText(text)}
      </Callout>
    );
  }
  return (
    <p
      className={cn(
        "py-1 text-sm",
        block.strong ? "font-medium text-foreground" : "text-muted-foreground",
      )}
    >
      {text}
    </p>
  );
}

const numeric = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** A chart from the workbook, redrawn from the cells it plots so it follows every change. */
export function CalcChart({
  calc,
  chart,
}: {
  calc: Calc;
  chart: ChartSpec & { caption?: string };
}) {
  const title = chart.caption ?? chart.title;
  return (
    <Card>
      {title ? <CardHeader title={tidyText(title)} /> : null}
      <CardBody className={title ? undefined : "pt-5"}>
        <ChartBody calc={calc} chart={chart} />
      </CardBody>
    </Card>
  );
}

function ChartBody({
  calc,
  chart,
  titled,
}: {
  calc: Calc;
  chart: ChartSpec & { caption?: string };
  titled?: boolean;
}) {
  const title = chart.caption ?? chart.title;
  const names = chart.series.map(
    (series, index) =>
      series.name ??
      (series.nameRef ? String(calc.range(series.nameRef)[0] ?? "") : "") ??
      `Series ${index + 1}`,
  );
  const body = (() => {
    if (chart.kind === "scatter" || chart.drawing) {
      return <Plot calc={calc} chart={chart} names={names} />;
    }
    const categories = chart.series[0]?.x ? calc.range(chart.series[0].x) : [];
    const columns = chart.series.map((series) => calc.range(series.y));
    const length = Math.max(categories.length, ...columns.map((column) => column.length));
    if (chart.kind === "pie") {
      const data = Array.from({ length }, (_, index) => ({
        label: String(categories[index] ?? index + 1),
        value: numeric(columns[0]?.[index]) ?? 0,
      }));
      return <DonutChart data={data} />;
    }
    const data = Array.from({ length }, (_, index) => {
      const row: Record<string, unknown> = {
        x: String(categories[index] ?? index + 1)
          .replace(/\s+/g, " ")
          .trim(),
      };
      columns.forEach((column, s) => {
        row[`s${s}`] = numeric(column[index]);
      });
      return row;
    });
    const series = names.map((name, index) => ({
      key: `s${index}`,
      label: name || `Series ${index + 1}`,
    }));
    const legend = series.length > 1;
    if (chart.kind === "line")
      return <LineChart data={data} x="x" series={series} legend={legend} height={260} />;
    if (chart.kind === "area")
      return (
        <AreaChart
          data={data}
          x="x"
          series={series}
          legend={legend}
          stacked={chart.stacked}
          height={260}
        />
      );
    return (
      <BarChart
        data={data}
        x="x"
        series={series}
        legend={legend}
        stacked={chart.stacked}
        horizontal={chart.kind === "bar"}
        height={260}
      />
    );
  })();
  if (!titled) return body;
  return (
    <figure className="flex flex-col gap-2 pt-3">
      {title ? (
        <figcaption className="text-sm font-medium text-foreground">{tidyText(title)}</figcaption>
      ) : null}
      {body}
    </figure>
  );
}

/** X–Y series drawn as lines and points; a drawing keeps one scale on both axes. */
function Plot({ calc, chart, names }: { calc: Calc; chart: ChartSpec; names: string[] }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const series = chart.series.map((spec) => ({
    spec,
    segments: seriesSegments(spec.x ? calc.range(spec.x) : [], calc.range(spec.y), !spec.x),
  }));
  // A drawing's invisible series (no line, no marker) still set its extent, as in Excel.
  const all = series.flatMap(({ spec, segments }) =>
    chart.drawing || spec.marker || spec.line === false
      ? segments.flat()
      : segments.filter((points) => points.length > 1).flat(),
  );
  if (!all.length)
    return (
      <div ref={ref} className="py-10 text-center text-sm text-muted-foreground">
        —
      </div>
    );
  let [x0, x1] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
  let [y0, y1] = [Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))];
  const W = Math.max(240, measured || 480);
  const drawing = !!chart.drawing;
  const xTicks = drawing ? [] : axisTicks(x0, x1, Math.max(3, Math.floor(W / 90)));
  const yTicks = drawing ? [] : axisTicks(y0, y1, 5);
  if (!drawing) {
    [x0, x1] = [xTicks[0] ?? x0, xTicks[xTicks.length - 1] ?? x1];
    [y0, y1] = [yTicks[0] ?? y0, yTicks[yTicks.length - 1] ?? y1];
  }
  if (x1 === x0) [x0, x1] = [x0 - 1, x1 + 1];
  if (y1 === y0) [y0, y1] = [y0 - 1, y1 + 1];
  const yLabels = yTicks.map((tick) => axisNumber(tick));
  const left = drawing
    ? 12
    : Math.max(...yLabels.map((label) => label.length)) * 7 + 14 + (chart.yTitle ? 16 : 0);
  const right = drawing ? 12 : 16;
  const top = 12;
  const bottom = drawing ? 12 : 26 + (chart.xTitle ? 18 : 0);
  const plotW = W - left - right;
  const H = drawing
    ? Math.round(Math.max(160, Math.min(420, ((y1 - y0) / (x1 - x0)) * plotW + top + bottom)))
    : 260;
  const plotH = H - top - bottom;
  const sx = plotW / (x1 - x0);
  const sy = plotH / (y1 - y0);
  const scale = Math.min(sx, sy);
  const ox = drawing ? left + (plotW - (x1 - x0) * scale) / 2 : left;
  const oy = drawing ? top + (plotH - (y1 - y0) * scale) / 2 : top;
  const px = (x: number) => ox + (x - x0) * (drawing ? scale : sx);
  const py = (y: number) => H - (drawing ? oy : bottom) - (y - y0) * (drawing ? scale : sy);
  return (
    <figure className="flex flex-col gap-2">
      <div ref={ref} className="w-full">
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block max-w-full"
          role="img"
          aria-label={chart.title ?? "Chart"}
        >
          {drawing ? null : (
            <g>
              {yTicks.map((tick, index) => (
                <g key={`y${tick}`}>
                  <line
                    x1={left}
                    x2={W - right}
                    y1={py(tick)}
                    y2={py(tick)}
                    stroke={GRID_STROKE}
                    strokeDasharray={tick === 0 ? undefined : "3 3"}
                  />
                  <text x={left - 8} y={py(tick)} dy="0.32em" textAnchor="end" {...AXIS_TEXT}>
                    {yLabels[index]}
                  </text>
                </g>
              ))}
              {xTicks.map((tick) => (
                <g key={`x${tick}`}>
                  <line
                    x1={px(tick)}
                    x2={px(tick)}
                    y1={top}
                    y2={H - bottom}
                    stroke={GRID_STROKE}
                    strokeDasharray={tick === 0 ? undefined : "3 3"}
                  />
                  <text x={px(tick)} y={H - bottom + 16} textAnchor="middle" {...AXIS_TEXT}>
                    {axisNumber(tick)}
                  </text>
                </g>
              ))}
              {chart.xTitle ? (
                <text x={left + plotW / 2} y={H - 4} textAnchor="middle" {...AXIS_TEXT}>
                  {truncate(tidyText(chart.xTitle), Math.max(8, Math.floor(plotW / 7)))}
                </text>
              ) : null}
              {chart.yTitle ? (
                <text
                  transform={`translate(12 ${top + plotH / 2}) rotate(-90)`}
                  textAnchor="middle"
                  {...AXIS_TEXT}
                >
                  {truncate(tidyText(chart.yTitle), Math.max(8, Math.floor(plotH / 7)))}
                </text>
              ) : null}
            </g>
          )}
          {series.map(({ spec, segments }, index) => {
            const color = CHART_COLORS[index % CHART_COLORS.length];
            const line = spec.line !== false;
            return (
              <g key={`${spec.y}-${index}`}>
                {line
                  ? segments.map((points, part) =>
                      points.length > 1 ? (
                        <polyline
                          key={part}
                          fill="none"
                          stroke={color}
                          strokeWidth={2}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                          points={points.map(([x, y]) => `${px(x)},${py(y)}`).join(" ")}
                        />
                      ) : null,
                    )
                  : null}
                {spec.marker || (!line && spec.marker === undefined)
                  ? segments
                      .flat()
                      .map(([x, y], point) => (
                        <circle key={point} cx={px(x)} cy={py(y)} r={3} fill={color} />
                      ))
                  : null}
              </g>
            );
          })}
        </svg>
      </div>
      {!drawing && names.filter(Boolean).length > 1 ? (
        <figcaption className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {names.map((name, index) =>
            name ? (
              <span key={`${name}-${index}`} className="flex items-center gap-1.5">
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
                />
                {name}
              </span>
            ) : null,
          )}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** Prints a sheet's inputs and results as a calculation, as the screen shows them. */
export function CalcPrintButton({
  calc,
  sheet,
  title,
}: {
  calc: Calc;
  sheet?: string | number;
  title?: string;
}) {
  const layout = useCalcLayout(calc, sheet);
  if (!layout || !calc.model) return null;
  const model = calc.model;
  return (
    <PrintButton
      document={() =>
        calcReport(layout, calc.display, {
          title: title ?? tidyText(layout.name),
          reference: model.source.fileName,
        })
      }
    />
  );
}

function Loading({ calc }: { calc: Calc }) {
  if (calc.status === "error") {
    return <Callout tone="danger">{calc.error ?? "The calculation could not be loaded."}</Callout>;
  }
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-16" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}

/** The sheet's title block (project, client, made by, date…) as one compact header card. */
function ProjectCard({ calc, section }: { calc: Calc; section: LayoutSection }) {
  const lines = section.blocks
    .flatMap((block) => (block.kind === "note" ? [noteText(calc, block).trim()] : []))
    .filter((text, index, all) => text && !statusTone(text) && all.indexOf(text) === index);
  const fields = section.blocks.flatMap((block) => (block.kind === "fields" ? block.fields : []));
  const pages = new Map<string, LayoutField[]>();
  for (const field of fields)
    pages.set(field.row ?? "", [...(pages.get(field.row ?? "") ?? []), field]);
  const grid = (list: LayoutField[]) => (
    <dl className="grid gap-x-6 gap-y-3 @md:grid-cols-2 @3xl:grid-cols-4">
      {list.map((field) => {
        const input = field.input ? inputOf(calc, field.address) : undefined;
        return (
          <div key={field.address} className="flex min-w-0 flex-col gap-1">
            <dt className="text-xs text-muted-foreground">{calcLabel(calc, field)}</dt>
            <dd className="min-w-0 text-sm text-foreground">
              {input ? (
                <CalcEntry
                  calc={calc}
                  input={{ ...input, label: calcLabel(calc, field) }}
                  compact
                />
              ) : (
                <span className="block truncate py-1">{calc.display(field.address) || "—"}</span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
  const main = pages.get("") ?? [];
  const later = [...pages].filter(([page]) => page);
  return (
    <Card className="bg-muted/30">
      <CardBody className="@container flex flex-col gap-4 py-4">
        {lines.length ? (
          <div className="flex flex-col gap-0.5">
            {lines.map((text, index) => (
              <p
                key={text}
                className={
                  index === 0
                    ? "text-base font-semibold text-foreground"
                    : "text-sm text-muted-foreground"
                }
              >
                {tidyText(text)}
              </p>
            ))}
          </div>
        ) : null}
        {main.length ? grid(main) : null}
        {later.map(([page, list]) => (
          <details key={page} className="group">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              {page}
            </summary>
            <div className="pt-3">{grid(list)}</div>
          </details>
        ))}
      </CardBody>
    </Card>
  );
}

/** Credits and version lines the workbook prints in its title block, kept small at the end. */
function CalcFooter({ calc, layout }: { calc: Calc; layout: SheetLayout }) {
  const texts = layout.footer
    .flatMap((block) => (block.kind === "note" ? [noteText(calc, block).trim()] : []))
    .filter((text, index, all) => text && all.indexOf(text) === index);
  if (!texts.length) return null;
  return <p className="text-xs text-muted-foreground">{texts.map(tidyText).join(" · ")}</p>;
}

function Sections({
  calc,
  sections: all,
  split,
  charts,
}: {
  calc: Calc;
  sections: LayoutSection[];
  split: boolean;
  charts?: (section: LayoutSection) => LayoutChart[];
}) {
  const project = all.find((section) => section.role === "project");
  const sections = all.filter((section) => section !== project);
  const head = project ? <ProjectCard calc={calc} section={project} /> : null;
  const left = sections.filter((section) => section.inputs > 0);
  const right = sections.filter((section) => section.inputs === 0);
  if (split && left.length && right.length) {
    return (
      <>
        {head}
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-6">
            {left.map((section, index) => (
              <SectionCard
                key={`${section.title}-${index}`}
                calc={calc}
                section={section}
                charts={charts?.(section)}
              />
            ))}
          </div>
          <div className="flex flex-col gap-6">
            {right.map((section, index) => (
              <SectionCard
                key={`${section.title}-${index}`}
                calc={calc}
                section={section}
                charts={charts?.(section)}
              />
            ))}
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      {head}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {sections.map((section, index) => (
          <SectionCard
            key={`${section.title}-${index}`}
            calc={calc}
            section={section}
            charts={charts?.(section)}
          />
        ))}
      </div>
    </>
  );
}

/**
 * Which section shows each chart: its own, except that with inputs and results in two columns a
 * chart of results (not a drawing of what was typed) joins the last results section.
 */
function chartHome(layout: SheetLayout, split: boolean, chart: LayoutChart): number | undefined {
  const own = chart.section === undefined ? undefined : layout.sections[chart.section];
  if (!own) return undefined;
  if (!split || chart.drawing || !own.inputs) return chart.section;
  const results = layout.sections.flatMap((section, index) => (section.inputs ? [] : [index]));
  return results.length ? results[results.length - 1] : chart.section;
}

const chartsIn = (layout: SheetLayout, split: boolean) => (section: LayoutSection) => {
  const index = layout.sections.indexOf(section);
  return index < 0
    ? []
    : layout.charts.filter((chart) => chartHome(layout, split, chart) === index);
};

const looseCharts = (layout: SheetLayout) =>
  layout.charts.filter((chart) => chartHome(layout, false, chart) === undefined);

/**
 * A sheet as an app page: its verdict and key results, then its inputs and results in sections
 * as the sheet groups them, and its charts. Inputs the layout could not place stay editable in a
 * section of their own.
 */
export function CalcForm({
  calc,
  sheet,
  title,
  actions,
}: {
  calc: Calc;
  sheet?: string | number;
  title?: string;
  actions?: ReactNode;
}) {
  const layout = useCalcLayout(calc, sheet);
  const loose = useMemo(
    () => (layout ? looseInputs(layout, calc.inputs, calc.model ?? undefined) : []),
    [layout, calc.inputs, calc.model],
  );
  if (calc.status !== "ready" || !layout) return <Loading calc={calc} />;
  const sections: LayoutSection[] = loose.length
    ? [
        ...layout.sections,
        {
          title: "Other inputs",
          blocks: [
            {
              kind: "fields",
              fields: loose.map((input) => ({
                address: input.address,
                label: input.label ?? input.address.replace(/^.*!/, "").toUpperCase(),
                ...(input.unit ? { unit: input.unit } : {}),
                input: true,
              })),
            },
          ],
          inputs: loose.length,
          outputs: 0,
        },
      ]
    : layout.sections;
  const project = layout.sections.find((section) => section.role === "project");
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title={title ?? tidyText(layout.name)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            <CalcPrintButton calc={calc} sheet={layout.sheet} title={title} />
          </div>
        }
        className="mb-0"
      />
      {project ? <ProjectCard calc={calc} section={project} /> : null}
      <CalcSummary calc={calc} layout={layout} />
      <Sections
        calc={calc}
        sections={sections.filter((section) => section !== project)}
        split
        charts={chartsIn(layout, true)}
      />
      {looseCharts(layout).length ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {looseCharts(layout).map((chart, index) => (
            <CalcChart key={index} calc={calc} chart={chart} />
          ))}
        </div>
      ) : null}
      <CalcFooter calc={calc} layout={layout} />
    </div>
  );
}

/**
 * Every sheet, so nothing the workbook works out is out of reach: each one as the app reads it
 * (searchable) or exactly as the workbook lays it out.
 */
export function CalcDetails({ calc, title = "Full calculation" }: { calc: Calc; title?: string }) {
  const sheets = useMemo(() => (calc.model ? detailSheets(calc.model) : []), [calc.model]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [mode, setMode] = useState<"app" | "sheet">("app");
  const [query, setQuery] = useState("");
  const sheet = chosen ?? sheets[0] ?? 0;
  const layout = useCalcLayout(calc, sheet);
  const sections = useMemo(
    () => (layout ? filterSections(layout.sections, query) : []),
    [layout, query],
  );
  if (calc.status !== "ready" || !calc.model || !layout) return <Loading calc={calc} />;
  const model = calc.model;
  const names = sheets.map((index) => ({
    value: String(index),
    label: tidyText(model.sheets[index]!.name),
  }));
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title={title}
        actions={
          <SegmentedControl
            value={mode}
            onChange={setMode}
            options={[
              { value: "app", label: "App", icon: <LayoutList className="size-4" /> },
              { value: "sheet", label: "Sheet", icon: <Grid3x3 className="size-4" /> },
            ]}
          />
        }
        className="mb-0"
      />
      <div className="flex flex-wrap items-center gap-3">
        {names.length > 1 && names.length <= 5 ? (
          <SegmentedControl
            value={String(sheet)}
            onChange={(value) => setChosen(Number(value))}
            options={names}
          />
        ) : names.length > 1 ? (
          <Select
            aria-label="Sheet"
            value={String(sheet)}
            onChange={(event) => setChosen(Number(event.target.value))}
            options={names}
            className="w-56"
          />
        ) : null}
        {mode === "app" ? (
          <SearchInput value={query} onChange={setQuery} className="ml-auto w-full sm:w-64" />
        ) : null}
      </div>
      {mode === "sheet" ? (
        <Card className="overflow-hidden p-2">
          <CalcSheet calc={calc} sheet={model.sheets[sheet]!.name} />
        </Card>
      ) : sections.length ? (
        <>
          <Sections
            calc={calc}
            sections={sections}
            split={false}
            charts={query ? undefined : chartsIn(layout, false)}
          />
          {!query && looseCharts(layout).length ? (
            <div className="grid gap-6 lg:grid-cols-2">
              {looseCharts(layout).map((chart, index) => (
                <CalcChart key={index} calc={calc} chart={chart} />
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="py-12 text-center text-sm text-muted-foreground">No matches</div>
      )}
    </div>
  );
}
