import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import type { LoginFieldInput, ThreadMessage } from "@rakazo/contracts";
import { BOT_INSTRUCTIONS_MAX_LENGTH } from "@rakazo/contracts";
import {
  isApprovalAskBlock,
  isSecretAskBlock,
  resolveAskChoice,
  selectedAskActionLabel,
} from "@rakazo/core";
import { Button, Input, Textarea } from "@rakazo/ui-web";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import type { RpcClient } from "../lib/rpc";
import { rpc as selectedSpaceRpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { BuiCard } from "./ai/primitives";
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
};

/** A question, approval or protected-input request from the bot. */
export function AskCard(props: AskCardProps) {
  if (isSecretAskBlock(props.block)) return <SecretAskCard {...props} />;
  if (props.block.deadlineChange && isApprovalAskBlock(props.block))
    return <DeadlineAskCard {...props} change={props.block.deadlineChange} />;
  if (props.block.workPackageChange && isApprovalAskBlock(props.block))
    return <WorkPackageAskCard {...props} change={props.block.workPackageChange} />;
  return <PromptAskCard {...props} />;
}

type DeadlineChange = NonNullable<AskBlock["deadlineChange"]>;
type DeadlineValues = DeadlineChange["after"];
type WorkPackageChange = NonNullable<AskBlock["workPackageChange"]>;
type WorkPackageValues = NonNullable<WorkPackageChange["after"]>;
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

/** The deadline's or work package's fields, with each changed value struck through beside its new one. */
function ChangeRows({ rows, before }: { rows: ChangeRow[]; before?: ChangeRow[] }) {
  const { t } = useLingui();
  const shown = rows.filter(
    (row) => row.value || before?.find((item) => item.key === row.key)?.value,
  );
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14.5px] leading-[1.45]">
      {shown.map((row) => {
        const previous = before?.find((item) => item.key === row.key)?.value;
        const changed = before !== undefined && previous !== row.value;
        return (
          <div key={row.key} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words text-foreground">
              {changed && previous ? (
                <span className="me-1.5 text-muted-foreground line-through">{previous}</span>
              ) : null}
              <span className={changed ? "font-medium" : undefined}>
                {row.value || (changed ? t`(cleared)` : "")}
              </span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * The frame every Evolve change card shares: the project, what changes, warnings, and the once-only
 * buttons. The change is saved only when it is approved here.
 */
function EvolveChangeCard({
  block,
  canAnswer,
  onAnswer,
  testId,
  heading,
  project,
  children,
  warnings,
  allowLabel,
  approvedText,
  destructive,
}: Pick<AskCardProps, "block" | "canAnswer" | "onAnswer"> & {
  testId: string;
  heading: ReactNode;
  project: DeadlineChange["project"];
  children: ReactNode;
  warnings?: string[];
  allowLabel: string;
  approvedText: string;
  destructive?: boolean;
}) {
  const { t } = useLingui();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [acceptedAnswer, setAcceptedAnswer] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const answer = block.status === "answered" ? block.answer : acceptedAnswer;
  const answered = answer !== undefined;

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

  return (
    <BuiCard
      data-testid={testId}
      className="w-full min-w-0 max-w-xl overflow-hidden border border-border dark:border-transparent"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-2.5">
        <span className="text-[13px] font-medium text-muted-foreground">{heading}</span>
        <StatusBadge tone={answered ? "positive" : canAnswer ? "caution" : "neutral"}>
          {answered ? (
            <Trans>Done</Trans>
          ) : canAnswer ? (
            <Trans>Needs your approval</Trans>
          ) : (
            <Trans>Closed</Trans>
          )}
        </StatusBadge>
      </div>
      <div className="px-5 py-4">
        <div className="rounded-lg bg-background px-3 py-2.5">
          <div className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            <Trans>Project</Trans>
          </div>
          <div className="mt-0.5 text-[15px] font-medium text-foreground">
            {[project.jobNumber, project.name].filter(Boolean).join(" · ") || t`Unnamed project`}
          </div>
          {project.client ? (
            <div className="text-[13.5px] text-muted-foreground">{project.client}</div>
          ) : null}
        </div>
        {children}
        {warnings?.length ? (
          <ul className="mt-3 space-y-1 rounded-lg bg-warning/10 px-3 py-2 text-[13.5px] text-warning">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
        {answered ? (
          <div className="mt-3.5 flex items-center gap-1.5 text-[13.5px] font-medium text-muted-foreground">
            {answer === "deny" ? null : <Check aria-hidden className="size-4" />}
            {answer === "deny" ? t`Cancelled` : approvedText}
          </div>
        ) : !canAnswer ? (
          <div className="mt-3.5 text-[13.5px] font-medium text-muted-foreground">
            <Trans>No longer active</Trans>
          </div>
        ) : (
          <div className="mt-3.5 flex flex-wrap gap-2">
            {block.actions?.map((action) => (
              <Button
                key={action.id}
                variant={
                  action.id !== "allow" ? "outline" : destructive ? "destructive" : "default"
                }
                disabled={pendingAction !== null}
                onClick={() => void answerWith(action.id)}
              >
                {pendingAction === action.id ? (
                  <Trans>Sending…</Trans>
                ) : action.id === "allow" ? (
                  allowLabel
                ) : (
                  t`Cancel`
                )}
              </Button>
            ))}
          </div>
        )}
        {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}
      </div>
    </BuiCard>
  );
}

/** A project deadline to add or change, previewed from Evolve; it is saved only when approved. */
function DeadlineAskCard({ change, ...props }: AskCardProps & { change: DeadlineChange }) {
  const { t } = useLingui();
  const adding = change.action === "add";
  return (
    <EvolveChangeCard
      {...props}
      testId="deadline-approval-card"
      heading={adding ? <Trans>New project deadline</Trans> : <Trans>Deadline change</Trans>}
      project={change.project}
      warnings={change.warnings}
      allowLabel={adding ? t`Add deadline` : t`Save changes`}
      approvedText={adding ? t`Approved: adding it to Evolve` : t`Approved: saving it in Evolve`}
    >
      <ChangeRows
        rows={deadlineRows(change.after)}
        before={change.before ? deadlineRows(change.before) : undefined}
      />
    </EvolveChangeCard>
  );
}

/**
 * A work package to add, change or delete, previewed from Evolve with who its email reaches; it is
 * saved only when approved.
 */
function WorkPackageAskCard({ change, ...props }: AskCardProps & { change: WorkPackageChange }) {
  const { t } = useLingui();
  const shown = change.after ?? change.before;
  return (
    <EvolveChangeCard
      {...props}
      testId="work-package-approval-card"
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
      destructive={change.action === "delete"}
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
    >
      {shown ? (
        <ChangeRows
          rows={workPackageRows(shown)}
          before={
            change.action === "update" && change.before ? workPackageRows(change.before) : undefined
          }
        />
      ) : null}
      {change.requester || change.statusComment || change.emails?.length ? (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-border pt-3 text-[13.5px] leading-[1.45]">
          {change.requester ? (
            <div className="contents">
              <dt className="text-muted-foreground">
                <Trans>Requested by</Trans>
              </dt>
              <dd className="min-w-0 text-foreground">{change.requester}</dd>
            </div>
          ) : null}
          {change.statusComment ? (
            <div className="contents">
              <dt className="text-muted-foreground">
                <Trans>Status comment</Trans>
              </dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words text-foreground">
                {change.statusComment}
              </dd>
            </div>
          ) : null}
          {change.emails?.length ? (
            <div className="contents">
              <dt className="text-muted-foreground">
                <Trans>Emails</Trans>
              </dt>
              <dd className="min-w-0 break-words text-foreground">{change.emails.join(", ")}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
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

  return (
    <BuiCard
      data-testid={block.instructionUpdate ? "instruction-approval-card" : undefined}
      className="w-full min-w-0 max-w-xl overflow-hidden border border-border dark:border-transparent"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-2.5">
        <span className="text-[13px] font-medium text-muted-foreground">
          {block.instructionUpdate ? (
            <Trans>Instructions</Trans>
          ) : approvalActions || !askActions?.length ? (
            <Trans>Needs your approval</Trans>
          ) : (
            <Trans>Question</Trans>
          )}
        </span>
        <StatusBadge tone={answered ? "positive" : canAnswer ? "caution" : "neutral"}>
          {answered ? (
            <Trans>Done</Trans>
          ) : canAnswer ? (
            <Trans>Waiting on you</Trans>
          ) : (
            <Trans>Closed</Trans>
          )}
        </StatusBadge>
      </div>
      <div className="px-5 py-4">
        <div className="text-[15.5px] leading-[1.5] text-foreground">
          {block.instructionUpdate ? (
            <Trans>Update instructions?</Trans>
          ) : (
            <ChatMarkdown>{block.text}</ChatMarkdown>
          )}
        </div>
        {block.detail ? (
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
                variant={action.id === "allow" ? "default" : "outline"}
                // Wraps long site names like the other cards' buttons.
                className="h-auto min-h-8 min-w-0 whitespace-normal py-1 text-start"
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
                  approvalActionLabel(action.id, action.label, action.outcome, block.site)
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

const BADGE_TONES = {
  neutral: "bg-foreground/5 text-muted-foreground",
  positive: "bg-success/10 text-success",
  caution: "bg-warning/15 text-warning",
} as const;

function StatusBadge({ tone, children }: { tone: keyof typeof BADGE_TONES; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[12px] font-medium ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}
