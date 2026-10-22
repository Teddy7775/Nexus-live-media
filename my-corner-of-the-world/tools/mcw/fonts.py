"""Print-only font preparation.

Literata's soft-hyphen glyph (U+00AD) has a non-zero advance, so words carrying soft hyphens
(inserted for print hyphenation) show gaps. We make a patched copy in build/fonts with that
glyph empty and zero-width. The licensed originals in assets/fonts stay untouched (OFL permits
modification; the patched copies are only used to build the PDFs).
"""
from __future__ import annotations

import shutil

from fontTools.ttLib import TTFont

from .core import BUILD, ROOT

SRC = ROOT / "assets" / "fonts"


def patched_fonts_dir():
    out = BUILD / "fonts"
    out.mkdir(parents=True, exist_ok=True)
    for f in SRC.glob("*.woff2"):
        dst = out / f.name
        if dst.exists() and dst.stat().st_mtime >= f.stat().st_mtime:
            continue
        if f.name.startswith("literata-"):
            tt = TTFont(f)
            gn = tt.getBestCmap().get(0xAD)
            if gn:
                tt["hmtx"][gn] = (0, 0)
                if "glyf" in tt:
                    from fontTools.ttLib.tables._g_l_y_f import Glyph
                    tt["glyf"][gn] = Glyph()
            tt.flavor = "woff2"
            tt.save(dst)
        else:
            shutil.copyfile(f, dst)
    return out
