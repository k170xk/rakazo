import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { AdminAnnouncement } from "@rakazo/contracts";
import {
  Badge,
  Button,
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
import { ImagePlus, Megaphone, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { AnnouncementDialog } from "../components/announcements/AnnouncementDialog";
import { PENDING_ANNOUNCEMENTS_KEY } from "../components/announcements/CompanyAnnouncements";
import { shrinkScreenshot } from "../components/announcements/shrink-screenshot";
import { formatRelativeTime } from "../lib/relative-time";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

const LIST_KEY = ["company-admin", "announcements"] as const;

/** Company admin: tell everyone about an update with a dialog, a screenshot and a reload button. */
export function AnnouncementsSection() {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const ids = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [offerReload, setOfferReload] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const list = useQuery({
    queryKey: LIST_KEY,
    queryFn: () => rpc.companyAdmin.announcements.list(),
    refetchOnWindowFocus: true,
  });

  const addImage = async (file: Blob | null | undefined) => {
    if (!file?.type.startsWith("image/")) return;
    setPreparing(true);
    try {
      setImage(await shrinkScreenshot(file));
    } catch (error) {
      toast.error(errorText(error, t`Couldn't use that image`));
    } finally {
      setPreparing(false);
    }
  };
  const addImageRef = useRef(addImage);
  addImageRef.current = addImage;

  // Paste a screenshot straight from the clipboard anywhere on this section's page.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith("image/"));
      if (!file) return;
      event.preventDefault();
      void addImageRef.current(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const draft = {
    title: title.trim() || t`Your title`,
    body: body.trim(),
    image,
    offerReload,
    createdAt: new Date().toISOString(),
    authorName: null,
  };

  const send = async () => {
    setSending(true);
    try {
      await rpc.companyAdmin.announcements.send({ title: title.trim(), body: body.trim(), image, offerReload });
      setTitle("");
      setBody("");
      setImage(null);
      setOfferReload(true);
      setPreviewing(false);
      toast.success(t`Sent. Everyone with the app open sees it now.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: LIST_KEY }),
        queryClient.invalidateQueries({ queryKey: PENDING_ANNOUNCEMENTS_KEY }),
      ]);
    } catch (error) {
      toast.error(errorText(error, t`Couldn't send the announcement`));
    } finally {
      setSending(false);
    }
  };

  const withdraw = async (item: AdminAnnouncement) => {
    try {
      await rpc.companyAdmin.announcements.withdraw({ id: item.id });
      toast.success(t`Withdrawn. People who haven't seen it won't be shown it.`);
      await queryClient.invalidateQueries({ queryKey: LIST_KEY });
    } catch (error) {
      toast.error(errorText(error, t`Couldn't withdraw the announcement`));
    }
  };

  const canSend = title.trim().length > 0 && !preparing && !sending;

  return (
    <section className="space-y-8">
      <div>
        <h2 className="text-base font-medium">
          <Trans>Announcements</Trans>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <Trans>
            Tell everyone about new features and changes. It pops up straight away for everyone with the app
            open, and for everyone else when they next open it, until they dismiss it.
          </Trans>
        </p>
      </div>

      <div className="space-y-4 rounded-xl border border-border p-4">
        <Field>
          <FieldLabel htmlFor={`${ids}-title`}>
            <Trans>Title</Trans>
          </FieldLabel>
          <Input
            id={`${ids}-title`}
            value={title}
            maxLength={120}
            placeholder={t`e.g. Project Programmes studio is here`}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${ids}-body`}>
            <Trans>Message</Trans>
          </FieldLabel>
          <Textarea
            id={`${ids}-body`}
            value={body}
            maxLength={4000}
            rows={4}
            placeholder={t`What changed and how to use it.`}
            onChange={(event) => setBody(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel>
            <Trans>Screenshot</Trans>
          </FieldLabel>
          {image ? (
            <div className="relative overflow-hidden rounded-lg border border-border bg-muted/40">
              <img src={image} alt={t`Screenshot to send`} className="block max-h-72 w-full object-contain" />
              <Button
                variant="secondary"
                size="icon-sm"
                className="absolute end-2 top-2"
                aria-label={t`Remove screenshot`}
                onClick={() => setImage(null)}
              >
                <X />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void addImage(event.dataTransfer.files[0]);
              }}
              className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground transition-colors hover:bg-accent"
            >
              {preparing ? <Spinner className="size-5" /> : <ImagePlus className="size-5" aria-hidden="true" />}
              <span>
                <Trans>Paste a screenshot, drop one here, or click to choose a file</Trans>
              </span>
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              void addImage(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </Field>
        <label className="flex items-center justify-between gap-4" htmlFor={`${ids}-reload`}>
          <span>
            <span className="block text-sm font-medium">
              <Trans>Show "Reload to update"</Trans>
            </span>
            <FieldDescription>
              <Trans>For changes people only get after reloading the app, such as a new studio.</Trans>
            </FieldDescription>
          </span>
          <Switch id={`${ids}-reload`} checked={offerReload} onCheckedChange={setOfferReload} />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={!title.trim()} onClick={() => setPreviewing(true)}>
            <Trans>Preview</Trans>
          </Button>
          <Button disabled={!canSend} onClick={() => void send()}>
            <Megaphone aria-hidden="true" />
            {sending ? <Trans>Sending…</Trans> : <Trans>Send to everyone</Trans>}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="px-1 text-sm font-medium">
          <Trans>Sent</Trans>
        </h3>
        {list.isPending ? (
          <Spinner className="size-5 text-muted-foreground" />
        ) : list.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorText(list.error, t`Couldn't load announcements`)}
          </p>
        ) : list.data.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">
            <Trans>Nothing sent yet.</Trans>
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {list.data.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                {item.image ? (
                  <img src={item.image} alt="" className="h-10 w-16 shrink-0 rounded object-cover" />
                ) : (
                  <span className="flex h-10 w-16 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                    <Megaphone size={16} aria-hidden="true" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatRelativeTime(item.createdAt)}
                    {item.authorName ? ` · ${item.authorName}` : ""}
                    {" · "}
                    <Plural value={item.dismissedCount} one="Seen by # person" other="Seen by # people" />
                  </p>
                </div>
                {item.withdrawnAt ? (
                  <Badge variant="outline">
                    <Trans>Withdrawn</Trans>
                  </Badge>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => void withdraw(item)}>
                    <Trans>Withdraw</Trans>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <AnnouncementDialog
        announcement={draft}
        open={previewing}
        busy={sending}
        onDismiss={() => setPreviewing(false)}
        onReload={() => setPreviewing(false)}
      />
    </section>
  );
}
