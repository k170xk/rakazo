import { useLingui } from "@lingui/react/macro";
import { Button, Spinner } from "@rakazo/ui-web";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";
import { useRef } from "react";
import { useOpenPage } from "../../lib/pages";
import { useSpaceQueries } from "../../lib/query";

/** Up to the server's 10 MB workbook allowance once encoded. */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Turns a spreadsheet into an app in one step: every sheet becomes a table, and the app gets an
 * overview, a screen per table, a board and a calendar where the columns allow. It opens when made.
 */
export function ImportWorkbookButton({ botId, groupId }: { botId?: string; groupId?: string }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const openPage = useOpenPage();
  const input = useRef<HTMLInputElement>(null);
  const create = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_BYTES) throw new Error(t`That workbook is over 10 MB.`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let text = "";
      for (let at = 0; at < bytes.length; at += 0x8000) {
        text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
      }
      return queries.apps.importWorkbook.call({
        fileName: file.name.slice(0, 200),
        base64: btoa(text),
        ...(botId ? { botId } : {}),
        ...(groupId ? { groupId } : {}),
      });
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queries.pages.key() });
      openPage(result.pageId);
    },
  });
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={create.isPending}
        onClick={() => input.current?.click()}
      >
        {create.isPending ? <Spinner /> : <FileSpreadsheet />}
        {create.isPending ? t`Building your app…` : t`New app from Excel`}
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        accept=".xlsx,.xlsm,.xls,.csv,.ods"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) create.mutate(file);
        }}
      />
      {create.isError ? (
        <p role="alert" className="text-[12px] text-destructive">
          {create.error instanceof Error
            ? create.error.message
            : t`That workbook couldn't be read.`}
        </p>
      ) : null}
    </div>
  );
}
