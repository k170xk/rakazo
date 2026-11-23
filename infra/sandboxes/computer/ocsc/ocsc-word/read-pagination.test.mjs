import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_READ_BUDGET,
  paginatePdfPages,
  paginateWordOutline,
  parseSearchTerms,
} from "./read-pagination.mjs";

test("parseSearchTerms keeps quoted phrases and splits space/pipe keywords", () => {
  assert.deepEqual(
    parseSearchTerms('"practical completion" programme|milestone weeks a'),
    ["practical completion", "programme", "milestone", "weeks"],
  );
});

test("paginatePdfPages returns small PDFs unchanged for backward compatibility", () => {
  const res = paginatePdfPages(["Page one text", "Page two text"], {
    file: "attachments/brief.pdf",
  });
  assert.equal(res.pages, 2);
  assert.equal(res.nextFrom, undefined);
  assert.equal(res.shownPages, undefined);
  assert.match(res.text, /--- Page 1 ---\nPage one text/);
  assert.match(res.text, /--- Page 2 ---\nPage two text/);
});

test("paginatePdfPages paginates a 60-page ITT PDF safely below tool truncation limits", () => {
  const pages = Array.from({ length: 60 }, (_, i) => {
    const n = i + 1;
    if (n === 34) {
      return `Section 4.2 Programme Requirements: Total contract duration is 104 weeks from Date of Appointment (04 May 2026). Sectional Completion Phase 1: 28 Aug 2027. Practical Completion: 28 Apr 2028. Client review window: 15 working days per CWMF Stage.`;
    }
    if (n === 51) {
      return `Appendix C Key Milestones & Statutory Dates: Part 8 Planning Submission Q4 2026, Fire Safety Cert & DAC required prior to Commencement Notice. Defects Liability Period: 12 months.`;
    }
    return `Standard tender clause page ${n}. `.repeat(35);
  });

  // First read without flags stays safely under DEFAULT_READ_BUDGET and returns nextFrom
  const first = paginatePdfPages(pages, { file: "attachments/ITT-Vol-A.pdf" });
  assert.equal(first.pages, 60);
  assert.ok(first.text.length <= DEFAULT_READ_BUDGET);
  assert.ok(first.nextFrom > 1 && first.nextFrom < 60);
  assert.match(first.more, /--from/);
  assert.match(first.more, /--find/);

  // --find locates middle/appendix pages 34 and 51 across the entire 60-page ITT
  const found = paginatePdfPages(pages, {
    file: "attachments/ITT-Vol-A.pdf",
    find: "programme duration weeks sectional milestone defects",
  });
  assert.equal(found.pages, 60);
  assert.deepEqual(found.matchedPages, [34, 51]);
  assert.equal(found.matches[0].page, 34);
  assert.match(found.matches[0].excerpt, /104 weeks/);
  assert.ok(JSON.stringify(found).length < 11_000);

  // --from / --to reads page 34 in full
  const exact = paginatePdfPages(pages, {
    file: "attachments/ITT-Vol-A.pdf",
    from: 34,
    to: 35,
  });
  assert.deepEqual(exact.shownPages, [34, 35]);
  assert.match(exact.text, /104 weeks/);
  assert.match(exact.text, /15 working days/);
});

test("paginatePdfPages flags scanned image-only PDFs clearly", () => {
  const res = paginatePdfPages(["", "   ", ""], { file: "attachments/scan.pdf" });
  assert.match(res.note ?? "", /scanned images/i);
});

test("paginateWordOutline preserves small Word outlines unchanged and paginates/searches large ITT docs", () => {
  const small = [{ heading: "Intro", level: 1 }, { text: "Short brief." }];
  const smallRes = paginateWordOutline(small, { file: "attachments/small.docx" });
  assert.deepEqual(smallRes, { outline: small });

  const large = [];
  for (let s = 1; s <= 25; s += 1) {
    large.push({ heading: `Section ${s} Requirements`, level: 1 });
    for (let p = 1; p <= 4; p += 1) {
      if (s === 18 && p === 2) {
        large.push({
          text: "Key Dates Schedule: Site Possession 01 Sep 2026; Substantial Completion 18 months (28 Feb 2028); BCAR Completion Certificate mandatory.",
        });
      } else {
        large.push({ text: `Detailed specification clause ${s}.${p}. `.repeat(12) });
      }
    }
  }

  const first = paginateWordOutline(large, { file: "attachments/Works-Req.docx" });
  assert.equal(first.totalItems, large.length);
  assert.ok(Array.isArray(first.headings) && first.headings.length > 10);
  assert.ok(first.headings.some((h) => h.text === "Section 18 Requirements"));
  assert.ok(first.nextFrom > 0 && first.nextFrom < large.length);
  assert.ok(JSON.stringify(first).length < 11_500);

  const search = paginateWordOutline(large, {
    file: "attachments/Works-Req.docx",
    find: '"Substantial Completion" BCAR months',
  });
  assert.equal(search.matchCount, 1);
  assert.equal(search.matches[0].section, "Section 18 Requirements");
  assert.match(search.matches[0].excerpt, /18 months/);

  const jumped = paginateWordOutline(large, {
    file: "attachments/Works-Req.docx",
    from: search.matches[0].index,
  });
  assert.match(jumped.outline[0].text, /Site Possession 01 Sep 2026/);
});
