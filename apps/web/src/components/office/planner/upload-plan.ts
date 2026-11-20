import { DOCUMENT_MIME_TYPES } from "@rakazo/contracts";
import { importSpreadsheetCsv } from "@jantt/interop";
import { withSpaceHeaders } from "../../../lib/rpc";
import { planFromMsProjectXml } from "./ms-project-plan";
import { planBytes, type PlanDocument } from "./plan";

/** Includes `.mpp` — binary Project files are converted server-side to MSPDI, then to `.jantt`. */
export const PLAN_UPLOAD_ACCEPT =
  ".jantt,.xml,.csv,.tsv,.mpp,application/vnd.jantt+json,application/json,application/xml,text/xml,text/csv,text/tab-separated-values";

export const PLANS_FROM_MPP_PATH = "/api/v1/plans/from-mpp";

export type PreparedPlanUpload =
  | { kind: "ready"; file: File; name: string }
  | { kind: "refused"; message: string };

export type PreparePlanUploadOptions = {
  /** Space header for the authenticated MPP conversion route. */
  spaceId?: string | null;
};

function baseName(name: string): string {
  return name.replace(/\.(jantt|json|xml|csv|tsv|mpp)$/i, "").trim() || "Untitled plan";
}

/** True when the name looks like a schedule we can open into Project Planner. */
export function isPlanUploadName(name: string): boolean {
  return /\.(jantt|json|xml|csv|tsv|mpp)$/i.test(name);
}

function asJanttUpload(plan: PlanDocument, title: string): PreparedPlanUpload {
  const bytes = planBytes(plan);
  const blob = new File([new Uint8Array(bytes)], `${title}.jantt`, {
    type: DOCUMENT_MIME_TYPES.jantt,
  });
  return { kind: "ready", file: blob, name: `${title}.jantt` };
}

async function mppToXml(file: File, spaceId?: string | null): Promise<string> {
  const response = await fetch(PLANS_FROM_MPP_PATH, {
    method: "POST",
    credentials: "include",
    headers: withSpaceHeaders({ "content-type": "application/octet-stream" }, spaceId ?? null),
    body: file,
  });
  if (response.ok) return await response.text();
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new Error(
    body?.error ||
      "Couldn't convert that Microsoft Project (.mpp) file. Try File → Save As → XML Format (.xml) in Project.",
  );
}

/**
 * Turns a picked schedule into a `.jantt` upload. Binary Microsoft Project (`.mpp`) is converted
 * on the server to MSPDI XML, then into Jantt JSON. CSV/TSV and Project XML convert in-browser.
 */
export async function preparePlanUpload(
  file: File,
  options: PreparePlanUploadOptions = {},
): Promise<PreparedPlanUpload> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".jantt") || lower.endsWith(".json")) {
    return {
      kind: "ready",
      file,
      name: lower.endsWith(".jantt") ? file.name : `${baseName(file.name)}.jantt`,
    };
  }
  try {
    let xml: string | null = null;
    if (lower.endsWith(".mpp")) {
      xml = await mppToXml(file, options.spaceId);
    } else if (lower.endsWith(".xml")) {
      xml = await file.text();
    }

    let imported: PlanDocument;
    if (xml != null) {
      imported = planFromMsProjectXml(xml, file.name);
    } else if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
      imported = importSpreadsheetCsv(await file.text()) as PlanDocument;
      imported = {
        ...imported,
        categories: {
          default: { label: "General", color: "#76BF43" },
          ...(imported.categories ?? {}),
        },
      };
    } else {
      return {
        kind: "refused",
        message:
          "Choose a .jantt plan, Microsoft Project file (.mpp or .xml), or CSV/TSV schedule.",
      };
    }
    const title = imported.meta?.title?.trim() || baseName(file.name);
    return asJanttUpload(
      {
        ...imported,
        meta: { ...(imported.meta ?? {}), title },
      },
      title,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (lower.endsWith(".mpp")) {
      return {
        kind: "refused",
        message:
          message ||
          "Couldn't read that Microsoft Project (.mpp) file. Try File → Save As → XML Format (.xml) in Project.",
      };
    }
    if (lower.endsWith(".xml")) {
      return {
        kind: "refused",
        message:
          "Couldn't read that Microsoft Project XML file. Export again from Project as XML Format (.xml).",
      };
    }
    return { kind: "refused", message: "Couldn't read that CSV schedule." };
  }
}
