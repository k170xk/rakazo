import { Trans, useLingui } from "@lingui/react/macro";
import type { CompanyAdminState, CompanyTools } from "@rakazo/contracts";
import { Badge, Button, Switch, toast } from "@rakazo/ui-web";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { isOcscTool, ocscToolTitle } from "../lib/ocsc-tools";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

type Entry = CompanyAdminState["tools"]["skills"][number];

/** The OCSC Tools, Evolve tools and built-in skills every assistant has, each switchable off for the whole company. */
export function CompanyToolsSection({
  state,
  onSaved,
}: {
  state: CompanyAdminState;
  onSaved: (next: CompanyAdminState) => Promise<void>;
}) {
  const { t, i18n } = useLingui();
  const [busy, setBusy] = useState<string | null>(null);
  const { skills, evolve } = state.tools;
  const evolveOn = state.features.evolveTools;
  const ocscTools = skills.filter((entry) => isOcscTool(entry.name));
  const builtinSkills = skills.filter((entry) => !isOcscTool(entry.name));

  async function run(key: string, action: () => Promise<CompanyAdminState>, failure: string) {
    setBusy(key);
    try {
      await onSaved(await action());
    } catch (err) {
      toast.error(errorText(err, failure));
    } finally {
      setBusy(null);
    }
  }

  const offList = (entries: Entry[], name: string, enabled: boolean) =>
    entries
      .filter((entry) => (entry.name === name ? !enabled : !entry.enabled))
      .map((entry) => entry.name);

  const setSkill = (name: string, enabled: boolean) =>
    run(
      `skill:${name}`,
      () => rpc.companyAdmin.setTools({ disabledSkills: offList(skills, name, enabled) }),
      t`Could not update the skill`,
    );

  const setTool = (name: string, enabled: boolean) => {
    const patch: Partial<CompanyTools> = { disabledTools: offList(evolve.tools, name, enabled) };
    return run(
      `tool:${name}`,
      () => rpc.companyAdmin.setTools(patch),
      t`Could not update the tool`,
    );
  };

  const status = {
    ready: { label: t`Connected`, variant: "secondary" as const },
    unavailable: { label: t`Unreachable`, variant: "destructive" as const },
    "not-configured": { label: t`Not set up`, variant: "outline" as const },
    off: { label: t`Off`, variant: "outline" as const },
  }[evolve.status];
  const checked = evolve.checkedAt
    ? i18n.date(new Date(evolve.checkedAt), { timeStyle: "short", dateStyle: "medium" })
    : null;

  return (
    <section className="space-y-4" data-testid="company-tools">
      <div>
        <h2 className="text-base font-medium">
          <Trans>OCSC Tools and skills</Trans>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <Trans>
            Every assistant of every member has these. Switch one off to remove it for everyone; it
            takes effect within a few seconds.
          </Trans>
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">
          <Trans>OCSC Tools</Trans>
        </h3>
        <p className="text-[13px] text-muted-foreground">
          <Trans>
            The tools OCSC built for the whole company: Word, slides, Excel, PDF, PDF Studio, video
            and apps. Staff see them under OCSC Tools, with what each can do.
          </Trans>
        </p>
        <ToggleList
          entries={ocscTools}
          idPrefix="company-skill"
          disabled={busy !== null}
          onChange={(name, on) => void setSkill(name, on)}
        />
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="flex-1 text-sm font-medium">
            <Trans>Evolve tools</Trans>
          </h3>
          <Badge variant={status.variant}>{status.label}</Badge>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null || evolve.status === "not-configured"}
            onClick={() =>
              void run("check", () => rpc.companyAdmin.checkTools(), t`Could not reach Evolve`)
            }
          >
            <RefreshCw />
            <Trans>Check now</Trans>
          </Button>
          <Switch
            aria-label={t`Evolve tools for everyone`}
            checked={evolveOn}
            disabled={busy !== null}
            onCheckedChange={(on) =>
              void run(
                "evolve",
                () => rpc.companyAdmin.setFeatures({ evolveTools: on }),
                t`Could not update the company setting`,
              )
            }
          />
        </div>
        <p className="text-[13px] text-muted-foreground">
          <Trans>
            What assistants can look up and do in Evolve on the person's behalf, such as project
            datasheets, stock media and voiceovers. Each person only reaches what Evolve lets them
            see.
          </Trans>
        </p>
        <p className="text-[13px] text-muted-foreground">
          {evolve.status === "not-configured" ? (
            <Trans>
              Set EVOLVE_PLUGINS_URL and EVOLVE_PLUGINS_SECRET on the server to connect.
            </Trans>
          ) : evolve.error ? (
            <Trans>
              Last check failed: {evolve.error}. Assistants keep the last tool list that worked.
            </Trans>
          ) : checked ? (
            <Trans>Last checked {checked}.</Trans>
          ) : (
            <Trans>Not checked yet.</Trans>
          )}
        </p>
        {evolve.tools.length > 0 ? (
          <ToggleList
            entries={evolve.tools}
            idPrefix="company-tool"
            disabled={busy !== null || !evolveOn}
            onChange={(name, on) => void setTool(name, on)}
          />
        ) : null}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">
          <Trans>Built-in skills</Trans>
        </h3>
        <p className="text-[13px] text-muted-foreground">
          <Trans>
            Ready-made ways of working that come with OCSC Intelligence. Switch one off and staff no
            longer see it. Their own skills, skill packs and GitHub are a separate switch.
          </Trans>
        </p>
        <ToggleList
          entries={builtinSkills}
          idPrefix="company-skill"
          disabled={busy !== null}
          onChange={(name, on) => void setSkill(name, on)}
        />
      </div>
    </section>
  );
}

function ToggleList({
  entries,
  idPrefix,
  disabled,
  onChange,
}: {
  entries: Entry[];
  idPrefix: string;
  disabled: boolean;
  onChange: (name: string, enabled: boolean) => void;
}) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {entries.map((entry) => {
        const id = `${idPrefix}-${entry.name.replace(/[^A-Za-z0-9_-]/g, "-")}`;
        return (
          <li key={entry.name} className="flex items-center gap-4 px-4 py-3">
            <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
              <span className="block text-sm font-medium">
                {ocscToolTitle(entry.name) ?? entry.name}
                {ocscToolTitle(entry.name) ? (
                  <span className="ms-2 font-mono text-[12px] font-normal text-muted-foreground">
                    {entry.name}
                  </span>
                ) : null}
              </span>
              <span className="line-clamp-2 block text-[13px] text-muted-foreground">
                {entry.description}
              </span>
            </label>
            <Switch
              id={id}
              checked={entry.enabled}
              disabled={disabled}
              onCheckedChange={(checked) => onChange(entry.name, checked)}
            />
          </li>
        );
      })}
    </ul>
  );
}
