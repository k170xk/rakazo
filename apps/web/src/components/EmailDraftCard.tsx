import { Trans, useLingui } from "@lingui/react/macro";
import type { EmailDraft, EmailDraftAttachment } from "@rakazo/contracts";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Spinner,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bold,
  CheckCircle2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Mail,
  Paperclip,
  Send,
  Trash2,
  Underline,
  X,
} from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

const EMAIL_PATTERN = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/;

type Form = {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  attachments: EmailDraftAttachment[];
};

function formOf(draft: EmailDraft): Form {
  return {
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    attachments: draft.attachments,
  };
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function RecipientField({
  label,
  values,
  disabled,
  onChange,
}: {
  label: string;
  values: string[];
  disabled: boolean;
  onChange: (values: string[]) => void;
}) {
  const { t } = useLingui();
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);

  function commit(raw = text): boolean {
    const parts = raw
      .split(/[,;\s]+/)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
    if (parts.length === 0) return true;
    const bad = parts.filter((part) => !EMAIL_PATTERN.test(part));
    const good = parts.filter((part) => EMAIL_PATTERN.test(part) && !values.includes(part));
    if (good.length) onChange([...values, ...good]);
    setText(bad.join(", "));
    setInvalid(bad.length > 0);
    return bad.length === 0;
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "," || event.key === ";") {
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && !text && values.length) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className="flex items-start gap-2 border-b border-border/60 py-1.5">
      <span className="w-12 shrink-0 pt-1 text-[12.5px] text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[12.5px]"
          >
            <span className="truncate">{value}</span>
            {disabled ? null : (
              <button
                type="button"
                aria-label={t`Remove ${value}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => onChange(values.filter((entry) => entry !== value))}
              >
                <X size={12} />
              </button>
            )}
          </span>
        ))}
        {disabled ? null : (
          <input
            value={text}
            aria-label={label}
            aria-invalid={invalid}
            onChange={(event) => {
              setText(event.target.value);
              setInvalid(false);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => commit()}
            placeholder={values.length ? "" : t`Add an email address`}
            className={cn(
              "min-w-[140px] flex-1 bg-transparent py-0.5 text-[13px] outline-none",
              invalid && "text-destructive",
            )}
          />
        )}
      </div>
    </div>
  );
}

/** Shows the saved signature as Outlook will, without running anything inside it. */
function SignaturePreview({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(80);
  return (
    <iframe
      ref={frame}
      title="Signature"
      sandbox="allow-same-origin"
      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:Aptos,Calibri,Arial,sans-serif;font-size:11pt;color:black;background:white}</style></head><body>${html}</body></html>`}
      onLoad={() => {
        const body = frame.current?.contentDocument?.body;
        if (body) setHeight(Math.min(Math.max(body.scrollHeight, 24), 400));
      }}
      style={{ height }}
      className="w-full rounded-md border-0 bg-white"
    />
  );
}

export function EmailDraftCard({ draftId }: { draftId: string }) {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const options = queries.emailDrafts.get.queryOptions({ input: { id: draftId } });
  const state = useQuery({ ...options, staleTime: 30_000 });
  const draft = state.data;
  const [form, setForm] = useState<Form | null>(null);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "send" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCopies, setShowCopies] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [chatFiles, setChatFiles] = useState<EmailDraftAttachment[] | null>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!draft || draft.version === version) return;
    setForm(formOf(draft));
    setVersion(draft.version);
    setDirty(false);
    setShowCopies((shown) => shown || draft.cc.length > 0 || draft.bcc.length > 0);
    // The body comes back cleaned by the server, so it is safe to place in the editor.
    if (body.current) body.current.innerHTML = draft.bodyHtml;
  }, [draft, version]);

  const editable = draft?.status === "draft" && busy === null;

  function change(patch: Partial<Form>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
  }

  function format(command: string, value?: string) {
    body.current?.focus();
    document.execCommand(command, false, value);
    setDirty(true);
  }

  function addLink() {
    const url = window.prompt(t`Link address`, "https://");
    if (url && /^(https?:|mailto:)/i.test(url.trim())) format("createLink", url.trim());
  }

  function apply(next: EmailDraft) {
    queryClient.setQueryData(options.queryKey, next);
  }

  async function saveNow(): Promise<EmailDraft | null> {
    if (!draft || !form) return null;
    const saved = await rpc.emailDrafts.update({
      id: draft.id,
      version: draft.version,
      to: form.to,
      cc: form.cc,
      bcc: form.bcc,
      subject: form.subject,
      bodyHtml: body.current?.innerHTML ?? draft.bodyHtml,
      attachmentIds: form.attachments.map((file) => file.artifactId),
    });
    apply(saved);
    return saved;
  }

  async function run(kind: "save" | "send" | "discard") {
    if (!draft) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === "discard") {
        apply(await rpc.emailDrafts.discard({ id: draft.id }));
      } else {
        const latest = dirty || kind === "save" ? await saveNow() : draft;
        if (kind === "send" && latest) {
          apply(await rpc.emailDrafts.send({ id: latest.id, version: latest.version }));
        }
      }
    } catch (err) {
      setError(
        errorText(
          err,
          kind === "send" ? t`Could not send this email` : t`Could not save this draft`,
        ),
      );
      void state.refetch();
    } finally {
      setBusy(null);
      setConfirmDiscard(false);
    }
  }

  async function loadFiles() {
    if (chatFiles || !draft) return;
    try {
      setChatFiles(await rpc.emailDrafts.files({ id: draft.id }));
    } catch (err) {
      setError(errorText(err, t`Could not list the files in this chat`));
    }
  }

  if (state.isPending) {
    return (
      <div className="flex w-[560px] max-w-full items-center gap-2 rounded-[20px] bg-card px-4 py-3 text-sm text-muted-foreground">
        <Spinner /> <Trans>Loading email draft</Trans>
      </div>
    );
  }
  if (!draft || !form) {
    return (
      <div className="w-[560px] max-w-full rounded-[20px] bg-card px-4 py-3 text-sm text-muted-foreground">
        {errorText(state.error, t`This email draft is not available`)}
      </div>
    );
  }

  if (draft.status === "discarded") {
    return (
      <div className="flex w-[560px] max-w-full items-center gap-2 rounded-[20px] bg-card px-4 py-3 text-sm text-muted-foreground">
        <Mail size={16} /> <Trans>Email draft discarded: {draft.subject || t`(no subject)`}</Trans>
      </div>
    );
  }

  const sent = draft.status === "sent";
  const sender = draft.from ?? "Outlook";
  const sentAt = draft.sentAt
    ? i18n.date(new Date(draft.sentAt), { dateStyle: "medium", timeStyle: "short" })
    : null;
  const sendBlocked =
    Boolean(draft.cannotSend) || form.to.length + form.cc.length + form.bcc.length === 0;
  const attached = new Set(form.attachments.map((file) => file.artifactId));
  const addable = (chatFiles ?? []).filter((file) => !attached.has(file.artifactId));

  return (
    <div className="w-[600px] max-w-full overflow-hidden rounded-[20px] border border-border/70 bg-card shadow-sm">
      <div className="flex items-center gap-2.5 bg-primary px-4 py-2.5 text-primary-foreground">
        <Mail size={16} />
        <span className="text-[13.5px] font-semibold">
          {draft.mode === "new" ? <Trans>Outlook email</Trans> : <Trans>Outlook reply</Trans>}
        </span>
        <span className="ms-auto text-[12px] opacity-90">
          {sent ? (
            <Trans>Sent</Trans>
          ) : draft.status === "sending" ? (
            <Trans>Sending…</Trans>
          ) : (
            <Trans>Draft · not sent until you press Send</Trans>
          )}
        </span>
      </div>

      <div className="px-4 pb-3 pt-1">
        {draft.replyTo ? (
          <div className="border-b border-border/60 py-1.5 text-[12.5px] text-muted-foreground">
            <Trans>
              Replying to {draft.replyTo.from}: “{draft.replyTo.subject}”
            </Trans>
          </div>
        ) : null}
        <div className="flex items-center gap-2 border-b border-border/60 py-1.5">
          <span className="w-12 shrink-0 text-[12.5px] text-muted-foreground">
            <Trans>From</Trans>
          </span>
          <span className="truncate text-[13px]">{draft.from ?? t`Outlook not connected`}</span>
          {!showCopies && !sent ? (
            <button
              type="button"
              className="ms-auto text-[12.5px] text-muted-foreground hover:text-foreground"
              onClick={() => setShowCopies(true)}
            >
              <Trans>Cc / Bcc</Trans>
            </button>
          ) : null}
        </div>
        <RecipientField
          label={t`To`}
          values={form.to}
          disabled={!editable}
          onChange={(to) => change({ to })}
        />
        {showCopies ? (
          <>
            <RecipientField
              label={t`Cc`}
              values={form.cc}
              disabled={!editable}
              onChange={(cc) => change({ cc })}
            />
            <RecipientField
              label={t`Bcc`}
              values={form.bcc}
              disabled={!editable}
              onChange={(bcc) => change({ bcc })}
            />
          </>
        ) : null}
        <div className="flex items-center gap-2 border-b border-border/60 py-1.5">
          <span className="w-12 shrink-0 text-[12.5px] text-muted-foreground">
            <Trans>Subject</Trans>
          </span>
          <input
            value={form.subject}
            disabled={!editable}
            aria-label={t`Subject`}
            onChange={(event) => change({ subject: event.target.value })}
            className="min-w-0 flex-1 bg-transparent text-[13.5px] font-medium outline-none"
          />
        </div>

        {editable ? (
          <div className="flex items-center gap-0.5 pt-2" role="toolbar" aria-label={t`Formatting`}>
            {[
              { icon: Bold, label: t`Bold`, run: () => format("bold") },
              { icon: Italic, label: t`Italic`, run: () => format("italic") },
              { icon: Underline, label: t`Underline`, run: () => format("underline") },
              { icon: List, label: t`Bulleted list`, run: () => format("insertUnorderedList") },
              {
                icon: ListOrdered,
                label: t`Numbered list`,
                run: () => format("insertOrderedList"),
              },
              { icon: Link2, label: t`Link`, run: addLink },
            ].map((tool) => (
              <Button
                key={tool.label}
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={tool.label}
                title={tool.label}
                onMouseDown={(event) => event.preventDefault()}
                onClick={tool.run}
              >
                <tool.icon size={15} />
              </Button>
            ))}
          </div>
        ) : null}
        {/* biome-ignore lint/a11y/useSemanticElements: formatted text needs an editable region; a textarea holds plain text only. */}
        <div
          ref={body}
          role="textbox"
          aria-multiline="true"
          aria-label={t`Email body`}
          tabIndex={0}
          contentEditable={editable}
          suppressContentEditableWarning
          onInput={() => setDirty(true)}
          className={cn(
            "email-draft-body mt-1 min-h-[120px] rounded-lg px-1 py-2 text-[14px] leading-relaxed outline-none",
            "[&_a]:text-primary [&_a]:underline [&_blockquote]:border-s-2 [&_blockquote]:ps-3 [&_ol]:list-decimal [&_ol]:ps-6 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:ps-6",
            editable && "focus:ring-1 focus:ring-primary/60",
          )}
        />

        <div className="mt-2 border-t border-dashed border-border/70 pt-2">
          {draft.signatureHtml ? (
            <SignaturePreview html={draft.signatureHtml} />
          ) : (
            <p className="text-[12.5px] text-muted-foreground">
              <Trans>
                No signature saved. Paste your Outlook signature in Settings, under Email signature.
              </Trans>
            </p>
          )}
        </div>

        {form.attachments.length || (editable && !sent) ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {form.attachments.map((file) => (
              <span
                key={file.artifactId}
                className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border/70 px-2 py-1 text-[12.5px]"
              >
                <Paperclip size={13} className="text-muted-foreground" />
                <span className="max-w-[220px] truncate">{file.name}</span>
                <span className="text-muted-foreground">{fileSize(file.size)}</span>
                {editable ? (
                  <button
                    type="button"
                    aria-label={t`Remove ${file.name}`}
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      change({
                        attachments: form.attachments.filter(
                          (entry) => entry.artifactId !== file.artifactId,
                        ),
                      })
                    }
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </span>
            ))}
            {editable ? (
              <DropdownMenu onOpenChange={(open) => open && void loadFiles()}>
                <DropdownMenuTrigger className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] text-muted-foreground hover:bg-muted hover:text-foreground">
                  <Paperclip size={13} /> <Trans>Attach from chat</Trans>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72 w-72 overflow-y-auto">
                  {chatFiles === null ? (
                    <DropdownMenuItem disabled>
                      <Trans>Loading files…</Trans>
                    </DropdownMenuItem>
                  ) : addable.length === 0 ? (
                    <DropdownMenuItem disabled>
                      <Trans>No other files in this chat</Trans>
                    </DropdownMenuItem>
                  ) : (
                    addable.map((file) => (
                      <DropdownMenuItem
                        key={file.artifactId}
                        onClick={() => change({ attachments: [...form.attachments, file] })}
                      >
                        <span className="truncate">{file.name}</span>
                        <span className="ms-auto shrink-0 text-muted-foreground">
                          {fileSize(file.size)}
                        </span>
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ) : null}

        {draft.error || error ? (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive"
          >
            {error ?? draft.error}
          </p>
        ) : null}
        {draft.status === "draft" && draft.cannotSend ? (
          <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-[12.5px] text-muted-foreground">
            {draft.cannotSend}
          </p>
        ) : null}

        {sent ? (
          <div className="mt-3 flex items-center gap-2 text-[13px] text-success">
            <CheckCircle2 size={16} />
            {sentAt ? (
              <Trans>
                Sent from {sender} on {sentAt}
              </Trans>
            ) : (
              <Trans>Sent from {sender}</Trans>
            )}
          </div>
        ) : draft.status === "draft" ? (
          <div className="mt-3 flex items-center gap-2">
            {confirmDiscard ? (
              <>
                <span className="text-[12.5px] text-muted-foreground">
                  <Trans>Discard this draft?</Trans>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => setConfirmDiscard(false)}
                >
                  <Trans>Keep</Trans>
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void run("discard")}
                >
                  <Trans>Discard</Trans>
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground"
                disabled={busy !== null}
                onClick={() => setConfirmDiscard(true)}
              >
                <Trash2 size={14} /> <Trans>Discard</Trans>
              </Button>
            )}
            <div className="ms-auto flex items-center gap-2">
              {dirty ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void run("save")}
                >
                  {busy === "save" ? <Spinner /> : <Trans>Save draft</Trans>}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                disabled={busy !== null || sendBlocked}
                onClick={() => void run("send")}
                className="gap-1.5"
              >
                {busy === "send" ? <Spinner /> : <Send size={14} />}
                <Trans>Send</Trans>
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
