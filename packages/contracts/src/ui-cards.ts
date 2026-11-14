import { z } from "zod";

/** Fixed tone vocabulary for bot-filled cards, so a bot never picks raw colours. */
export const UiCardTone = z.enum(["neutral", "positive", "caution", "negative"]);
export type UiCardTone = z.infer<typeof UiCardTone>;

const Text = (max: number) => z.string().trim().min(1).max(max);

const RecordCard = z.object({
  type: z.literal("record"),
  title: Text(120),
  subtitle: z.string().max(200).optional(),
  status: z.string().max(40).optional(),
  tone: UiCardTone.optional(),
  fields: z
    .array(z.object({ label: Text(60), value: z.string().max(400) }))
    .min(1)
    .max(12),
});

const MetricsCard = z.object({
  type: z.literal("metrics"),
  title: Text(120),
  caption: z.string().max(240).optional(),
  metrics: z
    .array(
      z.object({
        label: Text(60),
        value: Text(40),
        change: z.string().max(40).optional(),
        tone: UiCardTone.optional(),
      }),
    )
    .min(1)
    .max(6),
});

const ChecklistCard = z.object({
  type: z.literal("checklist"),
  title: Text(120),
  caption: z.string().max(240).optional(),
  items: z
    .array(z.object({ text: Text(400), done: z.boolean(), note: z.string().max(300).optional() }))
    .min(1)
    .max(20),
});

const NoticeCard = z.object({
  type: z.literal("notice"),
  title: Text(120),
  body: Text(1_000),
  tone: UiCardTone.optional(),
  points: z.array(Text(200)).max(8).optional(),
});

const TableCard = z
  .object({
    type: z.literal("table"),
    title: Text(120),
    caption: z.string().max(240).optional(),
    columns: z.array(Text(60)).min(1).max(8),
    rows: z.array(z.array(z.string().max(300)).max(8)).min(1).max(100),
  })
  .refine(
    (card) => card.rows.every((row) => row.length === card.columns.length),
    "Every row needs one cell per column",
  );

const QuoteCard = z.object({
  type: z.literal("quote"),
  quote: Text(1_000),
  attribution: Text(120),
  context: z.string().max(240).optional(),
});

export const UiCard = z.discriminatedUnion("type", [
  RecordCard,
  MetricsCard,
  ChecklistCard,
  NoticeCard,
  TableCard,
  QuoteCard,
]);
export type UiCard = z.infer<typeof UiCard>;
export const UI_CARD_TYPES = ["record", "metrics", "checklist", "notice", "table", "quote"] as const;

/** Plain text of a card, for copy and for later turns that cannot see the card. */
export function uiCardText(card: UiCard): string {
  switch (card.type) {
    case "record":
      return join(
        card.title,
        card.subtitle,
        card.status,
        ...card.fields.map((field) => `${field.label}: ${field.value}`),
      );
    case "metrics":
      return join(
        card.title,
        card.caption,
        ...card.metrics.map((metric) =>
          metric.change
            ? `${metric.label}: ${metric.value} (${metric.change})`
            : `${metric.label}: ${metric.value}`,
        ),
      );
    case "checklist":
      return join(
        card.title,
        card.caption,
        ...card.items.map((item) => {
          const line = `${item.done ? "[x]" : "[ ]"} ${item.text}`;
          return item.note ? `${line} (${item.note})` : line;
        }),
      );
    case "notice":
      return join(card.title, card.body, ...(card.points ?? []));
    case "table":
      return join(
        card.title,
        card.caption,
        card.columns.join(" | "),
        ...card.rows.map((row) => row.join(" | ")),
      );
    case "quote":
      return join(card.quote, card.attribution, card.context);
  }
}

function join(...values: Array<string | undefined>): string {
  return values.filter((value) => value).join("; ");
}
