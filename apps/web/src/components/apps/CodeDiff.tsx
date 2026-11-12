import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import type { DiffLine } from "../../lib/line-diff";
import { diffFiles } from "../../lib/line-diff";

const ROW: Record<DiffLine["kind"], string> = {
  same: "text-foreground/75",
  added: "bg-emerald-500/15 text-foreground",
  removed: "bg-red-500/15 text-foreground",
};
const MARK: Record<DiffLine["kind"], string> = { same: " ", added: "+", removed: "−" };
const MARK_COLOR: Record<DiffLine["kind"], string> = {
  same: "",
  added: "text-emerald-600 font-semibold",
  removed: "text-red-600 font-semibold",
};

/** Every file that differs between two versions, added lines in green and removed in red. */
export function CodeDiff({
  before,
  after,
}: {
  before: Record<string, string>;
  after: Record<string, string>;
}) {
  const { t } = useLingui();
  const files = useMemo(() => diffFiles(before, after), [before, after]);
  if (!files.length) {
    return <p className="px-1 py-2 text-[12px] text-muted-foreground">{t`No code changed.`}</p>;
  }
  return (
    <div className="flex flex-col gap-3" data-testid="code-diff">
      {files.map((file) => (
        <section
          key={file.name}
          className="overflow-hidden rounded-lg border border-foreground/[0.08] bg-background"
        >
          <header className="flex items-center gap-2 border-b border-foreground/[0.06] bg-foreground/[0.03] px-3 py-1.5 text-[12px]">
            <span className="min-w-0 flex-1 truncate font-mono font-medium">{file.name}</span>
            {file.status === "added" ? (
              <span className="text-emerald-600">{t`New file`}</span>
            ) : file.status === "removed" ? (
              <span className="text-red-600">{t`Deleted`}</span>
            ) : null}
            <span className="font-mono tabular-nums text-emerald-600">+{file.added}</span>
            <span className="font-mono tabular-nums text-red-600">−{file.removed}</span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse font-mono text-[11.5px] leading-[18px]">
              <tbody>
                {file.hunks.map((hunk, index) => (
                  <HunkRows
                    // Hunks of one file never reorder.
                    key={index}
                    lines={hunk.lines}
                    skipped={hunk.skippedBefore}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function HunkRows({ lines, skipped }: { lines: DiffLine[]; skipped: number }) {
  const { t } = useLingui();
  return (
    <>
      {skipped > 0 ? (
        <tr>
          <td
            colSpan={4}
            className="bg-foreground/[0.03] px-3 py-0.5 text-[11px] text-muted-foreground"
          >
            {skipped === 1 ? t`1 unchanged line` : t`${skipped} unchanged lines`}
          </td>
        </tr>
      ) : null}
      {lines.map((line) => (
        <tr
          key={`${line.kind}:${"oldLine" in line ? line.oldLine : ""}:${"newLine" in line ? line.newLine : ""}`}
          className={ROW[line.kind]}
        >
          <td className="w-9 select-none pe-1 text-end align-top text-muted-foreground/70">
            {"oldLine" in line ? line.oldLine : ""}
          </td>
          <td className="w-9 select-none pe-1 text-end align-top text-muted-foreground/70">
            {"newLine" in line ? line.newLine : ""}
          </td>
          <td className={`w-4 select-none text-center align-top ${MARK_COLOR[line.kind]}`}>
            {MARK[line.kind]}
          </td>
          <td className="whitespace-pre pe-3 align-top">{line.text || " "}</td>
        </tr>
      ))}
    </>
  );
}
