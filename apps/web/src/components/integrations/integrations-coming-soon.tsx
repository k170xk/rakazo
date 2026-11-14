import { Trans, useLingui } from "@lingui/react/macro";
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@rakazo/ui-web";
import { Plug, X } from "lucide-react";

/** What a member sees in place of Connectors while the company keeps integrations to admins. */
export function IntegrationsComingSoon({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex w-[560px] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-2xl bg-card p-0 sm:max-w-[560px]"
      >
        <DialogHeader className="flex-row items-start justify-between px-8 pt-7">
          <DialogTitle className="flex items-center gap-3 text-heading2 text-foreground">
            <Trans>OCSC Intelligence connectors</Trans>
            <Badge variant="secondary" className="h-6 px-2.5 text-[12px] font-medium">
              <Trans>Coming soon</Trans>
            </Badge>
          </DialogTitle>
          <DialogClose
            render={<Button variant="ghost" size="icon-sm" aria-label={t`Close connectors`} />}
          >
            <X />
          </DialogClose>
        </DialogHeader>
        <div
          data-testid="integrations-coming-soon"
          className="flex flex-col items-center gap-4 px-8 pt-8 pb-10 text-center"
        >
          <div className="grid size-12 place-items-center rounded-2xl bg-accent text-foreground">
            <Plug size={22} />
          </div>
          <p className="max-w-[420px] text-[14.5px] leading-6 text-muted-foreground">
            <Trans>
              Connecting services such as Outlook, Teams and Stripe, and adding plugins, is being
              tested and will be available to everyone soon.
            </Trans>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
