import { Trans, useLingui } from "@lingui/react/macro";
import type {
  LearningClinic,
  LearningModule,
  LearningQuizResult,
  LearningVideo,
  MessageBlock,
} from "@rakazo/contracts";
import { Button, buttonVariants, cn, Spinner } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Check,
  CircleCheck,
  CircleX,
  ExternalLink,
  FileText,
  GraduationCap,
  ListChecks,
  Maximize2,
  Play,
  RotateCcw,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { BuiCard } from "./ai/primitives";

type Block = Extract<MessageBlock, { kind: "learning_clinic" }>;

/** As on the Learning Centre, a video-only module counts as watched near its end. */
const WATCHED_FRACTION = 0.95;
const YOUTUBE_ORIGIN = "https://www.youtube-nocookie.com";

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function firstOpenModule(clinic: LearningClinic, preferred?: number): number | null {
  if (preferred && clinic.modules.some((module) => module.moduleId === preferred)) return preferred;
  return (clinic.modules.find((module) => !module.passed) ?? clinic.modules[0])?.moduleId ?? null;
}

/**
 * A YouTube video that reports how far it has played through YouTube's iframe messages, so a
 * module without a quiz can be completed only once it was watched.
 */
function YouTubePlayer({ videoId, onWatched }: { videoId: string; onWatched: () => void }) {
  const { t } = useLingui();
  const frame = useRef<HTMLIFrameElement>(null);
  const done = useRef(false);

  useEffect(() => {
    done.current = false;
    function listen(event: MessageEvent) {
      if (event.origin !== YOUTUBE_ORIGIN || event.source !== frame.current?.contentWindow) return;
      let data: { event?: string; info?: Record<string, unknown> } | null = null;
      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      const info = data?.info;
      if (!info || done.current) return;
      const time = Number(info.currentTime);
      const duration = Number(info.duration);
      if (info.playerState === 0 || (duration > 0 && time / duration >= WATCHED_FRACTION)) {
        done.current = true;
        onWatched();
      }
    }
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [onWatched]);

  return (
    <iframe
      ref={frame}
      title={t`Module video`}
      className="absolute inset-0 size-full"
      src={`${YOUTUBE_ORIGIN}/embed/${encodeURIComponent(videoId)}?enablejsapi=1&rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(window.location.origin)}`}
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      onLoad={() =>
        frame.current?.contentWindow?.postMessage(
          JSON.stringify({ event: "listening", id: videoId, channel: "widget" }),
          YOUTUBE_ORIGIN,
        )
      }
    />
  );
}

function ModuleVideo({ video, onWatched }: { video: LearningVideo; onWatched: () => void }) {
  const { t } = useLingui();
  const wrapper = useRef<HTMLDivElement>(null);
  if (video.kind === "link") {
    return (
      <a
        href={video.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onWatched}
        className={cn(buttonVariants({ variant: "outline" }), "gap-1.5")}
      >
        <ExternalLink aria-hidden className="size-4" />
        <Trans>Open the video</Trans>
      </a>
    );
  }
  return (
    <div>
      <div
        ref={wrapper}
        className="relative aspect-video w-full overflow-hidden rounded-xl bg-black"
        data-testid="learning-video"
      >
        {video.kind === "youtube" ? (
          <YouTubePlayer videoId={video.videoId} onWatched={onWatched} />
        ) : (
          // biome-ignore lint/a11y/useMediaCaption: Learning Centre videos have no caption files.
          <video
            className="absolute inset-0 size-full"
            src={video.url}
            controls
            playsInline
            preload="metadata"
            onEnded={onWatched}
            onTimeUpdate={(event) => {
              const media = event.currentTarget;
              if (media.duration > 0 && media.currentTime / media.duration >= WATCHED_FRACTION) {
                onWatched();
              }
            }}
          />
        )}
      </div>
      <div className="mt-1.5 flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          onClick={() => void wrapper.current?.requestFullscreen?.()}
        >
          <Maximize2 aria-hidden className="size-3.5" />
          {t`Full screen`}
        </Button>
      </div>
    </div>
  );
}

function Quiz({
  module,
  passPercent,
  onSubmit,
  onCancel,
}: {
  module: LearningModule;
  passPercent: number;
  onSubmit: (answers: { questionId: number; answerId: number }[]) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const questions = useMemo(
    () =>
      shuffled(module.questions).map((question) => ({
        ...question,
        answers: shuffled(question.answers),
      })),
    [module.questions],
  );
  const [chosen, setChosen] = useState<Record<number, number>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answered = questions.filter((question) => chosen[question.questionId]).length;

  return (
    <form
      className="mt-3 space-y-4"
      data-testid="learning-quiz"
      onSubmit={(event) => {
        event.preventDefault();
        if (answered < questions.length || sending) return;
        setSending(true);
        setError(null);
        onSubmit(
          questions.map((question) => ({
            questionId: question.questionId,
            answerId: chosen[question.questionId]!,
          })),
        )
          .catch((reason: unknown) => setError(errorText(reason, t`Could not submit the quiz`)))
          .finally(() => setSending(false));
      }}
    >
      <p className="text-[12.5px] text-muted-foreground">
        <Trans>
          {questions.length} questions · pass mark {passPercent}%
        </Trans>
      </p>
      {questions.map((question, index) => (
        <fieldset key={question.questionId} className="space-y-1.5">
          <legend className="text-[13.5px] font-medium text-foreground">
            {index + 1}. {question.text}
          </legend>
          {question.answers.map((answer) => {
            const picked = chosen[question.questionId] === answer.answerId;
            return (
              <label
                key={answer.answerId}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-[13.5px] transition",
                  picked ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
                )}
              >
                <input
                  type="radio"
                  className="mt-0.5 accent-primary"
                  name={`question-${question.questionId}`}
                  checked={picked}
                  onChange={() =>
                    setChosen((current) => ({
                      ...current,
                      [question.questionId]: answer.answerId,
                    }))
                  }
                />
                <span className="min-w-0 break-words">{answer.text}</span>
              </label>
            );
          })}
        </fieldset>
      ))}
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive"
        >
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={answered < questions.length || sending} className="gap-1.5">
          {sending ? <Spinner /> : <Check aria-hidden className="size-4" />}
          <Trans>Submit answers</Trans>
        </Button>
        <Button type="button" variant="ghost" disabled={sending} onClick={onCancel}>
          <Trans>Back to video</Trans>
        </Button>
        <span className="text-[12.5px] text-muted-foreground">
          <Trans>
            {answered} of {questions.length} answered
          </Trans>
        </span>
      </div>
    </form>
  );
}

function QuizResult({
  result,
  passPercent,
  onRetake,
  onNext,
}: {
  result: LearningQuizResult;
  passPercent: number;
  onRetake: () => void;
  onNext?: () => void;
}) {
  return (
    <div
      data-testid="learning-quiz-result"
      className={cn(
        "mt-3 rounded-xl border px-4 py-3",
        result.passed ? "border-success/40 bg-success/5" : "border-destructive/30 bg-destructive/5",
      )}
    >
      <div className="flex items-center gap-2">
        {result.passed ? (
          <CircleCheck aria-hidden className="size-5 text-success" />
        ) : (
          <CircleX aria-hidden className="size-5 text-destructive" />
        )}
        <span className="text-[15px] font-semibold text-foreground">
          {result.passed ? <Trans>Passed</Trans> : <Trans>Not passed yet</Trans>}
        </span>
        <span className="ms-auto text-[15px] font-semibold tabular-nums">
          {result.scorePercent}%
        </span>
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {result.passed ? (
          <Trans>
            {result.correct} of {result.total} correct. This module is complete.
          </Trans>
        ) : (
          <Trans>
            {result.correct} of {result.total} correct. You need {passPercent}% to pass; you can
            take it again as often as you like.
          </Trans>
        )}
      </p>
      {result.clinicCompleted ? (
        <p className="mt-2 text-[13px] font-medium text-success">
          <Trans>You have completed this clinic.</Trans>
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {result.passed ? null : (
          <Button type="button" className="gap-1.5" onClick={onRetake}>
            <RotateCcw aria-hidden className="size-4" />
            <Trans>Retake quiz</Trans>
          </Button>
        )}
        {result.passed && onNext ? (
          <Button type="button" className="gap-1.5" onClick={onNext}>
            <Play aria-hidden className="size-4" />
            <Trans>Next module</Trans>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * An Evolve Learning Centre clinic: start it, watch each module (full screen if wanted) and pass its
 * quiz, as on the Learning Centre. It loads as whoever is viewing it and only their clicks save.
 */
export function LearningClinicCard({ block }: { block: Block }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const options = queries.evolveLearning.card.queryOptions({ input: { clinicId: block.clinicId } });
  const state = useQuery({ ...options, staleTime: 30_000 });
  const clinic = state.data;
  const [moduleId, setModuleId] = useState<number | null>(null);
  const [view, setView] = useState<"video" | "quiz" | "result">("video");
  const [result, setResult] = useState<LearningQuizResult | null>(null);
  const [watched, setWatched] = useState<Set<number>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedId = moduleId ?? (clinic ? firstOpenModule(clinic, block.moduleId) : null);
  const module = clinic?.modules.find((entry) => entry.moduleId === selectedId) ?? null;
  const next =
    clinic && module
      ? clinic.modules.find((entry) => entry.number === module.number + 1)
      : undefined;

  function open(id: number) {
    setModuleId(id);
    setView("video");
    setResult(null);
    setError(null);
  }

  async function act(name: string, run: () => Promise<LearningClinic>) {
    if (busy) return;
    setBusy(name);
    setError(null);
    try {
      queryClient.setQueryData(options.queryKey, await run());
    } catch (reason) {
      setError(errorText(reason, t`Evolve's Learning Centre did not accept that`));
    } finally {
      setBusy(null);
    }
  }

  const markSeen = useMemo(
    () => (id: number) =>
      setWatched((current) => (current.has(id) ? current : new Set(current).add(id))),
    [],
  );
  const onWatched = useMemo(
    () => (module ? () => markSeen(module.moduleId) : () => {}),
    [module, markSeen],
  );

  return (
    <BuiCard
      data-testid="learning-clinic-card"
      className="w-full min-w-0 max-w-2xl overflow-hidden border border-border shadow-sm dark:border-transparent"
    >
      <div className="flex items-start gap-3 border-b border-border/70 px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <GraduationCap aria-hidden className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
            <Trans>Learning Centre clinic</Trans>
          </div>
          <div className="text-[15px] font-semibold leading-snug text-foreground break-words">
            {clinic?.name ?? block.title}
          </div>
          {clinic?.mentor ? (
            <div className="text-[12.5px] text-muted-foreground">
              <Trans>Mentor: {clinic.mentor}</Trans>
            </div>
          ) : null}
        </div>
        {clinic?.completed ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-[12px] font-medium text-success">
            <CircleCheck aria-hidden className="size-3.5" />
            <Trans>Completed</Trans>
          </span>
        ) : null}
      </div>

      <div className="px-4 pt-3.5 pb-4">
        {state.isPending ? (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Spinner />
            <Trans>Loading from the Learning Centre…</Trans>
          </div>
        ) : state.error || !clinic ? (
          <div className="space-y-2">
            <p role="alert" className="text-[13px] text-destructive">
              {errorText(state.error, t`Could not load this clinic from Evolve`)}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => void state.refetch()}>
              <Trans>Try again</Trans>
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
              <span>
                <Trans>
                  {clinic.modulesPassed} of {clinic.modulesTotal} modules passed
                </Trans>
              </span>
              {clinic.dueDate ? (
                <span className="inline-flex items-center gap-1">
                  <CalendarClock aria-hidden className="size-3.5" />
                  <Trans>Due {clinic.dueDate}</Trans>
                </span>
              ) : null}
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${clinic.modulesTotal ? (clinic.modulesPassed / clinic.modulesTotal) * 100 : 0}%`,
                }}
              />
            </div>

            {clinic.description && !clinic.enrolled ? (
              <p className="mt-3 line-clamp-4 text-[13.5px] whitespace-pre-line text-foreground">
                {clinic.description}
              </p>
            ) : null}

            <ol className="mt-3 flex flex-wrap gap-1.5" aria-label={t`Modules`}>
              {clinic.modules.map((entry) => (
                <li key={entry.moduleId}>
                  <button
                    type="button"
                    disabled={!clinic.enrolled}
                    title={entry.title}
                    aria-current={entry.moduleId === selectedId ? "step" : undefined}
                    onClick={() => open(entry.moduleId)}
                    className={cn(
                      "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-full border px-2.5 text-[12.5px] font-medium transition disabled:cursor-default",
                      entry.moduleId === selectedId && clinic.enrolled
                        ? "border-primary bg-primary text-primary-foreground"
                        : entry.passed
                          ? "border-success/40 bg-success/10 text-success"
                          : "border-border text-foreground hover:bg-accent",
                    )}
                  >
                    {entry.passed ? <Check aria-hidden className="size-3.5" /> : null}
                    {entry.number}
                  </button>
                </li>
              ))}
            </ol>

            {!clinic.enrolled ? (
              <div className="mt-4">
                <Button
                  type="button"
                  className="gap-1.5"
                  disabled={clinic.comingSoon || busy !== null}
                  onClick={() =>
                    void act("enrol", () => rpc.evolveLearning.enrol({ clinicId: clinic.clinicId }))
                  }
                >
                  {busy === "enrol" ? <Spinner /> : <Play aria-hidden className="size-4" />}
                  {clinic.comingSoon ? <Trans>Coming soon</Trans> : <Trans>Start clinic</Trans>}
                </Button>
                <p className="mt-2 text-[12.5px] text-muted-foreground">
                  <Trans>
                    Enrols you on the Learning Centre, as its Enroll button does. Each module is a
                    video, and most have a quiz you pass with {clinic.passPercent}%.
                  </Trans>
                </p>
              </div>
            ) : module ? (
              <div className="mt-4">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <h3 className="text-[14.5px] font-semibold text-foreground">
                    {module.number}. {module.title}
                  </h3>
                  {module.minutes ? (
                    <span className="text-[12.5px] text-muted-foreground">
                      <Trans>{module.minutes} min</Trans>
                    </span>
                  ) : null}
                  {module.passed ? (
                    <span className="text-[12.5px] font-medium text-success">
                      <Trans>Passed</Trans>
                    </span>
                  ) : module.lastScore !== null ? (
                    <span className="text-[12.5px] text-muted-foreground">
                      <Trans>Last score {module.lastScore}%</Trans>
                    </span>
                  ) : null}
                </div>
                {module.description && view === "video" ? (
                  <p className="mt-1 text-[13px] whitespace-pre-line text-muted-foreground">
                    {module.description}
                  </p>
                ) : null}

                {view === "quiz" ? (
                  <Quiz
                    key={`${module.moduleId}-${module.quizAttempts}`}
                    module={module}
                    passPercent={clinic.passPercent}
                    onCancel={() => setView("video")}
                    onSubmit={async (answers) => {
                      const reply = await rpc.evolveLearning.submitQuiz({
                        clinicId: clinic.clinicId,
                        moduleId: module.moduleId,
                        answers,
                      });
                      queryClient.setQueryData(options.queryKey, reply.clinic);
                      setResult(reply.result);
                      setView("result");
                    }}
                  />
                ) : view === "result" && result ? (
                  <QuizResult
                    result={result}
                    passPercent={clinic.passPercent}
                    onRetake={() => {
                      setResult(null);
                      setView("quiz");
                    }}
                    onNext={next ? () => open(next.moduleId) : undefined}
                  />
                ) : (
                  <div className="mt-3 space-y-3">
                    {module.video ? (
                      <ModuleVideo video={module.video} onWatched={onWatched} />
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2">
                      {module.hasQuiz ? (
                        <Button type="button" className="gap-1.5" onClick={() => setView("quiz")}>
                          <ListChecks aria-hidden className="size-4" />
                          {module.passed ? (
                            <Trans>Take the quiz again</Trans>
                          ) : (
                            <Trans>Take the quiz</Trans>
                          )}
                        </Button>
                      ) : module.passed ? (
                        next ? (
                          <Button
                            type="button"
                            className="gap-1.5"
                            onClick={() => open(next.moduleId)}
                          >
                            <Play aria-hidden className="size-4" />
                            <Trans>Next module</Trans>
                          </Button>
                        ) : null
                      ) : (
                        <Button
                          type="button"
                          className="gap-1.5"
                          disabled={
                            busy !== null ||
                            (Boolean(module.video) && !watched.has(module.moduleId))
                          }
                          onClick={() =>
                            void act("watched", () =>
                              rpc.evolveLearning.markWatched({
                                clinicId: clinic.clinicId,
                                moduleId: module.moduleId,
                              }),
                            )
                          }
                        >
                          {busy === "watched" ? (
                            <Spinner />
                          ) : (
                            <Check aria-hidden className="size-4" />
                          )}
                          <Trans>I have watched this</Trans>
                        </Button>
                      )}
                      {module.pdfUrl ? (
                        <a
                          href={module.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(buttonVariants({ variant: "outline" }), "gap-1.5")}
                        >
                          <FileText aria-hidden className="size-4" />
                          <Trans>Notes (PDF)</Trans>
                        </a>
                      ) : null}
                    </div>
                    {!module.hasQuiz &&
                    !module.passed &&
                    module.video &&
                    !watched.has(module.moduleId) ? (
                      <p className="text-[12.5px] text-muted-foreground">
                        <Trans>
                          This module has no quiz: watch the video to the end to complete it.
                        </Trans>
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}
            {error ? (
              <p
                role="alert"
                className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive"
              >
                {error}
              </p>
            ) : null}
          </>
        )}
      </div>
    </BuiCard>
  );
}
