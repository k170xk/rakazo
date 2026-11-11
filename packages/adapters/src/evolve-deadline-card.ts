import type { AdapterContext, ConnectorCall, ConnectorProvider } from "@rakazo/adapter-kit";
import type { ProjectDeadlineChange } from "@rakazo/contracts";
import { toolNeedsApprovalEveryTime } from "@rakazo/core";
import type { FleetCardSummary } from "./approval-ask.js";

/** Keys only Rakazo sets on a deadline call; whatever the model sends under them is dropped. */
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

export function isEvolveDeadlineTool(name: string): boolean {
  return toolNeedsApprovalEveryTime(name);
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

/**
 * Ask Evolve what a deadline call would do without saving it. Returns the card and the arguments
 * the approval covers, or the reply to hand straight back (an error, or projects to choose from).
 */
export async function previewDeadlineChange(
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
  const reply = evolveReply(data);
  const preview = reply?.preview as DeadlinePreview | undefined;
  if (!reply || reply.ok === false || !preview?.deadline) {
    return {
      error: reply
        ? `Nothing was saved. ${JSON.stringify(reply)}`
        : "Evolve did not answer with a preview, so nothing was saved.",
    };
  }
  return {
    summary: deadlineCardSummary(preview),
    // The change is saved only while the deadline still reads as the card showed it.
    args:
      preview.action === "update" && preview.before ? { ...args, _expected: preview.before } : args,
  };
}
