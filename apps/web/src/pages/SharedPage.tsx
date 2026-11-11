import { Trans } from "@lingui/react/macro";
import type { SharedPage } from "@rakazo/contracts";
import {
  pageShareTokenFromSlug,
  SHARED_PAGE_PASSWORD_HEADER,
  SHARED_PAGE_PATH_PREFIX,
} from "@rakazo/contracts";
import { Button, buttonVariants, Spinner } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { PublicPageShell } from "../components/pages/PublicPageShell";
import { sharedPageState } from "../lib/page-state";
import { usePageDocument } from "../lib/pages";

/**
 * Shared pages open for people signed in to this company, and a page open to anyone also opens
 * with its password.
 */
type SharedPageRead = SharedPage | null | "sign-in" | "password" | "wrong-password" | "too-many";

/** The password typed for this link, kept for the tab so a refresh does not ask again. */
const passwordKey = (token: string) => `rakazo-page-password:${token}`;

async function readSharedPage(token: string, password: string | null): Promise<SharedPageRead> {
  const response = await fetch(`${SHARED_PAGE_PATH_PREFIX}${token}`, {
    credentials: "same-origin",
    referrerPolicy: "no-referrer",
    headers: password ? { [SHARED_PAGE_PASSWORD_HEADER]: password } : undefined,
  });
  if (response.status === 401) {
    const body = (await response.json().catch(() => null)) as {
      needsPassword?: boolean;
      wrong?: boolean;
    } | null;
    if (body?.wrong) return "wrong-password";
    return body?.needsPassword ? "password" : "sign-in";
  }
  if (response.status === 429 && password) return "too-many";
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
  const [password, setPassword] = useState<string | null>(() =>
    token ? sessionStorage.getItem(passwordKey(token)) : null,
  );
  const shared = useQuery({
    queryKey: ["shared-page", token, password],
    queryFn: () => readSharedPage(token!, password),
    enabled: token !== null,
    retry: false,
  });
  useEffect(() => {
    if (!token) return;
    if (password && shared.data && typeof shared.data === "object") {
      sessionStorage.setItem(passwordKey(token), password);
    } else if (shared.data === "wrong-password") {
      sessionStorage.removeItem(passwordKey(token));
    }
  }, [token, password, shared.data]);
  const page = typeof shared.data === "object" ? shared.data : undefined;
  const pageState = useMemo(
    () => (token ? sharedPageState(token, password) : undefined),
    [token, password],
  );
  const viewer = usePageDocument(page?.code);
  const title = page?.title;
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  if (
    shared.data === "password" ||
    shared.data === "wrong-password" ||
    shared.data === "too-many"
  ) {
    return (
      <PasswordPrompt
        problem={shared.data}
        pending={shared.isFetching}
        signInHref={`/sign-in?next=${encodeURIComponent(`/p/${slugToken}`)}`}
        onSubmit={setPassword}
      />
    );
  }
  if (shared.data === "sign-in") {
    const next = encodeURIComponent(`/p/${slugToken}`);
    return (
      <main className="grid min-h-dvh place-items-center bg-background px-6 text-center">
        <div className="flex max-w-[360px] flex-col items-center gap-3">
          <img src="/auth/ocsc-logo-on-light.png" alt="OCSC" className="mb-3 w-36 dark:hidden" />
          <img
            src="/auth/ocsc-logo-on-dark.png"
            alt="OCSC"
            className="mb-3 hidden w-36 dark:block"
          />
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
          <img src="/auth/ocsc-logo-on-light.png" alt="OCSC" className="mb-3 w-36 dark:hidden" />
          <img
            src="/auth/ocsc-logo-on-dark.png"
            alt="OCSC"
            className="mb-3 hidden w-36 dark:block"
          />
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
  return <PublicPageShell title={page.title} document={viewer.document} state={pageState} />;
}

function PasswordPrompt({
  problem,
  pending,
  signInHref,
  onSubmit,
}: {
  problem: "password" | "wrong-password" | "too-many";
  pending: boolean;
  signInHref: string;
  onSubmit: (password: string) => void;
}) {
  const [value, setValue] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const typed = value.trim();
    if (typed) onSubmit(typed);
  }
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-6">
      <form
        onSubmit={submit}
        className="flex w-full max-w-[360px] flex-col items-center gap-3 text-center"
      >
        <img src="/auth/ocsc-logo-on-light.png" alt="OCSC" className="mb-3 w-36 dark:hidden" />
        <img src="/auth/ocsc-logo-on-dark.png" alt="OCSC" className="mb-3 hidden w-36 dark:block" />
        <h1 className="text-[18px] leading-6 font-medium text-foreground">
          <Trans>This page is password protected</Trans>
        </h1>
        <p className="text-[14px] leading-5 text-muted-foreground">
          <Trans>Enter the password you were sent with the link.</Trans>
        </p>
        <input
          // biome-ignore lint/a11y/noAutofocus: the password is the only thing on this screen
          autoFocus
          type="password"
          autoComplete="off"
          aria-label="Password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="mt-1 h-10 w-full rounded-[10px] bg-foreground/[0.04] px-3 text-center font-mono text-[15px] tracking-[0.08em] text-foreground ring-[0.5px] ring-border outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {problem === "wrong-password" ? (
          <p role="alert" className="text-[13px] leading-5 text-destructive">
            <Trans>That password is not right. Check it and try again.</Trans>
          </p>
        ) : problem === "too-many" ? (
          <p role="alert" className="text-[13px] leading-5 text-destructive">
            <Trans>Too many tries. Wait 15 minutes and try again.</Trans>
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={pending || !value.trim()}>
          {pending ? <Spinner /> : <Trans>Open page</Trans>}
        </Button>
        <a
          href={signInHref}
          className="text-[13px] leading-5 text-muted-foreground underline-offset-4 hover:underline"
        >
          <Trans>Work at OCSC? Sign in instead</Trans>
        </a>
      </form>
    </main>
  );
}
