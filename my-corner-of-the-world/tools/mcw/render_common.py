"""Semantic HTML for book content, shared by the EPUB and the website reader.

Print has its own renderer (hyphenation, bleed, plates). Here images are plain <figure>s and
no soft hyphens are inserted (readers and browsers hyphenate with their own dictionaries).
"""
from __future__ import annotations

import html as _html
from typing import Callable

from . import typo
from .core import Book
from .mdparse import Block, Guide, Manuscript, Section, strip_tags

COLOR_LABELS = ("color of the day", "couleur du jour", "color del día")


def esc(s: str) -> str:
    return _html.escape(s, quote=True)


class Common:
    def __init__(self, book: Book, lang: str, fig_fn: Callable[[str, dict], str]):
        self.book, self.lang, self.fig_fn = book, lang, fig_fn

    def T(self, html: str) -> str:
        return typo.apply(html, self.lang, hyphenate=False)

    # ---- blocks -----------------------------------------------------------
    def _list(self, items, kind, start=1, cls=""):
        tag = "ol" if kind == "ol" else "ul"
        attrs = f' class="{cls}"' if cls else ""
        if kind == "ol" and start != 1:
            attrs += f' start="{start}"'
        return f"<{tag}{attrs}>" + "".join(f"<li>{self.T(i)}</li>" for i in items) + f"</{tag}>"

    def sound_html(self, sec: Section) -> str:
        """The italic 'Sound lost: …' line printed in the chapter opener (books with design.sound_lines)."""
        if sec.blocks and sec.blocks[0].kind == "sound":
            m = sec.blocks[0].meta
            return f'<div class="sound"><span class="k">{self.T(esc(m["label"]))}</span><span class="t">{self.T(m["text"])}</span></div>'
        return ""

    def block(self, b: Block, sec: Section | None = None) -> str:
        k = b.kind
        if k == "sound":
            return ""
        if k == "p":
            return f"<p>{self.T(b.html)}</p>"
        if k == "note":
            return f'<p class="note">{self.T(b.html)}</p>'
        if k == "dateline":
            return f'<p class="dateline">{self.T(b.html)}</p>'
        if k == "notice":
            hand = self.book.design.get("notice_hand") and sec is not None and sec.kind in ("chapter", "epilogue", "prologue")
            return f'<p class="notice{" hand" if hand else ""}">{self.T(b.html)}</p>'
        if k == "poster":
            return '<div class="poster">' + "".join(f"<p>{self.T(l)}</p>" for l in b.items) + "</div>"
        if k == "label":
            return f"<p>{self.T(b.html)}</p>"
        if k == "card":
            title = strip_tags(b.html).strip()
            rules = b.meta.get("list") == "ol" and title.upper() == title
            nb = self.book.design.get("nb_cards") and b.meta.get("nb")
            return (f'<div class="card{" nb" if nb else ""}"><p class="ct">{self.T(b.html)}</p>'
                    + self._list(b.items, b.meta.get("list", "ul"), b.meta.get("start", 1), "rules" if rules else "") + "</div>")
        if k == "ol":
            return self._list(b.items, "ol", b.meta.get("start", 1), "rules")
        if k == "ul":
            nb = self.book.design.get("nb_cards") and b.meta.get("nb")
            return f'<div class="card{" nb" if nb else ""}">{self._list(b.items, "ul")}</div>'
        if k == "tail":
            sw = self.book.cfg.get("chapter_swatches", {}).get(sec.id) if sec else None
            parts = []
            for i, x in enumerate(b.items):
                h = self.block(x, sec)
                if i == 0 and sw and x.kind == "label" and strip_tags(x.html).lower().startswith(COLOR_LABELS):
                    h = h.replace("<p>", f'<p><span class="sw" style="background:{sw}"></span>', 1)
                parts.append(h)
            return f'<div class="tail">{"".join(parts)}</div>'
        if k == "table":
            return self.table(b)
        if k == "h3":
            return f"<h3>{self.T(b.html)}</h3>"
        if k == "hr":
            return ""
        return f"<p>{self.T(b.html)}</p>"

    def table(self, b: Block, cls: str = "") -> str:
        head, rows = b.items
        kv = head is None and b.meta.get("cols", 2) == 2
        c = (cls + (" kv" if kv else "")).strip()
        t = f'<table class="{c}">' if c else "<table>"
        if head:
            t += "<thead><tr>" + "".join(f"<th>{self.T(x)}</th>" for x in head) + "</tr></thead>"
        t += "<tbody>" + "".join("<tr>" + "".join(f"<td>{self.T(x)}</td>" for x in r) + "</tr>" for r in rows) + "</tbody></table>"
        return t

    # ---- sections ---------------------------------------------------------
    def slots_for(self, sec_id: str):
        for aid, s in self.book.register["slots"].items():
            if s["kind"] != "cover" and s.get("chapter") == sec_id:
                yield aid, s

    def section_body(self, sec: Section) -> str:
        inserts: dict[int, list[str]] = {}
        for aid, slot in self.slots_for(sec.id):
            anchor = typo.norm(slot["anchor"][self.lang])
            idx = next((i for i, b in enumerate(sec.blocks) if b.kind == "p" and anchor in typo.norm(b.html)), None)
            if idx is None:
                raise SystemExit(f"[{self.lang}] anchor for {aid} not found in {sec.id}")
            html = self.fig_fn(aid, slot)
            if html:
                inserts.setdefault(idx, []).append(html)
        out = []
        for i, b in enumerate(sec.blocks):
            out.append(self.block(b, sec))
            out.extend(inserts.get(i, []))
        return "".join(out)

    def guide_section_body(self, sec: Section) -> str:
        out = []
        for b in sec.blocks:
            if b.kind == "table":
                cls = "gloss" if sec.title.lower().startswith(("words from", "quelques mots", "palabras")) else ""
                out.append(self.table(b, cls))
            elif b.kind in ("ul", "ol"):
                out.append(self._list(b.items, b.kind, b.meta.get("start", 1)))
            elif b.kind == "card":
                out.append(self.block(b, sec))
            else:
                out.append(self.block(b, sec))
        return "".join(out)
