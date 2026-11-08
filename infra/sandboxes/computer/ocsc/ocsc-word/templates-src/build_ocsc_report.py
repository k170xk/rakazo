#!/usr/bin/env python3
"""Builds templates/OCSCReport.docx from OCSC's Word report template.

    python3 build_ocsc_report.py "Report Template OCSC.docx" ../templates/OCSCReport.docx

Keeps the digital cover, Notice and Document Control, the Table of Contents, one body section
holding {{content}} and the back cover. The inside pages take the green banner header and
skyline footer of OCSCReportV1.docx beside this script. Drops the print cover, the instructions page and the
sample pages. Content controls become {{fields}}: most are bound to the template's custom XML,
which Word would otherwise copy back over any text put in them.
"""
import os
import re
import sys
import zipfile
from copy import deepcopy

from lxml import etree

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "ct": "http://schemas.openxmlformats.org/package/2006/content-types",
}
W = "{%s}" % NS["w"]

# Content control alias or tag -> field.
FIELDS = {
    "project number": "project_number",
    "insert project name": "project_name",
    "insert document title": "document_title",
    "client name": "client_name",
    "date": "date",
    "revision": "revision",
    "[zone": "zone",
    "zone": "zone",
    "level": "level",
    "role type": "role_type",
    "status": "status",
    "author": "author",
}


def text(el):
    return "".join(el.xpath(".//w:t/text()", namespaces=NS))


def has_sect(el):
    return bool(el.xpath(".//w:sectPr", namespaces=NS))


def sdt_field(sdt):
    pr = sdt.find("w:sdtPr", NS)
    for key in pr.xpath("./w:alias/@w:val", namespaces=NS) + pr.xpath(
        "./w:tag/@w:val", namespaces=NS
    ):
        field = FIELDS.get(key.strip().lower())
        if field:
            return field
    if pr.find("w:date", NS) is not None:
        return "date"
    return None


def set_text(content, value):
    """Puts value in the first text of content and empties the rest, keeping that run's look."""
    ts = content.xpath(".//w:t", namespaces=NS)
    for t in ts[1:]:
        t.getparent().remove(t)
    for style in content.xpath('.//w:rStyle[@w:val="PlaceholderText"]', namespaces=NS):
        style.getparent().remove(style)
    if ts:
        ts[0].text = value
        return
    run = content.xpath(".//w:r", namespaces=NS)
    target = run[0] if run else None
    if target is None:
        paras = content.xpath(".//w:p", namespaces=NS)
        target = etree.SubElement(paras[0] if paras else content, W + "r")
    etree.SubElement(target, W + "t").text = value


def unwrap_sdts(root, keep_toc=True):
    """Replaces every content control (innermost first) with its content, filled with its field."""
    while True:
        sdts = [
            s
            for s in root.iter(W + "sdt")
            if not s.xpath(".//w:sdt", namespaces=NS)
            and not (keep_toc and s.xpath('./w:sdtPr/w:docPartObj/w:docPartGallery[@w:val="Table of Contents"]', namespaces=NS))
        ]
        if not sdts:
            return
        for sdt in sdts:
            content = sdt.find("w:sdtContent", NS)
            field = sdt_field(sdt)
            if field:
                set_text(content, "{{%s}}" % field)
            parent = sdt.getparent()
            at = parent.index(sdt)
            for i, child in enumerate(list(content)):
                parent.insert(at + i, child)
            parent.remove(sdt)
        # A TOC that holds nested controls would loop forever; it has none.


def cell_paragraph_text(tc, value):
    p = tc.find("w:p", NS)
    for r in p.findall("w:r", NS):
        p.remove(r)
    r = etree.SubElement(p, W + "r")
    rpr = p.find("w:pPr/w:rPr", NS)
    if rpr is not None:
        new = deepcopy(rpr)
        new.tag = W + "rPr"
        r.append(new)
    etree.SubElement(r, W + "t").text = value


def build_document(xml):
    root = etree.fromstring(xml)
    body = root.find("w:body", NS)
    els = list(body)

    def find(pred, start=0):
        for i in range(start, len(els)):
            if pred(els[i]):
                return i
        raise SystemExit("Template layout not recognised")

    cover = els[0]
    if etree.QName(cover).localname != "sdt" or "PLEASE DELETE THIS COVER PAGE" not in text(cover):
        raise SystemExit("The first element is not the print cover")
    content = cover.find("w:sdtContent", NS)
    kids = list(content)
    print_end = next(i for i, k in enumerate(kids) if has_sect(k))
    for k in kids[: print_end + 1]:
        content.remove(k)
    # The digital cover's section break already starts a new page; a page break before it leaves a blank one.
    for br in content.xpath('.//w:br[@w:type="page"]', namespaces=NS):
        br.getparent().remove(br)

    instructions = find(lambda e: "INSTRUCTIONS FOR USE" in text(e))
    notice = find(lambda e: text(e).strip() == "NOTICE")
    toc = find(lambda e: etree.QName(e).localname == "sdt" and "Table of Contents" in text(e))
    toc_end = find(has_sect, toc)
    body_start = toc_end + 1
    verification = find(lambda e: text(e).strip() == "Verification")
    body_end = find(has_sect, verification)
    back = find(lambda e: e.xpath('.//w:pStyle[@w:val="BackCoverAddress"]', namespaces=NS))
    final = len(els) - 1
    if etree.QName(els[final]).localname != "sectPr":
        raise SystemExit("No final section")

    keep = (
        [cover]
        + els[instructions + 1 : toc + 1]
        + [els[toc_end]]
        + ["CONTENT"]
        + [els[body_end], els[back], els[final]]
    )
    for e in els:
        body.remove(e)
    for e in keep:
        if e == "CONTENT":
            p = etree.SubElement(body, W + "p")
            ppr = etree.SubElement(p, W + "pPr")
            etree.SubElement(ppr, W + "pStyle").set(W + "val", "Body")
            r = etree.SubElement(p, W + "r")
            etree.SubElement(r, W + "t").text = "{{content}}"
        else:
            body.append(e)
    # The body section's break paragraph keeps only its section properties.
    for t in els[body_end].xpath(".//w:r", namespaces=NS):
        t.getparent().remove(t)

    unwrap_sdts(root)

    # The Table of Contents keeps its field; ocsc-word writes its entries from the headings.
    toc_sdt = next(
        s for s in root.iter(W + "sdt") if "Table of Contents" in text(s)
    )
    toc_content = toc_sdt.find("w:sdtContent", NS)
    paras = list(toc_content)
    first_entry = paras[1]
    field_start = []
    for r in first_entry:
        if etree.QName(r).localname == "hyperlink":
            break
        if etree.QName(r).localname == "r":
            field_start.append(r)
    last = paras[-1]
    for p in paras[1:-1]:
        toc_content.remove(p)
    entry = etree.Element(W + "p")
    entry.append(deepcopy(first_entry.find("w:pPr", NS)))
    for r in field_start:
        entry.append(deepcopy(r))
    toc_content.insert(1, entry)
    for t in last.xpath(".//w:t", namespaces=NS):
        t.getparent().remove(t)

    # Document control: the empty Number cell and the revision row's Checked and Authorised.
    table = next(t for t in root.iter(W + "tbl") if "Project Code" in text(t))
    rows = table.findall("w:tr", NS)
    values = rows[1].findall("w:tc", NS)
    labels = [text(tc).strip() for tc in rows[0].findall("w:tc", NS)]
    number_col = labels.index("Number")
    if not text(values[number_col]).strip():
        cell_paragraph_text(values[number_col], "{{number}}")
    rev_header = [text(tc).strip() for tc in rows[3].findall("w:tc", NS)]
    rev_cells = rows[4].findall("w:tc", NS)
    for label, field in (("Checked", "checked_by"), ("Authorised", "approved_by")):
        tc = rev_cells[rev_header.index(label)]
        if not text(tc).strip():
            cell_paragraph_text(tc, "{{%s}}" % field)

    # The Notice names the client in a plain run.
    for t in root.iter(W + "t"):
        if t.text and "[Insert Client Name]" in t.text:
            t.text = t.text.replace("[Insert Client Name]", "{{client_name}}")
    # The back cover's BackCoverAddress text box stays as it is; ocsc-word writes each office into it.
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def fill_footer(xml):
    root = etree.fromstring(xml)
    unwrap_sdts(root, keep_toc=False)
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def settings(xml):
    # No updateFields: Word would warn about "fields that may refer to other files" on every opening.
    xml = re.sub(r"<w:attachedTemplate [^>]*/>|<w:updateFields [^>]*/>", "", xml)
    return xml


def styles(xml):
    # Body paragraphs get space after, so content needs no blank paragraphs between them.
    return re.sub(
        r'(<w:style [^>]*w:styleId="Body"[^>]*>(?:(?!<w:pPr>)[\s\S])*?)(</w:style>)',
        r'\1<w:pPr><w:spacing w:after="200"/></w:pPr>\2',
        xml,
        count=1,
    )


EMU_PER_TWIP = 635
PAGE_NUMBER = (
    '<w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="right"/></w:pPr>'
    '<w:r><w:rPr><w:color w:val="595959"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>'
    '<w:r><w:rPr><w:color w:val="595959"/><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
    '<w:r><w:rPr><w:color w:val="595959"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>'
    '<w:r><w:rPr><w:color w:val="595959"/><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r>'
    '<w:r><w:rPr><w:color w:val="595959"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p>'
)


def pin_to_page(xml, left, top=None, page_height=None):
    """Anchors drawings to the page, so they sit where they did whatever this template's margins are."""

    def horizontal(m):
        return '<wp:positionH relativeFrom="page"><wp:posOffset>%d</wp:posOffset>' % (int(m.group(1)) + left)

    xml = re.sub(r'<wp:positionH relativeFrom="column"><wp:posOffset>(-?\d+)</wp:posOffset>', horizontal, xml)

    def vertical(m):
        if page_height is not None:
            return '<wp:positionV relativeFrom="page"><wp:posOffset>%d</wp:posOffset>' % page_height
        return '<wp:positionV relativeFrom="page"><wp:posOffset>%d</wp:posOffset>' % (int(m.group(1)) + top)

    return re.sub(r'<wp:positionV relativeFrom="paragraph"><wp:posOffset>(-?\d+)</wp:posOffset>', vertical, xml)


def add_banner(files, v1_path):
    """The inside pages take the OCSC banner header (title and subtitle) and skyline footer of OCSCReportV1."""
    with zipfile.ZipFile(v1_path) as z:
        v1 = {n: z.read(n) for n in z.namelist()}
    v1_doc = v1["word/document.xml"].decode("utf8")
    margin = re.search(r'<w:pgMar [^>]*w:left="(\d+)"[^>]*w:header="(\d+)"', v1_doc)
    left = int(margin.group(1)) * EMU_PER_TWIP
    top = int(margin.group(2)) * EMU_PER_TWIP

    doc = files["word/document.xml"].decode("utf8")
    page_h = int(re.search(r'<w:pgSz [^>]*w:h="(\d+)"', doc).group(1)) * EMU_PER_TWIP
    header = pin_to_page(v1["word/header1.xml"].decode("utf8"), left, top=top)
    footer = v1["word/footer1.xml"].decode("utf8")
    skyline_h = int(re.search(r'<wp:extent cx="\d+" cy="(\d+)"', footer).group(1))
    footer = pin_to_page(footer, left, page_height=page_h - skyline_h)
    footer = re.sub(r"(<w:ftr\b[^>]*>)", r"\1" + PAGE_NUMBER.replace("\\", "\\\\"), footer, count=1)

    def media_of(part):
        rels = v1["word/_rels/%s.rels" % part].decode("utf8")
        return re.search(r'Target="media/([^"]+)"', rels).group(1)

    for part, xml, name in (
        ("header1.xml", header, "ocsc-banner"),
        ("footer1.xml", footer, "ocsc-skyline"),
    ):
        src = media_of(part)
        target = "media/%s%s" % (name, src[src.rindex(".") :])
        files["word/" + target] = v1["word/media/" + src]
        new_part = part.replace("1.xml", "20.xml")
        files["word/" + new_part] = xml.encode("utf8")
        files["word/_rels/%s.rels" % new_part] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="%s"/>'
            "</Relationships>" % target
        ).encode("utf8")

    types = files["[Content_Types].xml"].decode("utf8")
    for part, kind in (("header20.xml", "header"), ("footer20.xml", "footer")):
        types = types.replace(
            "</Types>",
            '<Override PartName="/word/%s" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.%s+xml"/></Types>'
            % (part, kind),
        )
    for ext, mime in (("jpg", "image/jpeg"), ("jpeg", "image/jpeg"), ("png", "image/png")):
        if 'Extension="%s"' % ext not in types:
            types = types.replace("<Override", '<Default Extension="%s" ContentType="%s"/><Override' % (ext, mime), 1)
    files["[Content_Types].xml"] = types.encode("utf8")

    rels = files["word/_rels/document.xml.rels"].decode("utf8")
    rels = rels.replace(
        "</Relationships>",
        '<Relationship Id="rIdOcscBanner" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header20.xml"/>'
        '<Relationship Id="rIdOcscSkyline" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer20.xml"/>'
        "</Relationships>",
    )
    files["word/_rels/document.xml.rels"] = rels.encode("utf8")

    # Every section but the cover and the back cover.
    sects = list(re.finditer(r"<w:sectPr\b[^>]*>[\s\S]*?</w:sectPr>", doc))
    out, last = [], 0
    for m in sects[1:-1]:
        s = m.group(0)
        s = re.sub(r"<w:(header|footer)Reference [^>]*/>|<w:titlePg/>", "", s)
        s = re.sub(
            r"(<w:sectPr\b[^>]*>)",
            r'\1<w:headerReference w:type="default" r:id="rIdOcscBanner"/><w:footerReference w:type="default" r:id="rIdOcscSkyline"/>',
            s,
            count=1,
        )
        s = re.sub(r'w:top="\d+"', 'w:top="%d"' % 1440, s)
        s = re.sub(r'w:header="\d+"', 'w:header="%d"' % int(margin.group(2)), s)
        out.append(doc[last : m.start()] + s)
        last = m.end()
    files["word/document.xml"] = ("".join(out) + doc[last:]).encode("utf8")


def properties(core, app):
    """Empties the document properties the content controls were bound to."""
    for tag in ("dc:title", "dc:subject", "cp:keywords", "cp:category", "cp:contentStatus"):
        core = re.sub(r"<%s>[^<]*</%s>" % (tag, tag), "<%s></%s>" % (tag, tag), core)
    core = re.sub(r"<dc:creator>[^<]*</dc:creator>", "<dc:creator>OCSC</dc:creator>", core)
    core = re.sub(r"<cp:lastModifiedBy>[^<]*</cp:lastModifiedBy>", "<cp:lastModifiedBy>OCSC</cp:lastModifiedBy>", core)
    core = re.sub(r"<cp:lastPrinted>[^<]*</cp:lastPrinted>", "", core)
    app = re.sub(r"<Company>[^<]*</Company>", "<Company>O'Connor Sutton Cronin &amp; Associates</Company>", app)
    return core, app


def prune(files):
    """Drops headers, footers and pictures nothing refers to any more."""
    rels_name = "word/_rels/document.xml.rels"
    rels = etree.fromstring(files[rels_name])
    doc = files["word/document.xml"].decode("utf8")
    used = set(re.findall(r'r:(?:id|embed|link)="([^"]+)"', doc))
    dropped = []
    # SharePoint metadata (who it was shared with) and the old content controls' data store.
    for name in [n for n in files if n.startswith("customXml/")]:
        del files[name]
    files.pop("word/_rels/settings.xml.rels", None)
    for rel in list(rels):
        kind = rel.get("Type").rsplit("/", 1)[-1]
        if kind == "customXml":
            rels.remove(rel)
        elif kind in ("header", "footer", "image") and rel.get("Id") not in used:
            rels.remove(rel)
            dropped.append("word/" + rel.get("Target"))
    files[rels_name] = etree.tostring(rels, xml_declaration=True, encoding="UTF-8", standalone=True)
    still = set()
    for name, data in files.items():
        if name.endswith(".rels") and name != rels_name:
            for t in re.findall(rb'Target="([^"]+)"', data):
                still.add(t.decode())
    for name in dropped:
        base = name.rsplit("/", 1)[-1]
        if any(t.endswith(base) for t in still):
            continue
        files.pop(name, None)
        files.pop(name.replace("word/", "word/_rels/") + ".rels", None)
    types = etree.fromstring(files["[Content_Types].xml"])
    for o in list(types):
        part = o.get("PartName")
        if part and part.lstrip("/") not in files:
            types.remove(o)
    files["[Content_Types].xml"] = etree.tostring(
        types, xml_declaration=True, encoding="UTF-8", standalone=True
    )


def main(src, out):
    with zipfile.ZipFile(src) as z:
        files = {n: z.read(n) for n in z.namelist()}
    files["word/document.xml"] = build_document(files["word/document.xml"])
    for name in list(files):
        if re.fullmatch(r"word/(footer|header)\d+\.xml", name):
            files[name] = fill_footer(files[name])
    add_banner(files, os.path.join(os.path.dirname(os.path.abspath(__file__)), "OCSCReportV1.docx"))
    files["word/settings.xml"] = settings(files["word/settings.xml"].decode("utf8")).encode()
    files["word/styles.xml"] = styles(files["word/styles.xml"].decode("utf8")).encode()
    files["[Content_Types].xml"] = files["[Content_Types].xml"].replace(
        b"wordprocessingml.template.main+xml", b"wordprocessingml.document.main+xml"
    )
    core, app = properties(
        files["docProps/core.xml"].decode("utf8"), files["docProps/app.xml"].decode("utf8")
    )
    files["docProps/core.xml"], files["docProps/app.xml"] = core.encode(), app.encode()
    prune(files)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
