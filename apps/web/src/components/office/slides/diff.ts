import type { WordSegment } from "../history/sequence";
import { diffSequence, wordSegments } from "../history/sequence";

/** One slide as the history compares it. */
export type SlideSnapshot = { title: string; texts: string[]; notes: string; hidden: boolean };

export type DeckSnapshot = { slides: SlideSnapshot[] };

export type SlideChange =
  | { kind: "added"; at: number; slide: SlideSnapshot }
  | { kind: "removed"; from: number; slide: SlideSnapshot }
  | { kind: "moved"; from: number; at: number; slide: SlideSnapshot }
  | {
      kind: "changed";
      from: number;
      at: number;
      before: SlideSnapshot;
      after: SlideSnapshot;
      text: WordSegment[] | null;
      notes: WordSegment[] | null;
      hidden: boolean;
    };

export type DeckDiff = {
  changes: SlideChange[];
  added: number;
  removed: number;
  moved: number;
  /** Slides whose text (title included) changed. */
  textChanged: number;
  notesChanged: number;
};

function bodyText(slide: SlideSnapshot): string {
  return [slide.title, ...slide.texts].filter(Boolean).join(" / ");
}

function signature(slide: SlideSnapshot): string {
  return `${bodyText(slide)}\u0001${slide.notes}\u0001${slide.hidden ? 1 : 0}`;
}

/** Each slide's title, other text, notes and whether it is hidden. */
export async function readDeckSnapshot(bytes: Uint8Array): Promise<DeckSnapshot> {
  const pptx = await import("@office-kit/pptx");
  const pres = await pptx.loadPresentation(bytes);
  return {
    slides: pptx.getSlides(pres).map((slide) => {
      const title = (pptx.getSlideTitle(slide) ?? "").replace(/\s+/g, " ").trim();
      const texts = pptx
        .getSlideShapes(slide)
        .map((shape) => (pptx.getShapeText(shape) ?? "").replace(/\s+/g, " ").trim())
        .filter((text) => text && text !== title);
      return {
        title,
        texts,
        notes: (pptx.getSlideNotes(slide) ?? "").replace(/\s+/g, " ").trim(),
        hidden: pptx.isSlideHidden(slide),
      };
    }),
  };
}

/** Slide by slide: added, removed, moved, or changed in its text, notes or visibility. */
export function diffDeck(before: DeckSnapshot | null, after: DeckSnapshot): DeckDiff {
  const lined = diffSequence(before?.slides ?? [], after.slides, signature, { pair: false });
  const removed = lined.filter((c) => c.kind === "removed");
  const added = lined.filter((c) => c.kind === "added");
  // A slide removed in one place and added unchanged in another was moved.
  const movedTo = new Map<number, number>();
  const taken = new Set<number>();
  for (const r of removed) {
    const match = added.find(
      (a) => !taken.has(a.afterIndex) && signature(a.after) === signature(r.before),
    );
    if (match) {
      taken.add(match.afterIndex);
      movedTo.set(r.beforeIndex, match.afterIndex);
    }
  }
  const changes: SlideChange[] = [];
  // Between kept slides, what was removed and added (moves aside) is read as slides edited in place.
  let gone: { slide: SlideSnapshot; index: number }[] = [];
  let fresh: { slide: SlideSnapshot; index: number }[] = [];
  const flush = () => {
    const pairs = Math.min(gone.length, fresh.length);
    for (let i = 0; i < pairs; i++) {
      const was = gone[i]!;
      const now = fresh[i]!;
      const textBefore = bodyText(was.slide);
      const textAfter = bodyText(now.slide);
      changes.push({
        kind: "changed",
        from: was.index,
        at: now.index,
        before: was.slide,
        after: now.slide,
        text: textBefore === textAfter ? null : wordSegments(textBefore, textAfter),
        notes:
          was.slide.notes === now.slide.notes
            ? null
            : wordSegments(was.slide.notes, now.slide.notes),
        hidden: was.slide.hidden !== now.slide.hidden,
      });
    }
    for (const g of gone.slice(pairs))
      changes.push({ kind: "removed", from: g.index, slide: g.slide });
    for (const f of fresh.slice(pairs))
      changes.push({ kind: "added", at: f.index, slide: f.slide });
    gone = [];
    fresh = [];
  };
  for (const change of lined) {
    if (change.kind === "same") flush();
    else if (change.kind === "removed") {
      const at = movedTo.get(change.beforeIndex);
      if (at === undefined) gone.push({ slide: change.before, index: change.beforeIndex });
      else changes.push({ kind: "moved", from: change.beforeIndex, at, slide: change.before });
    } else if (change.kind === "added") {
      if (!taken.has(change.afterIndex))
        fresh.push({ slide: change.after, index: change.afterIndex });
    }
  }
  flush();
  changes.sort((a, b) => ("at" in a ? a.at : a.from) - ("at" in b ? b.at : b.from));
  return {
    changes,
    added: changes.filter((c) => c.kind === "added").length,
    removed: changes.filter((c) => c.kind === "removed").length,
    moved: changes.filter((c) => c.kind === "moved").length,
    textChanged: changes.filter((c) => c.kind === "changed" && c.text).length,
    notesChanged: changes.filter((c) => c.kind === "changed" && c.notes).length,
  };
}
