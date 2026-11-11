import type { WorkPackageChange } from "@rakazo/contracts";
import type { FleetCardSummary } from "./approval-ask.js";

type WorkPackageValues = {
  title: string;
  category: string | null;
  status: string;
  priority: string;
  assignee: string | null;
  duration_days: number;
  can_start_date: string | null;
  must_start_date: string | null;
  due_date: string | null;
  completion_percentage: number;
  notes: string | null;
  links: { title: string; url: string }[];
};

type PreviewProject = { job_number: string | null; name: string | null; client: string | null };

export type WorkPackagePreview = {
  action: "add" | "update" | "delete";
  project: PreviewProject;
  moved_from?: PreviewProject;
  before?: WorkPackageValues;
  work_package?: WorkPackageValues;
  requester?: string | null;
  emails?: string[];
  status_comment?: string;
  warnings?: string[];
};

const text = (value: unknown) => (typeof value === "string" && value ? value : null);

function values(value: WorkPackageValues): NonNullable<WorkPackageChange["after"]> {
  return {
    title: String(value.title ?? ""),
    category: text(value.category),
    status: String(value.status ?? "pending"),
    priority: String(value.priority ?? "medium"),
    assignee: text(value.assignee),
    durationDays: Number(value.duration_days) || 1,
    canStart: text(value.can_start_date),
    mustStart: text(value.must_start_date),
    due: text(value.due_date),
    percentComplete: Number(value.completion_percentage) || 0,
    notes: text(value.notes),
    links: Array.isArray(value.links)
      ? value.links.map((link) => ({
          title: String(link?.title ?? ""),
          url: String(link?.url ?? ""),
        }))
      : [],
  };
}

function day(value: string | null): string {
  if (!value) return "Not set";
  const [year, month, date] = value.split("-");
  return `${date}/${month}/${year}`;
}

const words = (value: string) =>
  value.replace(/_/g, " ").replace(/^\w/, (first) => first.toUpperCase());

function describe(value: NonNullable<WorkPackageChange["after"]>): string[] {
  return [
    `Work package: ${value.title}`,
    `Category: ${value.category ?? "No category"}`,
    `Assigned to: ${value.assignee ?? "Unassigned"}`,
    `Status: ${words(value.status)} · Priority: ${words(value.priority)}`,
    `Duration: ${value.durationDays} ${value.durationDays === 1 ? "day" : "days"}`,
    `Can start: ${day(value.canStart)} · Must start: ${day(value.mustStart)} · Due: ${day(value.due)}`,
    ...(value.percentComplete ? [`Complete: ${value.percentComplete}%`] : []),
    ...(value.notes ? [`Notes: ${value.notes}`] : []),
    ...value.links.map((link) => `Link: ${link.title ? `${link.title} – ` : ""}${link.url}`),
  ];
}

/** The card for a previewed work package change; its text lines are what clients without the card show. */
export function workPackageCardSummary(preview: WorkPackagePreview): FleetCardSummary {
  const action =
    preview.action === "update" || preview.action === "delete" ? preview.action : "add";
  const change: WorkPackageChange = {
    action,
    project: {
      jobNumber: preview.project?.job_number ?? null,
      name: preview.project?.name ?? null,
      client: preview.project?.client ?? null,
    },
    ...(action !== "add" && preview.before ? { before: values(preview.before) } : {}),
    ...(action !== "delete" && preview.work_package ? { after: values(preview.work_package) } : {}),
    ...(action === "update" && preview.moved_from
      ? {
          movedFrom: {
            jobNumber: preview.moved_from.job_number ?? null,
            name: preview.moved_from.name ?? null,
            client: preview.moved_from.client ?? null,
          },
        }
      : {}),
    ...(preview.requester ? { requester: preview.requester } : {}),
    ...(preview.emails?.length ? { emails: preview.emails.map(String) } : {}),
    ...(preview.status_comment ? { statusComment: preview.status_comment } : {}),
    ...(preview.warnings?.length ? { warnings: preview.warnings.map(String) } : {}),
  };
  const project = [change.project.jobNumber, change.project.name].filter(Boolean).join(" · ");
  const lines = [
    `Project: ${project || "No project"}`,
    ...(change.project.client ? [`Client: ${change.project.client}`] : []),
    ...(change.movedFrom
      ? [
          `Moved from: ${[change.movedFrom.jobNumber, change.movedFrom.name].filter(Boolean).join(" · ") || "No project"}`,
        ]
      : []),
    ...(action === "update" && change.before ? ["Now:", ...describe(change.before), "After:"] : []),
    ...(action === "delete" && change.before ? describe(change.before) : []),
    ...(change.after ? describe(change.after) : []),
    ...(change.requester ? [`Requested by: ${change.requester}`] : []),
    ...(change.statusComment ? [`Status comment: ${change.statusComment}`] : []),
    ...(change.emails?.length ? [`Emails: ${change.emails.join(", ")}`] : []),
    ...(change.warnings ?? []).map((warning) => `Check: ${warning}`),
  ];
  const where = change.project.jobNumber ?? "the project";
  return {
    title:
      action === "add"
        ? `Add this work package to ${where}?`
        : action === "update"
          ? `Change this work package on ${where}?`
          : `Delete this work package from ${where}?`,
    lines,
    onceOnly: true,
    workPackage: change,
  };
}
