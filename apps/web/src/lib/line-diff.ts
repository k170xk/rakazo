/**
 * Line diffs for the App Studio's history: what each version added (green) and removed (red),
 * shown as hunks with a few unchanged lines around each change.
 */

export type DiffLine =
  | { kind: "same"; text: string; oldLine: number; newLine: number }
  | { kind: "added"; text: string; newLine: number }
  | { kind: "removed"; text: string; oldLine: number };

export type DiffHunk = { lines: DiffLine[]; skippedBefore: number };

export type FileDiff = {
  name: string;
  status: "added" | "removed" | "changed";
  added: number;
  removed: number;
  hunks: DiffHunk[];
  /** Too different to line up; shown as the whole file removed and added. */
  rewritten?: boolean;
};

/** Beyond this many edits the Myers search stops and the file is shown as rewritten. */
const MAX_EDITS = 1200;

function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Myers' O(ND) diff on lines; null when the files differ in more than MAX_EDITS lines. */
function myers(a: string[], b: string[]): DiffLine[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
          ? v[offset + k + 1]!
          : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
    v = next;
  }
  if (!found) return null;
  trace.push(v);

  const out: DiffLine[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 2; d >= 0; d--) {
    const prev = trace[d]!;
    const k = x - y;
    const down = k === -d || (k !== d && prev[offset + k - 1]! < prev[offset + k + 1]!);
    const prevK = down ? k + 1 : k - 1;
    const prevX = prev[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      out.push({ kind: "same", text: a[x]!, oldLine: x + 1, newLine: y + 1 });
    }
    if (d > 0) {
      if (down) {
        y--;
        out.push({ kind: "added", text: b[y]!, newLine: y + 1 });
      } else {
        x--;
        out.push({ kind: "removed", text: a[x]!, oldLine: x + 1 });
      }
    }
  }
  return out.reverse();
}

/** Every line of a file, in order, as unchanged, added or removed. */
export function diffLines(
  before: string,
  after: string,
): { lines: DiffLine[]; rewritten: boolean } {
  const a = splitLines(before);
  const b = splitLines(after);
  const lines = myers(a, b);
  if (lines) return { lines, rewritten: false };
  return {
    lines: [
      ...a.map((text, i): DiffLine => ({ kind: "removed", text, oldLine: i + 1 })),
      ...b.map((text, i): DiffLine => ({ kind: "added", text, newLine: i + 1 })),
    ],
    rewritten: true,
  };
}

/** The changed lines with `context` unchanged lines around each run; the rest is counted. */
export function toHunks(lines: DiffLine[], context = 3): DiffHunk[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.kind === "same") return;
    for (
      let i = Math.max(0, index - context);
      i <= Math.min(lines.length - 1, index + context);
      i++
    )
      keep[i] = true;
  });
  const hunks: DiffHunk[] = [];
  let skipped = 0;
  let current: DiffHunk | null = null;
  lines.forEach((line, index) => {
    if (!keep[index]) {
      skipped++;
      current = null;
      return;
    }
    if (!current) {
      current = { lines: [], skippedBefore: skipped };
      hunks.push(current);
      skipped = 0;
    }
    current.lines.push(line);
  });
  return hunks;
}

/** What changed between two versions' files, one entry per file that differs. */
export function diffFiles(
  before: Record<string, string>,
  after: Record<string, string>,
): FileDiff[] {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort((a, b) =>
    a === "App.tsx" ? -1 : b === "App.tsx" ? 1 : a.localeCompare(b),
  );
  const out: FileDiff[] = [];
  for (const name of names) {
    const old = before[name];
    const next = after[name];
    if (old === next) continue;
    const { lines, rewritten } = diffLines(old ?? "", next ?? "");
    out.push({
      name,
      status: old === undefined ? "added" : next === undefined ? "removed" : "changed",
      added: lines.filter((line) => line.kind === "added").length,
      removed: lines.filter((line) => line.kind === "removed").length,
      hunks: toHunks(lines),
      ...(rewritten ? { rewritten } : {}),
    });
  }
  return out;
}
