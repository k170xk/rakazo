import { Trans, useLingui } from "@lingui/react/macro";
import type {
  SharePointBrowseEntry,
  SharePointFolder,
  SharePointLocation,
} from "@rakazo/contracts";
import { SHAREPOINT_FOLDER_LIMIT } from "@rakazo/contracts";
import { Button, Input, Spinner } from "@rakazo/ui-web";
import { ChevronRight, Folder, Library, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

type Step = { label: string; location: SharePointLocation };

/** The SharePoint folders a person lets their assistants read, and a browser to choose more. */
export function SharePointFolders({ connectionId }: { connectionId: string }) {
  const { t } = useLingui();
  const [folders, setFolders] = useState<SharePointFolder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    let current = true;
    rpc.connections.sharePoint
      .folders({ connectionId })
      .then((found) => current && setFolders(found))
      .catch((err) => current && setError(errorText(err, t`Could not load SharePoint folders.`)));
    return () => {
      current = false;
    };
  }, [connectionId, t]);

  async function save(next: Array<{ driveId: string; itemId: string }>) {
    setSaving(true);
    setError(null);
    try {
      setFolders(await rpc.connections.sharePoint.setFolders({ connectionId, folders: next }));
    } catch (err) {
      setError(errorText(err, t`Could not save SharePoint folders.`));
    } finally {
      setSaving(false);
    }
  }

  const chosen = folders ?? [];
  const refs = chosen.map(({ driveId, itemId }) => ({ driveId, itemId }));
  const isChosen = (driveId: string, itemId: string) =>
    chosen.some((folder) => folder.driveId === driveId && folder.itemId === itemId);

  return (
    <section data-testid="sharepoint-folders" className="space-y-2 px-2">
      <div className="text-[13px] font-medium text-foreground">
        <Trans>Folders assistants can read</Trans>
      </div>
      {folders === null && !error ? (
        <Spinner className="size-4 text-muted-foreground" aria-label={t`Loading folders…`} />
      ) : chosen.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          <Trans>
            None yet. Assistants cannot read SharePoint until you choose folders. They only ever
            read, never change anything.
          </Trans>
        </p>
      ) : (
        <ul className="space-y-1">
          {chosen.map((folder) => (
            <li
              key={`${folder.driveId}:${folder.itemId}`}
              className="group/folder flex items-center gap-2 rounded-lg px-1 py-1"
            >
              <Folder className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] text-foreground">{folder.name}</div>
                {folder.location ? (
                  <div className="truncate text-[12px] text-muted-foreground">
                    {folder.location}
                  </div>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label={t`Stop sharing ${folder.name}`}
                disabled={saving}
                onClick={() =>
                  void save(
                    refs.filter(
                      (ref) => ref.driveId !== folder.driveId || ref.itemId !== folder.itemId,
                    ),
                  )
                }
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
      {browsing ? (
        <SharePointBrowser
          connectionId={connectionId}
          saving={saving}
          full={chosen.length >= SHAREPOINT_FOLDER_LIMIT}
          isChosen={isChosen}
          onChoose={(driveId, itemId) => void save([...refs, { driveId, itemId }])}
          onClose={() => setBrowsing(false)}
        />
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 px-2 text-[14px] text-muted-foreground"
          disabled={folders === null}
          onClick={() => setBrowsing(true)}
        >
          <Plus />
          <Trans>Choose folders</Trans>
        </Button>
      )}
    </section>
  );
}

function SharePointBrowser({
  connectionId,
  saving,
  full,
  isChosen,
  onChoose,
  onClose,
}: {
  connectionId: string;
  saving: boolean;
  full: boolean;
  isChosen: (driveId: string, itemId: string) => boolean;
  onChoose: (driveId: string, itemId: string) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [steps, setSteps] = useState<Step[]>([
    { label: t`Sites & OneDrive`, location: { kind: "sites" } },
  ]);
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<SharePointBrowseEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const step = steps[steps.length - 1]!;

  useEffect(() => {
    let current = true;
    setEntries(null);
    setError(null);
    rpc.connections.sharePoint
      .browse({ connectionId, location: step.location })
      .then((found) => current && setEntries(found))
      .catch((err) => current && setError(errorText(err, t`Could not open this in SharePoint.`)));
    return () => {
      current = false;
    };
  }, [connectionId, step, t]);

  function open(entry: SharePointBrowseEntry) {
    const location: SharePointLocation | undefined =
      entry.kind === "site"
        ? { kind: "libraries", siteId: entry.id }
        : entry.driveId
          ? { kind: "folder", driveId: entry.driveId, itemId: entry.id }
          : undefined;
    if (location) setSteps((current) => [...current, { label: entry.name, location }]);
  }

  return (
    <div data-testid="sharepoint-browser" className="space-y-2 rounded-xl border border-border p-2">
      <div className="flex items-center gap-1 overflow-x-auto text-[13px] text-muted-foreground">
        {steps.map((entry, index) => (
          <span key={`${index}:${entry.label}`} className="flex shrink-0 items-center gap-1">
            {index > 0 ? <ChevronRight className="size-3.5" /> : null}
            <button
              type="button"
              className="rounded px-1 hover:text-foreground disabled:text-foreground"
              disabled={index === steps.length - 1}
              onClick={() => setSteps((current) => current.slice(0, index + 1))}
            >
              {entry.label}
            </button>
          </span>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ms-auto h-7 shrink-0 px-2 text-[12px]"
          onClick={onClose}
        >
          <Trans>Done</Trans>
        </Button>
      </div>
      {step.location.kind === "sites" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setSteps([
              { label: t`Sites & OneDrive`, location: { kind: "sites", query: query.trim() } },
            ]);
          }}
        >
          <Input
            value={query}
            maxLength={200}
            placeholder={t`Search sites`}
            aria-label={t`Search sites`}
            onChange={(event) => setQuery(event.target.value)}
          />
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="px-1 text-[13px] text-destructive">
          {error}
        </p>
      ) : entries === null ? (
        <div className="grid place-items-center py-4">
          <Spinner className="size-4 text-muted-foreground" aria-label={t`Loading…`} />
        </div>
      ) : entries.length === 0 ? (
        <p className="px-1 py-2 text-[13px] text-muted-foreground">
          {step.location.kind === "sites" ? (
            <Trans>No sites or OneDrive found.</Trans>
          ) : (
            <Trans>No folders here.</Trans>
          )}
        </p>
      ) : (
        <ul className="max-h-72 space-y-0.5 overflow-y-auto">
          {entries.map((entry) => {
            const choosable = entry.kind !== "site" && entry.driveId;
            const added = choosable ? isChosen(entry.driveId!, entry.id) : false;
            const Icon = entry.kind === "folder" ? Folder : Library;
            return (
              <li
                key={`${entry.driveId ?? ""}:${entry.id}`}
                className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-accent/60"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-start"
                  onClick={() => open(entry)}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-foreground">{entry.name}</span>
                    {entry.detail ? (
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {entry.detail}
                      </span>
                    ) : null}
                  </span>
                </button>
                {choosable ? (
                  <Button
                    type="button"
                    variant={added ? "ghost" : "secondary"}
                    size="sm"
                    className="h-7 shrink-0 px-2.5 text-[12px]"
                    disabled={added || saving || full}
                    onClick={() => onChoose(entry.driveId!, entry.id)}
                  >
                    {added ? <Trans>Added</Trans> : <Trans>Add</Trans>}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
