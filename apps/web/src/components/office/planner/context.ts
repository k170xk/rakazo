import type { DocumentStudioFocus, DocumentStudioSelected } from "@rakazo/contracts";
import type { PlanDocument, PlanEvolveLink } from "./plan";
import { evolveLinkOf, taskLabel } from "./plan";

export type PlanView = {
  selectedTaskId: string | null;
};

/** Words for the studio chip and note from the open plan. */
export function planContext(
  plan: PlanDocument,
  view: PlanView,
): { focus: DocumentStudioFocus; selected: DocumentStudioSelected | null } {
  const tasks = plan.tasks.filter((task) => !task._deleted);
  const link = evolveLinkOf(plan);
  const focus: DocumentStudioFocus = {
    where: planFocusWhere(tasks.length, link),
    short: link ? `Job ${link.jobNumber}` : `${tasks.length} tasks`,
    detail: planFocusDetail(plan, link),
  };
  const selectedId = view.selectedTaskId;
  const selectedTask = selectedId ? tasks.find((task) => task.id === selectedId) : undefined;
  if (!selectedTask) return { focus, selected: null };
  const label = taskLabel(selectedTask);
  return {
    focus,
    selected: {
      what: "task",
      label,
      content: [
        `id: ${selectedTask.id}`,
        `label: ${label}`,
        selectedTask.start ? `start: ${selectedTask.start}` : null,
        selectedTask.end ? `end: ${selectedTask.end}` : null,
        selectedTask.dependsOn
          ? `dependsOn: ${JSON.stringify(selectedTask.dependsOn)}`
          : null,
        selectedTask.progress != null ? `progress: ${selectedTask.progress}` : null,
        selectedTask.status ? `status: ${selectedTask.status}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  };
}

function planFocusWhere(taskCount: number, link: PlanEvolveLink | null): string {
  const jobs = link ? `linked to Evolve job ${link.jobNumber}` : "not linked to an Evolve job";
  if (taskCount === 0) return `an empty programme (${jobs})`;
  if (taskCount === 1) return `a programme with 1 task (${jobs})`;
  return `a programme with ${taskCount} tasks (${jobs})`;
}

function planFocusDetail(plan: PlanDocument, link: PlanEvolveLink | null): string {
  const lines: string[] = [];
  if (plan.meta?.title) lines.push(`Title: ${plan.meta.title}`);
  if (link) {
    lines.push(`Evolve job: ${link.jobNumber}${link.name ? ` — ${link.name}` : ""}`);
  }
  const tasks = plan.tasks.filter((task) => !task._deleted).slice(0, 12);
  if (tasks.length > 0) {
    lines.push("Tasks:");
    for (const task of tasks) {
      lines.push(
        `- ${task.id}: ${taskLabel(task)} (${task.start ?? "?"} → ${task.end ?? "?"})`,
      );
    }
    const more = plan.tasks.filter((task) => !task._deleted).length - tasks.length;
    if (more > 0) lines.push(`… ${more} more`);
  }
  return lines.join("\n");
}
