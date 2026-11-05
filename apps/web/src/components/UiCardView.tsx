import { useLingui } from "@lingui/react/macro";
import type { UiCard, UiCardTone } from "@rakazo/contracts";
import { uiCardText } from "@rakazo/contracts";
import { cn } from "@rakazo/ui-web";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  Copy,
  Download,
  Info,
  Quote,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { IconTooltip } from "./IconTooltip";

const BADGE_TONES: Record<UiCardTone, string> = {
  neutral: "bg-foreground/5 text-muted-foreground",
  positive: "bg-success/10 text-success",
  caution: "bg-warning/15 text-warning",
  negative: "bg-destructive/10 text-destructive",
};

const TEXT_TONES: Record<UiCardTone, string> = {
  neutral: "text-muted-foreground",
  positive: "text-success",
  caution: "text-warning",
  negative: "text-destructive",
};

/** A card a bot drew with show_card. */
export function UiCardView({ card }: { card: UiCard }) {
  if (card.type === "quote") return <QuoteCard card={card} />;
  if (card.type === "notice") return <NoticeCard card={card} />;
  return (
    <CardFrame
      title={card.title}
      caption={
        "caption" in card ? card.caption : card.type === "record" ? card.subtitle : undefined
      }
      badge={
        card.type === "record" && card.status ? (
          <Badge tone={card.tone ?? "neutral"}>{card.status}</Badge>
        ) : card.type === "checklist" ? (
          <Badge tone={card.items.every((item) => item.done) ? "positive" : "neutral"}>
            {card.items.filter((item) => item.done).length}/{card.items.length}
          </Badge>
        ) : null
      }
      tools={<CardTools card={card} />}
    >
      {card.type === "record" ? (
        <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-[14px]">
          {card.fields.map((field) => (
            <div key={field.label} className="contents">
              <dt className="truncate text-muted-foreground">{field.label}</dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words font-medium">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : card.type === "metrics" ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {card.metrics.map((metric) => (
            <div key={metric.label} className="rounded-xl bg-muted px-3.5 py-3">
              <div className="truncate text-[12.5px] text-muted-foreground">{metric.label}</div>
              <div className="mt-1 truncate text-[22px] font-semibold leading-tight tabular-nums">
                {metric.value}
              </div>
              {metric.change ? (
                <div
                  className={cn(
                    "mt-0.5 text-[12.5px] font-medium",
                    TEXT_TONES[metric.tone ?? "neutral"],
                  )}
                >
                  {metric.change}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : card.type === "checklist" ? (
        <ul className="space-y-2">
          {card.items.map((item) => (
            <li key={item.text} className="flex gap-2.5 text-[14px]">
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-md border",
                  item.done ? "border-success bg-success text-background" : "border-border",
                )}
              >
                {item.done ? <Check className="size-3" strokeWidth={3} /> : null}
              </span>
              <span className="min-w-0">
                <span className={item.done ? "text-muted-foreground line-through" : undefined}>
                  {item.text}
                </span>
                <span className="sr-only">{item.done ? " (done)" : " (to do)"}</span>
                {item.note ? (
                  <span className="block text-[12.5px] text-muted-foreground">{item.note}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <TableBody card={card} />
      )}
    </CardFrame>
  );
}

function CardFrame({
  title,
  caption,
  badge,
  tools,
  children,
}: {
  title: string;
  caption?: string;
  badge?: ReactNode;
  tools?: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure className="group/card w-[min(42rem,100%)] min-w-0 overflow-hidden rounded-[20px] border border-border bg-card text-foreground dark:border-transparent">
      <figcaption className="flex items-start justify-between gap-3 border-b border-border py-3 ps-5 pe-3">
        <div className="min-w-0 pt-0.5">
          <p className="truncate text-[14px] font-medium">{title}</p>
          {caption ? <p className="mt-0.5 text-[12.5px] text-muted-foreground">{caption}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {badge}
          {tools}
        </div>
      </figcaption>
      <div className="px-5 py-4">{children}</div>
    </figure>
  );
}

function Badge({ tone, children }: { tone: UiCardTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[12px] font-medium",
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <IconTooltip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="grid size-7 place-items-center rounded-lg text-muted-foreground opacity-60 transition hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:opacity-100 group-hover/card:opacity-100"
      >
        {children}
      </button>
    </IconTooltip>
  );
}

function CardTools({ card }: { card: UiCard }) {
  const { t } = useLingui();
  const [copied, setCopied] = useState(false);
  async function copy() {
    const text = card.type === "table" ? tableCsv(card, "\t") : uiCardText(card);
    await navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <>
      <ToolButton label={copied ? t`Copied` : t`Copy`} onClick={() => void copy()}>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </ToolButton>
      {card.type === "table" ? (
        <ToolButton label={t`Download CSV`} onClick={() => downloadCsv(card)}>
          <Download className="size-3.5" />
        </ToolButton>
      ) : null}
    </>
  );
}

type TableCard = Extract<UiCard, { type: "table" }>;

function TableBody({ card }: { card: TableCard }) {
  const { t } = useLingui();
  const [sort, setSort] = useState<{ column: number; descending: boolean } | null>(null);
  const rows = useMemo(() => {
    if (!sort) return card.rows;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    return [...card.rows].sort((a, b) => {
      const order = collator.compare(a[sort.column] ?? "", b[sort.column] ?? "");
      return sort.descending ? -order : order;
    });
  }, [card.rows, sort]);
  return (
    <div className="-mx-5 -my-4 max-h-[480px] overflow-auto">
      <table className="w-full border-collapse text-[13.5px]">
        <thead className="sticky top-0 bg-card">
          <tr>
            {card.columns.map((column, index) => (
              <th
                key={column}
                scope="col"
                aria-sort={
                  sort?.column === index ? (sort.descending ? "descending" : "ascending") : "none"
                }
                className="border-b border-border px-0 text-start font-medium text-muted-foreground first:ps-2 last:pe-2"
              >
                <button
                  type="button"
                  title={t`Sort by ${column}`}
                  onClick={() =>
                    setSort((current) =>
                      current?.column === index
                        ? current.descending
                          ? null
                          : { column: index, descending: true }
                        : { column: index, descending: false },
                    )
                  }
                  className="inline-flex w-full items-center gap-1 rounded-md px-3 py-2 text-start hover:text-foreground"
                >
                  {column}
                  {sort?.column === index ? (
                    sort.descending ? (
                      <ArrowDown aria-hidden className="size-3" />
                    ) : (
                      <ArrowUp aria-hidden className="size-3" />
                    )
                  ) : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-border last:border-0 hover:bg-accent/50">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className="px-3 py-2 align-top first:ps-5 last:pe-5 whitespace-pre-wrap break-words"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function tableCsv(card: TableCard, separator = ","): string {
  const cell = (value: string) =>
    separator === "," && /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return [card.columns, ...card.rows].map((row) => row.map(cell).join(separator)).join("\n");
}

function downloadCsv(card: TableCard) {
  const url = URL.createObjectURL(new Blob([tableCsv(card)], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${card.title.replace(/[^\w\- ]+/g, "").trim() || "table"}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function NoticeCard({ card }: { card: Extract<UiCard, { type: "notice" }> }) {
  const tone = card.tone ?? "neutral";
  const Icon = tone === "negative" ? CircleAlert : tone === "caution" ? TriangleAlert : Info;
  return (
    <div
      className={cn(
        "w-full min-w-0 max-w-2xl rounded-[20px] border px-5 py-4",
        tone === "negative"
          ? "border-destructive/30 bg-destructive/5"
          : tone === "caution"
            ? "border-warning/30 bg-warning/5"
            : tone === "positive"
              ? "border-success/30 bg-success/5"
              : "border-border bg-card dark:border-transparent",
      )}
    >
      <div className="flex gap-3">
        <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", TEXT_TONES[tone])} />
        <div className="min-w-0">
          <p className="text-[14.5px] font-medium">{card.title}</p>
          <p className="mt-1 whitespace-pre-wrap text-[14px] leading-[1.55] text-foreground/90">
            {card.body}
          </p>
          {card.points?.length ? (
            <ul className="mt-2 list-disc space-y-1 ps-5 text-[14px]">
              {card.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function QuoteCard({ card }: { card: Extract<UiCard, { type: "quote" }> }) {
  return (
    <figure className="w-full min-w-0 max-w-2xl rounded-[20px] border border-border bg-card px-5 py-4 dark:border-transparent">
      <Quote aria-hidden className="size-5 text-primary" />
      <blockquote className="mt-2 whitespace-pre-wrap text-[16px] leading-[1.55]">
        {card.quote}
      </blockquote>
      <figcaption className="mt-3 text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground">{card.attribution}</span>
        {card.context ? <span> · {card.context}</span> : null}
      </figcaption>
    </figure>
  );
}
