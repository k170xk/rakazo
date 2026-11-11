import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { MyStorageItem, MyStorageState } from "@rakazo/contracts";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { File, Folder, HardDrive, MessageSquare, Pin } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSpaceQueries } from "../lib/query";
import type { StoragePromptReason, StorageTab } from "../lib/storage-prompt";
import {
  itemsForTab,
  markStoragePromptSeen,
  NEARLY_FULL_SHARE,
  onOpenStorageDialog,
  shouldPromptStorage,
  storageItemKey,
  storagePromptReason,
} from "../lib/storage-prompt";
import { errorText } from "../lib/user-error";
import { DeleteItemDialog } from "../pages/shell/dialogs";

const DAY_MS = 86_400_000;
/** Checked again this often while the app stays open, so a full limit is noticed the same day. */
const RECHECK_MS = 30 * 60_000;
const OFFER_DELAY_MS = 3_000;
const MAX_SELECTION = 200;

function formatSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Manage storage: everything that counts against a person's limit, across all their bots, with
 * download (as one zip) and delete. Opens by itself once a day when the limit is nearly or fully
 * used, or when files are about to be deleted, and from the account menu or a bot's Files tab.
 */
export function StorageDialog({
  userId,
  ready = true,
  blockedByOverlay = false,
}: {
  userId: string | undefined;
  ready?: boolean;
  blockedByOverlay?: boolean;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const options = queries.computer.myStorage.queryOptions();
  const state = useQuery({
    ...options,
    enabled: Boolean(userId) && ready,
    staleTime: RECHECK_MS / 2,
    refetchInterval: RECHECK_MS,
  });
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<StoragePromptReason | null>(null);
  const [tab, setTab] = useState<StorageTab>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(
    () =>
      onOpenStorageDialog((next) => {
        setReason(null);
        setTab(next);
        setSelected(new Set());
        setOpen(true);
        void queryClient.invalidateQueries({ queryKey: options.queryKey });
      }),
    [queryClient, options.queryKey],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("storage");
    if (!wanted) return;
    params.delete("storage");
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
    setTab(wanted === "expiring" || wanted === "largest" ? wanted : "all");
    setOpen(true);
  }, []);

  const data = state.data;
  useEffect(() => {
    if (!data || !userId || open || blockedByOverlay) return;
    const now = Date.now();
    const why = storagePromptReason(data, now);
    if (!why || !shouldPromptStorage(userId, why, now)) return;
    const timer = window.setTimeout(() => {
      markStoragePromptSeen(userId, why, Date.now());
      setReason(why);
      setTab(why === "expiring" ? "expiring" : "largest");
      setSelected(new Set());
      setOpen(true);
    }, OFFER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [data, userId, open, blockedByOverlay]);

  const now = Date.now();
  const shown = useMemo(() => (data ? itemsForTab(data.items, tab, now) : []), [data, tab, now]);
  const chosen = useMemo(
    () => (data ? data.items.filter((item) => selected.has(storageItemKey(item))) : []),
    [data, selected],
  );
  const chosenSize = formatSize(chosen.reduce((sum, item) => sum + item.size, 0));

  if (!open || !userId) return null;

  const apply = (next: MyStorageState) => {
    queryClient.setQueryData(options.queryKey, next);
    const keys = new Set(next.items.map(storageItemKey));
    setSelected((current) => new Set([...current].filter((key) => keys.has(key))));
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

  const toggle = (item: MyStorageItem, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      const key = storageItemKey(item);
      if (on && next.size < MAX_SELECTION) next.add(key);
      else next.delete(key);
      return next;
    });

  const allShownSelected =
    shown.length > 0 && shown.every((item) => selected.has(storageItemKey(item)));
  const selectShown = (on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const item of shown) {
        const key = storageItemKey(item);
        if (!on) next.delete(key);
        else if (next.size < MAX_SELECTION) next.add(key);
      }
      return next;
    });

  const download = () =>
    void run(
      "download",
      async () => {
        const { url } = await queries.computer.myStorageDownload.call({
          items: chosen.map((item) => item.ref),
        });
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.rel = "noopener";
        anchor.click();
      },
      t`Could not download the files`,
    );

  const share = data && data.limitBytes > 0 ? Math.min(1, data.usedBytes / data.limitBytes) : 0;
  const full = share >= 1;
  const nearly = share >= NEARLY_FULL_SHARE;

  return (
    <>
      <Dialog
        open={!confirming}
        onOpenChange={(next) => {
          if (!next && busy === null) setOpen(false);
        }}
      >
        <DialogContent
          className="flex max-h-[85vh] flex-col gap-4 sm:max-w-2xl"
          data-testid="storage-dialog"
        >
          <DialogHeader>
            <div className="mb-1 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <HardDrive className="size-5" aria-hidden />
            </div>
            <DialogTitle>
              {reason === "full" ? (
                <Trans>Your storage is full</Trans>
              ) : reason === "nearly-full" ? (
                <Trans>Your storage is nearly full</Trans>
              ) : reason === "expiring" ? (
                <Trans>Some files will be deleted soon</Trans>
              ) : (
                <Trans>Manage storage</Trans>
              )}
            </DialogTitle>
            <DialogDescription>
              {reason === "full" ? (
                <Trans>
                  Bots can't make new documents or videos until you free up space. Download anything
                  you want to keep, then delete it here.
                </Trans>
              ) : (
                <Trans>
                  We can't keep every file forever. Download anything you want to keep to your
                  computer, then delete what you no longer need.
                </Trans>
              )}
            </DialogDescription>
          </DialogHeader>

          {state.isPending ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : state.isError || !data ? (
            <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
              <p role="alert">
                <Trans>Couldn't load your files.</Trans>
              </p>
              <Button variant="outline" size="sm" onClick={() => void state.refetch()}>
                <Trans>Try again</Trans>
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-2 rounded-xl bg-muted/50 p-4">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">
                    <Trans>Storage used</Trans>
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
                    className={full || nearly ? "h-full bg-destructive" : "h-full bg-primary"}
                    style={{ width: `${share * 100}%` }}
                  />
                </div>
                <p className="text-[13px] text-muted-foreground">
                  <Trans>
                    {formatSize(data.computerBytes)} on bot computers · {formatSize(data.chatBytes)}{" "}
                    attached in chats.
                  </Trans>{" "}
                  <Plural
                    value={data.computerRetentionDays}
                    one="Computer files nobody changes for # day are deleted unless pinned."
                    other="Computer files nobody changes for # days are deleted unless pinned."
                  />{" "}
                  {data.chatRetentionDays === null ? null : (
                    <Plural
                      value={data.chatRetentionDays}
                      one="Files bots attach in chats are deleted # day after they were made."
                      other="Files bots attach in chats are deleted # days after they were made."
                    />
                  )}
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <ToggleGroup
                  value={[tab]}
                  onValueChange={([next]) => {
                    if (next) setTab(next as StorageTab);
                  }}
                  spacing={1}
                  className="rounded-lg bg-muted p-0.5 [&>*]:aria-pressed:bg-background [&>*]:aria-pressed:shadow-sm"
                  aria-label={t`Show`}
                >
                  <ToggleGroupItem value="all">
                    <Trans>All</Trans>
                  </ToggleGroupItem>
                  <ToggleGroupItem value="expiring">
                    <Trans>Deleted soon</Trans>
                  </ToggleGroupItem>
                  <ToggleGroupItem value="largest">
                    <Trans>Largest</Trans>
                  </ToggleGroupItem>
                </ToggleGroup>
                {shown.length > 0 ? (
                  <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                    <Checkbox
                      id="storage-select-all"
                      checked={allShownSelected}
                      onCheckedChange={(checked) => selectShown(Boolean(checked))}
                    />
                    <label htmlFor="storage-select-all">
                      <Trans>Select all</Trans>
                    </label>
                  </div>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border">
                {shown.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {tab === "expiring" ? (
                      <Trans>Nothing is due to be deleted this week.</Trans>
                    ) : (
                      <Trans>Your bots haven't made any files yet.</Trans>
                    )}
                  </p>
                ) : (
                  <ul className="divide-y divide-border" data-testid="storage-items">
                    {shown.map((item) => (
                      <StorageRow
                        key={storageItemKey(item)}
                        item={item}
                        now={now}
                        checked={selected.has(storageItemKey(item))}
                        busy={busy === storageItemKey(item)}
                        onCheck={(on) => toggle(item, on)}
                        onPin={
                          item.ref.kind === "computer" && item.pinnable
                            ? () => {
                                const ref = item.ref as { botId: string; path: string };
                                void run(
                                  storageItemKey(item),
                                  async () =>
                                    apply(
                                      await queries.computer.pinMyStorage.call({
                                        botId: ref.botId,
                                        path: ref.path,
                                        pinned: !item.pinned,
                                      }),
                                    ),
                                  t`Could not update the file`,
                                );
                              }
                            : undefined
                        }
                      />
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          <DialogFooter className="items-center sm:justify-between">
            <span className="text-[13px] text-muted-foreground tabular-nums">
              {chosen.length > 0 ? (
                <Trans>
                  {chosen.length} selected · {chosenSize}
                </Trans>
              ) : null}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={chosen.length === 0 || busy !== null}
                onClick={download}
                data-testid="storage-download"
              >
                {busy === "download" ? <Spinner className="size-4" /> : null}
                <Trans>Download (.zip)</Trans>
              </Button>
              <Button
                variant="destructive"
                disabled={chosen.length === 0 || busy !== null}
                onClick={() => setConfirming(true)}
                data-testid="storage-delete"
              >
                <Trans>Delete</Trans>
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirming ? (
        <DeleteItemDialog
          item={{ name: "" }}
          noun="file"
          title={
            <Plural
              value={chosen.length}
              one={`Delete # file (${chosenSize})?`}
              other={`Delete # files (${chosenSize})?`}
            />
          }
          description={
            <Trans>
              This cannot be undone. Download them first if you might need them again. Chats keep
              their messages and show that the file was removed.
            </Trans>
          }
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            apply(
              await queries.computer.deleteMyStorage.call({
                items: chosen.map((item) => item.ref),
              }),
            );
            setConfirming(false);
          }}
        />
      ) : null}
    </>
  );
}

function StorageRow({
  item,
  now,
  checked,
  busy,
  onCheck,
  onPin,
}: {
  item: MyStorageItem;
  now: number;
  checked: boolean;
  busy: boolean;
  onCheck: (on: boolean) => void;
  onPin?: () => void;
}) {
  const { t } = useLingui();
  const Icon = item.ref.kind === "chat" ? MessageSquare : item.kind === "dir" ? Folder : File;
  const daysLeft = item.deletesAt
    ? Math.max(0, Math.ceil((new Date(item.deletesAt).getTime() - now) / DAY_MS))
    : null;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <Checkbox
        checked={checked}
        onCheckedChange={(next) => onCheck(Boolean(next))}
        aria-label={t`Select ${item.name}`}
      />
      <Icon className="size-4 shrink-0 text-foreground/60" strokeWidth={1.5} />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm" title={item.name}>
          {item.name}
        </span>
        <span className="block truncate text-[12.5px] text-muted-foreground">
          {formatSize(item.size)}
          {item.botName ? ` · ${item.botName}` : null}
          {" · "}
          {item.ref.kind === "chat" ? <Trans>In a chat</Trans> : <Trans>On computer</Trans>}
          {" · "}
          {daysLeft === null ? (
            item.pinned ? (
              <Trans>Pinned, kept</Trans>
            ) : (
              <Trans>Kept</Trans>
            )
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
      {busy ? <Spinner className="size-4" /> : null}
      {onPin ? (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 gap-1.5"
          aria-pressed={item.pinned}
          onClick={onPin}
        >
          <Pin className="size-3.5" strokeWidth={1.5} aria-hidden />
          {item.pinned ? <Trans>Unpin</Trans> : <Trans>Pin</Trans>}
        </Button>
      ) : null}
    </li>
  );
}
