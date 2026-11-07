import { useLingui } from "@lingui/react/macro";
import type {
  EvolveReferences,
  EvolveReferenceTabs,
  MessageBlock,
  ThreadMessage,
} from "@rakazo/contracts";
import { hasEvolveReferences } from "@rakazo/contracts";
import { newClientId } from "@rakazo/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  toast,
} from "@rakazo/ui-web";
import { Tooltip, TooltipContent, TooltipTrigger } from "@rakazo/ui-web/components/ui/tooltip";
import { BookOpen } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { createSpaceRpc } from "../../lib/rpc";
import type { ReferencesLoaders } from "./references-dialog";
import { BRAND_GREEN_BG, ReferencesDialog } from "./references-dialog";

type ReferencesBlock = Extract<MessageBlock, { kind: "evolve_references" }>;

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return items.filter((item, index) => items.findIndex((other) => other.id === item.id) === index);
}

/** One entry per person, keeping the latest: a re-added person carries their new role. */
function latestPeople(people: EvolveReferences["people"]): EvolveReferences["people"] {
  return uniqueById([...people].reverse()).reverse();
}

const personKey = (person: EvolveReferences["people"][number]) =>
  `${person.id}\u0000${person.role?.trim() ?? ""}`;

/** Everything already added in this chat, as Evolve rebuilds it from earlier reference messages. */
export function submittedEvolveReferences(messages: readonly ThreadMessage[]): EvolveReferences {
  const blocks = messages.flatMap((message) =>
    message.blocks.filter((block): block is ReferencesBlock => block.kind === "evolve_references"),
  );
  return {
    projects: uniqueById(blocks.flatMap((block) => block.projects)),
    people: latestPeople(blocks.flatMap((block) => block.people)),
    exemplars: uniqueById(blocks.flatMap((block) => block.exemplars)),
  };
}

/**
 * Only what has not been sent yet, as Evolve's submittedReferenceIds filter, except that a
 * person whose role changed is sent again so the model gets the new role.
 */
export function unsentEvolveReferences(
  selection: EvolveReferences,
  submitted: EvolveReferences,
): EvolveReferences {
  const sent = new Set([
    ...submitted.projects.map((p) => p.id),
    ...submitted.people.map(personKey),
    ...submitted.exemplars.map((e) => e.id),
  ]);
  return {
    projects: selection.projects.filter((p) => !sent.has(p.id)),
    people: selection.people
      .filter((p) => !sent.has(personKey(p)))
      .map(({ cv: _cv, ...person }) => person),
    exemplars: selection.exemplars.filter((e) => !sent.has(e.id)),
  };
}

function mergeReferences(a: EvolveReferences, b: EvolveReferences): EvolveReferences {
  return {
    projects: uniqueById([...a.projects, ...b.projects]),
    people: latestPeople([...a.people, ...b.people]),
    exemplars: uniqueById([...a.exemplars, ...b.exemplars]),
  };
}

/** Evolve chat's BookOpen button: a popover of chosen references and the References dialog. */
export function EvolveReferencesButton({
  messages,
  tabs,
  loaders,
  disabled,
  onSend,
}: {
  messages: readonly ThreadMessage[];
  tabs: EvolveReferenceTabs;
  loaders: ReferencesLoaders;
  disabled?: boolean;
  onSend: (references: EvolveReferences) => Promise<void>;
}) {
  const { t } = useLingui();
  const submitted = useMemo(() => submittedEvolveReferences(messages), [messages]);
  const [selection, setSelection] = useState<EvolveReferences>(submitted);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  // References sent from another tab, or loaded with older messages, join the selection.
  useEffect(() => setSelection((current) => mergeReferences(submitted, current)), [submitted]);

  const count = selection.projects.length + selection.people.length + selection.exemplars.length;

  async function addReferences(references: EvolveReferences) {
    const unsent = unsentEvolveReferences(references, submitted);
    if (!hasEvolveReferences(unsent)) {
      setDialogOpen(false);
      return;
    }
    setAdding(true);
    toast.info(t`Processing references and sending to AI...`, { duration: 2000 });
    try {
      await onSend(unsent);
      setSelection(mergeReferences(submitted, references));
      setDialogOpen(false);
      toast.success(t`References successfully added as AI context!`, { duration: 3000 });
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t`Failed to add references. Please try again.`,
      );
    } finally {
      setAdding(false);
    }
  }

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={t`Add Evolve References (Projects & More)`}
                    disabled={disabled}
                    className={`relative size-8 shrink-0 rounded-full ${count > 0 ? "ring-2 ring-success" : ""}`}
                  />
                }
              />
            }
          >
            <BookOpen className="h-4 w-4" />
            {count > 0 ? (
              <span
                className={`absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full ${BRAND_GREEN_BG} text-xs font-bold text-white`}
              >
                {count}
              </span>
            ) : null}
          </TooltipTrigger>
          <TooltipContent>{t`Add Evolve References (Projects & More)`}</TooltipContent>
        </Tooltip>
        <PopoverContent className="w-80" align="end">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">{t`References`}</h4>
              <Button
                variant="outline"
                size="xs"
                onClick={() => {
                  setPopoverOpen(false);
                  setDialogOpen(true);
                }}
              >
                {selection.projects.length > 0 ? t`Edit References` : t`Add References`}
              </Button>
            </div>
            {count === 0 ? (
              <div className="py-6 text-center text-muted-foreground">
                <BookOpen className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm">{t`No references selected`}</p>
                <p className="text-xs">{t`Click "Add References" to select projects`}</p>
              </div>
            ) : (
              <div className="max-h-60 space-y-2 overflow-y-auto">
                {selection.projects.map((project) => (
                  <div key={`proj-${project.id}`} className="rounded-lg border bg-muted p-3">
                    <div className="flex items-center gap-3">
                      {project.image ? (
                        <img
                          src={project.image}
                          alt={project.name}
                          loading="lazy"
                          decoding="async"
                          className="h-8 w-8 rounded-full object-cover"
                        />
                      ) : null}
                      <div className="text-sm font-medium">{project.name}</div>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      <span className="font-medium">{t`Client:`}</span> {project.client}
                      {project.value ? (
                        <>
                          <span className="mx-2">•</span>
                          <span className="font-medium">{t`Value:`}</span> {project.value}
                        </>
                      ) : null}
                    </div>
                    {project.summary ? (
                      <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                        {project.summary}
                      </div>
                    ) : null}
                  </div>
                ))}
                {selection.people.map((person) => (
                  <div key={`person-${person.id}`} className="rounded-lg border bg-muted p-3">
                    <div className="flex items-center gap-3">
                      {person.photo ? (
                        <img
                          src={person.photo}
                          alt={person.name}
                          loading="lazy"
                          decoding="async"
                          className="h-8 w-8 rounded-full object-cover"
                        />
                      ) : null}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{person.name}</div>
                        {person.role ? (
                          <div className="truncate text-xs text-muted-foreground">
                            {person.role}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {person.role?.trim() ? t`Added as Role: ${person.role}` : t`Person reference`}
                    </div>
                  </div>
                ))}
                {selection.exemplars.map((ex) => (
                  <div key={`ex-${ex.id}`} className="rounded-lg border bg-muted p-3">
                    <div className="truncate text-sm font-medium">
                      {ex.title || t`Exemplar response`}
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {ex.response_text}
                    </div>
                    {ex.category || ex.tender_type || ex.sector ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {ex.category ? (
                          <span className="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-200">
                            {ex.category}
                          </span>
                        ) : null}
                        {ex.tender_type ? (
                          <span className="inline-flex items-center rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-200">
                            {ex.tender_type}
                          </span>
                        ) : null}
                        {ex.sector ? (
                          <span className="inline-flex items-center rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700 dark:bg-purple-900 dark:text-purple-200">
                            {ex.sector}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <ReferencesDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        selection={selection}
        onSelectionChange={setSelection}
        onAddReferences={addReferences}
        adding={adding}
        tabs={tabs}
        loaders={loaders}
      />
    </>
  );
}

/** Evolve sends a placeholder picture for projects without photos; that is no photo. */
function realImage(url: string | undefined): string | undefined {
  return url && !url.startsWith("https://placehold.co/") ? url : undefined;
}

/** An image that gives way to `fallback` (or nothing) when it fails to load. */
function FallbackImage({
  src,
  alt,
  className,
  fallback = null,
}: {
  src: string;
  alt: string;
  className: string;
  fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

type OpenReference =
  | { kind: "project"; item: ReferencesBlock["projects"][number] }
  | { kind: "person"; item: ReferencesBlock["people"][number] }
  | { kind: "exemplar"; item: ReferencesBlock["exemplars"][number] };

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value?.trim()) return null;
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <p className="whitespace-pre-wrap text-sm" dir="auto">
        {value}
      </p>
    </div>
  );
}

/** Exactly what one reference sent to the AI: a project's datasheet details, a person's CV. */
function ReferenceDetailDialog({
  open,
  onClose,
}: {
  open: OpenReference | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const project = open?.kind === "project" ? open.item : null;
  const person = open?.kind === "person" ? open.item : null;
  const exemplar = open?.kind === "exemplar" ? open.item : null;
  const cover = realImage(project?.image);
  return (
    <Dialog open={open !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {cover ? (
          <FallbackImage src={cover} alt="" className="h-48 w-full shrink-0 object-cover" />
        ) : null}
        <DialogHeader className="shrink-0 px-6 pt-5 pb-3">
          <div className="flex items-center gap-3">
            {person?.photo ? (
              <FallbackImage
                src={person.photo}
                alt=""
                className="size-12 shrink-0 rounded-full object-cover"
              />
            ) : null}
            <div className="min-w-0">
              <DialogTitle className="truncate">
                {project?.name ??
                  person?.name ??
                  (exemplar?.title || exemplar?.response_title || t`Exemplar response`)}
              </DialogTitle>
              <DialogDescription>
                {project
                  ? t`Project reference, as sent to the AI`
                  : person
                    ? t`Person reference, as sent to the AI`
                    : t`Exemplar response, as sent to the AI`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6">
          {project ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <DetailRow label={t`Client`} value={project.client} />
                <DetailRow label={t`Value`} value={project.value} />
              </div>
              <DetailRow label={t`Summary`} value={project.summary} />
            </>
          ) : null}
          {person ? (
            <>
              {person.role ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
                  <div className="text-xs font-medium text-muted-foreground">{t`Role on this work`}</div>
                  <p className="text-sm font-medium" dir="auto">
                    {person.role}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t`This role overrides any role or job title in their CV.`}
                  </p>
                </div>
              ) : null}
              {person.cv ? (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">{t`CV`}</div>
                  <div
                    className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm"
                    dir="auto"
                  >
                    {person.cv.split("\n").map((line, index) =>
                      /^[^\s-][^:]{0,60}:$/.test(line.trim()) ? (
                        <div key={index} className="mt-3 font-semibold first:mt-0">
                          {line.trim().slice(0, -1)}
                        </div>
                      ) : (
                        <div key={index}>{line || "\u00a0"}</div>
                      ),
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t`No CV was sent for this person: only their name and role.`}
                </p>
              )}
            </>
          ) : null}
          {exemplar ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <DetailRow label={t`Category`} value={exemplar.category} />
                <DetailRow label={t`Sector`} value={exemplar.sector} />
              </div>
              <DetailRow label={t`Response`} value={exemplar.response_text} />
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Evolve's "Added References:" list under a references message; each opens what it sent. */
export function EvolveReferencesChips({ block }: { block: ReferencesBlock }) {
  const { t } = useLingui();
  const [open, setOpen] = useState<OpenReference | null>(null);
  const row =
    "flex w-full items-center gap-2 rounded border p-2 text-left text-xs transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3" data-testid="evolve-references">
      <div className="text-xs font-medium opacity-80">{t`Added References:`}</div>
      <div className="space-y-1">
        {block.projects.map((project) => {
          const cover = realImage(project.image);
          const show = () => setOpen({ kind: "project", item: project });
          return cover ? (
            <button
              type="button"
              key={`project-${project.id}`}
              onClick={show}
              className="block w-full overflow-hidden rounded border border-green-200 bg-green-50 text-left text-xs transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-green-800 dark:bg-green-900/20"
            >
              <FallbackImage src={cover} alt={project.name} className="h-28 w-full object-cover" />
              <div className="flex items-center gap-2 p-2">
                <span className="flex-1 truncate font-medium">{project.name}</span>
                <span className="text-green-600 opacity-70 dark:text-green-400">{t`Project`}</span>
              </div>
            </button>
          ) : (
            <button
              type="button"
              key={`project-${project.id}`}
              onClick={show}
              className={`${row} border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20`}
            >
              <div className="text-green-600 dark:text-green-400">📋</div>
              <span className="flex-1 truncate font-medium">{project.name}</span>
              <span className="text-green-600 opacity-70 dark:text-green-400">{t`Project`}</span>
            </button>
          );
        })}
        {block.people.map((person) => (
          <button
            type="button"
            key={`person-${person.id}`}
            onClick={() => setOpen({ kind: "person", item: person })}
            className={`${row} border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20`}
          >
            {person.photo ? (
              <FallbackImage
                src={person.photo}
                alt={person.name}
                className="size-7 shrink-0 rounded-full object-cover"
                fallback={<div className="text-blue-600 dark:text-blue-400">👤</div>}
              />
            ) : (
              <div className="text-blue-600 dark:text-blue-400">👤</div>
            )}
            <span className="flex-1 truncate font-medium">
              {person.name}
              {person.role ? (
                <span className="font-normal text-muted-foreground"> · {person.role}</span>
              ) : null}
            </span>
            <span className="text-blue-600 opacity-70 dark:text-blue-400">{t`Person`}</span>
          </button>
        ))}
        {block.exemplars.map((ex) => (
          <button
            type="button"
            key={`exemplar-${ex.id}`}
            onClick={() => setOpen({ kind: "exemplar", item: ex })}
            className={`${row} border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-900/20`}
          >
            <div className="text-purple-600 dark:text-purple-400">📝</div>
            <span className="flex-1 truncate font-medium">
              {ex.title || ex.response_title || t`Exemplar`}
            </span>
            <span className="text-purple-600 opacity-70 dark:text-purple-400">{t`Exemplar`}</span>
          </button>
        ))}
      </div>
      <ReferenceDetailDialog open={open} onClose={() => setOpen(null)} />
    </div>
  );
}

type SpaceRpc = ReturnType<typeof createSpaceRpc>;

/** The References button for one bot's chat; hidden when this server is not linked to Evolve. */
export function EvolveReferencesAction({
  rpc,
  botId,
  messages,
  disabled,
  onSent,
}: {
  rpc: SpaceRpc;
  botId: string;
  messages: readonly ThreadMessage[];
  disabled?: boolean;
  onSent: () => Promise<unknown>;
}) {
  const [tabs, setTabs] = useState<EvolveReferenceTabs | null>(null);
  useEffect(() => {
    let live = true;
    setTabs(null);
    rpc.evolveReferences.tabs({ botId }).then(
      (next) => live && setTabs(next),
      () => live && setTabs(null),
    );
    return () => {
      live = false;
    };
  }, [rpc, botId]);
  const loaders = useMemo<ReferencesLoaders>(
    () => ({
      projects: (input) => rpc.evolveReferences.projects(input),
      people: () => rpc.evolveReferences.people(),
      exemplars: () => rpc.evolveReferences.exemplars(),
    }),
    [rpc],
  );
  if (!tabs?.available) return null;
  return (
    <EvolveReferencesButton
      messages={messages}
      tabs={tabs}
      loaders={loaders}
      disabled={disabled}
      onSend={async (evolveReferences) => {
        await rpc.threads.send({ botId, evolveReferences, clientNonce: newClientId() });
        await onSent();
      }}
    />
  );
}
