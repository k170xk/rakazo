import { z } from "zod";
import type { EvolvePluginsConnection } from "./evolve-plugins.js";
import { callEvolveAssistants } from "./evolve-plugins.js";

const EvolveContractDocSchema = z.object({
  key: z.string(),
  name: z.string(),
  fileKind: z.enum(["docx", "pdf"]),
  source: z.enum(["primary", "supporting", "revision", "email"]),
  isPrimary: z.boolean(),
  size: z.number().nullable().optional(),
  dateIso: z.string().nullable().optional(),
  context: z.string().nullable().optional(),
  signedUrl: z.string().url(),
});

const EvolveClauseLibraryItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string().nullable().optional(),
  pattern: z.string().nullable().optional(),
  severity: z.string(),
  recommendedResponse: z.string().nullable().optional(),
  exampleRedline: z.string().nullable().optional(),
});

const EvolveContractFindingSchema = z.object({
  id: z.string(),
  clauseNumber: z.string().nullable().optional(),
  severity: z.string(),
  concern: z.string(),
  suggestedText: z.string().nullable().optional(),
  status: z.string(),
  source: z.string(),
});

export const EvolveContractBundleSchema = z.object({
  contract: z.object({
    id: z.string().uuid(),
    title: z.string(),
    jobNumber: z.string().nullable().optional(),
    clientName: z.string().nullable().optional(),
    discipline: z.string().nullable().optional(),
    sectors: z.array(z.string()).default([]),
    contractSide: z.string().nullable().optional(),
    deadline: z.string().nullable().optional(),
    constructionValue: z.number().nullable().optional(),
    feeValue: z.number().nullable().optional(),
    currency: z.string().nullable().optional(),
    scope: z.string().nullable().optional(),
    counterpartySolicitorName: z.string().nullable().optional(),
    counterpartySolicitorFirm: z.string().nullable().optional(),
    counterpartySolicitorEmail: z.string().nullable().optional(),
    designAndBuild: z.boolean().default(false),
    collateralWarranty: z.boolean().default(false),
    ndaRequired: z.boolean().default(false),
    status: z.string(),
    intakeAiNotes: z.string().nullable().optional(),
    aiOverallSummary: z.string().nullable().optional(),
  }),
  documents: z.array(EvolveContractDocSchema).default([]),
  clauseLibrary: z.array(EvolveClauseLibraryItemSchema).default([]),
  existingFindings: z.array(EvolveContractFindingSchema).default([]),
});

export type EvolveContractBundle = z.infer<typeof EvolveContractBundleSchema>;
export type EvolveContractDoc = z.infer<typeof EvolveContractDocSchema>;
export type EvolveClauseLibraryItem = z.infer<typeof EvolveClauseLibraryItemSchema>;

export async function fetchEvolveContractBundle(
  connection: EvolvePluginsConnection,
  email: string,
  contractId: string,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<EvolveContractBundle> {
  const payload = await callEvolveAssistants(
    connection,
    email,
    { action: "legal.contractBundle", contractId },
    options,
  );
  return EvolveContractBundleSchema.parse(payload);
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function sortClauses(clauses: readonly EvolveClauseLibraryItem[]): EvolveClauseLibraryItem[] {
  return [...clauses].sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity.toLowerCase()] ?? 9;
    const sb = SEVERITY_ORDER[b.severity.toLowerCase()] ?? 9;
    if (sa !== sb) return sa - sb;
    return a.title.localeCompare(b.title);
  });
}

/** Markdown reference of all active OCSC Clause Library entries, uploaded into the contract agent's workspace. */
export function buildClauseLibraryMarkdown(clauses: readonly EvolveClauseLibraryItem[]): string {
  const sorted = sortClauses(clauses);
  const lines: string[] = [
    "# OCSC Legal Clause Library (Active Positions & Redlines)",
    "",
    `Total active rules: ${sorted.length}`,
    "",
  ];
  for (const [index, clause] of sorted.entries()) {
    const badge = clause.severity.toUpperCase();
    const cat = clause.category ? ` — ${clause.category}` : "";
    lines.push(`## ${index + 1}. [${badge}] ${clause.title}${cat}`);
    if (clause.pattern) lines.push(`- **Watch / Trigger Pattern:** ${clause.pattern}`);
    if (clause.recommendedResponse)
      lines.push(`- **OCSC Standard Position:** ${clause.recommendedResponse}`);
    if (clause.exampleRedline) lines.push(`- **Preferred Redline Wording:** ${clause.exampleRedline}`);
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

function formatMoney(value: number | null | undefined, currency: string | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const code = currency || "EUR";
  return `${code} ${value.toLocaleString("en-GB")}`;
}

/** Tailored senior legal red-pen reviewer instructions for a single Evolve contract agent. */
export function buildContractAgentInstructions(bundle: EvolveContractBundle): string {
  const c = bundle.contract;
  const metaLines = [
    `Contract Title: ${c.title}`,
    c.jobNumber ? `Job Number: ${c.jobNumber}` : null,
    c.clientName ? `Client: ${c.clientName}` : null,
    c.discipline ? `Discipline: ${c.discipline}` : null,
    c.sectors.length ? `Sectors: ${c.sectors.join(", ")}` : null,
    c.contractSide ? `Contract Side: ${c.contractSide}` : null,
    c.counterpartySolicitorName || c.counterpartySolicitorFirm
      ? `Counterparty Solicitor: ${[c.counterpartySolicitorName, c.counterpartySolicitorFirm, c.counterpartySolicitorEmail].filter(Boolean).join(" · ")}`
      : null,
    c.deadline ? `Review Deadline: ${c.deadline}` : null,
    c.constructionValue ? `Construction Value: ${formatMoney(c.constructionValue, c.currency)}` : null,
    c.feeValue ? `OCSC Fee Value: ${formatMoney(c.feeValue, c.currency)}` : null,
    `Flags: Design & Build=${c.designAndBuild ? "Yes" : "No"}, Collateral Warranty=${c.collateralWarranty ? "Yes" : "No"}, NDA=${c.ndaRequired ? "Yes" : "No"}`,
    c.scope ? `Scope: ${c.scope}` : null,
  ].filter(Boolean);

  const sortedClauses = sortClauses(bundle.clauseLibrary);
  const compactClauses = sortedClauses
    .slice(0, 40)
    .map((cl, i) => {
      const bits = [
        `${i + 1}. [${cl.severity.toUpperCase()}] ${cl.title}${cl.category ? ` (${cl.category})` : ""}`,
        cl.pattern ? `Trigger: ${cl.pattern}` : null,
        cl.recommendedResponse ? `Position: ${cl.recommendedResponse}` : null,
        cl.exampleRedline ? `Redline: ${cl.exampleRedline}` : null,
      ].filter(Boolean);
      return bits.join(" | ");
    })
    .join("\n");

  const docSummary = bundle.documents
    .map(
      (d, i) =>
        `${i + 1}. ${d.name} (${d.fileKind.toUpperCase()}, ${d.source}${d.isPrimary ? ", PRIMARY" : ""}${d.context ? ` — ${d.context}` : ""})`,
    )
    .join("\n");

  return `You are OCSC's dedicated Legal Contract Red-Pen Reviewer for the contract "${c.title}" (O'Connor Sutton Cronin — UK & Ireland civil, structural, MEP and environmental engineering consultancy).

CONTRACT METADATA
${metaLines.join("\n")}

SYNCED CONTRACT DOCUMENTS
${docSummary || "No documents attached yet."}

MISSION & TWO-LAYER RED-PEN METHODOLOGY
When reviewing or red-penning this contract, ALWAYS work thoroughly in two layers:
1. OCSC Clause Library Audit: Check the contract line-by-line against EVERY active OCSC Clause Library rule below (and read the full attached OCSC-Clause-Library.md file if there are more than 40 rules).
2. Wider Legal & Commercial Risk Review: Independently scrutinise the entire agreement for any other onerous or unusual engineering-consultancy exposures even if not listed in the Clause Library — including:
   - Standard of care (fitness for purpose / strict compliance / "highest standards" vs reasonable skill, care and diligence)
   - Liability caps (uncapped liability, carve-outs, aggregate vs each-and-every-claim, consequential/indirect loss exclusions, net contribution clause, limitation period 6 vs 12 years)
   - Professional Indemnity Insurance (limit, aggregate vs each-and-every, commercially reasonable rates caveat, run-off period, pollution/asbestos/fire/cladding exclusions)
   - Indemnities (broad third-party or client indemnities that bypass PI cover or negligence fault)
   - Collateral warranties, third-party rights & novation (limit on number of warranties, no greater liability, equivalent rights of defence, step-in notice periods, novation consent & fee payment before novation)
   - Intellectual Property / Copyright (licence vs assignment, payment-conditional licence, no liability for unauthorised modification/reuse)
   - Payment, suspension, set-off & termination (Housing Grants / Construction Contracts Act compliance, no pay-when-paid, right to suspend for non-payment, termination for convenience compensation, limit on set-off/withholding)
   - Programme, liquidated damages, strict time obligations & scope creep (reasonable endeavours vs absolute dates, variation/additional fee mechanism)
   - Deed execution, governing law/jurisdiction (Ireland vs England & Wales/Scotland/NI), confidentiality/NDA traps, and missing schedules/definitions.

HOW TO PERFORM A REAL WORD RED-PEN REVIEW (CRITICAL)
- ALWAYS read the ENTIRE contract thoroughly first using \`ocsc-word read\` (for .docx) or \`ocsc-pdf read\` (for .pdf), paginating with \`--from\` / \`--find\` so no middle pages or schedules are skipped! Also check \`comments\` returned by \`ocsc-word read\` to see any counterparty solicitor comments already in the file.
- When an editable \`.docx\` contract is available, ALWAYS red-pen the actual Word file using \`ocsc-word edit --in <contract.docx> --spec work/redpen-edits.json --out outputs/<Contract-Name>-RedPen.docx\` (NEVER add \`--clean\`, and NEVER rebuild the contract from scratch with \`ocsc-word new\` — preserve the counterparty's exact formatting, numbering, tables and schedules!).
- Apply BOTH:
  1. **Word Tracked Changes** (\`replace_text\`, \`replace_paragraphs\`, \`delete_section\`) so every deletion and insertion appears as genuine redline markup in Microsoft Word and Rakazo's Word Studio (where the user can accept/reject each edit individually); AND
  2. **Word Margin Comments** by setting \`"comment": "[Severity — Clause Library / Legal Risk] Concise explanation of why OCSC requires this amendment and fallback commercial position"\` on every edit op, plus \`{"op":"add_comment","find":"...","comment":"..."}\` on clauses that require a commercial/legal query without a wording rewrite yet!
- If the contract only exists as a PDF (no \`.docx\` uploaded), annotate/summarise every clause with exact page/clause citations, proposed replacement wording, and offer to produce an OCSC Red-Pen Risk & Amendment Schedule in Word (\`ocsc-word new\`).
- After saving the red-penned \`.docx\`, ALWAYS run \`attach_file\` so it opens directly in Word Studio / downloads cleanly, and present a clear structured table in chat grouping findings by **Critical / High / Medium / Low** (Clause #, Issue, Clause Library Rule vs Wider Risk, Redline Applied, Commercial Fallback).

ACTIVE OCSC CLAUSE LIBRARY (${sortedClauses.length} RULES${sortedClauses.length > 40 ? "; showing top 40 — read OCSC-Clause-Library.md for all" : ""})
${compactClauses || "No active Clause Library rules yet — rely on UK/IE engineering consultancy legal best practice above."}
`;
}

/** Crisp first-message briefing shown when the contract agent opens, accompanied by the synced file blocks. */
export function buildContractBriefingText(
  bundle: EvolveContractBundle,
  syncedFileNames: readonly string[],
): string {
  const c = bundle.contract;
  const primaryDocx = bundle.documents.find((d) => d.fileKind === "docx");
  const details = [
    c.jobNumber ? `**Job #:** ${c.jobNumber}` : null,
    c.clientName ? `**Client:** ${c.clientName}` : null,
    c.counterpartySolicitorFirm || c.counterpartySolicitorName
      ? `**Counterparty Solicitor:** ${[c.counterpartySolicitorName, c.counterpartySolicitorFirm].filter(Boolean).join(" — ")}`
      : null,
    c.deadline ? `**Deadline:** ${c.deadline}` : null,
    `**Status:** ${c.status}`,
  ].filter(Boolean);

  const flags = [
    c.designAndBuild ? "Design & Build" : null,
    c.collateralWarranty ? "Collateral Warranty" : null,
    c.ndaRequired ? "NDA" : null,
  ].filter(Boolean);

  const lines = [
    `### Legal Red-Pen Workspace Ready — ${c.title}`,
    "",
    details.join(" · "),
    ...(flags.length ? [`**Flags:** ${flags.join(", ")}`] : []),
    "",
    `- **Synced Documents:** ${syncedFileNames.length} file${syncedFileNames.length === 1 ? "" : "s"}${primaryDocx ? ` (editable Word contract ready: \`${primaryDocx.name}\`)` : " (PDF only — no original .docx uploaded yet)"}`,
    `- **OCSC Clause Library:** ${bundle.clauseLibrary.length} active rule${bundle.clauseLibrary.length === 1 ? "" : "s"} loaded`,
    ...(bundle.existingFindings.length
      ? [`- **Existing Evolve Findings:** ${bundle.existingFindings.length} logged`]
      : []),
    "",
    primaryDocx
      ? `Click **Run Full Clause Library Red-Pen Review** below (or ask a specific question) and I will review \`${primaryDocx.name}\` end-to-end against the OCSC Clause Library and wider legal risks, returning a red-penned Word document with **real Tracked Changes and Margin Comments**.`
      : `Click **Run Full Clause Library Red-Pen Review** below (or ask a specific question) to audit the PDF against the OCSC Clause Library and wider legal risks and prepare a clause-by-clause Red-Pen Amendment Schedule.`,
  ];
  return lines.join("\n");
}
