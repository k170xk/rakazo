import type {
  CompanyToolsState,
  EvolveToolCatalogue,
  LearningClinic,
  LearningQuizResult,
} from "@rakazo/contracts";
import { LearningClinicSchema, LearningQuizResultSchema } from "@rakazo/contracts";
import { toolNeedsApprovalEveryTime } from "@rakazo/core";
import { evolveReply } from "./evolve-change-card.js";
import type { EvolvePluginsConnection } from "./evolve-plugins.js";
import { callEvolveComputerMcp } from "./evolve-plugins.js";

/** Evolve answered but refused, with words the person can act on. */
export class EvolveToolRefusal extends Error {}

async function callTool(
  connection: EvolvePluginsConnection,
  email: string,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const reply = await callEvolveComputerMcp<{ result?: unknown; error?: { message?: string } }>(
    connection,
    email,
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    { signal },
  );
  const data = evolveReply(reply.result);
  if (reply.error) throw new Error(reply.error.message ?? "Evolve refused the call");
  if (!data || data.ok === false) {
    throw new EvolveToolRefusal(String(data?.error ?? "Evolve could not do that."));
  }
  return data;
}

const text = (value: unknown) => (typeof value === "string" && value ? value : null);
const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0;
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];

function video(value: unknown): LearningClinic["modules"][number]["video"] {
  const entry = value as Record<string, unknown> | null;
  if (!entry) return null;
  if (entry.kind === "youtube" && typeof entry.video_id === "string") {
    return { kind: "youtube", videoId: entry.video_id };
  }
  if ((entry.kind === "file" || entry.kind === "link") && typeof entry.url === "string") {
    return { kind: entry.kind, url: entry.url };
  }
  return null;
}

/** Evolve's clinic card reply, in the card's shape; anything malformed is refused, not shown. */
export function learningClinicFromEvolve(data: Record<string, unknown>): LearningClinic {
  const clinic = (data.clinic ?? {}) as Record<string, unknown>;
  return LearningClinicSchema.parse({
    clinicId: num(clinic.clinic_id),
    name: String(clinic.name ?? ""),
    description: text(clinic.description),
    mentor: text(clinic.mentor),
    comingSoon: clinic.coming_soon === true,
    enrolled: clinic.enrolled === true,
    dueDate: text(clinic.due_date),
    modulesPassed: num(clinic.modules_passed),
    modulesTotal: num(clinic.modules_total),
    completed: clinic.completed === true,
    passPercent: num(data.pass_percent ?? 100),
    modules: list(clinic.modules).map((module) => ({
      moduleId: num(module.module_id),
      number: num(module.number),
      title: String(module.title ?? ""),
      description: text(module.description),
      minutes: module.minutes == null ? null : num(module.minutes),
      video: video(module.video),
      pdfUrl: text(module.pdf_url),
      hasQuiz: module.has_quiz === true,
      passed: module.passed === true,
      quizAttempts: num(module.quiz_attempts),
      lastScore: module.last_score == null ? null : num(module.last_score),
      questions: list(module.questions).map((question) => ({
        questionId: num(question.question_id),
        text: String(question.text ?? ""),
        answers: list(question.answers).map((answer) => ({
          answerId: num(answer.answer_id),
          text: String(answer.text ?? ""),
        })),
      })),
    })),
  });
}

export async function loadLearningClinic(
  connection: EvolvePluginsConnection,
  email: string,
  clinicId: number,
  signal?: AbortSignal,
): Promise<LearningClinic> {
  const data = await callTool(
    connection,
    email,
    "learning_clinic_card",
    { clinic_id: clinicId },
    signal,
  );
  return learningClinicFromEvolve(data);
}

export async function enrolInLearningClinic(
  connection: EvolvePluginsConnection,
  email: string,
  clinicId: number,
  signal?: AbortSignal,
): Promise<void> {
  await callTool(connection, email, "learning_enrol", { clinic_id: clinicId }, signal);
}

export async function markLearningModuleWatched(
  connection: EvolvePluginsConnection,
  email: string,
  clinicId: number,
  moduleId: number,
  signal?: AbortSignal,
): Promise<void> {
  await callTool(
    connection,
    email,
    "learning_mark_watched",
    { clinic_id: clinicId, module_id: moduleId },
    signal,
  );
}

export async function submitLearningQuiz(
  connection: EvolvePluginsConnection,
  email: string,
  input: {
    clinicId: number;
    moduleId: number;
    answers: { questionId: number; answerId: number }[];
  },
  signal?: AbortSignal,
): Promise<LearningQuizResult> {
  const data = await callTool(
    connection,
    email,
    "learning_submit_quiz",
    {
      clinic_id: input.clinicId,
      module_id: input.moduleId,
      answers: input.answers.map((answer) => ({
        question_id: answer.questionId,
        answer_id: answer.answerId,
      })),
    },
    signal,
  );
  return LearningQuizResultSchema.parse({
    scorePercent: num(data.score_percent),
    correct: num(data.correct),
    total: num(data.total),
    passed: data.passed === true,
    attemptNo: num(data.attempt_no),
    clinicCompleted: data.clinic_completed === true,
  });
}

/**
 * The company's switched-on Evolve tools for the staff catalogue, each with the Evolve page it
 * needs and whether this person may open it, read from Evolve as them.
 */
export async function evolveToolCatalogue(
  connection: EvolvePluginsConnection,
  email: string,
  health: CompanyToolsState["evolve"],
  signal?: AbortSignal,
): Promise<EvolveToolCatalogue> {
  const offered = health.tools.filter((tool) => tool.enabled);
  if (health.status !== "ready") return { status: health.status, tools: [] };
  const data = await callTool(connection, email, "evolve_tool_access", {}, signal);
  const pages = new Map(
    list(data.pages).map((page) => [
      String(page.key),
      { key: String(page.key), label: String(page.label ?? page.key), open: page.open === true },
    ]),
  );
  return {
    status: "ready",
    tools: offered.map((tool) => ({
      name: tool.name,
      description: tool.description,
      group: tool.group ?? "Other",
      access: tool.access ?? null,
      approval: toolNeedsApprovalEveryTime(`mcp__evolve__${tool.name}`),
      changes: tool.changes ?? null,
      page: tool.page
        ? (pages.get(tool.page) ?? { key: tool.page, label: tool.page, open: false })
        : null,
    })),
  };
}
