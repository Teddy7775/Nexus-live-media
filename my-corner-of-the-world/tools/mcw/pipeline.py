"""Orchestration: build all print interiors, covers, ebooks and the site."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from .core import BUILD, PUBLIC, RELEASE, Book, Project, load_json

EDITIONS = ("story", "guide")


def editions(arg: str):
    return EDITIONS if arg == "all" else (arg,)


def _meta_path(book: Book, lang: str, ed: str) -> Path:
    return BUILD / book.slug / "print" / f"{lang}-{ed}" / "meta.json"


def build_print_all(P: Project, book: Book, langs, edition: str, mode: str):
    from .render_print import PrintBuilder
    dest = RELEASE / book.slug / "print"
    for lang in langs:
        for ed in editions(edition):
            pb = PrintBuilder(book, lang, ed, mode)
            r = pb.build()
            meta = {"pages": r["pages"], "toc": r["toc"], "warnings": r["warnings"], "spacers": r["spacers"],
                    "placed": r["placed"]}
            _meta_path(book, lang, ed).write_text(json.dumps(meta, indent=1, ensure_ascii=False))
            out = dest / f"{lang}-{ed}"
            out.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(r["pdf"], out / Path(r["pdf"]).name)
            print(f"[print] {lang}-{ed}: {r['pages']} pages -> {out / Path(r['pdf']).name}")
            for w in r["warnings"]:
                print("   !", w)


def build_covers_all(P: Project, book: Book, langs, edition: str, mode: str):
    from .render_cover import CoverBuilder
    dest = RELEASE / book.slug / "covers"
    for lang in langs:
        for ed in editions(edition):
            mp = _meta_path(book, lang, ed)
            if not mp.exists():
                raise SystemExit(f"Build the {lang}-{ed} interior first (page count sets the spine): python3 build.py print --lang {lang} --edition {ed}")
            pages = load_json(mp)["pages"]
            r = CoverBuilder(book, lang, ed, pages, mode).build()
            out = dest / f"{lang}-{ed}"
            out.mkdir(parents=True, exist_ok=True)
            for k in ("print", "proof", "front_png"):
                shutil.copyfile(r[k], out / Path(r[k]).name)
            print(f"[cover] {lang}-{ed}: spine {r['spine_in']:.3f} in for {pages} pp; wrap {r['size_in'][0]:.3f} x {r['size_in'][1]:.3f} in")
            for w in r["warnings"]:
                print("   !", w)


def build_epub_all(P: Project, book: Book, langs, edition: str):
    from .render_epub import build_epub
    for lang in langs:
        for ed in editions(edition):
            build_epub(P, book, lang, ed)


def build_site(P: Project):
    from .render_site import build_site as _b
    _b(P)
