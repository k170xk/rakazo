import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Spinner } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClipboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { SettingsGroup } from "./SettingsRows";

/**
 * The person's Outlook signature, pasted once; Microsoft does not let apps read it.
 * Settings shows it only to people who may send Outlook email.
 */
export function EmailSignatureSettings() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const options = queries.emailDrafts.signature.get.queryOptions({ input: {} });
  const saved = useQuery(options);
  const editor = useRef<HTMLDivElement>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // The server cleans the signature before storing it, so it is safe to show here.
    if (editor.current && saved.data && !dirty) editor.current.innerHTML = saved.data.html ?? "";
  }, [saved.data, dirty]);

  function paste(event: ClipboardEvent<HTMLDivElement>) {
    // Keeps Outlook's formatting and images; the server removes anything unsafe on save.
    const html = event.clipboardData.getData("text/html");
    if (!html) return;
    event.preventDefault();
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const node of doc.querySelectorAll(
      "script, style, meta, link, title, iframe, object, embed, form",
    )) {
      node.remove();
    }
    // Pasted markup runs in this page once inserted, so handlers and script links go first.
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
    document.execCommand("insertHTML", false, doc.body.innerHTML);
    setDirty(true);
  }

  async function save(html: string | null) {
    setPending(true);
    setError(null);
    setDone(false);
    try {
      const next = await rpc.emailDrafts.signature.set({ html });
      queryClient.setQueryData(options.queryKey, next);
      if (editor.current) editor.current.innerHTML = next.html ?? "";
      setDirty(false);
      setDone(true);
    } catch (err) {
      setError(errorText(err, t`Could not save your signature`));
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsGroup title={t`Signature`} data-testid="email-signature">
      <div className="space-y-3 px-4 py-3">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          <Trans>
            Added under every Outlook draft you create from a draft card. In Outlook, open Settings,
            then Signatures, select your signature, copy it and paste it below.
          </Trans>
        </p>
        {saved.isPending ? (
          <Spinner />
        ) : (
          // biome-ignore lint/a11y/useSemanticElements: a pasted signature keeps its formatting; a textarea holds plain text only.
          <div
            ref={editor}
            role="textbox"
            aria-multiline="true"
            aria-label={t`Email signature`}
            tabIndex={0}
            contentEditable={!pending}
            suppressContentEditableWarning
            onPaste={paste}
            onInput={() => {
              setDirty(true);
              setDone(false);
            }}
            className="min-h-[96px] rounded-lg border border-border bg-white p-3 text-[14px] text-black outline-none focus:ring-1 focus:ring-primary/60"
            style={{ fontFamily: "Aptos, Calibri, Arial, sans-serif" }}
          />
        )}
        {error ? (
          <p role="alert" className="text-[12.5px] text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          {done ? (
            <span className="me-auto text-[12.5px] text-muted-foreground">
              <Trans>Saved</Trans>
            </span>
          ) : null}
          {saved.data?.html ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => void save(null)}>
              <Trans>Remove</Trans>
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={pending || !dirty}
            onClick={() => void save(editor.current?.innerHTML ?? null)}
          >
            {pending ? <Spinner /> : <Trans>Save signature</Trans>}
          </Button>
        </div>
      </div>
    </SettingsGroup>
  );
}
