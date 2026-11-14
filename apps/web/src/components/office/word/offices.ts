/** The offices a new report's back cover can name; the document runners know each one. */
export const OCSC_OFFICES = [
  "Dublin",
  "Cork",
  "Galway",
  "Belfast",
  "London",
  "Birmingham",
] as const;

const OFFICE_KEY = "rakazo:word-office";

/** The offices with the last one picked first. */
export function orderedOffices(last: string | null): string[] {
  const offices: string[] = [...OCSC_OFFICES];
  if (!last || !offices.includes(last)) return offices;
  return [last, ...offices.filter((office) => office !== last)];
}

export function lastOffice(): string | null {
  try {
    return window.localStorage.getItem(OFFICE_KEY);
  } catch {
    return null;
  }
}

export function rememberOffice(office: string): void {
  try {
    window.localStorage.setItem(OFFICE_KEY, office);
  } catch {
    // The order is a convenience; nothing breaks without it.
  }
}
