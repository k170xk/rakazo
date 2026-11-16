import { useLingui } from "@lingui/react/macro";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, X } from "lucide-react";

/**
 * What an import from Excel found: for a calculator, whether every formula matched the results
 * Excel saved (and which did not); for tables, what each sheet became.
 */
export function ImportReport({
  title,
  lines,
  verified,
  onDismiss,
}: {
  title: string;
  lines: string[];
  /** A calculator's check against Excel's results; null for tables. */
  verified: boolean | null;
  onDismiss: () => void;
}) {
  const { t } = useLingui();
  const [summary, ...rest] = lines;
  const Icon =
    verified === true ? CheckCircle2 : verified === false ? AlertTriangle : FileSpreadsheet;
  return (
    <section
      role="status"
      className="w-full rounded-lg border border-foreground/[0.08] bg-card px-3 py-2.5 text-[12px] text-foreground"
    >
      <div className="flex items-start gap-2">
        <Icon
          aria-hidden
          className={
            verified === true
              ? "mt-0.5 size-4 shrink-0 text-success"
              : verified === false
                ? "mt-0.5 size-4 shrink-0 text-warning"
                : "mt-0.5 size-4 shrink-0 text-primary"
          }
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          {summary ? <p className="mt-0.5 text-muted-foreground">{summary}</p> : null}
        </div>
        <button
          type="button"
          aria-label={t`Dismiss`}
          className="rounded p-0.5 text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
          onClick={onDismiss}
        >
          <X className="size-3.5" />
        </button>
      </div>
      {rest.length ? (
        <details className="mt-1.5 pl-6" open={verified === false}>
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            {t`Details`}
          </summary>
          <ul className="mt-1 max-h-48 list-disc overflow-y-auto pl-4 text-muted-foreground">
            {rest.slice(0, 40).map((line, index) => (
              <li key={`${index}-${line}`} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
