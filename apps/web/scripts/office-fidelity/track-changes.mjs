// Word track changes through the editor's own model: tracked edits by the signed-in person keep
// their author in the saved .docx next to the assistant's, and either author's change can be
// accepted or rejected. Run with `node scripts/office-fidelity/track-changes.mjs`.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ocsc = path.resolve(here, "../../../../infra/sandboxes/computer/ocsc/ocsc-word");
const JSZip = createRequire(path.join(ocsc, "package.json"))("jszip");

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const DATE = "2026-11-01T10:00:00Z";
const PERSON = "Keith Example";

async function sourceDocx() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>` +
      `<w:p><w:r><w:t xml:space="preserve">The scope covers the site.</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t xml:space="preserve">Fees are fixed</w:t></w:r>` +
      `<w:ins w:id="101" w:author="Assistant" w:date="${DATE}"><w:r><w:t xml:space="preserve"> for twelve months</w:t></w:r></w:ins>` +
      `<w:r><w:t xml:space="preserve">.</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t xml:space="preserve">Payment within </w:t></w:r>` +
      `<w:del w:id="102" w:author="Assistant" w:date="${DATE}"><w:r><w:delText xml:space="preserve">60</w:delText></w:r></w:del>` +
      `<w:r><w:t xml:space="preserve"> days.</w:t></w:r></w:p>` +
      `<w:sectPr/></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

const core = {
  ...(await import("@stll/folio-core/server")),
  ...(await import("@stll/folio-core/docx/rezip")),
};
const conversion = await import("@stll/folio-core/prosemirror/conversion");
const { EditorState } = await import("prosemirror-state");
const { SUGGESTION_BYPASS_META, createSuggestionModePlugin, suggestRangeDeletion } = await import(
  "@stll/folio-core/prosemirror/plugins/suggestionMode"
);
const { acceptAIEditRevision, rejectAIEditRevision } = await import(
  "@stll/folio-core/prosemirror/commands/comments"
);

const source = await sourceDocx();
const parsed = await core.parseDocx(source.buffer.slice(0));
const doc = conversion.toProseDoc(parsed, {
  styles: parsed.package?.styles,
  numbering: parsed.package?.numbering,
  theme: parsed.package?.theme ?? null,
});

let state = EditorState.create({ doc, plugins: [createSuggestionModePlugin(true, PERSON)] });
const dispatch = (tr) => {
  state = state.apply(tr);
};

function find(text) {
  let at = null;
  state.doc.descendants((node, pos) => {
    if (at === null && node.isText && node.text.includes(text)) at = pos + node.text.indexOf(text);
  });
  assert.notEqual(at, null, `"${text}" is in the document`);
  return at;
}

// The person types a word and deletes one, with track changes on.
const typeAt = find("the site") + "the ".length;
dispatch(state.tr.insertText("whole ", typeAt));
const cut = find("scope");
const tr = state.tr;
assert.ok(suggestRangeDeletion(state, tr, cut, cut + "scope".length), "deletion is tracked");
dispatch(tr);

function marks() {
  const found = [];
  state.doc.descendants((node) => {
    for (const mark of node.marks ?? [])
      if (mark.type.name === "insertion" || mark.type.name === "deletion")
        found.push({
          type: mark.type.name,
          id: mark.attrs.revisionId,
          author: mark.attrs.author,
          text: node.text,
        });
  });
  return found;
}

async function savedXml() {
  const rebuilt = conversion.fromProseDoc(state.doc, parsed, {
    stylesheetSource: { type: "package" },
  });
  const bytes = await core.repackDocx(rebuilt);
  const zip = await JSZip.loadAsync(bytes);
  return zip.file("word/document.xml").async("string");
}

function revisions(xml) {
  return [...xml.matchAll(/<w:(ins|del)\b[^>]*w:author="([^"]*)"[^>]*>([\s\S]*?)<\/w:\1>/g)].map(
    (m) => ({
      type: m[1],
      author: m[2],
      text: [...m[3].matchAll(/<w:(?:t|delText)[^>]*>([^<]*)</g)].map((t) => t[1]).join(""),
    }),
  );
}

const before = marks();
const mine = before.filter((m) => m.author === PERSON);
assert.deepEqual(
  mine.map((m) => [m.type, m.text]).sort(),
  [
    ["deletion", "scope"],
    ["insertion", "whole "],
  ].sort(),
  "the person's edits are tracked under their name",
);

const xml = await savedXml();
const saved = revisions(xml);
const expectSaved = [
  { type: "ins", author: PERSON, text: "whole " },
  { type: "del", author: PERSON, text: "scope" },
  { type: "ins", author: "Assistant", text: " for twelve months" },
  { type: "del", author: "Assistant", text: "60" },
];
for (const want of expectSaved)
  assert.ok(
    saved.some((r) => r.type === want.type && r.author === want.author && r.text === want.text),
    `saved .docx keeps w:${want.type} by ${want.author} ("${want.text}")`,
  );
console.log("saved revisions:", saved);

// Accept the person's insertion, reject the assistant's insertion and the person's deletion,
// accept the assistant's deletion.
const id = (type, author) => before.find((m) => m.type === type && m.author === author).id;
// As WordEditor's resolve does: resolving a change is not itself tracked.
const run = (command, ids, label) =>
  assert.ok(
    command(ids)(state, (t) => dispatch(t.setMeta(SUGGESTION_BYPASS_META, true))),
    label,
  );
run(acceptAIEditRevision, id("insertion", PERSON), "accept the person's insertion");
run(rejectAIEditRevision, id("insertion", "Assistant"), "reject the assistant's insertion");
run(rejectAIEditRevision, id("deletion", PERSON), "reject the person's deletion");
run(acceptAIEditRevision, id("deletion", "Assistant"), "accept the assistant's deletion");

const resolved = await savedXml();
assert.deepEqual(revisions(resolved), [], "no tracked changes left");
const text = [...resolved.matchAll(/<w:t[^>]*>([^<]*)</g)].map((m) => m[1]).join("");
assert.equal(text, "The scope covers the whole site.Fees are fixed.Payment within  days.");
console.log("after accept/reject:", text);
console.log("track changes round trip: ok");
