"""Exact page boxes for print PDFs.

Chromium rounds a page to 1/300 in when it prints (6.125 in becomes 6.1233 in, 12.538 in becomes 12.5367 in), and a printer's
upload check compares the page size with the trim size plus bleed. After printing, every page gets its exact MediaBox and
CropBox, a BleedBox equal to it, and a TrimBox that tells the printer where the finished book edge is. Nothing is drawn or
scaled: the content already fills the page, and the sliver that is added (at most 0.003 in) lies in the bleed or in the gutter.
"""
from __future__ import annotations


def _num(v: float) -> str:
    return f"{v:.3f}".rstrip("0").rstrip(".")


def _box(x0: float, y0: float, x1: float, y1: float) -> str:
    return "[" + " ".join(_num(v) for v in (x0, y0, x1, y1)) + "]"


def set_boxes(doc, w_pt: float, h_pt: float, trim_for_page) -> None:
    """`trim_for_page(i)` gives (x0, y0, x1, y1) of the trim box of page i in PDF space (origin bottom left, points)."""
    media = _box(0, 0, w_pt, h_pt)
    for i in range(len(doc)):
        xref = doc[i].xref
        for key in ("MediaBox", "CropBox", "BleedBox"):
            doc.xref_set_key(xref, key, media)
        doc.xref_set_key(xref, "TrimBox", _box(*trim_for_page(i)))
