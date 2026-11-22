import { Trans, useLingui } from "@lingui/react/macro";
import type { CompanyAdminState, CompanySkill } from "@rakazo/contracts";
import { parseSkillMd } from "@rakazo/core";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Spinner,
  Switch,
  Textarea,
  toast,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

export function CompanySkillEditorDialog({
  open,
  skill,
  onClose,
  onSaved,
}: {
  open: boolean;
  skill: CompanySkill | null;
  onClose: () => void;
  onSaved: (saved: CompanySkill) => Promise<void> | void;
}) {
  const { t } = useLingui();
  const parsed = useMemo(() => {
    if (!skill) return null;
    const result = parseSkillMd(skill.content);
    return "error" in result ? null : result;
  }, [skill]);

  const [rawMode, setRawMode] = useState(false);
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [body, setBody] = useState(parsed?.body ?? "");
  const [rawContent, setRawContent] = useState(skill?.content ?? "");
  const [availableToAll, setAvailableToAll] = useState(skill?.availableToAll ?? false);
  const [hiddenFromStaff, setHiddenFromStaff] = useState(skill?.hiddenFromStaff ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyStarter(kind: "writing" | "review" | "report") {
    setRawMode(false);
    if (kind === "writing") {
      setName(t`OCSC writing style`);
      setDescription(
        t`House tone, structure, spelling and formatting rules for all client writing.`,
      );
      setBody(
        [
          "1. Use British/Irish English spelling (analyse, programme, metre, colour).",
          "2. Lead with the answer or recommendation before supporting detail.",
          "3. Keep sentences direct and active; avoid filler and hype.",
          "4. Use SI units consistently and clearly label assumptions.",
        ].join("\n"),
      );
    } else if (kind === "review") {
      setName(t`Technical review checklist`);
      setDescription(t`Structured engineering quality check before signing off deliverables.`);
      setBody(
        [
          "1. Verify scope, design standards and revision references are stated.",
          "2. Flag missing assumptions, load cases, or unverified third-party inputs.",
          "3. Separate critical compliance risks from minor editorial comments.",
          "4. End with a clear summary of required actions and owners.",
        ].join("\n"),
      );
    } else {
      setName(t`Client report structure`);
      setDescription(t`Standard section order and executive summary format for OCSC reports.`);
      setBody(
        [
          "1. Start with an Executive Summary (purpose, key findings, recommendations).",
          "2. Follow with Scope & Basis of Assessment, Technical Findings, Risks & Mitigations, and Next Steps.",
          "3. Present numerical comparisons in clean tables with units in column headers.",
        ].join("\n"),
      );
    }
  }

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const payload = rawMode
        ? { content: rawContent, availableToAll, hiddenFromStaff }
        : {
            name: name.trim(),
            description: description.trim(),
            body,
            availableToAll,
            hiddenFromStaff,
          };
      const saved = skill
        ? await rpc.companyAdmin.skills.update({ id: skill.id, ...payload })
        : await rpc.companyAdmin.skills.create(payload);
      await onSaved(saved);
      toast.success(skill ? t`Company skill updated` : t`Company skill created`);
      onClose();
    } catch (err) {
      setError(errorText(err, t`Could not save company skill`));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = rawMode
    ? rawContent.trim().length > 0
    : name.trim().length > 0 && description.trim().length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {skill ? <Trans>Edit company skill</Trans> : <Trans>New company skill</Trans>}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!skill ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">
                <Trans>Starters:</Trans>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyStarter("writing")}
              >
                <Trans>Writing style</Trans>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyStarter("review")}
              >
                <Trans>Review checklist</Trans>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyStarter("report")}
              >
                <Trans>Report structure</Trans>
              </Button>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
            <div>
              <div className="text-sm font-medium">
                <Trans>Edit as raw SKILL.md</Trans>
              </div>
              <div className="text-xs text-muted-foreground">
                <Trans>Use full YAML frontmatter if you are pasting an existing SKILL.md.</Trans>
              </div>
            </div>
            <Switch
              checked={rawMode}
              onCheckedChange={(checked) => {
                if (checked && !rawContent.trim() && (name.trim() || description.trim() || body)) {
                  setRawContent(
                    `---\nname: ${name.trim() || "company-skill"}\ndescription: ${description.trim() || "Describe when to use this skill."}\n---\n\n${body}`,
                  );
                }
                setRawMode(checked);
              }}
            />
          </div>

          {rawMode ? (
            <Field>
              <FieldLabel htmlFor="company-skill-raw">
                <Trans>SKILL.md content</Trans>
              </FieldLabel>
              <Textarea
                id="company-skill-raw"
                rows={12}
                className="font-mono text-xs"
                value={rawContent}
                onChange={(event) => setRawContent(event.target.value)}
                placeholder={
                  "---\nname: writing-style\ndescription: How agents should write.\n---\n\nRules here..."
                }
              />
            </Field>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor="company-skill-name">
                  <Trans>Skill name</Trans>
                </FieldLabel>
                <Input
                  id="company-skill-name"
                  value={name}
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t`e.g. OCSC writing style`}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="company-skill-description">
                  <Trans>When to use / summary</Trans>
                </FieldLabel>
                <Input
                  id="company-skill-description"
                  value={description}
                  maxLength={2000}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t`Short description of what this skill enforces`}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="company-skill-body">
                  <Trans>Instructions</Trans>
                </FieldLabel>
                <FieldDescription>
                  <Trans>
                    When attached to a default agent as Required, every rule written here is
                    enforced on every response.
                  </Trans>
                </FieldDescription>
                <Textarea
                  id="company-skill-body"
                  rows={10}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder={t`Write the rules, tone guidelines, templates, or step-by-step workflow...`}
                />
              </Field>
            </>
          )}

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">
                <Trans>Available to all staff agents</Trans>
              </div>
              <div className="text-xs text-muted-foreground">
                <Trans>
                  Off: only default agents you attach this skill to can use it. On: every staff
                  agent can also invoke it on demand.
                </Trans>
              </div>
            </div>
            <Switch checked={availableToAll} onCheckedChange={setAvailableToAll} />
          </div>

          {availableToAll ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <div>
                <div className="text-sm font-medium">
                  <Trans>Hide from staff Skills list</Trans>
                </div>
                <div className="text-xs text-muted-foreground">
                  <Trans>
                    Off: staff see this skill in their Skills list. On: agents can still use it, but
                    it stays hidden from staff's Skills list.
                  </Trans>
                </div>
              </div>
              <Switch checked={hiddenFromStaff} onCheckedChange={setHiddenFromStaff} />
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button type="button" disabled={busy || !canSubmit} onClick={() => void save()}>
            {busy ? <Spinner className="mr-1.5" /> : null}
            {skill ? <Trans>Save skill</Trans> : <Trans>Create skill</Trans>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Company-managed SKILL.md library shown under Company Admin → Tools and skills. */
export function CompanySkillsLibrarySection({ state }: { state: CompanyAdminState }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const skillsQuery = useQuery({
    queryKey: ["company-admin", "skills"],
    queryFn: () => rpc.companyAdmin.skills.list(),
    initialData: state.companySkills,
  });
  const [editing, setEditing] = useState<CompanySkill | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingVisibilityId, setTogglingVisibilityId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const usageBySkillId = useMemo(() => {
    const counts = new Map<string, { required: number; available: number }>();
    for (const cfg of Object.values(state.assistantConfigs ?? {})) {
      for (const entry of cfg.skills ?? []) {
        if (!entry.skillKey.startsWith("company:")) continue;
        const id = entry.skillKey.slice("company:".length);
        const cur = counts.get(id) ?? { required: 0, available: 0 };
        if (entry.mode === "required") cur.required += 1;
        else cur.available += 1;
        counts.set(id, cur);
      }
    }
    return counts;
  }, [state.assistantConfigs]);

  async function refreshAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["company-admin", "skills"] }),
      queryClient.invalidateQueries({ queryKey: ["company-admin", "default-agents"] }),
      queryClient.invalidateQueries({ queryKey: queries.companyAdmin.get.queryKey() }),
      queryClient.invalidateQueries({ queryKey: queries.agentSkills.list.queryKey() }),
    ]);
  }

  async function toggleHidden(skill: CompanySkill) {
    setTogglingVisibilityId(skill.id);
    try {
      await rpc.companyAdmin.skills.update({
        id: skill.id,
        hiddenFromStaff: !skill.hiddenFromStaff,
      });
      await refreshAll();
    } catch (err) {
      toast.error(errorText(err, t`Could not update skill visibility`));
    } finally {
      setTogglingVisibilityId(null);
    }
  }

  async function removeSkill(id: string) {
    setDeletingId(id);
    try {
      await rpc.companyAdmin.skills.remove({ id });
      await refreshAll();
      toast.success(t`Company skill removed`);
      setConfirmDeleteId(null);
    } catch (err) {
      toast.error(errorText(err, t`Could not remove company skill`));
    } finally {
      setDeletingId(null);
    }
  }

  const skills = skillsQuery.data ?? [];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">
            <Trans>Company skills</Trans>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            <Trans>
              Define company-wide writing styles, checklists, and workflows here, then attach them
              to default agents as required ("must use") or available skills.
            </Trans>
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 size-4" />
          <Trans>New company skill</Trans>
        </Button>
      </div>

      {skills.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          <Trans>
            No company skills yet. Add one for writing style, quality checks, or domain rules, then
            attach it to your default agents.
          </Trans>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {skills.map((skill) => {
            const usage = usageBySkillId.get(skill.id);
            const totalAgents = (usage?.required ?? 0) + (usage?.available ?? 0);
            return (
              <li
                key={skill.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{skill.name}</span>
                    {skill.availableToAll ? (
                      <Badge variant="secondary">
                        <Trans>All staff</Trans>
                      </Badge>
                    ) : null}
                    {skill.availableToAll && skill.hiddenFromStaff ? (
                      <Badge variant="outline" className="text-[11px] font-normal">
                        <Trans>Hidden from staff</Trans>
                      </Badge>
                    ) : null}
                    {usage?.required ? (
                      <Badge variant="default">
                        <Trans>{usage.required} required</Trans>
                      </Badge>
                    ) : null}
                    {totalAgents > (usage?.required ?? 0) ? (
                      <Badge variant="outline">
                        <Trans>{totalAgents - (usage?.required ?? 0)} available</Trans>
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {skill.description}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {skill.availableToAll ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      data-testid={`toggle-company-skill-visibility-${skill.id}`}
                      aria-label={
                        skill.hiddenFromStaff
                          ? t`Hidden from staff's Skills list (agents still use it). Click to show.`
                          : t`Shown in staff's Skills list. Click to hide while keeping it enabled.`
                      }
                      aria-pressed={Boolean(skill.hiddenFromStaff)}
                      title={
                        skill.hiddenFromStaff
                          ? t`Hidden from staff's Skills list (agents still use it). Click to show.`
                          : t`Shown in staff's Skills list. Click to hide while keeping it enabled.`
                      }
                      disabled={togglingVisibilityId === skill.id}
                      className={
                        skill.hiddenFromStaff ? "text-foreground" : "text-muted-foreground"
                      }
                      onClick={() => void toggleHidden(skill)}
                    >
                      {skill.hiddenFromStaff ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </Button>
                  ) : null}
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(skill)}>
                    <Pencil className="mr-1 size-3.5" />
                    <Trans>Edit</Trans>
                  </Button>
                  {confirmDeleteId === skill.id ? (
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={deletingId === skill.id}
                        onClick={() => void removeSkill(skill.id)}
                      >
                        <Trans>Confirm</Trans>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={deletingId === skill.id}
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        <Trans>Cancel</Trans>
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t`Delete`}
                      onClick={() => setConfirmDeleteId(skill.id)}
                    >
                      <Trash2 className="size-4 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {creating ? (
        <CompanySkillEditorDialog
          open
          skill={null}
          onClose={() => setCreating(false)}
          onSaved={refreshAll}
        />
      ) : null}

      {editing ? (
        <CompanySkillEditorDialog
          key={editing.id}
          open
          skill={editing}
          onClose={() => setEditing(null)}
          onSaved={refreshAll}
        />
      ) : null}
    </section>
  );
}
