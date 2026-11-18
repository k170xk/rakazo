import { useLingui } from "@lingui/react/macro";
import { Button, Spinner } from "@rakazo/ui-web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2 } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { errorCode } from "../../lib/user-error";
import type { AppFiles } from "./app-code-merge";
import { mergeAppFiles } from "./app-code-merge";

const CodeEditor = lazy(() => import("./CodeEditor"));

const FILE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,60}\.(tsx|ts|css|json|py)$/;

/** The app's source files, editable by hand; saving builds them and keeps a new version. */
export function AppCodePanel({ pageId, version }: { pageId: string; version: number }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const files = useQuery(queries.apps.files.queryOptions({ input: { pageId } }));
  const [drafts, setDrafts] = useState<AppFiles | null>(null);
  // The version this person's edits started from, so a newer save can be merged rather than lost.
  const [draftBase, setDraftBase] = useState<{ version: number; files: AppFiles } | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [current, setCurrent] = useState("App.tsx");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [problems, setProblems] = useState<
    { file?: string; line?: number; column?: number; message: string }[]
  >([]);
  const loaded = files.data?.files;
  const newest = files.data;
  // Until this person edits, the files follow the newest version. When someone else (the AI,
  // usually) saves while they edit, their edits are carried onto it file by file; a file both
  // changed waits for them to choose.
  const shown = drafts ?? loaded ?? {};
  const reference = drafts && draftBase ? draftBase.files : loaded;
  const names = Object.keys(shown).sort((a, b) =>
    a === "App.tsx" ? -1 : b === "App.tsx" ? 1 : a.localeCompare(b),
  );
  const fileProblems = useMemo(
    () =>
      problems.filter(
        (problem) => problem.file?.replace(/^.*\//, "") === current && problem.line !== undefined,
      ),
    [problems, current],
  );
  const changed = reference
    ? names.some((name) => shown[name] !== reference[name]) ||
      Object.keys(reference).some((name) => !(name in shown))
    : false;

  useEffect(() => {
    if (!newest || !drafts || !draftBase || newest.version === draftBase.version) return;
    const merged = mergeAppFiles(draftBase.files, drafts, newest.files);
    if (merged.conflicts.length) {
      const names = merged.conflicts.join("\n");
      setConflicts((previous) => (previous.join("\n") === names ? previous : merged.conflicts));
      return;
    }
    setDrafts(merged.files);
    setDraftBase({ version: newest.version, files: newest.files });
    setConflicts([]);
    setMessage({
      tone: "ok",
      text: t`Version ${newest.version} was saved while you edited. Your unsaved changes were kept on top of it.`,
    });
  }, [newest, drafts, draftBase, t]);

  const edit = (next: (previous: AppFiles) => AppFiles) => {
    if (!drafts && newest) setDraftBase({ version: newest.version, files: newest.files });
    setDrafts((previous) => next(previous ?? loaded ?? {}));
  };

  /** Settles files both sides changed: this person's text, or the newer version's. */
  const resolve = (keepMine: boolean) => {
    if (!newest || !drafts || !draftBase) return;
    const merged = mergeAppFiles(draftBase.files, drafts, newest.files);
    const next = { ...merged.files };
    if (keepMine) {
      for (const name of merged.conflicts) {
        const mine = drafts[name];
        if (mine === undefined) delete next[name];
        else next[name] = mine;
      }
    }
    setDrafts(next);
    setDraftBase({ version: newest.version, files: newest.files });
    setConflicts([]);
    setMessage(null);
  };

  const discard = () => {
    setDrafts(null);
    setDraftBase(null);
    setConflicts([]);
  };

  const save = useMutation({
    mutationFn: () =>
      queries.apps.saveFiles.call({
        pageId,
        files: shown,
        baseVersion: draftBase?.version ?? newest?.version ?? version,
      }),
    onSuccess: (result) => {
      setProblems(result.problems);
      if (result.version === null) {
        setMessage({ tone: "error", text: t`It didn't build, so nothing was saved.` });
        return;
      }
      setMessage({ tone: "ok", text: t`Saved as version ${result.version}.` });
      setDrafts(null);
      setDraftBase(null);
      setConflicts([]);
      void queryClient.invalidateQueries({ queryKey: queries.apps.key() });
      void queryClient.invalidateQueries({ queryKey: queries.pages.get.key() });
    },
    onError: (error) => {
      if (errorCode(error) === "CONFLICT") {
        void files.refetch();
        setMessage({
          tone: "error",
          text: t`A newer version was saved while you edited. Your changes are kept; save again to add them to it.`,
        });
        return;
      }
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : t`Couldn't save.`,
      });
    },
  });
  const canSave = changed && !conflicts.length && !save.isPending;

  if (files.isPending) {
    return (
      <div className="grid h-40 place-items-center">
        <Spinner />
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-foreground/[0.06] px-2 py-1.5">
        {names.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={name === current}
            onClick={() => setCurrent(name)}
            className="shrink-0 rounded-md px-2 py-1 font-mono text-[12px] text-foreground/65 hover:bg-foreground/[0.05] aria-pressed:bg-foreground/[0.08] aria-pressed:text-foreground"
          >
            {name}
            {reference && shown[name] !== reference[name] ? (
              <span className="ml-1 text-primary">•</span>
            ) : null}
          </button>
        ))}
        <button
          type="button"
          aria-label={t`New file`}
          title={t`New file`}
          onClick={() => {
            const name = window.prompt(t`File name, like Chart.tsx`)?.trim();
            if (!name) return;
            if (!FILE_NAME.test(name) || name in shown) {
              setMessage({ tone: "error", text: t`Use a new name like Chart.tsx or theme.css.` });
              return;
            }
            edit((previous) => ({ ...previous, [name]: "" }));
            setCurrent(name);
          }}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
        >
          <FilePlus2 className="size-4" />
        </button>
      </div>
      <Suspense
        fallback={
          <div className="grid min-h-0 flex-1 place-items-center">
            <Spinner />
          </div>
        }
      >
        <CodeEditor
          file={current}
          label={current}
          value={shown[current] ?? ""}
          problems={fileProblems}
          onChange={(text) => edit((previous) => ({ ...previous, [current]: text }))}
          onSave={() => {
            if (canSave) save.mutate();
          }}
        />
      </Suspense>
      <div className="flex shrink-0 flex-col gap-1.5 border-t border-foreground/[0.06] p-2.5">
        {problems.length ? (
          <ul className="max-h-32 overflow-auto rounded-md bg-destructive/10 px-2.5 py-1.5 font-mono text-[11.5px] text-destructive">
            {problems.slice(0, 8).map((problem) => (
              <li key={`${problem.file}:${problem.line}:${problem.message}`}>
                {problem.file ? `${problem.file}:${problem.line ?? 0}  ` : ""}
                {problem.message}
              </li>
            ))}
          </ul>
        ) : null}
        {conflicts.length ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-primary/10 px-2.5 py-1.5 text-[12px]">
            <p className="min-w-0">
              {t`A newer version changed the same files you edited: ${conflicts.join(", ")}. Your other changes are kept.`}
            </p>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => resolve(false)}>
                {t`Use newer version`}
              </Button>
              <Button size="sm" onClick={() => resolve(true)}>
                {t`Keep mine`}
              </Button>
            </div>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <p
            role="status"
            className={`min-w-0 truncate text-[12px] ${message?.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}
          >
            {message?.text ??
              (changed ? t`Unsaved changes` : t`Version ${files.data?.version ?? version}`)}
          </p>
          <div className="flex gap-1.5">
            {changed ? (
              <Button size="sm" variant="ghost" onClick={discard}>
                {t`Discard`}
              </Button>
            ) : null}
            <Button size="sm" disabled={!canSave} onClick={() => save.mutate()}>
              {save.isPending ? <Spinner /> : null}
              {t`Save & build`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
