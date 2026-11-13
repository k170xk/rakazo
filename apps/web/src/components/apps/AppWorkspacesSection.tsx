import { useLingui } from "@lingui/react/macro";
import type { AppWorkspaceSettingsInput } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSpaceQueries } from "../../lib/query";

const FIELD =
  "h-8 min-w-0 flex-1 rounded-lg border border-foreground/[0.1] bg-background px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Whether the app keeps one set of data or a separate one per project, bridge or site, who may
 * start one, and where entries made before that go.
 */
export function AppWorkspacesSection({ pageId }: { pageId: string }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const settings = useQuery(queries.apps.workspaces.queryOptions({ input: { pageId } }));
  const [on, setOn] = useState(false);
  const [label, setLabel] = useState("");
  const [create, setCreate] = useState<"anyone" | "owner">("anyone");
  const [fileInto, setFileInto] = useState("");
  const saved = settings.data;
  useEffect(() => {
    if (!saved) return;
    setOn(saved.label !== null);
    setLabel(saved.label ?? "");
    setCreate(saved.create);
  }, [saved]);
  const save = useMutation({
    mutationFn: (input: AppWorkspaceSettingsInput) =>
      queries.apps.setWorkspaces.call({ pageId, ...input }),
    onSuccess: () => {
      setFileInto("");
      void queryClient.invalidateQueries({ queryKey: queries.apps.key() });
    },
  });
  const name = label.trim() || t`Project`;
  const nextLabel = on ? name : null;
  const changed = saved !== undefined && (nextLabel !== saved.label || create !== saved.create);

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-medium text-foreground">{t`Separate data per project`}</h3>
      <p className="text-[12px] text-muted-foreground">
        {t`Each project, bridge or site keeps its own entries, seen only by the people added to it. You see them all.`}
      </p>
      <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-foreground">
        <input
          type="checkbox"
          className="accent-primary"
          checked={on}
          disabled={!saved || save.isPending}
          onChange={(event) => setOn(event.target.checked)}
        />
        {t`Keep separate data for each one`}
      </label>
      {on ? (
        <div className="flex flex-col gap-2 rounded-lg border border-foreground/[0.08] p-3">
          <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="shrink-0">{t`Each one is called a`}</span>
            <input
              value={label}
              maxLength={30}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t`Project, Bridge, Site`}
              aria-label={t`What each one is called`}
              className={FIELD}
            />
          </label>
          {(
            [
              [
                "anyone",
                t`Colleagues start their own`,
                t`Anyone at OCSC with the app can start one and lead it.`,
              ],
              ["owner", t`Only I start them`, t`You start each one and choose its leads.`],
            ] as const
          ).map(([value, title, detail]) => (
            <label key={value} className="flex cursor-pointer items-start gap-2.5">
              <input
                type="radio"
                name="app-workspace-create"
                className="mt-0.5 accent-primary"
                checked={create === value}
                onChange={() => setCreate(value)}
              />
              <span className="flex flex-col">
                <span className="text-[13px] text-foreground">{title}</span>
                <span className="text-[12px] text-muted-foreground">{detail}</span>
              </span>
            </label>
          ))}
        </div>
      ) : null}
      {changed ? (
        <div>
          <Button
            size="sm"
            disabled={save.isPending}
            onClick={() => save.mutate({ label: nextLabel, create })}
          >
            {t`Save`}
          </Button>
        </div>
      ) : null}
      {saved && saved.label !== null && saved.unfiled > 0 ? (
        <form
          className="flex flex-col gap-1.5 rounded-lg bg-foreground/[0.03] p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (fileInto.trim())
              save.mutate({ label: saved.label, create: saved.create, fileInto: fileInto.trim() });
          }}
        >
          <p className="text-[12px] text-muted-foreground">
            {saved.unfiled === 1
              ? t`1 earlier entry is only visible to you. Move it to:`
              : t`${saved.unfiled} earlier entries are only visible to you. Move them to:`}
          </p>
          <div className="flex gap-2">
            <input
              value={fileInto}
              maxLength={80}
              onChange={(event) => setFileInto(event.target.value)}
              placeholder={t`Name, new or existing`}
              aria-label={t`Where earlier entries go`}
              className={FIELD}
            />
            <Button
              size="sm"
              variant="outline"
              type="submit"
              disabled={!fileInto.trim() || save.isPending}
            >
              {t`Move`}
            </Button>
          </div>
        </form>
      ) : null}
      {save.isError ? (
        <p role="alert" className="text-[12px] text-destructive">
          {save.error instanceof Error ? save.error.message : t`That wasn't saved.`}
        </p>
      ) : null}
    </section>
  );
}
