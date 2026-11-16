/**
 * PDF Studio decisions: the engine's bounded judgement questions (room labels, sheet kind, site
 * country) answered by OpenAI's Decisions API with the api's own key, so no key reaches a computer
 * or a browser. Pure and injectable (fetch, env, clock, budget, log): the route in pdf-decisions.ts
 * and the local corpus runner both call decidePdf.
 *
 * Every failure is `{ ok: false, reason }`; the caller keeps its deterministic answer.
 */

export type PdfDecisionsMode = "off" | "shadow" | "on";
export type PdfDecisionsReason =
  | "off"
  | "budget"
  | "invalid"
  | "timeout"
  | "upstream"
  | "unavailable"
  | "unauthorized";

export const PDF_DECISION_POINTS = ["rooms", "sheet", "country"] as const;
export type PdfDecisionPoint = (typeof PDF_DECISION_POINTS)[number];

export const PDF_DECISIONS_MODEL = "gpt-6-luna";
export const PDF_DECISIONS_ENDPOINT = "https://api.openai.com/v1/decisions";
export const PDF_DECISIONS_TIMEOUT_MS = 2_000;
export const PDF_DECISIONS_DEFAULT_BUDGET_USD = 2;

/**
 * The API allows 400 questions; 300 covers the largest plan page in the corpus (one choice per
 * room label) with room to spare, and bounds a single request's cost and latency.
 */
export const PDF_DECISIONS_LIMITS = {
  maxQuestions: 300,
  /** The whole request body as received. */
  maxBodyBytes: 1_600_000,
  /** Input and question text, images excluded. */
  maxTextBytes: 200_000,
  maxImages: 2,
  /** One base64 data URL; a 512 px low-detail PNG is well under this. */
  maxImageChars: 700_000,
  maxNameChars: 64,
  maxInstructionChars: 2_000,
  maxChoices: 255,
  maxChoiceChars: 200,
  maxDescriptionChars: 500,
  minLevels: 2,
  maxLevels: 10,
  maxCacheKeyChars: 64,
} as const;

/** USD per token for gpt-6-luna decisions; output is not charged. */
export const PDF_DECISIONS_PRICE = {
  input: 0.1 / 1e6,
  cachedInput: 0.01 / 1e6,
  cacheWrite: 0.125 / 1e6,
  longContextTokens: 272_000,
} as const;

const STATUS: Record<PdfDecisionsReason, number> = {
  off: 200,
  invalid: 400,
  unauthorized: 401,
  budget: 429,
  upstream: 502,
  unavailable: 503,
  timeout: 504,
};

/** `RAKAZO_PDF_DECISIONS=shadow|on`; unset or anything else is off. */
export function pdfDecisionsMode(env: Record<string, string | undefined>): PdfDecisionsMode {
  const value = env.RAKAZO_PDF_DECISIONS?.trim().toLowerCase();
  return value === "shadow" || value === "on" ? value : "off";
}

/** `RAKAZO_PDF_DECISIONS_BUDGET_USD`, a positive number of dollars per company per UTC day. */
export function pdfDecisionsBudgetUsd(env: Record<string, string | undefined>): number {
  const value = Number(env.RAKAZO_PDF_DECISIONS_BUDGET_USD?.trim());
  return Number.isFinite(value) && value > 0 ? value : PDF_DECISIONS_DEFAULT_BUDGET_USD;
}

export interface DecisionsUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
}

/** USD for one response's usage; cached and cache-write tokens are part of input_tokens. */
export function pdfDecisionsCost(usage: DecisionsUsage | undefined): number {
  const input = num(usage?.input_tokens);
  const cached = num(usage?.input_tokens_details?.cached_tokens);
  const writes = num(usage?.input_tokens_details?.cache_write_tokens);
  const plain = Math.max(0, input - cached - writes);
  const factor = input > PDF_DECISIONS_PRICE.longContextTokens ? 2 : 1;
  return (
    factor *
    (plain * PDF_DECISIONS_PRICE.input +
      cached * PDF_DECISIONS_PRICE.cachedInput +
      writes * PDF_DECISIONS_PRICE.cacheWrite)
  );
}

const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

// ---------- budget ----------

/** Spend per company per UTC day. reserve() holds an estimate until settle() books the actual. */
export interface PdfDecisionsBudget {
  reserve(company: string, day: string, usd: number, limitUsd: number): boolean;
  settle(company: string, day: string, reservedUsd: number, actualUsd: number): void;
  spent(company: string, day: string): number;
}

/** In this process only: a restart or a second api replica starts its own count. */
export function memoryPdfDecisionsBudget(): PdfDecisionsBudget {
  const days = new Map<string, Map<string, number>>();
  const book = (day: string) => {
    for (const key of days.keys()) if (key !== day) days.delete(key);
    let companies = days.get(day);
    if (!companies) days.set(day, (companies = new Map()));
    return companies;
  };
  return {
    reserve(company, day, usd, limitUsd) {
      const companies = book(day);
      const current = companies.get(company) ?? 0;
      if (current + usd > limitUsd) return false;
      companies.set(company, current + usd);
      return true;
    },
    settle(company, day, reservedUsd, actualUsd) {
      const companies = book(day);
      const current = companies.get(company) ?? 0;
      companies.set(company, Math.max(0, current - reservedUsd + actualUsd));
    },
    spent(company, day) {
      return days.get(day)?.get(company) ?? 0;
    },
  };
}

// ---------- request validation ----------

type InputPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "low" };
type InputMessage = { role: "user"; content: string | InputPart[] };
type Question =
  | { type: "predicate"; name: string; instructions?: string }
  | {
      type: "choice";
      name: string;
      instructions?: string;
      choices: Array<{ value: string | number; description?: string }>;
    }
  | {
      type: "score";
      name: string;
      instructions?: string;
      levels: Array<{ label: string; description?: string }>;
    };

export interface PdfDecisionsRequest {
  point: PdfDecisionPoint;
  input: string | InputMessage[];
  questions: Question[];
  prompt_cache_key?: string;
}

type Validated =
  | { ok: true; request: PdfDecisionsRequest; textBytes: number; images: number }
  | { ok: false; detail: string };

const NAME = /^[A-Za-z0-9_.-]+$/;
const DATA_IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const bytes = (text: string) => Buffer.byteLength(text, "utf8");

class Invalid extends Error {}
const fail = (detail: string): never => {
  throw new Invalid(detail);
};

function text(value: unknown, max: number, label: string): string {
  if (typeof value !== "string") return fail(`${label} must be text`);
  if (value.length > max) return fail(`${label} is longer than ${max} characters`);
  return value;
}

function optionalText(value: unknown, max: number, label: string): string | undefined {
  return value === undefined ? undefined : text(value, max, label);
}

/**
 * Rebuilds the request from known fields only, so nothing else reaches OpenAI: the model is
 * always gpt-6-luna, input is text or user messages with text and low-detail inline images, and
 * questions are predicate, choice or score with string instructions.
 */
export function validatePdfDecisionsRequest(body: unknown): Validated {
  const L = PDF_DECISIONS_LIMITS;
  let textBytes = 0;
  let images = 0;
  try {
    if (!isRecord(body)) fail("the body must be a JSON object");
    const b = body as Record<string, unknown>;
    const point = b.point;
    if (typeof point !== "string" || !(PDF_DECISION_POINTS as readonly string[]).includes(point)) {
      fail(`point must be one of ${PDF_DECISION_POINTS.join(", ")}`);
    }

    let input: PdfDecisionsRequest["input"];
    if (typeof b.input === "string") {
      input = b.input;
      textBytes += bytes(b.input);
    } else if (Array.isArray(b.input) && b.input.length > 0 && b.input.length <= 20) {
      input = b.input.map((message, m): InputMessage => {
        if (!isRecord(message) || message.role !== "user") fail(`input[${m}] must be a user message`);
        const content = (message as Record<string, unknown>).content;
        if (typeof content === "string") {
          textBytes += bytes(content);
          return { role: "user", content };
        }
        if (!Array.isArray(content) || content.length === 0 || content.length > 20) {
          return fail(`input[${m}].content must be text or 1..20 parts`);
        }
        return {
          role: "user",
          content: content.map((part, p): InputPart => {
            const where = `input[${m}].content[${p}]`;
            if (isRecord(part) && part.type === "input_text") {
              const value = text(part.text, L.maxTextBytes, `${where}.text`);
              textBytes += bytes(value);
              return { type: "input_text", text: value };
            }
            if (isRecord(part) && part.type === "input_image") {
              const url = part.image_url;
              if (typeof url !== "string" || !DATA_IMAGE.test(url)) {
                return fail(`${where} must be a base64 PNG, JPEG or WebP data URL`);
              }
              if (url.length > L.maxImageChars) return fail(`${where} is larger than the image cap`);
              images += 1;
              return { type: "input_image", image_url: url, detail: "low" };
            }
            return fail(`${where} must be input_text or input_image`);
          }),
        };
      });
    } else {
      return fail("input must be text or 1..20 user messages");
    }
    if (images > L.maxImages) fail(`at most ${L.maxImages} images`);

    const raw = b.questions;
    if (!Array.isArray(raw) || raw.length === 0) fail("questions must be a non-empty list");
    const list = raw as unknown[];
    if (list.length > L.maxQuestions) fail(`at most ${L.maxQuestions} questions`);
    const names = new Set<string>();
    const questions = list.map((q, i): Question => {
      if (!isRecord(q)) return fail(`questions[${i}] must be an object`);
      const name = text(q.name, L.maxNameChars, `questions[${i}].name`);
      if (!NAME.test(name)) fail(`questions[${i}].name must be letters, digits, _ . or -`);
      if (names.has(name)) fail(`question names must be unique (${name})`);
      names.add(name);
      const instructions = optionalText(
        q.instructions,
        L.maxInstructionChars,
        `questions[${i}].instructions`,
      );
      textBytes += bytes(name) + (instructions ? bytes(instructions) : 0);
      const base = { name, ...(instructions !== undefined ? { instructions } : {}) };
      if (q.type === "predicate") return { type: "predicate", ...base };
      if (q.type === "choice") {
        const choices = q.choices;
        if (!Array.isArray(choices) || choices.length < 2 || choices.length > L.maxChoices) {
          return fail(`questions[${i}].choices must have 2..${L.maxChoices} entries`);
        }
        return {
          type: "choice",
          ...base,
          choices: choices.map((c, j) => {
            if (!isRecord(c)) return fail(`questions[${i}].choices[${j}] must be an object`);
            const value =
              typeof c.value === "number" && Number.isFinite(c.value)
                ? c.value
                : text(c.value, L.maxChoiceChars, `questions[${i}].choices[${j}].value`);
            const description = optionalText(
              c.description,
              L.maxDescriptionChars,
              `questions[${i}].choices[${j}].description`,
            );
            textBytes += bytes(String(value)) + (description ? bytes(description) : 0);
            return { value, ...(description !== undefined ? { description } : {}) };
          }),
        };
      }
      if (q.type === "score") {
        const levels = q.levels;
        if (!Array.isArray(levels) || levels.length < L.minLevels || levels.length > L.maxLevels) {
          return fail(`questions[${i}].levels must have ${L.minLevels}..${L.maxLevels} entries`);
        }
        return {
          type: "score",
          ...base,
          levels: levels.map((level, j) => {
            if (!isRecord(level)) return fail(`questions[${i}].levels[${j}] must be an object`);
            const label = text(level.label, L.maxChoiceChars, `questions[${i}].levels[${j}].label`);
            const description = optionalText(
              level.description,
              L.maxDescriptionChars,
              `questions[${i}].levels[${j}].description`,
            );
            textBytes += bytes(label) + (description ? bytes(description) : 0);
            return { label, ...(description !== undefined ? { description } : {}) };
          }),
        };
      }
      return fail(`questions[${i}].type must be predicate, choice or score`);
    });
    if (textBytes > L.maxTextBytes) fail(`the text is larger than ${L.maxTextBytes} bytes`);
    const key = optionalText(b.prompt_cache_key, 1_000, "prompt_cache_key");
    return {
      ok: true,
      request: {
        point: point as PdfDecisionPoint,
        input,
        questions,
        ...(key ? { prompt_cache_key: key.slice(0, L.maxCacheKeyChars) } : {}),
      },
      textBytes,
      images,
    };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, detail: error.message };
    throw error;
  }
}

/** A generous upper bound on input tokens, held against the budget while the call runs. */
export function estimatePdfDecisionsCost(textBytes: number, images: number): number {
  return (Math.ceil(textBytes / 2) + images * 1_000) * PDF_DECISIONS_PRICE.input;
}

// ---------- the decision ----------

export interface PdfDecisionsCaller {
  /** The budget key: the space's organisation (company), or the space when none is known. */
  company: string;
  spaceId: string;
  userId: string;
  via: "session" | "sandbox";
  botId?: string;
  runId?: string;
}

export interface PdfDecisionsDeps {
  env: Record<string, string | undefined>;
  fetch: typeof globalThis.fetch;
  budget: PdfDecisionsBudget;
  /** Milliseconds since the epoch. */
  now?: () => number;
  /** Receives one event per request: counts, tokens, cost and timing; never content or keys. */
  log?: (event: PdfDecisionsLogEvent) => void;
  timeoutMs?: number;
  endpoint?: string;
}

export interface PdfDecisionsLogEvent {
  outcome: "ok" | PdfDecisionsReason;
  mode: PdfDecisionsMode;
  point?: PdfDecisionPoint;
  questions?: number;
  images?: number;
  inputTokens?: number;
  cachedTokens?: number;
  costUsd?: number;
  spentTodayUsd?: number;
  ms: number;
  upstreamStatus?: number;
  company?: string;
  spaceId?: string;
  userId?: string;
  botId?: string;
  runId?: string;
  via?: PdfDecisionsCaller["via"];
}

export type PdfDecisionsResponse =
  | {
      ok: true;
      mode: "shadow" | "on";
      answers: unknown[];
      usage: DecisionsUsage | null;
      costUsd: number;
      ms: number;
    }
  | { ok: false; reason: PdfDecisionsReason; detail?: string; status?: number };

export interface PdfDecisionsResult {
  status: number;
  body: PdfDecisionsResponse;
}

/** Answers one request. `caller` is null when the request carried no valid credential. */
export async function decidePdf(
  body: unknown,
  caller: PdfDecisionsCaller | null,
  deps: PdfDecisionsDeps,
): Promise<PdfDecisionsResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const mode = pdfDecisionsMode(deps.env);
  const who = caller
    ? {
        company: caller.company,
        spaceId: caller.spaceId,
        userId: caller.userId,
        via: caller.via,
        ...(caller.botId ? { botId: caller.botId } : {}),
        ...(caller.runId ? { runId: caller.runId } : {}),
      }
    : {};
  let facts: Partial<PdfDecisionsLogEvent> = {};
  const finish = (
    reason: PdfDecisionsReason,
    extra: { detail?: string; upstreamStatus?: number; costUsd?: number } = {},
  ): PdfDecisionsResult => {
    deps.log?.({
      outcome: reason,
      mode,
      ...facts,
      ...who,
      ...(extra.upstreamStatus ? { upstreamStatus: extra.upstreamStatus } : {}),
      ...(extra.costUsd ? { costUsd: extra.costUsd } : {}),
      ms: now() - started,
    });
    return {
      status: STATUS[reason],
      body: {
        ok: false,
        reason,
        ...(extra.detail ? { detail: extra.detail } : {}),
        ...(extra.upstreamStatus ? { status: extra.upstreamStatus } : {}),
      },
    };
  };

  if (mode === "off") return { status: STATUS.off, body: { ok: false, reason: "off" } };
  if (!caller) return finish("unauthorized");
  const apiKey = deps.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return finish("unavailable");
  const checked = validatePdfDecisionsRequest(body);
  if (!checked.ok) return finish("invalid", { detail: checked.detail });
  const { request } = checked;
  facts = { point: request.point, questions: request.questions.length, images: checked.images };

  const day = new Date(started).toISOString().slice(0, 10);
  const limitUsd = pdfDecisionsBudgetUsd(deps.env);
  const estimate = estimatePdfDecisionsCost(checked.textBytes, checked.images);
  if (!deps.budget.reserve(caller.company, day, estimate, limitUsd)) {
    facts.spentTodayUsd = deps.budget.spent(caller.company, day);
    return finish("budget");
  }
  let settled = false;
  const settle = (actualUsd: number) => {
    if (settled) return;
    settled = true;
    deps.budget.settle(caller.company, day, estimate, actualUsd);
    facts.spentTodayUsd = deps.budget.spent(caller.company, day);
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? PDF_DECISIONS_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await deps.fetch(deps.endpoint ?? PDF_DECISIONS_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: PDF_DECISIONS_MODEL,
          input: request.input,
          questions: request.questions,
          ...(request.prompt_cache_key ? { prompt_cache_key: request.prompt_cache_key } : {}),
        }),
        signal: controller.signal,
      });
    } catch {
      // The request may already have been billed; keep the estimate booked.
      settle(estimate);
      return finish(controller.signal.aborted ? "timeout" : "upstream");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      settle(0);
      return finish("upstream", { upstreamStatus: response.status });
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      settle(estimate);
      return finish(controller.signal.aborted ? "timeout" : "upstream");
    }
    const answers = isRecord(parsed) && Array.isArray(parsed.answers) ? parsed.answers : null;
    const usage = isRecord(parsed) && isRecord(parsed.usage) ? (parsed.usage as DecisionsUsage) : null;
    const costUsd = usage ? pdfDecisionsCost(usage) : estimate;
    settle(costUsd);
    if (!answers) return finish("upstream", { costUsd });
    const ms = now() - started;
    deps.log?.({
      outcome: "ok",
      mode,
      ...facts,
      ...who,
      inputTokens: num(usage?.input_tokens),
      cachedTokens: num(usage?.input_tokens_details?.cached_tokens),
      costUsd,
      ms,
    });
    return { status: 200, body: { ok: true, mode, answers, usage, costUsd, ms } };
  } finally {
    clearTimeout(timer);
  }
}
