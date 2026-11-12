import { useLingui } from "@lingui/react/macro";
import { Button, Spinner } from "@rakazo/ui-web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, FileSearch, Send, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useSpaceQueries } from "../../lib/query";

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

function slugFrom(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug.length >= 3 ? slug : `app-${slug || "studio"}`;
}

const safeLink = (url: string | undefined) => (url?.startsWith("https://") ? url : null);

/**
 * Sends the app to Evolve as a staff plugin with its brief and AI technical review. Three
 * colleagues peer review it, Evolve's developers publish it, and it then opens from Evolve's menu
 * with this app's live data.
 */
export function AppPublishSection({ pageId, title }: { pageId: string; title: string }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const publication = useQuery(queries.apps.evolvePublication.queryOptions({ input: { pageId } }));
  const [slug, setSlug] = useState<string | null>(null);
  const [draftBrief, setDraftBrief] = useState<string | null>(null);
  const [showDossier, setShowDossier] = useState(false);
  const chosen = slug ?? publication.data?.slug ?? slugFrom(title);
  const brief = draftBrief ?? publication.data?.brief ?? "";
  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: queries.apps.evolvePublication.queryKey({ input: { pageId } }),
    });
  const publish = useMutation({
    mutationFn: async (submitForReview: boolean) => {
      if (brief.trim() !== (publication.data?.brief ?? ""))
        await queries.apps.saveBrief.call({ pageId, brief });
      return queries.apps.publishToEvolve.call({
        pageId,
        slug: chosen,
        submitForReview,
        purpose: brief.trim() || undefined,
      });
    },
    onSuccess: () => {
      setDraftBrief(null);
      refresh();
    },
  });
  const saveBrief = useMutation({
    mutationFn: () => queries.apps.saveBrief.call({ pageId, brief }),
    onSuccess: () => {
      setDraftBrief(null);
      refresh();
    },
  });
  const dossier = useMutation({
    mutationFn: () => queries.apps.writeDossier.call({ pageId }),
    onSuccess: () => {
      setShowDossier(true);
      refresh();
    },
  });
  if (!publication.data?.available) return null;
  const valid = SLUG.test(chosen);
  const result = publish.data;
  const briefChanged = brief.trim() !== (publication.data.brief ?? "");
  const review = publication.data.dossier;
  const reviewCurrent = publication.data.dossierVersion === publication.data.currentVersion;
  const preview = safeLink(result?.previewUrl);
  const mine = safeLink(result?.myPluginsUrl);

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-medium text-foreground">{t`Publish to Evolve`}</h3>
      <p className="text-[12px] text-muted-foreground">
        {t`The app becomes an Evolve staff plugin. Once Evolve's reviewers publish it, it opens from Evolve's menu with this data, and changes follow the setting above.`}
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] text-muted-foreground">{t`Plugin name in Evolve`}</span>
        <input
          value={chosen}
          disabled={publish.isPending || Boolean(publication.data.slug)}
          onChange={(event) => setSlug(event.target.value.toLowerCase())}
          className="h-8 rounded-md border border-foreground/[0.12] bg-transparent px-2 font-mono text-[12px] text-foreground outline-none focus:border-primary/60 disabled:opacity-70"
        />
      </label>
      {!valid ? (
        <p className="text-[12px] text-destructive">
          {t`Use 3 to 40 lowercase letters, numbers or dashes.`}
        </p>
      ) : null}
      <label className="flex flex-col gap-1">
        <span className="text-[12px] text-muted-foreground">{t`Brief: what it's for, who uses it and how`}</span>
        <textarea
          value={brief}
          maxLength={2000}
          rows={4}
          onChange={(event) => setDraftBrief(event.target.value)}
          className="resize-y rounded-md border border-foreground/[0.12] bg-transparent px-2 py-1.5 text-[13px] text-foreground outline-none focus:border-primary/60"
        />
      </label>
      {briefChanged ? (
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={saveBrief.isPending}
            onClick={() => saveBrief.mutate()}
          >
            {saveBrief.isPending ? <Spinner /> : null}
            {t`Save brief`}
          </Button>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5 rounded-lg border border-foreground/[0.08] p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <FileSearch className="size-3.5 text-muted-foreground" />
          <span className="text-[13px] text-foreground">{t`AI technical review`}</span>
          <span className="text-[12px] text-muted-foreground">
            {!review
              ? t`Written when you send it for review.`
              : reviewCurrent
                ? t`Up to date with this version.`
                : t`Written for an earlier version; it is written again when you send it.`}
          </span>
        </div>
        <p className="text-[12px] text-muted-foreground">
          {t`Evolve's peer reviewers and developers get it with the brief: the app's functions, data, connectors, how it was built and any security or data-protection points.`}
        </p>
        <div className="flex flex-wrap gap-2">
          {review ? (
            <Button size="sm" variant="ghost" onClick={() => setShowDossier((open) => !open)}>
              {showDossier ? t`Hide` : t`Read it`}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={dossier.isPending || publish.isPending}
            onClick={() => dossier.mutate()}
          >
            {dossier.isPending ? <Spinner /> : null}
            {review ? t`Write it again` : t`Write it now`}
          </Button>
        </div>
        {dossier.error ? (
          <p role="alert" className="text-[12px] text-destructive">
            {t`The review couldn't be written just now. Try again.`}
          </p>
        ) : null}
        {showDossier && review ? (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-foreground/[0.03] p-2 font-sans text-[12px] text-foreground">
            {review}
          </pre>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!valid || !brief.trim() || publish.isPending}
          onClick={() => publish.mutate(true)}
        >
          {publish.isPending ? <Spinner /> : <Send />}
          {t`Send for review`}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!valid || publish.isPending}
          onClick={() => publish.mutate(false)}
        >
          {t`Save as draft`}
        </Button>
      </div>
      {publication.data.slug ? (
        <p className="text-[12px] text-muted-foreground">
          {t`Published as ${publication.data.slug}, release ${publication.data.release}. Publishing again sends the current version.`}
        </p>
      ) : null}
      {publish.error ? (
        <p role="alert" className="text-[12px] text-destructive">
          {publish.error instanceof Error ? publish.error.message : t`Evolve didn't accept it.`}
        </p>
      ) : null}
      {result ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-foreground/[0.08] p-2.5">
          <p className="text-[13px] text-foreground">
            {result.status === "peer_review"
              ? t`Version ${result.version} was sent to ${result.peerReviewers ?? 3} colleagues for peer review. After three approvals Evolve's developers do the final review and security check.`
              : result.status === "submitted"
                ? t`Version ${result.version} is waiting for Evolve's developers.`
                : t`Version ${result.version} is saved as a draft in Evolve.`}
          </p>
          <ul className="flex flex-col gap-1">
            {(result.checks ?? [])
              .filter((check) => !check.ok)
              .map((check) => (
                <li
                  key={check.label}
                  className="flex items-start gap-1.5 text-[12px] text-muted-foreground"
                >
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                  <span>
                    {check.label}
                    {check.detail ? ` · ${check.detail}` : ""}
                  </span>
                </li>
              ))}
            {(result.checks ?? []).every((check) => check.ok) ? (
              <li className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Check className="size-3.5 text-primary" />
                {t`Every check passed.`}
              </li>
            ) : null}
          </ul>
          <div className="flex flex-wrap gap-3 text-[12px]">
            {preview ? (
              <a
                href={preview}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {t`Preview in Evolve`}
                <ExternalLink className="size-3" />
              </a>
            ) : null}
            {mine ? (
              <a
                href={mine}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {t`My plugins`}
                <ExternalLink className="size-3" />
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
