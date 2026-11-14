import { Trans, useLingui } from "@lingui/react/macro";
import type { DocumentFormat } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { MousePointerClick, Sparkles } from "lucide-react";
import { useRef, useSyncExternalStore } from "react";
import { usePageSession } from "../../lib/pages";
import { useSpaceQueries } from "../../lib/query";
import { useStudioWelcome } from "./use-studio-welcome";

const idleSubscribe = () => () => {};

const ILLUSTRATIONS: Record<DocumentFormat, string> = {
  docx: "/studios/word-welcome.png",
  pptx: "/studios/slides-welcome.png",
  xlsx: "/studios/sheet-welcome.png",
};

/** The open chat's composer field, docked in the studio or floating over it. */
function composerField(node: HTMLElement | null | undefined): HTMLElement | null {
  return node?.querySelector<HTMLElement>("textarea") ?? null;
}

/**
 * Over a newly opened document, explains that the assistant in the studio chat can edit it and
 * sees what is selected. The document keeps loading behind it.
 */
export function StudioWelcome({
  format,
  documentId,
}: {
  format: DocumentFormat;
  documentId: string;
}) {
  const queries = useSpaceQueries();
  const userId = useQuery(queries.me.queryOptions()).data?.userId;
  const session = usePageSession();
  const subscribe = session?.dock.subscribe ?? idleSubscribe;
  const ready = useSyncExternalStore(
    subscribe,
    () => Boolean(session?.dock.get().node),
    () => false,
  );
  const running = useSyncExternalStore(
    subscribe,
    () => session?.dock.get().running === true,
    () => false,
  );
  const welcome = useStudioWelcome({ userId, format, documentId, ready, running });
  const started = useRef(false);
  const startButton = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={welcome.open}
      onOpenChange={(open) => {
        if (!open) welcome.close();
      }}
    >
      <DialogContent
        data-testid="studio-welcome"
        data-format={format}
        showCloseButton={false}
        initialFocus={startButton}
        finalFocus={() =>
          started.current ? (composerField(session?.dock.get().node) ?? true) : true
        }
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-md"
      >
        <div className="rounded-t-xl bg-muted/60 px-6 pt-4">
          <img
            src={ILLUSTRATIONS[format]}
            alt=""
            width={1024}
            height={768}
            className="mx-auto h-auto max-h-48 w-full object-contain max-sm:max-h-36"
          />
        </div>
        <div className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-2">
            <DialogTitle>
              <WelcomeTitle format={format} />
            </DialogTitle>
            <DialogDescription>
              <Trans>
                You don't have to edit by hand. Ask in the chat and the assistant updates the
                document for you.
              </Trans>
            </DialogDescription>
          </div>
          <WelcomeTips format={format} />
        </div>
        <DialogFooter className="m-0 rounded-b-xl">
          <Button
            variant="outline"
            data-testid="studio-welcome-off"
            onClick={welcome.dontShowAgain}
          >
            <Trans>Don't show again</Trans>
          </Button>
          <Button
            ref={startButton}
            data-testid="studio-welcome-start"
            onClick={() => {
              started.current = true;
              welcome.close();
            }}
          >
            <Trans>Get started</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WelcomeTitle({ format }: { format: DocumentFormat }) {
  if (format === "pptx") return <Trans>Let the assistant edit your presentation</Trans>;
  if (format === "xlsx") return <Trans>Let the assistant edit your spreadsheet</Trans>;
  return <Trans>Let the assistant edit your document</Trans>;
}

function WelcomeTips({ format }: { format: DocumentFormat }) {
  const { t } = useLingui();
  const tips =
    format === "pptx"
      ? [
          t`Update slides or rewrite a slide`,
          t`Add an infographic, a diagram or project photos`,
          t`Add a chart or table, or restyle the deck`,
        ]
      : format === "xlsx"
        ? [
            t`Update figures, or add formulas and totals`,
            t`Add columns or a table`,
            t`Build a chart or a summary, or clean up the data`,
          ]
        : [
            t`Update the document, or rewrite and change paragraphs`,
            t`Add infographics, project photos or tables`,
            t`Tidy the formatting`,
          ];
  const selection =
    format === "pptx"
      ? t`Select a text box, image or shape and ask for a change. The assistant receives your selection as context.`
      : format === "xlsx"
        ? t`Select cells and ask for a change. The assistant receives your selection as context.`
        : t`Highlight a paragraph, table or image and ask for a change. The assistant receives your selection as context.`;

  return (
    <div className="flex flex-col gap-3 text-[14px]">
      <div className="flex gap-3">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium">
            <Trans>Ask the assistant to:</Trans>
          </p>
          <ul className="list-disc ps-4 text-muted-foreground">
            {tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex gap-3">
        <MousePointerClick className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p className="min-w-0 text-muted-foreground">{selection}</p>
      </div>
    </div>
  );
}
