export function textFromUserBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((block) => {
      if (!block || typeof block !== "object" || !("kind" in block) || !("text" in block)) {
        return "";
      }
      if ((block as { kind: unknown }).kind !== "text") return "";
      return String((block as { text: unknown }).text ?? "");
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function formatRunSteering(texts: string[]): string | null {
  const notes = texts.map((text) => text.trim()).filter(Boolean);
  if (notes.length === 0) return null;
  if (notes.length === 1) {
    return `The user sent an update. Keep this desktop session and follow it now:\n${notes[0]}`;
  }
  return `The user sent updates. Keep this desktop session and follow them now:\n${notes
    .map((note) => `- ${note}`)
    .join("\n")}`;
}
