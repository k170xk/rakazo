import { Trans, useLingui } from "@lingui/react/macro";
import { Badge, Button, Dialog, DialogContent, DialogTitle } from "@rakazo/ui-web";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  ArrowRight,
  Clapperboard,
  FileSpreadsheet,
  FileText,
  ImageIcon,
  PenTool,
  Presentation,
  Sparkles,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";

/** Bump when the tour's content changes enough that everyone should see it again on first run. */
const TOUR_VERSION = "v4";

const seenKey = (userId: string) => `ocsc-tour:${TOUR_VERSION}:${userId}`;

export function hasSeenTour(userId: string): boolean {
  try {
    return globalThis.localStorage?.getItem(seenKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function markTourSeen(userId: string): void {
  try {
    globalThis.localStorage?.setItem(seenKey(userId), "1");
  } catch {
    // Storage blocked in the frame: the tour shows again next time, which is harmless.
  }
}

type ToolCard = { icon: LucideIcon; title: string; text: string };

type Step = {
  id: string;
  image: string;
  eyebrow: string;
  title: string;
  body: string;
  points?: string[];
  example?: { label: string; text: string };
  cards?: ToolCard[];
  badge?: string;
};

export type TourAvailability = {
  /** Staff cannot connect apps yet. */
  connectorsSoon: boolean;
  /** This person's agents cannot run routines yet. */
  routinesSoon: boolean;
};

function useSteps(mode: "first-run" | "revisit", availability: TourAvailability): Step[] {
  const { t } = useLingui();
  const soon = t`Coming soon`;
  return [
    {
      id: "welcome",
      image: "/tour/welcome.webp",
      eyebrow: t`Welcome to OCSC Intelligence V3`,
      title: t`Welcome to a new era of AI at OCSC`,
      body: t`OCSC Intelligence is our own AI workspace. Its agents know OCSC, use our branded tools and work alongside you on real project work. It runs on OCSC's own platform, so your chats, agents and files stay private to you unless you share them.`,
      points: [
        t`Agents that work like teammates`,
        t`OCSC Tools that produce branded deliverables`,
        t`Apps, Connectors and Routines that extend what agents can do`,
      ],
    },
    {
      id: "agents",
      image: "/tour/agents.webp",
      eyebrow: t`Get to know agents`,
      title: t`AI teammates, each with a job`,
      body: t`An agent is an AI teammate with its own name, job and instructions. Talk to it like a colleague: give it a task, attach files, and it plans the work, does it and tells you when it's finished.`,
      points: [
        t`Create as many as you need: a bid writer, a drainage checker, a reviewer`,
        t`Change an agent's job, instructions or model whenever you like`,
        t`Agents keep working while you get on with something else`,
      ],
    },
    {
      id: "tools",
      image: "/tour/tools.webp",
      eyebrow: t`Get to know OCSC Tools`,
      title: t`Branded deliverables, done properly`,
      body: t`Tools are OCSC's own functions. Agents use them to turn your words, your files and Evolve data into real deliverables in our brand. Just ask in plain English.`,
      cards: [
        {
          icon: FileText,
          title: t`Word`,
          text: t`New reports and letters in OCSC style. Ask for changes as often as you like: each edit comes back as tracked changes you can accept or reject, and earlier versions are kept.`,
        },
        {
          icon: Presentation,
          title: t`PowerPoint`,
          text: t`OCSC decks with an infographic on most slides, real project photos and a closing slide from your Evolve CV. Changes arrive as a new version with review comments.`,
        },
        {
          icon: FileSpreadsheet,
          title: t`Excel`,
          text: t`Cost plans, trackers and schedules, styled for OCSC and ready to share.`,
        },
        {
          icon: PenTool,
          title: t`PDF and PDF Studio`,
          text: t`Branded PDFs, plus markups, redlines and measurements on drawings in Evolve PDF Studio.`,
        },
        {
          icon: Clapperboard,
          title: t`Video`,
          text: t`OCSC-branded animations and social clips, with voiceover and stock footage.`,
        },
        {
          icon: ImageIcon,
          title: t`Images and Evolve data`,
          text: t`OCSC Vision Intelligence creates infographics and pictures, drawing on Evolve's project datasheets and people profiles.`,
        },
      ],
      example: {
        label: t`Try`,
        text: t`"Turn these site visit notes into an OCSC report with two infographics." Then: "Make section 3 shorter and add the Riverside project."`,
      },
    },
    {
      id: "apps",
      image: "/tour/apps.webp",
      eyebrow: t`Get to know OCSC Apps`,
      title: t`Build your own apps, and share them`,
      body: t`OCSC Apps put coding in every member of staff's hands. Describe the dashboard, tracker, calculator or plugin you need and an agent writes and runs the code for you inside the secure OCSC sandbox, away from live systems.`,
      points: [
        t`Start in the chat: a live app appears and changes each time you ask`,
        t`Grow it into an Evolve plugin with OCSC branding and approved company data`,
        t`Share your dashboards, tools and functions so colleagues can use them too`,
        t`Every plugin is reviewed before it reaches colleagues, so shared apps stay safe`,
      ],
      example: {
        label: t`Example`,
        text: t`"Build me a fee tracker for my projects with a chart of invoiced against remaining fees, then get it ready to share with the Civil team."`,
      },
    },
    {
      id: "connectors",
      image: "/tour/connectors.webp",
      eyebrow: t`Get to know and understand connectors`,
      title: t`Your other systems, inside the chat`,
      body: t`A connector links an agent to a system you already use, so it can read and act on your data with your permission. Think Outlook, Teams, SharePoint and the construction platforms we work in.`,
      example: {
        label: t`Example: Autodesk Construction Cloud and Forma`,
        text: t`"List this week's open RFIs on the Riverside job in ACC and draft our responses in an OCSC Word document." Or: "Compare the Forma massing options and summarise the area and daylight results in a deck."`,
      },
      badge: availability.connectorsSoon ? soon : undefined,
    },
    {
      id: "routines",
      image: "/tour/routines.webp",
      eyebrow: t`Get to know routines`,
      title: t`Work that runs itself`,
      body: t`A routine is a task an agent carries out on a schedule or when something changes, then delivers the result to you.`,
      points: [
        t`"Every Monday at 8am, summarise open ACC issues and send me the list"`,
        t`"On the last Friday of the month, update the bid tracker and flag anything overdue"`,
      ],
      badge: availability.routinesSoon ? soon : undefined,
    },
    {
      id: "teamwork",
      image: "/tour/teamwork.webp",
      eyebrow: t`Get to know agent teamwork`,
      title: t`Agents hand work to each other`,
      body: t`Agents can message one another and pass tasks along, so each one does what it's best at.`,
      points: [
        t`A research agent finds the right OCSC project references`,
        t`A bid writer drafts the response as an OCSC Word document`,
        t`A reviewer checks it against the brief and sends it back to you`,
      ],
    },
    {
      id: "memory",
      image: "/tour/memory.webp",
      eyebrow: t`Get to know memory`,
      title: t`Gets to know you over time`,
      body: t`Agents remember what matters across chats: your preferences, your projects and the decisions you've made. They also know who you are from your Evolve CV, so their work fits your role from the very first message.`,
      points: [
        t`Ask "What do you remember about me?" at any time`,
        t`Tell an agent to forget something and it will`,
        t`Agents can look back through earlier chats when you refer to them`,
      ],
    },
    {
      id: "groups",
      image: "/tour/groups.webp",
      eyebrow: t`Get to know groups`,
      title: t`Colleagues and agents, together`,
      body: t`Start a group chat with colleagues from Evolve and the agents you choose. Everyone works in the same thread, and agents join in when they're needed.`,
      points: [
        t`Invite colleagues straight from the Evolve directory`,
        t`Private spaces keep a team's chats and files separate`,
      ],
    },
    mode === "first-run"
      ? {
          id: "start",
          image: "/tour/start.webp",
          eyebrow: t`Let's begin`,
          title: t`Meet your Main PA`,
          body: t`Your personal assistant is ready. It coordinates across your chats, will interview you briefly, and can recommend specialist agents such as an Email bot.`,
          points: [
            t`Ask it anything, or for any OCSC deliverable`,
            t`Let it suggest specialists, then create more from the + button`,
            t`Come back to this tour any time from the sidebar`,
          ],
        }
      : {
          id: "start",
          image: "/tour/start.webp",
          eyebrow: t`You're all set`,
          title: t`Put OCSC Intelligence to work`,
          body: t`Open any agent and ask for what you need, or create a new agent from the + button for a job you do often.`,
          points: [
            t`Ask for any OCSC deliverable in plain English`,
            t`Give each agent a clear job and it will get better at it`,
          ],
        },
  ];
}

/** The OCSC Intelligence tour, as a page during first run or inside a dialog from the sidebar. */
export function OcscTour({
  mode,
  availability,
  onFinish,
  onClose,
}: {
  mode: "first-run" | "revisit";
  availability: TourAvailability;
  onFinish: () => void;
  /** Set inside the sidebar's dialog: closes without finishing. */
  onClose?: () => void;
}) {
  const { t } = useLingui();
  const steps = useSteps(mode, availability);
  const [index, setIndex] = useState(0);
  const step = steps[index] ?? steps[0]!;
  const last = index === steps.length - 1;

  const next = useCallback(() => {
    if (last) onFinish();
    else setIndex((current) => Math.min(current + 1, steps.length - 1));
  }, [last, onFinish, steps.length]);
  const back = useCallback(() => setIndex((current) => Math.max(current - 1, 0)), []);

  useEffect(() => {
    const following = steps[index + 1];
    if (!following) return;
    const image = new Image();
    image.src = following.image;
  }, [index, steps]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea")) return;
      if (event.key === "ArrowRight") next();
      if (event.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back]);

  return (
    <div
      data-testid="ocsc-tour"
      data-step={step.id}
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl bg-card"
    >
      <div className="flex items-center gap-3 px-6 pt-5 md:px-8">
        <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
          <Sparkles size={16} className="text-primary" aria-hidden />
          <Trans>Get to know OCSC Intelligence</Trans>
        </span>
        <div className="ml-auto flex items-center gap-1" role="tablist">
          {steps.map((item, position) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={position === index}
              aria-label={item.eyebrow}
              onClick={() => setIndex(position)}
              className={`h-1.5 rounded-full transition-all ${
                position === index
                  ? "w-6 bg-primary"
                  : position < index
                    ? "w-3 bg-primary/50"
                    : "w-3 bg-border"
              }`}
            />
          ))}
        </div>
        {onClose ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t`Close tour`}
            onClick={onClose}
            className="ml-2"
          >
            <X />
          </Button>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto px-6 py-5 md:grid-cols-[1.1fr_1fr] md:gap-8 md:px-8">
        <div className="overflow-hidden rounded-2xl bg-muted">
          <img
            key={step.image}
            src={step.image}
            alt=""
            className="aspect-[3/2] size-full object-cover motion-safe:animate-in motion-safe:fade-in"
          />
        </div>
        <div className="flex min-w-0 flex-col justify-center">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1.5 text-[14.5px] font-semibold text-primary">
              {step.eyebrow}
            </span>
            {step.badge ? (
              <Badge variant="secondary" className="h-5 px-2 text-[11.5px] font-medium">
                {step.badge}
              </Badge>
            ) : null}
          </div>
          <DialogTitleOrHeading inDialog={Boolean(onClose)}>{step.title}</DialogTitleOrHeading>
          <p className="mt-3 text-[15px] leading-6 text-muted-foreground">{step.body}</p>
          {step.points ? (
            <ul className="mt-4 space-y-2">
              {step.points.map((point) => (
                <li key={point} className="flex gap-2.5 text-[14.5px] leading-6 text-foreground">
                  <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  {point}
                </li>
              ))}
            </ul>
          ) : null}
          {step.cards ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {step.cards.map((card) => (
                <div key={card.title} className="rounded-xl border border-border/70 px-3 py-2.5">
                  <div className="flex items-center gap-2 text-[14px] font-medium text-foreground">
                    <card.icon size={16} className="text-primary" aria-hidden />
                    {card.title}
                  </div>
                  <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">{card.text}</p>
                </div>
              ))}
            </div>
          ) : null}
          {step.example ? (
            <div className="mt-4 rounded-xl bg-primary/10 px-4 py-3">
              <div className="text-[12.5px] font-semibold text-primary">{step.example.label}</div>
              <p className="mt-1 text-[14px] leading-6 text-foreground">{step.example.text}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border/60 px-6 py-4 md:px-8">
        {index > 0 ? (
          <Button variant="ghost" onClick={back}>
            <ArrowLeft />
            <Trans>Back</Trans>
          </Button>
        ) : null}
        {!last && mode === "first-run" ? (
          <Button
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => setIndex(steps.length - 1)}
          >
            <Trans>Skip to the end</Trans>
          </Button>
        ) : null}
        <span className="ml-auto text-[13px] text-muted-foreground">
          {index + 1} / {steps.length}
        </span>
        <Button onClick={next} data-testid="ocsc-tour-next">
          {last ? (
            mode === "first-run" ? (
              <Trans>Create my first chat</Trans>
            ) : (
              <Trans>Done</Trans>
            )
          ) : (
            <>
              <Trans>Next</Trans>
              <ArrowRight />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function DialogTitleOrHeading({ inDialog, children }: { inDialog: boolean; children: ReactNode }) {
  const className = "mt-3 text-[28px] leading-tight font-medium text-foreground";
  return inDialog ? (
    <DialogTitle className={className}>{children}</DialogTitle>
  ) : (
    <h1 className={className}>{children}</h1>
  );
}

/** The tour opened from the sidebar. */
export function OcscTourDialog({
  availability,
  onClose,
}: {
  availability: TourAvailability;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[720px] max-h-[calc(100%-2rem)] w-[1100px] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-2xl bg-card p-0 sm:max-w-[1100px]"
      >
        <OcscTour mode="revisit" availability={availability} onFinish={onClose} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}
