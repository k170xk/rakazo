import { Trans, useLingui } from "@lingui/react/macro";
import type { EvolveToolAccess, EvolveToolCatalogueEntry } from "@rakazo/contracts";
import { cn, Input, Spinner } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  CalendarClock,
  ChevronDown,
  ClipboardList,
  FolderKanban,
  GraduationCap,
  ImageIcon,
  Lock,
  MapPin,
  MessageSquareText,
  Search,
  ShieldCheck,
  UserRound,
  UsersRound,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useSpaceQueries } from "../../lib/query";

type GroupStory = { icon: LucideIcon; tagline: string; tryAsking: string };

function useGroupStories(): Record<string, GroupStory> {
  const { t } = useLingui();
  return {
    Projects: {
      icon: FolderKanban,
      tagline: t`Find jobs and read a project's datasheet, team, deadlines and comments.`,
      tryAsking: t`What's the status of C1078 and who is on the team?`,
    },
    Deadlines: {
      icon: CalendarClock,
      tagline: t`Add and update a project's deadlines, as on Project Tracker.`,
      tryAsking: t`Add a hard deadline for the planning submission on C1078 next Friday`,
    },
    "Work packages": {
      icon: ClipboardList,
      tagline: t`Find, add, update and delete work packages on the Project Tracker.`,
      tryAsking: t`Show my overdue work packages and mark the drainage one 50% done`,
    },
    "Project comments": {
      icon: MessageSquareText,
      tagline: t`Add, reword and delete your own project comments, with their category.`,
      tryAsking: t`Add a Site comment to C1078: foundations poured today`,
    },
    "Design Teams": {
      icon: UsersRound,
      tagline: t`Join or leave a project's Design Team in one of its roles.`,
      tryAsking: t`Add me to C1078's Design Team as Civil Engineer`,
    },
    "People and CVs": {
      icon: UserRound,
      tagline: t`Search staff by name, skill, sector or experience.`,
      tryAsking: t`Who has bridge inspection experience in the Dublin office?`,
    },
    "Document Library": {
      icon: BookOpen,
      tagline: t`Search the Document Library's titles and the text inside its documents.`,
      tryAsking: t`Find our standard drainage design statement template`,
    },
    "Learning Centre": {
      icon: GraduationCap,
      tagline: t`Find clinics, then start one, watch its videos and pass its quizzes on a card.`,
      tryAsking: t`Find me a clinic on CDM and start it`,
    },
    "Site visits": {
      icon: MapPin,
      tagline: t`Check out to a site with a buddy and return time, and check back in.`,
      tryAsking: t`Check me out to the Naas site for C1078 with Mary as buddy until 4pm`,
    },
    "Media and documents": {
      icon: ImageIcon,
      tagline: t`Images, infographics, charts, stock media, voiceovers and web search.`,
      tryAsking: t`Make an infographic of our project stages`,
    },
  };
}

const TITLES: Record<string, string> = {
  search_project_datasheets: "Search projects",
  get_project_details: "Project details",
  find_tracker_projects: "Project Tracker projects",
  add_project_deadline: "Add a deadline",
  update_project_deadline: "Update a deadline",
  find_work_packages: "Find work packages",
  add_work_package: "Add a work package",
  update_work_package: "Update a work package",
  delete_work_package: "Delete a work package",
  add_project_comment: "Add a project comment",
  update_project_comment: "Change a project comment",
  delete_project_comment: "Delete a project comment",
  join_project_team: "Join a Design Team",
  leave_project_team: "Leave a Design Team",
  search_people_profiles: "Search people",
  search_document_library: "Search the Document Library",
  find_learning_clinics: "Find clinics",
  open_learning_clinic: "Open a clinic card",
  get_my_site_visit: "My current site visit",
  check_out_to_site: "Check out to a site",
  check_back_in_from_site: "Check back in from a site",
};

function toolTitle(name: string): string {
  const title = TITLES[name] ?? name.replace(/_/g, " ");
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/** The opening sentence of a tool's description, which says what it does. */
function firstSentence(text: string): string {
  const match = /^(.{20,280}?[.!?])(\s|$)/s.exec(text.trim());
  return (match?.[1] ?? text.slice(0, 280)).trim();
}

function AccessChip({ access }: { access: EvolveToolAccess | null }) {
  const { t } = useLingui();
  if (!access) return null;
  const shown: Record<EvolveToolAccess, { label: string; tone: string }> = {
    read: { label: t`Read only`, tone: "bg-muted text-muted-foreground" },
    files: { label: t`Makes files`, tone: "bg-muted text-muted-foreground" },
    add: { label: t`Adds`, tone: "bg-primary/10 text-primary" },
    edit: { label: t`Edits`, tone: "bg-primary/10 text-primary" },
    delete: { label: t`Deletes`, tone: "bg-destructive/10 text-destructive" },
  };
  return (
    <span
      data-testid={`evolve-tool-access-${access}`}
      className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-medium", shown[access].tone)}
    >
      {shown[access].label}
    </span>
  );
}

function ToolRow({ tool }: { tool: EvolveToolCatalogueEntry }) {
  const { t } = useLingui();
  return (
    <li data-testid="evolve-tool" className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="me-1 text-[13.5px] font-medium text-foreground">
          {toolTitle(tool.name)}
        </span>
        <AccessChip access={tool.access} />
        {tool.approval ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11.5px] font-medium text-warning">
            <ShieldCheck aria-hidden className="size-3" />
            <Trans>You approve every time</Trans>
          </span>
        ) : null}
      </div>
      <p className="mt-0.5 text-[12.5px] text-muted-foreground">
        {tool.changes ?? firstSentence(tool.description)}
      </p>
      <p
        className={cn(
          "mt-1 inline-flex items-center gap-1 text-[12px]",
          !tool.page || tool.page.open ? "text-muted-foreground" : "text-destructive",
        )}
      >
        {tool.page ? (
          tool.page.open ? (
            <>
              <ShieldCheck aria-hidden className="size-3.5 text-success" />
              <Trans>Needs Evolve's {tool.page.label} page; you have access</Trans>
            </>
          ) : (
            <>
              <Lock aria-hidden className="size-3.5" />
              <Trans>Needs Evolve's {tool.page.label} page; ask an Evolve admin for access</Trans>
            </>
          )
        ) : (
          t`Open to everyone at OCSC`
        )}
      </p>
    </li>
  );
}

/**
 * Every Evolve tool the company switched on, grouped by what it works on, with what it reads or
 * changes, whether each use is approved on a card, and whether this person's Evolve access lets
 * them use it. Read from Evolve as them, so it matches what their agents can actually do.
 */
export function EvolveToolsSection() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const catalogue = useQuery({
    ...queries.evolveTools.catalogue.queryOptions(),
    staleTime: 5 * 60_000,
  });
  const stories = useGroupStories();
  const [query, setQuery] = useState("");
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const groups = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const byGroup = new Map<string, EvolveToolCatalogueEntry[]>();
    for (const tool of catalogue.data?.tools ?? []) {
      const haystack =
        `${toolTitle(tool.name)} ${tool.name} ${tool.group} ${tool.description}`.toLowerCase();
      if (words.some((word) => !haystack.includes(word))) continue;
      byGroup.set(tool.group, [...(byGroup.get(tool.group) ?? []), tool]);
    }
    const order = Object.keys(stories);
    return [...byGroup.entries()].sort(
      ([a], [b]) =>
        (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) -
        (order.indexOf(b) === -1 ? 99 : order.indexOf(b)),
    );
  }, [catalogue.data, query, stories]);

  if (catalogue.isPending) {
    return (
      <section data-testid="evolve-tools" className="px-2.5">
        <h3 className="text-[14px] font-medium text-muted-foreground">
          <Trans>Evolve tools</Trans>
        </h3>
        <div className="mt-2 flex items-center gap-2 text-[13px] text-muted-foreground">
          <Spinner />
          <Trans>Loading Evolve tools…</Trans>
        </div>
      </section>
    );
  }
  if (catalogue.data?.status !== "ready") {
    const reason =
      catalogue.data?.status === "off"
        ? t`An admin has switched Evolve tools off for the company.`
        : catalogue.data?.status === "not-configured"
          ? t`Evolve is not linked on this server yet.`
          : t`Evolve could not list its tools just now. Try again in a moment.`;
    return (
      <section data-testid="evolve-tools" className="px-2.5">
        <h3 className="text-[14px] font-medium text-muted-foreground">
          <Trans>Evolve tools</Trans>
        </h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          <Trans>
            Projects, deadlines, comments, Learning Centre clinics, site check-in and more — as your
            own Evolve access allows, with a card to approve every change.
          </Trans>
        </p>
        <p role="status" className="mt-2 text-[13px] text-muted-foreground">
          {reason}
        </p>
      </section>
    );
  }
  const total = catalogue.data.tools.length;
  const changing = catalogue.data.tools.filter((tool) => tool.approval).length;

  return (
    <section data-testid="evolve-tools">
      <div className="mb-3 px-2.5">
        <h3 className="text-[14px] font-medium text-muted-foreground">
          <Trans>Evolve tools</Trans>
        </h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          <Trans>
            {total} tools for company data in Evolve — projects, people, Learning Centre clinics,
            site visits and more. Agents only see and change what your Evolve access allows. The{" "}
            {changing} that change Evolve show you a card to check, edit and approve first, every
            time; nothing is saved until you click.
          </Trans>
        </p>
      </div>
      <div className="relative mb-2 px-2.5">
        <Search
          aria-hidden
          className="pointer-events-none absolute start-5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label={t`Search Evolve tools`}
          placeholder={t`Search Evolve tools`}
          className="ps-8"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="space-y-2 px-2.5">
        {groups.map(([group, tools]) => {
          const story = stories[group];
          const Icon = story?.icon ?? Wrench;
          const open = openGroup === group || query.trim() !== "";
          const blocked = tools.filter((tool) => tool.page && !tool.page.open).length;
          return (
            <div
              key={group}
              data-testid="evolve-tool-group"
              className="overflow-hidden rounded-xl border border-border bg-card"
            >
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenGroup(openGroup === group ? null : group)}
                className="flex w-full items-center gap-3 p-3 text-start hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="grid size-9 flex-none place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon aria-hidden className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-foreground">{group}</span>
                  <span className="block text-[13px] text-muted-foreground">
                    {story?.tagline ?? <Trans>{tools.length} tools</Trans>}
                  </span>
                </span>
                {blocked ? (
                  <span className="inline-flex flex-none items-center gap-1 text-[12px] text-destructive">
                    <Lock aria-hidden className="size-3.5" />
                    <span className="max-sm:sr-only">
                      <Trans>{blocked} need access</Trans>
                    </span>
                  </span>
                ) : null}
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "size-4 flex-none text-primary transition-transform",
                    open && "rotate-180",
                  )}
                />
              </button>
              {open ? (
                <div className="border-t border-border">
                  <ul className="divide-y divide-border/70">
                    {tools.map((tool) => (
                      <ToolRow key={tool.name} tool={tool} />
                    ))}
                  </ul>
                  {story ? (
                    <div className="m-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-[13px]">
                      <span className="font-medium text-primary">
                        <Trans>Try asking</Trans>
                      </span>
                      <span className="block text-foreground">“{story.tryAsking}”</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {groups.length === 0 ? (
          <p className="px-1 text-[13px] text-muted-foreground">
            <Trans>No Evolve tool matches.</Trans>
          </p>
        ) : null}
      </div>
    </section>
  );
}
