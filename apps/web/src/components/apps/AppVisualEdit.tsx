import { useLingui } from "@lingui/react/macro";
import type { StyleGroupId, VisualEdit } from "@rakazo/app-kit/visual-edit";
import { applyVisualEdit, readElement, STYLE_GROUPS } from "@rakazo/app-kit/visual-edit";
import { Button, Spinner } from "@rakazo/ui-web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import type { AppPatch, AppPick } from "./AppFrame";

/** Swatches for the colour groups, drawn with the app's own theme tokens. */
const SWATCH: Record<string, string> = {
  "text-foreground": "hsl(var(--foreground))",
  "text-muted-foreground": "hsl(var(--muted-foreground))",
  "text-primary": "hsl(var(--primary))",
  "text-success": "hsl(142 71% 40%)",
  "text-warning": "hsl(38 92% 50%)",
  "text-destructive": "hsl(var(--destructive))",
  "bg-transparent": "transparent",
  "bg-card": "hsl(var(--card))",
  "bg-muted": "hsl(var(--muted))",
  "bg-primary/10": "hsl(var(--primary) / 0.12)",
  "bg-primary": "hsl(var(--primary))",
  "bg-success/10": "hsl(142 71% 40% / 0.12)",
  "bg-warning/10": "hsl(38 92% 50% / 0.14)",
  "bg-destructive/10": "hsl(var(--destructive) / 0.12)",
};

/** The short name of an option within its group: "text-2xl" reads as "2xl". */
function optionLabel(option: string): string {
  return option.replace(/^(text|font|bg|p|rounded|shadow)-/, "");
}

/**
 * Changes the words and look of one element the owner clicked, without the bot: the change shows
 * in the app at once and is saved as a new version (so History can undo it). What can't be done
 * here, such as text that comes from data, goes to the bot with the element named.
 */
export function AppVisualEdit({
  pageId,
  pick,
  onPatch,
  onAskBot,
  onClose,
}: {
  pageId: string;
  pick: AppPick;
  onPatch: (patch: AppPatch) => void;
  onAskBot: () => void;
  /** saved: a new version was made, so the app reloads on its own. */
  onClose: (saved: boolean) => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const files = useQuery({
    ...queries.apps.files.queryOptions({ input: { pageId } }),
    staleTime: 0,
  });
  const info = useMemo(
    () => (files.data ? readElement(files.data.files, pick.loc) : null),
    [files.data, pick.loc],
  );
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [styles, setStyles] = useState<VisualEdit["styles"]>({});
  const shown = useRef<Record<string, string>>({});
  const element = info && !("error" in info) ? info : null;

  useEffect(() => {
    if (!element) return;
    shown.current = Object.fromEntries(element.texts.map((text) => [text.id, text.value]));
  }, [element]);

  const changedTexts = Object.fromEntries(
    Object.entries(texts).filter(
      ([id, value]) => element?.texts.find((text) => text.id === id)?.value !== value,
    ),
  );
  const changed = Object.keys(changedTexts).length > 0 || Object.keys(styles ?? {}).length > 0;

  function show(nextTexts: Record<string, string>, nextStyles: VisualEdit["styles"] = {}) {
    const groups = STYLE_GROUPS.filter((group) => group.id in nextStyles);
    const swaps = Object.entries(nextTexts)
      .filter(([id, value]) => shown.current[id] !== undefined && shown.current[id] !== value)
      .map(([id, value]) => ({ from: shown.current[id]!, to: value }));
    for (const [id, value] of Object.entries(nextTexts)) shown.current[id] = value;
    onPatch({
      loc: pick.loc,
      remove: groups.flatMap((group) => [...group.options]),
      add: groups
        .map((group) => nextStyles[group.id])
        .filter((value): value is string => Boolean(value)),
      texts: swaps,
    });
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!files.data) throw new Error(t`The app's code is still loading.`);
      const result = applyVisualEdit(files.data.files, pick.loc, { texts: changedTexts, styles });
      if ("error" in result) throw new Error(result.error);
      const saved = await queries.apps.saveFiles.call({
        pageId,
        files: result.files,
        baseVersion: files.data.version,
      });
      if (saved.version === null) {
        throw new Error(saved.problems[0]?.message ?? t`That change didn't build.`);
      }
      return saved.version;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queries.apps.key() });
      void queryClient.invalidateQueries({ queryKey: queries.pages.get.key() });
      onClose(true);
    },
  });

  const title = element
    ? /^[a-z]/.test(element.name)
      ? `<${element.name}>`
      : element.name
    : pick.tag;

  return (
    <div
      role="dialog"
      aria-label={t`Edit this element`}
      className="pointer-events-auto flex max-h-[min(70vh,620px)] w-[min(340px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card text-[13px] shadow-2xl"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-foreground/[0.06] px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground">{title}</p>
          <p className="truncate text-[11px] text-muted-foreground">{pick.loc}</p>
        </div>
        <button
          type="button"
          aria-label={t`Close`}
          onClick={() => onClose(false)}
          className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.06]"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3.5 py-3">
        {files.isPending ? (
          <div className="grid place-items-center py-6">
            <Spinner />
          </div>
        ) : null}
        {files.isError ? (
          <p className="text-destructive">{t`The app's code couldn't be loaded.`}</p>
        ) : null}
        {info && "error" in info ? <p className="text-muted-foreground">{info.error}</p> : null}
        {element && element.texts.length === 0 && element.classes === null ? (
          <p className="text-muted-foreground">{t`This element is built from data or code, so ask the bot to change it.`}</p>
        ) : null}
        {element?.texts.map((text) => (
          <label key={text.id} className="block space-y-1">
            <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {text.label === "Text" ? t`Text` : text.label}
            </span>
            <textarea
              rows={text.value.length > 48 ? 3 : 1}
              value={texts[text.id] ?? text.value}
              onChange={(event) => {
                const next = { ...texts, [text.id]: event.target.value };
                setTexts(next);
                show(next, styles);
              }}
              className="w-full resize-none rounded-lg border border-foreground/[0.1] bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        ))}
        {element && element.texts.length === 0 && element.classes !== null ? (
          <p className="text-[12px] text-muted-foreground">{t`Its words come from data, so only its look can be changed here.`}</p>
        ) : null}
        {element?.classes === null && element.texts.length > 0 ? (
          <p className="text-[12px] text-muted-foreground">{t`Its look is set in code; ask the bot to change it.`}</p>
        ) : null}
        {element && element.classes !== null
          ? STYLE_GROUPS.map((group) => {
              const value =
                group.id in (styles ?? {}) ? styles?.[group.id] : element.styles[group.id];
              const choose = (option: string | null) => {
                const next = { ...styles, [group.id]: option };
                setStyles(next);
                show(texts, next);
              };
              const swatches = group.id === "color" || group.id === "background";
              return (
                <div key={group.id} className="space-y-1.5">
                  <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {groupLabel(group.id)}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    <Chip active={!value} onClick={() => choose(null)}>
                      {t`Default`}
                    </Chip>
                    {group.options.map((option) => (
                      <Chip
                        key={option}
                        active={value === option}
                        onClick={() => choose(option)}
                        title={option}
                      >
                        {swatches ? (
                          <span
                            aria-hidden="true"
                            className="block size-3.5 rounded-full border border-foreground/15"
                            style={{ background: SWATCH[option] }}
                          />
                        ) : (
                          optionLabel(option)
                        )}
                        {swatches ? <span className="sr-only">{option}</span> : null}
                      </Chip>
                    ))}
                  </div>
                </div>
              );
            })
          : null}
        {save.isError ? (
          <p role="alert" className="text-[12px] text-destructive">
            {save.error instanceof Error ? save.error.message : t`That change couldn't be saved.`}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-foreground/[0.06] px-3 py-2.5">
        <button
          type="button"
          onClick={onAskBot}
          className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] font-medium text-primary hover:bg-primary/10"
        >
          <MessageSquare className="size-3.5" />
          {t`Ask the bot`}
        </button>
        <span className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => onClose(false)}
          disabled={save.isPending}
        >
          {changed ? t`Discard` : t`Done`}
        </Button>
        <Button size="sm" onClick={() => save.mutate()} disabled={!changed || save.isPending}>
          {save.isPending ? <Spinner /> : t`Save`}
        </Button>
      </div>
    </div>
  );

  function groupLabel(id: StyleGroupId): string {
    switch (id) {
      case "size":
        return t`Text size`;
      case "weight":
        return t`Weight`;
      case "color":
        return t`Text colour`;
      case "background":
        return t`Background`;
      case "align":
        return t`Align`;
      case "padding":
        return t`Padding`;
      case "radius":
        return t`Corners`;
      case "shadow":
        return t`Shadow`;
    }
  }
}

function Chip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className="flex h-7 min-w-7 items-center justify-center gap-1 rounded-full border border-foreground/[0.08] px-2 text-[12px] text-foreground/80 hover:bg-foreground/[0.05] aria-pressed:border-primary/50 aria-pressed:bg-primary/12 aria-pressed:text-primary"
    >
      {children}
    </button>
  );
}
