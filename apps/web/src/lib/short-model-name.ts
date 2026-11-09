const SIZE = /^(mini|nano|pro)$/i;

/** A sidebar-sized model name: GPT-6, GPT-6.1, GPT-4o, Sonnet 4.5. */
export function shortModelName(modelId: string | null | undefined): string {
  const id = modelId?.split("/").pop()?.trim() ?? "";
  if (!id) return "";
  const gpt = id.match(/^gpt-(\d+(?:\.\d+)?)([a-z])?(?:-([a-z0-9-]+))?/i);
  if (gpt) {
    const version = `${gpt[1]}${gpt[2] ?? ""}`;
    const size = gpt[3]?.split("-").find((part) => SIZE.test(part));
    return size ? `GPT-${version} ${size.toLowerCase()}` : `GPT-${version}`;
  }
  const claude = id.match(/^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?/i);
  if (claude) {
    const family = claude[1]!.toLowerCase();
    const version = claude[3] ? `${claude[2]}.${claude[3]}` : claude[2];
    return `${family[0]!.toUpperCase()}${family.slice(1)} ${version}`;
  }
  const gemini = id.match(/^gemini-(\d+(?:\.\d+)?)/i);
  if (gemini) return `Gemini ${gemini[1]}`;
  const oSeries = id.match(/^(o\d+)(?:-(mini|pro))?/i);
  if (oSeries) {
    return oSeries[2]
      ? `${oSeries[1]!.toUpperCase()} ${oSeries[2].toLowerCase()}`
      : oSeries[1]!.toUpperCase();
  }
  return id.length > 18 ? `${id.slice(0, 16)}…` : id;
}
