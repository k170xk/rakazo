import type { ReactNode } from "react";
import type { WordSegment } from "./sequence";

export const addedText = "rounded-sm bg-emerald-500/15 text-foreground";
export const removedText = "rounded-sm bg-red-500/15 text-muted-foreground line-through";

/** Text with its added words highlighted and removed words struck through. */
export function Segments({ segments }: { segments: readonly WordSegment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === "same" ? (
          <span key={index}>{segment.text}</span>
        ) : segment.kind === "added" ? (
          <ins key={index} className={`${addedText} no-underline`}>
            {segment.text}
          </ins>
        ) : (
          <del key={index} className={removedText}>
            {segment.text}
          </del>
        ),
      )}
    </>
  );
}

/** A bordered card with a small header, as the App Studio's file diffs use. */
export function DiffCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-foreground/[0.08] bg-background">
      <header className="border-b border-foreground/[0.06] bg-foreground/[0.03] px-3 py-1.5 text-[12px] font-medium text-foreground/80">
        {title}
      </header>
      <div className="flex flex-col gap-1.5 px-3 py-2 text-[12.5px] leading-relaxed">
        {children}
      </div>
    </section>
  );
}

/** Shown when two versions read the same. */
export function NoChanges({ children }: { children: ReactNode }) {
  return <p className="px-1 py-2 text-[12px] text-muted-foreground">{children}</p>;
}
