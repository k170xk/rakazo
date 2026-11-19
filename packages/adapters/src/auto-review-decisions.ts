import type {
  AdapterContext,
  AdapterDescriptor,
  AutoReviewCapabilities,
  AutoReviewProvider,
  AutoReviewRequest,
  AutoReviewResult,
  DecisionAnswer,
} from "@rakazo/adapter-kit";
import { getLogger } from "@rakazo/logging";
import { decisionAssistModel } from "./decision-models.js";

export type AutoReviewDecisionsMode = "off" | "shadow" | "on" | "guarded";

export const DECISION_ASSIST_MIN_CONFIDENCE = 0.9;
export const DECISION_ASSIST_TIMEOUT_MS = 2_500;

/**
 * `RAKAZO_AUTO_REVIEW_DECISIONS=shadow` asks a decision model beside the chat checker and only
 * logs both verdicts; `on` also lets its confident pass stand when it answers first. `guarded` does
 * that only for a site the run was given, never a new one, and lets the checker finish so its
 * verdict is logged beside every early pass. Off otherwise.
 */
export function autoReviewDecisionsMode(
  env: NodeJS.ProcessEnv = process.env,
): AutoReviewDecisionsMode {
  const value = env.RAKAZO_AUTO_REVIEW_DECISIONS?.trim().toLowerCase();
  return value === "shadow" || value === "on" || value === "guarded" ? value : "off";
}

/** The decision model for a chat checker, only for a plain key on that provider's own endpoint. */
export function decisionAssistFor(
  checkerProvider: string,
  key: {
    apiKey?: string;
    oauth?: unknown;
    baseUrl?: string;
    gatewayId?: string;
    headers?: Record<string, string>;
  },
) {
  if (!key.apiKey?.trim() || key.oauth || key.baseUrl || key.gatewayId) return undefined;
  if (Object.keys(key.headers ?? {}).length > 0) return undefined;
  return decisionAssistModel(checkerProvider);
}

type Settled<T> = { value?: T; threw?: true; ms: number };

/**
 * Wraps the configured checker. Its call, context and errors are unchanged; the decision model can
 * only end the review early with a confident pass in `on` mode, and every other answer, error or
 * timeout leaves the checker's verdict in place.
 */
export class DecisionAssistedAutoReview implements AutoReviewProvider {
  constructor(
    private readonly options: {
      mode: "shadow" | "on" | "guarded";
      checker: AutoReviewProvider;
      checkerModel: string;
      assist: (onAnswer: (answer: DecisionAnswer | undefined) => void) => AutoReviewProvider;
      now?: () => number;
    },
  ) {}

  describe(): AdapterDescriptor<AutoReviewCapabilities> {
    return this.options.checker.describe();
  }

  async review(request: AutoReviewRequest, context: AdapterContext): Promise<AutoReviewResult> {
    const { mode, checker, checkerModel } = this.options;
    const now = this.options.now ?? (() => performance.now());
    const started = now();
    const settle = <T>(promise: Promise<T>): Promise<Settled<T>> =>
      promise.then(
        (value) => ({ value, ms: now() - started }),
        () => ({ threw: true, ms: now() - started }),
      );
    const stop = new AbortController();
    const checking = checker.review(
      request,
      mode === "on"
        ? { ...context, signal: AbortSignal.any([context.signal, stop.signal]) }
        : context,
    );
    const checked = settle(checking);
    let answer: DecisionAnswer | undefined;
    let assisted: Promise<Settled<AutoReviewResult>>;
    try {
      assisted = settle(
        this.options
          .assist((value) => {
            answer = value;
          })
          .review(request, context),
      );
    } catch {
      assisted = Promise.resolve({ threw: true, ms: 0 });
    }
    let used = false;
    const log = () =>
      void Promise.all([checked, assisted])
        .then(([check, assist]) => {
          if (used && mode === "guarded" && check.value?.decision !== "pass") {
            getLogger().warn("auto review decision assist overruled", {
              tool: request.toolName,
              checker_decision: check.value?.decision ?? "threw",
            });
          }
          getLogger().info("auto review decision assist", {
            mode,
            tool: request.toolName,
            new_site: request.newSite === true,
            checker_model: checkerModel,
            checker_decision: check.value?.decision ?? "threw",
            checker_ms: Math.round(check.ms),
            assist_model: assist.value?.model ?? null,
            assist_decision: assist.value?.decision ?? "threw",
            assist_choice: answer?.choice ?? null,
            assist_confidence: answer?.confidence ?? null,
            assist_ms: Math.round(assist.ms),
            assist_used: used,
          });
        })
        .catch(() => undefined);

    if (mode === "on" || (mode === "guarded" && request.newSite !== true)) {
      const first = await Promise.race([
        checked.then(() => "checker" as const),
        assisted.then(() => "assist" as const),
      ]);
      const assist = first === "assist" ? await assisted : undefined;
      if (
        assist?.value?.decision === "pass" &&
        (answer?.confidence ?? 0) >= DECISION_ASSIST_MIN_CONFIDENCE
      ) {
        used = true;
        if (mode === "on") stop.abort();
        log();
        return assist.value;
      }
    }
    log();
    return checking;
  }
}
