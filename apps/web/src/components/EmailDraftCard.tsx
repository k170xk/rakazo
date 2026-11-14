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
  ExternalLink,
  FilePenLine,
  Italic,
  Link2,
  List,
  ListOrdered,
  Mail,
  Paperclip,
  Trash2,
  Underline,
  X,
} from "lucide-react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

const EMAIL_PATTERN = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/;

/**
 * Where "Open in Outlook" should go. Phones open the Outlook app through its own address.
 * Computers use the https link the Outlook app has claimed, so the system can hand it over;
 * a plain Outlook website address, or a link that opens in a new tab, stays in the browser.
 */
export function outlookDraftAppLink(
  messageId: string | null | undefined,
  userAgent: string,
): string | null {
  const id = messageId?.trim();
  if (!id) return null;
  const encoded = encodeURIComponent(id);
  if (/iPhone|iPad|iPod|Android/i.test(userAgent)) {
    return `ms-outlook://emails/message/open?restID=${encoded}`;
  }
  return `https://outlook.office.com/mail/0/applink/read/${encoded}/?ai=1`;
}

type RecipientKey = "to" | "cc" | "bcc";

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

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function parseRecipientInput(
  raw: string,
  existing: readonly string[],
): { added: string[]; invalid: string[] } {
  const candidates = raw.split(/[,;\n]+/).flatMap((chunk) => {
    const trimmed = chunk.trim();
    if (!trimmed) return [];
    const angled = /^.*<([^>]+)>\s*$/.exec(trimmed);
    if (angled?.[1]) return [angled[1].trim().toLowerCase()];
    return trimmed
      .split(/\s+/)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
  });
  const added: string[] = [];
  const invalid: string[] = [];
  for (const candidate of candidates) {
    if (!EMAIL_PATTERN.test(candidate)) {
      invalid.push(candidate);
    } else if (!existing.includes(candidate) && !added.includes(candidate)) {
      added.push(candidate);
    }
  }
  return { added, invalid };
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function RecipientField({
  label,
  values,
  text,
  invalid,
  disabled,
  onChange,
  onTextChange,
}: {
  label: string;
  values: string[];
  text: string;
  invalid: boolean;
  disabled: boolean;
  onChange: (values: string[]) => void;
  onTextChange: (text: string, invalid: boolean) => void;
}) {
  const { t } = useLingui();

  function commit(raw = text): boolean {
    if (!raw.trim()) {
      if (text || invalid) onTextChange("", false);
      return true;
    }
    const { added, invalid: bad } = parseRecipientInput(raw, values);
    if (added.length) onChange([...values, ...added]);
    onTextChange(bad.join(", "), bad.length > 0);
    return bad.length === 0;
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (
      event.key === "Enter" ||
      event.key === "," ||
      event.key === ";" ||
      (event.key === "Tab" && text.trim().length > 0)
    ) {
      if (event.key !== "Tab") event.preventDefault();
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
            onChange={(event) => onTextChange(event.target.value, false)}
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

function cleanPastedSignatureHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const node of doc.querySelectorAll(
    "script, style, meta, link, title, iframe, object, embed, form",
  )) {
    node.remove();
  }
  for (const element of doc.body.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (
        name.startsWith("on") ||
        ((name === "href" || name === "src") && value.startsWith("javascript:"))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return doc.body.innerHTML;
}

function InlineSignatureEditor({
  initialHtml,
  onSaved,
  onCancel,
}: {
  initialHtml: string | null;
  onSaved: (html: string | null) => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const editor = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (editor.current) editor.current.innerHTML = initialHtml ?? "";
  }, [initialHtml]);

  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    const html = event.clipboardData.getData("text/html");
    if (!html) return;
    event.preventDefault();
    document.execCommand("insertHTML", false, cleanPastedSignatureHtml(html));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const raw = editor.current?.innerHTML ?? null;
      const result = await rpc.emailDrafts.signature.set({ html: raw });
      onSaved(result.html);
    } catch (err) {
      setError(errorText(err, t`Could not save your signature`));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted-foreground">
        <Trans>
          Copy your signature from Outlook (Settings → Signatures) and paste it below. It will be
          included on every draft you create.
        </Trans>
      </p>
      {/* biome-ignore lint/a11y/useSemanticElements: a pasted signature keeps its formatting; a textarea holds plain text only. */}
      <div
        ref={editor}
        role="textbox"
        aria-multiline="true"
        aria-label={t`Email signature`}
        tabIndex={0}
        contentEditable={!saving}
        suppressContentEditableWarning
        onPaste={onPaste}
        className="min-h-[76px] rounded-lg border border-border bg-white p-2.5 text-[13.5px] text-black outline-none focus:ring-1 focus:ring-primary/60"
        style={{ fontFamily: "Aptos, Calibri, Arial, sans-serif" }}
      />
      {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
        <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>
          {saving ? <Spinner /> : <Trans>Save signature</Trans>}
        </Button>
      </div>
    </div>
  );
}

export function EmailDraftCard({ draftId, version }: { draftId: string; version?: number }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const options = queries.emailDrafts.get.queryOptions({ input: { id: draftId } });
  const state = useQuery({ ...options, staleTime: 30_000 });
  const draft = state.data;

  useEffect(() => {
    if (version && draft && draft.version < version && !state.isFetching) {
      void state.refetch();
    }
  }, [version, draft, state.isFetching, state.refetch]);

  if (state.isPending) {
    return (
      <div className="flex w-[560px] max-w-full items-center gap-2 rounded-[20px] bg-card px-4 py-3 text-sm text-muted-foreground">
        <Spinner /> <Trans>Loading email draft</Trans>
      </div>
    );
  }
  if (!draft) {
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

  return (
    <EmailDraftEditor
      draft={draft}
      apply={(next) => queryClient.setQueryData(options.queryKey, next)}
      refetch={() => void state.refetch()}
    />
  );
}

function EmailDraftEditor({
  draft,
  apply,
  refetch,
}: {
  draft: EmailDraft;
  apply: (next: EmailDraft) => void;
  refetch: () => void;
}) {
  const { t, i18n } = useLingui();
  const [form, setForm] = useState<Form>(() => formOf(draft));
  const [bodyHtml, setBodyHtml] = useState(() => draft.bodyHtml);
  const [pendingRecipients, setPendingRecipients] = useState<Record<RecipientKey, string>>({
    to: "",
    cc: "",
    bcc: "",
  });
  const [invalidRecipients, setInvalidRecipients] = useState<Record<RecipientKey, boolean>>({
    to: false,
    cc: false,
    bcc: false,
  });
  const [busy, setBusy] = useState<"save" | "create" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCopies, setShowCopies] = useState(() => draft.cc.length > 0 || draft.bcc.length > 0);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [editingSignature, setEditingSignature] = useState(false);
  const [chatFiles, setChatFiles] = useState<EmailDraftAttachment[] | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const bodyInitialized = useRef(false);
  const syncedVersion = useRef(draft.version);

  useLayoutEffect(() => {
    if (!body.current) return;
    if (!bodyInitialized.current) {
      // The body comes back cleaned by the server, so it is safe to place in the editor.
      body.current.innerHTML = draft.bodyHtml;
      bodyInitialized.current = true;
      syncedVersion.current = draft.version;
      return;
    }
    if (draft.version !== syncedVersion.current) {
      syncedVersion.current = draft.version;
      setForm(formOf(draft));
      setBodyHtml(draft.bodyHtml);
      setPendingRecipients({ to: "", cc: "", bcc: "" });
      setInvalidRecipients({ to: false, cc: false, bcc: false });
      setShowCopies((shown) => shown || draft.cc.length > 0 || draft.bcc.length > 0);
      if (body.current.innerHTML !== draft.bodyHtml) {
        body.current.innerHTML = draft.bodyHtml;
      }
    }
  }, [draft]);

  const editable = draft.status === "draft" && busy === null;

  const hasChanges =
    !sameList(form.to, draft.to) ||
    !sameList(form.cc, draft.cc) ||
    !sameList(form.bcc, draft.bcc) ||
    form.subject !== draft.subject ||
    bodyHtml !== draft.bodyHtml ||
    !sameList(
      form.attachments.map((file) => file.artifactId),
      draft.attachments.map((file) => file.artifactId),
    ) ||
    Boolean(
      pendingRecipients.to.trim() || pendingRecipients.cc.trim() || pendingRecipients.bcc.trim(),
    );

  function syncBody() {
    if (body.current) setBodyHtml(body.current.innerHTML);
  }

  function change(patch: Partial<Form>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function setRecipientText(field: RecipientKey, text: string, invalid: boolean) {
    setPendingRecipients((current) =>
      current[field] === text ? current : { ...current, [field]: text },
    );
    setInvalidRecipients((current) =>
      current[field] === invalid ? current : { ...current, [field]: invalid },
    );
    if (!invalid) setError(null);
  }

  function flushAllRecipients(): Pick<Form, "to" | "cc" | "bcc"> | null {
    const nextRecipients: Pick<Form, "to" | "cc" | "bcc"> = {
      to: form.to,
      cc: form.cc,
      bcc: form.bcc,
    };
    const nextPending: Record<RecipientKey, string> = { to: "", cc: "", bcc: "" };
    const nextInvalid: Record<RecipientKey, boolean> = { to: false, cc: false, bcc: false };
    const allInvalid: string[] = [];

    for (const key of ["to", "cc", "bcc"] as const) {
      const raw = pendingRecipients[key];
      if (!raw.trim()) continue;
      const { added, invalid } = parseRecipientInput(raw, nextRecipients[key]);
      if (added.length) nextRecipients[key] = [...nextRecipients[key], ...added];
      if (invalid.length) {
        nextPending[key] = invalid.join(", ");
        nextInvalid[key] = true;
        allInvalid.push(...invalid);
      }
    }

    setForm((current) => ({ ...current, ...nextRecipients }));
    setPendingRecipients(nextPending);
    setInvalidRecipients(nextInvalid);

    if (allInvalid.length > 0) {
      const badList = allInvalid.join(", ");
      setError(t`Enter valid email addresses: ${badList}`);
      return null;
    }
    return nextRecipients;
  }

  function format(command: string, value?: string) {
    body.current?.focus();
    document.execCommand(command, false, value);
    syncBody();
  }

  function addLink() {
    const url = window.prompt(t`Link address`, "https://");
    if (url && /^(https?:|mailto:)/i.test(url.trim())) format("createLink", url.trim());
  }

  async function run(kind: "save" | "create" | "discard") {
    if (kind === "discard") {
      setBusy("discard");
      setError(null);
      try {
        apply(await rpc.emailDrafts.discard({ id: draft.id }));
      } catch (err) {
        setError(errorText(err, t`Could not save this draft`));
        refetch();
      } finally {
        setBusy(null);
        setConfirmDiscard(false);
      }
      return;
    }

    const recipients = flushAllRecipients();
    if (!recipients) return;
    const currentBodyHtml = body.current ? body.current.innerHTML : bodyHtml;
    setBodyHtml(currentBodyHtml);
    setBusy(kind);
    setError(null);
    try {
      const payload = {
        id: draft.id,
        version: draft.version,
        to: recipients.to,
        cc: recipients.cc,
        bcc: recipients.bcc,
        subject: form.subject,
        bodyHtml: currentBodyHtml,
        attachmentIds: form.attachments.map((file) => file.artifactId),
      };
      const updated =
        kind === "create"
          ? await rpc.emailDrafts.createDraft(payload)
          : await rpc.emailDrafts.update(payload);
      apply(updated);
    } catch (err) {
      setError(
        errorText(
          err,
          kind === "create"
            ? t`Could not create this draft in Outlook`
            : t`Could not save this draft`,
        ),
      );
      refetch();
    } finally {
      setBusy(null);
      setConfirmDiscard(false);
    }
  }

  async function loadFiles() {
    if (chatFiles) return;
    try {
      setChatFiles(await rpc.emailDrafts.files({ id: draft.id }));
    } catch (err) {
      setError(errorText(err, t`Could not list the files in this chat`));
    }
  }

  const created = draft.status === "created";
  const sent = draft.status === "sent";
  const completed = created || sent;
  const sender = draft.from ?? "Outlook";
  const sentAt = draft.sentAt
    ? i18n.date(new Date(draft.sentAt), { dateStyle: "medium", timeStyle: "short" })
    : null;
  const createBlocked = Boolean(draft.cannotSend);
  const attached = new Set(form.attachments.map((file) => file.artifactId));
  const addable = (chatFiles ?? []).filter((file) => !attached.has(file.artifactId));

  return (
    <div
      data-testid="email-draft-card"
      className="w-[600px] max-w-full overflow-hidden rounded-[20px] border border-border/70 bg-card shadow-sm"
    >
      <div className="flex items-center gap-2.5 bg-primary px-4 py-2.5 text-primary-foreground">
        <Mail size={16} />
        <span className="text-[13.5px] font-semibold">
          {draft.mode === "new" ? <Trans>Outlook email</Trans> : <Trans>Outlook reply</Trans>}
        </span>
        <span className="ms-auto text-[12px] opacity-90">
          {created ? (
            <Trans>Saved in Outlook Drafts</Trans>
          ) : draft.status === "creating" ? (
            <Trans>Creating draft…</Trans>
          ) : sent ? (
            <Trans>Sent</Trans>
          ) : draft.status === "sending" ? (
            <Trans>Sending…</Trans>
          ) : (
            <Trans>Draft · creates a draft in Outlook</Trans>
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
          {!showCopies && !completed ? (
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
          text={pendingRecipients.to}
          invalid={invalidRecipients.to}
          disabled={!editable}
          onChange={(to) => change({ to })}
          onTextChange={(text, invalid) => setRecipientText("to", text, invalid)}
        />
        {showCopies ? (
          <>
            <RecipientField
              label={t`Cc`}
              values={form.cc}
              text={pendingRecipients.cc}
              invalid={invalidRecipients.cc}
              disabled={!editable}
              onChange={(cc) => change({ cc })}
              onTextChange={(text, invalid) => setRecipientText("cc", text, invalid)}
            />
            <RecipientField
              label={t`Bcc`}
              values={form.bcc}
              text={pendingRecipients.bcc}
              invalid={invalidRecipients.bcc}
              disabled={!editable}
              onChange={(bcc) => change({ bcc })}
              onTextChange={(text, invalid) => setRecipientText("bcc", text, invalid)}
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
          onInput={syncBody}
          onKeyUp={syncBody}
          onPaste={syncBody}
          onCut={syncBody}
          onBlur={syncBody}
          className={cn(
            "email-draft-body mt-1 min-h-[120px] rounded-lg px-1 py-2 text-[14px] leading-relaxed outline-none",
            "[&_a]:text-primary [&_a]:underline [&_blockquote]:border-s-2 [&_blockquote]:ps-3 [&_ol]:list-decimal [&_ol]:ps-6 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:ps-6",
            editable && "focus:ring-1 focus:ring-primary/60",
          )}
        />

        <div className="mt-2 border-t border-dashed border-border/70 pt-2">
          {editingSignature && editable ? (
            <InlineSignatureEditor
              initialHtml={draft.signatureHtml}
              onCancel={() => setEditingSignature(false)}
              onSaved={(signatureHtml) => {
                setEditingSignature(false);
                apply({ ...draft, signatureHtml });
              }}
            />
          ) : draft.signatureHtml ? (
            <div className="space-y-1">
              <SignaturePreview html={draft.signatureHtml} />
              {editable ? (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setEditingSignature(true)}
                    className="text-[12px] text-muted-foreground hover:text-foreground"
                  >
                    <Trans>Edit signature</Trans>
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12.5px] text-muted-foreground">
                <Trans>
                  No signature saved. Paste your Outlook signature here or under Settings → Email
                  signature.
                </Trans>
              </p>
              {editable ? (
                <button
                  type="button"
                  onClick={() => setEditingSignature(true)}
                  className="shrink-0 text-[12.5px] font-medium text-primary hover:underline"
                >
                  <Trans>Paste signature</Trans>
                </button>
              ) : null}
            </div>
          )}
        </div>

        {form.attachments.length || (editable && !completed) ? (
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

        {created ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success/25 bg-success/10 px-3.5 py-2.5">
            <div className="flex min-w-0 items-start gap-2">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-[13px] font-medium text-success">
                  {sentAt ? (
                    <Trans>
                      Draft created in {sender} on {sentAt}
                    </Trans>
                  ) : (
                    <Trans>Draft created in {sender}</Trans>
                  )}
                </p>
                <p className="text-[12px] text-muted-foreground">
                  <Trans>Open your Outlook Drafts folder to review and send this email.</Trans>
                </p>
              </div>
            </div>
            <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <a
                href={
                  outlookDraftAppLink(draft.outlookMessageId, navigator.userAgent) ||
                  draft.outlookWebLink ||
                  "https://outlook.office.com/mail/drafts"
                }
                rel="noopener"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground hover:opacity-90"
              >
                <Trans>Open in Outlook</Trans>
                <ExternalLink size={13} />
              </a>
              {draft.outlookWebLink ? (
                <a
                  href={draft.outlookWebLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12.5px] text-muted-foreground underline-offset-2 hover:underline"
                >
                  <Trans>Open in the browser</Trans>
                </a>
              ) : null}
            </span>
          </div>
        ) : sent ? (
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
              {hasChanges ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void run("save")}
                >
                  {busy === "save" ? <Spinner /> : <Trans>Save changes</Trans>}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                disabled={busy !== null || createBlocked}
                onClick={() => void run("create")}
                className="gap-1.5"
              >
                {busy === "create" ? <Spinner /> : <FilePenLine size={14} />}
                <Trans>Create draft</Trans>
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
