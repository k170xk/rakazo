import * as z from "zod";

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
    .array(z.object({ text: Text(200), done: z.boolean(), note: z.string().max(200).optional() }))
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
    rows: z
      .array(z.array(z.string().max(300)).max(8))
      .min(1)
      .max(100),
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
export const UI_CARD_TYPES = [
  "record",
  "metrics",
  "checklist",
  "notice",
  "table",
  "quote",
] as const;

/** A card as plain text, for chat history, quotes and previews. */
export function uiCardText(card: UiCard): string {
  switch (card.type) {
    case "record":
      return [
        card.title,
        card.status,
        ...card.fields.map((field) => `${field.label}: ${field.value}`),
      ]
        .filter(Boolean)
        .join("; ");
    case "metrics":
      return [
        card.title,
        ...card.metrics.map((metric) =>
          [`${metric.label}: ${metric.value}`, metric.change].filter(Boolean).join(" "),
        ),
      ].join("; ");
    case "checklist":
      return [
        card.title,
        ...card.items.map((item) => `${item.done ? "[x]" : "[ ]"} ${item.text}`),
      ].join("; ");
    case "notice":
      return [card.title, card.body, ...(card.points ?? [])].join("; ");
    case "table":
      return [
        card.title,
        card.columns.join(" | "),
        ...card.rows.slice(0, 20).map((row) => row.join(" | ")),
      ].join("; ");
    case "quote":
      return `"${card.quote}" — ${card.attribution}`;
  }
}
