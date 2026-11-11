import { useLingui } from "@lingui/react/macro";
import { Button, Spinner } from "@rakazo/ui-web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Send, TriangleAlert } from "lucide-react";
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
 * Sends the app to Evolve as a staff plugin. Evolve's reviewers publish it, after which it opens
 * from Evolve's menu with this app's live data.
 */
export function AppPublishSection({ pageId, title }: { pageId: string; title: string }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const publication = useQuery(queries.apps.evolvePublication.queryOptions({ input: { pageId } }));
  const [slug, setSlug] = useState<string | null>(null);
  const [purpose, setPurpose] = useState("");
  const chosen = slug ?? publication.data?.slug ?? slugFrom(title);
  const publish = useMutation({
    mutationFn: (submitForReview: boolean) =>
      queries.apps.publishToEvolve.call({
        pageId,
        slug: chosen,
        submitForReview,
        purpose: purpose.trim() || undefined,
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: queries.apps.evolvePublication.queryKey({ input: { pageId } }),
      }),
  });
  if (!publication.data?.available) return null;
  const valid = SLUG.test(chosen);
  const result = publish.data;
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
        <span className="text-[12px] text-muted-foreground">{t`What it's for and who uses it`}</span>
        <textarea
          value={purpose}
          maxLength={2000}
          rows={3}
          onChange={(event) => setPurpose(event.target.value)}
          className="resize-y rounded-md border border-foreground/[0.12] bg-transparent px-2 py-1.5 text-[13px] text-foreground outline-none focus:border-primary/60"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!valid || !purpose.trim() || publish.isPending}
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
            {result.status === "submitted"
              ? t`Version ${result.version} is waiting for Evolve's reviewers.`
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
