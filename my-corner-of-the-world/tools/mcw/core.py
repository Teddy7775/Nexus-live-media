"""Project loading: series.json, book.json, manuscripts, guides, artwork."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path

from .mdparse import Guide, Manuscript, parse_guide, parse_manuscript

ROOT = Path(__file__).resolve().parents[2]  # .../my-corner-of-the-world
BUILD = ROOT / "build"                      # throw-away intermediates (git-ignored)
RELEASE = ROOT / "release"                  # print PDFs, covers, ePubs (committed)
PUBLIC = ROOT / "public_html"               # deployable website (committed)
LANGS = ("en", "fr", "es")


def load_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


@dataclass
class Book:
    slug: str
    dir: Path
    cfg: dict
    series: dict

    # -- text ---------------------------------------------------------------
    def _md_path(self, kind: str, lang: str) -> Path:
        edited = self.dir / kind / f"{lang}.md"
        return edited if edited.exists() else self.dir / kind / "original" / f"{lang}.md"

    def manuscript_text(self, lang: str) -> str:
        return self._md_path("manuscript", lang).read_text(encoding="utf-8")

    def guide_text(self, lang: str) -> str:
        return self._md_path("guide", lang).read_text(encoding="utf-8")

    def manuscript(self, lang: str) -> Manuscript:
        return parse_manuscript(self.manuscript_text(lang), lang, self.cfg.get("parser"))

    @property
    def design(self) -> dict:
        """Per-book typographic switches (book.json "design"); empty for Ananya’s Notebook."""
        return self.cfg.get("design", {})

    def guide(self, lang: str) -> Guide:
        return parse_guide(self.guide_text(lang), lang)

    # -- metadata helpers ---------------------------------------------------
    def title(self, lang: str) -> str:
        return self.cfg["titles"][lang]["title"]

    def subtitle(self, lang: str) -> str:
        return self.cfg["titles"][lang]["subtitle"]

    @cached_property
    def register(self) -> dict:
        return load_json(self.dir / "art" / "register.json")

    @property
    def author(self) -> str:
        return self.cfg.get("author") or self.series.get("author", {}).get("name", "")

    @property
    def palette(self) -> dict:
        return self.cfg["palette"]


@dataclass
class Project:
    root: Path
    series: dict
    books: dict[str, Book] = field(default_factory=dict)

    @property
    def langs(self):
        return self.series["languages"]

    def i18n(self, lang: str) -> dict:
        return load_json(self.root / "site" / "i18n" / f"{lang}.json")

    @property
    def featured(self) -> Book:
        """The book the home page puts first: series.json "featured" (a slug), else the lowest volume number."""
        slug = self.series.get("featured")
        if slug in self.books:
            return self.books[slug]
        return min(self.books.values(), key=lambda b: b.cfg["volume"])

    def catalog(self) -> list[dict]:
        """Every volume of the collection in series order: the books built here and the announced titles
        (series.json "upcoming", entries with "visible": true). Announced titles carry their own "volume" number."""
        out = [{"volume": b.cfg["volume"], "book": b, "upcoming": None} for b in self.books.values()]
        out += [{"volume": u.get("volume"), "book": None, "upcoming": u}
                for u in self.series.get("upcoming", []) if u.get("visible")]
        out.sort(key=lambda e: (e["volume"] is None, e["volume"] or 0))
        return out


def load_project(root: Path = ROOT) -> Project:
    series = load_json(root / "series.json")
    proj = Project(root, series)
    for slug in series["books"]:
        d = root / "books" / slug
        proj.books[slug] = Book(slug, d, load_json(d / "book.json"), series)
    return proj
