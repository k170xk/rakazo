import { Printer } from "lucide-react";
import { useState } from "react";
import type { PdfBlock, PdfDocument } from "../pdf/model.js";
import { canPrintPdf, printPdf, useApp } from "../sdk/index.js";
import type { ButtonProps } from "./basic.js";
import { Button } from "./basic.js";
import { toast } from "./overlay.js";

/**
 * Prints a report to PDF on OCSC's template when clicked. Accepts `document` (object or factory)
 * or shorthand `{ title, subtitle, kind, reference, blocks }` directly on the button.
 */
export function PrintButton({
  document,
  title,
  subtitle,
  kind,
  reference,
  blocks,
  filename,
  children = "Print to PDF",
  variant = "secondary",
  ...props
}: Omit<ButtonProps, "onClick" | "title"> & {
  document?: PdfDocument | (() => PdfDocument | Promise<PdfDocument>);
  title?: string;
  subtitle?: string;
  kind?: string;
  reference?: string;
  blocks?: PdfBlock[];
  filename?: string;
}) {
  useApp();
  const [busy, setBusy] = useState(false);
  if (!canPrintPdf()) return null;
  return (
    <Button
      {...props}
      variant={variant}
      loading={busy}
      icon={<Printer className="size-4" />}
      onClick={async () => {
        setBusy(true);
        try {
          const report: PdfDocument | undefined =
            typeof document === "function"
              ? await document()
              : document ??
                (blocks
                  ? {
                      title: title ?? "Report",
                      ...(subtitle ? { subtitle } : {}),
                      ...(kind ? { kind } : {}),
                      ...(reference ? { reference } : {}),
                      blocks,
                    }
                  : undefined);
          if (!report) throw new Error("No PDF document was supplied.");
          await printPdf(report, filename ? { filename } : {});
          toast.success("PDF saved");
        } catch (error) {
          toast.error("Couldn't print the PDF", error instanceof Error ? error.message : undefined);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </Button>
  );
}
