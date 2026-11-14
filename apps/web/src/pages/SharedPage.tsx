import { Trans } from "@lingui/react/macro";
import { readBoard, Whiteboard } from "@rakazo/app-kit/ui";
import type { SharedPage } from "@rakazo/contracts";
import {
  pageShareTokenFromSlug,
  SHARED_PAGE_PASSWORD_HEADER,
  SHARED_PAGE_PATH_PREFIX,
} from "@rakazo/contracts";
import { Button, buttonVariants, Spinner } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { AppFrame } from "../components/apps/AppFrame";
import { PublicPageShell } from "../components/pages/PublicPageShell";
import {
  boardBoundsWithArrows,
  exportWhiteboardPdf,
} from "../components/whiteboards/whiteboard-export";
import { sharedAppSource } from "../lib/app-host";
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
  const isApp = page?.kind === "app";
  const isBoard = page?.kind === "whiteboard";
  const viewer = usePageDocument(isApp || isBoard ? undefined : page?.code);
  const appSource = useMemo(
    () =>
      token && (isApp || isBoard)
        ? sharedAppSource(token, password, page?.canSaveState === true)
        : null,
    [token, password, isApp, isBoard, page?.canSaveState],
  );
  const title = page?.title;
  const sharedBoardRef = useRef<HTMLDivElement>(null);
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
            <Trans>Sign in to view this app</Trans>
          </h1>
          <p className="text-[14px] leading-5 text-muted-foreground">
            <Trans>Shared apps are only for people at your company.</Trans>
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
            <Trans>This app isn't available</Trans>
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
  if (failed || (!isApp && !isBoard && viewer.failed)) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background px-6 text-center text-[15px] text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <p role="alert">
            <Trans>Couldn't load this app. Try again.</Trans>
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
  if (isBoard) {
    const resolveSharedAsset = appSource
      ? (assetId: string) =>
          appSource
            .asset(assetId)
            .then((res) => `data:${res.mime};base64,${res.base64}`)
            .catch(() => null)
      : undefined;
    const saveBlob = (ext: string, mime: string, body: BlobPart) => {
      const slug =
        page.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 40) || "whiteboard";
      const url = URL.createObjectURL(new Blob([body], { type: mime }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug}.${ext}`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    };
    const downloadSharedSvg = () => {
      const svg = sharedBoardRef.current?.querySelector("svg.absolute");
      if (!svg) return;
      const clone = svg.cloneNode(true) as SVGElement;
      const bounds = boardBoundsWithArrows(readBoard(page.code).items);
      const pad = 48;
      const width = bounds.w + pad * 2;
      const height = bounds.h + pad * 2;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("viewBox", `${bounds.x - pad} ${bounds.y - pad} ${width} ${height}`);
      clone.setAttribute("width", String(Math.ceil(width)));
      clone.setAttribute("height", String(Math.ceil(height)));
      const g = clone.querySelector("g");
      g?.removeAttribute("transform");
      const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bg.setAttribute("x", String(bounds.x - pad));
      bg.setAttribute("y", String(bounds.y - pad));
      bg.setAttribute("width", String(width));
      bg.setAttribute("height", String(height));
      bg.setAttribute("fill", "white");
      g?.insertBefore(bg, g.firstChild);
      saveBlob("svg", "image/svg+xml", clone.outerHTML);
    };
    const downloadSharedPdf = async () => {
      const bytes = await exportWhiteboardPdf({
        title: page.title,
        code: page.code,
        resolveAsset: resolveSharedAsset,
      });
      saveBlob("pdf", "application/pdf", bytes);
    };
    const pillClass =
      "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] leading-[18px] font-medium whitespace-nowrap text-foreground ring-[0.5px] ring-border outline-none hover:bg-foreground/[0.08] focus-visible:ring-2 focus-visible:ring-ring";
    return (
      <PublicPageShell
        title={page.title}
        document={null}
        fill
        actions={
          <>
            <Button variant="ghost" className={pillClass} onClick={downloadSharedSvg}>
              <Download className="size-4" strokeWidth={1.5} />
              <span className="max-[560px]:sr-only">
                <Trans>Download SVG</Trans>
              </span>
            </Button>
            <Button variant="ghost" className={pillClass} onClick={() => void downloadSharedPdf()}>
              <Download className="size-4" strokeWidth={1.5} />
              <span className="max-[560px]:sr-only">
                <Trans>Download PDF</Trans>
              </span>
            </Button>
          </>
        }
      >
        <div ref={sharedBoardRef} className="size-full">
          <Whiteboard
            value={page.code}
            resolveAsset={resolveSharedAsset}
            readOnly
            height="100%"
            className="h-full rounded-none border-0"
          />
        </div>
      </PublicPageShell>
    );
  }
  if (isApp && appSource) {
    return (
      <PublicPageShell title={page.title} document={null} fill>
        <AppFrame
          document={page.code}
          title={page.title}
          app={{ id: token ?? "", version: page.version }}
          source={appSource}
          // A link that opened without a password opened by the viewer's company sign-in.
          maps={password === null}
        />
      </PublicPageShell>
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
          <Trans>This app is password protected</Trans>
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
          {pending ? <Spinner /> : <Trans>Open app</Trans>}
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
