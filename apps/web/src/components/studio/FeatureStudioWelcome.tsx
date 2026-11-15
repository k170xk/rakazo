import { Trans, useLingui } from "@lingui/react/macro";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { Building2, ListChecks, MousePointerClick, Sparkles, UserRound } from "lucide-react";
import { useRef, useSyncExternalStore } from "react";
import type { StudioWelcomeKind } from "../office/use-studio-welcome";
import { useStudioWelcome } from "../office/use-studio-welcome";
import { usePageSession } from "../../lib/pages";
import { useSpaceQueries } from "../../lib/query";

const idleSubscribe = () => () => {};

/** Sit above the full-screen studio (also z-50) so the blur dimmer covers it. */
const ABOVE_STUDIO = "z-[60]";

export type FeatureStudioKind = Extract<StudioWelcomeKind, "todo" | "apps" | "board">;

const ILLUSTRATIONS: Record<FeatureStudioKind, string> = {
  todo: "/studios/todo-welcome.png",
  apps: "/studios/apps-welcome.png",
  board: "/studios/board-welcome.png",
};

/** The open chat's composer field, docked in the studio or floating over it. */
function composerField(node: HTMLElement | null | undefined): HTMLElement | null {
  return node?.querySelector<HTMLElement>("textarea") ?? null;
}

/**
 * First-open welcome for To-do, Apps and Board: concept, principles, and how the chat helps.
 * The studio keeps loading behind it.
 */
export function FeatureStudioWelcome({
  kind,
  instanceId = "studio",
  ready = true,
  running = false,
}: {
  kind: FeatureStudioKind;
  instanceId?: string;
  ready?: boolean;
  running?: boolean;
}) {
  const queries = useSpaceQueries();
  const userId = useQuery(queries.me.queryOptions()).data?.userId;
  const session = usePageSession();
  const subscribe = session?.dock.subscribe ?? idleSubscribe;
  const dockReady = useSyncExternalStore(
    subscribe,
    () => Boolean(session?.dock.get().node),
    () => false,
  );
  const dockRunning = useSyncExternalStore(
    subscribe,
    () => session?.dock.get().running === true,
    () => false,
  );
  const welcome = useStudioWelcome({
    userId,
    kind,
    instanceId,
    ready: ready && (session ? dockReady : true),
    running: running || dockRunning,
  });
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
        data-format={kind}
        showCloseButton={false}
        initialFocus={startButton}
        finalFocus={() =>
          started.current ? (composerField(session?.dock.get().node) ?? true) : true
        }
        overlayClassName={ABOVE_STUDIO}
        className={`${ABOVE_STUDIO} flex max-h-[min(40rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-md`}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
          <div className="rounded-t-xl bg-muted/60 px-6 pt-4">
            <img
              src={ILLUSTRATIONS[kind]}
              alt=""
              width={1024}
              height={1024}
              className="mx-auto h-auto max-h-48 w-full object-contain max-sm:max-h-36"
            />
          </div>
          <div className="flex flex-col gap-4 p-6">
            <div className="flex flex-col gap-2">
              <DialogTitle>
                <WelcomeTitle kind={kind} />
              </DialogTitle>
              <DialogDescription>
                <WelcomeLead kind={kind} />
              </DialogDescription>
            </div>
            {kind === "apps" ? <AppsKinds /> : <WelcomeTips kind={kind} />}
          </div>
        </div>
        <DialogFooter className="m-0 shrink-0 rounded-b-xl">
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

function WelcomeTitle({ kind }: { kind: FeatureStudioKind }) {
  if (kind === "apps") return <Trans>Build working apps by describing them</Trans>;
  if (kind === "board") return <Trans>Think out loud on a shared board</Trans>;
  return <Trans>Keep work moving across a living list</Trans>;
}

function WelcomeLead({ kind }: { kind: FeatureStudioKind }) {
  if (kind === "apps") {
    return (
      <Trans>
        Apps Studio turns a plain-English idea into a real app you can run, edit and share. The chat
        beside it is the builder.
      </Trans>
    );
  }
  if (kind === "board") {
    return (
      <Trans>
        Board is a freeform space for maps, sketches and plans. Drop ideas visually, bring in project
        photos, and ask the assistant to grow or tidy the board with you.
      </Trans>
    );
  }
  return (
    <Trans>
      To-do is your personal kanban: move work through stages, and let assistants add or update items
      from chats, emails and routines when you ask.
    </Trans>
  );
}

function AppsKinds() {
  const { t } = useLingui();
  return (
    <div className="flex flex-col gap-3 text-[14px]">
      <div className="flex gap-3">
        <UserRound className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium">
            <Trans>Personal apps</Trans>
          </p>
          <p className="text-muted-foreground">
            <Trans>
              Yours to build and keep. Only you see them until you share a link, or publish one for
              the company.
            </Trans>
          </p>
        </div>
      </div>
      <div className="flex gap-3">
        <Building2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium">
            <Trans>Company apps</Trans>
          </p>
          <p className="text-muted-foreground">
            <Trans>
              Shared with everyone in your organisation — they appear under Company in the switcher.
              Publish from Settings when an app should become a tenant tool, not just a personal
              experiment.
            </Trans>
          </p>
        </div>
      </div>
      <div className="flex gap-3">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium">
            <Trans>How to build well:</Trans>
          </p>
          <ul className="list-disc ps-4 text-muted-foreground">
            <li>
              {t`Describe the app in chat — screens, data and behaviour — instead of starting from blank code`}
            </li>
            <li>
              {t`Use Pick to point at one element, then ask for a change or edit it visually`}
            </li>
            <li>
              {t`Open Data, Code and History when you need the structure, versions or settings behind the UI`}
            </li>
          </ul>
        </div>
      </div>
      <div className="flex gap-3">
        <MousePointerClick className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p className="min-w-0 text-muted-foreground">
          {t`Select an element with Pick, then ask in the chat. The assistant receives that selection as context.`}
        </p>
      </div>
    </div>
  );
}

function WelcomeTips({ kind }: { kind: Exclude<FeatureStudioKind, "apps"> }) {
  const { t } = useLingui();
  const principles =
    kind === "board"
      ? [
          t`Drop notes and shapes freely — the board is for exploring, not filling a template`,
          t`Link in project photos, site images or reference pictures so the board stays visual`,
          t`Ask for an infographic, diagram or labelled sketch when a picture explains it better than text`,
          t`Group related ideas, then ask the assistant to rearrange, expand or tidy a selection`,
          t`Share the board or export it when a sketch needs to leave the studio`,
        ]
      : [
          t`Columns are stages: To do → In progress → Waiting → Done. Drag cards when status changes`,
          t`Keep titles short and actionable; add due dates and priority only when they help you decide`,
          t`Ask in chat to add, move or rewrite items — assistants can also file tasks from other work`,
        ];
  const selection =
    kind === "board"
      ? t`Select notes or shapes on the board, then ask for a change. The assistant works from what you pointed at.`
      : t`Open a card or name it in chat when you want a change. The assistant updates the list for you.`;

  return (
    <div className="flex flex-col gap-3 text-[14px]">
      <div className="flex gap-3">
        <ListChecks className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium">
            <Trans>Principles that work well:</Trans>
          </p>
          <ul className="list-disc ps-4 text-muted-foreground">
            {principles.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex gap-3">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p className="min-w-0 text-muted-foreground">
          <Trans>Ask in the studio chat whenever you want the assistant to do the updating.</Trans>
        </p>
      </div>
      <div className="flex gap-3">
        <MousePointerClick className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p className="min-w-0 text-muted-foreground">{selection}</p>
      </div>
    </div>
  );
}
