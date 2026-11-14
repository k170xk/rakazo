import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { Building2, Check, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import type { AskCardProps } from "./AskCard";
import { BuiCard } from "./ai/primitives";

/**
 * Shown before an app exists. The pictures are fixed, so the explanation does not depend on the
 * model wording it, and they stay the same for every new app.
 */
export function AppScopeAskCard({ block, canAnswer, onAnswer }: AskCardProps) {
  const { t } = useLingui();
  const [pending, setPending] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<string>();
  const [writingOwn, setWritingOwn] = useState(false);
  const [ownAnswer, setOwnAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const answered = block.status === "answered" || accepted !== undefined;
  const chosen = block.status === "answered" ? block.answer : accepted;
  const live = canAnswer && !answered;

  async function choose(value: string) {
    const answer = value.trim();
    if (!live || !answer || pending) return;
    setPending(answer);
    setError(null);
    try {
      await onAnswer(answer);
      setAccepted(answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not submit this answer`);
    } finally {
      setPending(null);
    }
  }

  return (
    <BuiCard
      data-testid="app-scope-card"
      className="w-full min-w-0 max-w-3xl overflow-hidden border border-border shadow-sm"
    >
      <div className="border-b border-border bg-primary/10 px-5 py-3">
        <p className="text-[12px] font-semibold tracking-wide text-primary uppercase">
          <Trans>Before the app is created</Trans>
        </p>
        <h2 className="mt-1 text-[18px] leading-snug font-semibold text-foreground">
          <Trans>Is this an individual user app, or a tenant app?</Trans>
        </h2>
        <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
          <Trans>This decides who the data belongs to. Nothing is built until you choose.</Trans>
        </p>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <ScopePanel
          testId="app-scope-personal"
          selected={chosen === "personal"}
          dimmed={answered && chosen !== "personal"}
          icon={<UserRound aria-hidden className="size-4" />}
          title={<Trans>Just for me</Trans>}
          kicker={<Trans>Individual user app</Trans>}
          onChoose={live ? () => void choose("personal") : undefined}
          pending={pending === "personal"}
          diagram={
            <ScopeFigure
              src="/app-scope/personal.jpg"
              alt={t`One person writing their own site diary. Nobody else has those notes.`}
            />
          }
        >
          <Trans>
            One person, one use. Example: your private site diary — notes, photos and reminders from
            the visits you make. Those rows are yours. Colleagues do not see them, and the diary is
            not split into projects.
          </Trans>
        </ScopePanel>
        <ScopePanel
          testId="app-scope-tenant"
          selected={chosen === "tenant"}
          dimmed={answered && chosen !== "tenant"}
          icon={<Building2 aria-hidden className="size-4" />}
          title={<Trans>For the company</Trans>}
          kicker={<Trans>Tenant app</Trans>}
          onChoose={live ? () => void choose("tenant") : undefined}
          pending={pending === "tenant"}
          diagram={
            <ScopeFigure
              src="/app-scope/tenant.jpg"
              alt={t`One bridge inspection app, with a separate team and records for Athlone, Kells and Sligo.`}
            />
          }
        >
          <Trans>
            One tool, reused. Example: a bridge inspection app. Athlone Bridge, Kells Bridge and
            Sligo Bridge each keep their own inspections, defects and photos, and their own people.
            Someone on one bridge does not see the other. A new bridge is another workspace in this
            same app.
          </Trans>
        </ScopePanel>
      </div>
      <div className="px-4 pb-4">
        {error ? <p className="mb-2 text-[13px] text-destructive">{error}</p> : null}
        {answered && chosen && chosen !== "personal" && chosen !== "tenant" ? (
          <p className="text-[13.5px] text-muted-foreground">
            <Trans>You answered: {chosen}</Trans>
          </p>
        ) : null}
        {live && !writingOwn ? (
          <button
            type="button"
            className="text-[13px] text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setWritingOwn(true)}
          >
            <Trans>Type my own answer</Trans>
          </button>
        ) : null}
        {live && writingOwn ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void choose(ownAnswer);
            }}
          >
            <textarea
              aria-label={t`Your answer`}
              rows={2}
              value={ownAnswer}
              onChange={(event) => setOwnAnswer(event.target.value)}
              placeholder={t`For example: one shared list the whole office sees`}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[14px]"
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={!ownAnswer.trim() || pending !== null}>
                <Trans>Send answer</Trans>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setWritingOwn(false)}
              >
                <Trans>Cancel</Trans>
              </Button>
            </div>
          </form>
        ) : null}
        {!live && !answered ? (
          <p className="text-[13px] text-muted-foreground">
            <Trans>No longer active</Trans>
          </p>
        ) : null}
      </div>
    </BuiCard>
  );
}

function ScopePanel({
  testId,
  title,
  kicker,
  icon,
  diagram,
  children,
  selected,
  dimmed,
  pending,
  onChoose,
}: {
  testId: string;
  title: ReactNode;
  kicker: ReactNode;
  icon: ReactNode;
  diagram: ReactNode;
  children: ReactNode;
  selected: boolean;
  dimmed: boolean;
  pending: boolean;
  onChoose?: () => void;
}) {
  return (
    <div
      data-testid={testId}
      className={`flex flex-col rounded-2xl border p-3 ${
        selected ? "border-primary bg-primary/5" : "border-border bg-card"
      } ${dimmed ? "opacity-60" : ""}`}
    >
      {diagram}
      <div className="mt-3 flex items-center gap-2 text-primary">
        {icon}
        <span className="text-[11.5px] font-semibold tracking-wide uppercase">{kicker}</span>
        {selected ? <Check aria-hidden className="ms-auto size-4" /> : null}
      </div>
      <h3 className="mt-1 text-[16px] font-semibold">{title}</h3>
      <p className="mt-1 flex-1 text-[13.5px] leading-relaxed text-muted-foreground">{children}</p>
      {onChoose ? (
        <Button type="button" className="mt-3" disabled={pending} onClick={onChoose}>
          {pending ? <Trans>Sending…</Trans> : title}
        </Button>
      ) : null}
    </div>
  );
}

/** One person, one notebook — or one app, a separate set of records for each bridge. */
function ScopeFigure({ src, alt }: { src: string; alt: string }) {
  return (
    <img src={src} alt={alt} className="aspect-square w-full rounded-xl bg-muted object-cover" />
  );
}
