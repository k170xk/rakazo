import { useLingui } from "@lingui/react/macro";
import { Button, Spinner } from "@rakazo/ui-web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2 } from "lucide-react";
import { useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { errorCode } from "../../lib/user-error";

const FILE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,60}\.(tsx|ts|css|json)$/;

/** The app's source files, editable by hand; saving builds them and keeps a new version. */
export function AppCodePanel({ pageId, version }: { pageId: string; version: number }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const files = useQuery(queries.apps.files.queryOptions({ input: { pageId } }));
  const [drafts, setDrafts] = useState<Record<string, string> | null>(null);
  const [current, setCurrent] = useState("App.tsx");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [problems, setProblems] = useState<
    { file?: string; line?: number; column?: number; message: string }[]
  >([]);
  const loaded = files.data?.files;
  // Until this person edits, the files follow the newest version; edits on an older one are
  // refused on save rather than overwriting it.
  const shown = drafts ?? loaded ?? {};
  const names = Object.keys(shown).sort((a, b) =>
    a === "App.tsx" ? -1 : b === "App.tsx" ? 1 : a.localeCompare(b),
  );
  const changed = loaded
    ? names.some((name) => shown[name] !== loaded[name]) ||
      Object.keys(loaded).some((name) => !(name in shown))
    : false;
  const save = useMutation({
    mutationFn: () =>
      queries.apps.saveFiles.call({
        pageId,
        files: shown,
        baseVersion: files.data?.version ?? version,
      }),
    onSuccess: (result) => {
      setProblems(result.problems);
      if (result.version === null) {
        setMessage({ tone: "error", text: t`It didn't build, so nothing was saved.` });
        return;
      }
      setMessage({ tone: "ok", text: t`Saved as version ${result.version}.` });
      setDrafts(null);
      void queryClient.invalidateQueries({ queryKey: queries.apps.key() });
      void queryClient.invalidateQueries({ queryKey: queries.pages.get.key() });
    },
    onError: (error) =>
      setMessage({
        tone: "error",
        text:
          errorCode(error) === "CONFLICT"
            ? t`Someone saved a newer version. Reload the code to see it.`
            : error instanceof Error
              ? error.message
              : t`Couldn't save.`,
      }),
  });

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
            {loaded && shown[name] !== loaded[name] ? (
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
            setDrafts({ ...shown, [name]: "" });
            setCurrent(name);
          }}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
        >
          <FilePlus2 className="size-4" />
        </button>
      </div>
      <textarea
        aria-label={current}
        spellCheck={false}
        value={shown[current] ?? ""}
        onChange={(event) => setDrafts({ ...shown, [current]: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Tab" && !event.shiftKey) {
            event.preventDefault();
            const area = event.currentTarget;
            const { selectionStart: start, selectionEnd: end, value } = area;
            const next = `${value.slice(0, start)}  ${value.slice(end)}`;
            setDrafts({ ...shown, [current]: next });
            requestAnimationFrame(() => area.setSelectionRange(start + 2, start + 2));
          }
          if ((event.metaKey || event.ctrlKey) && event.key === "s") {
            event.preventDefault();
            if (changed && !save.isPending) save.mutate();
          }
        }}
        className="min-h-0 flex-1 resize-none bg-background p-3 font-mono text-[12.5px] leading-[1.55] text-foreground outline-none"
      />
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
              <Button size="sm" variant="ghost" onClick={() => setDrafts(null)}>
                {t`Discard`}
              </Button>
            ) : null}
            <Button size="sm" disabled={!changed || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Spinner /> : null}
              {t`Save & build`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
