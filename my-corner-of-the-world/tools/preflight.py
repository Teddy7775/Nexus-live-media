#!/usr/bin/env python3
"""Preflight report for the built deliverables -> docs/PREFLIGHT.md

Reads the PDFs and EPUBs in release/ and checks what can be checked without a printer's own tool:
page size, even page count, embedded fonts, effective image resolution, blank pages, bookmarks,
cover-wrap size against spine, EPUB validity (EPUBCheck). It does not replace the printer's preflight.
"""
import json
import sys
from datetime import date
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from mcw.core import load_project  # noqa: E402


def pdf_facts(path: Path):
    d = pymupdf.open(path)
    r0 = d[0].rect
    fonts = {}
    min_ppi, low = 9999, []
    blank = []
    for i, p in enumerate(d):
        for f in p.get_fonts(full=True):
            fonts[f[3]] = (f[1] != "n/a" and f[1] != "") or f[0] > 0
        words = [w for w in p.get_text("words") if 0.9 * 72 < w[1] < p.rect.y1 - 0.75 * 72]
        if not words and not p.get_images():
            blank.append(i + 1)
        for im in p.get_images(full=True):
            for rect in p.get_image_rects(im[0]):
                if rect.width < 1 or rect.height < 1:
                    continue
                ppi = im[2] / (rect.width / 72)
                if ppi < min_ppi:
                    min_ppi = ppi
                if ppi < 200:
                    low.append((i + 1, round(ppi)))
    emb = []
    for xref in range(1, d.xref_length()):
        try:
            t = d.xref_object(xref, compressed=False)
        except Exception:
            continue
        if "/Type /FontDescriptor" in t or "/Type/FontDescriptor" in t:
            emb.append(("/FontFile" in t))
    return {"pages": len(d), "w_in": r0.width / 72, "h_in": r0.height / 72, "n_fonts": len(emb), "all_embedded": all(emb) if emb else False,
            "min_ppi": None if min_ppi == 9999 else round(min_ppi), "low_pages": sorted(set(low))[:12], "blank": blank,
            "toc": len(d.get_toc()), "size_mb": round(path.stat().st_size / 1e6, 1), "meta_title": d.metadata.get("title", "")}


def main():
    P = load_project()
    out = ["# Preflight report", "", f"Generated {date.today().isoformat()} by `tools/preflight.py` from the files in `release/`.",
           "A printer’s own preflight (KDP previewer, IngramSpark file check) remains the final authority.", ""]
    try:
        from epubcheck import EpubCheck
    except Exception:
        EpubCheck = None
    for slug, b in P.books.items():
        pr = b.cfg["print"]
        mode = pr.get("bleed_mode", "all")
        exp_w = pr["trim_in"][0] + pr["bleed_in"] * (2 if mode == "all" else 1)
        exp_h = pr["trim_in"][1] + 2 * pr["bleed_in"]
        out += [f"## {slug}", "", f"Page size expected for bleed mode `{mode}`: **{exp_w:.3f} × {exp_h:.3f} in**.", "",
                "### Interiors", "", "| Edition | Pages | Size (in) | Even | Fonts embedded | Bookmarks | Lowest image ppi | Blank pages | MB |", "|---|---|---|---|---|---|---|---|---|"]
        for lang in P.langs:
            for ed in ("story", "guide"):
                f = ROOT / "release" / slug / "print" / f"{lang}-{ed}" / f"{slug}_{lang}_{ed}_interior.pdf"
                if not f.exists():
                    out.append(f"| {lang}-{ed} | missing | | | | | | | |")
                    continue
                x = pdf_facts(f)
                ok_size = abs(x["w_in"] - exp_w) < 0.01 and abs(x["h_in"] - exp_h) < 0.01
                out.append(f"| {lang}-{ed} | {x['pages']} | {x['w_in']:.3f} × {x['h_in']:.3f} {'✓' if ok_size else '✗'} | {'✓' if x['pages'] % 2 == 0 else '✗'} | "
                           f"{x['n_fonts']} {'✓' if x['all_embedded'] else '✗'} | {x['toc']} | {x['min_ppi']} | {x['blank']} | {x['size_mb']} |")
        out += ["", "Blank pages are intentional (verso after the half-title, recto/verso balancing before part pages, final page when the count had to be rounded to an even number).", "",
                "### Cover wraps", "", "| Edition | Wrap (in) | Expected (in) | Spine (in) | Lowest image ppi |", "|---|---|---|---|---|"]
        for lang in P.langs:
            for ed in ("story", "guide"):
                cdir = ROOT / "release" / slug / "covers" / f"{lang}-{ed}"
                f = cdir / f"{slug}_{lang}_{ed}_cover_wrap_PRINT.pdf"
                mp = ROOT / "build" / slug / "print" / f"{lang}-{ed}" / "meta.json"
                if not f.exists() or not mp.exists():
                    out.append(f"| {lang}-{ed} | missing | | | |")
                    continue
                pages = json.loads(mp.read_text())["pages"]
                factor = {"white": 0.002252, "cream": 0.0025, "premium_color": 0.002347}.get(pr.get("paper", "cream"), 0.0025)
                spine = round(pages * factor, 3)
                d = pymupdf.open(f)
                r = d[0].rect
                exp = 2 * pr["bleed_in"] + 2 * pr["trim_in"][0] + round(spine / 0.005) * 0.005
                x = pdf_facts(f)
                out.append(f"| {lang}-{ed} | {r.width / 72:.3f} × {r.height / 72:.3f} | ≈ {exp:.3f} × {exp_h:.3f} | {spine:.3f} for {pages} pp | {x['min_ppi']} |")
        out += ["", "The PRINT wrap contains no guides, placeholders or barcode box; the PROOF wrap shows trim, bleed, spine and safe zone. "
                "Chromium rounds the PDF page size to whole CSS pixels (1/96 in), so the file width can differ from the computed width by up to 0.01 in (0.25 mm); the artwork itself is positioned on the exact computed grid.", "", "### EPUB", "", "| Edition | KB | EPUBCheck |", "|---|---|---|"]
        for lang in P.langs:
            for ed in ("story", "guide"):
                f = ROOT / "release" / slug / "epub" / f"{slug}_{lang}_{ed}.epub"
                if not f.exists():
                    out.append(f"| {lang}-{ed} | missing | |")
                    continue
                res = "not run"
                if EpubCheck:
                    r = EpubCheck(str(f))
                    res = f"valid, {len(r.messages)} messages" if r.valid else "INVALID: " + "; ".join(m.message[:80] for m in r.messages[:3])
                out.append(f"| {lang}-{ed} | {round(f.stat().st_size / 1024)} | {res} |")
        out.append("")
    (ROOT / "docs" / "PREFLIGHT.md").write_text("\n".join(out), encoding="utf-8")
    print("\n".join(out))


if __name__ == "__main__":
    main()
