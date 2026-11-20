import { Trans, useLingui } from "@lingui/react/macro";
import type { EvolveProjectOption } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@rakazo/ui-web";
import { Link2, Unlink, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSpaceQueries } from "../../../lib/query";
import { pill, StudioHint } from "../../studio/StudioFrame";
import type { PlanEvolveLink } from "./plan";

/**
 * Header control that opens the Evolve job picker. Pair with `EvolveJobLinkDialog` managed by the
 * studio so phones can open the same picker from More.
 */
export function EvolveJobLinkButton({
  link,
  disabled,
  onOpen,
  className,
}: {
  link: PlanEvolveLink | null;
  disabled?: boolean;
  onOpen: () => void;
  /** Extra classes on the header control (e.g. hide on phones when More carries the same action). */
  className?: string;
}) {
  const { t } = useLingui();
  const label = link
    ? link.name
      ? `${link.jobNumber} · ${link.name}`
      : link.jobNumber
    : t`Link Evolve job`;
  return (
    <StudioHint
      label={
        link
          ? t`Linked to Evolve job ${link.jobNumber}. Click to change or clear.`
          : t`Optionally link this plan to an Evolve project datasheet.`
      }
    >
      <button
        type="button"
        data-testid="planner-evolve-link"
        disabled={disabled}
        onClick={onOpen}
        className={`${pill} max-w-[220px] disabled:opacity-40 ${className ?? ""}`}
      >
        <Link2 className="size-4 shrink-0" strokeWidth={1.8} />
        <span className="truncate max-sm:sr-only">{label}</span>
      </button>
    </StudioHint>
  );
}

export function EvolveJobLinkDialog({
  open,
  current,
  onClose,
  onPick,
}: {
  open: boolean;
  current: PlanEvolveLink | null;
  onClose: () => void;
  onPick: (link: PlanEvolveLink | null) => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<EvolveProjectOption[]>([]);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => setTerm(search.trim()), 250);
    return () => window.clearTimeout(handle);
  }, [open, search]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setError(null);
    void queries.evolveReferences.projects
      .call({ search: term || undefined, page: 0 })
      .then(
        (page) => {
          if (!live) return;
          setProjects(page.projects ?? []);
          setLoading(false);
        },
        (err: unknown) => {
          if (!live) return;
          setProjects([]);
          setLoading(false);
          setError(err instanceof Error ? err.message : t`Couldn't load projects.`);
        },
      );
    return () => {
      live = false;
    };
  }, [open, term, queries, t]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="planner-evolve-dialog">
        <DialogHeader>
          <DialogTitle>
            <Trans>Link Evolve project</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              Store the job number on this plan so the assistant can pull that project's context
              while planning. Datasheets are not updated from the Gantt.
            </Trans>
          </DialogDescription>
        </DialogHeader>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t`Search projects or job numbers`}
          autoFocus
        />
        <div className="max-h-64 min-h-40 overflow-y-auto rounded-xl border border-border">
          {loading ? (
            <p className="p-4 text-[13px] text-muted-foreground">
              <Trans>Searching…</Trans>
            </p>
          ) : error ? (
            <p className="p-4 text-[13px] text-destructive">{error}</p>
          ) : projects.length === 0 ? (
            <p className="p-4 text-[13px] text-muted-foreground">
              <Trans>No projects matched.</Trans>
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {projects.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left hover:bg-muted/60"
                    onClick={() =>
                      onPick({
                        jobNumber: (project.jobNumber ?? project.name).trim() || project.id,
                        projectId: project.id,
                        name: project.name,
                      })
                    }
                  >
                    <span className="text-[14px] font-medium text-foreground">{project.name}</span>
                    {project.client ? (
                      <span className="text-[12px] text-muted-foreground">{project.client}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={!current}
            onClick={() => onPick(null)}
            data-testid="planner-evolve-clear"
          >
            <Unlink className="size-4" />
            <Trans>Clear link</Trans>
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            <X className="size-4" />
            <Trans>Cancel</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
