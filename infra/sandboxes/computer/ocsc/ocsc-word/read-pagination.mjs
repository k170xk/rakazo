/**
 * Bounded pagination and full-document keyword search for `ocsc-pdf read` and `ocsc-word read`.
 *
 * Agent tool results over ~12,000 characters are clipped in the middle by the runtime serializer.
 * Keeping every read response safely under `maxChars` (~9,000 chars) while providing `--from`,
 * `--to`, and `--find` ensures long ITTs, Employer's Requirements, and specifications can be
 * interrogated end-to-end without silently losing middle pages or schedules.
 */

export const DEFAULT_READ_BUDGET = 9_000;

/**
 * Split a search query into deduplicated lowercase terms (supports space or `|` separators).
 * Quoted phrases stay together so `--find "\"practical completion\" milestone"` works naturally.
 */
export function parseSearchTerms(raw) {
  const input = String(raw ?? "").trim();
  if (!input) return [];
  const terms = [];
  const seen = new Set();
  const pattern = /"([^"]+)"|'([^']+)'|[^|\s]+/g;
  let match;
  while ((match = pattern.exec(input)) !== null) {
    const token = (match[1] ?? match[2] ?? match[0] ?? "").trim().toLowerCase();
    if (!token || token.length < 2) continue;
    if (!seen.has(token)) {
      seen.add(token);
      terms.push(token);
    }
  }
  return terms;
}

function buildExcerpt(text, terms, maxExcerpt = 360) {
  const clean = String(text ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!clean) return "";
  if (clean.length <= maxExcerpt) return clean;
  const lower = clean.toLowerCase();
  let firstPos = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (firstPos === -1 || idx < firstPos)) firstPos = idx;
  }
  if (firstPos === -1) return `${clean.slice(0, maxExcerpt - 1)}…`;
  const start = Math.max(0, firstPos - Math.floor(maxExcerpt * 0.25));
  const end = Math.min(clean.length, start + maxExcerpt);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < clean.length ? "…" : "";
  return `${prefix}${clean.slice(start, end).trim()}${suffix}`;
}

function positiveInt(value, label) {
  if (value === undefined || value === null || value === "" || value === false) return null;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`${label} must be a positive whole number.`);
  }
  return n;
}

function nonNegativeInt(value, label) {
  if (value === undefined || value === null || value === "" || value === false) return null;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${label} must be a whole number (0 or greater).`);
  }
  return n;
}

/**
 * Paginate or search extracted PDF pages (`pages` is 0-indexed array of page strings).
 */
export function paginatePdfPages(
  pages,
  {
    totalPages = pages.length,
    file = "document.pdf",
    from,
    to,
    find,
    maxChars = DEFAULT_READ_BUDGET,
  } = {},
) {
  const safePages = Array.isArray(pages) ? pages.map((p) => String(p ?? "")) : [];
  const total = Math.max(totalPages, safePages.length);
  const nonEmptyCount = safePages.filter((p) => p.trim().length > 0).length;

  const scannedNote =
    total > 0 && nonEmptyCount === 0
      ? "No selectable text was found in this PDF — it appears to be scanned images or drawings."
      : undefined;

  if (find !== undefined && find !== false && String(find).trim()) {
    const terms = parseSearchTerms(find);
    const hits = [];
    for (let i = 0; i < safePages.length; i += 1) {
      const text = safePages[i];
      if (!text.trim()) continue;
      const lower = text.toLowerCase();
      const matchedTerms = terms.filter((t) => lower.includes(t));
      if (matchedTerms.length === 0) continue;
      hits.push({
        page: i + 1,
        matchedTerms,
        excerpt: buildExcerpt(text, matchedTerms, 340),
      });
    }
    // Rank pages matching the most distinct query terms first, breaking ties by page order.
    hits.sort((a, b) => b.matchedTerms.length - a.matchedTerms.length || a.page - b.page);
    const matchedPages = [...hits].sort((a, b) => a.page - b.page).map((h) => h.page);

    const shown = [];
    let used = 0;
    const budget = Math.max(1_500, maxChars - 1_200);
    for (const hit of hits) {
      const size = JSON.stringify(hit).length + 2;
      if (shown.length > 0 && used + size > budget) break;
      shown.push(hit);
      used += size;
    }

    return {
      pages: total,
      query: String(find).trim(),
      matchedPages,
      matchCount: hits.length,
      matches: shown,
      ...(shown.length < hits.length
        ? {
            more: `Showing top ${shown.length} of ${hits.length} matching pages (${matchedPages.join(", ")}). Read any page in full with: ocsc-pdf read --in ${file} --from <page> --to <page>.`,
          }
        : hits.length > 0
          ? {
              note: `Read any matching page in full with: ocsc-pdf read --in ${file} --from <page> --to <page>.`,
            }
          : {}),
      ...(scannedNote ? { note: scannedNote } : {}),
    };
  }

  const startPage = positiveInt(from, "--from") ?? 1;
  const requestedEnd = positiveInt(to, "--to");
  if (startPage > Math.max(1, safePages.length)) {
    throw new Error(`--from ${startPage} is past the end of ${file} (${total} pages).`);
  }
  const maxEnd = Math.min(safePages.length, requestedEnd ?? safePages.length);
  if (requestedEnd !== null && requestedEnd < startPage) {
    throw new Error(`--to (${requestedEnd}) must be >= --from (${startPage}).`);
  }

  const hasExplicitRange = from !== undefined || to !== undefined;
  const chunks = [];
  let used = 0;
  let lastPageIncluded = startPage - 1;
  let truncatedSinglePage = false;

  for (let p = startPage; p <= maxEnd; p += 1) {
    const chunk = `--- Page ${p} ---\n${safePages[p - 1] ?? ""}`;
    const sep = chunks.length > 0 ? 2 : 0;
    if (chunks.length > 0 && used + sep + chunk.length > maxChars) break;
    if (chunks.length === 0 && chunk.length > maxChars) {
      chunks.push(`${chunk.slice(0, maxChars - 40)}\n...[page ${p} truncated at ${maxChars} chars]`);
      used = maxChars;
      lastPageIncluded = p;
      truncatedSinglePage = true;
      break;
    }
    chunks.push(chunk);
    used += sep + chunk.length;
    lastPageIncluded = p;
  }

  const text = chunks.join("\n\n");
  const isCompleteDocument =
    !hasExplicitRange && lastPageIncluded >= total && !truncatedSinglePage;

  if (isCompleteDocument) {
    return {
      pages: total,
      text,
      ...(scannedNote ? { note: scannedNote } : {}),
    };
  }

  const hasMoreInDoc = lastPageIncluded < total;
  const nextFrom = hasMoreInDoc ? lastPageIncluded + 1 : undefined;
  const suggestedTo = nextFrom ? Math.min(total, nextFrom + Math.max(3, lastPageIncluded - startPage)) : undefined;

  return {
    pages: total,
    shownPages: [startPage, Math.max(startPage, lastPageIncluded)],
    text,
    ...(nextFrom
      ? {
          nextFrom,
          more: `Pages ${nextFrom} to ${total} were not shown. Read them with: ocsc-pdf read --in ${file} --from ${nextFrom} --to ${suggestedTo}, or search all pages with: ocsc-pdf read --in ${file} --find "programme duration milestone deadline".`,
        }
      : {}),
    ...(scannedNote ? { note: scannedNote } : {}),
  };
}

function wordItemText(item) {
  if (!item || typeof item !== "object") return "";
  if (typeof item.heading === "string") return item.heading;
  if (typeof item.text === "string") return item.text;
  if (Array.isArray(item.table)) {
    return item.table.map((row) => (Array.isArray(row) ? row.join(" | ") : "")).join("\n");
  }
  return "";
}

/**
 * Paginate or search an `ocsc-word` outline array so large ITT / Works Requirements Word docs
 * never exceed tool-result truncation limits.
 */
export function paginateWordOutline(
  outline,
  { file = "document.docx", from, find, maxChars = DEFAULT_READ_BUDGET } = {},
) {
  const items = Array.isArray(outline) ? outline : [];

  if (find !== undefined && find !== false && String(find).trim()) {
    const terms = parseSearchTerms(find);
    let currentHeading = null;
    const hits = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item && typeof item.heading === "string") currentHeading = item.heading;
      const body = wordItemText(item);
      if (!body.trim()) continue;
      const lower = body.toLowerCase();
      const matchedTerms = terms.filter((t) => lower.includes(t));
      if (matchedTerms.length === 0) continue;
      hits.push({
        index: i,
        ...(currentHeading ? { section: currentHeading } : {}),
        matchedTerms,
        excerpt: buildExcerpt(body, matchedTerms, 340),
      });
    }
    hits.sort((a, b) => b.matchedTerms.length - a.matchedTerms.length || a.index - b.index);
    const shown = [];
    let used = 0;
    const budget = Math.max(1_500, maxChars - 1_200);
    for (const hit of hits) {
      const size = JSON.stringify(hit).length + 2;
      if (shown.length > 0 && used + size > budget) break;
      shown.push(hit);
      used += size;
    }
    return {
      totalItems: items.length,
      query: String(find).trim(),
      matchCount: hits.length,
      matches: shown,
      ...(shown.length < hits.length
        ? {
            more: `Showing top ${shown.length} of ${hits.length} matches. Read around any index with: ocsc-word read --in ${file} --from <index>.`,
          }
        : hits.length > 0
          ? {
              note: `Read around any match index with: ocsc-word read --in ${file} --from <index>.`,
            }
          : {}),
    };
  }

  const startIndex = nonNegativeInt(from, "--from") ?? 0;
  if (items.length > 0 && startIndex >= items.length) {
    throw new Error(`--from ${startIndex} is past the end of ${file} (${items.length} items).`);
  }

  const fullSerializedLength = JSON.stringify(items).length;
  if (from === undefined && fullSerializedLength <= maxChars) {
    return { outline: items };
  }

  // Build compact headings index across the entire document so the reader sees the full structure.
  const headings = [];
  let headingChars = 0;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item && typeof item.heading === "string") {
      const entry = { index: i, level: item.level ?? 1, text: item.heading };
      const sz = JSON.stringify(entry).length + 2;
      if (headingChars + sz > 2_000) break;
      headings.push(entry);
      headingChars += sz;
    }
  }

  const sliceBudget = Math.max(2_000, maxChars - headingChars - 600);
  const shown = [];
  let used = 0;
  let nextIdx = startIndex;

  for (let i = startIndex; i < items.length; i += 1) {
    const item = items[i];
    const sz = JSON.stringify(item).length + 2;
    if (shown.length > 0 && used + sz > sliceBudget) break;
    if (shown.length === 0 && sz > sliceBudget) {
      const text = wordItemText(item);
      shown.push({
        ...(item.heading ? { heading: item.heading, level: item.level } : {}),
        text: `${text.slice(0, sliceBudget - 80)}…[truncated]`,
      });
      used = sliceBudget;
      nextIdx = i + 1;
      break;
    }
    shown.push(item);
    used += sz;
    nextIdx = i + 1;
  }

  const hasMore = nextIdx < items.length;
  return {
    totalItems: items.length,
    shownRange: [startIndex, Math.max(startIndex, nextIdx - 1)],
    ...(headings.length ? { headings } : {}),
    outline: shown,
    ...(hasMore
      ? {
          nextFrom: nextIdx,
          more: `Items ${nextIdx} to ${items.length - 1} were not shown. Read more with: ocsc-word read --in ${file} --from ${nextIdx}, or search the full document with: ocsc-word read --in ${file} --find "programme duration milestone deadline".`,
        }
      : {}),
  };
}
