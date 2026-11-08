/**
 * Slide transitions and entrance builds. Builds start on their own after the transition (no
 * clicks): placeholders such as the heading are there from the start, and the slide's own shapes
 * float in one group after another, the main picture first and a shape lying inside another (a
 * card's words) arriving with it. Pictures fade, thin rules and connectors wipe in from the left.
 */

export const TRANSITIONS = ["fade", "push", "wipe", "cover", "none"];

const TRANSITION_XML = {
  fade: "<p:fade/>",
  push: '<p:push dir="u"/>',
  wipe: '<p:wipe dir="r"/>',
  cover: '<p:cover dir="l"/>',
};

const DURATION = 500;
const PICTURE_DURATION = 700;
const TOTAL_STAGGER = 1600;
/** Shapes covering more of the slide than this are backgrounds and are there from the start. */
const BACKGROUND_SHARE = 0.45;
/** Pictures larger than this are the slide's main visual and arrive first. */
const HERO_SHARE = 0.12;
const TAGS = /<(\/?)p:(sp|pic|graphicFrame|grpSp|cxnSp|contentPart)\b[^>]*?(\/?)>/g;

function boxOf(xml) {
  const m = /<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>\s*<a:ext cx="(\d+)" cy="(\d+)"/.exec(xml);
  return m ? { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) } : null;
}

/** The shapes directly in the slide's shape tree, in drawing order. */
function topLevelShapes(xml) {
  const start = xml.indexOf("<p:spTree>");
  const end = xml.lastIndexOf("</p:spTree>");
  if (start < 0 || end < 0) return [];
  const tree = xml.slice(start, end);
  const shapes = [];
  let depth = 0;
  let from = 0;
  let kind = "";
  for (const m of tree.matchAll(TAGS)) {
    if (m[3]) continue;
    if (m[1]) {
      depth -= 1;
      if (depth === 0) shapes.push({ kind, xml: tree.slice(from, m.index + m[0].length) });
    } else {
      if (depth === 0) {
        from = m.index;
        kind = m[2];
      }
      depth += 1;
    }
  }
  return shapes;
}

function inside(inner, outer) {
  const slack = 0.02 * Math.max(outer.w, outer.h);
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.w <= outer.x + outer.w + slack &&
    inner.y + inner.h <= outer.y + outer.h + slack
  );
}

/** Groups of shape ids that arrive together, in order. */
function buildGroups(xml, size) {
  const groups = [];
  const named = new Map();
  for (const shape of topLevelShapes(xml)) {
    if (/<p:ph\b/.test(shape.xml)) continue;
    const id = /<p:cNvPr\b[^>]*?\bid="(\d+)"/.exec(shape.xml)?.[1];
    const box = boxOf(shape.xml);
    if (!id || !box) continue;
    if (size && box.w * box.h > BACKGROUND_SHARE * size.cx * size.cy) continue;
    const entry = {
      id,
      box,
      kind: shape.kind,
      hasText: /<a:t>/.test(shape.xml),
      line: shape.kind === "cxnSp" || box.h < 0.02 * (size?.cy ?? 6858000),
    };
    const name = /<p:cNvPr\b[^>]*?\bname="(Agenda item \d+)/.exec(shape.xml)?.[1];
    if (name) {
      const group = named.get(name);
      if (group) group.push(entry);
      else {
        named.set(name, [entry]);
        groups.push(named.get(name));
      }
      continue;
    }
    const host = [...groups].reverse().find((g) => g.some((s) => !s.line && inside(box, s.box)));
    if (host) host.push(entry);
    else groups.push([entry]);
  }
  const area = (size?.cx ?? 12192000) * (size?.cy ?? 6858000);
  const hero = (g) => g[0].kind === "pic" && g[0].box.w * g[0].box.h > HERO_SHARE * area;
  return [...groups.filter(hero), ...groups.filter((g) => !hero(g))];
}

function effect(shape, delay, first, ids) {
  const id = () => ids.next++;
  const target = `<p:tgtEl><p:spTgt spid="${shape.id}"/></p:tgtEl>`;
  const show = `<p:set><p:cBhvr><p:cTn id="${id()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>${target}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`;
  const node = first ? "afterEffect" : "withEffect";
  const open = (preset, subtype) =>
    `<p:par><p:cTn id="${id()}" presetID="${preset}" presetClass="entr" presetSubtype="${subtype}" fill="hold" grpId="0" nodeType="${node}"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst><p:childTnLst>${show}`;
  const close = "</p:childTnLst></p:cTn></p:par>";
  if (shape.line)
    return `${open(22, 8)}<p:animEffect transition="in" filter="wipe(left)"><p:cBhvr><p:cTn id="${id()}" dur="${DURATION}"/>${target}</p:cBhvr></p:animEffect>${close}`;
  if (shape.kind === "pic" || shape.kind === "graphicFrame")
    return `${open(10, 0)}<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${id()}" dur="${PICTURE_DURATION}"/>${target}</p:cBhvr></p:animEffect>${close}`;
  const axis = (name, from) =>
    `<p:anim calcmode="lin" valueType="num"><p:cBhvr><p:cTn id="${id()}" dur="${DURATION}" decel="100000" fill="hold"/>${target}<p:attrNameLst><p:attrName>${name}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="#${name}"/></p:val></p:tav></p:tavLst></p:anim>`;
  return `${open(42, 0)}<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${id()}" dur="${DURATION}"/>${target}</p:cBhvr></p:animEffect>${axis("ppt_x", "#ppt_x")}${axis("ppt_y", "#ppt_y+.03")}${close}`;
}

function timingXml(groups) {
  const ids = { next: 5 };
  const step = Math.round(Math.min(220, Math.max(90, TOTAL_STAGGER / groups.length)));
  const effects = groups
    .flatMap((group, g) =>
      group.map((shape, i) => effect(shape, g * step, g === 0 && i === 0, ids)),
    )
    .join("");
  const builds = groups
    .flat()
    .map((s) =>
      s.kind === "sp"
        ? `<p:bldP spid="${s.id}" grpId="0"${s.hasText ? "" : ' animBg="1"'}/>`
        : s.kind === "graphicFrame"
          ? `<p:bldGraphic spid="${s.id}" grpId="0"><p:bldAsOne/></p:bldGraphic>`
          : "",
    )
    .join("");
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst><p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${effects}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>${builds ? `<p:bldLst>${builds}</p:bldLst>` : ""}</p:timing>`;
}

/** The motion a slide asks for, its own settings first and then the deck's. */
export function motionOf(item, deck = {}) {
  const transition = item?.transition ?? deck.transition ?? "fade";
  if (!TRANSITIONS.includes(transition))
    throw new Error(`"transition" must be one of ${TRANSITIONS.join(", ")}.`);
  return { transition, animate: (item?.animate ?? deck.animate) !== false };
}

/** A slide's XML with its transition and entrance builds replaced by the given ones. */
export function addMotion(xml, { transition = "fade", animate = true } = {}, size = null) {
  const out = xml
    .replace(
      /<mc:AlternateContent\b(?:(?!<\/mc:AlternateContent>)[\s\S])*?<p:transition\b[\s\S]*?<\/mc:AlternateContent>/g,
      "",
    )
    .replace(/<p:transition\b[^>]*\/>|<p:transition\b[\s\S]*?<\/p:transition>/g, "")
    .replace(/<p:timing>[\s\S]*?<\/p:timing>/g, "");
  const groups = animate ? buildGroups(out, size) : [];
  const added =
    (TRANSITION_XML[transition]
      ? `<p:transition spd="med">${TRANSITION_XML[transition]}</p:transition>`
      : "") + (groups.length ? timingXml(groups) : "");
  if (!added) return out;
  const at = out.includes("</p:clrMapOvr>") ? "</p:clrMapOvr>" : "</p:cSld>";
  return out.replace(at, `${at}${added}`);
}
