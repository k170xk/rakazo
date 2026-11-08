/**
 * Infographic blocks for Word: a GPT Image infographic (drawn without text) laid out with its
 * words as ordinary Word text in borderless tables, in the same styles as the PowerPoint slides
 * (cards, checklist, steps, timeline, stats, kpis, progress, compare, statement, highlight,
 * banner, quote, side, full). Everything but the picture stays editable, and each block is kept
 * on one page where it fits.
 */

const GREEN = "77C043";
const INK = "1F2A33";
const MUTED = "5F6B73";
const TINT = "F3F7F0";
const RULE = "DDE3D8";
const WIDTH = 9026;
const EMU_PER_DXA = 635;
const PAD = 120;

export const WORD_STYLES = [
  "side",
  "cards",
  "checklist",
  "steps",
  "timeline",
  "stats",
  "kpis",
  "progress",
  "compare",
  "statement",
  "highlight",
  "banner",
  "quote",
  "full",
];

const text = (value, max = 600) =>
  typeof value === "string" || typeof value === "number" ? String(value).slice(0, max).trim() : "";

function pointsOf(block) {
  const list = Array.isArray(block.points)
    ? block.points
    : Array.isArray(block.bullets)
      ? block.bullets
      : [];
  return list
    .map((p) =>
      typeof p === "string"
        ? { title: "", text: text(p) }
        : { title: text(p?.title, 120), text: text(p?.text) },
    )
    .filter((p) => p.title || p.text);
}

const statsOf = (block) =>
  (Array.isArray(block.stats) ? block.stats : [])
    .map((s) => ({ value: text(s?.value, 20), label: text(s?.label, 120) }))
    .filter((s) => s.value);

const milestonesOf = (block) =>
  (Array.isArray(block.milestones) ? block.milestones : [])
    .map((m) => ({ date: text(m?.date, 40), label: text(m?.label, 80), text: text(m?.text, 200) }))
    .filter((m) => m.date || m.label);

const barsOf = (block) =>
  (Array.isArray(block.bars) ? block.bars : [])
    .map((b) => ({
      label: text(b?.label, 80),
      value: Math.max(0, Math.min(100, Number(b?.value) || 0)),
    }))
    .filter((b) => b.label);

function compareOf(block) {
  const side = (s) => ({
    label: text(s?.label, 60),
    points: (Array.isArray(s?.points) ? s.points : []).map((p) => text(p, 200)).filter(Boolean),
  });
  return block.compare
    ? { left: side(block.compare.left), right: side(block.compare.right) }
    : null;
}

/** The style a block asks for, or the one its content suggests, never repeating `previous`. */
export function wordStyle(block, previous) {
  if (WORD_STYLES.includes(block.style)) return block.style;
  if (block.style) throw new Error(`"style" must be one of ${WORD_STYLES.join(", ")}.`);
  const points = pointsOf(block);
  const stats = statsOf(block);
  const options = compareOf(block)
    ? ["compare"]
    : milestonesOf(block).length
      ? ["timeline"]
      : barsOf(block).length
        ? ["progress"]
        : text(block.quote)
          ? ["quote"]
          : stats.length
            ? stats.length > 3
              ? ["kpis"]
              : ["stats"]
            : text(block.statement)
              ? ["highlight", "statement", "banner"]
              : points.some((p) => p.title)
                ? ["cards", "steps"]
                : points.length
                  ? ["checklist", "side", "banner"]
                  : ["full"];
  return options.find((s) => s !== previous) ?? options[0];
}

// ---------- Word XML ----------

function rPr({ b, i, color, sz, shd } = {}) {
  return (
    `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>` +
    (b ? "<w:b/>" : "") +
    (i ? "<w:i/>" : "") +
    (color ? `<w:color w:val="${color}"/>` : "") +
    (sz ? `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>` : "") +
    (shd ? `<w:shd w:val="clear" w:color="auto" w:fill="${shd}"/>` : "")
  );
}

function makeXml(runs) {
  const para = (content, { align, before = 0, after = 80, keep = true, border = "", line } = {}) =>
    `<w:p><w:pPr>${keep ? "<w:keepNext/><w:keepLines/>" : ""}${border}<w:spacing w:before="${before}" w:after="${after}"${line ? ` w:line="${line}" w:lineRule="auto"` : ""}/>${align ? `<w:jc w:val="${align}"/>` : ""}</w:pPr>${content}</w:p>`;
  const say = (value, style) => runs(value, rPr(style));
  const cell = (
    width,
    content,
    { fill, span, vMerge, valign = "top", borders = "", margin } = {},
  ) =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}${vMerge ? `<w:vMerge${vMerge === "restart" ? ' w:val="restart"' : ""}/>` : ""}${borders ? `<w:tcBorders>${borders}</w:tcBorders>` : ""}${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ""}${margin ? `<w:tcMar><w:top w:w="${margin}" w:type="dxa"/><w:left w:w="${margin}" w:type="dxa"/><w:bottom w:w="${margin}" w:type="dxa"/><w:right w:w="${margin}" w:type="dxa"/></w:tcMar>` : ""}<w:vAlign w:val="${valign}"/></w:tcPr>${content || "<w:p/>"}</w:tc>`;
  const row = (cells, height) =>
    `<w:tr><w:trPr><w:cantSplit/>${height ? `<w:trHeight w:val="${height}" w:hRule="exact"/>` : ""}</w:trPr>${cells.join("")}</w:tr>`;
  const table = (grid, rows, { spacing = 0, pad = PAD } = {}) =>
    `<w:tbl><w:tblPr><w:tblW w:w="${WIDTH}" w:type="dxa"/><w:jc w:val="center"/>${spacing ? `<w:tblCellSpacing w:w="${spacing}" w:type="dxa"/>` : ""}<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="${pad}" w:type="dxa"/><w:left w:w="${PAD}" w:type="dxa"/><w:bottom w:w="${pad}" w:type="dxa"/><w:right w:w="${PAD}" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000"/></w:tblPr><w:tblGrid>${grid.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${rows.join("")}</w:tbl>`;
  return { para, say, cell, row, table };
}

// ---------- the block ----------

/**
 * One infographic block as Word XML. `picture(width)` returns the picture paragraph's drawing
 * run for a picture `width` EMU wide.
 */
export function infographicXml(block, style, { runs, picture, label }) {
  const { para, say, cell, row, table } = makeXml(runs);
  const pic = (widthDxa) =>
    para(picture((widthDxa - 2 * PAD) * EMU_PER_DXA), { align: "center", after: 0 });
  const fullPic = (share = 1) =>
    para(picture(Math.round(WIDTH * share) * EMU_PER_DXA), { align: "center", after: 120 });
  const points = pointsOf(block);
  const statement = text(block.statement, 300);
  const number = (i) => String(i + 1).padStart(2, "0");
  const need = (ok, what) => {
    if (!ok) throw new Error(`${label}: the ${style} style needs ${what}.`);
  };
  const bulletParas = (list, color = INK) =>
    list
      .map((p) =>
        para(
          say("•  ", { b: true, color: color === INK ? GREEN : color, sz: 22 }) +
            (p.title ? say(`${p.title}  `, { b: true, color, sz: 20 }) : "") +
            say(p.text, { color, sz: 20 }),
          { after: 80 },
        ),
      )
      .join("");
  const statementPara = (sz = 30, color = INK) =>
    para(say(statement, { b: true, color, sz }), { after: 120, line: 264 });

  let body;
  switch (style) {
    case "full":
      body = fullPic();
      break;
    case "side": {
      need(points.length, '"points" or "bullets"');
      const left = block.picture !== "right";
      const picCell = cell(5000, pic(5000), { valign: "center" });
      const textCell = cell(4026, (statement ? statementPara(24) : "") + bulletParas(points), {
        valign: "center",
      });
      body = left
        ? table([5000, 4026], [row([picCell, textCell])])
        : table([4026, 5000], [row([textCell, picCell])]);
      break;
    }
    case "cards": {
      need(points.length >= 2 && points.length <= 4, '2 to 4 "points"');
      const w = Math.floor(WIDTH / points.length);
      body =
        fullPic(0.72) +
        table(
          points.map(() => w),
          [
            row(
              points.map((p, i) =>
                cell(
                  w,
                  para(say(number(i), { b: true, color: GREEN, sz: 32 }), { after: 40 }) +
                    (p.title
                      ? para(say(p.title, { b: true, color: INK, sz: 21 }), { after: 60 })
                      : "") +
                    (p.text ? para(say(p.text, { color: MUTED, sz: 19 }), { after: 0 }) : ""),
                  { fill: TINT, margin: 160 },
                ),
              ),
            ),
          ],
          { spacing: 60 },
        );
      break;
    }
    case "checklist": {
      need(points.length >= 2 && points.length <= 6, '2 to 6 "points" or "bullets"');
      body = table(
        [4500, 4526],
        points.map((p, i) =>
          row([
            cell(4500, i === 0 ? pic(4500) : "", {
              vMerge: i === 0 ? "restart" : "continue",
              valign: "center",
            }),
            cell(
              4526,
              para(
                say("✓  ", { b: true, color: GREEN, sz: 24 }) +
                  (p.title
                    ? say(p.title + (p.text ? "  " : ""), { b: true, color: INK, sz: 20 })
                    : "") +
                  (p.text ? say(p.text, { color: MUTED, sz: 19 }) : ""),
                { after: 0 },
              ),
              { fill: TINT, valign: "center", margin: 140 },
            ),
          ]),
        ),
        { spacing: 50 },
      );
      break;
    }
    case "steps": {
      need(points.length >= 3 && points.length <= 5, '3 to 5 "points"');
      const w = Math.floor(WIDTH / points.length);
      const top = `<w:top w:val="single" w:sz="24" w:space="0" w:color="${GREEN}"/>`;
      body =
        fullPic(0.72) +
        table(
          points.map(() => w),
          [
            row(
              points.map((p, i) =>
                cell(
                  w,
                  para(
                    say(` ${i + 1} `, { b: true, color: "FFFFFF", sz: 24, shd: GREEN }) +
                      say(i < points.length - 1 ? "   →" : "", { b: true, color: GREEN, sz: 24 }),
                    { after: 80 },
                  ) +
                    (p.title
                      ? para(say(p.title, { b: true, color: INK, sz: 20 }), { after: 40 })
                      : "") +
                    (p.text ? para(say(p.text, { color: MUTED, sz: 18 }), { after: 0 }) : ""),
                  { borders: top },
                ),
              ),
            ),
          ],
        );
      break;
    }
    case "timeline": {
      const milestones = milestonesOf(block);
      need(milestones.length >= 3 && milestones.length <= 6, '3 to 6 "milestones"');
      const w = Math.floor(WIDTH / milestones.length);
      const top = `<w:top w:val="dotted" w:sz="18" w:space="0" w:color="${GREEN}"/>`;
      body =
        fullPic(0.72) +
        table(
          milestones.map(() => w),
          [
            row(
              milestones.map((m) =>
                cell(
                  w,
                  para(
                    say("● ", { color: GREEN, sz: 24 }) +
                      say(m.date, { b: true, color: GREEN, sz: 20 }),
                    { after: 0 },
                  ),
                  { margin: 60 },
                ),
              ),
            ),
            row(
              milestones.map((m) =>
                cell(
                  w,
                  (m.label
                    ? para(say(m.label, { b: true, color: INK, sz: 20 }), { after: 40 })
                    : "") +
                    (m.text ? para(say(m.text, { color: MUTED, sz: 18 }), { after: 0 }) : ""),
                  { borders: top },
                ),
              ),
            ),
          ],
        );
      break;
    }
    case "stats": {
      const stats = statsOf(block);
      need(stats.length >= 1 && stats.length <= 3, '1 to 3 "stats"');
      const rule = `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="6" w:color="${RULE}"/></w:pBdr>`;
      const figures = stats
        .map(
          (s, i) =>
            para(say(s.value, { b: true, color: GREEN, sz: 56 }), { after: 0, line: 240 }) +
            para(say(s.label, { color: MUTED, sz: 19 }), {
              after: 160,
              border: i < stats.length - 1 ? rule : "",
            }),
        )
        .join("");
      body = table(
        [5400, 3626],
        [
          row([
            cell(5400, pic(5400), { valign: "center" }),
            cell(3626, figures, { valign: "center" }),
          ]),
        ],
      );
      break;
    }
    case "kpis": {
      const stats = statsOf(block);
      need(stats.length >= 2 && stats.length <= 5, '2 to 5 "stats"');
      const w = Math.floor(WIDTH / stats.length);
      body =
        fullPic(0.72) +
        table(
          stats.map(() => w),
          [
            row(
              stats.map((s) =>
                cell(
                  w,
                  para(say(s.value, { b: true, color: GREEN, sz: 44 }), {
                    align: "center",
                    after: 0,
                    line: 240,
                  }) + para(say(s.label, { color: MUTED, sz: 18 }), { align: "center", after: 0 }),
                  { fill: TINT, valign: "center", margin: 160 },
                ),
              ),
            ),
          ],
          { spacing: 60 },
        );
      break;
    }
    case "progress": {
      const bars = barsOf(block);
      need(bars.length >= 2 && bars.length <= 6, '2 to 6 "bars"');
      const steps = 20;
      const labelW = 2600;
      const valueW = 826;
      const stepW = Math.floor((WIDTH - labelW - valueW) / steps);
      const grid = [
        labelW,
        ...Array(steps).fill(stepW),
        WIDTH - labelW - valueW - stepW * steps + valueW,
      ];
      const rows = bars.flatMap((b, i) => {
        const filled = Math.round((b.value / 100) * steps);
        const barCells = [
          filled > 0
            ? cell(stepW * filled, para("", { after: 0 }), { fill: GREEN, span: filled })
            : "",
          filled < steps
            ? cell(stepW * (steps - filled), para("", { after: 0 }), {
                fill: "E4E9E1",
                span: steps - filled,
              })
            : "",
        ];
        const line = row(
          [
            cell(labelW, para(say(b.label, { b: true, color: INK, sz: 19 }), { after: 0 }), {
              valign: "center",
            }),
            ...barCells,
            cell(
              grid[grid.length - 1],
              para(say(`${b.value}%`, { b: true, color: GREEN, sz: 20 }), {
                align: "right",
                after: 0,
              }),
              { valign: "center" },
            ),
          ],
          360,
        );
        return i < bars.length - 1
          ? [line, row([cell(WIDTH, para("", { after: 0 }), { span: steps + 2 })], 140)]
          : [line];
      });
      body = fullPic(0.66) + table(grid, rows, { pad: 0 });
      break;
    }
    case "compare": {
      const compare = compareOf(block);
      need(
        compare?.left.points.length && compare?.right.points.length,
        '"compare" with left and right points',
      );
      const label = `<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="4" w:color="${GREEN}"/></w:pBdr>`;
      const side = (s) =>
        para(say(s.label.toUpperCase(), { b: true, color: GREEN, sz: 20 }), {
          border: label,
          after: 120,
        }) + bulletParas(s.points.map((p) => ({ text: p })));
      body = table(
        [2600, 3826, 2600],
        [
          row([
            cell(2600, side(compare.left)),
            cell(3826, pic(3826), { valign: "center" }),
            cell(2600, side(compare.right)),
          ]),
        ],
      );
      break;
    }
    case "statement": {
      need(statement, 'a "statement"');
      const bar = `<w:left w:val="single" w:sz="48" w:space="0" w:color="${GREEN}"/>`;
      body =
        fullPic(0.72) +
        table(
          [WIDTH],
          [
            row([
              cell(WIDTH, statementPara(28) + bulletParas(points), {
                fill: TINT,
                borders: bar,
                margin: 220,
              }),
            ]),
          ],
        );
      break;
    }
    case "highlight": {
      need(statement, 'a "statement"');
      body =
        fullPic(0.72) +
        para(say(statement, { b: true, color: INK, sz: 30, shd: "D4ECC2" }), {
          align: "center",
          after: 120,
          line: 300,
        }) +
        points
          .map((p) => para(say(p.text, { color: MUTED, sz: 20 }), { align: "center", after: 60 }))
          .join("");
      break;
    }
    case "banner": {
      need(statement || points.length, 'a "statement" or "bullets"');
      body = table(
        [5000, 4026],
        [
          row([
            cell(5000, pic(5000), { valign: "center" }),
            cell(
              4026,
              (statement ? statementPara(26, "FFFFFF") : "") + bulletParas(points, "FFFFFF"),
              {
                fill: GREEN,
                valign: "center",
                margin: 260,
              },
            ),
          ]),
        ],
      );
      break;
    }
    case "quote": {
      const quote = text(block.quote, 400);
      need(quote, 'a "quote"');
      body = table(
        [4600, 4426],
        [
          row([
            cell(4600, pic(4600), { valign: "center" }),
            cell(
              4426,
              para(say("“", { b: true, color: GREEN, sz: 96 }), { after: 0, line: 240 }) +
                para(say(quote, { i: true, color: INK, sz: 26 }), { after: 160, line: 300 }) +
                (text(block.attribution)
                  ? para(
                      say(`— ${text(block.attribution, 120)}`, { b: true, color: GREEN, sz: 20 }),
                      { after: 0 },
                    )
                  : ""),
              { valign: "center" },
            ),
          ]),
        ],
      );
      break;
    }
    default:
      throw new Error(`${label}: unknown style ${style}.`);
  }
  const caption = text(block.caption, 200);
  return (
    body +
    (caption
      ? `<w:p><w:pPr><w:pStyle w:val="Caption"/><w:jc w:val="center"/></w:pPr>${runs(caption)}</w:p>`
      : '<w:p><w:pPr><w:spacing w:after="120"/></w:pPr></w:p>')
  );
}
