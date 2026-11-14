import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import type { EvolveChangeEdits, LoginFieldInput, ThreadMessage } from "@rakazo/contracts";
import { BOT_INSTRUCTIONS_MAX_LENGTH } from "@rakazo/contracts";
import {
  isApprovalAskBlock,
  isSecretAskBlock,
  resolveAskChoice,
  selectedAskActionLabel,
} from "@rakazo/core";
import { Button, cn, Input, Spinner, Textarea } from "@rakazo/ui-web";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Building2,
  CalendarClock,
  CalendarRange,
  Check,
  CircleCheck,
  CircleHelp,
  CircleX,
  ClipboardList,
  FilePenLine,
  Flag,
  LogOut,
  Mail,
  MessageSquareText,
  Pencil,
  ShieldCheck,
  Tag,
  Trash2,
  TriangleAlert,
  UserPlus,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import type { RpcClient } from "../lib/rpc";
import { rpc as selectedSpaceRpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { BuiCard } from "./ai/primitives";
import type { LoadChangeOptions } from "./EvolveChangeEditor";
import {
  CommentEditor,
  DeadlineEditor,
  TeamRoleEditor,
  WorkPackageEditor,
} from "./EvolveChangeEditor";
import { OptionRow, optionLetter } from "./OptionRow";
import { SecretAskCard } from "./SecretAskCard";

export type AskBlock = Extract<ThreadMessage["blocks"][number], { kind: "ask" }>;

function formatAnsweredState(
  answer: string | undefined,
  approval: boolean,
  outcome?: "created" | "cancelled",
  actions?: AskBlock["actions"],
): string {
  if (!answer) return t`Answered`;
  if (!approval) return answer === "approved" ? t`Sent` : selectedAskActionLabel(answer, actions);
  if (outcome === "created") return t`Created`;
  if (outcome === "cancelled") return t`Cancelled`;
  if (answer === "allow") return allowsSpace(actions) ? t`Allowed in this space` : t`Allowed once`;
  if (answer === "always") return t`Always allowed`;
  if (answer === "deny") return t`Denied`;
  return t`Answered: ${answer}`;
}

/**
 * The server's labels on the user's-computer approval, whose "allow" covers the whole space. Cards
 * from before it covered the space carry the older label.
 */
const ALLOW_IN_SPACE = new Set(["Allow in this space", "Allow for this chat"]);

function allowsSpace(actions: AskBlock["actions"]): boolean {
  return actions?.some((action) => ALLOW_IN_SPACE.has(action.label)) ?? false;
}

function approvalActionLabel(
  id: string,
  fallback: string,
  outcome?: "created" | "cancelled",
  site?: string,
): string {
  if (outcome === "created") return t`Create space`;
  if (outcome === "cancelled") return t`Cancel`;
  if (id === "allow") return ALLOW_IN_SPACE.has(fallback) ? t`Allow in this space` : t`Allow once`;
  if (id === "always") return site ? t`Always allow ${site}` : t`Always allow this tool`;
  if (id === "deny") return t`Deny`;
  return fallback;
}

export type AskCardProps = {
  block: AskBlock;
  canAnswer: boolean;
  canDismiss: boolean;
  /** A login card answers with its fields and an empty `text`; `remember` false uses it once. */
  onAnswer: (text: string, fields?: LoginFieldInput[], remember?: false) => Promise<void>;
  /** Turns down a secret request without a value. */
  onDismiss: () => Promise<void>;
  /** The chat's space; Undo goes there even if another tab selects a different space. */
  rpc?: RpcClient;
  /** Edits a pending deadline or work package card; Evolve previews the edit, which replaces it. */
  onReviseChange?: (edits: EvolveChangeEdits) => Promise<void>;
  /** The live Evolve choices that card's pickers offer. */
  loadChangeOptions?: LoadChangeOptions;
};

/** A question, approval or protected-input request from the bot. */
export function AskCard(props: AskCardProps) {
  if (isSecretAskBlock(props.block)) return <SecretAskCard {...props} />;
  if (props.block.deadlineChange && isApprovalAskBlock(props.block))
    return <DeadlineAskCard {...props} change={props.block.deadlineChange} />;
  if (props.block.workPackageChange && isApprovalAskBlock(props.block))
    return <WorkPackageAskCard {...props} change={props.block.workPackageChange} />;
  if (props.block.projectCommentChange && isApprovalAskBlock(props.block))
    return <CommentAskCard {...props} change={props.block.projectCommentChange} />;
  if (props.block.designTeamChange && isApprovalAskBlock(props.block))
    return <DesignTeamAskCard {...props} change={props.block.designTeamChange} />;
  return <PromptAskCard {...props} />;
}

type DeadlineChange = NonNullable<AskBlock["deadlineChange"]>;
type DeadlineValues = DeadlineChange["after"];
type WorkPackageChange = NonNullable<AskBlock["workPackageChange"]>;
type WorkPackageValues = NonNullable<WorkPackageChange["after"]>;
type ProjectCommentChange = NonNullable<AskBlock["projectCommentChange"]>;
type DesignTeamChange = NonNullable<AskBlock["designTeamChange"]>;
type ChangeRow = { key: string; label: string; value: string };

function dueDay(value: string | null): string {
  if (!value) return t`No date`;
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function deadlineRows(values: DeadlineValues): ChangeRow[] {
  return [
    { key: "name", label: t`Deadline`, value: values.name },
    { key: "date", label: t`Due`, value: dueDay(values.date) },
    {
      key: "type",
      label: t`Type`,
      value: values.hardDeadline ? t`Hard deadline` : t`Soft deadline`,
    },
    { key: "status", label: t`Status`, value: values.completed ? t`Completed` : t`Open` },
    { key: "comments", label: t`Comments`, value: values.comments ?? "" },
  ];
}

function workPackageStatus(status: string): string {
  switch (status) {
    case "pending":
      return t`Pending`;
    case "in_progress":
      return t`In progress`;
    case "on_hold":
      return t`On hold`;
    case "completed":
      return t`Completed`;
    case "cancelled":
      return t`Cancelled`;
    default:
      return status;
  }
}

function workPackagePriority(priority: string): string {
  switch (priority) {
    case "low":
      return t`Low`;
    case "medium":
      return t`Medium`;
    case "high":
      return t`High`;
    case "urgent":
      return t`Urgent`;
    default:
      return priority;
  }
}

function workPackageRows(values: WorkPackageValues): ChangeRow[] {
  const days = values.durationDays;
  return [
    { key: "title", label: t`Work package`, value: values.title },
    { key: "category", label: t`Category`, value: values.category ?? t`No category` },
    { key: "assignee", label: t`Assigned to`, value: values.assignee ?? t`Unassigned` },
    { key: "status", label: t`Status`, value: workPackageStatus(values.status) },
    { key: "priority", label: t`Priority`, value: workPackagePriority(values.priority) },
    { key: "duration", label: t`Duration`, value: days === 1 ? t`1 day` : t`${days} days` },
    { key: "canStart", label: t`Can start`, value: values.canStart ? dueDay(values.canStart) : "" },
    {
      key: "mustStart",
      label: t`Must start`,
      value: values.mustStart ? dueDay(values.mustStart) : "",
    },
    { key: "due", label: t`Due`, value: values.due ? dueDay(values.due) : "" },
    {
      key: "complete",
      label: t`Complete`,
      value: values.percentComplete ? `${values.percentComplete}%` : "",
    },
    { key: "notes", label: t`Notes`, value: values.notes ?? "" },
    {
      key: "links",
      label: t`Links`,
      value: values.links
        .map((link) => (link.title ? `${link.title}: ${link.url}` : link.url))
        .join("\n"),
    },
  ];
}

/** The deadline's or work package's fields, each changed value struck through before its new one. */
function ChangeRows({
  rows,
  before,
  hide = [],
}: {
  rows: ChangeRow[];
  before?: ChangeRow[];
  /** Fields the card already shows above; listed here only when they change. */
  hide?: string[];
}) {
  const { t } = useLingui();
  const shown = rows.flatMap((row) => {
    const previous = before?.find((item) => item.key === row.key)?.value;
    const changed = before !== undefined && previous !== row.value;
    if (!row.value && !previous) return [];
    if (hide.includes(row.key) && !changed) return [];
    return [{ ...row, previous, changed }];
  });
  if (shown.length === 0) return null;
  return (
    <dl className="mt-3.5 divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 text-[14px] leading-[1.45]">
      {shown.map((row) => (
        <div
          key={row.key}
          className={cn(
            "flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-baseline sm:gap-4",
            row.changed && "bg-primary/[0.05]",
          )}
        >
          <dt className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-muted-foreground sm:w-28">
            {row.changed ? (
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
            ) : null}
            {row.label}
          </dt>
          <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground">
            {row.changed && row.previous ? (
              <>
                <span className="text-muted-foreground line-through">{row.previous}</span>
                <ArrowRight
                  aria-hidden
                  className="mx-1.5 inline size-3.5 align-[-2px] text-muted-foreground"
                />
              </>
            ) : null}
            <span className={row.changed ? "font-medium" : undefined}>
              {row.value || (row.changed ? t`(cleared)` : "")}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

type Tone = "neutral" | "primary" | "success" | "warning" | "danger";

const CHIP_TONES: Record<Tone, string> = {
  neutral: "bg-foreground/[0.06] text-foreground/80",
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/10 text-destructive",
};

function Chip({
  tone = "neutral",
  icon: Icon,
  children,
}: {
  tone?: Tone;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium",
        CHIP_TONES[tone],
      )}
    >
      {Icon ? <Icon aria-hidden className="size-3 shrink-0" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

function initials(name: string): string {
  const parts = name.split(/[\s@.]+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?"
  );
}

function Avatar({ name, large }: { name: string; large?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-primary/15 font-semibold text-primary",
        large ? "size-10 text-[14px]" : "size-6 text-[10.5px]",
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Part of a card that opens its editor when clicked, while the card can still be edited. */
function EditableArea({
  onEdit,
  label,
  className,
  children,
}: {
  onEdit?: () => void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  if (!onEdit) return <div className={className}>{children}</div>;
  return (
    <button
      type="button"
      title={label}
      onClick={onEdit}
      className={cn(
        "group/edit relative block w-full rounded-xl text-start transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
      <Pencil
        aria-hidden
        className="absolute end-2 top-2 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/edit:opacity-100 group-focus-visible/edit:opacity-100"
      />
    </button>
  );
}

function daysFromToday(value: string): number {
  const today = new Date();
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((Date.parse(`${value}T00:00:00Z`) - start) / 86_400_000);
}

/** "in 6 days", "tomorrow", "3 days ago". */
function relativeDay(value: string | null): string | null {
  if (!value) return null;
  const days = daysFromToday(value);
  if (!Number.isFinite(days)) return null;
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(days, "day");
}

/** A due date drawn as a small calendar leaf. */
function DateTile({ value, done }: { value: string | null; done?: boolean }) {
  const date = value ? new Date(`${value}T00:00:00Z`) : null;
  const overdue = value && !done ? daysFromToday(value) < 0 : false;
  return (
    <div
      aria-hidden
      className="flex w-14 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background text-center shadow-xs"
    >
      <span
        className={cn(
          "py-0.5 text-[10.5px] font-semibold uppercase tracking-wide",
          overdue ? "bg-destructive text-white" : "bg-primary text-primary-foreground",
        )}
      >
        {date ? date.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" }) : "—"}
      </span>
      <span className="text-[21px] font-semibold leading-8 text-foreground">
        {date ? date.getUTCDate() : "?"}
      </span>
      <span className="pb-1 text-[10.5px] text-muted-foreground">
        {date ? date.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }) : ""}
      </span>
    </div>
  );
}

type HeaderTone = "primary" | "danger" | "soft" | "muted";

const HEADER_TONES: Record<HeaderTone, string> = {
  primary: "bg-primary text-primary-foreground",
  danger: "bg-destructive text-white",
  soft: "bg-muted/70 text-foreground",
  muted: "bg-muted/70 text-muted-foreground",
};

/** The coloured strip on top of every approval card: what it is and where it stands. */
function CardHeader({
  icon: Icon,
  tone,
  title,
  state,
}: {
  icon: LucideIcon;
  tone: HeaderTone;
  title: ReactNode;
  state: "waiting" | "done" | "closed";
}) {
  const strong = tone === "primary" || tone === "danger";
  return (
    <div className={cn("flex items-center gap-2.5 px-4 py-2.5", HEADER_TONES[tone])}>
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 truncate text-[13.5px] font-semibold">{title}</span>
      <span
        className={cn(
          "ms-auto inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium",
          strong ? "bg-white/20" : "bg-foreground/[0.06] text-muted-foreground",
        )}
      >
        {state === "waiting" ? (
          <>
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />
            <Trans>Needs your approval</Trans>
          </>
        ) : state === "done" ? (
          <>
            <Check aria-hidden className="size-3" />
            <Trans>Done</Trans>
          </>
        ) : (
          <Trans>Closed</Trans>
        )}
      </span>
    </div>
  );
}

function Warnings({ warnings }: { warnings?: string[] }) {
  if (!warnings?.length) return null;
  return (
    <ul className="mt-3.5 space-y-1.5 rounded-xl border border-warning/25 bg-warning/10 px-3 py-2.5 text-[13.5px] text-warning">
      {warnings.map((warning) => (
        <li key={warning} className="flex gap-2">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">{warning}</span>
        </li>
      ))}
    </ul>
  );
}

/** Small facts under a card's main content: who asked, who is emailed. */
function Footnotes({
  items,
}: {
  items: Array<{ key: string; icon: LucideIcon; label: ReactNode; value: ReactNode } | null>;
}) {
  const shown = items.filter((item) => item !== null);
  if (shown.length === 0) return null;
  return (
    <dl className="mt-3.5 space-y-1.5 text-[13px] leading-[1.45]">
      {shown.map((item) => (
        <div key={item.key} className="flex gap-2">
          <item.icon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <dt className="shrink-0 text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 whitespace-pre-wrap break-words text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const projectLabel = (project: DeadlineChange["project"]) =>
  [project.jobNumber, project.name].filter(Boolean).join(" · ");

/**
 * The frame every Evolve change card shares: the project, what changes, warnings, and the once-only
 * buttons. The change is saved only when it is approved here.
 */
function EvolveChangeCard({
  block,
  canAnswer,
  onAnswer,
  testId,
  icon,
  heading,
  project,
  children,
  warnings,
  allowLabel,
  approvedText,
  destructive,
  movedFrom,
  editor,
}: Pick<AskCardProps, "block" | "canAnswer" | "onAnswer"> & {
  testId: string;
  icon: LucideIcon;
  heading: ReactNode;
  project: DeadlineChange["project"];
  /** The preview; given a function, it hears how to open the editor while the card can be edited. */
  children: ReactNode | ((edit: (() => void) | undefined) => ReactNode);
  warnings?: string[];
  allowLabel: string;
  approvedText: string;
  destructive?: boolean;
  /** The project a work package change moves it out of. */
  movedFrom?: DeadlineChange["project"];
  /** The card's fields to edit before approving; closing returns to the preview. */
  editor?: (close: () => void) => ReactNode;
}) {
  const { t } = useLingui();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [acceptedAnswer, setAcceptedAnswer] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const answer = block.status === "answered" ? block.answer : acceptedAnswer;
  const answered = answer !== undefined;
  const editable = Boolean(editor) && canAnswer && !answered;
  const startEditing =
    editable && pendingAction === null
      ? () => {
          setError(null);
          setEditing(true);
        }
      : undefined;

  async function answerWith(id: string) {
    if (pendingAction) return;
    setPendingAction(id);
    setError(null);
    try {
      await onAnswer(id);
      setAcceptedAnswer(id);
    } catch (err) {
      setError(errorText(err, t`Could not submit this answer`));
    } finally {
      setPendingAction(null);
    }
  }

  const live = canAnswer && !answered;
  return (
    <BuiCard
      data-testid={testId}
      className={cn(
        "w-full min-w-0 max-w-xl overflow-hidden border border-border shadow-sm transition-shadow dark:border-transparent",
        live && "hover:shadow-md",
      )}
    >
      <CardHeader
        icon={icon}
        tone={!live ? "muted" : destructive ? "danger" : "primary"}
        title={heading}
        state={answered ? "done" : canAnswer ? "waiting" : "closed"}
      />
      <div className={cn("px-4 pt-3.5 pb-4", !live && "opacity-90")}>
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Building2 aria-hidden className="size-[18px]" />
          </span>
          <div className="min-w-0 pt-px">
            <div className="text-[14.5px] font-semibold leading-snug text-foreground break-words">
              {projectLabel(project) || t`Unnamed project`}
            </div>
            {project.client ? (
              <div className="truncate text-[12.5px] text-muted-foreground">{project.client}</div>
            ) : null}
            {movedFrom ? (
              <div className="mt-0.5 text-[12.5px] text-muted-foreground">
                <Trans>
                  Moved from{" "}
                  <span className="line-through">
                    {projectLabel(movedFrom) || t`Unnamed project`}
                  </span>
                </Trans>
              </div>
            ) : null}
          </div>
        </div>
        {editing && editable && editor
          ? editor(() => setEditing(false))
          : typeof children === "function"
            ? children(startEditing)
            : children}
        <Warnings warnings={warnings} />
      </div>
      {editing && editable ? null : (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/70 bg-muted/30 px-4 py-3">
          {answered ? (
            <div
              className={cn(
                "flex items-center gap-1.5 text-[13.5px] font-medium",
                answer === "deny" ? "text-muted-foreground" : "text-success",
              )}
            >
              {answer === "deny" ? (
                <CircleX aria-hidden className="size-4" />
              ) : (
                <CircleCheck aria-hidden className="size-4" />
              )}
              {answer === "deny" ? t`Cancelled` : approvedText}
            </div>
          ) : !canAnswer ? (
            <div className="text-[13.5px] font-medium text-muted-foreground">
              <Trans>No longer active</Trans>
            </div>
          ) : (
            <>
              {block.actions?.map((action) => {
                const allow = action.id === "allow";
                const AllowIcon = destructive ? Trash2 : Check;
                return (
                  <Button
                    key={action.id}
                    variant={!allow ? "ghost" : destructive ? "destructive" : "default"}
                    className="gap-1.5"
                    disabled={pendingAction !== null}
                    onClick={() => void answerWith(action.id)}
                  >
                    {pendingAction === action.id ? (
                      <>
                        <Spinner />
                        <Trans>Sending…</Trans>
                      </>
                    ) : allow ? (
                      <>
                        <AllowIcon aria-hidden className="size-4" />
                        {allowLabel}
                      </>
                    ) : (
                      t`Cancel`
                    )}
                  </Button>
                );
              })}
              {editable ? (
                <Button
                  variant="outline"
                  className="ms-auto gap-1.5"
                  disabled={pendingAction !== null}
                  onClick={startEditing}
                >
                  <Pencil aria-hidden className="size-3.5" />
                  <Trans>Edit</Trans>
                </Button>
              ) : null}
            </>
          )}
          {error ? <p className="w-full text-[13px] text-destructive">{error}</p> : null}
        </div>
      )}
    </BuiCard>
  );
}

/** A project deadline to add or change, previewed from Evolve; it is saved only when approved. */
function DeadlineAskCard({ change, ...props }: AskCardProps & { change: DeadlineChange }) {
  const { t } = useLingui();
  const adding = change.action === "add";
  const after = change.after;
  const when = relativeDay(after.date);
  return (
    <EvolveChangeCard
      {...props}
      testId="deadline-approval-card"
      icon={CalendarClock}
      heading={adding ? <Trans>New project deadline</Trans> : <Trans>Deadline change</Trans>}
      project={change.project}
      warnings={change.warnings}
      allowLabel={adding ? t`Add deadline` : t`Save changes`}
      approvedText={adding ? t`Approved: adding it to Evolve` : t`Approved: saving it in Evolve`}
      editor={
        props.onReviseChange && props.loadChangeOptions
          ? (close) => (
              <DeadlineEditor
                change={change}
                loadOptions={props.loadChangeOptions!}
                onRevise={props.onReviseChange!}
                onClose={close}
              />
            )
          : undefined
      }
    >
      {(edit) => (
        <>
          <EditableArea
            onEdit={edit}
            label={t`Edit deadline`}
            className="-mx-2 mt-3 flex w-[calc(100%+1rem)] items-center gap-3.5 px-2 py-2"
          >
            <DateTile value={after.date} done={after.completed} />
            <div className="min-w-0">
              <div className="text-[15.5px] font-semibold leading-snug text-foreground break-words">
                {after.name}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Chip tone={after.hardDeadline ? "danger" : "neutral"} icon={Flag}>
                  {after.hardDeadline ? t`Hard deadline` : t`Soft deadline`}
                </Chip>
                {after.completed ? (
                  <Chip tone="success" icon={CircleCheck}>
                    {t`Completed`}
                  </Chip>
                ) : null}
                {when && !after.completed ? (
                  <span className="text-[12.5px] text-muted-foreground">{when}</span>
                ) : null}
              </div>
            </div>
          </EditableArea>
          <ChangeRows
            rows={deadlineRows(after)}
            before={change.before ? deadlineRows(change.before) : undefined}
            hide={["name", "date", "type", "status"]}
          />
        </>
      )}
    </EvolveChangeCard>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  pending: "neutral",
  in_progress: "primary",
  on_hold: "warning",
  completed: "success",
  cancelled: "neutral",
};

const PRIORITY_TONES: Record<string, Tone> = {
  low: "neutral",
  medium: "primary",
  high: "warning",
  urgent: "danger",
};

function shortDay(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * A work package to add, change or delete, previewed from Evolve with who its email reaches; it is
 * saved only when approved.
 */
function WorkPackageAskCard({ change, ...props }: AskCardProps & { change: WorkPackageChange }) {
  const { t } = useLingui();
  const shown = change.after ?? change.before;
  const deleting = change.action === "delete";
  const days = shown?.durationDays ?? 0;
  const span =
    shown?.canStart || shown?.due
      ? [shown.canStart ? shortDay(shown.canStart) : "…", shown.due ? shortDay(shown.due) : "…"]
      : null;
  return (
    <EvolveChangeCard
      {...props}
      testId="work-package-approval-card"
      icon={ClipboardList}
      heading={
        change.action === "add" ? (
          <Trans>New work package</Trans>
        ) : change.action === "update" ? (
          <Trans>Work package change</Trans>
        ) : (
          <Trans>Delete work package</Trans>
        )
      }
      project={change.project}
      warnings={change.warnings}
      destructive={deleting}
      allowLabel={
        change.action === "add"
          ? t`Add work package`
          : change.action === "update"
            ? t`Save changes`
            : t`Delete work package`
      }
      approvedText={
        change.action === "add"
          ? t`Approved: adding it to Evolve`
          : change.action === "update"
            ? t`Approved: saving it in Evolve`
            : t`Approved: deleting it from Evolve`
      }
      movedFrom={change.movedFrom}
      editor={
        !deleting && change.after && props.onReviseChange && props.loadChangeOptions
          ? (close) => (
              <WorkPackageEditor
                change={change}
                loadOptions={props.loadChangeOptions!}
                onRevise={props.onReviseChange!}
                onClose={close}
                statusLabel={workPackageStatus}
                priorityLabel={workPackagePriority}
              />
            )
          : undefined
      }
    >
      {(edit) =>
        shown ? (
          <>
            <EditableArea
              onEdit={edit}
              label={t`Edit work package`}
              className={cn("-mx-2 mt-3 w-[calc(100%+1rem)] px-2 py-2", deleting && "opacity-70")}
            >
              <div className="pe-5 text-[15.5px] font-semibold leading-snug text-foreground break-words">
                {shown.title}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Chip tone={STATUS_TONES[shown.status] ?? "neutral"}>
                  {workPackageStatus(shown.status)}
                </Chip>
                <Chip tone={PRIORITY_TONES[shown.priority] ?? "neutral"} icon={Flag}>
                  {workPackagePriority(shown.priority)}
                </Chip>
                {shown.category ? <Chip icon={Tag}>{shown.category}</Chip> : null}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  {shown.assignee ? (
                    <>
                      <Avatar name={shown.assignee} />
                      <span className="truncate text-foreground">{shown.assignee}</span>
                    </>
                  ) : (
                    <>
                      <UserRound aria-hidden className="size-4" />
                      {t`Unassigned`}
                    </>
                  )}
                </span>
                {span ? (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarRange aria-hidden className="size-4" />
                    <span className="text-foreground">
                      {span[0]} – {span[1]}
                    </span>
                    · {days === 1 ? t`1 day` : t`${days} days`}
                  </span>
                ) : null}
              </div>
              {shown.percentComplete > 0 ? (
                <div className="mt-2.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/[0.08]">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-500"
                      style={{ width: `${Math.min(100, shown.percentComplete)}%` }}
                    />
                  </div>
                  <span className="text-[12px] tabular-nums text-muted-foreground">
                    {shown.percentComplete}%
                  </span>
                </div>
              ) : null}
            </EditableArea>
            <ChangeRows
              rows={workPackageRows(shown)}
              before={
                change.action === "update" && change.before
                  ? workPackageRows(change.before)
                  : undefined
              }
              hide={[
                "title",
                "category",
                "assignee",
                "status",
                "priority",
                "duration",
                "canStart",
                "due",
                "complete",
              ]}
            />
            <Footnotes
              items={[
                change.requester
                  ? {
                      key: "requester",
                      icon: UserRound,
                      label: <Trans>Requested by</Trans>,
                      value: change.requester,
                    }
                  : null,
                change.statusComment
                  ? {
                      key: "statusComment",
                      icon: MessageSquareText,
                      label: <Trans>Status comment</Trans>,
                      value: change.statusComment,
                    }
                  : null,
                change.emails?.length
                  ? {
                      key: "emails",
                      icon: Mail,
                      label: <Trans>Emails</Trans>,
                      value: change.emails.join(", "),
                    }
                  : null,
              ]}
            />
          </>
        ) : null
      }
    </EvolveChangeCard>
  );
}

/** A comment as a speech bubble; a reworded one shows its old wording faded above. */
function CommentBubble({
  text,
  faded,
  struck,
}: {
  text: string;
  faded?: boolean;
  struck?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl rounded-ss-md bg-muted/70 px-4 py-3 pe-8 text-[14.5px] leading-relaxed whitespace-pre-wrap break-words text-foreground",
        faded && "bg-muted/40 text-muted-foreground",
        struck && "text-muted-foreground line-through decoration-muted-foreground/60",
      )}
    >
      {text}
    </div>
  );
}

/**
 * A project comment to add, reword or delete as the person themselves, with its tracker category;
 * it is saved only when approved.
 */
function CommentAskCard({ change, ...props }: AskCardProps & { change: ProjectCommentChange }) {
  const { t } = useLingui();
  const shown = change.after ?? change.before;
  const deleting = change.action === "delete";
  const reworded = change.action === "update" && change.before;
  const recategorised = reworded && change.before!.category !== change.after?.category;
  return (
    <EvolveChangeCard
      {...props}
      testId="project-comment-approval-card"
      icon={MessageSquareText}
      heading={
        change.action === "add" ? (
          <Trans>New project comment</Trans>
        ) : change.action === "update" ? (
          <Trans>Comment change</Trans>
        ) : (
          <Trans>Delete project comment</Trans>
        )
      }
      project={change.project}
      destructive={deleting}
      allowLabel={
        change.action === "add"
          ? t`Add comment`
          : change.action === "update"
            ? t`Save changes`
            : t`Delete comment`
      }
      approvedText={
        change.action === "add"
          ? t`Approved: adding it to Evolve`
          : change.action === "update"
            ? t`Approved: saving it in Evolve`
            : t`Approved: deleting it from Evolve`
      }
      editor={
        !deleting && change.after && props.onReviseChange && props.loadChangeOptions
          ? (close) => (
              <CommentEditor
                change={change}
                loadOptions={props.loadChangeOptions!}
                onRevise={props.onReviseChange!}
                onClose={close}
              />
            )
          : undefined
      }
    >
      {(edit) =>
        shown ? (
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Avatar name={change.author || "?"} />
              <span className="text-[13.5px] font-medium text-foreground">
                {change.author || t`You`}
              </span>
              {change.date ? (
                <span className="text-[12.5px] text-muted-foreground">· {dueDay(change.date)}</span>
              ) : null}
              <span className="ms-auto inline-flex items-center gap-1">
                {recategorised ? (
                  <>
                    <span className="text-[12px] text-muted-foreground line-through">
                      {change.before!.category}
                    </span>
                    <ArrowRight aria-hidden className="size-3 text-muted-foreground" />
                  </>
                ) : null}
                {edit ? (
                  <button
                    type="button"
                    title={t`Change category`}
                    onClick={edit}
                    className="rounded-full transition hover:ring-2 hover:ring-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Chip tone="primary" icon={Tag}>
                      {shown.category}
                    </Chip>
                  </button>
                ) : (
                  <Chip tone={deleting ? "neutral" : "primary"} icon={Tag}>
                    {shown.category}
                  </Chip>
                )}
              </span>
            </div>
            {reworded && change.before!.text !== change.after?.text ? (
              <div className="mt-2.5">
                <div className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Trans>Before</Trans>
                </div>
                <CommentBubble text={change.before!.text} faded />
                <div className="mt-2.5 mb-1 text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Trans>After</Trans>
                </div>
              </div>
            ) : null}
            <EditableArea
              onEdit={edit}
              label={t`Edit comment`}
              className={cn(!reworded && "mt-2.5", "rounded-2xl rounded-ss-md")}
            >
              <CommentBubble text={shown.text} struck={deleting} />
            </EditableArea>
            {change.action === "add" ? (
              <p className="mt-3 flex items-start gap-1.5 text-[12.5px] text-muted-foreground">
                <Mail aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                <Trans>
                  Emails the project's director and manager, as for a comment added in Evolve
                </Trans>
              </p>
            ) : null}
          </div>
        ) : null
      }
    </EvolveChangeCard>
  );
}

/** The person joining or leaving a project's Design Team in one role; saved only when approved. */
function DesignTeamAskCard({ change, ...props }: AskCardProps & { change: DesignTeamChange }) {
  const { t } = useLingui();
  const joining = change.action === "add";
  const others = change.currentRoles.filter((role) => role !== change.role);
  return (
    <EvolveChangeCard
      {...props}
      testId="design-team-approval-card"
      icon={joining ? UserPlus : LogOut}
      heading={joining ? <Trans>Join Design Team</Trans> : <Trans>Leave Design Team</Trans>}
      project={change.project}
      warnings={change.warnings}
      destructive={!joining}
      allowLabel={joining ? t`Join team` : t`Leave team`}
      approvedText={
        joining ? t`Approved: adding you to the team` : t`Approved: taking you off the team`
      }
      editor={
        joining && props.onReviseChange && props.loadChangeOptions
          ? (close) => (
              <TeamRoleEditor
                change={change}
                loadOptions={props.loadChangeOptions!}
                onRevise={props.onReviseChange!}
                onClose={close}
              />
            )
          : undefined
      }
    >
      {(edit) => (
        <div className="mt-4">
          <div className="flex items-center gap-3">
            <Avatar name={change.person} large />
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold text-foreground">
                {change.person}
              </div>
              <div className="mt-1">
                <EditableArea
                  onEdit={edit}
                  label={t`Change role`}
                  className="inline-flex w-auto rounded-full pe-7"
                >
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-medium",
                      joining ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive",
                    )}
                  >
                    {change.emoji ? `${change.emoji} ${change.role}` : change.role}
                  </span>
                </EditableArea>
              </div>
            </div>
          </div>
          {others.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <UsersRound aria-hidden className="size-3.5" />
              <Trans>Other roles on this team</Trans>
              {others.map((role) => (
                <Chip key={role}>{role}</Chip>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </EvolveChangeCard>
  );
}

function PromptAskCard({ block, canAnswer, onAnswer, rpc = selectedSpaceRpc }: AskCardProps) {
  const { t } = useLingui();
  const [editing, setEditing] = useState(false);
  const [answer, setAnswer] = useState(block.instructionUpdate?.after ?? "");
  const [acceptedAnswer, setAcceptedAnswer] = useState<string>();
  const [undone, setUndone] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitting = pendingAction !== null;
  const answered = block.status === "answered" || acceptedAnswer !== undefined;
  const displayedAnswer = block.status === "answered" ? block.answer : acceptedAnswer;
  const approvalActions = isApprovalAskBlock(block) ? block.actions : undefined;
  const askActions = block.actions;
  const displayActions = block.instructionUpdate
    ? askActions?.flatMap((action) =>
        action.id === "allow" ? [action, { id: "edit", label: t`Edit` }] : [action],
      )
    : askActions;
  const optionQuestion =
    !approvalActions && !block.instructionUpdate && Boolean(askActions?.length);
  const chosenOption =
    answered && displayedAnswer ? resolveAskChoice(displayedAnswer, askActions) : undefined;
  const [writingOwn, setWritingOwn] = useState(false);
  const [ownAnswer, setOwnAnswer] = useState("");
  /** An answer in the person's own words rather than one of the options. */
  const ownChoice =
    optionQuestion && answered && displayedAnswer && !chosenOption ? displayedAnswer : undefined;
  // An edited draft is shown in the user's words, so the card reads as answered. A typed reply to
  // options already shows as the user's message, so it only dims them.
  const typedAnswer =
    answered &&
    !optionQuestion &&
    !approvalActions &&
    !block.instructionUpdate &&
    displayedAnswer !== "approved"
      ? displayedAnswer
      : undefined;
  async function submitAnswer(value: string) {
    if (submitting || !value.trim()) return;
    const submitValue = value.trim();
    setPendingAction(submitValue);
    setError(null);
    try {
      await onAnswer(submitValue);
      setAcceptedAnswer(submitValue);
    } catch (err) {
      setError(errorText(err, t`Could not submit this answer`));
    } finally {
      setPendingAction(null);
    }
  }

  const { instructionUpdate, settingsUpdate } = block;
  const undo = instructionUpdate?.undoVersionId
    ? {
        label: t`Instructions updated`,
        run: () =>
          rpc.bots.restoreInstructions({
            botId: instructionUpdate.botId,
            versionId: instructionUpdate.undoVersionId!,
            expectedInstructions: instructionUpdate.after,
            undo: true,
          }),
      }
    : settingsUpdate
      ? {
          label: t`Settings updated`,
          run: () =>
            rpc.bots.update({
              botId: settingsUpdate.botId,
              ...settingsUpdate.before,
              expectedSettings: settingsUpdate.after,
            }),
        }
      : undefined;
  if (undo)
    return (
      <BuiCard className="px-5 py-4">
        <div className="flex items-center gap-2 text-sm">
          {undo.label}
          <Button
            variant="link"
            disabled={undone || submitting}
            onClick={async () => {
              setPendingAction("undo");
              setError(null);
              try {
                await undo.run();
                setUndone(true);
              } catch (err) {
                setError(errorText(err));
              } finally {
                setPendingAction(null);
              }
            }}
          >
            {undone ? <Trans>Restored</Trans> : <Trans>Undo</Trans>}
          </Button>
          {error ? <span className="text-destructive">{error}</span> : null}
        </div>
      </BuiCard>
    );

  const live = canAnswer && !answered;
  const approval = Boolean(block.instructionUpdate || approvalActions || !askActions?.length);
  const fields = block.detail && block.detailFormat === "text" ? detailFields(block.detail) : null;
  return (
    <BuiCard
      data-testid={block.instructionUpdate ? "instruction-approval-card" : undefined}
      className={cn(
        "w-full min-w-0 max-w-xl overflow-hidden border border-border shadow-sm transition-shadow dark:border-transparent",
        live && "hover:shadow-md",
      )}
    >
      <CardHeader
        icon={block.instructionUpdate ? FilePenLine : approval ? ShieldCheck : CircleHelp}
        tone={!live ? "muted" : approval ? "primary" : "soft"}
        title={
          block.instructionUpdate ? (
            <Trans>Instructions</Trans>
          ) : approval ? (
            <Trans>Approval</Trans>
          ) : (
            <Trans>Question</Trans>
          )
        }
        state={answered ? "done" : canAnswer ? "waiting" : "closed"}
      />
      <div className="px-4 pt-3.5 pb-4">
        <div className="text-[15.5px] font-medium leading-[1.5] text-foreground">
          {block.instructionUpdate ? (
            <Trans>Update instructions?</Trans>
          ) : (
            <ChatMarkdown>{block.text}</ChatMarkdown>
          )}
        </div>
        {fields ? (
          <dl
            data-testid="ask-detail"
            className="mt-3 max-h-80 divide-y divide-border/60 overflow-auto rounded-xl border border-border/70 text-[14px] leading-[1.45]"
          >
            {fields.map((field, index) =>
              field.label ? (
                <div
                  key={index}
                  className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-baseline sm:gap-4"
                >
                  <dt className="shrink-0 text-[12.5px] text-muted-foreground sm:w-28">
                    {field.label}
                  </dt>
                  <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground">
                    {field.value}
                  </dd>
                </div>
              ) : (
                <p
                  key={index}
                  className="px-3 py-2 whitespace-pre-wrap break-words text-[13.5px] text-muted-foreground"
                >
                  {field.value}
                </p>
              ),
            )}
          </dl>
        ) : block.detail ? (
          <pre
            data-testid="ask-detail"
            className={
              block.detailFormat === "text"
                ? "mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words font-sans text-[15.5px] leading-[1.5] text-foreground"
                : "mt-2.5 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background px-3 py-2 font-mono text-[13px] leading-[1.6] text-foreground"
            }
          >
            {block.detail}
          </pre>
        ) : null}
        {block.instructionUpdate && editing && canAnswer && !answered ? (
          <form
            className="mt-3 space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submitAnswer(JSON.stringify({ instructions: answer }));
            }}
          >
            <Textarea
              aria-label={t`Instructions`}
              maxLength={BOT_INSTRUCTIONS_MAX_LENGTH}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
            />
            <Button type="submit" disabled={submitting}>
              <Trans>Apply</Trans>
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditing(false)}>
              <Trans>Cancel</Trans>
            </Button>
          </form>
        ) : optionQuestion ? (
          // Options stay in place once answered: the chosen one is marked, the rest dim.
          <div className="mt-3.5 space-y-2">
            {askActions?.map((action, index) => (
              <OptionRow
                key={action.id}
                letter={optionLetter(index)}
                selected={chosenOption?.id === action.id}
                disabled={answered || !canAnswer || submitting}
                onClick={() => void submitAnswer(action.id)}
              >
                {pendingAction === action.id ? <Trans>Sending…</Trans> : action.label}
              </OptionRow>
            ))}
            {writingOwn && canAnswer && !answered ? (
              <form
                className="flex flex-col gap-2 rounded-xl border border-border px-3 py-2.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitAnswer(ownAnswer);
                }}
              >
                <Textarea
                  aria-label={t`Your answer`}
                  autoFocus
                  rows={2}
                  value={ownAnswer}
                  onChange={(event) => setOwnAnswer(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      void submitAnswer(ownAnswer);
                    }
                  }}
                  placeholder={t`Type your answer`}
                />
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={!ownAnswer.trim() || submitting}>
                    {submitting ? <Trans>Sending…</Trans> : <Trans>Send answer</Trans>}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={submitting}
                    onClick={() => setWritingOwn(false)}
                  >
                    <Trans>Cancel</Trans>
                  </Button>
                </div>
              </form>
            ) : (
              <OptionRow
                letter={optionLetter(askActions?.length ?? 0)}
                selected={Boolean(ownChoice)}
                disabled={answered || !canAnswer || submitting}
                onClick={() => setWritingOwn(true)}
              >
                {ownChoice ?? <Trans>Type my own answer</Trans>}
              </OptionRow>
            )}
          </div>
        ) : typedAnswer ? (
          <blockquote
            data-testid="ask-answer"
            className="mt-3 whitespace-pre-wrap break-words border-s-2 border-border ps-3 text-[15px] leading-[1.5] text-muted-foreground"
          >
            {typedAnswer}
          </blockquote>
        ) : answered ? (
          <div className="mt-3.5 flex items-center gap-1.5 text-[13.5px] font-medium text-muted-foreground">
            {displayedAnswer === "deny" ||
            approvalActions?.find((action) => action.id === displayedAnswer)?.outcome ===
              "cancelled" ? null : (
              <Check aria-hidden className="size-4" />
            )}
            {block.instructionUpdate
              ? displayedAnswer === "deny"
                ? t`Dismissed`
                : t`Allowed once`
              : formatAnsweredState(
                  displayedAnswer,
                  Boolean(approvalActions),
                  approvalActions?.find((action) => action.id === displayedAnswer)?.outcome,
                  askActions,
                )}
          </div>
        ) : !canAnswer ? (
          <div className="mt-3.5 text-[13.5px] font-medium text-muted-foreground">
            <Trans>No longer active</Trans>
          </div>
        ) : displayActions?.length ? (
          <div className="mt-3.5 flex flex-wrap gap-2">
            {displayActions.map((action) => (
              <Button
                key={action.id}
                variant={
                  action.id === "allow" ? "default" : action.id === "deny" ? "ghost" : "outline"
                }
                // Wraps long site names like the other cards' buttons.
                className="h-auto min-h-8 min-w-0 gap-1.5 whitespace-normal py-1 text-start"
                disabled={submitting}
                onClick={() =>
                  action.id === "edit" && block.instructionUpdate
                    ? setEditing(true)
                    : void submitAnswer(action.id)
                }
              >
                {pendingAction === action.id ? (
                  <Trans>Sending…</Trans>
                ) : action.id === "edit" ? (
                  action.label
                ) : block.instructionUpdate ? (
                  action.id === "allow" ? (
                    t`Apply`
                  ) : (
                    t`Dismiss`
                  )
                ) : (
                  <>
                    {action.id === "allow" ? (
                      <Check aria-hidden className="size-4 shrink-0" />
                    ) : action.id === "always" ? (
                      <ShieldCheck aria-hidden className="size-4 shrink-0" />
                    ) : action.id === "deny" ? (
                      <X aria-hidden className="size-4 shrink-0" />
                    ) : null}
                    {approvalActionLabel(action.id, action.label, action.outcome, block.site)}
                  </>
                )}
              </Button>
            ))}
          </div>
        ) : editing ? (
          <form
            className="mt-3.5 flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submitAnswer(answer);
            }}
          >
            <Input
              aria-label={t`Answer`}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder={t`Type your answer`}
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={!answer.trim() || submitting}>
                {submitting ? <Trans>Sending…</Trans> : <Trans>Send answer</Trans>}
              </Button>
              <Button
                variant="outline"
                disabled={submitting}
                onClick={() => {
                  setAnswer("");
                  setEditing(false);
                }}
              >
                <Trans>Cancel</Trans>
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-3.5 flex gap-2">
            <Button disabled={submitting} onClick={() => void submitAnswer("approved")}>
              {submitting ? <Trans>Sending…</Trans> : <Trans>Send it</Trans>}
            </Button>
            <Button variant="outline" disabled={submitting} onClick={() => setEditing(true)}>
              <Trans>Edit first</Trans>
            </Button>
          </div>
        )}
        {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}
      </div>
    </BuiCard>
  );
}

const FIELD_LINE = /^([A-Z][A-Za-z0-9 &/()'-]{0,30}):\s+(.+)$/;

/**
 * A plain-text detail written as "Label: value" lines, as fields; null when it is not mostly such
 * lines, so prose and code keep their own layout.
 */
function detailFields(detail: string): Array<{ label: string | null; value: string }> | null {
  const lines = detail.split("\n").filter((line) => line.trim());
  const fields = lines.map((line) => {
    const match = FIELD_LINE.exec(line.trim());
    return match ? { label: match[1]!, value: match[2]! } : { label: null, value: line.trim() };
  });
  const labelled = fields.filter((field) => field.label).length;
  return labelled >= 2 && labelled >= fields.length / 2 ? fields : null;
}
