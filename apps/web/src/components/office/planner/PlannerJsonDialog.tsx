import { Trans, useLingui } from "@lingui/react/macro";
import { validate } from "@jantt/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from "@rakazo/ui-web";
import { Check, Copy, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { parsePlan, type PlanDocument } from "./plan";

export function PlannerJsonDialog({
  open,
  plan,
  readOnly,
  onClose,
  onApply,
}: {
  open: boolean;
  plan: PlanDocument;
  readOnly: boolean;
  onClose: () => void;
  onApply: (next: PlanDocument) => void;
}) {
  const { t } = useLingui();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(JSON.stringify(plan, null, 2));
    setEditing(false);
    setError(null);
    setCopied(false);
  }, [open, plan]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      toast.success(t`Programme JSON copied`);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(t`Could not copy JSON`);
    }
  };

  const apply = () => {
    try {
      const parsed = parsePlan(new TextEncoder().encode(draft));
      const check = validate(parsed);
      if (!check.valid) {
        const first = check.errors[0];
        setError(first ? `${first.path || "plan"}: ${first.message}` : t`Invalid programme JSON`);
        return;
      }
      setError(null);
      onApply(parsed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Invalid JSON syntax`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>
            <Trans>Programme JSON</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              The underlying Jantt schedule data. Any changes are validated before saving to History.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">
              {plan.tasks.length} <Trans>tasks</Trans>
            </span>
            <div className="flex items-center gap-1.5">
              {!readOnly ? (
                <Button
                  type="button"
                  variant={editing ? "secondary" : "outline"}
                  size="sm"
                  className="h-7 rounded-full px-2.5 text-[12px]"
                  onClick={() => {
                    setEditing((value) => !value);
                    setError(null);
                  }}
                >
                  <Pencil className="mr-1 size-3" />
                  {editing ? <Trans>Lock view</Trans> : <Trans>Edit JSON</Trans>}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-full px-2.5 text-[12px]"
                onClick={() => void copy()}
              >
                {copied ? <Check className="mr-1 size-3 text-primary" /> : <Copy className="mr-1 size-3" />}
                {copied ? <Trans>Copied</Trans> : <Trans>Copy</Trans>}
              </Button>
            </div>
          </div>

          <textarea
            value={draft}
            readOnly={!editing || readOnly}
            onChange={(event) => {
              setDraft(event.target.value);
              if (error) setError(null);
            }}
            spellCheck={false}
            className="h-[46vh] min-h-[240px] w-full resize-none rounded-lg border border-border bg-muted/40 p-3 font-mono text-[12px] leading-relaxed text-foreground outline-none focus:border-primary"
          />

          {error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            <Trans>Close</Trans>
          </Button>
          {editing && !readOnly ? (
            <Button type="button" size="sm" onClick={apply}>
              <Trans>Apply JSON</Trans>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
