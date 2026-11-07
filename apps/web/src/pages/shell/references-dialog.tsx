import { useLingui } from "@lingui/react/macro";
import type {
  EvolvePersonOption,
  EvolveProjectOption,
  EvolveProjectPage,
  EvolveReferenceExemplar,
  EvolveReferencePerson,
  EvolveReferenceProject,
  EvolveReferences,
  EvolveReferenceTabs,
} from "@rakazo/contracts";
import {
  EVOLVE_REFERENCES_MAX_CONTEXT_CHARS,
  evolveReferencesContextChars,
} from "@rakazo/contracts";
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  toast,
} from "@rakazo/ui-web";
import { BookOpen, Loader2, Search, X } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";

/** The green Evolve calls `brand-green`. */
export const BRAND_GREEN_BG = "bg-success";
const BRAND_GREEN_TEXT = "text-success";
const BRAND_GREEN_BORDER = "border-success";
const SEARCH_DEBOUNCE_MS = 800;

type Mode = "projects" | "people" | "exemplars";

export type ReferencesLoaders = {
  projects: (input: { search: string; page: number }) => Promise<EvolveProjectPage>;
  people: () => Promise<{ people: EvolvePersonOption[] }>;
  exemplars: () => Promise<{ exemplars: EvolveReferenceExemplar[] }>;
};

function useLoaded<T>(load: (() => Promise<T>) | null, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({
    data: null,
    loading: false,
    error: null,
  });
  useEffect(() => {
    if (!load) return;
    let live = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    load().then(
      (data) => live && setState({ data, loading: false, error: null }),
      (error: unknown) =>
        live &&
        setState({
          data: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      live = false;
    };
  }, deps);
  return state;
}

function toReferenceProject(project: EvolveProjectOption): EvolveReferenceProject {
  return {
    id: project.id,
    name: project.name,
    client: project.client,
    value: project.value || "N/A",
    summary: project.description,
    ...(project.image ? { image: project.image } : {}),
  };
}

/** Evolve chat's References dialog: projects, people and exemplar responses as AI context. */
export function ReferencesDialog({
  open,
  onClose,
  selection,
  onSelectionChange,
  onAddReferences,
  adding,
  tabs,
  loaders,
}: {
  open: boolean;
  onClose: () => void;
  selection: EvolveReferences;
  onSelectionChange: (next: EvolveReferences) => void;
  onAddReferences: (references: EvolveReferences) => Promise<void>;
  adding: boolean;
  tabs: EvolveReferenceTabs;
  loaders: ReferencesLoaders;
}) {
  const { t } = useLingui();
  const enablePeople = tabs.people;
  const enableResponses = tabs.exemplars;
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [curPage, setCurPage] = useState(0);
  const [mode, setMode] = useState<Mode>("projects");
  const debounceTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(debounceTimer.current), []);

  const projectsState = useLoaded(
    open ? () => loaders.projects({ search: searchTerm, page: curPage }) : null,
    [open, searchTerm, curPage],
  );
  const peopleState = useLoaded(open && enablePeople ? loaders.people : null, [open, enablePeople]);
  const exemplarState = useLoaded(open && enableResponses ? loaders.exemplars : null, [
    open,
    enableResponses,
  ]);

  const selectedProjects = selection.projects;
  const selectedPeople = selection.people;
  const selectedExemplars = selection.exemplars;
  const setProjects = (projects: EvolveReferenceProject[]) =>
    onSelectionChange({ ...selection, projects });
  const setPeople = (people: EvolveReferencePerson[]) =>
    onSelectionChange({ ...selection, people });
  const setExemplars = (exemplars: EvolveReferenceExemplar[]) =>
    onSelectionChange({ ...selection, exemplars });

  const search = (value: string) => {
    window.clearTimeout(debounceTimer.current);
    setSearchTerm(value);
    setCurPage(0);
  };
  const handleSearchInputChange = (value: string) => {
    setSearchInput(value);
    window.clearTimeout(debounceTimer.current);
    debounceTimer.current = window.setTimeout(() => search(value), SEARCH_DEBOUNCE_MS);
  };
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") search(searchInput);
  };
  const clearFilters = () => {
    setSearchInput("");
    search("");
  };

  const term = searchTerm.toLowerCase();
  const apiProjects = projectsState.data?.projects ?? [];
  const filteredProjects = apiProjects.filter(
    (project) =>
      project.name.toLowerCase().includes(term) ||
      project.client.toLowerCase().includes(term) ||
      project.description.toLowerCase().includes(term),
  );
  const filteredPeople = (peopleState.data?.people ?? []).filter(
    (person) =>
      (person.name || "").toLowerCase().includes(term) ||
      (person.jobTitle || "").toLowerCase().includes(term),
  );
  const filteredExemplars = (exemplarState.data?.exemplars ?? []).filter(
    (ex) =>
      (ex.title || "").toLowerCase().includes(term) ||
      (ex.response_text || "").toLowerCase().includes(term) ||
      (ex.category || "").toLowerCase().includes(term) ||
      (ex.tender_type || "").toLowerCase().includes(term) ||
      (ex.sector || "").toLowerCase().includes(term) ||
      (ex.tags || []).some((tag) => tag.toLowerCase().includes(term)),
  );
  const nextPage = projectsState.data?.nextPage ?? null;
  const prevPage = projectsState.data?.prevPage ?? null;

  const toggleProject = (project: EvolveProjectOption, checked: boolean) => {
    if (checked) setProjects([...selectedProjects, toReferenceProject(project)]);
    else setProjects(selectedProjects.filter((p) => p.id !== project.id));
  };
  const setRole = (personId: string, role: string) =>
    setPeople(
      selectedPeople.map((person) => (person.id === personId ? { ...person, role } : person)),
    );

  const handleDeselectAll = () => {
    if (mode === "projects") setProjects([]);
    else if (mode === "people") setPeople([]);
    else setExemplars([]);
  };

  const modeCount =
    mode === "projects"
      ? selectedProjects.length
      : mode === "people"
        ? selectedPeople.length
        : selectedExemplars.length;
  const modeNoun =
    mode === "projects" ? t`projects` : mode === "people" ? t`people` : t`exemplar responses`;

  const totalChars = evolveReferencesContextChars(selection);
  const percentage = Math.min((totalChars / EVOLVE_REFERENCES_MAX_CONTEXT_CHARS) * 100, 100);
  const isNearLimit = percentage > 70;
  const isAtLimit = percentage > 90;
  const remaining = Math.round(100 - percentage);
  const hasSelection =
    selectedProjects.length > 0 || selectedPeople.length > 0 || selectedExemplars.length > 0;
  const peopleWithoutRoles = selectedPeople.filter((person) => !person.role?.trim());
  const hasValidationErrors = peopleWithoutRoles.length > 0;
  const statusColour = isAtLimit
    ? "text-red-600 dark:text-red-400"
    : isNearLimit
      ? "text-yellow-600 dark:text-yellow-400"
      : "text-muted-foreground";

  const tabColumns =
    enablePeople && enableResponses
      ? "grid-cols-3"
      : enablePeople || enableResponses
        ? "grid-cols-2"
        : "grid-cols-1";
  const removeButton =
    "ml-2 rounded p-1 opacity-60 transition hover:bg-accent hover:text-red-600 group-hover:opacity-100 dark:hover:text-red-400";
  const selectedRow = `group flex items-center justify-between rounded border ${BRAND_GREEN_BORDER} bg-green-50 px-2 py-1 transition dark:border-green-700 dark:bg-green-900/30`;
  const emptyState = "rounded-lg bg-muted/50 py-12 text-center";

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="flex max-h-[80vh] flex-col overflow-hidden sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{t`Select References`}</DialogTitle>
          <DialogDescription>
            {t`Choose projects, people, or responses to provide context for your AI conversation.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
          <div className="w-80 shrink-0 space-y-4 overflow-y-auto">
            <Card>
              <CardContent>
                <div className={`grid gap-2 ${tabColumns}`}>
                  <Button
                    variant={mode === "projects" ? "default" : "outline"}
                    onClick={() => setMode("projects")}
                  >
                    {t`Projects`}
                  </Button>
                  {enablePeople ? (
                    <Button
                      variant={mode === "people" ? "default" : "outline"}
                      onClick={() => setMode("people")}
                    >
                      {t`People`}
                    </Button>
                  ) : null}
                  {enableResponses ? (
                    <Button
                      variant={mode === "exemplars" ? "default" : "outline"}
                      onClick={() => setMode("exemplars")}
                    >
                      {t`Responses`}
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <h3 className="mb-4 text-lg font-semibold">{t`Search & Filter`}</h3>
                <div className="space-y-4">
                  <div className="relative">
                    <Search className="absolute top-2.5 left-2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder={t`Search...`}
                      value={searchInput}
                      onChange={(event) => handleSearchInputChange(event.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      className="pl-8"
                    />
                  </div>
                  <Button variant="outline" onClick={clearFilters} className="w-full">
                    {t`Clear Search`}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <h3 className="mb-4 text-lg font-semibold">{t`Selected References`}</h3>
                <div className={`text-3xl font-bold ${BRAND_GREEN_TEXT}`}>{modeCount}</div>
                <p className="text-sm text-muted-foreground">{t`${modeNoun} selected`}</p>

                {modeCount > 0 ? (
                  <div className="mt-4 max-h-64 space-y-1 overflow-y-auto pr-1">
                    {mode === "projects"
                      ? selectedProjects.map((p) => (
                          <div key={p.id} className={selectedRow}>
                            <span className="flex-1 truncate text-sm" title={p.name}>
                              {p.name}
                            </span>
                            <button
                              type="button"
                              aria-label={t`Remove ${p.name}`}
                              onClick={() =>
                                setProjects(selectedProjects.filter((x) => x.id !== p.id))
                              }
                              className={removeButton}
                            >
                              <X size={16} />
                            </button>
                          </div>
                        ))
                      : mode === "people"
                        ? selectedPeople.map((p) => {
                            const hasRole = Boolean(p.role?.trim());
                            return (
                              <div
                                key={p.id}
                                className={`group flex flex-col rounded px-2 py-2 transition ${
                                  hasRole
                                    ? `border ${BRAND_GREEN_BORDER} bg-green-50 dark:border-green-700 dark:bg-green-900/30`
                                    : "border border-red-500 bg-red-50 dark:border-red-700 dark:bg-red-900/30"
                                }`}
                              >
                                <div className="mb-2 flex items-center justify-between">
                                  <span className="flex-1 truncate text-sm" title={p.name}>
                                    {p.name}
                                  </span>
                                  <button
                                    type="button"
                                    aria-label={t`Remove ${p.name}`}
                                    onClick={() =>
                                      setPeople(selectedPeople.filter((x) => x.id !== p.id))
                                    }
                                    className={removeButton}
                                  >
                                    <X size={16} />
                                  </button>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Input
                                    value={p.role || ""}
                                    onChange={(event) => setRole(p.id, event.target.value)}
                                    placeholder={t`Enter role...`}
                                    className={`h-6 flex-1 text-xs ${hasRole ? "" : "border-red-300 focus:border-red-500"}`}
                                    title={
                                      hasRole
                                        ? undefined
                                        : t`Role is required for this person reference`
                                    }
                                  />
                                  {hasRole ? null : (
                                    <div className="flex items-center gap-1 text-xs font-medium text-red-500">
                                      <span>⚠</span>
                                      <span>{t`Role required`}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        : selectedExemplars.map((ex) => (
                            <div key={ex.id} className={selectedRow}>
                              <span
                                className="flex-1 truncate text-sm"
                                title={ex.title || ex.response_text}
                              >
                                {`${ex.title || "Exemplar"}: ${(ex.response_text || "").slice(0, 40)}`}
                              </span>
                              <button
                                type="button"
                                aria-label={t`Remove exemplar`}
                                onClick={() =>
                                  setExemplars(selectedExemplars.filter((x) => x.id !== ex.id))
                                }
                                className={removeButton}
                              >
                                <X size={16} />
                              </button>
                            </div>
                          ))}
                  </div>
                ) : null}

                <Button
                  variant="outline"
                  onClick={handleDeselectAll}
                  className="mt-4 w-full"
                  disabled={modeCount === 0}
                >
                  {t`Deselect All`}
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {mode === "projects" ? (
              projectsState.loading && !projectsState.data ? (
                <div className={emptyState}>
                  <p className="text-muted-foreground">{t`Loading projects...`}</p>
                </div>
              ) : projectsState.error ? (
                <div className={emptyState}>
                  <p className="text-red-600 dark:text-red-400">
                    {t`Error fetching projects: ${projectsState.error}`}
                  </p>
                </div>
              ) : filteredProjects.length === 0 ? (
                <div className={emptyState}>
                  <p className="text-muted-foreground">
                    {t`No projects match your filters. Try adjusting your criteria.`}
                  </p>
                  <Button variant="outline" onClick={clearFilters} className="mt-4">
                    {t`Clear Search`}
                  </Button>
                </div>
              ) : (
                <div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {filteredProjects.map((project) => {
                      const selected = selectedProjects.some((p) => p.id === project.id);
                      return (
                        <Card key={project.id} className="overflow-hidden pt-0 transition-all">
                          <div className="h-40 overflow-hidden">
                            <img
                              src={project.image}
                              alt={project.name}
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <CardContent>
                            <div className="flex items-start">
                              <div className="flex-1">
                                <h3 className="text-lg font-semibold">{project.name}</h3>
                                <p className="mb-2 text-sm text-muted-foreground">
                                  {project.client} | {project.year}
                                </p>
                              </div>
                              <Checkbox
                                checked={selected}
                                onCheckedChange={(checked) =>
                                  toggleProject(project, checked === true)
                                }
                                aria-label={project.name}
                                className="mt-1"
                              />
                            </div>
                            <p className="mb-3 line-clamp-3 text-sm text-foreground">
                              {project.description}
                            </p>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>

                  {prevPage !== null || nextPage !== null ? (
                    <div className="mt-6 flex justify-center gap-2">
                      <Button
                        variant="outline"
                        disabled={prevPage === null || projectsState.loading}
                        onClick={() => prevPage !== null && setCurPage(prevPage)}
                      >
                        {t`Previous`}
                      </Button>
                      <span className="py-2 text-sm">{t`Page ${curPage}`}</span>
                      <Button
                        variant="outline"
                        disabled={nextPage === null || projectsState.loading}
                        onClick={() => nextPage !== null && setCurPage(nextPage)}
                      >
                        {t`Next`}
                      </Button>
                    </div>
                  ) : null}
                </div>
              )
            ) : mode === "people" ? (
              <div>
                {peopleState.loading && !peopleState.data ? (
                  <div className={emptyState}>
                    <p className="text-muted-foreground">{t`Loading people...`}</p>
                  </div>
                ) : peopleState.error ? (
                  <div className={emptyState}>
                    <p className="text-red-600 dark:text-red-400">{peopleState.error}</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {filteredPeople.map((person) => {
                      const selected = selectedPeople.some((p) => p.id === person.id);
                      return (
                        <Card key={person.id} className="overflow-hidden transition-all">
                          <CardContent>
                            <div className="flex items-center">
                              <div className="flex min-w-0 flex-1 items-center gap-3">
                                {person.photo ? (
                                  <img
                                    src={person.photo}
                                    alt={person.name}
                                    loading="lazy"
                                    className="h-10 w-10 rounded-full object-cover"
                                  />
                                ) : (
                                  <div className="h-10 w-10 rounded-full bg-accent" />
                                )}
                                <div className="min-w-0">
                                  <h3 className="truncate text-base font-semibold">
                                    {person.name}
                                  </h3>
                                  <p className="mb-0 truncate text-sm text-muted-foreground">
                                    {person.jobTitle}
                                  </p>
                                </div>
                              </div>
                              <Checkbox
                                checked={selected}
                                aria-label={person.name}
                                onCheckedChange={(checked) => {
                                  if (checked === true) {
                                    const existing = selectedPeople.find((p) => p.id === person.id);
                                    setPeople([
                                      ...selectedPeople,
                                      {
                                        id: person.id,
                                        name: person.name,
                                        ...(person.photo ? { photo: person.photo } : {}),
                                        role: existing?.role || person.jobTitle || "",
                                      },
                                    ]);
                                  } else {
                                    setPeople(selectedPeople.filter((p) => p.id !== person.id));
                                  }
                                }}
                                className="ml-3"
                              />
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
                {peopleState.data && filteredPeople.length === 0 ? (
                  <div className={emptyState}>
                    <p className="text-muted-foreground">{t`No people match your search.`}</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div>
                {exemplarState.loading && !exemplarState.data ? (
                  <div className={emptyState}>
                    <p className="text-muted-foreground">{t`Loading exemplar responses...`}</p>
                  </div>
                ) : exemplarState.error ? (
                  <div className={emptyState}>
                    <p className="text-red-600 dark:text-red-400">{exemplarState.error}</p>
                  </div>
                ) : filteredExemplars.length === 0 ? (
                  <div className={emptyState}>
                    <p className="text-muted-foreground">
                      {t`No exemplar responses match your search.`}
                    </p>
                    <Button variant="outline" onClick={clearFilters} className="mt-4">
                      {t`Clear Search`}
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {filteredExemplars.map((ex) => {
                      const selected = selectedExemplars.some((se) => se.id === ex.id);
                      return (
                        <Card key={ex.id} className="overflow-hidden transition-all">
                          <CardContent>
                            <div className="flex items-start">
                              <div className="min-w-0 flex-1">
                                <h3 className="truncate text-base font-semibold">
                                  {ex.title || t`Exemplar response`}
                                </h3>
                                <p className="mb-3 line-clamp-3 text-sm text-muted-foreground">
                                  {ex.response_text}
                                </p>
                                <ExemplarBadges exemplar={ex} />
                                {ex.tags && ex.tags.length > 0 ? (
                                  <div className="mb-2 flex flex-wrap gap-1">
                                    {ex.tags.slice(0, 3).map((tag) => (
                                      <span
                                        key={tag}
                                        className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs text-foreground"
                                      >
                                        #{tag}
                                      </span>
                                    ))}
                                    {ex.tags.length > 3 ? (
                                      <span className="text-xs text-muted-foreground">
                                        {t`+${ex.tags.length - 3} more`}
                                      </span>
                                    ) : null}
                                  </div>
                                ) : null}
                                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                  {ex.quality_score ? (
                                    <span className="flex items-center gap-1">
                                      <span className="font-medium">{t`Quality:`}</span>
                                      <span className="font-bold text-green-600 dark:text-green-400">
                                        {ex.quality_score}/10
                                      </span>
                                    </span>
                                  ) : null}
                                  {ex.word_count ? (
                                    <span className="flex items-center gap-1">
                                      <span className="font-medium">{t`Words:`}</span>
                                      <span>{ex.word_count}</span>
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              <Checkbox
                                checked={selected}
                                aria-label={ex.title || t`Exemplar response`}
                                onCheckedChange={(checked) => {
                                  if (checked === true) setExemplars([...selectedExemplars, ex]);
                                  else
                                    setExemplars(selectedExemplars.filter((se) => se.id !== ex.id));
                                }}
                                className="mt-1 ml-3"
                              />
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {hasSelection ? (
          <div className="-mx-6 -mb-6 border-t bg-muted p-4">
            <div className="mb-3 rounded-lg border border-border bg-muted/50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{t`Context Window Usage`}</span>
                <span className={`text-xs font-medium ${statusColour}`}>
                  {totalChars.toLocaleString()} /{" "}
                  {EVOLVE_REFERENCES_MAX_CONTEXT_CHARS.toLocaleString()} {t`characters`}
                </span>
              </div>
              <div className="mb-2 h-2 w-full rounded-full bg-accent">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${
                    isAtLimit ? "bg-red-500" : isNearLimit ? "bg-yellow-500" : "bg-blue-500"
                  }`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
              <div className={`text-xs ${statusColour}`}>
                {isAtLimit ? (
                  <span className="font-medium">
                    {t`⚠️ Near context limit - consider removing some references`}
                  </span>
                ) : isNearLimit ? (
                  <span>{t`⚠️ Approaching context limit - ${remaining}% remaining`}</span>
                ) : (
                  <span>{t`✅ Good context usage - ${remaining}% remaining`}</span>
                )}
              </div>
            </div>

            <Button
              onClick={() => {
                if (hasValidationErrors) {
                  const names = peopleWithoutRoles.map((person) => person.name).join(", ");
                  toast.error(
                    t`Please add roles for the following people before adding references: ${names}. Roles are required for proper AI context.`,
                    { duration: 5000 },
                  );
                  return;
                }
                void onAddReferences(selection);
              }}
              disabled={adding}
              className={`h-11 w-full text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                hasValidationErrors
                  ? "border-red-500 bg-red-500 hover:bg-red-600"
                  : `${BRAND_GREEN_BG} hover:bg-success/90`
              }`}
            >
              {adding ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t`Processing References...`}
                </>
              ) : hasValidationErrors ? (
                <>
                  <X className="mr-2 h-4 w-4" />
                  {t`Complete Required Roles First`}
                </>
              ) : (
                <>
                  <BookOpen className="mr-2 h-4 w-4" />
                  {t`Add References as AI Context`}
                </>
              )}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Category (blue), tender type (green), sector (purple) and complexity, as Evolve shows them. */
export function ExemplarBadges({ exemplar: ex }: { exemplar: EvolveReferenceExemplar }) {
  const pill = "inline-flex items-center rounded-full px-2 py-1 text-xs font-medium";
  if (!ex.category && !ex.tender_type && !ex.sector && !ex.complexity_level) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {ex.category ? (
        <span className={`${pill} bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200`}>
          {ex.category}
        </span>
      ) : null}
      {ex.tender_type ? (
        <span
          className={`${pill} bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200`}
        >
          {ex.tender_type}
        </span>
      ) : null}
      {ex.sector ? (
        <span
          className={`${pill} bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200`}
        >
          {ex.sector}
        </span>
      ) : null}
      {ex.complexity_level ? (
        <span
          className={`${pill} ${
            ex.complexity_level === "high"
              ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
              : ex.complexity_level === "medium"
                ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                : "bg-muted text-foreground"
          }`}
        >
          {ex.complexity_level}
        </span>
      ) : null}
    </div>
  );
}
