import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { addedText, DiffCard, NoChanges, removedText } from "../history/DiffParts";
import type { HistoryFormat } from "../history/format";
import type { PdfDiff, PdfMarkup, PdfPageSnapshot, PdfSnapshot } from "./diff";
import { diffPdf, markupOf } from "./diff";

const PAGES_READ_MAX = 400;

async function readPdfSnapshot(bytes: Uint8Array): Promise<PdfSnapshot> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const pdf = await task.promise;
    const pages: PdfPageSnapshot[] = [];
    for (let number = 1; number <= Math.min(pdf.numPages, PAGES_READ_MAX); number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) if ("str" in item) text += item.str;
      const markups = (await page.getAnnotations()).flatMap((annotation) => {
        const markup = markupOf(annotation);
        return markup ? [markup] : [];
      });
      pages.push({ text: text.replace(/\s+/g, " ").trim(), markups });
    }
    return { pages };
  } finally {
    void task.destroy();
  }
}

function summary(diff: PdfDiff): string {
  if (diff.pages.length === 0) return t`No changes to pages or markups`;
  const added = diff.markupsAdded;
  const removed = diff.markupsRemoved;
  if (added || removed) {
    const parts = [
      added ? plural(added, { one: "# markup added", other: "# markups added" }) : "",
      removed ? plural(removed, { one: "# markup removed", other: "# markups removed" }) : "",
    ].filter(Boolean);
    return parts.join(", ");
  }
  return plural(diff.pages.length, { one: "# page changed", other: "# pages changed" });
}

function MarkupLine({ markup, className }: { markup: PdfMarkup; className: string }) {
  return (
    <span className={`${className} px-1`}>
      {markup.kind}
      {markup.text ? `: ${markup.text}` : ""}
    </span>
  );
}

function PdfDiffView({ diff }: { diff: PdfDiff }) {
  if (diff.pages.length === 0)
    return (
      <NoChanges>
        <Trans>The pages and markups are the same as in the version before.</Trans>
      </NoChanges>
    );
  return (
    <div className="flex flex-col gap-2">
      {diff.pages.map((page) => (
        <DiffCard
          key={page.page}
          title={
            page.status === "added"
              ? t`Page ${page.page} added`
              : page.status === "removed"
                ? t`Page ${page.page} removed`
                : t`Page ${page.page}`
          }
        >
          {page.textChanged ? (
            <p className="text-muted-foreground">
              <Trans>The text on this page changed.</Trans>
            </p>
          ) : null}
          {page.added.map((markup, index) => (
            <MarkupLine key={`a${index}`} markup={markup} className={addedText} />
          ))}
          {page.removed.map((markup, index) => (
            <MarkupLine key={`r${index}`} markup={markup} className={removedText} />
          ))}
        </DiffCard>
      ))}
    </div>
  );
}

export const pdfHistory: HistoryFormat<PdfSnapshot, PdfDiff> & { id: string } = {
  id: "pdf",
  read: readPdfSnapshot,
  compare: diffPdf,
  summary,
  View: PdfDiffView,
};
