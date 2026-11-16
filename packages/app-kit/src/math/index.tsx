import katex from "katex";
import type { ReactNode } from "react";
import type { CheckMode, NumberStyle } from "../eng/format.js";
import { check } from "../eng/format.js";
import type { PdfBlock } from "../pdf/model.js";
import { PRINT_LIGHT } from "../plot/print.js";
import { Badge, Progress } from "../ui/basic.js";
import { cn } from "../ui/cn.js";
import { ensureKatexStyle } from "./katex-style.js";
import { subst, texQty } from "./tex.js";
import { texText } from "./text.js";

export { subst, texNum, texQty, texUnit } from "./tex.js";
export type { TexTextOptions } from "./text.js";
export { texText } from "./text.js";

const rendered = new Map<string, string>();

/** KaTeX HTML for a formula; errors show the source in the destructive colour instead of throwing. */
export function renderTex(math: string, block = false): string {
  const key = `${block ? "B" : "I"}${math}`;
  let html = rendered.get(key);
  if (html === undefined) {
    html = katex.renderToString(math, {
      displayMode: block,
      throwOnError: false,
      errorColor: "hsl(var(--destructive))",
      output: "htmlAndMathml",
      strict: "ignore",
      trust: false,
    });
    if (rendered.size > 500) rendered.clear();
    rendered.set(key, html);
  }
  return html;
}

export type TexProps = {
  /** LaTeX source (or pass it as the child string). */
  math?: string;
  children?: string;
  /** Centred display maths on its own line. */
  block?: boolean;
  className?: string;
};

/** LaTeX maths: <Tex math="M_{Ed} = \\frac{wL^2}{8}" /> inline, or block for display equations. */
export function Tex({ math, children, block, className }: TexProps) {
  ensureKatexStyle();
  const html = renderTex(math ?? children ?? "", block);
  const Tag = block ? "div" : "span";
  return (
    <Tag
      className={cn(
        block ? "max-w-full overflow-x-auto overflow-y-hidden py-1 print:overflow-visible" : "",
        className,
      )}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output with trust off (no links, classes or styles from the source)
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

const ROW =
  "grid gap-x-5 gap-y-1 py-3 sm:grid-cols-[6.5rem_minmax(0,1fr)_minmax(8rem,auto)] print:break-inside-avoid";

function RefCell({ children }: { children?: ReactNode }) {
  return (
    <div className="text-xs font-medium text-muted-foreground tabular sm:pt-1">{children}</div>
  );
}

export type CalcSheetProps = {
  title: ReactNode;
  /** Header fields printed on every consultancy calculation sheet; only those given show. */
  job?: ReactNode;
  by?: ReactNode;
  checked?: ReactNode;
  date?: ReactNode;
  revision?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * A calculation sheet: Ref | Calculation | Output columns, as consultancy calc pads lay them out,
 * with the job header. Holds CalcSection, CalcStep, Check and CalcNote rows; prints dark on white.
 */
export function CalcSheet({
  title,
  job,
  by,
  checked,
  date,
  revision,
  actions,
  children,
  className,
}: CalcSheetProps) {
  const meta = [
    ["Job", job],
    ["By", by],
    ["Checked", checked],
    ["Date", date],
    ["Rev", revision],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");
  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-card text-card-foreground shadow-card",
        PRINT_LIGHT,
        "print:break-inside-auto print:rounded-none print:border-0",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-lg font-bold">{title}</h2>
          {meta.length > 0 && (
            <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              {meta.map(([label, value]) => (
                <div key={String(label)} className="flex gap-1.5">
                  <dt>{label}</dt>
                  <dd className="font-semibold text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        {actions && <div className="flex gap-2 print:hidden">{actions}</div>}
      </header>
      <div className="hidden gap-x-5 border-b border-border px-5 py-2 text-[11px] font-bold tracking-wider text-muted-foreground uppercase sm:grid sm:grid-cols-[6.5rem_minmax(0,1fr)_minmax(8rem,auto)]">
        <span>Ref</span>
        <span>Calculation</span>
        <span className="text-right">Output</span>
      </div>
      <div className="divide-y divide-border/70 px-5">{children}</div>
    </section>
  );
}

/** A numbered heading inside a CalcSheet. */
export function CalcSection({
  title,
  reference,
  children,
}: {
  title: ReactNode;
  reference?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="print:break-inside-avoid">
      <div className={cn(ROW, "pt-5 pb-1")}>
        <RefCell>{reference}</RefCell>
        <h3 className="text-sm font-bold tracking-wide text-primary uppercase">{title}</h3>
      </div>
      {children && <div className="divide-y divide-border/70">{children}</div>}
    </div>
  );
}

/** Free text (assumptions, design basis) in the calculation column. */
export function CalcNote({ reference, children }: { reference?: ReactNode; children: ReactNode }) {
  return (
    <div className={ROW}>
      <RefCell>{reference}</RefCell>
      <div className="text-sm text-foreground/90">{children}</div>
    </div>
  );
}

export type CalcStepProps = {
  /** What the step works out, e.g. "Design moment". */
  label?: ReactNode;
  /** LaTeX for the quantity, e.g. "M_{Ed}". */
  symbol: string;
  /** Symbolic LaTeX right-hand side, e.g. "\\frac{w L^2}{8}". */
  formula?: string;
  /** Numbers substituted into the formula by symbol ({w: 12.5, L: 6}); or give `substitution` LaTeX yourself. */
  values?: Record<string, number>;
  substitution?: string;
  /** The computed result: pass the number your calculation produced, never re-derive it here. */
  result: number;
  unit?: string;
  /** Rounding of the shown result (default 4 significant figures). */
  style?: NumberStyle;
  /** Rounding of substituted values (default the same as the result). */
  valueStyle?: NumberStyle;
  /** Code clause or source, e.g. "EN 1992-1-1 cl. 6.2.2". */
  reference?: ReactNode;
  note?: ReactNode;
};

/** The LaTeX for a step: symbol = formula = substitution = result unit, on aligned lines when long. */
export function stepTex({
  symbol,
  formula,
  values,
  substitution,
  result,
  unit,
  style,
  valueStyle,
}: CalcStepProps): string {
  const substituted =
    substitution ?? (formula && values ? subst(formula, values, valueStyle ?? style) : undefined);
  const final = texQty(result, unit, style);
  const lines = [formula, substituted, final].filter((line): line is string => Boolean(line));
  if (lines.join("").length <= 64) return `${symbol} = ${lines.join(" = ")}`;
  return `\\begin{aligned} ${symbol} &= ${lines.join(" \\\\ &= ")} \\end{aligned}`;
}

/** One calculation step: the formula, the numbers in it and the result with its unit and reference. */
export function CalcStep(props: CalcStepProps) {
  const { label, symbol, result, unit, style, reference, note } = props;
  return (
    <div className={ROW}>
      <RefCell>{reference}</RefCell>
      <div className="min-w-0">
        {label && <p className="text-sm font-semibold">{label}</p>}
        <Tex
          block
          math={stepTex(props)}
          className="text-left [&_.katex-display]:my-1 [&_.katex-display]:text-left [&_.katex-display>.katex]:text-left"
        />
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      <div className="text-sm font-bold sm:pt-1 sm:text-right">
        <Tex math={`${symbol} = ${texQty(result, unit, style)}`} />
      </div>
    </div>
  );
}

export type CheckProps = {
  label?: ReactNode;
  /** LaTeX for the checked quantity and the limit, e.g. "M_{Ed}" and "M_{Rd}". */
  symbol?: string;
  limitSymbol?: string;
  value: number;
  limit: number;
  /** "max": value must not exceed the limit (default); "min": value must reach it. */
  mode?: CheckMode;
  unit?: string;
  style?: NumberStyle;
  reference?: ReactNode;
};

/** The comparison as LaTeX, its sign showing the verdict: M_{Ed} = 120 kNm \le M_{Rd} = 150 kNm. */
export function checkTex({
  symbol,
  limitSymbol,
  value,
  limit,
  mode = "max",
  unit,
  style,
}: CheckProps): string {
  const { pass } = check(value, limit, mode);
  const relation = mode === "max" ? (pass ? "\\le" : ">") : pass ? "\\ge" : "<";
  const side = (sym: string | undefined, x: number) =>
    sym ? `${sym} = ${texQty(x, unit, style)}` : texQty(x, unit, style);
  return `${side(symbol, value)} ${relation} ${side(limitSymbol, limit)}`;
}

/** A design check with the comparison, pass or fail, and utilisation rounded up to two decimals. */
export function Check(props: CheckProps) {
  const { label, value, limit, mode = "max", reference } = props;
  const result = check(value, limit, mode);
  return (
    <div className={ROW}>
      <RefCell>{reference}</RefCell>
      <div className="min-w-0">
        {label && <p className="text-sm font-semibold">{label}</p>}
        <Tex
          block
          math={checkTex(props)}
          className="[&_.katex-display]:my-1 [&_.katex-display]:text-left [&_.katex-display>.katex]:text-left"
        />
      </div>
      <div className="flex items-start sm:justify-end sm:pt-1">
        <Badge tone={result.pass ? "success" : "danger"} className="tabular">
          <span role="status">{`${result.pass ? "Pass" : "Fail"} ${result.shown}`}</span>
        </Badge>
      </div>
    </div>
  );
}

/** A calculation written once as data: <CalcRows rows> shows it, calcPdfBlocks(rows) prints it. */
export type CalcRow =
  | { kind: "section"; title: string; reference?: string }
  | { kind: "note"; text: string; reference?: string }
  | ({ kind: "step"; label?: string; reference?: string; note?: string } & Omit<
      CalcStepProps,
      "label" | "reference" | "note"
    >)
  | ({ kind: "check"; label?: string; reference?: string } & Omit<
      CheckProps,
      "label" | "reference"
    >);

/** CalcSheet rows from data (keep the same rows for the PDF). */
export function CalcRows({ rows }: { rows: CalcRow[] }) {
  return (
    <>
      {rows.map((row, i) => {
        const key = `${row.kind}-${i}`;
        if (row.kind === "section")
          return <CalcSection key={key} title={row.title} reference={row.reference} />;
        if (row.kind === "note")
          return (
            <CalcNote key={key} reference={row.reference}>
              {row.text}
            </CalcNote>
          );
        if (row.kind === "step") return <CalcStep key={key} {...row} />;
        return <Check key={key} {...row} />;
      })}
    </>
  );
}

const PDF_COLUMNS = [
  { label: "Ref", width: 26 },
  "Calculation",
  { label: "Output", align: "right" as const, width: 44 },
];

/**
 * The rows as report blocks for PrintButton or printPdf: a sub-heading per section and a
 * Ref | Calculation | Output table, the formulas written out in text the PDF fonts can print.
 */
export function calcPdfBlocks(rows: CalcRow[]): PdfBlock[] {
  const text = (latex: string) => texText(latex, { latin: true });
  const blocks: PdfBlock[] = [];
  let table: Array<Array<string>> = [];
  const flush = () => {
    if (table.length > 0) blocks.push({ type: "table", columns: PDF_COLUMNS, rows: table });
    table = [];
  };
  for (const row of rows) {
    if (row.kind === "section") {
      flush();
      blocks.push({
        type: "subheading",
        text: row.reference ? `${row.title} (${row.reference})` : row.title,
      });
    } else if (row.kind === "note") {
      table.push([row.reference ?? "", row.text, ""]);
    } else if (row.kind === "step") {
      const substituted =
        row.substitution ??
        (row.formula && row.values
          ? subst(row.formula, row.values, row.valueStyle ?? row.style)
          : undefined);
      const line = [row.symbol, row.formula, substituted, texQty(row.result, row.unit, row.style)]
        .filter(Boolean)
        .join(" = ");
      const calc = [row.label, text(line), row.note].filter(Boolean).join("\n");
      table.push([
        row.reference ?? "",
        calc,
        text(`${row.symbol} = ${texQty(row.result, row.unit, row.style)}`),
      ]);
    } else {
      const result = check(row.value, row.limit, row.mode);
      const calc = [row.label, text(checkTex(row))].filter(Boolean).join("\n");
      table.push([row.reference ?? "", calc, `${result.pass ? "Pass" : "Fail"} ${result.shown}`]);
    }
  }
  flush();
  return blocks;
}

export type CheckItem = {
  label: string;
  value: number;
  limit: number;
  mode?: CheckMode;
  reference?: string;
};

/** Every check with its utilisation; the governing one first in weight. */
export function CheckSummary({ checks, className }: { checks: CheckItem[]; className?: string }) {
  const results = checks.map((item) => ({ item, ...check(item.value, item.limit, item.mode) }));
  const governing = results.reduce<number>(
    (best, r, i) => (r.utilisation > (results[best]?.utilisation ?? -1) ? i : best),
    0,
  );
  return (
    <div className={cn("flex flex-col gap-2 print:break-inside-avoid", className)}>
      {results.map((r, i) => (
        <div
          key={`${r.item.label}-${i}`}
          className="grid grid-cols-[minmax(0,1fr)_5rem_4.5rem] items-center gap-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(6rem,12rem)_4.5rem]"
        >
          <span className={cn("min-w-0 truncate", i === governing ? "font-bold" : "")}>
            {r.item.label}
            {r.item.reference && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {r.item.reference}
              </span>
            )}
          </span>
          <Progress
            value={Math.min(100, r.utilisation * 100)}
            tone={!r.pass ? "danger" : r.utilisation > 0.9 ? "warning" : "success"}
          />
          <Badge tone={r.pass ? "success" : "danger"} className="justify-self-end tabular">
            {r.shown}
          </Badge>
        </div>
      ))}
    </div>
  );
}
