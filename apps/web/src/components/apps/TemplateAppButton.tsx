import { useLingui } from "@lingui/react/macro";
import type { AppTemplate } from "@rakazo/app-kit/templates";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Spinner,
} from "@rakazo/ui-web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutTemplate, Users } from "lucide-react";
import { useState } from "react";
import { useOpenPage } from "../../lib/pages";
import { useSpaceQueries } from "../../lib/query";

/**
 * Starts an app from one of the App Studio's starters: its screens and empty tables, ready for
 * the person's own rows or for the bot to fit it further. It opens when made.
 */
export function TemplateAppButton({ botId, groupId }: { botId?: string; groupId?: string }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const openPage = useOpenPage();
  const [open, setOpen] = useState(false);
  // The starters carry their full source, so they load only when the gallery opens.
  const templates = useQuery({
    queryKey: ["app-templates"],
    queryFn: async () => (await import("@rakazo/app-kit/templates")).APP_TEMPLATES,
    enabled: open,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const create = useMutation({
    mutationFn: (template: AppTemplate) =>
      queries.apps.createFromTemplate.call({
        templateId: template.id,
        ...(botId ? { botId } : {}),
        ...(groupId ? { groupId } : {}),
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queries.pages.key() });
      setOpen(false);
      openPage(result.pageId);
    },
  });
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <LayoutTemplate />
        {t`New app from a starter`}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !create.isPending && setOpen(next)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="pe-8 text-[16px]">{t`Start from a starter app`}</DialogTitle>
            <DialogDescription>
              {t`Each comes with its screens and empty tables. Add your rows, or ask the bot to fit it to your work.`}
            </DialogDescription>
          </DialogHeader>
          {templates.isPending ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {(templates.data ?? []).map((template) => (
                <li key={template.id}>
                  <button
                    type="button"
                    disabled={create.isPending}
                    onClick={() => create.mutate(template)}
                    className="flex w-full flex-col items-start gap-1 rounded-[10px] border border-border px-3 py-2.5 text-start transition-colors hover:bg-muted disabled:opacity-60"
                  >
                    <span className="flex w-full items-center gap-2 text-[14px] font-medium">
                      {template.title}
                      {template.access === "contribute" ? (
                        <span className="inline-flex items-center gap-1 text-[12px] font-normal text-muted-foreground">
                          <Users aria-hidden="true" className="size-3.5" />
                          {t`Colleagues add their own`}
                        </span>
                      ) : null}
                      {create.isPending && create.variables?.id === template.id ? (
                        <Spinner className="ms-auto" />
                      ) : null}
                    </span>
                    <span className="text-[13px] text-muted-foreground">
                      {template.description}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {create.isError ? (
            <p role="alert" className="text-[12px] text-destructive">
              {create.error instanceof Error ? create.error.message : t`That app couldn't be made.`}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
