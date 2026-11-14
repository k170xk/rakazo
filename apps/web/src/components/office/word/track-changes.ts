const KEY = "rk.word.trackChanges.";

/** Whether the person's edits to this document are tracked; on unless they turned it off. */
export function readTrackChanges(rootArtifactId: string): boolean {
  try {
    return window.localStorage.getItem(KEY + rootArtifactId) !== "off";
  } catch {
    return true;
  }
}

export function rememberTrackChanges(rootArtifactId: string, on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(KEY + rootArtifactId);
    else window.localStorage.setItem(KEY + rootArtifactId, "off");
  } catch {
    // Private browsing: the choice lasts until the studio closes.
  }
}
