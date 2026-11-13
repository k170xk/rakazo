/**
 * Where a previewed element was written ("App.tsx:12:7"). HTML elements carry it as data-loc;
 * kit components carry it as a class, which they pass on to the element they draw.
 */
export const LOC_CLASS_PREFIX = "ocsc@";

export function locClass(loc: string): string {
  return `${LOC_CLASS_PREFIX}${loc.replaceAll(":", "@")}`;
}

export function locFromClass(name: string): string | null {
  return name.startsWith(LOC_CLASS_PREFIX)
    ? name.slice(LOC_CLASS_PREFIX.length).replaceAll("@", ":")
    : null;
}
