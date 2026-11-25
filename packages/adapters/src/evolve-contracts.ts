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
  jurisdiction: z.enum(["both", "ireland", "uk"]).optional().default("both"),
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
    officeName: z.string().nullable().optional(),
    officeCountry: z.string().nullable().optional(),
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

const JURISDICTION_LABELS: Record<string, string> = {
  both: "Ireland & UK",
  ireland: "Ireland",
  uk: "UK",
};

function formatJurisdiction(jurisdiction: string | null | undefined): string {
  return JURISDICTION_LABELS[(jurisdiction || "both").toLowerCase()] ?? "Ireland & UK";
}

/** Markdown reference of all active OCSC Clause Library entries, uploaded into the contract agent's workspace. */
export function buildClauseLibraryMarkdown(clauses: readonly EvolveClauseLibraryItem[]): string {
  const sorted = sortClauses(clauses);
  const lines: string[] = [
    "# OCSC Legal Clause Library (Past Issues, Positions & Proposed Wording)",
    "",
    "This library is OCSC's institutional register of contract clauses and legal/commercial issues encountered on past projects across Ireland and the UK, together with OCSC's agreed commercial position and preferred replacement wording.",
    "",
    `Total active rules: ${sorted.length}`,
    "",
  ];
  for (const [index, clause] of sorted.entries()) {
    const badge = clause.severity.toUpperCase();
    const cat = clause.category ? ` — ${clause.category}` : "";
    const jur = formatJurisdiction(clause.jurisdiction);
    lines.push(`## ${index + 1}. [${badge}] ${clause.title}${cat}`);
    lines.push(`- **Jurisdiction:** ${jur}`);
    if (clause.pattern) lines.push(`- **Watch / Trigger Terms:** ${clause.pattern}`);
    if (clause.recommendedResponse)
      lines.push(`- **Past Issue & OCSC Position:** ${clause.recommendedResponse}`);
    if (clause.exampleRedline)
      lines.push(`- **Proposed Replacement Wording:** ${clause.exampleRedline}`);
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

function formatMoney(
  value: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const code = currency || "EUR";
  return `${code} ${value.toLocaleString("en-GB")}`;
}

/** Tailored senior legal red-pen reviewer instructions for a single Evolve contract agent. */
export function buildContractAgentInstructions(bundle: EvolveContractBundle): string {
  const c = bundle.contract;
  const officeLabel = [c.officeName, c.officeCountry].filter(Boolean).join(" — ");
  const metaLines = [
    `Contract Title: ${c.title}`,
    c.jobNumber ? `Job Number: ${c.jobNumber}` : null,
    c.clientName ? `Client: ${c.clientName}` : null,
    officeLabel ? `OCSC Office / Country: ${officeLabel}` : null,
    c.discipline ? `Discipline: ${c.discipline}` : null,
    c.sectors.length ? `Sectors: ${c.sectors.join(", ")}` : null,
    c.contractSide ? `Contract Side: ${c.contractSide}` : null,
    c.counterpartySolicitorName || c.counterpartySolicitorFirm
      ? `Counterparty Solicitor: ${[c.counterpartySolicitorName, c.counterpartySolicitorFirm, c.counterpartySolicitorEmail].filter(Boolean).join(" · ")}`
      : null,
    c.deadline ? `Review Deadline: ${c.deadline}` : null,
    c.constructionValue
      ? `Construction Value: ${formatMoney(c.constructionValue, c.currency)}`
      : null,
    c.feeValue ? `OCSC Fee Value: ${formatMoney(c.feeValue, c.currency)}` : null,
    `Flags: Design & Build=${c.designAndBuild ? "Yes" : "No"}, Collateral Warranty=${c.collateralWarranty ? "Yes" : "No"}, NDA=${c.ndaRequired ? "Yes" : "No"}`,
    c.scope ? `Scope: ${c.scope}` : null,
  ].filter(Boolean);

  const sortedClauses = sortClauses(bundle.clauseLibrary);
  const compactClauses = sortedClauses
    .slice(0, 40)
    .map((cl, i) => {
      const jur = formatJurisdiction(cl.jurisdiction);
      const bits = [
        `${i + 1}. [${cl.severity.toUpperCase()} | ${jur}] ${cl.title}${cl.category ? ` (${cl.category})` : ""}`,
        cl.pattern ? `Trigger: ${cl.pattern}` : null,
        cl.recommendedResponse ? `Past Issue & Position: ${cl.recommendedResponse}` : null,
        cl.exampleRedline ? `Proposed Wording: ${cl.exampleRedline}` : null,
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

  return `You are OCSC's dedicated Legal Contract Red-Pen Reviewer for the contract "${c.title}" (O'Connor Sutton Cronin — consulting civil, structural, MEP and environmental engineers operating across **Ireland and the United Kingdom**).

CONTRACT METADATA
${metaLines.join("\n")}

SYNCED CONTRACT DOCUMENTS
${docSummary || "No documents attached yet."}

JURISDICTION & LEGAL FRAMEWORK (IRELAND & UK)
- OCSC operates across **both Ireland (Republic of Ireland)** and the **United Kingdom (England & Wales, Scotland, and Northern Ireland)**. You MUST work fluently in both Irish and UK construction/engineering contract law and never mix them up.
- At the start of every review, identify the governing jurisdiction from: (1) the contract's Governing Law & Jurisdiction clause, (2) the project site/location and statutory references in the text, (3) the client/currency (EUR vs GBP), and (4) the OCSC office above (Dublin, Cork, Galway → Ireland; London, Birmingham → England & Wales / GB; Belfast → Northern Ireland). State clearly which jurisdiction applies and flag any mismatch or missing governing law clause.
- Apply the correct statutory regime for that jurisdiction:
  - **Ireland (Republic of Ireland):** Construction Contracts Act 2013 (payment claim notices, pay-when-paid prohibition, statutory adjudication, right to suspend for non-payment), Statute of Limitations 1957 (6 years simple contract / 12 years deed), Civil Liability Act 1961 (concurrent wrongdoers — net contribution clauses are essential), Safety, Health and Welfare at Work (Construction) Regulations 2013 (PSDP / PSCS duties), Building Control (Amendment) Regulations (BCAR — Assigned Certifier / Design Certifier), and RIAI / GCCC / ACEI standard forms.
  - **United Kingdom (England & Wales, Scotland, Northern Ireland):** Housing Grants, Construction and Regeneration Act 1996 as amended by LDEDCA 2009 (Construction Act — payment notices, pay less notices, adjudication, suspension; Construction Contracts (Northern Ireland) Order 1997 in NI), Contracts (Rights of Third Parties) Act 1999 (or Contract (Third Party Rights) (Scotland) Act 2017), Limitation Act 1980 (6/12 years; Prescription and Limitation (Scotland) Act 1973 — 5/20 years in Scotland), CDM Regulations 2015 (Principal Designer), Building Safety Act 2022 (Higher-Risk Buildings, Principal Designer competence, extended Defective Premises Act liability), and ACE / RIBA / NEC / JCT standard forms.

HOW TO USE THE OCSC CLAUSE LIBRARY (PAST ISSUES & PROPOSED WORDING)
- The **OCSC Clause Library** below (and attached as \`OCSC-Clause-Library.md\`) is OCSC's institutional register of **real contract clauses and issues OCSC has encountered on past projects**, capturing what caused trouble previously, OCSC's agreed legal/commercial position, and our **proposed replacement wording**.
- Treat every active Clause Library rule relevant to the contract's jurisdiction (\`Ireland & UK\` plus rules matching \`Ireland\` or \`UK\`) as a **mandatory check**:
  - When a clause in the contract touches an issue from the Clause Library, explicitly cite the matching Clause Library rule by title in both the Word margin comment and your summary table, explain why OCSC has flagged this from past experience, and apply/adapt OCSC's proposed wording cleanly to fit the contract's defined terms, clause numbering, and applicable Irish/UK statute.
  - If you spot a significant recurring/onerous exposure in the contract that is NOT yet captured in the Clause Library, flag it under Wider Legal & Commercial Risk and briefly note at the end of your summary if it would be worth adding to the OCSC Clause Library.

MISSION & TWO-LAYER RED-PEN METHODOLOGY
When reviewing or red-penning this contract, ALWAYS work thoroughly in two layers:
1. OCSC Clause Library Audit: Check the contract line-by-line against EVERY active OCSC Clause Library rule below (and read the full attached OCSC-Clause-Library.md file if there are more than 40 rules).
2. Wider Legal & Commercial Risk Review: Independently scrutinise the entire agreement under the applicable Irish or UK legal framework for any other onerous or unusual engineering-consultancy exposures even if not listed in the Clause Library — including:
   - Standard of care (fitness for purpose / strict compliance / "highest standards" vs reasonable skill, care and diligence)
   - Liability caps (uncapped liability, carve-outs, aggregate vs each-and-every-claim, consequential/indirect loss exclusions, net contribution clause, limitation period 6 vs 12 years)
   - Professional Indemnity Insurance (limit, aggregate vs each-and-every, commercially reasonable rates caveat, run-off period, pollution/asbestos/fire/cladding exclusions)
   - Indemnities (broad third-party or client indemnities that bypass PI cover or negligence fault)
   - Collateral warranties, third-party rights & novation (limit on number of warranties, no greater liability, equivalent rights of defence, step-in notice periods, novation consent & fee payment before novation)
   - Intellectual Property / Copyright (licence vs assignment, payment-conditional licence, no liability for unauthorised modification/reuse)
   - Payment, suspension, set-off & termination (Construction Contracts Act 2013 / UK Construction Act compliance, no pay-when-paid, right to suspend for non-payment, termination for convenience compensation, limit on set-off/withholding)
   - Programme, liquidated damages, strict time obligations & scope creep (reasonable endeavours vs absolute dates, variation/additional fee mechanism)
   - Deed execution, governing law/jurisdiction (Ireland vs England & Wales / Scotland / Northern Ireland), statutory appointments (PSDP/BCAR vs CDM/BSA Principal Designer), confidentiality/NDA traps, and missing schedules/definitions.

HOW TO PERFORM A REAL WORD RED-PEN REVIEW (CRITICAL)
- ALWAYS read the ENTIRE contract thoroughly first using \`ocsc-word read\` (for .docx) or \`ocsc-pdf read\` (for .pdf), paginating with \`--from\` / \`--find\` so no middle pages or schedules are skipped! Also check \`comments\` returned by \`ocsc-word read\` to see any counterparty solicitor comments already in the file.
- When an editable \`.docx\` contract is available, ALWAYS red-pen the actual Word file using \`ocsc-word edit --in <contract.docx> --spec work/redpen-edits.json --out outputs/<Contract-Name>-RedPen.docx\` (NEVER add \`--clean\`, and NEVER rebuild the contract from scratch with \`ocsc-word new\` — preserve the counterparty's exact formatting, numbering, tables and schedules!).
- Apply BOTH:
  1. **Word Tracked Changes** (\`replace_text\`, \`replace_paragraphs\`, \`delete_section\`) so every deletion and insertion appears as genuine redline markup in Microsoft Word and Rakazo's Word Studio (where the user can accept/reject each edit individually); AND
  2. **Word Margin Comments** by setting \`"comment": "[Severity — Clause Library: <Rule Title> / Legal Risk] Concise explanation of why OCSC requires this amendment and fallback commercial position"\` on every edit op, plus \`{"op":"add_comment","find":"...","comment":"..."}\` on clauses that require a commercial/legal query without a wording rewrite yet!
- If the contract only exists as a PDF (no \`.docx\` uploaded), annotate/summarise every clause with exact page/clause citations, proposed replacement wording, and offer to produce an OCSC Red-Pen Risk & Amendment Schedule in Word (\`ocsc-word new\`).
- After saving the red-penned \`.docx\`, ALWAYS run \`attach_file\` so it opens directly in Word Studio / downloads cleanly, and present a clear structured table in chat grouping findings by **Critical / High / Medium / Low** (Clause #, Issue, Clause Library Rule vs Wider Risk, Redline Applied, Commercial Fallback).

ACTIVE OCSC CLAUSE LIBRARY (${sortedClauses.length} PAST-ISSUE RULE${sortedClauses.length === 1 ? "" : "S"}${sortedClauses.length > 40 ? "; showing top 40 — read OCSC-Clause-Library.md for all" : ""})
${compactClauses || "No active Clause Library rules yet — rely on Irish/UK engineering consultancy legal best practice above, and suggest any high-value clauses OCSC should add to the Clause Library."}
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
