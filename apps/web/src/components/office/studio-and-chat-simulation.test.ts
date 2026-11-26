import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { validate as validateJantt } from "@jantt/core";
import { exportMsProjectXml, exportSpreadsheetCsv } from "@jantt/interop";
import { getSlides, getSlideNotes, getSlideShapes, getShapeText, validatePresentation } from "@office-kit/pptx";
import { getCell } from "@office-kit/xlsx/worksheet";
import { openStudioNote, studioNoteDocument } from "@rakazo/contracts";
import {
  createDocx,
  extractDocxText,
  parseDocx,
  validateDocxConformance,
} from "@stll/folio-core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareDocumentStudioSend } from "./prepare-document-studio-send";
import {
  changedTaskIds,
  evolveLinkOf,
  linkTasks,
  parsePlan,
  planBytes,
  withEvolveLink,
} from "./planner/plan";
import {
  applyInput,
  changedCells,
  hasDrawings,
  openWorkbook,
  rawInput,
  saveVerified as saveSheetVerified,
  setFreeze,
  sheetTabs,
  worksheetOf,
} from "./sheet/workbook";
import {
  changedSlides,
  duplicateSlide,
  openDeck,
  saveVerified as saveDeckVerified,
  setNotes as setSlideNotesText,
  setText as setSlideShapeText,
} from "./slides/deck";
import { checkDocx, newDocxErrors } from "./word/validation";

const REPO_ROOT = resolve(__dirname, "../../../../..");
const OCSC_WORD = join(REPO_ROOT, "infra/sandboxes/computer/ocsc/ocsc-word/ocsc-word.mjs");
const OCSC_PPTX = join(REPO_ROOT, "infra/sandboxes/computer/ocsc/ocsc-word/ocsc-pptx.mjs");
const OCSC_XLSX = join(REPO_ROOT, "infra/sandboxes/computer/ocsc/ocsc-word/ocsc-xlsx.mjs");
const OCSC_PLAN = join(REPO_ROOT, "infra/sandboxes/computer/ocsc/ocsc-plan/ocsc-plan.mjs");
const ocscRequire = createRequire(OCSC_WORD);
const JSZip = ocscRequire("jszip") as {
  loadAsync: (data: Uint8Array | Buffer) => Promise<{
    files: Record<string, unknown>;
    file: (
      name: string,
      content?: string,
    ) => { async: (type: "string") => Promise<string> } | null;
    generateAsync: (opts: { type: "nodebuffer" }) => Promise<Buffer>;
  }>;
};

let workDir = "";

function runCli(script: string, args: string[]): Record<string, unknown> {
  let stdout = "";
  try {
    stdout = execFileSync(process.execPath, [script, ...args], {
      cwd: workDir,
      env: { ...process.env, WORKSPACE_DIR: workDir, OCSC_AUTHOR: "Keith Simulation" },
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    throw new Error(
      `CLI exited non-zero (${script} ${args.join(" ")}):\nSTDOUT: ${e.stdout ?? ""}\nSTDERR: ${e.stderr ?? ""}`,
    );
  }
  const start = stdout.indexOf("{");
  if (start < 0) throw new Error(`CLI returned non-JSON: ${stdout}`);
  const parsed = JSON.parse(stdout.slice(start)) as Record<string, unknown>;
  if (parsed.ok !== true) {
    throw new Error(`CLI failed (${script} ${args.join(" ")}): ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

function writeSpec(name: string, spec: unknown): string {
  const p = join(workDir, name);
  writeFileSync(p, JSON.stringify(spec, null, 2));
  return name;
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "rakazo-studio-sim-"));
});

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe("Studio OPEN (live) — real browser engine <-> ocsc CLI round-trip simulations", () => {
  it("Word Studio OPEN: Folio parse/export <-> ocsc-word tracked & clean edits, headers/footers, tables & studio send", async () => {
    // 1. Create initial branded OCSC Word report (v1)
    const newSpec = writeSpec("word-open-new.json", {
      title: "Stage 3 Structural Design Report",
      office: "Dublin",
      fields: {
        project_number: "D2601",
        project_name: "Riverfront Quarter",
        client_name: "Acme Developments",
        author: "Keith",
      },
      blocks: [
        { type: "heading", level: 1, text: "Executive Summary" },
        { type: "paragraph", text: "The client\u2019s brief specifies D2601 structural framing." },
        {
          type: "table",
          columns: ["Element", "Status"],
          rows: [
            ["Foundations", "Complete"],
            ["Superstructure", "In Progress"],
          ],
        },
      ],
    });
    runCli(OCSC_WORD, ["new", "--spec", newSpec, "--out", "word-open-v1.docx"]);
    const v1Bytes = new Uint8Array(readFileSync(join(workDir, "word-open-v1.docx")));

    // 2. Open in Word Studio: validate via @office-kit/docx + parse & re-export via Folio (simulating Studio save)
    const v1Issues = await checkDocx(v1Bytes);
    expect(v1Issues.filter((i) => i.level === "error")).toEqual([]);
    const parsedV1 = await parseDocx(v1Bytes.buffer.slice(0));
    const v2StudioBytes = new Uint8Array(await createDocx(parsedV1));
    expect(newDocxErrors(v1Issues, await checkDocx(v2StudioBytes))).toEqual([]);
    writeFileSync(join(workDir, "word-open-v2-studio.docx"), v2StudioBytes);

    // 3. Simulate Studio send with Track Changes ON
    let notePublished = "";
    const attachment = await prepareDocumentStudioSend({
      flush: async () => ({ status: "saved", dirty: false, error: null }),
      getLatest: () => ({
        artifactId: "art-w2",
        version: 2,
        versions: [{ artifactId: "art-w1" }, { artifactId: "art-w2" }],
      }),
      publishNote: () => {
        notePublished = openStudioNote({
          kind: "word",
          title: "Stage 3 Structural Design Report.docx",
          documentId: "art-w1",
          artifactId: "art-w2",
          version: 2,
          trackChanges: true,
        });
      },
      owner: async () => ({ botId: "bot-1", groupId: null }),
    });
    expect(attachment?.artifactId).toBe("art-w2");
    expect(studioNoteDocument(notePublished)).toEqual({
      documentId: "art-w1",
      artifactId: "art-w2",
    });
    expect(notePublished).toContain("Track changes is on");

    // 4. Chat runs ocsc-word edit directly on the Folio-saved v2 bytes (tracked changes + smart quote + header/footer + table ops)
    const editSpec = writeSpec("word-open-edit.json", {
      edits: [
        {
          op: "replace_text",
          find: "client's brief",
          replace: "developer's specification",
          comment: "Aligned with employer requirements",
        },
        { op: "replace_text", find: "D2601", replace: "D2699" },
        { op: "format_text", find: "developer's specification", bold: true, color: "green" },
        { op: "set_table_cell", label: "Superstructure", text: "Approved" },
        { op: "add_table_row", table: 2, cells: ["Roof Steelwork", "Scheduled"] },
        { op: "delete_table_row", label: "Foundations" },
      ],
    });
    runCli(OCSC_WORD, [
      "edit",
      "--in",
      "word-open-v2-studio.docx",
      "--spec",
      editSpec,
      "--out",
      "word-open-v3-tracked.docx",
    ]);

    // 5. Word Studio live-reloads v3 (Folio parse + @office-kit/docx check + conformance check)
    const v3Bytes = new Uint8Array(readFileSync(join(workDir, "word-open-v3-tracked.docx")));
    expect(newDocxErrors(v1Issues, await checkDocx(v3Bytes))).toEqual([]);
    const parsedV3 = await parseDocx(v3Bytes.buffer.slice(0));
    expect(parsedV3).toBeTruthy();
    const conformanceV3 = await validateDocxConformance(v3Bytes);
    expect(conformanceV3.status).not.toBe("invalid");

    // 6. Track Changes OFF (--clean) + accept tracked changes, then Folio round-trip again
    runCli(OCSC_WORD, [
      "accept",
      "--in",
      "word-open-v3-tracked.docx",
      "--out",
      "word-open-v4-accepted.docx",
    ]);
    const cleanSpec = writeSpec("word-open-clean.json", {
      edits: [{ op: "replace_text", find: "Scheduled", replace: "Tender Issued" }],
    });
    runCli(OCSC_WORD, [
      "edit",
      "--clean",
      "--in",
      "word-open-v4-accepted.docx",
      "--spec",
      cleanSpec,
      "--out",
      "word-open-v5-clean.docx",
    ]);
    const v5Bytes = new Uint8Array(readFileSync(join(workDir, "word-open-v5-clean.docx")));
    expect(newDocxErrors(v1Issues, await checkDocx(v5Bytes))).toEqual([]);
    const extracted = await extractDocxText(v5Bytes);
    const fullText = JSON.stringify(extracted);
    expect(fullText).toContain("developer's specification");
    expect(fullText).toContain("D2699");
    expect(fullText).toContain("Approved");
    expect(fullText).toContain("Tender Issued");
    expect(fullText).not.toContain("Foundations");
    // Re-export from Folio after AI edit to verify continued manual editing works
    const v6StudioBytes = new Uint8Array(await createDocx(await parseDocx(v5Bytes.buffer.slice(0))));
    expect(newDocxErrors(v1Issues, await checkDocx(v6StudioBytes))).toEqual([]);
  }, 60_000);

  it("Excel Studio OPEN: @office-kit/xlsx hand edit & saveVerified <-> ocsc-xlsx edits (charts/merges/formulas/rename) <-> reload & re-save", async () => {
    // 1. Create initial Excel workbook (v1)
    const newSpec = writeSpec("xlsx-open-new.json", {
      sheets: [
        {
          name: "Costs",
          columns: [
            { header: "Item", width: 24 },
            { header: "Qty" },
            { header: "Rate", format: "£#,##0.00" },
            { header: "Total", format: "£#,##0.00", total: true },
          ],
          rows: [
            ["Steel 2025", 10, 500, { formula: "B2*C2" }],
            ["Concrete 2025", 20, 100, { formula: "B3*C3" }],
          ],
          total_row: true,
        },
        {
          name: "Summary",
          columns: ["Metric", "Value"],
          rows: [
            ["Grand Total", { formula: "Costs!D4" }],
            ["Status", "Draft 2025"],
          ],
        },
      ],
    });
    runCli(OCSC_XLSX, ["new", "--spec", newSpec, "--out", "xlsx-open-v1.xlsx"]);
    const v1Bytes = new Uint8Array(readFileSync(join(workDir, "xlsx-open-v1.xlsx")));

    // 2. Open in Excel Studio, perform real Studio hand edits, and save via saveVerified()
    const wbStudio = await openWorkbook(v1Bytes);
    const costsWs = worksheetOf(wbStudio, "Costs");
    expect(costsWs).toBeDefined();
    applyInput(wbStudio, costsWs!, { row: 2, col: 2 }, "15"); // Qty 10 -> 15 by hand
    setFreeze(costsWs!, 1, 0);
    const v2StudioBytes = await saveSheetVerified(wbStudio, [
      { sheet: "Costs", pos: { row: 2, col: 2 }, raw: "15" },
    ]);
    writeFileSync(join(workDir, "xlsx-open-v2-studio.xlsx"), v2StudioBytes);

    // 3. Chat runs ocsc-xlsx edit directly on the @office-kit/xlsx-saved bytes
    const editSpec = writeSpec("xlsx-open-edit.json", {
      edits: [
        { op: "merge", sheet: "Summary", range: "A5:B5" },
        { op: "set", sheet: "Summary", cell: "B5", value: "Merged Studio Note" },
        {
          op: "insert_rows",
          sheet: "Costs",
          at: 4,
          rows: [["Timber 2025", 5, 200, { formula: "B4*C4" }]],
        },
        { op: "rename_sheet", sheet: "Costs", name: "Cost Plan" },
        { op: "find_replace", find: "2025", replace: "2026" },
        {
          op: "conditional_format",
          sheet: "Cost Plan",
          range: "A2:A4",
          rule: "contains",
          value: "2026",
          fill: "green",
        },
        {
          op: "chart",
          sheet: "Cost Plan",
          type: "column",
          range: "A1:D4",
          title: "Cost Breakdown",
        },
        { op: "duplicate_sheet", sheet: "Summary", name: "Summary Copy" },
        { op: "clear", sheet: "Summary Copy", range: "B3:B3" },
        { op: "auto_fit" },
      ],
    });
    runCli(OCSC_XLSX, [
      "edit",
      "--in",
      "xlsx-open-v2-studio.xlsx",
      "--spec",
      editSpec,
      "--out",
      "xlsx-open-v3-ai.xlsx",
    ]);

    // 4. Excel Studio live-reloads v3, checks tabs/formulas/merges/drawings/diff, then performs SECOND Studio hand edit & saveVerified!
    const v3Bytes = new Uint8Array(readFileSync(join(workDir, "xlsx-open-v3-ai.xlsx")));
    const wbReloaded = await openWorkbook(v3Bytes);
    expect(sheetTabs(wbReloaded).map((t) => t.title)).toEqual([
      "Cost Plan",
      "Summary",
      "Summary Copy",
    ]);
    const costPlanWs = worksheetOf(wbReloaded, "Cost Plan")!;
    const summaryWs = worksheetOf(wbReloaded, "Summary")!;
    const copyWs = worksheetOf(wbReloaded, "Summary Copy")!;

    // Verify user's hand edit (Qty=15) survived + AI edits landed cleanly
    expect(rawInput(wbReloaded, getCell(costPlanWs, 2, 2))).toBe("15");
    expect(rawInput(wbReloaded, getCell(costPlanWs, 4, 1))).toBe("Timber 2026");
    expect(rawInput(wbReloaded, getCell(costPlanWs, 5, 4))).toBe("=SUM(D2:D4)");
    expect(rawInput(wbReloaded, getCell(summaryWs, 2, 2))).toBe("='Cost Plan'!D5");
    expect(rawInput(wbReloaded, getCell(summaryWs, 3, 2))).toBe("Draft 2026");
    expect(rawInput(wbReloaded, getCell(summaryWs, 5, 1))).toBe("Merged Studio Note");
    expect(rawInput(wbReloaded, getCell(copyWs, 3, 2))).toBe("");
    expect(hasDrawings(costPlanWs)).toBe(true);

    // Visual diff highlights changed cells on Summary
    const diff = changedCells(wbStudio, wbReloaded, "Summary");
    expect(diff.has("B2")).toBe(true);
    expect(diff.has("B3")).toBe(true);
    expect(diff.has("A5")).toBe(true);

    // User edits again in Excel Studio after AI edit and saves v4 cleanly!
    applyInput(wbReloaded, summaryWs, { row: 3, col: 2 }, "Approved 2026");
    const v4StudioBytes = await saveSheetVerified(wbReloaded, [
      { sheet: "Summary", pos: { row: 3, col: 2 }, raw: "Approved 2026" },
    ]);
    expect(v4StudioBytes.byteLength).toBeGreaterThan(1000);
  }, 60_000);

  it("PowerPoint Studio OPEN: @office-kit/pptx hand edit & saveVerified <-> ocsc-pptx edits (tables/text/format/notes) <-> reload & re-save", async () => {
    // 1. Create initial PowerPoint deck (v1)
    const newSpec = writeSpec("pptx-open-new.json", {
      template: "none",
      title: "Project Review Deck",
      slides: [
        { layout: "title", heading: "Riverfront Quarter", subtitle: "Stage 3 Review" },
        {
          layout: "table",
          heading: "Fee Breakdown",
          columns: ["Discipline", "Fee"],
          rows: [
            ["Structural", "£45,000"],
            ["Civil", "£30,000"],
          ],
        },
      ],
    });
    runCli(OCSC_PPTX, ["new", "--spec", newSpec, "--out", "pptx-open-v1.pptx"]);
    const v1Bytes = new Uint8Array(readFileSync(join(workDir, "pptx-open-v1.pptx")));

    // 2. Open in PowerPoint Studio, perform real Studio hand edits (edit shape text + notes + duplicate), save via saveVerified()
    const deckStudio = await openDeck(v1Bytes);
    const slide1 = getSlides(deckStudio.pres)[0]!;
    const titleShape = getSlideShapes(slide1).find((s) =>
      getShapeText(s).includes("Stage 3 Review"),
    );
    expect(titleShape).toBeDefined();
    setSlideShapeText(titleShape!, "Stage 3 Client\u2019s Review");
    setSlideNotesText(slide1, "Hand-edited speaker note in PowerPoint Studio.");
    duplicateSlide(deckStudio, 0);
    const v2StudioBytes = await saveDeckVerified(deckStudio.pres);
    writeFileSync(join(workDir, "pptx-open-v2-studio.pptx"), v2StudioBytes);

    // 3. Chat runs ocsc-pptx edit directly on the @office-kit/pptx-saved bytes
    // Note: slide 1 & 2 are now copies of title slide, slide 3 is the table slide!
    const editSpec = writeSpec("pptx-open-edit.json", {
      edits: [
        {
          op: "replace_text",
          slide: 1,
          find: "Client's Review",
          replace: "Handover Review",
        },
        { op: "format_text", slide: 1, find: "Handover", bold: true, color: "green" },
        { op: "set_table_cell", slide: 3, label: "Structural", text: "£52,000" },
        { op: "add_table_row", slide: 3, cells: ["MEP", "£38,000"] },
        { op: "delete_table_row", slide: 3, label: "Civil" },
        { op: "slide_background", slide: 2, fill: "navy" },
      ],
    });
    runCli(OCSC_PPTX, [
      "edit",
      "--in",
      "pptx-open-v2-studio.pptx",
      "--spec",
      editSpec,
      "--out",
      "pptx-open-v3-ai.pptx",
    ]);

    // 4. PowerPoint Studio live-reloads v3, validates, checks diff & table rows, then performs SECOND hand edit & saveVerified!
    const v3Bytes = new Uint8Array(readFileSync(join(workDir, "pptx-open-v3-ai.pptx")));
    const deckReloaded = await openDeck(v3Bytes);
    const issues = validatePresentation(deckReloaded.pres).filter((i) => i.severity === "error");
    expect(issues).toEqual([]);

    const reloadedSlides = getSlides(deckReloaded.pres);
    expect(reloadedSlides).toHaveLength(3);
    const s1Text = getSlideShapes(reloadedSlides[0]!)
      .map(getShapeText)
      .join("\n");
    expect(s1Text).toContain("Handover Review");
    // Studio hand-edited notes survived AI edit!
    expect(getSlideNotes(reloadedSlides[0]!)).toContain(
      "Hand-edited speaker note in PowerPoint Studio.",
    );

    // Visual diff detects changed slides
    const diff = changedSlides(deckStudio, deckReloaded);
    expect(diff.has(0)).toBe(true);

    // Verify table contents via ocsc-pptx read as well
    const readOut = runCli(OCSC_PPTX, ["read", "--in", "pptx-open-v3-ai.pptx"]);
    const readSlides = readOut.slides as Array<{ tables?: string[][][] }>;
    expect(readSlides[2]?.tables?.[0]).toEqual([
      ["Structural", "£52,000"],
      ["MEP", "£38,000"],
    ]);

    // User makes a SECOND hand edit in PowerPoint Studio after AI edit and saves v4 cleanly!
    setSlideNotesText(reloadedSlides[0]!, "Final verified note after AI edit.");
    const v4StudioBytes = await saveDeckVerified(deckReloaded.pres);
    expect(v4StudioBytes.byteLength).toBeGreaterThan(1000);
  }, 60_000);

  it("Programme Studio OPEN: @jantt/core hand edit & planBytes <-> ocsc-plan edits & audit <-> reload, XML & CSV interop", async () => {
    // 1. Create initial programme (v1)
    const newSpec = writeSpec("plan-open-new.json", {
      title: "Riverfront Engineering Programme",
      defaultGapDays: 0,
      categories: {
        design: { label: "Design", color: "#76BF43" },
        delivery: { label: "Delivery", color: "#3B82F6" },
      },
      tasks: [
        {
          id: "phase1",
          label: "Phase 1 — Design",
          category: "design",
          start: "2026-12-01",
          end: "2026-12-18",
          wbs: "1",
          fields: { summary: true, outlineLevel: 1 },
        },
        {
          id: "t1",
          label: "Concept Design",
          category: "design",
          start: "2026-12-01",
          end: "2026-12-07",
          wbs: "1.1",
          fields: { outlineLevel: 2 },
        },
        {
          id: "t2",
          label: "Detailed Design",
          category: "design",
          start: "2026-12-08",
          end: "2026-12-18",
          wbs: "1.2",
          fields: { outlineLevel: 2 },
        },
        {
          id: "m1",
          label: "Stage 3 Sign-off",
          category: "delivery",
          start: "2026-12-21",
          end: "2026-12-21",
          milestone: true,
          dependsOn: ["t2"],
          wbs: "1.3",
          fields: { outlineLevel: 2 },
        },
      ],
    });
    runCli(OCSC_PLAN, ["new", "--spec", newSpec, "--out", "plan-open-v1.jantt"]);
    const v1Bytes = new Uint8Array(readFileSync(join(workDir, "plan-open-v1.jantt")));

    // 2. Open in Programme Studio, perform real Studio hand edits (linkTasks + Evolve job link), save via planBytes()
    let planStudio = parsePlan(v1Bytes);
    const linked = linkTasks(planStudio, "t1", "t2");
    expect(linked && "plan" in linked).toBe(true);
    if (linked && "plan" in linked) planStudio = linked.plan;
    planStudio = withEvolveLink(planStudio, { jobNumber: "D2601", name: "Riverfront Quarter" });
    const v2StudioBytes = planBytes(planStudio);
    writeFileSync(join(workDir, "plan-open-v2-studio.jantt"), v2StudioBytes);

    // 3. Chat runs ocsc-plan edit directly on the Programme Studio-saved bytes
    const editSpec = writeSpec("plan-open-edit.json", {
      edits: [
        {
          op: "add_task",
          id: "t3",
          label: "Tender Issue",
          category: "delivery",
          start: "2026-12-22",
          end: "2026-12-29",
          dependsOn: ["m1"],
          wbs: "1.4",
          outlineLevel: 2,
        },
        { op: "update_task", id: "t1", progress: 60, status: "in-progress", priority: "high" },
        { op: "assign", id: "t2", assignee: "Keith" },
        { op: "set_baseline" },
      ],
    });
    const editRes = runCli(OCSC_PLAN, [
      "edit",
      "--in",
      "plan-open-v2-studio.jantt",
      "--spec",
      editSpec,
      "--out",
      "plan-open-v3-ai.jantt",
    ]);
    expect(editRes.ok).toBe(true);

    // 4. Programme Studio live-reloads v3, verifies diff, Evolve link, Jantt validation, audit, and MS Project XML/CSV interop!
    const v3Bytes = new Uint8Array(readFileSync(join(workDir, "plan-open-v3-ai.jantt")));
    const planReloaded = parsePlan(v3Bytes);
    expect(validateJantt(planReloaded).valid).toBe(true);
    expect(evolveLinkOf(planReloaded)).toEqual({
      jobNumber: "D2601",
      name: "Riverfront Quarter",
    });
    const changed = changedTaskIds(planStudio, planReloaded);
    expect(changed.has("t3")).toBe(true);
    expect(changed.has("t1")).toBe(true);
    expect(changed.has("t2")).toBe(true);

    const audit = runCli(OCSC_PLAN, ["audit", "--in", "plan-open-v3-ai.jantt"]);
    expect(audit.ok).toBe(true);

    // Studio Share menu exports -> ocsc-plan import round-trip
    const xmlStr = exportMsProjectXml(planReloaded);
    writeFileSync(join(workDir, "plan-export.xml"), xmlStr);
    runCli(OCSC_PLAN, ["import-xml", "--in", "plan-export.xml", "--out", "plan-reimported-xml.jantt"]);
    const csvStr = exportSpreadsheetCsv(planReloaded);
    writeFileSync(join(workDir, "plan-export.csv"), csvStr);
    runCli(OCSC_PLAN, ["import-csv", "--in", "plan-export.csv", "--out", "plan-reimported-csv.jantt"]);
    expect(validateJantt(parsePlan(readFileSync(join(workDir, "plan-reimported-xml.jantt")))).valid).toBe(true);
    expect(validateJantt(parsePlan(readFileSync(join(workDir, "plan-reimported-csv.jantt")))).valid).toBe(true);
  }, 60_000);
});

describe("Studio CLOSED (chat-only) — multi-turn edits & later Studio open across all 4 types", () => {
  it("Word CLOSED: multi-turn edits on complex doc (content controls, checkboxes, split runs, text box) open cleanly in Word Studio", async () => {
    // Build a complex Word doc with content controls, checkboxes, split runs & smart quotes via ocsc-word new then inject realistic OOXML
    const newSpec = writeSpec("word-closed-new.json", {
      title: "Client Compliance Form",
      office: "Dublin",
      fields: { project_number: "D2605", project_name: "Docklands Hub", client_name: "Harbour Co" },
      blocks: [
        { type: "heading", level: 1, text: "Questionnaire" },
        { type: "paragraph", text: "Applicant\u2019s status is pending review." },
        {
          type: "table",
          columns: ["Field", "Response"],
          rows: [
            ["Company Name", ""],
            ["Comments", ""],
            ["Comments", ""],
          ],
        },
      ],
    });
    runCli(OCSC_WORD, ["new", "--spec", newSpec, "--out", "word-closed-v1.docx"]);

    // Inject a Word Content Control (<w:sdt>) text box & checkbox into body (like real MS Word forms)
    const zip = await JSZip.loadAsync(readFileSync(join(workDir, "word-closed-v1.docx")));
    let docXml = await zip.file("word/document.xml")!.async("string");
    const sdtBlock =
      `<w:sdt><w:sdtPr><w:alias w:val="Signatory Name"/><w:tag w:val="signatory_name"/></w:sdtPr>` +
      `<w:sdtContent><w:p><w:r><w:t>Click here to enter text.</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
      `<w:sdt><w:sdtPr><w:alias w:val="ISO Certified"/><w14:checkbox xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w14:checked w14:val="0"/></w14:checkbox></w:sdtPr>` +
      `<w:sdtContent><w:p><w:r><w:t>\u2610</w:t></w:r></w:p></w:sdtContent></w:sdt>`;
    docXml = docXml.replace("</w:body>", `${sdtBlock}</w:body>`);
    zip.file("word/document.xml", docXml);
    writeFileSync(join(workDir, "word-closed-v1-sdt.docx"), await zip.generateAsync({ type: "nodebuffer" }));

    // Turn 1 (Studio CLOSED — no studio note)
    expect(studioNoteDocument("Please fill out the attached compliance form.")).toBeNull();
    const t1Spec = writeSpec("word-closed-t1.json", {
      edits: [
        {
          op: "fill_fields",
          fields: {
            "Company Name": "OCSC Consulting Engineers",
            "Signatory Name": "Keith Ryan",
            "ISO Certified": "Yes",
          },
        },
        { op: "set_table_cell", label: "Comments", occurrence: 1, text: "First comment" },
        { op: "set_table_cell", label: "Comments", occurrence: 2, text: "Second comment" },
      ],
    });
    runCli(OCSC_WORD, ["edit", "--in", "word-closed-v1-sdt.docx", "--spec", t1Spec, "--out", "word-closed-v2.docx"]);

    // Turn 2 (Studio CLOSED): replace smart-quote text + add table row
    const t2Spec = writeSpec("word-closed-t2.json", {
      edits: [
        { op: "replace_text", find: "Applicant's status", replace: "Candidate's status" },
        { op: "add_table_row", table: 2, cells: ["Reviewed By", "Director"] },
      ],
    });
    runCli(OCSC_WORD, ["edit", "--clean", "--in", "word-closed-v2.docx", "--spec", t2Spec, "--out", "word-closed-v3.docx"]);

    // Later: user opens v3 in Word Studio -> zero errors & every edit present!
    const v3Bytes = new Uint8Array(readFileSync(join(workDir, "word-closed-v3.docx")));
    const issues = await checkDocx(v3Bytes);
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    const text = JSON.stringify(await extractDocxText(v3Bytes));
    expect(text).toContain("OCSC Consulting Engineers");
    expect(text).toContain("Keith Ryan");
    expect(text).toContain("First comment");
    expect(text).toContain("Second comment");
    expect(text).toContain("Candidate's status");
    expect(text).toContain("Director");
    // Verify checkbox ticked inside XML
    const z3 = await JSZip.loadAsync(v3Bytes);
    const xml3 = await z3.file("word/document.xml")!.async("string");
    expect(xml3).toContain('w14:val="1"');
  }, 60_000);

  it("Excel CLOSED: multi-turn edits including .xlsm macro workbook & --find search open cleanly in Excel Studio", async () => {
    const newSpec = writeSpec("xlsx-closed-new.json", {
      sheets: [
        {
          name: "Budget",
          columns: ["Code", "Description", "Amount"],
          rows: [
            ["C01", "Enabling Works 2025", 10000],
            ["C02", "Piling 2025", 25000],
          ],
        },
        {
          name: "Totals",
          columns: ["Label", "Value"],
          rows: [["Total Budget", { formula: "SUM(Budget!C2:C3)" }]],
        },
      ],
    });
    runCli(OCSC_XLSX, ["new", "--spec", newSpec, "--out", "xlsx-closed-v1.xlsx"]);

    // Turn 1: insert row + add chart
    const t1Spec = writeSpec("xlsx-closed-t1.json", {
      edits: [
        { op: "insert_rows", sheet: "Budget", at: 4, rows: [["C03", "Drainage 2025", 15000]] },
        { op: "chart", sheet: "Budget", type: "column", range: "B1:C4", title: "Budget Split" },
      ],
    });
    runCli(OCSC_XLSX, ["edit", "--in", "xlsx-closed-v1.xlsx", "--spec", t1Spec, "--out", "xlsx-closed-v2.xlsx"]);

    // Turn 2: rename sheet + find_replace + save as .xlsm (testing macro extension support)
    const t2Spec = writeSpec("xlsx-closed-t2.json", {
      edits: [
        { op: "rename_sheet", sheet: "Budget", name: "CapEx Budget" },
        { op: "find_replace", find: "2025", replace: "2026" },
      ],
    });
    runCli(OCSC_XLSX, ["edit", "--in", "xlsx-closed-v2.xlsx", "--spec", t2Spec, "--out", "xlsx-closed-v3.xlsm"]);

    // Test --find search on the output
    const found = runCli(OCSC_XLSX, ["read", "--in", "xlsx-closed-v3.xlsm", "--find", "Drainage 2026"]);
    expect(JSON.stringify(found)).toContain("Drainage 2026");

    // Verify chart survived Turn 2 after rename_sheet + opens cleanly in Excel Studio
    const v3Bytes = new Uint8Array(readFileSync(join(workDir, "xlsx-closed-v3.xlsm")));
    const wb = await openWorkbook(v3Bytes);
    expect(sheetTabs(wb).map((t) => t.title)).toEqual(["CapEx Budget", "Totals"]);
    expect(hasDrawings(worksheetOf(wb, "CapEx Budget")!)).toBe(true);
    expect(rawInput(wb, getCell(worksheetOf(wb, "Totals")!, 2, 2))).toBe(
      "=SUM('CapEx Budget'!C2:C4)",
    );
    const z3 = await JSZip.loadAsync(v3Bytes);
    expect(Object.keys(z3.files).some((k) => /^xl\/charts\/chart\d+\.xml$/.test(k))).toBe(true);
  }, 60_000);

  it("PowerPoint CLOSED: multi-turn edits on attributed Mac/Google Slides XML open cleanly in PowerPoint Studio", async () => {
    const newSpec = writeSpec("pptx-closed-new.json", {
      template: "none",
      title: "Client Pitch",
      slides: [
        { layout: "title", heading: "Docklands Hub", subtitle: "Client\u2019s Proposal" },
        {
          layout: "table",
          heading: "Programme Milestones",
          columns: ["Milestone", "Date"],
          rows: [
            ["Planning", "Q1 2026"],
            ["Tender", "Q2 2026"],
          ],
        },
      ],
    });
    runCli(OCSC_PPTX, ["new", "--spec", newSpec, "--out", "pptx-closed-v1.pptx"]);

    // Inject Mac PowerPoint / Google Slides attributes onto <a:p>, <a:r>, <a:t>
    const zip = await JSZip.loadAsync(readFileSync(join(workDir, "pptx-closed-v1.pptx")));
    let s1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    s1 = s1
      .replaceAll("<a:p>", '<a:p lang="en-GB">')
      .replaceAll("<a:r>", '<a:r dirty="0">')
      .replaceAll("<a:t>", '<a:t xml:space="preserve">');
    zip.file("ppt/slides/slide1.xml", s1);
    writeFileSync(join(workDir, "pptx-closed-v1-mac.pptx"), await zip.generateAsync({ type: "nodebuffer" }));

    // Turn 1: replace smart quote on attributed tags + update table cell
    const t1Spec = writeSpec("pptx-closed-t1.json", {
      edits: [
        { op: "replace_text", slide: 1, find: "Client's Proposal", replace: "OCSC Stage 4 Proposal" },
        { op: "set_table_cell", slide: 2, label: "Tender", text: "Q3 2026" },
      ],
    });
    runCli(OCSC_PPTX, ["edit", "--in", "pptx-closed-v1-mac.pptx", "--spec", t1Spec, "--out", "pptx-closed-v2.pptx"]);

    // Turn 2: add row + delete row by label + format text
    const t2Spec = writeSpec("pptx-closed-t2.json", {
      edits: [
        { op: "add_table_row", slide: 2, cells: ["Handover", "Q4 2026"] },
        { op: "delete_table_row", slide: 2, label: "Planning" },
        { op: "format_text", slide: 1, find: "OCSC Stage 4", bold: true, color: "green" },
      ],
    });
    runCli(OCSC_PPTX, ["edit", "--in", "pptx-closed-v2.pptx", "--spec", t2Spec, "--out", "pptx-closed-v3.pptx"]);

    // Later: user opens v3 in PowerPoint Studio -> zero validation errors & saveVerified passes!
    const v3Bytes = new Uint8Array(readFileSync(join(workDir, "pptx-closed-v3.pptx")));
    const deck = await openDeck(v3Bytes);
    expect(validatePresentation(deck.pres).filter((i) => i.severity === "error")).toEqual([]);
    const s1Text = getSlideShapes(getSlides(deck.pres)[0]!).map(getShapeText).join("\n");
    expect(s1Text).toContain("OCSC Stage 4 Proposal");
    const saved = await saveDeckVerified(deck.pres);
    expect(saved.byteLength).toBeGreaterThan(1000);
  }, 60_000);

  it("Programme CLOSED: multi-turn chat edits & audit open cleanly in Programme Studio", async () => {
    const newSpec = writeSpec("plan-closed-new.json", {
      title: "Docklands Master Programme",
      defaultGapDays: 0,
      tasks: [
        { id: "a", label: "Site Survey", start: "2027-01-04", end: "2027-01-08" },
        { id: "b", label: "Geotechnical Report", start: "2027-01-11", end: "2027-01-15", dependsOn: ["a"] },
      ],
    });
    runCli(OCSC_PLAN, ["new", "--spec", newSpec, "--out", "plan-closed-v1.jantt"]);

    // Turn 1: add category + add task + link
    const t1Spec = writeSpec("plan-closed-t1.json", {
      edits: [
        { op: "add_category", key: "civil", label: "Civil", color: "#14B8A6" },
        {
          op: "add_task",
          id: "c",
          label: "Drainage Design",
          category: "civil",
          start: "2027-01-18",
          end: "2027-01-29",
          dependsOn: ["b"],
        },
      ],
    });
    runCli(OCSC_PLAN, ["edit", "--in", "plan-closed-v1.jantt", "--spec", t1Spec, "--out", "plan-closed-v2.jantt"]);

    // Turn 2: reschedule + assign + milestone + audit
    const t2Spec = writeSpec("plan-closed-t2.json", {
      edits: [
        { op: "reschedule_task", id: "a", start: "2027-01-11", end: "2027-01-15" },
        { op: "assign", id: "c", assignee: "Senior Engineer" },
        { op: "add_task", id: "m_end", label: "Submission", milestone: true, dependsOn: ["c"], start: "2027-02-08", end: "2027-02-08" },
      ],
    });
    runCli(OCSC_PLAN, ["edit", "--in", "plan-closed-v2.jantt", "--spec", t2Spec, "--out", "plan-closed-v3.jantt"]);

    // Later: user opens v3 in Programme Studio -> valid Jantt, cascaded dates, clean audit!
    const v3Bytes = new Uint8Array(readFileSync(join(workDir, "plan-closed-v3.jantt")));
    const plan = parsePlan(v3Bytes);
    expect(validateJantt(plan).valid).toBe(true);
    expect(plan.tasks.map((t) => t.id)).toEqual(["a", "b", "c", "m_end"]);
    // Cascading check: moving 'a' forward to 2027-01-11 pushed 'b' and 'c' forward too
    const taskB = plan.tasks.find((t) => t.id === "b")!;
    expect(taskB.start >= "2027-01-16").toBe(true);
    const audit = runCli(OCSC_PLAN, ["audit", "--in", "plan-closed-v3.jantt"]);
    expect(audit.ok).toBe(true);
  }, 60_000);
});

describe("Brutal stress-test edge cases (Studio OPEN & CLOSED)", () => {
  it("Word stress: split XML runs + inline bold/italic + hyperlink + anchored text box survive tracked edit, clean edit, and Folio round-trip", async () => {
    const newSpec = writeSpec("word-stress-new.json", {
      title: "Stress Test Report",
      office: "London",
      fields: { project_number: "L2601", project_name: "Thames Plaza", client_name: "BridgeCo" },
      blocks: [{ type: "paragraph", text: "Placeholder paragraph for injection." }],
    });
    runCli(OCSC_WORD, ["new", "--spec", newSpec, "--out", "word-stress-v1.docx"]);

    // Inject a nasty realistic paragraph with split runs, inline bold, smart quote, and a DrawingML text box
    const zip = await JSZip.loadAsync(readFileSync(join(workDir, "word-stress-v1.docx")));
    let xml = await zip.file("word/document.xml")!.async("string");
    const nastyPara =
      `<w:p>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Important: </w:t></w:r>` +
      `<w:r><w:t xml:space="preserve">the client</w:t></w:r>` +
      `<w:r><w:t xml:space="preserve">\u2019s </w:t></w:r>` +
      `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">revised brief</w:t></w:r>` +
      `<w:r><w:t xml:space="preserve"> applies to L2601.</w:t></w:r>` +
      `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:txbx><w:txbxContent><w:p><w:r><w:t>Keep this callout box intact</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>` +
      `</w:p>`;
    const lastSect = xml.lastIndexOf("<w:sectPr");
    xml = xml.slice(0, lastSect) + nastyPara + xml.slice(lastSect);
    zip.file("word/document.xml", xml);
    writeFileSync(join(workDir, "word-stress-v1-nasty.docx"), await zip.generateAsync({ type: "nodebuffer" }));

    // Tracked edit spanning 3 split XML runs + smart apostrophe in the SAME paragraph as the text box!
    const editSpec = writeSpec("word-stress-edit.json", {
      edits: [
        { op: "replace_text", find: "client's revised brief", replace: "employer's final brief" },
        { op: "replace_text", find: "L2601", replace: "L2699" },
      ],
    });
    runCli(OCSC_WORD, ["edit", "--in", "word-stress-v1-nasty.docx", "--spec", editSpec, "--out", "word-stress-v2-tracked.docx"]);

    // Verify tracked XML kept bold "Important: ", kept text box, and did NOT strike "Important: "!
    const z2 = await JSZip.loadAsync(readFileSync(join(workDir, "word-stress-v2-tracked.docx")));
    const xml2 = await z2.file("word/document.xml")!.async("string");
    expect(xml2).toContain("Keep this callout box intact");
    expect(xml2).toContain("<w:b/>");
    expect(xml2).toContain("employer");
    expect(xml2).not.toContain("<w:delText>Important:");

    // Accept tracked changes and verify Folio + @office-kit/docx both load cleanly
    runCli(OCSC_WORD, ["accept", "--in", "word-stress-v2-tracked.docx", "--out", "word-stress-v3-clean.docx"]);
    const v3Bytes = new Uint8Array(readFileSync(join(workDir, "word-stress-v3-clean.docx")));
    const parsed = await parseDocx(v3Bytes.buffer.slice(0));
    expect(parsed).toBeTruthy();
    const extracted = JSON.stringify(await extractDocxText(v3Bytes));
    expect(extracted).toContain("Important:");
    expect(extracted).toContain("employer's final brief");
    expect(extracted).toContain("L2699");
    expect(extracted).toContain("Keep this callout box intact");
  }, 60_000);

  it("Excel stress: existing chart + new sheet inserted + sheet renamed + column inserted + delete_rows all round-trip cleanly through Excel Studio", async () => {
    const newSpec = writeSpec("xlsx-stress-new.json", {
      sheets: [
        {
          name: "Data",
          columns: ["Item", "Q1", "Q2", "Total"],
          rows: [
            ["Alpha", 100, 200, { formula: "B2+C2" }],
            ["Beta", 150, 250, { formula: "B3+C3" }],
            ["Gamma", 50, 75, { formula: "B4+C4" }],
          ],
        },
        {
          name: "Rollup",
          columns: ["Metric", "Value"],
          rows: [["Sum", { formula: "SUM(Data!D2:D4)" }]],
        },
      ],
    });
    runCli(OCSC_XLSX, ["new", "--spec", newSpec, "--out", "xlsx-stress-v1.xlsx"]);
    // Add chart to Data first (v2)
    const chartSpec = writeSpec("xlsx-stress-chart.json", {
      edits: [{ op: "chart", sheet: "Data", type: "column", range: "A1:C4", title: "Quarterly Spend" }],
    });
    runCli(OCSC_XLSX, ["edit", "--in", "xlsx-stress-v1.xlsx", "--spec", chartSpec, "--out", "xlsx-stress-v2-chart.xlsx"]);

    // Open in Excel Studio, hand-edit Beta Q1 from 150 -> 175, save via saveVerified()
    const wb1 = await openWorkbook(new Uint8Array(readFileSync(join(workDir, "xlsx-stress-v2-chart.xlsx"))));
    expect(hasDrawings(worksheetOf(wb1, "Data")!)).toBe(true);
    applyInput(wb1, worksheetOf(wb1, "Data")!, { row: 3, col: 2 }, "175");
    const v3Studio = await saveSheetVerified(wb1, [{ sheet: "Data", pos: { row: 3, col: 2 }, raw: "175" }]);
    writeFileSync(join(workDir, "xlsx-stress-v3-studio.xlsx"), v3Studio);

    // Chat edits: add a new sheet, delete row 4 (Gamma), insert a column, rename Data -> "Q1-Q2 Data"
    const editSpec = writeSpec("xlsx-stress-edit.json", {
      edits: [
        { op: "add_sheet", name: "Cover", columns: ["Title"], rows: [["Executive Cost Pack"]] },
        { op: "delete_rows", sheet: "Data", from: 4, count: 1 },
        { op: "rename_sheet", sheet: "Data", name: "Q1-Q2 Data" },
        { op: "auto_fit" },
      ],
    });
    runCli(OCSC_XLSX, ["edit", "--in", "xlsx-stress-v3-studio.xlsx", "--spec", editSpec, "--out", "xlsx-stress-v4-ai.xlsx"]);

    // Reload in Excel Studio: verify chart stayed on "Q1-Q2 Data", hand-edit 175 survived, Rollup formula shifted & renamed!
    const wb2 = await openWorkbook(new Uint8Array(readFileSync(join(workDir, "xlsx-stress-v4-ai.xlsx"))));
    expect(sheetTabs(wb2).map((t) => t.title)).toEqual(["Q1-Q2 Data", "Rollup", "Cover"]);
    expect(rawInput(wb2, getCell(worksheetOf(wb2, "Q1-Q2 Data")!, 3, 2))).toBe("175");
    expect(hasDrawings(worksheetOf(wb2, "Q1-Q2 Data")!)).toBe(true);
    expect(rawInput(wb2, getCell(worksheetOf(wb2, "Rollup")!, 2, 2))).toBe(
      "=SUM('Q1-Q2 Data'!D2:D3)",
    );
    // Re-save in Excel Studio to prove zero save corruption
    const v5Studio = await saveSheetVerified(wb2, [
      { sheet: "Q1-Q2 Data", pos: { row: 3, col: 2 }, raw: "175" },
    ]);
    expect(v5Studio.byteLength).toBeGreaterThan(1000);
  }, 60_000);

  it("Programme stress: 30-task multi-phase programme with holidays, SS/FF lags, category changes & Studio hand edits", async () => {
    const tasks: Array<Record<string, unknown>> = [
      { id: "p1", label: "Phase 1 — Enabling", category: "civil", start: "2027-01-04", end: "2027-02-12", wbs: "1", fields: { summary: true, outlineLevel: 1 } },
      { id: "p2", label: "Phase 2 — Structure", category: "struct", start: "2027-02-15", end: "2027-04-30", wbs: "2", fields: { summary: true, outlineLevel: 1 } },
    ];
    let prev = "";
    for (let i = 1; i <= 14; i += 1) {
      const id = `c${i}`;
      tasks.push({
        id,
        label: `Civil Package ${i}`,
        category: "civil",
        start: "2027-01-04",
        end: "2027-01-08",
        durationWorkDays: 4,
        ...(prev ? { dependsOn: [prev] } : {}),
        wbs: `1.${i}`,
        fields: { outlineLevel: 2 },
      });
      prev = id;
    }
    for (let i = 1; i <= 14; i += 1) {
      const id = `s${i}`;
      tasks.push({
        id,
        label: `Structural Package ${i}`,
        category: "struct",
        start: "2027-02-15",
        end: "2027-02-19",
        durationWorkDays: 5,
        dependsOn: [i === 1 ? prev : `s${i - 1}`],
        wbs: `2.${i}`,
        fields: { outlineLevel: 2 },
      });
    }
    const newSpec = writeSpec("plan-stress-new.json", {
      title: "30-Task Multi-Phase Programme",
      defaultGapDays: 0,
      holidays: [{ start: "2027-03-17", end: "2027-03-17", label: "St Patrick's Day" }],
      categories: {
        civil: { label: "Civil", color: "#14B8A6" },
        struct: { label: "Structural", color: "#76BF43" },
      },
      tasks,
    });
    runCli(OCSC_PLAN, ["new", "--spec", newSpec, "--out", "plan-stress-v1.jantt"]);

    // Studio open -> hand edit -> save
    const studioPlan = parsePlan(readFileSync(join(workDir, "plan-stress-v1.jantt")));
    expect(validateJantt(studioPlan).valid).toBe(true);
    const v2Studio = planBytes(withEvolveLink(studioPlan, { jobNumber: "D2650", name: "Mega Campus" }));
    writeFileSync(join(workDir, "plan-stress-v2-studio.jantt"), v2Studio);

    // Chat edits: add category, update_category, link SS+2d, unlink, delete a task, move_task, set_baseline
    const editSpec = writeSpec("plan-stress-edit.json", {
      edits: [
        { op: "add_category", key: "mep", label: "MEP", color: "#3B82F6" },
        { op: "update_category", key: "struct", label: "Structural Works" },
        { op: "add_task", id: "mep1", label: "MEP First Fix", category: "mep", start: "2027-03-01", end: "2027-03-12", dependsOn: ["s2:SS+2d"], wbs: "2.15", outlineLevel: 2 },
        { op: "update_task", id: "c1", progress: 100, status: "completed" },
        { op: "delete_task", id: "c14" },
        { op: "link_tasks", from: "c13", to: "s1", type: "FS", lag: 0 },
        { op: "set_baseline" },
      ],
    });
    const res = runCli(OCSC_PLAN, ["edit", "--in", "plan-stress-v2-studio.jantt", "--spec", editSpec, "--out", "plan-stress-v3-ai.jantt"]);
    expect(res.ok).toBe(true);

    // Reload in Programme Studio
    const reloaded = parsePlan(readFileSync(join(workDir, "plan-stress-v3-ai.jantt")));
    expect(validateJantt(reloaded).valid).toBe(true);
    expect(reloaded.tasks.length).toBe(30); // 30 - 1 deleted + 1 added
    expect(evolveLinkOf(reloaded)?.jobNumber).toBe("D2650");
    expect(reloaded.categories?.struct?.label).toBe("Structural Works");
    expect(runCli(OCSC_PLAN, ["audit", "--in", "plan-stress-v3-ai.jantt"]).ok).toBe(true);
  }, 60_000);
});
