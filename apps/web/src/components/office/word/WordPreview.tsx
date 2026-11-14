import { previewToDOM } from "@office-kit/docx-preview";
import { useEffect, useRef, useState } from "react";

/** A read-only page view, for files the editor cannot open. Loaded on its own. */
export default function WordPreview({
  bytes,
  label,
  failedText,
}: {
  bytes: ArrayBuffer;
  label: string;
  failedText: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let dispose: (() => void) | null = null;
    setFailed(false);
    previewToDOM(bytes.slice(0), element, {
      inWrapper: true,
      breakPages: true,
      renderFonts: true,
      experimentalChanges: true,
      experimentalComments: true,
    })
      .then((handle) => {
        if (disposed) handle.dispose();
        else dispose = () => handle.dispose();
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      dispose?.();
      element.replaceChildren();
    };
  }, [bytes]);

  return (
    <div className="size-full overflow-auto bg-muted/40">
      {failed ? (
        <p className="p-6 text-center text-[14px] text-muted-foreground">{failedText}</p>
      ) : null}
      <section ref={host} aria-label={label} className="mx-auto w-fit py-4" />
    </div>
  );
}
