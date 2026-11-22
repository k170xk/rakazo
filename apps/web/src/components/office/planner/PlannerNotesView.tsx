import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input, Textarea } from "@rakazo/ui-web";
import { Pin, Plus, StickyNote, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatRelativeTime } from "../../../lib/relative-time";
import { activePlanNotes, deletePlanNote, upsertPlanNote } from "./filters";
import type { PlanDocument } from "./plan";

export function PlannerNotesView({
  plan,
  readOnly,
  onCommit,
}: {
  plan: PlanDocument;
  readOnly: boolean;
  onCommit: (next: PlanDocument) => void;
}) {
  const { t } = useLingui();
  const notes = useMemo(() => activePlanNotes(plan), [plan]);
  const [selectedId, setSelectedId] = useState<string | null>(() => notes[0]?.id ?? null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);

  const selected = useMemo(
    () => notes.find((note) => note.id === selectedId) ?? notes[0] ?? null,
    [notes, selectedId],
  );

  useEffect(() => {
    if (!selected) {
      setTitle("");
      setContent("");
      setDirty(false);
      return;
    }
    setSelectedId(selected.id);
    setTitle(selected.title ?? "");
    setContent(selected.content ?? "");
    setDirty(false);
  }, [selected?.id, selected?.updatedAt]);

  const addNote = () => {
    const created = upsertPlanNote(plan, { title: t`New project note`, content: "" });
    onCommit(created.plan);
    setSelectedId(created.note.id);
  };

  const saveCurrent = () => {
    if (!selected || readOnly) return;
    const saved = upsertPlanNote(plan, {
      id: selected.id,
      title: title.trim() || t`Untitled note`,
      content,
      pinned: selected.pinned,
    });
    onCommit(saved.plan);
    setDirty(false);
  };

  const togglePin = (noteId: string) => {
    const target = notes.find((note) => note.id === noteId);
    if (!target || readOnly) return;
    const saved = upsertPlanNote(plan, {
      id: target.id,
      title: target.id === selected?.id ? title.trim() || target.title : target.title,
      content: target.id === selected?.id ? content : target.content,
      pinned: !target.pinned,
    });
    onCommit(saved.plan);
  };

  const remove = (noteId: string) => {
    if (readOnly) return;
    const next = deletePlanNote(plan, noteId);
    onCommit(next);
    if (selectedId === noteId) {
      const remaining = activePlanNotes(next);
      setSelectedId(remaining[0]?.id ?? null);
    }
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:flex-row"
      data-testid="planner-notes-view"
    >
      {/* Left list */}
      <aside className="flex max-h-[38%] shrink-0 flex-col border-b border-border bg-muted/25 md:max-h-none md:w-72 md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <StickyNote className="size-4 text-primary" strokeWidth={1.8} />
            <span className="text-[13px] font-semibold text-foreground">
              <Trans>Project notes</Trans>
            </span>
            <span className="rounded-full bg-foreground/[0.08] px-1.5 py-0 text-[11px] font-medium tabular-nums text-muted-foreground">
              {notes.length}
            </span>
          </div>
          {!readOnly ? (
            <Button
              type="button"
              size="sm"
              onClick={addNote}
              data-testid="planner-add-note"
              className="h-7 rounded-full px-2.5 text-[12px]"
            >
              <Plus className="mr-1 size-3.5" />
              <Trans>New</Trans>
            </Button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {notes.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-3 py-8 text-center">
              <p className="text-[12px] text-muted-foreground">
                <Trans>
                  Capture programme assumptions, site constraints, or meeting notes right inside this plan.
                </Trans>
              </p>
              {!readOnly ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addNote}
                  className="rounded-full text-[12px]"
                >
                  <Plus className="mr-1 size-3.5" />
                  <Trans>Create first note</Trans>
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {notes.map((note) => {
                const active = selected?.id === note.id;
                return (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => setSelectedId(note.id)}
                    className={`flex w-full flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                      active
                        ? "border-primary/40 bg-primary/10"
                        : "border-transparent hover:bg-foreground/[0.04]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-foreground">
                        {note.title || t`Untitled note`}
                      </span>
                      {note.pinned ? (
                        <Pin className="size-3 shrink-0 text-primary" aria-label={t`Pinned`} />
                      ) : null}
                    </div>
                    <span className="line-clamp-2 text-[11px] text-muted-foreground">
                      {note.content?.trim() || t`Empty note`}
                    </span>
                    {note.updatedAt ? (
                      <span className="text-[10px] text-muted-foreground/80">
                        {formatRelativeTime(note.updatedAt)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      {/* Right editor */}
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        {selected ? (
          <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Input
                value={title}
                readOnly={readOnly}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setDirty(true);
                }}
                onBlur={() => {
                  if (dirty) saveCurrent();
                }}
                placeholder={t`Note title`}
                className="min-w-[180px] flex-1 border-border text-[15px] font-semibold"
              />
              {!readOnly ? (
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant={selected.pinned ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => togglePin(selected.id)}
                    className="h-8 rounded-full px-3 text-[12px]"
                  >
                    <Pin className="mr-1 size-3.5" />
                    {selected.pinned ? <Trans>Pinned</Trans> : <Trans>Pin</Trans>}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!dirty}
                    onClick={saveCurrent}
                    className="h-8 rounded-full px-3 text-[12px]"
                  >
                    <Trans>Save note</Trans>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t`Delete note`}
                    onClick={() => remove(selected.id)}
                    className="rounded-full text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ) : null}
            </div>

            <Textarea
              value={content}
              readOnly={readOnly}
              onChange={(event) => {
                setContent(event.target.value);
                setDirty(true);
              }}
              onBlur={() => {
                if (dirty) saveCurrent();
              }}
              placeholder={t`Write assumptions, client constraints, inspection hold points, or meeting notes…`}
              className="min-h-[200px] flex-1 resize-none border-border bg-muted/20 p-3 text-[13px] leading-relaxed"
            />
          </div>
        ) : (
          <div className="grid flex-1 place-items-center text-center text-[13px] text-muted-foreground">
            <Trans>Select or create a note to view it here.</Trans>
          </div>
        )}
      </section>
    </div>
  );
}
