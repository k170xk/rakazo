import type { EvolvePersonOption } from "@rakazo/contracts";
import { isSummaryTask } from "./ms-project-plan";
import { findEvolvePerson } from "./evolve-people";
import type { PlanDocument } from "./plan";

/** Marks the avatar or plus button that opens the quick owner picker for a task. */
export const ASSIGN_ATTR = "data-planner-assign";

export type AssigneeLabels = {
  /** Plus button on a task with no owner. */
  add: string;
  /** "Owner: {name}" for an Evolve profile; the job title follows when known. */
  evolve: (name: string, jobTitle: string | null) => string;
  /** "Owner: {name} (not in Evolve)". */
  external: (name: string) => string;
};

type Look = "photo" | "evolve" | "external";

const PLUS_SVG =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>';

function setAttr(el: Element, name: string, value: string | null) {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

/** Puts the photo inside a Jantt avatar, or restores its initials; writes only on change. */
function paintAvatar(avatar: HTMLElement, look: Look, photo: string | null) {
  const initials = avatar.getAttribute("data-initials") ?? (avatar.textContent?.trim() || "?");
  setAttr(avatar, "data-initials", initials);
  setAttr(avatar, "data-look", look);
  const img = avatar.querySelector("img");
  if (look === "photo" && photo) {
    if (img?.getAttribute("src") === photo) return;
    const next = document.createElement("img");
    next.src = photo;
    next.alt = "";
    next.draggable = false;
    next.addEventListener("error", () => {
      // A broken photo link falls back to initials rather than an empty circle.
      avatar.setAttribute("data-look", "evolve");
      avatar.textContent = initials;
    });
    avatar.replaceChildren(next);
  } else if (img) {
    avatar.textContent = initials;
  }
}

/**
 * Decorates Jantt's task rows after each paint: Evolve owners show their photo (or green initials),
 * owners typed in by hand show neutral initials, and editable tasks without an owner get a plus
 * button. Jantt renders rows as HTML strings with no hook for this, so it is done in place.
 */
export function decorateAssignees(
  root: HTMLElement,
  plan: PlanDocument,
  directory: readonly EvolvePersonOption[],
  editable: boolean,
  labels: AssigneeLabels,
) {
  const byId = new Map((plan.tasks ?? []).map((task) => [task.id, task]));
  const lookFor = (name: string) => {
    const profile = findEvolvePerson(directory, name);
    const look: Look = profile?.photo ? "photo" : profile ? "evolve" : "external";
    return { profile, look };
  };

  for (const row of root.querySelectorAll<HTMLElement>(".jantt-label-row[data-row-id]")) {
    const id = row.getAttribute("data-row-id");
    const task = id ? byId.get(id) : undefined;
    const name = row.querySelector<HTMLElement>(".jantt-col-name");
    if (!task || !name) continue;
    const avatar = name.querySelector<HTMLElement>(".jantt-assignee-avatar");
    const add = name.querySelector<HTMLElement>(".planner-assign-add");
    const owner = task.assignee?.trim() ?? "";

    if (owner && avatar) {
      const { profile, look } = lookFor(owner);
      paintAvatar(avatar, look, profile?.photo ?? null);
      const title = profile ? labels.evolve(profile.name, profile.jobTitle ?? null) : labels.external(owner);
      setAttr(avatar, "title", title);
      setAttr(avatar, ASSIGN_ATTR, editable ? task.id : null);
      setAttr(avatar, "role", editable ? "button" : null);
      setAttr(avatar, "tabindex", editable ? "0" : null);
      setAttr(avatar, "aria-label", title);
    }

    const wantsAdd = editable && !owner && !isSummaryTask(task);
    if (wantsAdd && !add) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "planner-assign-add";
      button.setAttribute(ASSIGN_ATTR, task.id);
      button.setAttribute("aria-label", labels.add);
      button.title = labels.add;
      button.innerHTML = PLUS_SVG;
      const text = name.querySelector(".jantt-label-text");
      if (text) text.after(button);
      else name.appendChild(button);
    } else if (!wantsAdd && add) {
      add.remove();
    }
  }

  for (const pill of root.querySelectorAll<HTMLElement>(".jantt-task-avatar-pill")) {
    const task = byId.get(pill.closest<HTMLElement>("[data-task-id]")?.dataset.taskId ?? "");
    const owner = task?.assignee?.trim();
    if (!owner) continue;
    const { profile, look } = lookFor(owner);
    paintAvatar(pill, look, profile?.photo ?? null);
  }
}
