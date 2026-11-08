import { Trans } from "@lingui/react/macro";
import type { SharedPage } from "@rakazo/contracts";
import { pageShareTokenFromSlug, SHARED_PAGE_PATH_PREFIX } from "@rakazo/contracts";
import { Button, buttonVariants, Spinner } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { PublicPageShell } from "../components/pages/PublicPageShell";
import { usePageDocument } from "../lib/pages";

/** Shared pages open only for people signed in to this company. */
type SharedPageRead = SharedPage | null | "sign-in";

async function readSharedPage(token: string): Promise<SharedPageRead> {
  const response = await fetch(`${SHARED_PAGE_PATH_PREFIX}${token}`, {
    credentials: "same-origin",
    referrerPolicy: "no-referrer",
  });
  if (response.status === 401) return "sign-in";
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Shared page returned ${response.status}`);
  return (await response.json()) as SharedPage;
}

/** A page someone shared by link, for anyone in the company holding it. */
export function SharedPagePage() {
  return (
    <>
      {/* The link is the page's only key, so no state of it belongs in search results. */}
      <meta name="robots" content="noindex, nofollow" />
      <SharedPageBody />
    </>
  );
}

function SharedPageBody() {
  const { slugToken = "" } = useParams();
  const token = pageShareTokenFromSlug(slugToken);
  const shared = useQuery({
    queryKey: ["shared-page", token],
    queryFn: () => readSharedPage(token!),
    enabled: token !== null,
    retry: false,
  });
  const page = shared.data === "sign-in" ? undefined : shared.data;
  const viewer = usePageDocument(page?.code);
  const title = page?.title;
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  if (shared.data === "sign-in") {
    const next = encodeURIComponent(`/p/${slugToken}`);
    return (
      <main className="grid min-h-dvh place-items-center bg-background px-6 text-center">
        <div className="flex max-w-[360px] flex-col items-center gap-3">
          <img src="/favicon-32x32.png" alt="" className="size-8 rounded-full" />
          <h1 className="text-[18px] leading-6 font-medium text-foreground">
            <Trans>Sign in to view this page</Trans>
          </h1>
          <p className="text-[14px] leading-5 text-muted-foreground">
            <Trans>Shared pages are only for people at your company.</Trans>
          </p>
          <a
            href={`/sign-in?next=${next}`}
            className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-1`}
          >
            <Trans>Sign in</Trans>
          </a>
        </div>
      </main>
    );
  }
  if (token === null || shared.data === null) {
    return (
      <main className="grid min-h-dvh place-items-center bg-background px-6 text-center">
        <div className="flex max-w-[360px] flex-col items-center gap-3">
          <img src="/favicon-32x32.png" alt="" className="size-8 rounded-full" />
          <h1 className="text-[18px] leading-6 font-medium text-foreground">
            <Trans>This page isn't available</Trans>
          </h1>
          <p className="text-[14px] leading-5 text-muted-foreground">
            <Trans>The owner may have turned off its link or deleted it.</Trans>
          </p>
          <a href="/" className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-1`}>
            <Trans>Open OCSC Intelligence</Trans>
          </a>
        </div>
      </main>
    );
  }
  // Busy or unreachable is not gone; a failed refresh keeps the page being read.
  const failed = shared.isError && !page;
  if (failed || viewer.failed) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background px-6 text-center text-[15px] text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <p role="alert">
            <Trans>Couldn't load this page. Try again.</Trans>
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (failed) void shared.refetch();
              if (viewer.failed) viewer.retry();
            }}
          >
            <Trans>Try again</Trans>
          </Button>
        </div>
      </div>
    );
  }
  if (!page) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background text-muted-foreground">
        <Spinner />
      </div>
    );
  }
  return <PublicPageShell title={page.title} document={viewer.document} />;
}
