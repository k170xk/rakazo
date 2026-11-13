/** OCSC's UK and Irish staff share one company across both email domains. */
const STAFF_DOMAINS = new Set(["ocsc.co.uk", "ocsc.ie"]);

const domainOf = (email: string) => email.trim().toLowerCase().split("@").pop() ?? "";

/** Whether two verified work emails belong to the same company: both OCSC staff, else one domain. */
export function sameCompanyEmail(viewer: string, owner: string) {
  const a = domainOf(viewer);
  const b = domainOf(owner);
  if (!a || !b) return false;
  return a === b || (STAFF_DOMAINS.has(a) && STAFF_DOMAINS.has(b));
}
