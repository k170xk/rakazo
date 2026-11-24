#!/usr/bin/env python3
"""Universal offline document extractor for ocsc-extract.

Extracts text, tables (CSV + JSON), embedded images/photos (mapped to sections,
slides, sheets, or pages), PDF page renders, CSV summaries, and ZIP archives
strictly inside the workspace directory.
"""

from __future__ import annotations

import csv
import io
import json
import mimetypes
import os
import posixpath
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Any

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".emf", ".wmf"}
DIRECT_WEB_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
MAX_ZIP_FILES = 200
MAX_ZIP_BYTES = 250 * 1024 * 1024
MIN_PDF_IMAGE_PX = 32


def slugify(name: str) -> str:
    stem = Path(name).stem
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-._")
    return (slug or "file")[:64]


def rel_path(path: Path, workspace: Path) -> str:
    return path.resolve().relative_to(workspace.resolve()).as_posix()


def image_dimensions(path: Path) -> tuple[int | None, int | None]:
    try:
        from PIL import Image

        with Image.open(path) as img:
            return int(img.width), int(img.height)
    except Exception:
        pass
    # Lightweight PNG/JPEG header fallback if Pillow is absent
    try:
        data = path.read_bytes()
        if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
            w = int.from_bytes(data[16:20], "big")
            h = int.from_bytes(data[20:24], "big")
            return w, h
        if data[:2] == b"\xff\xd8":
            i = 2
            while i + 9 < len(data):
                if data[i] != 0xFF:
                    break
                marker = data[i + 1]
                length = int.from_bytes(data[i + 2 : i + 4], "big")
                if marker in (0xC0, 0xC1, 0xC2):
                    h = int.from_bytes(data[i + 5 : i + 7], "big")
                    w = int.from_bytes(data[i + 7 : i + 9], "big")
                    return w, h
                i += 2 + length
    except Exception:
        pass
    return None, None


def save_image_bytes(raw: bytes, orig_name: str, dest_dir: Path, base_name: str) -> Path | None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(orig_name).suffix.lower() or ".bin"
    if ext not in IMAGE_EXTS:
        return None
    if ext in DIRECT_WEB_IMAGE_EXTS:
        out_path = dest_dir / f"{base_name}{ext}"
        out_path.write_bytes(raw)
        return out_path
    # Convert BMP/TIFF/EMF/WMF to PNG so slides/word/vision can consume directly
    tmp_path = dest_dir / f"{base_name}{ext}"
    tmp_path.write_bytes(raw)
    png_path = dest_dir / f"{base_name}.png"
    converted = False
    if ext in {".bmp", ".tif", ".tiff"}:
        try:
            from PIL import Image

            with Image.open(tmp_path) as img:
                img.convert("RGBA" if img.mode in ("RGBA", "LA", "P") else "RGB").save(png_path, "PNG")
            converted = png_path.exists() and png_path.stat().st_size > 0
        except Exception:
            converted = False
    if not converted and shutil.which("convert"):
        res = subprocess.run(
            ["convert", str(tmp_path), str(png_path)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=30,
        )
        converted = res.returncode == 0 and png_path.exists() and png_path.stat().st_size > 0
    if converted:
        tmp_path.unlink(missing_ok=True)
        return png_path
    return tmp_path


def write_csv(rows: list[list[Any]], dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        for row in rows:
            writer.writerow(["" if v is None else str(v) for v in row])


def parse_page_spec(spec: str | None, total: int, max_pages: int) -> list[int]:
    if total <= 0:
        return []
    if not spec:
        return list(range(1, min(total, max_pages) + 1))
    chosen: set[int] = set()
    for part in str(spec).split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            lo_s, hi_s = part.split("-", 1)
            lo = max(1, int(lo_s.strip()))
            hi = min(total, int(hi_s.strip()))
            for p in range(lo, hi + 1):
                chosen.add(p)
        else:
            p = int(part)
            if 1 <= p <= total:
                chosen.add(p)
    return sorted(chosen)[:max_pages]


def parse_rels(zf: zipfile.ZipFile, rels_path: str) -> dict[str, tuple[str, str]]:
    """Return {rId: (type, target)} from an OOXML .rels file."""
    if rels_path not in zf.namelist():
        return {}
    out: dict[str, tuple[str, str]] = {}
    try:
        root = ET.fromstring(zf.read(rels_path))
        for rel in root:
            rid = rel.attrib.get("Id")
            target = rel.attrib.get("Target")
            rtype = rel.attrib.get("Type", "")
            if rid and target:
                out[rid] = (rtype, target)
    except Exception:
        pass
    return out


def resolve_ooxml_target(base_part: str, target: str) -> str:
    if target.startswith("/"):
        return target.lstrip("/")
    base_dir = posixpath.dirname(base_part)
    return posixpath.normpath(posixpath.join(base_dir, target))


def local_tag(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def extract_docx(
    src: Path,
    out_dir: Path,
    workspace: Path,
    *,
    inspect_only: bool,
    extract_images: bool,
    extract_tables: bool,
) -> dict[str, Any]:
    with zipfile.ZipFile(src, "r") as zf:
        names = set(zf.namelist())
        media_files = sorted(
            n for n in names if n.startswith("word/media/") and not n.endswith("/")
        )
        rels = parse_rels(zf, "word/_rels/document.xml.rels")
        rid_to_media: dict[str, str] = {}
        for rid, (_, target) in rels.items():
            resolved = resolve_ooxml_target("word/document.xml", target)
            if resolved.startswith("word/media/"):
                rid_to_media[rid] = resolved

        headings: list[str] = []
        paragraphs: list[str] = []
        tables_data: list[dict[str, Any]] = []
        image_contexts: dict[str, list[dict[str, Any]]] = {}
        current_heading = ""

        if "word/document.xml" in names:
            root = ET.fromstring(zf.read("word/document.xml"))
            body = None
            for child in root:
                if local_tag(child.tag) == "body":
                    body = child
                    break
            if body is not None:
                for elem in body:
                    tag = local_tag(elem.tag)
                    if tag == "p":
                        style = ""
                        p_texts: list[str] = []
                        for node in elem.iter():
                            lt = local_tag(node.tag)
                            if lt == "pStyle":
                                for k, v in node.attrib.items():
                                    if k.endswith("val"):
                                        style = v
                            elif lt == "t" and node.text:
                                p_texts.append(node.text)
                            elif lt == "tab":
                                p_texts.append("\t")
                            elif lt == "br":
                                p_texts.append("\n")
                            elif lt == "drawing":
                                descr = ""
                                title = ""
                                for sub in node.iter():
                                    slt = local_tag(sub.tag)
                                    if slt == "docPr":
                                        descr = sub.attrib.get("descr", "") or sub.attrib.get("name", "")
                                        title = sub.attrib.get("title", "") or sub.attrib.get("name", "")
                                    elif slt == "blip":
                                        for k, v in sub.attrib.items():
                                            if k.endswith("embed") and v in rid_to_media:
                                                media_key = rid_to_media[v]
                                                image_contexts.setdefault(media_key, []).append(
                                                    {
                                                        "section": current_heading or None,
                                                        "alt": descr or title or None,
                                                    }
                                                )
                        text = "".join(p_texts).strip()
                        if text:
                            if re.match(r"^Heading\d|^Title", style, re.IGNORECASE):
                                current_heading = text
                                headings.append(text)
                            paragraphs.append(text)
                    elif tag == "tbl":
                        rows: list[list[str]] = []
                        for tr in elem:
                            if local_tag(tr.tag) != "tr":
                                continue
                            row: list[str] = []
                            for tc in tr:
                                if local_tag(tc.tag) != "tc":
                                    continue
                                cell_parts: list[str] = []
                                for p in tc:
                                    if local_tag(p.tag) == "p":
                                        t = "".join(
                                            n.text for n in p.iter() if local_tag(n.tag) == "t" and n.text
                                        ).strip()
                                        if t:
                                            cell_parts.append(t)
                                row.append(" ".join(cell_parts))
                            if any(c for c in row):
                                rows.append(row)
                        if rows:
                            tables_data.append(
                                {
                                    "section": current_heading or None,
                                    "rows": rows,
                                }
                            )

        info: dict[str, Any] = {
            "source": rel_path(src, workspace),
            "type": "word",
            "bytes": src.stat().st_size,
            "headingsCount": len(headings),
            "headings": headings[:25],
            "paragraphsCount": len(paragraphs),
            "tablesCount": len(tables_data),
            "embeddedImagesCount": len(media_files),
        }
        if inspect_only:
            return info

        out_dir.mkdir(parents=True, exist_ok=True)
        text_path = out_dir / "text.txt"
        text_path.write_text("\n\n".join(paragraphs), encoding="utf-8")
        info["textFile"] = rel_path(text_path, workspace)

        extracted_tables: list[dict[str, Any]] = []
        if extract_tables and tables_data:
            tbl_dir = out_dir / "tables"
            for idx, tbl in enumerate(tables_data, 1):
                csv_path = tbl_dir / f"table-{idx:02d}.csv"
                write_csv(tbl["rows"], csv_path)
                extracted_tables.append(
                    {
                        "index": idx,
                        "section": tbl["section"],
                        "rows": len(tbl["rows"]),
                        "columns": max((len(r) for r in tbl["rows"]), default=0),
                        "headers": tbl["rows"][0][:12] if tbl["rows"] else [],
                        "csv": rel_path(csv_path, workspace),
                    }
                )
        info["tables"] = extracted_tables

        extracted_images: list[dict[str, Any]] = []
        if extract_images and media_files:
            img_dir = out_dir / "images"
            for idx, media_key in enumerate(media_files, 1):
                saved = save_image_bytes(
                    zf.read(media_key),
                    media_key,
                    img_dir,
                    f"img-{idx:02d}-{Path(media_key).stem}",
                )
                if not saved:
                    continue
                w, h = image_dimensions(saved)
                ctxs = image_contexts.get(media_key, [])
                extracted_images.append(
                    {
                        "index": idx,
                        "path": rel_path(saved, workspace),
                        "sourceMedia": media_key,
                        "width": w,
                        "height": h,
                        "bytes": saved.stat().st_size,
                        "section": ctxs[0].get("section") if ctxs else None,
                        "alt": ctxs[0].get("alt") if ctxs else None,
                    }
                )
        info["images"] = extracted_images
        return info


def extract_pptx(
    src: Path,
    out_dir: Path,
    workspace: Path,
    *,
    inspect_only: bool,
    extract_images: bool,
    extract_tables: bool,
) -> dict[str, Any]:
    with zipfile.ZipFile(src, "r") as zf:
        names = set(zf.namelist())
        media_files = sorted(
            n for n in names if n.startswith("ppt/media/") and not n.endswith("/")
        )
        slide_parts = sorted(
            (n for n in names if re.match(r"^ppt/slides/slide(\d+)\.xml$", n)),
            key=lambda s: int(re.search(r"slide(\d+)\.xml$", s).group(1)),
        )

        slides_summary: list[dict[str, Any]] = []
        tables_found: list[dict[str, Any]] = []
        image_usage: dict[str, list[dict[str, Any]]] = {}
        full_text_chunks: list[str] = []

        for slide_idx, slide_part in enumerate(slide_parts, 1):
            slide_rels_path = f"ppt/slides/_rels/{posixpath.basename(slide_part)}.rels"
            rels = parse_rels(zf, slide_rels_path)
            rid_to_media: dict[str, str] = {}
            notes_part: str | None = None
            for rid, (rtype, target) in rels.items():
                resolved = resolve_ooxml_target(slide_part, target)
                if resolved.startswith("ppt/media/"):
                    rid_to_media[rid] = resolved
                elif "notesSlide" in rtype and resolved in names:
                    notes_part = resolved

            root = ET.fromstring(zf.read(slide_part))
            texts: list[str] = []
            title = ""
            slide_tables: list[list[list[str]]] = []

            for elem in root.iter():
                lt = local_tag(elem.tag)
                if lt == "sp":
                    is_title = False
                    for sub in elem.iter():
                        if local_tag(sub.tag) == "ph" and sub.attrib.get("type") in ("title", "ctrTitle"):
                            is_title = True
                    paras: list[str] = []
                    for p in elem.iter():
                        if local_tag(p.tag) == "p":
                            line = "".join(
                                t.text for t in p.iter() if local_tag(t.tag) == "t" and t.text
                            ).strip()
                            if line:
                                paras.append(line)
                    block = "\n".join(paras).strip()
                    if block:
                        if is_title and not title:
                            title = block.splitlines()[0]
                        texts.append(block)
                elif lt == "tbl":
                    rows: list[list[str]] = []
                    for tr in elem:
                        if local_tag(tr.tag) != "tr":
                            continue
                        row: list[str] = []
                        for tc in tr:
                            if local_tag(tc.tag) != "tc":
                                continue
                            t = " ".join(
                                n.text.strip()
                                for n in tc.iter()
                                if local_tag(n.tag) == "t" and n.text and n.text.strip()
                            )
                            row.append(t)
                        if any(c for c in row):
                            rows.append(row)
                    if rows:
                        slide_tables.append(rows)
                elif lt == "pic":
                    descr = ""
                    name = ""
                    for sub in elem.iter():
                        slt = local_tag(sub.tag)
                        if slt == "cNvPr":
                            name = sub.attrib.get("name", "")
                            descr = sub.attrib.get("descr", "") or name
                        elif slt == "blip":
                            for k, v in sub.attrib.items():
                                if k.endswith("embed") and v in rid_to_media:
                                    image_usage.setdefault(rid_to_media[v], []).append(
                                        {"slide": slide_idx, "slideTitle": title or None, "alt": descr or None}
                                    )

            notes_text = ""
            if notes_part:
                nroot = ET.fromstring(zf.read(notes_part))
                notes_text = "\n".join(
                    n.text.strip() for n in nroot.iter() if local_tag(n.tag) == "t" and n.text and n.text.strip()
                )

            if not title and texts:
                title = texts[0].splitlines()[0][:120]

            slides_summary.append(
                {
                    "slide": slide_idx,
                    "title": title or None,
                    "texts": texts,
                    "tablesCount": len(slide_tables),
                    "notes": notes_text or None,
                }
            )
            full_text_chunks.append(
                f"--- Slide {slide_idx}: {title or '(untitled)'} ---\n"
                + "\n".join(texts)
                + (f"\n[Notes]: {notes_text}" if notes_text else "")
            )
            for t_i, rows in enumerate(slide_tables, 1):
                tables_found.append({"slide": slide_idx, "index": t_i, "title": title or None, "rows": rows})

        info: dict[str, Any] = {
            "source": rel_path(src, workspace),
            "type": "pptx",
            "bytes": src.stat().st_size,
            "slidesCount": len(slide_parts),
            "slideTitles": [s["title"] for s in slides_summary[:30]],
            "tablesCount": len(tables_found),
            "embeddedImagesCount": len(media_files),
        }
        if inspect_only:
            return info

        out_dir.mkdir(parents=True, exist_ok=True)
        text_path = out_dir / "text.txt"
        text_path.write_text("\n\n".join(full_text_chunks), encoding="utf-8")
        slides_json = out_dir / "slides.json"
        slides_json.write_text(json.dumps(slides_summary, indent=2), encoding="utf-8")
        info["textFile"] = rel_path(text_path, workspace)
        info["slidesFile"] = rel_path(slides_json, workspace)

        extracted_tables: list[dict[str, Any]] = []
        if extract_tables and tables_found:
            tbl_dir = out_dir / "tables"
            for item in tables_found:
                csv_path = tbl_dir / f"slide-{item['slide']:02d}-table-{item['index']:02d}.csv"
                write_csv(item["rows"], csv_path)
                extracted_tables.append(
                    {
                        "slide": item["slide"],
                        "slideTitle": item["title"],
                        "rows": len(item["rows"]),
                        "columns": max((len(r) for r in item["rows"]), default=0),
                        "headers": item["rows"][0][:12] if item["rows"] else [],
                        "csv": rel_path(csv_path, workspace),
                    }
                )
        info["tables"] = extracted_tables

        extracted_images: list[dict[str, Any]] = []
        if extract_images and media_files:
            img_dir = out_dir / "images"
            for idx, media_key in enumerate(media_files, 1):
                saved = save_image_bytes(
                    zf.read(media_key),
                    media_key,
                    img_dir,
                    f"img-{idx:02d}-{Path(media_key).stem}",
                )
                if not saved:
                    continue
                w, h = image_dimensions(saved)
                uses = image_usage.get(media_key, [])
                extracted_images.append(
                    {
                        "index": idx,
                        "path": rel_path(saved, workspace),
                        "sourceMedia": media_key,
                        "width": w,
                        "height": h,
                        "bytes": saved.stat().st_size,
                        "slides": sorted({u["slide"] for u in uses}),
                        "slideTitle": uses[0].get("slideTitle") if uses else None,
                        "alt": uses[0].get("alt") if uses else None,
                    }
                )
        info["images"] = extracted_images
        return info


def extract_excel(
    src: Path,
    out_dir: Path,
    workspace: Path,
    *,
    inspect_only: bool,
    extract_images: bool,
    extract_tables: bool,
) -> dict[str, Any]:
    ext = src.suffix.lower()
    sheets_meta: list[dict[str, Any]] = []
    media_files: list[str] = []
    extracted_images: list[dict[str, Any]] = []

    if ext in (".xlsx", ".xlsm"):
        with zipfile.ZipFile(src, "r") as zf:
            media_files = sorted(
                n for n in zf.namelist() if n.startswith("xl/media/") and not n.endswith("/")
            )
            if not inspect_only and extract_images and media_files:
                img_dir = out_dir / "images"
                for idx, media_key in enumerate(media_files, 1):
                    saved = save_image_bytes(
                        zf.read(media_key),
                        media_key,
                        img_dir,
                        f"img-{idx:02d}-{Path(media_key).stem}",
                    )
                    if not saved:
                        continue
                    w, h = image_dimensions(saved)
                    extracted_images.append(
                        {
                            "index": idx,
                            "path": rel_path(saved, workspace),
                            "sourceMedia": media_key,
                            "width": w,
                            "height": h,
                            "bytes": saved.stat().st_size,
                        }
                    )

        import openpyxl

        wb_val = openpyxl.load_workbook(src, data_only=True, read_only=True)
        try:
            for s_idx, sheet_name in enumerate(wb_val.sheetnames, 1):
                ws = wb_val[sheet_name]
                rows: list[list[Any]] = []
                for row in ws.iter_rows(values_only=True):
                    if any(v is not None and str(v).strip() != "" for v in row):
                        rows.append(list(row))
                headers = [str(c) for c in rows[0][:15]] if rows else []
                entry: dict[str, Any] = {
                    "sheet": sheet_name,
                    "rows": len(rows),
                    "columns": max((len(r) for r in rows), default=0),
                    "headers": headers,
                    "sampleRows": [[("" if v is None else str(v)) for v in r[:12]] for r in rows[:4]],
                }
                if not inspect_only and extract_tables:
                    csv_path = out_dir / "sheets" / f"{s_idx:02d}-{slugify(sheet_name)}.csv"
                    write_csv(rows, csv_path)
                    entry["csv"] = rel_path(csv_path, workspace)
                sheets_meta.append(entry)
        finally:
            wb_val.close()
    else:
        # Legacy .xls via xlrd / pandas
        import pandas as pd

        xl = pd.ExcelFile(src)
        for s_idx, sheet_name in enumerate(xl.sheet_names, 1):
            df = xl.parse(sheet_name)
            entry = {
                "sheet": str(sheet_name),
                "rows": int(len(df)),
                "columns": int(len(df.columns)),
                "headers": [str(c) for c in list(df.columns)[:15]],
            }
            if not inspect_only and extract_tables:
                csv_path = out_dir / "sheets" / f"{s_idx:02d}-{slugify(str(sheet_name))}.csv"
                csv_path.parent.mkdir(parents=True, exist_ok=True)
                df.to_csv(csv_path, index=False)
                entry["csv"] = rel_path(csv_path, workspace)
            sheets_meta.append(entry)

    info: dict[str, Any] = {
        "source": rel_path(src, workspace),
        "type": "excel",
        "bytes": src.stat().st_size,
        "sheetsCount": len(sheets_meta),
        "sheets": sheets_meta,
        "embeddedImagesCount": len(media_files),
    }
    if not inspect_only:
        info["images"] = extracted_images
    return info


def pdf_page_count(src: Path) -> int:
    if shutil.which("pdfinfo"):
        res = subprocess.run(["pdfinfo", str(src)], capture_output=True, text=True, timeout=30)
        if res.returncode == 0:
            m = re.search(r"^Pages:\s*(\d+)", res.stdout, re.MULTILINE)
            if m:
                return int(m.group(1))
    try:
        from pypdf import PdfReader

        return len(PdfReader(str(src)).pages)
    except Exception:
        return 0


def extract_pdf(
    src: Path,
    out_dir: Path,
    workspace: Path,
    *,
    inspect_only: bool,
    extract_images: bool,
    extract_tables: bool,
    render_pages: bool,
    page_spec: str | None,
    max_pages: int,
    dpi: int,
) -> dict[str, Any]:
    total_pages = pdf_page_count(src)
    pages_text: list[dict[str, Any]] = []

    if shutil.which("pdftotext"):
        res = subprocess.run(["pdftotext", str(src), "-"], capture_output=True, text=True, timeout=60)
        if res.returncode == 0:
            raw_pages = res.stdout.split("\f")
            if raw_pages and raw_pages[-1] == "":
                raw_pages = raw_pages[:-1]
            if not total_pages:
                total_pages = len(raw_pages)
            for idx, txt in enumerate(raw_pages, 1):
                clean = txt.strip()
                pages_text.append(
                    {
                        "page": idx,
                        "chars": len(clean),
                        "likelyScanned": len(clean) < 40,
                        "text": clean,
                    }
                )
    if not pages_text:
        try:
            from pypdf import PdfReader

            reader = PdfReader(str(src))
            total_pages = len(reader.pages)
            for idx, page in enumerate(reader.pages, 1):
                clean = (page.extract_text() or "").strip()
                pages_text.append(
                    {
                        "page": idx,
                        "chars": len(clean),
                        "likelyScanned": len(clean) < 40,
                        "text": clean,
                    }
                )
        except Exception:
            pass

    scanned_pages = [p["page"] for p in pages_text if p["likelyScanned"]]
    info: dict[str, Any] = {
        "source": rel_path(src, workspace),
        "type": "pdf",
        "bytes": src.stat().st_size,
        "totalPages": total_pages,
        "scannedPages": scanned_pages[:30],
        "hasSelectableText": any(not p["likelyScanned"] for p in pages_text),
    }
    if inspect_only:
        return info

    out_dir.mkdir(parents=True, exist_ok=True)
    text_path = out_dir / "text.txt"
    text_path.write_text(
        "\n\n".join(f"--- Page {p['page']} ---\n{p['text']}" for p in pages_text),
        encoding="utf-8",
    )
    info["textFile"] = rel_path(text_path, workspace)

    # Extract tables via pdfplumber if available
    extracted_tables: list[dict[str, Any]] = []
    if extract_tables:
        try:
            import pdfplumber

            target_pages = set(parse_page_spec(page_spec, total_pages, max_pages=min(max_pages, 30)))
            tbl_dir = out_dir / "tables"
            with pdfplumber.open(str(src)) as pdf:
                for p_no in sorted(target_pages):
                    if p_no > len(pdf.pages):
                        continue
                    page_tables = pdf.pages[p_no - 1].extract_tables() or []
                    for t_i, rows in enumerate(page_tables, 1):
                        cleaned = [[("" if c is None else str(c).strip()) for c in r] for r in rows if r]
                        if not cleaned:
                            continue
                        csv_path = tbl_dir / f"page-{p_no:02d}-table-{t_i:02d}.csv"
                        write_csv(cleaned, csv_path)
                        extracted_tables.append(
                            {
                                "page": p_no,
                                "rows": len(cleaned),
                                "columns": max((len(r) for r in cleaned), default=0),
                                "headers": cleaned[0][:12],
                                "csv": rel_path(csv_path, workspace),
                            }
                        )
        except Exception:
            pass
    info["tables"] = extracted_tables

    # Extract embedded images via pdfimages -png (preferred) or pypdf fallback
    extracted_images: list[dict[str, Any]] = []
    if extract_images:
        img_dir = out_dir / "images"
        img_dir.mkdir(parents=True, exist_ok=True)
        used_pdfimages = False
        if shutil.which("pdfimages"):
            prefix = str(img_dir / "img")
            cmd = ["pdfimages", "-png", "-p"]
            if page_spec and "-" in page_spec and "," not in page_spec:
                lo_s, hi_s = page_spec.split("-", 1)
                cmd.extend(["-f", lo_s.strip(), "-l", hi_s.strip()])
            cmd.extend([str(src), prefix])
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
            if res.returncode == 0:
                used_pdfimages = True
                for img_path in sorted(img_dir.glob("img-*.png")):
                    w, h = image_dimensions(img_path)
                    if w is not None and h is not None and (w < MIN_PDF_IMAGE_PX or h < MIN_PDF_IMAGE_PX):
                        img_path.unlink(missing_ok=True)
                        continue
                    m = re.match(r"img-(\d+)-", img_path.name)
                    extracted_images.append(
                        {
                            "path": rel_path(img_path, workspace),
                            "page": int(m.group(1)) if m else None,
                            "width": w,
                            "height": h,
                            "bytes": img_path.stat().st_size,
                        }
                    )
        if not used_pdfimages:
            try:
                from pypdf import PdfReader

                reader = PdfReader(str(src))
                idx = 0
                for p_no, page in enumerate(reader.pages, 1):
                    for im in getattr(page, "images", []):
                        idx += 1
                        saved = save_image_bytes(im.data, im.name, img_dir, f"page-{p_no:02d}-img-{idx:02d}")
                        if not saved:
                            continue
                        w, h = image_dimensions(saved)
                        if w is not None and h is not None and (w < MIN_PDF_IMAGE_PX or h < MIN_PDF_IMAGE_PX):
                            saved.unlink(missing_ok=True)
                            continue
                        extracted_images.append(
                            {
                                "path": rel_path(saved, workspace),
                                "page": p_no,
                                "width": w,
                                "height": h,
                                "bytes": saved.stat().st_size,
                            }
                        )
            except Exception:
                pass
    info["images"] = extracted_images

    # Render PDF pages to PNG when requested OR automatically for scanned pages
    rendered_pages: list[dict[str, Any]] = []
    pages_to_render: list[int] = []
    if render_pages:
        pages_to_render = parse_page_spec(page_spec, total_pages, max_pages=max_pages)
    elif scanned_pages:
        pages_to_render = scanned_pages[: min(max_pages, 10)]

    if pages_to_render and shutil.which("pdftoppm"):
        pages_dir = out_dir / "pages"
        pages_dir.mkdir(parents=True, exist_ok=True)
        for p_no in pages_to_render:
            prefix = str(pages_dir / f"page-{p_no:03d}")
            res = subprocess.run(
                ["pdftoppm", "-png", "-r", str(dpi), "-f", str(p_no), "-l", str(p_no), "-singlefile", str(src), prefix],
                capture_output=True,
                text=True,
                timeout=60,
            )
            png = Path(f"{prefix}.png")
            if res.returncode == 0 and png.exists():
                w, h = image_dimensions(png)
                rendered_pages.append(
                    {
                        "page": p_no,
                        "path": rel_path(png, workspace),
                        "width": w,
                        "height": h,
                        "bytes": png.stat().st_size,
                    }
                )
    info["renderedPages"] = rendered_pages
    return info


def extract_csv_file(src: Path, out_dir: Path, workspace: Path, *, inspect_only: bool) -> dict[str, Any]:
    raw = src.read_text(encoding="utf-8-sig", errors="replace")
    delim = "\t" if src.suffix.lower() == ".tsv" else ","
    try:
        dialect = csv.Sniffer().sniff(raw[:4096], delimiters=",;\t|")
        delim = dialect.delimiter
    except Exception:
        pass
    rows = list(csv.reader(io.StringIO(raw), delimiter=delim))
    headers = rows[0] if rows else []
    data_rows = rows[1:] if len(rows) > 1 else []
    info: dict[str, Any] = {
        "source": rel_path(src, workspace),
        "type": "csv",
        "bytes": src.stat().st_size,
        "delimiter": delim,
        "rows": len(data_rows),
        "columns": len(headers),
        "headers": headers[:25],
        "sampleRows": data_rows[:5],
        "csv": rel_path(src, workspace),
    }
    return info


def extract_zip_file(
    src: Path,
    out_dir: Path,
    workspace: Path,
    *,
    inspect_only: bool,
    recursive: bool,
    options: dict[str, Any],
) -> dict[str, Any]:
    with zipfile.ZipFile(src, "r") as zf:
        infos = [zi for zi in zf.infolist() if not zi.is_dir() and not zi.filename.startswith("__MACOSX/")]
        summary: dict[str, Any] = {
            "source": rel_path(src, workspace),
            "type": "zip",
            "bytes": src.stat().st_size,
            "entriesCount": len(infos),
            "entries": [zi.filename for zi in infos[:40]],
        }
        if inspect_only:
            return summary

        unpack_dir = out_dir / "unpacked"
        unpack_dir.mkdir(parents=True, exist_ok=True)
        total_written = 0
        unpacked_paths: list[Path] = []
        skipped: list[str] = []

        for zi in infos[:MAX_ZIP_FILES]:
            # Reject symlinks and path traversal (zip-slip)
            mode = (zi.external_attr >> 16) & 0o170000
            if mode == 0o120000:
                skipped.append(f"{zi.filename} (symlink)")
                continue
            norm = posixpath.normpath(zi.filename.replace("\\", "/")).lstrip("/")
            if norm.startswith("..") or "/../" in f"/{norm}/":
                skipped.append(f"{zi.filename} (unsafe path)")
                continue
            target = (unpack_dir / norm).resolve()
            if not str(target).startswith(str(unpack_dir.resolve()) + os.sep):
                skipped.append(f"{zi.filename} (outside target)")
                continue
            if total_written + zi.file_size > MAX_ZIP_BYTES:
                skipped.append(f"{zi.filename} (size cap)")
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(zi, "r") as rfh, target.open("wb") as wfh:
                chunk = rfh.read(MAX_ZIP_BYTES - total_written + 1)
                total_written += len(chunk)
                if total_written > MAX_ZIP_BYTES:
                    target.unlink(missing_ok=True)
                    skipped.append(f"{zi.filename} (size cap)")
                    break
                wfh.write(chunk)
            unpacked_paths.append(target)

        summary["unpackedFiles"] = [rel_path(p, workspace) for p in unpacked_paths]
        if skipped:
            summary["skipped"] = skipped[:20]

        if recursive and unpacked_paths:
            nested_results = []
            for p in unpacked_paths:
                if p.suffix.lower() == ".zip":
                    continue
                nested_out = out_dir / "nested" / slugify(p.name)
                nested_results.append(extract_one(p, nested_out, workspace, options))
            summary["nested"] = nested_results
        return summary


def extract_legacy_doc_or_text(src: Path, out_dir: Path, workspace: Path, *, inspect_only: bool) -> dict[str, Any]:
    ext = src.suffix.lower()
    text = ""
    kind = "text"
    if ext == ".doc":
        kind = "doc"
        if shutil.which("catdoc"):
            res = subprocess.run(["catdoc", str(src)], capture_output=True, text=True, timeout=45)
            if res.returncode == 0:
                text = res.stdout
    elif ext in (".rtf", ".odt", ".epub"):
        kind = ext.lstrip(".")
        if shutil.which("pandoc"):
            res = subprocess.run(["pandoc", str(src), "-t", "plain"], capture_output=True, text=True, timeout=45)
            if res.returncode == 0:
                text = res.stdout
    elif ext in (".html", ".htm"):
        kind = "html"
        raw = src.read_text(encoding="utf-8", errors="replace")
        try:
            from bs4 import BeautifulSoup

            soup = BeautifulSoup(raw, "lxml")
            text = soup.get_text("\n", strip=True)
        except Exception:
            text = re.sub(r"<[^>]+>", " ", raw)
    elif ext in (".json", ".xml", ".txt", ".md", ".yaml", ".yml", ".log"):
        kind = ext.lstrip(".")
        text = src.read_text(encoding="utf-8", errors="replace")
    else:
        kind = ext.lstrip(".") or "binary"
        mime, _ = mimetypes.guess_type(str(src))
        return {
            "source": rel_path(src, workspace),
            "type": kind,
            "mimeType": mime,
            "bytes": src.stat().st_size,
            "note": "Unrecognised binary format; use ocsc python to inspect custom binary formats if needed.",
        }

    info: dict[str, Any] = {
        "source": rel_path(src, workspace),
        "type": kind,
        "bytes": src.stat().st_size,
        "chars": len(text),
        "preview": text[:600],
    }
    if not inspect_only and ext in (".doc", ".rtf", ".odt", ".epub", ".html", ".htm"):
        out_dir.mkdir(parents=True, exist_ok=True)
        text_path = out_dir / "text.txt"
        text_path.write_text(text, encoding="utf-8")
        info["textFile"] = rel_path(text_path, workspace)
    return info


def extract_image_file(src: Path, out_dir: Path, workspace: Path, *, inspect_only: bool) -> dict[str, Any]:
    w, h = image_dimensions(src)
    info: dict[str, Any] = {
        "source": rel_path(src, workspace),
        "type": "image",
        "bytes": src.stat().st_size,
        "width": w,
        "height": h,
        "path": rel_path(src, workspace),
    }
    if not inspect_only and src.suffix.lower() not in DIRECT_WEB_IMAGE_EXTS:
        saved = save_image_bytes(src.read_bytes(), src.name, out_dir / "images", slugify(src.name))
        if saved:
            info["convertedPng"] = rel_path(saved, workspace)
    return info


def extract_one(src: Path, out_dir: Path, workspace: Path, options: dict[str, Any]) -> dict[str, Any]:
    ext = src.suffix.lower()
    inspect_only = bool(options.get("inspectOnly"))
    extract_images = bool(options.get("extractImages", True))
    extract_tables = bool(options.get("extractTables", True))
    render_pages = bool(options.get("renderPages", False))
    page_spec = options.get("pages")
    max_pages = int(options.get("maxPages", 12))
    dpi = int(options.get("dpi", 150))
    recursive = bool(options.get("recursive", True))

    try:
        if ext == ".docx":
            return extract_docx(
                src, out_dir, workspace,
                inspect_only=inspect_only,
                extract_images=extract_images,
                extract_tables=extract_tables,
            )
        if ext == ".pptx":
            return extract_pptx(
                src, out_dir, workspace,
                inspect_only=inspect_only,
                extract_images=extract_images,
                extract_tables=extract_tables,
            )
        if ext in (".xlsx", ".xlsm", ".xls"):
            return extract_excel(
                src, out_dir, workspace,
                inspect_only=inspect_only,
                extract_images=extract_images,
                extract_tables=extract_tables,
            )
        if ext == ".pdf":
            return extract_pdf(
                src, out_dir, workspace,
                inspect_only=inspect_only,
                extract_images=extract_images,
                extract_tables=extract_tables,
                render_pages=render_pages,
                page_spec=page_spec,
                max_pages=max_pages,
                dpi=dpi,
            )
        if ext in (".csv", ".tsv"):
            return extract_csv_file(src, out_dir, workspace, inspect_only=inspect_only)
        if ext == ".zip":
            return extract_zip_file(
                src, out_dir, workspace,
                inspect_only=inspect_only,
                recursive=recursive,
                options=options,
            )
        if ext in IMAGE_EXTS:
            return extract_image_file(src, out_dir, workspace, inspect_only=inspect_only)
        return extract_legacy_doc_or_text(src, out_dir, workspace, inspect_only=inspect_only)
    except Exception as exc:
        return {
            "source": rel_path(src, workspace),
            "type": ext.lstrip(".") or "unknown",
            "error": str(exc),
        }


def main() -> None:
    payload = json.loads(sys.stdin.read())
    workspace = Path(payload["workspace"]).resolve()
    out_root = Path(payload["outDir"]).resolve()
    inputs = [Path(p).resolve() for p in payload["inputs"]]
    options = payload.get("options", {})
    inspect_only = bool(options.get("inspectOnly"))

    used_slugs: dict[str, int] = {}
    results: list[dict[str, Any]] = []
    for src in inputs:
        base = slugify(src.name)
        count = used_slugs.get(base, 0) + 1
        used_slugs[base] = count
        folder_name = base if count == 1 else f"{base}-{count}"
        results.append(extract_one(src, out_root / folder_name, workspace, options))

    summary: dict[str, Any] = {
        "ok": True,
        "command": "inspect" if inspect_only else "run",
        "filesProcessed": len(results),
        "files": results,
    }
    if not inspect_only:
        out_root.mkdir(parents=True, exist_ok=True)
        manifest_path = out_root / "manifest.json"
        manifest_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
        summary["manifest"] = rel_path(manifest_path, workspace)
        summary["next"] = (
            "Use read_file on extracted images/rendered pages to inspect visuals, "
            "or pass extracted image/CSV/text paths into ocsc python (for merging/charts) "
            "and ocsc pptx/word/xlsx new."
        )
    sys.stdout.write(json.dumps(summary, indent=2) + "\n")


if __name__ == "__main__":
    main()
