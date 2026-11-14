import type { AdapterContext, ConnectorCall, ConnectorProvider } from "@rakazo/adapter-kit";
import type {
  DesignTeamChange,
  EvolveChangeEdits,
  EvolveChangeOptionKind,
  EvolveChangeOptions,
  ProjectCommentChange,
  ProjectDeadlineChange,
} from "@rakazo/contracts";
import { toolNeedsApprovalEveryTime } from "@rakazo/core";
import type { FleetCardSummary } from "./approval-ask.js";
import type { EvolvePluginsConnection } from "./evolve-plugins.js";
import { callEvolveComputerMcp } from "./evolve-plugins.js";
import type { WorkPackagePreview } from "./evolve-work-package-card.js";
import { workPackageCardSummary } from "./evolve-work-package-card.js";

/** Keys only Rakazo sets on an Evolve change; whatever the model sends under them is dropped. */
const CARRIED_KEYS = ["_preview", "_expected", "_caller_email"] as const;

type DeadlineValues = {
  name: string;
  date: string | null;
  hard_deadline: boolean;
  completed: boolean;
  comments: string | null;
};

type DeadlinePreview = {
  action: "add" | "update";
  project: { job_number: string | null; name: string | null; client: string | null };
  before?: DeadlineValues;
  deadline: DeadlineValues;
  changed?: string[];
  warnings?: string[];
};

/** A deadline or work package change, previewed on a card and approved every time. */
export function isEvolveChangeTool(name: string): boolean {
  return toolNeedsApprovalEveryTime(name);
}

/** What each card lets its owner change; the fields its Evolve tool takes, links aside. */
const EDITABLE: Record<string, readonly (keyof EvolveChangeEdits)[]> = {
  add_project_deadline: ["project_id", "name", "date", "hard_deadline", "comments"],
  update_project_deadline: ["name", "date", "hard_deadline", "completed", "comments"],
  add_work_package: [
    "project_id",
    "title",
    "category",
    "assignee",
    "duration_days",
    "can_start_date",
    "due_date",
    "priority",
    "notes",
  ],
  update_work_package: [
    "project_id",
    "title",
    "category",
    "assignee",
    "duration_days",
    "can_start_date",
    "due_date",
    "status",
    "status_comment",
    "priority",
    "completion_percentage",
    "notes",
  ],
  add_project_comment: ["text", "category"],
  update_project_comment: ["text", "category"],
  join_project_team: ["role"],
};

/** The Evolve tool an approval effect calls, such as add_work_package. */
export function evolveChangeToolName(kind: string): string | null {
  if (!isEvolveChangeTool(kind)) return null;
  return kind.slice(kind.lastIndexOf("__") + 2) || null;
}

/** The stored call with the owner's edits applied, or why those edits do not fit this card. */
export function editedEvolveChangeArgs(
  kind: string,
  args: Record<string, unknown>,
  edits: EvolveChangeEdits,
): { args: Record<string, unknown> } | { error: string } {
  const tool = evolveChangeToolName(kind);
  const editable = tool ? EDITABLE[tool] : undefined;
  if (!editable) return { error: "This card cannot be edited." };
  const refused = Object.keys(edits).find(
    (key) => !editable.includes(key as keyof EvolveChangeEdits),
  );
  if (refused) return { error: `This card cannot change ${refused.replace(/_/g, " ")}.` };
  const next: Record<string, unknown> = { ...withoutCarriedKeys(args), ...edits };
  // A chosen project replaces however the model named it.
  if (edits.project_id !== undefined) {
    delete next.job_number;
    delete next.project_name;
  }
  return { args: next };
}

/** Previews an edited change as the run's owner, the way the run's own call is previewed. */
export async function previewEvolveChangeAs(
  connection: EvolvePluginsConnection,
  email: string,
  kind: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ summary: FleetCardSummary; args: Record<string, unknown> } | { error: string }> {
  const tool = evolveChangeToolName(kind);
  if (!tool) return { error: "This card cannot be edited." };
  const reply = await callEvolveComputerMcp<{ result?: unknown; error?: { message?: string } }>(
    connection,
    email,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: tool, arguments: { ...args, _preview: true } },
    },
    { signal },
  );
  if (reply.error) return { error: reply.error.message ?? "Evolve refused the change." };
  return evolveChangePreview(reply.result, args);
}

/** Live projects, people or categories for a card's pickers, chosen as Evolve's tools resolve them. */
export async function listEvolveChangeOptions(
  connection: EvolvePluginsConnection,
  email: string,
  kind: EvolveChangeOptionKind,
  query: string,
  signal?: AbortSignal,
): Promise<EvolveChangeOptions> {
  const reply = await callEvolveComputerMcp<{ result?: unknown; error?: { message?: string } }>(
    connection,
    email,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "evolve_change_options", arguments: { kind, query } },
    },
    { signal },
  );
  const data = evolveReply(reply.result);
  if (reply.error || !data || data.ok === false) {
    throw new Error(String(data?.error ?? reply.error?.message ?? "Evolve did not list choices."));
  }
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  if (kind === "categories" || kind === "comment_categories" || kind === "team_roles") {
    return {
      categories: (Array.isArray(data.categories) ? data.categories : []).map(String).slice(0, 200),
    };
  }
  if (kind === "people") {
    return {
      people: (Array.isArray(data.people) ? data.people : [])
        .map((row) => ({ name: String(row?.name ?? ""), email: String(row?.email ?? "") }))
        .filter((row) => row.name && row.email)
        .slice(0, 50),
    };
  }
  return {
    projects: (Array.isArray(data.projects) ? data.projects : [])
      .map((row) => ({
        projectId: Number(row?.project_id),
        jobNumber: text(row?.job_number),
        name: text(row?.name),
        client: text(row?.client),
      }))
      .filter((row) => Number.isInteger(row.projectId) && row.projectId > 0)
      .slice(0, 50),
  };
}

export function withoutCarriedKeys(args: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...args };
  for (const key of CARRIED_KEYS) delete rest[key];
  return rest;
}

/** The JSON an Evolve tool answered with: MCP text content, or the object itself. */
export function evolveReply(data: unknown): Record<string, unknown> | undefined {
  const content = (data as { content?: unknown } | null)?.content;
  const text = Array.isArray(content)
    ? content
        .map((part) => (part as { text?: unknown } | null)?.text)
        .filter((part): part is string => typeof part === "string")
        .join("")
    : undefined;
  if (text === undefined)
    return data && typeof data === "object" ? (data as Record<string, unknown>) : undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return { ok: false, error: text };
  }
}

function values(value: DeadlineValues): ProjectDeadlineChange["after"] {
  return {
    name: String(value.name ?? ""),
    date: typeof value.date === "string" ? value.date : null,
    hardDeadline: value.hard_deadline === true,
    completed: value.completed === true,
    comments: typeof value.comments === "string" ? value.comments : null,
  };
}

function day(value: string | null): string {
  if (!value) return "No date";
  const [year, month, date] = value.split("-");
  return `${date}/${month}/${year}`;
}

function describe(value: ProjectDeadlineChange["after"]): string[] {
  return [
    `Deadline: ${value.name}`,
    `Due: ${day(value.date)}`,
    `Type: ${value.hardDeadline ? "Hard deadline" : "Soft deadline"}`,
    ...(value.completed ? ["Completed"] : []),
    ...(value.comments ? [`Comments: ${value.comments}`] : []),
  ];
}

/** The card for a previewed change; its text lines are what clients without the card show. */
export function deadlineCardSummary(preview: DeadlinePreview): FleetCardSummary {
  const change: ProjectDeadlineChange = {
    action: preview.action === "update" ? "update" : "add",
    project: {
      jobNumber: preview.project?.job_number ?? null,
      name: preview.project?.name ?? null,
      client: preview.project?.client ?? null,
    },
    ...(preview.action === "update" && preview.before ? { before: values(preview.before) } : {}),
    after: values(preview.deadline),
    ...(preview.warnings?.length ? { warnings: preview.warnings.map(String) } : {}),
  };
  const project = [change.project.jobNumber, change.project.name].filter(Boolean).join(" · ");
  const lines = [
    `Project: ${project || "Unnamed project"}`,
    ...(change.project.client ? [`Client: ${change.project.client}`] : []),
    ...(change.before ? ["Now:", ...describe(change.before), "After:"] : []),
    ...describe(change.after),
    ...(change.warnings ?? []).map((warning) => `Check: ${warning}`),
  ];
  return {
    title:
      change.action === "add"
        ? `Add this deadline to ${change.project.jobNumber ?? "the project"}?`
        : `Change this deadline on ${change.project.jobNumber ?? "the project"}?`,
    lines,
    onceOnly: true,
    deadline: change,
  };
}

type ChangeProject = { job_number?: string | null; name?: string | null; client?: string | null };
type CommentPreview = {
  action: "add" | "update" | "delete";
  comment_id?: number;
  project: ChangeProject;
  before?: { text: string; category?: string; date?: string | null };
  comment?: { text: string; category?: string; author: string };
};
type TeamPreview = {
  action: "add" | "delete";
  project: ChangeProject;
  member: { name: string; role: string; emoji?: string | null };
  current_roles?: string[];
  warnings?: string[];
};

function changeProject(project: ChangeProject | undefined): ProjectCommentChange["project"] {
  return {
    jobNumber: project?.job_number ?? null,
    name: project?.name ?? null,
    client: project?.client ?? null,
  };
}

function projectLines(project: ProjectCommentChange["project"]): { job: string; lines: string[] } {
  const label = [project.jobNumber, project.name].filter(Boolean).join(" · ");
  return {
    job: project.jobNumber ?? "the project",
    lines: [
      `Project: ${label || "Unnamed project"}`,
      ...(project.client ? [`Client: ${project.client}`] : []),
    ],
  };
}

const GENERAL_COMMENTS = "General";

function commentValues(value: { text?: unknown; category?: unknown } | undefined) {
  return value
    ? {
        text: String(value.text ?? ""),
        category:
          typeof value.category === "string" && value.category ? value.category : GENERAL_COMMENTS,
      }
    : undefined;
}

/** The card for a Design Team join or leave. */
function teamCardSummary(team: TeamPreview): FleetCardSummary {
  const change: DesignTeamChange = {
    action: team.action === "delete" ? "delete" : "add",
    project: changeProject(team.project),
    person: String(team.member?.name ?? ""),
    role: String(team.member?.role ?? ""),
    emoji: typeof team.member?.emoji === "string" && team.member.emoji ? team.member.emoji : null,
    currentRoles: (team.current_roles ?? []).map(String),
    ...(team.warnings?.length ? { warnings: team.warnings.map(String) } : {}),
  };
  const { job, lines } = projectLines(change.project);
  const others = change.currentRoles.filter((role) => role !== change.role);
  return {
    title:
      change.action === "add"
        ? `Join ${job}'s Design Team as ${change.role}?`
        : `Leave ${job}'s Design Team as ${change.role}?`,
    lines: [
      ...lines,
      `Person: ${change.person}`,
      `Role: ${change.role}`,
      ...(others.length ? [`Other roles on this team: ${others.join(", ")}`] : []),
      ...(change.warnings ?? []).map((warning) => `Check: ${warning}`),
    ],
    onceOnly: true,
    designTeam: change,
  };
}

/** The card for a project comment added, reworded or deleted. */
function commentCardSummary(comment: CommentPreview): FleetCardSummary {
  const action =
    comment.action === "delete" ? "delete" : comment.action === "update" ? "update" : "add";
  const before = commentValues(comment.before);
  const after = action === "delete" ? undefined : commentValues(comment.comment);
  const change: ProjectCommentChange = {
    action,
    project: changeProject(comment.project),
    author: String(
      comment.comment?.author ?? (comment.before as { author?: unknown } | undefined)?.author ?? "",
    ),
    ...(action !== "add" && before ? { before } : {}),
    ...(after ? { after } : {}),
    ...(action === "delete" && comment.before?.date ? { date: comment.before.date } : {}),
  };
  const { job, lines } = projectLines(change.project);
  const describe = (value: { text: string; category: string }) => [
    `Category: ${value.category}`,
    `Comment: ${value.text}`,
  ];
  if (action === "delete") {
    return {
      title: `Delete your comment on ${job}?`,
      lines: [
        ...lines,
        ...(change.date ? [`Written: ${day(change.date)}`] : []),
        ...(change.before ? describe(change.before) : []),
      ],
      onceOnly: true,
      projectComment: change,
    };
  }
  if (action === "update") {
    return {
      title: `Change your comment on ${job}?`,
      lines: [
        ...lines,
        ...(change.before ? ["Now:", ...describe(change.before), "After:"] : []),
        ...(change.after ? describe(change.after) : []),
      ],
      onceOnly: true,
      projectComment: change,
    };
  }
  return {
    title: `Add this comment to ${job}?`,
    lines: [
      ...lines,
      `From: ${change.author || "you"}`,
      ...(change.after ? describe(change.after) : []),
      "The project's director and manager are emailed, as for a comment added in Evolve.",
    ],
    onceOnly: true,
    projectComment: change,
  };
}

/** The card for a project comment or Design Team preview; null for any other preview. */
export function commentOrTeamChangeSummary(raw: unknown): FleetCardSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const preview = raw as Record<string, unknown>;
  if ("member" in preview) return teamCardSummary(preview as unknown as TeamPreview);
  if (!("comment" in preview) && !("comment_id" in preview)) return null;
  return commentCardSummary(preview as unknown as CommentPreview);
}

/**
 * Ask Evolve what a deadline or work package call would do without saving it. Returns the card and
 * the arguments the approval covers, or the reply to hand straight back (an error, or choices).
 */
export async function previewEvolveChange(
  connector: ConnectorProvider,
  call: ConnectorCall,
  context: AdapterContext,
): Promise<{ summary: FleetCardSummary; args: Record<string, unknown> } | { error: string }> {
  const args = withoutCarriedKeys(call.args);
  let data: unknown;
  let failure: string | undefined;
  for await (const event of connector.execute(
    { ...call, args: { ...args, _preview: true } },
    context,
  )) {
    if (event.type === "result") data = event.data;
    else if (event.type === "error") failure = event.message;
  }
  if (failure) return { error: failure };
  return evolveChangePreview(data, args);
}

/** The card and approved arguments for Evolve's answer to a `_preview` call made with `args`. */
export function evolveChangePreview(
  data: unknown,
  args: Record<string, unknown>,
): { summary: FleetCardSummary; args: Record<string, unknown> } | { error: string } {
  const reply = evolveReply(data);
  const commentOrTeam =
    reply && reply.ok !== false ? commentOrTeamChangeSummary(reply.preview) : null;
  if (reply && commentOrTeam) {
    const before = (reply.preview as { before?: unknown }).before;
    return { summary: commentOrTeam, args: before ? { ...args, _expected: before } : args };
  }
  const preview = reply?.preview as (DeadlinePreview | WorkPackagePreview) | undefined;
  const workPackage =
    preview && "work_package" in preview
      ? true
      : preview?.action === "delete" && Boolean(preview.before);
  if (!reply || reply.ok === false || !preview || (!workPackage && !("deadline" in preview))) {
    return {
      error: reply
        ? `Nothing was saved. ${JSON.stringify(reply)}`
        : "Evolve did not answer with a preview, so nothing was saved.",
    };
  }
  return {
    summary: workPackage
      ? workPackageCardSummary(preview as WorkPackagePreview)
      : deadlineCardSummary(preview as DeadlinePreview),
    // The change is saved only while the record still reads as the card showed it.
    args:
      preview.action !== "add" && preview.before ? { ...args, _expected: preview.before } : args,
  };
}
