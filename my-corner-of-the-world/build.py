#!/usr/bin/env python3
"""My Corner of the World: build tool.

    python3 build.py print  [--book SLUG] [--lang en|fr|es|all] [--edition story|guide|all] [--final]
    python3 build.py cover  ...
    python3 build.py epub   ...
    python3 build.py site
    python3 build.py all
    python3 build.py check            # editorial + art preflight report only
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "tools"))

from mcw.core import LANGS, load_project  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["print", "cover", "epub", "site", "all", "check"])
    ap.add_argument("--book", default=None)
    ap.add_argument("--lang", default="all")
    ap.add_argument("--edition", default="all")
    ap.add_argument("--final", action="store_true", help="fail instead of printing proof placeholders")
    a = ap.parse_args()
    P = load_project()
    books = [P.books[a.book]] if a.book else list(P.books.values())
    langs = LANGS if a.lang == "all" else (a.lang,)
    mode = "final" if a.final else "proof"
    if a.cmd in ("print", "all"):
        from mcw.pipeline import build_print_all
        for b in books:
            build_print_all(P, b, langs, a.edition, mode)
    if a.cmd in ("cover", "all"):
        from mcw.pipeline import build_covers_all
        for b in books:
            build_covers_all(P, b, langs, a.edition, mode)
    if a.cmd in ("epub", "all"):
        from mcw.pipeline import build_epub_all
        for b in books:
            build_epub_all(P, b, langs, a.edition)
    if a.cmd in ("site", "all"):
        from mcw.pipeline import build_site
        build_site(P)


if __name__ == "__main__":
    main()
