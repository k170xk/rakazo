import { Trans, useLingui } from "@lingui/react/macro";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import type { RoutineLimitInfo } from "../lib/routine-limit-prompt";
import { onOpenRoutineLimitDialog } from "../lib/routine-limit-prompt";

/**
 * Explains that the person is at their switched-on routine limit. Opened from the routines
 * panel, the editor, or when an assistant's create attempt is refused.
 */
export function RoutineLimitDialog() {
  const { t } = useLingui();
  const [info, setInfo] = useState<RoutineLimitInfo | null>(null);

  useEffect(() => onOpenRoutineLimitDialog(setInfo), []);

  const open = info !== null;
  const max = info?.maxActiveRoutines ?? 0;
  const active = info?.activeRoutines ?? 0;
  const remaining = Math.max(0, max - active);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setInfo(null);
      }}
    >
      <DialogContent
        data-testid="routine-limit-dialog"
        className="sm:max-w-md"
        showCloseButton={false}
      >
        <DialogTitle>
          {max === 0 ? (
            <Trans>Routines are switched off</Trans>
          ) : (
            <Trans>Routine limit reached</Trans>
          )}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {max === 0 ? (
            <Trans>
              Your administrator has not allowed you to switch on routines. Ask them if you need
              one.
            </Trans>
          ) : info?.source === "ai" ? (
            <Trans>
              Your assistant could not create that routine. You already have {active} switched on,
              the most your administrator allows ({max}). Switch one off or delete it first, then
              ask again.
            </Trans>
          ) : (
            <Trans>
              You already have {active} routines switched on, the most your administrator allows (
              {max}). Switch one off or delete it first.
            </Trans>
          )}
        </DialogDescription>
        {max > 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="routine-limit-remaining">
            {remaining === 0 ? (
              <Trans>None remaining.</Trans>
            ) : (
              <Trans>
                {remaining} of {max} remaining.
              </Trans>
            )}
          </p>
        ) : null}
        <DialogFooter className="m-0">
          <Button data-testid="routine-limit-dismiss" onClick={() => setInfo(null)}>
            {t`Got it`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
