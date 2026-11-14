import type {
  DocumentStudioFocus,
  DocumentStudioKind,
  DocumentStudioSelected,
} from "@rakazo/contracts";
import { documentChipLabel, openStudioNote } from "@rakazo/contracts";

/** Words collapsed to one line and cut at `max` characters, with an ellipsis when cut. */
export function clip(text: string | null | undefined, max: number): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function cell(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

/**
 * Rows as a compact markdown table, the first row as its header. At most `maxCells` cells are
 * kept; the rest is left out with a line saying how many rows were.
 */
export function markdownTable(rows: readonly (readonly string[])[], maxCells = 200): string {
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (width === 0) return "";
  const perRow = Math.max(1, width);
  const keep = Math.max(1, Math.floor(maxCells / perRow));
  const kept = rows.slice(0, keep);
  const line = (row: readonly string[]) =>
    `| ${Array.from({ length: width }, (_, i) => cell(row[i] ?? "")).join(" | ")} |`;
  const out = [line(kept[0]!), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`];
  for (const row of kept.slice(1)) out.push(line(row));
  if (rows.length > kept.length) out.push(`… ${rows.length - kept.length} more rows (truncated)`);
  return out.join("\n");
}

export type DocumentContext = {
  kind: DocumentStudioKind;
  /** The file's name, with its extension. */
  name: string;
  rootArtifactId: string;
  artifactId: string;
  version: number;
  focus?: DocumentStudioFocus;
  selected?: DocumentStudioSelected | null;
};

/**
 * What a document studio puts on the chat's dock: the note with the selection, the same note
 * without it (for when the person drops it), and the composer's chip.
 */
export function documentDockPage(context: DocumentContext) {
  const base = {
    kind: context.kind,
    title: context.name,
    documentId: context.rootArtifactId,
    artifactId: context.artifactId,
    version: context.version,
    focus: context.focus,
  };
  const selected = context.selected ?? null;
  return {
    title: context.name.replace(/\.(docx|pptx|xlsx)$/i, ""),
    note: openStudioNote({ ...base, selected }),
    bareNote: openStudioNote({ ...base, selected: null }),
    chip: {
      kind: context.kind,
      title: context.name.replace(/\.(docx|pptx|xlsx)$/i, ""),
      label: documentChipLabel(context.focus, selected),
      bareLabel: documentChipLabel(context.focus, null),
      hasSelection: selected !== null,
    },
  };
}
