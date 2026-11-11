import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { StoredFile, StoredFilesState } from "@rakazo/contracts";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Spinner,
  toast,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { File, Folder, MoreHorizontal, Pin } from "lucide-react";
import { useState } from "react";
import { decodeArtifactBase64, downloadArtifactBytes } from "../../lib/artifact-open";
import { useSpaceQueries } from "../../lib/query";
import { openStorageDialog } from "../../lib/storage-prompt";
import { errorText } from "../../lib/user-error";
import { DeleteItemDialog } from "./dialogs";

const DAY_MS = 86_400_000;

function formatSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * What this bot made on its owner's computer, how much room it takes, and when each item is
 * cleaned up. Only the bot's owner can open it; pinned items are never deleted.
 */
export function FilesTab({ botId }: { botId: string }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const options = queries.computer.storedFiles.queryOptions({ input: { botId } });
  const state = useQuery({ ...options, refetchOnMount: "always" });
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<StoredFile | null>(null);

  const apply = (next: StoredFilesState) => {
    queryClient.setQueryData(options.queryKey, next);
  };

  async function run(key: string, action: () => Promise<void>, failure: string) {
    setBusy(key);
    try {
      await action();
    } catch (err) {
      toast.error(errorText(err, failure));
    } finally {
      setBusy(null);
    }
  }

  if (state.isPending) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }
  if (state.isError || !state.data) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
        <p role="alert">
          <Trans>Couldn't load this bot's files.</Trans>
        </p>
        <Button variant="outline" size="sm" onClick={() => void state.refetch()}>
          <Trans>Try again</Trans>
        </Button>
      </div>
    );
  }
  const data = state.data;
  if (!data.available) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        <Trans>This bot has no files on a computer yet.</Trans>
      </p>
    );
  }
  const share = data.limitBytes > 0 ? Math.min(1, data.usedBytes / data.limitBytes) : 0;
  const nearlyFull = share >= 0.9;

  return (
    <div className="space-y-4" data-testid="bot-files">
      <div className="space-y-2 rounded-xl bg-muted/50 p-4">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-medium">
            <Trans>Your computer storage</Trans>
          </span>
          <span className="tabular-nums text-muted-foreground">
            {formatSize(data.usedBytes)} / {formatSize(data.limitBytes)}
          </span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-border"
          role="progressbar"
          aria-label={t`Storage used`}
          aria-valuenow={Math.round(share * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={nearlyFull ? "h-full bg-destructive" : "h-full bg-primary"}
            style={{ width: `${share * 100}%` }}
          />
        </div>
        <p className="text-[13px] text-muted-foreground">
          {nearlyFull ? (
            <Trans>
              Nearly full. When it is full, bots stop making new documents and videos until you
              delete something.
            </Trans>
          ) : (
            <Plural
              value={data.retentionDays}
              one="Files nobody changes for # day are deleted automatically. Pin anything you want to keep."
              other="Files nobody changes for # days are deleted automatically. Pin anything you want to keep."
            />
          )}{" "}
          <button
            type="button"
            className="font-medium text-foreground underline-offset-2 hover:underline"
            onClick={() => openStorageDialog("largest")}
          >
            <Trans>Manage all your storage</Trans>
          </button>
        </p>
      </div>

      {data.files.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          <Trans>This bot hasn't made any files yet.</Trans>
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {data.files.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              busy={busy === file.path}
              onDownload={() =>
                void run(
                  file.path,
                  async () => {
                    const result = await queries.computer.downloadStoredFile.call({
                      botId,
                      path: file.path,
                    });
                    downloadArtifactBytes(
                      file.path.split("/").pop() ?? file.path,
                      "application/octet-stream",
                      decodeArtifactBase64(result.contentBase64),
                    );
                  },
                  t`Could not download the file`,
                )
              }
              onPin={() =>
                void run(
                  file.path,
                  async () =>
                    apply(
                      await queries.computer.pinStoredFile.call({
                        botId,
                        path: file.path,
                        pinned: !file.pinned,
                      }),
                    ),
                  t`Could not update the file`,
                )
              }
              onDelete={() => setDeleting(file)}
            />
          ))}
        </ul>
      )}

      {deleting ? (
        <DeleteItemDialog
          item={{ name: deleting.path }}
          noun="file"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            apply(await queries.computer.deleteStoredFile.call({ botId, path: deleting.path }));
            setDeleting(null);
          }}
        />
      ) : null}
    </div>
  );
}

function FileRow({
  file,
  busy,
  onDownload,
  onPin,
  onDelete,
}: {
  file: StoredFile;
  busy: boolean;
  onDownload: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  const Icon = file.kind === "dir" ? Folder : File;
  const daysLeft = file.deletesAt
    ? Math.max(0, Math.ceil((new Date(file.deletesAt).getTime() - Date.now()) / DAY_MS))
    : null;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <Icon className="size-4 shrink-0 text-foreground/60" strokeWidth={1.5} />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm" title={file.path}>
          {file.path}
        </span>
        <span className="block text-[12.5px] text-muted-foreground">
          {formatSize(file.size)}
          {" · "}
          {daysLeft === null ? (
            <Trans>Pinned, kept</Trans>
          ) : (
            <Plural
              value={daysLeft}
              _0="Deleted today"
              one="Deleted in # day"
              other="Deleted in # days"
            />
          )}
        </span>
      </div>
      {file.pinned ? (
        <Pin className="size-3.5 shrink-0 text-foreground/60" strokeWidth={1.5} aria-hidden />
      ) : null}
      {busy ? <Spinner className="size-4" /> : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t`Actions for ${file.path}`}
          className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent"
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {file.kind === "file" ? (
            <DropdownMenuItem onClick={onDownload}>
              <Trans>Download</Trans>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={onPin}>
            {file.pinned ? <Trans>Unpin</Trans> : <Trans>Pin, keep it</Trans>}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trans>Delete</Trans>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
