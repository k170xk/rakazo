import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ComputerStatus } from "@rakazo/contracts";

export function DesktopKindEmptyState({ className }: { className?: string }) {
  return (
    <div className={className}>
      <Trans>
        This agent runs on this computer, not a Linux desktop. Shell and files use your home folder.
      </Trans>
    </div>
  );
}

export function computerPlaceholder(
  state: ComputerStatus["state"] | undefined,
  booting: boolean,
  label: string,
) {
  if (state === "booting" || booting) return t`Booting live desktop…`;
  if (state === "running") return label;
  if (state === "suspended") return t`Computer is asleep. Open it to wake.`;
  if (state === "error") return t`Computer failed to boot`;
  return t`Computer is stopped`;
}

export function computerLabel(mode: ComputerStatus["mode"] | undefined, botName: string) {
  return mode === "dedicated" ? t`${botName}’s computer` : t`Team Computer`;
}

/** Which agent is at work on the computer now; on a shared computer it may not be this one. */
export function ComputerOperatorPill({
  computer,
  botId,
  showControl = true,
}: {
  computer: ComputerStatus | null;
  botId: string;
  /** The full-window view shows control in its own pill. */
  showControl?: boolean;
}) {
  if (computer?.state !== "running") return null;
  const youHaveControl = computer.controlHolder === "user" && computer.controlBotId === botId;
  const working = computer.busyBotName;
  if (youHaveControl ? !showControl : !working) return null;
  return (
    <span
      data-testid="computer-operator"
      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted px-[11px] py-1 text-[13px] text-muted-foreground"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
      <span className="truncate" dir="auto">
        {youHaveControl ? <Trans>You have control</Trans> : <Trans>{working} is working…</Trans>}
      </span>
    </span>
  );
}
