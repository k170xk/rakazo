import { Trans, useLingui } from "@lingui/react/macro";
import type {
  EvolveChangeEdits,
  EvolveChangeOptionKind,
  EvolveChangeOptions,
  ThreadMessage,
} from "@rakazo/contracts";
import {
  Button,
  Checkbox,
  Input,
  NativeSelect,
  NativeSelectOption,
  Spinner,
  Textarea,
} from "@rakazo/ui-web";
import { Pencil, RefreshCw, Search } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useId, useState } from "react";
import { errorText } from "../lib/user-error";

export type LoadChangeOptions = (
  kind: EvolveChangeOptionKind,
  query: string,
) => Promise<EvolveChangeOptions>;

type AskBlock = Extract<ThreadMessage["blocks"][number], { kind: "ask" }>;
type DeadlineChange = NonNullable<AskBlock["deadlineChange"]>;
type WorkPackageChange = NonNullable<AskBlock["workPackageChange"]>;
type ProjectCommentChange = NonNullable<AskBlock["projectCommentChange"]>;
type DesignTeamChange = NonNullable<AskBlock["designTeamChange"]>;
type SiteVisitChange = NonNullable<AskBlock["siteVisitChange"]>;
type Choice = { value: string; label: string; detail?: string | null };

const SEARCH_DELAY_MS = 250;

/** Kinds Evolve lists in full, filtered here as you type rather than searched. */
const LISTED_KINDS = new Set<EvolveChangeOptionKind>([
  "categories",
  "comment_categories",
  "team_roles",
]);

function choicesOf(kind: EvolveChangeOptionKind, options: EvolveChangeOptions): Choice[] {
  if (LISTED_KINDS.has(kind)) {
    return (options.categories ?? []).map((name) => ({ value: name, label: name }));
  }
  if (kind === "people") {
    return (options.people ?? []).map((person) => ({
      value: person.email,
      label: person.name,
      detail: person.email,
    }));
  }
  return (options.projects ?? []).map((project) => ({
    value: String(project.projectId),
    label: [project.jobNumber, project.name].filter(Boolean).join(" · ") || "",
    detail: project.client,
  }));
}

/**
 * A field whose choices come live from Evolve: projects and people are searched as you type,
 * categories are listed once and filtered here. Only a listed choice can be picked.
 */
function EvolvePicker({
  kind,
  label,
  current,
  loadOptions,
  extra,
  onPick,
}: {
  kind: EvolveChangeOptionKind;
  label: string;
  current: string;
  loadOptions: LoadChangeOptions;
  /** A choice offered before the results, such as Unassigned. */
  extra?: Choice;
  onPick: (choice: Choice) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searched = LISTED_KINDS.has(kind) ? "" : query.trim();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(
      () => {
        setError(null);
        loadOptions(kind, searched)
          .then((options) => {
            if (!cancelled) setChoices(choicesOf(kind, options));
          })
          .catch((reason: unknown) => {
            if (!cancelled) setError(errorText(reason, t`Could not load the choices from Evolve`));
          });
      },
      searched ? SEARCH_DELAY_MS : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, kind, searched, loadOptions, t]);

  const lower = query.trim().toLowerCase();
  const shown =
    LISTED_KINDS.has(kind) && lower
      ? (choices ?? []).filter((choice) => choice.label.toLowerCase().includes(lower))
      : (choices ?? []);

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        className="h-9 w-full min-w-0 justify-between font-normal"
        aria-label={t`Change ${label}`}
        onClick={() => {
          setQuery("");
          setOpen(true);
        }}
      >
        <span className="min-w-0 truncate">{current}</span>
        <Search aria-hidden="true" className="text-muted-foreground" />
      </Button>
    );
  }
  return (
    <div className="rounded-lg border border-border">
      <Input
        // The search opens because this field was chosen.
        autoFocus
        aria-label={t`Search ${label}`}
        data-testid={`evolve-picker-${kind}`}
        className="h-9 rounded-b-none border-0 border-b border-border"
        placeholder={
          kind === "projects"
            ? t`Job number, project or client`
            : kind === "people"
              ? t`Name`
              : kind === "team_roles"
                ? t`Role`
                : t`Category`
        }
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      <div className="max-h-56 overflow-y-auto p-1">
        {error ? (
          <p role="alert" className="px-2 py-1.5 text-[13px] text-destructive">
            {error}
          </p>
        ) : choices === null ? (
          <p className="px-2 py-1.5 text-[13px] text-muted-foreground">
            <Trans>Loading from Evolve…</Trans>
          </p>
        ) : (
          <>
            {(extra ? [extra, ...shown] : shown).map((choice) => (
              <ChoiceButton
                key={choice.value}
                choice={choice}
                onPick={(picked) => {
                  setOpen(false);
                  onPick(picked);
                }}
              />
            ))}
            {shown.length === 0 ? (
              <p className="px-2 py-1.5 text-[13px] text-muted-foreground">
                <Trans>Nothing in Evolve matches.</Trans>
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function ChoiceButton({ choice, onPick }: { choice: Choice; onPick: (choice: Choice) => void }) {
  return (
    <button
      type="button"
      className="flex w-full min-w-0 flex-col items-start rounded-md px-2 py-1.5 text-left text-[13.5px] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      onClick={() => onPick(choice)}
    >
      <span className="w-full truncate text-foreground">{choice.label}</span>
      {choice.detail ? (
        <span className="w-full truncate text-[12px] text-muted-foreground">{choice.detail}</span>
      ) : null}
    </button>
  );
}

function Row({
  label,
  htmlFor,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid items-start gap-1 sm:grid-cols-[7.5rem_1fr] sm:gap-x-3">
      <label
        htmlFor={htmlFor}
        className="text-[12.5px] font-medium text-muted-foreground sm:pt-2 sm:text-[13px]"
      >
        {label}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** The fields that differ from the card as it was opened, ready to send. */
function changedEdits<T extends Record<string, unknown>>(start: T, now: T): Partial<T> {
  const edits: Partial<T> = {};
  for (const key of Object.keys(now) as (keyof T)[]) {
    if (now[key] !== undefined && now[key] !== start[key]) edits[key] = now[key];
  }
  return edits;
}

function EditorFrame({
  children,
  error,
  saving,
  onSave,
  onClose,
}: {
  children: ReactNode;
  error: string | null;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <form
      className="mt-3.5 animate-in fade-in-0 slide-in-from-top-1 overflow-hidden rounded-xl border border-primary/30 bg-primary/[0.03] duration-200"
      data-testid="evolve-change-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !saving) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-1.5 border-b border-primary/20 px-3.5 py-2 text-[12.5px] font-medium text-primary">
        <Pencil aria-hidden className="size-3.5" />
        <Trans>Editing</Trans>
      </div>
      <div className="space-y-3 p-3.5">
        {children}
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive"
          >
            {error}
          </p>
        ) : null}
        <p className="text-[12.5px] text-muted-foreground">
          <Trans>
            Evolve checks the change again; nothing is saved until you approve the card.
          </Trans>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving} className="gap-1.5">
            {saving ? <Spinner /> : <RefreshCw aria-hidden className="size-4" />}
            {saving ? <Trans>Checking with Evolve…</Trans> : <Trans>Update card</Trans>}
          </Button>
          <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
            <Trans>Back</Trans>
          </Button>
        </div>
      </div>
    </form>
  );
}

function useRevision(onRevise: (edits: EvolveChangeEdits) => Promise<void>, onClose: () => void) {
  const { t } = useLingui();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(edits: EvolveChangeEdits) {
    if (saving) return;
    if (Object.keys(edits).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onRevise(edits);
      onClose();
    } catch (reason) {
      setError(errorText(reason, t`Evolve did not accept that change`));
    } finally {
      setSaving(false);
    }
  }
  return { saving, error, send, clearError: () => setError(null) };
}

const projectLabel = (project: { jobNumber: string | null; name: string | null }) =>
  [project.jobNumber, project.name].filter(Boolean).join(" · ");

/** A deadline card's fields, changed before it is approved; a new deadline can go to another project. */
export function DeadlineEditor({
  change,
  loadOptions,
  onRevise,
  onClose,
}: {
  change: DeadlineChange;
  loadOptions: LoadChangeOptions;
  onRevise: (edits: EvolveChangeEdits) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const ids = { name: useId(), date: useId(), type: useId(), comments: useId(), done: useId() };
  const start = {
    name: change.after.name,
    date: change.after.date ?? "",
    hard_deadline: change.after.hardDeadline,
    completed: change.after.completed,
    comments: change.after.comments ?? "",
  };
  const [form, setForm] = useState(start);
  const [project, setProject] = useState<{ id: number; label: string } | null>(null);
  const revision = useRevision(onRevise, onClose);
  const set = <K extends keyof typeof start>(key: K, value: (typeof start)[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    revision.clearError();
  };
  const adding = change.action === "add";

  return (
    <EditorFrame
      error={revision.error}
      saving={revision.saving}
      onClose={onClose}
      onSave={() => {
        const edits: EvolveChangeEdits = changedEdits(start, form);
        // Only an existing deadline can be completed or reopened.
        if (adding) delete edits.completed;
        if (adding && project) edits.project_id = project.id;
        void revision.send(edits);
      }}
    >
      {adding ? (
        <Row label={<Trans>Project</Trans>}>
          <EvolvePicker
            kind="projects"
            label={t`project`}
            current={project?.label ?? (projectLabel(change.project) || t`Choose a project`)}
            loadOptions={loadOptions}
            onPick={(choice) => setProject({ id: Number(choice.value), label: choice.label })}
          />
        </Row>
      ) : null}
      <Row label={<Trans>Deadline</Trans>} htmlFor={ids.name}>
        <Input
          id={ids.name}
          maxLength={200}
          value={form.name}
          onChange={(event) => set("name", event.target.value)}
        />
      </Row>
      <Row label={<Trans>Due</Trans>} htmlFor={ids.date}>
        <Input
          id={ids.date}
          type="date"
          value={form.date}
          onChange={(event) => set("date", event.target.value)}
        />
      </Row>
      <Row label={<Trans>Type</Trans>} htmlFor={ids.type}>
        <NativeSelect
          id={ids.type}
          value={form.hard_deadline ? "hard" : "soft"}
          onChange={(event) => set("hard_deadline", event.target.value === "hard")}
        >
          <NativeSelectOption value="hard">{t`Hard deadline`}</NativeSelectOption>
          <NativeSelectOption value="soft">{t`Soft deadline`}</NativeSelectOption>
        </NativeSelect>
      </Row>
      {!adding ? (
        <Row label={<Trans>Completed</Trans>} htmlFor={ids.done}>
          <Checkbox
            id={ids.done}
            className="mt-2.5"
            checked={form.completed}
            onCheckedChange={(checked) => set("completed", checked === true)}
          />
        </Row>
      ) : null}
      <Row label={<Trans>Comments</Trans>} htmlFor={ids.comments}>
        <Textarea
          id={ids.comments}
          rows={2}
          maxLength={2000}
          value={form.comments}
          onChange={(event) => set("comments", event.target.value)}
        />
      </Row>
    </EditorFrame>
  );
}

const STATUSES = ["pending", "in_progress", "on_hold", "completed", "cancelled"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

/**
 * A work package card's fields as the Work Packages page edits them: project, category and assignee
 * come live from Evolve, so the category's email group follows the choice.
 */
export function WorkPackageEditor({
  change,
  loadOptions,
  onRevise,
  onClose,
  statusLabel,
  priorityLabel,
}: {
  change: WorkPackageChange;
  loadOptions: LoadChangeOptions;
  onRevise: (edits: EvolveChangeEdits) => Promise<void>;
  onClose: () => void;
  statusLabel: (status: string) => string;
  priorityLabel: (priority: string) => string;
}) {
  const { t } = useLingui();
  const values = change.after!;
  const ids = {
    title: useId(),
    duration: useId(),
    canStart: useId(),
    due: useId(),
    status: useId(),
    comment: useId(),
    priority: useId(),
    complete: useId(),
    notes: useId(),
  };
  const updating = change.action === "update";
  const start = {
    title: values.title,
    duration_days: values.durationDays,
    can_start_date: values.canStart ?? "",
    due_date: values.due ?? "",
    priority: values.priority as (typeof PRIORITIES)[number],
    notes: values.notes ?? "",
    ...(updating
      ? {
          status: values.status as (typeof STATUSES)[number],
          status_comment: change.statusComment ?? "",
          completion_percentage: values.percentComplete,
        }
      : {}),
  };
  const [form, setForm] = useState(start);
  const [project, setProject] = useState<{ id: number; label: string } | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<{ value: string; label: string } | null>(null);
  const revision = useRevision(onRevise, onClose);
  const set = <K extends keyof typeof start>(key: K, value: (typeof start)[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    revision.clearError();
  };
  const statusChanged = updating && form.status !== (change.before?.status ?? values.status);

  return (
    <EditorFrame
      error={revision.error}
      saving={revision.saving}
      onClose={onClose}
      onSave={() => {
        const edits: EvolveChangeEdits = changedEdits(start, form);
        if (!statusChanged) delete edits.status_comment;
        if (project) edits.project_id = project.id;
        if (category !== null) edits.category = category;
        if (assignee) edits.assignee = assignee.value;
        void revision.send(edits);
      }}
    >
      <Row label={<Trans>Project</Trans>}>
        <EvolvePicker
          kind="projects"
          label={t`project`}
          current={project?.label ?? (projectLabel(change.project) || t`Choose a project`)}
          loadOptions={loadOptions}
          onPick={(choice) => setProject({ id: Number(choice.value), label: choice.label })}
        />
      </Row>
      <Row label={<Trans>Work package</Trans>} htmlFor={ids.title}>
        <Input
          id={ids.title}
          maxLength={300}
          value={form.title}
          onChange={(event) => set("title", event.target.value)}
        />
      </Row>
      <Row label={<Trans>Category</Trans>}>
        <EvolvePicker
          kind="categories"
          label={t`category`}
          current={(category === "none" ? null : category) ?? values.category ?? t`No category`}
          loadOptions={loadOptions}
          extra={{ value: "none", label: t`No category` }}
          onPick={(choice) => setCategory(choice.value)}
        />
      </Row>
      <Row label={<Trans>Assigned to</Trans>}>
        <EvolvePicker
          kind="people"
          label={t`assignee`}
          current={assignee?.label ?? values.assignee ?? t`Unassigned`}
          loadOptions={loadOptions}
          extra={{ value: "unassigned", label: t`Unassigned` }}
          onPick={(choice) => setAssignee({ value: choice.value, label: choice.label })}
        />
      </Row>
      {updating ? (
        <Row label={<Trans>Status</Trans>} htmlFor={ids.status}>
          <NativeSelect
            id={ids.status}
            value={form.status}
            onChange={(event) => set("status", event.target.value as (typeof STATUSES)[number])}
          >
            {STATUSES.map((status) => (
              <NativeSelectOption key={status} value={status}>
                {statusLabel(status)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Row>
      ) : null}
      {statusChanged ? (
        <Row label={<Trans>Status comment</Trans>} htmlFor={ids.comment}>
          <Textarea
            id={ids.comment}
            rows={2}
            maxLength={2000}
            value={form.status_comment}
            onChange={(event) => set("status_comment", event.target.value)}
          />
        </Row>
      ) : null}
      <Row label={<Trans>Priority</Trans>} htmlFor={ids.priority}>
        <NativeSelect
          id={ids.priority}
          value={form.priority}
          onChange={(event) => set("priority", event.target.value as (typeof PRIORITIES)[number])}
        >
          {PRIORITIES.map((priority) => (
            <NativeSelectOption key={priority} value={priority}>
              {priorityLabel(priority)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      <Row label={<Trans>Duration (days)</Trans>} htmlFor={ids.duration}>
        <Input
          id={ids.duration}
          type="number"
          min={1}
          max={365}
          step={1}
          value={form.duration_days}
          onChange={(event) =>
            set(
              "duration_days",
              Math.max(1, Math.min(365, Math.floor(Number(event.target.value) || 1))),
            )
          }
        />
      </Row>
      <Row label={<Trans>Can start</Trans>} htmlFor={ids.canStart}>
        <Input
          id={ids.canStart}
          type="date"
          value={form.can_start_date}
          onChange={(event) => set("can_start_date", event.target.value)}
        />
      </Row>
      <Row label={<Trans>Due</Trans>} htmlFor={ids.due}>
        <Input
          id={ids.due}
          type="date"
          value={form.due_date}
          onChange={(event) => set("due_date", event.target.value)}
        />
      </Row>
      {updating ? (
        <Row label={<Trans>Complete (%)</Trans>} htmlFor={ids.complete}>
          <Input
            id={ids.complete}
            type="number"
            min={0}
            max={100}
            step={5}
            value={form.completion_percentage}
            onChange={(event) =>
              set(
                "completion_percentage",
                Math.max(0, Math.min(100, Math.round(Number(event.target.value) || 0))),
              )
            }
          />
        </Row>
      ) : null}
      <Row label={<Trans>Notes</Trans>} htmlFor={ids.notes}>
        <Textarea
          id={ids.notes}
          rows={3}
          maxLength={5000}
          value={form.notes}
          onChange={(event) => set("notes", event.target.value)}
        />
      </Row>
    </EditorFrame>
  );
}

/** A comment card's wording and category, changed before it is approved. */
export function CommentEditor({
  change,
  loadOptions,
  onRevise,
  onClose,
}: {
  change: ProjectCommentChange;
  loadOptions: LoadChangeOptions;
  onRevise: (edits: EvolveChangeEdits) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const textId = useId();
  const values = change.after!;
  const [text, setText] = useState(values.text);
  const [category, setCategory] = useState<string | null>(null);
  const revision = useRevision(onRevise, onClose);

  return (
    <EditorFrame
      error={revision.error}
      saving={revision.saving}
      onClose={onClose}
      onSave={() => {
        const edits: EvolveChangeEdits = {};
        if (text.trim() && text !== values.text) edits.text = text;
        if (category !== null && category !== values.category) edits.category = category;
        void revision.send(edits);
      }}
    >
      <Row label={<Trans>Category</Trans>}>
        <EvolvePicker
          kind="comment_categories"
          label={t`category`}
          current={category ?? values.category}
          loadOptions={loadOptions}
          onPick={(choice) => {
            setCategory(choice.value);
            revision.clearError();
          }}
        />
      </Row>
      <Row label={<Trans>Comment</Trans>} htmlFor={textId}>
        <Textarea
          id={textId}
          // The comment is what this editor was opened to change.
          autoFocus
          rows={4}
          maxLength={2000}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            revision.clearError();
          }}
        />
      </Row>
    </EditorFrame>
  );
}

/** A Design Team join card's role, chosen from Evolve's Design Team roles before it is approved. */
export function TeamRoleEditor({
  change,
  loadOptions,
  onRevise,
  onClose,
}: {
  change: DesignTeamChange;
  loadOptions: LoadChangeOptions;
  onRevise: (edits: EvolveChangeEdits) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [role, setRole] = useState<string | null>(null);
  const revision = useRevision(onRevise, onClose);

  return (
    <EditorFrame
      error={revision.error}
      saving={revision.saving}
      onClose={onClose}
      onSave={() => void revision.send(role && role !== change.role ? { role } : {})}
    >
      <Row label={<Trans>Role</Trans>}>
        <EvolvePicker
          kind="team_roles"
          label={t`role`}
          current={role ?? change.role}
          loadOptions={loadOptions}
          onPick={(choice) => {
            setRole(choice.value);
            revision.clearError();
          }}
        />
      </Row>
    </EditorFrame>
  );
}

/**
 * A site visit card's answers, the same questions as Evolve's Staff Check-in page: where, which job
 * and buddy, and when back for a check-out; when back, whether it went OK and notes for a check-in.
 */
export function SiteVisitEditor({
  change,
  loadOptions,
  onRevise,
  onClose,
}: {
  change: SiteVisitChange;
  loadOptions: LoadChangeOptions;
  onRevise: (edits: EvolveChangeEdits) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const ids = { site: useId(), back: useId(), day: useId(), time: useId(), notes: useId() };
  const revision = useRevision(onRevise, onClose);
  const [site, setSite] = useState(change.siteLocation ?? "");
  const [job, setJob] = useState<{ edit: EvolveChangeEdits; label: string } | null>(null);
  const [buddy, setBuddy] = useState<{ email: string; name: string } | null>(null);
  const [back, setBack] = useState(change.expectedReturnTime ?? "");
  const [day, setDay] = useState(change.returnedDay ?? "");
  const [time, setTime] = useState(change.returnedTime ?? "");
  const [ok, setOk] = useState(change.everythingOk ?? true);
  const [notes, setNotes] = useState(change.notes ?? "");
  const currentJob = change.jobNumber
    ? [change.jobNumber, change.projectName].filter(Boolean).join(" · ")
    : t`No job`;

  if (change.action === "check_in") {
    return (
      <EditorFrame
        error={revision.error}
        saving={revision.saving}
        onClose={onClose}
        onSave={() => {
          const edits: EvolveChangeEdits = {};
          if (day && time && (day !== change.returnedDay || time !== change.returnedTime)) {
            edits.returned_at = `${day}T${time}`;
          }
          if (ok !== change.everythingOk) edits.everything_ok = ok;
          if (notes !== (change.notes ?? "")) edits.notes = notes;
          void revision.send(edits);
        }}
      >
        <Row label={<Trans>Back at</Trans>} htmlFor={ids.day}>
          <div className="flex gap-2">
            <Input
              id={ids.day}
              type="date"
              aria-label={t`Return date`}
              value={day}
              onChange={(event) => setDay(event.target.value)}
            />
            <Input
              id={ids.time}
              type="time"
              aria-label={t`Return time`}
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </div>
        </Row>
        <Row label={<Trans>Everything OK?</Trans>}>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t`Everything OK?`}>
            <Button
              type="button"
              role="radio"
              aria-checked={ok}
              variant={ok ? "default" : "outline"}
              onClick={() => {
                setOk(true);
                revision.clearError();
              }}
            >
              <Trans>Yes, all OK</Trans>
            </Button>
            <Button
              type="button"
              role="radio"
              aria-checked={!ok}
              variant={!ok ? "destructive" : "outline"}
              onClick={() => {
                setOk(false);
                revision.clearError();
              }}
            >
              <Trans>There was an issue</Trans>
            </Button>
          </div>
        </Row>
        <Row label={ok ? <Trans>Notes</Trans> : <Trans>What happened</Trans>} htmlFor={ids.notes}>
          <Textarea
            id={ids.notes}
            rows={3}
            maxLength={5000}
            required={!ok}
            placeholder={ok ? t`Optional` : t`Required when there was an issue`}
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
              revision.clearError();
            }}
          />
        </Row>
      </EditorFrame>
    );
  }

  return (
    <EditorFrame
      error={revision.error}
      saving={revision.saving}
      onClose={onClose}
      onSave={() => {
        const edits: EvolveChangeEdits = { ...job?.edit };
        if (site.trim() && site.trim() !== change.siteLocation) edits.site_location = site.trim();
        if (buddy) edits.buddy = buddy.email;
        if (back && back !== change.expectedReturnTime) edits.expected_return = back;
        void revision.send(edits);
      }}
    >
      <Row label={<Trans>Site location</Trans>} htmlFor={ids.site}>
        <Input
          id={ids.site}
          required
          maxLength={300}
          placeholder={t`Site address or name`}
          value={site}
          onChange={(event) => {
            setSite(event.target.value);
            revision.clearError();
          }}
        />
      </Row>
      <Row label={<Trans>Job / project</Trans>}>
        <EvolvePicker
          kind="projects"
          label={t`job`}
          current={job?.label ?? currentJob}
          loadOptions={loadOptions}
          extra={{ value: "none", label: t`No job` }}
          onPick={(choice) => {
            setJob({
              edit:
                choice.value === "none"
                  ? { job_number: "none" }
                  : { project_id: Number(choice.value) },
              label: choice.label,
            });
            revision.clearError();
          }}
        />
      </Row>
      <Row label={<Trans>Buddy contact</Trans>}>
        <EvolvePicker
          kind="people"
          label={t`buddy`}
          current={buddy?.name ?? change.buddy ?? t`Choose a buddy`}
          loadOptions={loadOptions}
          onPick={(choice) => {
            setBuddy({ email: choice.value, name: choice.label });
            revision.clearError();
          }}
        />
      </Row>
      <Row label={<Trans>Expected back</Trans>} htmlFor={ids.back}>
        <Input
          id={ids.back}
          type="time"
          required
          value={back}
          onChange={(event) => {
            setBack(event.target.value);
            revision.clearError();
          }}
        />
      </Row>
    </EditorFrame>
  );
}
