/**
 * In the iOS and Android apps a download link replaces the chat with the file and leaves no way
 * back, so download clicks go to the native NativeFiles plugin instead: iOS previews the file in
 * Quick Look (Done returns to the chat, Share saves or sends it), Android saves it to Downloads.
 * Browsers have no plugin and keep their own downloads.
 */

type FilesBridge = {
  isPluginAvailable?: (name: string) => boolean;
  nativePromise?: (plugin: string, method: string, options?: object) => Promise<unknown>;
};

/** Single-use download routes: the native side must be the only one to fetch them. */
const DOWNLOAD_PATHS = new Set([
  "/api/artifacts/download",
  "/api/storage/download",
  "/api/account/export",
]);

const DOCUMENT = /\.(pdf|docx?|xlsx?|pptx?|csv|rtf|pages|numbers|key)$/i;

export type NativeDownload =
  | { kind: "url"; url: string; name?: string }
  | { kind: "inline"; url: string; name: string };

/** What a clicked link should hand to the native side, or null for an ordinary link. */
export function nativeDownloadFor(
  anchor: Pick<HTMLAnchorElement, "href" | "getAttribute" | "hasAttribute">,
  origin: string,
): NativeDownload | null {
  if (!anchor.href) return null;
  let url: URL;
  try {
    url = new URL(anchor.href, origin);
  } catch {
    return null;
  }
  const name = anchor.getAttribute("download") || undefined;
  if (url.protocol === "blob:" || url.protocol === "data:") {
    return anchor.hasAttribute("download")
      ? { kind: "inline", url: url.href, name: name ?? "download" }
      : null;
  }
  if (url.origin !== origin) {
    // A linked document (a signed library PDF, say) would otherwise leave the app for Safari.
    if (url.protocol !== "https:" || !DOCUMENT.test(url.pathname)) return null;
    return {
      kind: "url",
      url: url.href,
      name: decodeURIComponent(url.pathname.split("/").pop() ?? ""),
    };
  }
  if (DOWNLOAD_PATHS.has(url.pathname))
    return { kind: "url", url: url.href, ...(name ? { name } : {}) };
  // Anything else may need the session cookie, which only the page sends.
  return anchor.hasAttribute("download")
    ? { kind: "inline", url: url.href, name: name || url.pathname.split("/").pop() || "download" }
    : null;
}

function bridge(): FilesBridge | undefined {
  const cap = (globalThis as { Capacitor?: FilesBridge }).Capacitor;
  return cap?.isPluginAvailable?.("NativeFiles") ? cap : undefined;
}

const objectUrls = new Map<string, Blob>();

function base64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let start = 0; start < view.length; start += 0x8000) {
    binary += String.fromCharCode(...view.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

function open(cap: FilesBridge, download: NativeDownload) {
  if (download.kind === "url") {
    void cap.nativePromise?.("NativeFiles", "open", download)?.catch(() => undefined);
    return;
  }
  const made = objectUrls.get(download.url);
  const blob = made
    ? Promise.resolve(made)
    : fetch(download.url).then((response) => response.blob());
  void blob
    .then(async (file) =>
      cap.nativePromise?.("NativeFiles", "open", {
        name: download.name,
        mimeType: file.type || "application/octet-stream",
        base64: base64(await file.arrayBuffer()),
      }),
    )
    .catch(() => undefined);
}

/** Routes the app's downloads to the native plugin; does nothing in a browser. */
export function installNativeDownloads(): void {
  const cap = bridge();
  if (!cap) return;
  // WebKit in the app cannot fetch object URLs, and some callers revoke them straight after the
  // click, so each one keeps its file until shortly after it is revoked.
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  URL.createObjectURL = (object: Blob | MediaSource) => {
    const url = create(object);
    if (object instanceof Blob) objectUrls.set(url, object);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    revoke(url);
    window.setTimeout(() => objectUrls.delete(url), 60_000);
  };
  const click = HTMLAnchorElement.prototype.click;
  // Downloads are mostly a detached link clicked in code, which no document listener sees.
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    const download = nativeDownloadFor(this, window.location.origin);
    if (download) open(cap, download);
    else click.call(this);
  };
  document.addEventListener(
    "click",
    (event) => {
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      const download = anchor && nativeDownloadFor(anchor, window.location.origin);
      if (!download) return;
      event.preventDefault();
      open(cap, download);
    },
    true,
  );
}
