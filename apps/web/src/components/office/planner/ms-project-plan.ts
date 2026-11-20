import { importMsProjectXml } from "@jantt/interop";
import type { Task } from "@jantt/core";
import type { PlanDocument } from "./plan";

const DEFAULT_CATEGORY = {
  default: { label: "General", color: "#76BF43" },
} as const;

const GENERIC_TITLES = /^(msproj\d*|project\.xml|project)$/i;

function tag(xml: string, name: string): string | null {
  const match = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  return match?.[1] != null ? unescapeXml(match[1].trim()) : null;
}

function unescapeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Prefer a human programme title over Project's internal `msproj11` / file stubs. */
export function programmeTitle(xml: string, fallback: string): string {
  const title = tag(xml, "Title") || tag(xml, "Name");
  if (title && !GENERIC_TITLES.test(title)) return title;
  const cleaned = fallback.replace(/\.(mpp|xml|jantt)$/i, "").trim();
  return cleaned || title || "Imported programme";
}

export type MsProjectOutline = {
  wbs?: string;
  outlineLevel?: number;
  milestone: boolean;
  summary: boolean;
};

/** Outline / summary / milestone flags keyed by MS Project UID (as string). */
export function outlineByUidFromXml(xml: string): Map<string, MsProjectOutline> {
  const outlineByUid = new Map<string, MsProjectOutline>();
  for (const block of xml.matchAll(/<Task>([\s\S]*?)<\/Task>/gi)) {
    const body = block[1] ?? "";
    const uid = body.match(/<UID>(\d+)<\/UID>/i)?.[1];
    if (!uid) continue;
    const levelRaw = body.match(/<OutlineLevel>(\d+)<\/OutlineLevel>/i)?.[1];
    const level = levelRaw != null ? Number(levelRaw) : undefined;
    outlineByUid.set(uid, {
      wbs: body.match(/<OutlineNumber>([^<]+)<\/OutlineNumber>/i)?.[1]?.trim(),
      outlineLevel: Number.isFinite(level) ? level : undefined,
      milestone: body.match(/<Milestone>([01])<\/Milestone>/i)?.[1] === "1",
      summary: body.match(/<Summary>([01])<\/Summary>/i)?.[1] === "1",
    });
  }
  return outlineByUid;
}

/** Apply MS Project outline metadata onto imported Jantt tasks. */
export function enrichTasksWithOutline(
  tasks: Task[],
  outlineByUid: Map<string, MsProjectOutline>,
): Task[] {
  return tasks.map((task) => {
    const uid = String(task.id ?? "").replace(/^t/i, "");
    const extra = outlineByUid.get(uid);
    if (!extra) return { ...task, category: task.category || "default" };
    const fields = {
      ...(task.fields ?? {}),
      ...(extra.summary ? { summary: true } : {}),
      ...(extra.outlineLevel != null ? { outlineLevel: extra.outlineLevel } : {}),
    };
    return {
      ...task,
      category: task.category || "default",
      ...(extra.milestone || task.milestone ? { milestone: true } : {}),
      ...(extra.wbs ? { wbs: extra.wbs } : {}),
      ...(Object.keys(fields).length ? { fields } : {}),
    };
  });
}

/** True when a plan task is an MS Project summary / stage row. */
export function isSummaryTask(task: Task | { fields?: Record<string, unknown> }): boolean {
  return task.fields?.summary === true;
}

/** Outline depth for indent (0 = top-level / WBS `1`). */
export function outlineDepth(task: Task | { wbs?: string; fields?: Record<string, unknown> }): number {
  const level = task.fields?.outlineLevel;
  if (typeof level === "number" && Number.isFinite(level) && level >= 0) {
    return Math.max(0, Math.floor(level) - 1);
  }
  const wbs = typeof task.wbs === "string" ? task.wbs.trim() : "";
  if (!wbs) return 0;
  return Math.max(0, wbs.split(".").filter(Boolean).length - 1);
}

/**
 * Turn MS Project XML into a Jantt plan with categories, WBS, summary flags, milestones and a usable title.
 * Always call this instead of raw `importMsProjectXml` so imports validate and match the Gantt.
 */
export function planFromMsProjectXml(xml: string, fileName = "Programme"): PlanDocument {
  const imported = importMsProjectXml(xml) as PlanDocument;
  const outlineByUid = outlineByUidFromXml(xml);
  const tasks = enrichTasksWithOutline(imported.tasks ?? [], outlineByUid);

  return {
    ...imported,
    meta: {
      ...(imported.meta ?? {}),
      title: programmeTitle(xml, fileName),
    },
    categories: {
      ...DEFAULT_CATEGORY,
      ...(imported.categories ?? {}),
    },
    tasks,
  };
}
