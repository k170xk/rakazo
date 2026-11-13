import { Printer } from "lucide-react";
import { useState } from "react";
import type { PdfDocument } from "../pdf/model.js";
import { canPrintPdf, printPdf, useApp } from "../sdk/index.js";
import type { ButtonProps } from "./basic.js";
import { Button } from "./basic.js";
import { toast } from "./overlay.js";

/**
 * Prints a report to PDF on OCSC's template when clicked. document can be a function so the
 * report is built from the data at the moment of printing.
 */
export function PrintButton({
  document,
  filename,
  children = "Print to PDF",
  variant = "secondary",
  ...props
}: Omit<ButtonProps, "onClick"> & {
  document: PdfDocument | (() => PdfDocument | Promise<PdfDocument>);
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
          const report = typeof document === "function" ? await document() : document;
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
