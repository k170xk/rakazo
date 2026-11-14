export type TrackedChange = {
  id: number;
  type: string;
  author: string;
  date: string | null;
  text: string;
};

/** One row of the review list: an insertion, a deletion, or a replacement made of both. */
export type ReviewItem = {
  ids: number[];
  kind: "insert" | "delete" | "replace" | "other";
  author: string;
  date: string | null;
  inserted: string;
  deleted: string;
};

function kindOf(type: string): "insert" | "delete" | "other" {
  const lower = type.toLowerCase();
  if (lower.includes("insert")) return "insert";
  if (lower.includes("delet")) return "delete";
  return "other";
}

/**
 * Pairs a deletion with the insertion right after it from the same author and time, the way a
 * replacement is written, so it is accepted or rejected as one.
 */
export function reviewItems(changes: readonly TrackedChange[]): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const change of changes) {
    const kind = kindOf(change.type);
    const previous = items.at(-1);
    if (
      previous &&
      previous.ids.length === 1 &&
      previous.author === change.author &&
      previous.date === change.date &&
      ((previous.kind === "delete" && kind === "insert") ||
        (previous.kind === "insert" && kind === "delete"))
    ) {
      previous.ids.push(change.id);
      previous.kind = "replace";
      if (kind === "insert") previous.inserted = change.text;
      else previous.deleted = change.text;
      continue;
    }
    items.push({
      ids: [change.id],
      kind,
      author: change.author,
      date: change.date,
      inserted: kind === "delete" ? "" : change.text,
      deleted: kind === "delete" ? change.text : "",
    });
  }
  return items;
}

export function allReviewIds(items: readonly ReviewItem[]): number[] {
  return items.flatMap((item) => item.ids);
}
