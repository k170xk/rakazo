import { Trans, useLingui } from "@lingui/react/macro";
import type { LibraryAiAccess, LibraryDocument } from "@rakazo/contracts";
import { Button, Input, NativeSelect, NativeSelectOption, Spinner, toast } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

type Filter = "all" | "word" | LibraryAiAccess;

/** Every word must appear somewhere in the title, file name or folder, in any order. */
function matches(document: LibraryDocument, query: string) {
  const text = [document.title, document.fileName, document.folder].join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}

/** What AI assistants may do with each Evolve Document Library item. */
export function DocumentLibrarySection() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const library = useQuery(queries.companyAdmin.documentLibrary.list.queryOptions());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<string | null>(null);

  const levels: Record<LibraryAiAccess, string> = {
    read_only: t`Read only`,
    template: t`Template`,
    hidden: t`Hidden from AI`,
  };
  const filters: Record<Filter, string> = {
    all: t`All documents`,
    word: t`Word files`,
    template: t`Templates`,
    read_only: t`Read only`,
    hidden: t`Hidden from AI`,
  };

  const documents = library.data?.documents ?? [];
  const defaultId = library.data?.defaultTemplateId ?? null;
  const templates = documents.filter(
    (document) => document.aiAccess === "template" && document.canBeTemplate,
  );
  const defaultDocument = documents.find((document) => document.id === defaultId);
  const defaultLapsed = Boolean(defaultId) && !templates.some((t) => t.id === defaultId);
  const shown = documents.filter(
    (document) =>
      (filter === "all" ||
        (filter === "word" ? document.canBeTemplate : document.aiAccess === filter)) &&
      matches(document, search),
  );
  const count = (access: LibraryAiAccess) =>
    documents.filter((document) => document.aiAccess === access).length;

  async function chooseDefault(id: string | null) {
    setBusy("default");
    try {
      const saved = await rpc.companyAdmin.documentLibrary.setDefaultTemplate({ id });
      queryClient.setQueryData(queries.companyAdmin.documentLibrary.list.queryKey(), (current) =>
        current ? { ...current, defaultTemplateId: saved.defaultTemplateId } : current,
      );
      toast.success(t`Default Word template saved`);
    } catch (err) {
      toast.error(errorText(err, t`Could not change the default Word template`));
    } finally {
      setBusy(null);
    }
  }

  async function save(document: LibraryDocument, aiAccess: LibraryAiAccess) {
    setBusy(document.id);
    try {
      await rpc.companyAdmin.documentLibrary.setAccess({ id: document.id, aiAccess });
      queryClient.setQueryData(queries.companyAdmin.documentLibrary.list.queryKey(), (current) =>
        current
          ? {
              ...current,
              documents: current.documents.map((item) =>
                item.id === document.id ? { ...item, aiAccess } : item,
              ),
            }
          : current,
      );
      toast.success(t`${document.title} is now ${levels[aiAccess].toLowerCase()}`);
    } catch (err) {
      toast.error(errorText(err, t`Could not change AI access`));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4" data-testid="company-document-library">
      <div>
        <h2 className="text-base font-medium">
          <Trans>Document library</Trans>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <Trans>
            Choose what assistants may do with each document in Evolve's Document Library. Read only
            lets them search and quote it. Template lets them fill in a copy of a Word file. Hidden
            keeps it out of every answer. Changes apply straight away and are saved in Evolve.
          </Trans>
        </p>
      </div>

      {library.isPending ? (
        <div className="grid place-items-center py-8">
          <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
        </div>
      ) : library.isError ? (
        <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
          {errorText(library.error, t`Couldn't load the Document Library`)}
          <Button variant="outline" size="sm" onClick={() => void library.refetch()}>
            <Trans>Retry</Trans>
          </Button>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2 text-sm">
            {(["template", "read_only", "hidden"] as const).map((access) => (
              <div key={access} className="rounded-xl border border-border px-4 py-3">
                <dt className="text-[12.5px] text-muted-foreground">{levels[access]}</dt>
                <dd className="mt-1 text-[18px] font-medium tabular-nums">{count(access)}</dd>
              </div>
            ))}
          </dl>

          <div className="space-y-2 rounded-xl border border-border px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="library-default-template" className="flex-1 text-sm font-medium">
                <Trans>Default Word template</Trans>
              </label>
              <NativeSelect
                id="library-default-template"
                value={defaultId ?? ""}
                disabled={busy !== null}
                onChange={(event) => void chooseDefault(event.target.value || null)}
              >
                <NativeSelectOption value="">{t`Built-in OCSC report`}</NativeSelectOption>
                {defaultLapsed && defaultDocument ? (
                  <NativeSelectOption value={defaultDocument.id} disabled>
                    {defaultDocument.title}
                  </NativeSelectOption>
                ) : null}
                {templates.map((document) => (
                  <NativeSelectOption key={document.id} value={document.id}>
                    {document.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <p className="text-[13px] text-muted-foreground">
              {defaultLapsed ? (
                <Trans>
                  The chosen document is no longer a template, so new Word documents use the
                  built-in OCSC report until you choose another.
                </Trans>
              ) : (
                <Trans>
                  New Word documents start from this unless the person asks for another template. A
                  Library template keeps the OCSC report's prompts, such as asking which office it
                  is from. If Evolve cannot be reached, the built-in copy is used.
                </Trans>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              className="min-w-48 flex-1"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t`Find a document`}
              aria-label={t`Find a document`}
            />
            <NativeSelect
              aria-label={t`Show`}
              value={filter}
              onChange={(event) => setFilter(event.target.value as Filter)}
            >
              {(Object.keys(filters) as Filter[]).map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {filters[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          {shown.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              <Trans>No documents match.</Trans>
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {shown.map((document) => {
                const id = `library-ai-${document.id}`;
                return (
                  <li key={document.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <label htmlFor={id} className="min-w-48 flex-1 cursor-pointer">
                      <span className="block truncate text-sm font-medium">
                        {document.title}
                        {document.id === defaultId ? (
                          <span className="ms-2 rounded-md bg-muted px-1.5 py-0.5 text-[11.5px] font-normal text-muted-foreground">
                            <Trans>Default</Trans>
                          </span>
                        ) : null}
                      </span>
                      <span className="block truncate text-[13px] text-muted-foreground">
                        {[document.folder, document.fileName].filter(Boolean).join(" · ")}
                        {document.hasInstructions ? (
                          <>
                            {" · "}
                            <Trans>Has AI instructions</Trans>
                          </>
                        ) : null}
                      </span>
                    </label>
                    <NativeSelect
                      id={id}
                      value={document.aiAccess}
                      disabled={busy !== null}
                      onChange={(event) =>
                        void save(document, event.target.value as LibraryAiAccess)
                      }
                    >
                      {(Object.keys(levels) as LibraryAiAccess[]).map((access) => (
                        <NativeSelectOption
                          key={access}
                          value={access}
                          disabled={access === "template" && !document.canBeTemplate}
                        >
                          {levels[access]}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
