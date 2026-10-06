"""Print-ready interior PDF (HTML + CSS paged media, rendered by Chromium).

Two passes: the first renders with placeholder folios in the contents page; the page
numbers of every opener are then read back from the PDF and the second pass fills them in
(the contents page has the same number of lines in both passes, so pagination is stable).
"""
from __future__ import annotations

import html as _html
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

import pymupdf as fitz  # PyMuPDF
from jinja2 import Environment, FileSystemLoader
from playwright.sync_api import sync_playwright

from . import typo
from .art import Art
from .browser import launch
from .fonts import patched_fonts_dir
from .core import BUILD, ROOT, Book, load_project
from .mdparse import Block, Manuscript, Section, strip_tags

TEMPLATES = Path(__file__).parent / "templates"
FONTS = ROOT / "assets" / "fonts"

STR = {
    "en": {"contents": "Contents", "guide": "Discovery Guide", "part_chapters": "Chapters {a}–{b}",
           "spoiler": "This guide talks about the whole story, including the ending. Read it after the novel.",
           "series_page": "About the series", "also": "In the series", "web": "Website",
           "rights": "All rights reserved.", "fiction": "A work of fiction. See “{note}” at the back of the book for what is invented and what is real.",
           "printed": "First edition, {year}.", "isbn": "ISBN", "story_ed": "Story edition", "guide_ed": "Story and Discovery Guide",
           "placeholder_author": "[AUTHOR NAME]", "placeholder_publisher": "[PUBLISHER]", "placeholder_isbn": "[ISBN]"},
    "fr": {"contents": "Sommaire", "guide": "Guide de découverte", "part_chapters": "Chapitres {a} à {b}",
           "spoiler": "Ce guide parle de toute l’histoire, y compris de la fin. Lisez-le après le roman.",
           "series_page": "À propos de la collection", "also": "Dans la collection", "web": "Site web",
           "rights": "Tous droits réservés.", "fiction": "Œuvre de fiction. Voir « {note} » à la fin du livre pour distinguer l’inventé du réel.",
           "printed": "Première édition, {year}.", "isbn": "ISBN", "story_ed": "Édition roman", "guide_ed": "Roman et guide de découverte",
           "placeholder_author": "[NOM DE L’AUTEUR]", "placeholder_publisher": "[ÉDITEUR]", "placeholder_isbn": "[ISBN]"},
    "es": {"contents": "Índice", "guide": "Guía de descubrimiento", "part_chapters": "Capítulos {a} a {b}",
           "spoiler": "Esta guía habla de toda la historia, incluido el final. Léela después de la novela.",
           "series_page": "Sobre la colección", "also": "En la colección", "web": "Sitio web",
           "rights": "Todos los derechos reservados.", "fiction": "Obra de ficción. Consulta «{note}» al final del libro para saber qué es inventado y qué es real.",
           "printed": "Primera edición, {year}.", "isbn": "ISBN", "story_ed": "Edición de la novela", "guide_ed": "Novela y guía de descubrimiento",
           "placeholder_author": "[NOMBRE DEL AUTOR]", "placeholder_publisher": "[EDITORIAL]", "placeholder_isbn": "[ISBN]"},
}

ORN_SVG = ('<svg class="orn" viewBox="0 0 120 34" xmlns="http://www.w3.org/2000/svg">'
           '<line x1="2" y1="17" x2="44" y2="17" stroke="{c}" stroke-width="1.2"/>'
           '<line x1="76" y1="17" x2="118" y2="17" stroke="{c}" stroke-width="1.2"/>'
           '<path d="M60 3 L72 17 L60 31 L48 17 Z" fill="none" stroke="{c}" stroke-width="1.4"/>'
           '<path d="M60 3 L60 31 M48 17 L72 17" stroke="{c}" stroke-width=".8"/>'
           '<path d="M55 21 q5 -9 5 -3 q3 -4 5 3 q-5 4 -10 0z" fill="{k}"/></svg>')

BELL_SVG = ('<svg class="orn" viewBox="0 0 120 34" xmlns="http://www.w3.org/2000/svg">'
            '<line x1="2" y1="17" x2="46" y2="17" stroke="{c}" stroke-width="1.2"/>'
            '<line x1="74" y1="17" x2="118" y2="17" stroke="{c}" stroke-width="1.2"/>'
            '<path d="M60 4 c-1.6 0 -2.6 1 -2.6 2.4 C52.4 8 50.6 12.2 50.6 18 v4.6 l-3.4 3.8 h25.6 l-3.4 -3.8 V18 c0 -5.8 -1.8 -10 -6.8 -11.6 C62.6 5 61.6 4 60 4z" fill="none" stroke="{c}" stroke-width="1.4"/>'
            '<circle cx="60" cy="29.2" r="2.1" fill="{k}"/></svg>')

# a goblet drum (the book's own instrument): head, laced body, flared foot, between two rules
DRUM_SVG = ('<svg class="orn" viewBox="0 0 120 34" xmlns="http://www.w3.org/2000/svg">'
            '<line x1="2" y1="17" x2="46" y2="17" stroke="{c}" stroke-width="1.2"/>'
            '<line x1="74" y1="17" x2="118" y2="17" stroke="{c}" stroke-width="1.2"/>'
            '<ellipse cx="60" cy="7.4" rx="9.6" ry="2.7" fill="none" stroke="{c}" stroke-width="1.4"/>'
            '<path d="M50.4 7.4 C50.6 14 54.6 16.6 55.6 21 C56.4 25 53.8 28.2 52.6 30.6 H67.4 C66.2 28.2 63.6 25 64.4 21 C65.4 16.6 69.4 14 69.6 7.4" fill="none" stroke="{c}" stroke-width="1.4" stroke-linejoin="round"/>'
            '<path d="M52.2 10.6 L60 16.2 L67.8 10.6 M54.6 14.2 L60 18.2 L65.4 14.2" fill="none" stroke="{k}" stroke-width=".9" stroke-linejoin="round"/>'
            '<circle cx="60" cy="32.2" r="1.5" fill="{k}"/></svg>')

COLOR_LABELS = ("color of the day", "couleur du jour", "color del día")

# copy-fitting: levels tried, in order, on a chapter whose last page would hold only a few lines.
# tt = tighter tracking, lo = looser tracking (they only change a line count where a paragraph's last line is short),
# vt / vl = leading 1.5 % tighter / looser (one more / one less line on every full page: the lever that works).
FIT_CLASSES = ["", "tt1", "tt2", "vt", "vt tt2", "vl", "vl lo2"]
FIT_ROUNDS = 8          # layouts tried before the remaining short pages are accepted and reported
RUNT_FILL = 0.14        # a chapter's last text page filled less than this share of the text area counts as a runt

LINK_RE = re.compile(r'<a href="([^"]+)"([^>]*)>(.*?)</a>', re.S)


def url_text(u: str) -> str:
    """https://www.example.org/path/  ->  example.org/path"""
    return re.sub(r"^https?://(www\.)?", "", u).rstrip("/")


def show_urls(html: str) -> str:
    """A paper reader cannot click: every web link whose text is not already its address gets the address after it."""
    def rep(m: re.Match) -> str:
        href, label = m.group(1), m.group(3)
        if not href.startswith("http"):
            return m.group(0)
        shown = url_text(href)
        if url_text(typo.plain(label).strip()).lower() == shown.lower():
            return m.group(0)
        return f'{m.group(0)}<span class="url">{_html.escape(shown, quote=False)}</span>'
    return LINK_RE.sub(rep, html)


@dataclass
class Geometry:
    tw: float
    th: float
    b: float
    mode: str
    top: float
    bottom: float
    inner: float
    outer: float

    @property
    def b_in(self) -> float:   # bleed on the gutter side of a page
        return self.b if self.mode == "all" else 0.0

    @property
    def b_out(self) -> float:  # bleed on the outer (fore-edge) side
        return self.b

    @property
    def PW(self) -> float:
        return round(self.tw + self.b_in + self.b_out, 4)

    @property
    def PH(self) -> float:
        return round(self.th + 2 * self.b, 4)

    @property
    def text_h(self) -> float:
        return round(self.th - self.top - self.bottom, 4)


def geometry(book: Book) -> Geometry:
    p = book.cfg["print"]
    m = p["margins_in"]
    return Geometry(p["trim_in"][0], p["trim_in"][1], p["bleed_in"], p.get("bleed_mode", "all"),
                    m["top"], m["bottom"], m["inner"], m["outer"])


def esc(s: str) -> str:
    return _html.escape(s, quote=True)


def css_str(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


class PrintBuilder:
    def __init__(self, book: Book, lang: str, edition: str, mode: str = "proof"):
        self.book, self.lang, self.edition, self.mode = book, lang, edition, mode
        self.design = book.design
        self.guide_on = edition == "guide"
        self.ms: Manuscript = book.manuscript(lang)
        self.guide = book.guide(lang) if self.guide_on else None
        self.art = Art(book)
        self.geo = geometry(book)
        self.S = STR[lang]
        self.series = book.series
        self.warnings: list[str] = []
        self._all_ids: list[str] = []
        # first section after each part page: it must face the part page (recto)
        self.faces_part = set()
        prev = None
        for sec in self.ms.sections:
            if prev is not None and prev.kind == "part":
                self.faces_part.add(sec.id)
            prev = sec
        self.placed: dict[str, dict] = {}
        self.toc_pages: dict[str, int] = {}
        self.constraints: list[tuple[str, str]] = []   # (element id, 'r' recto | 'v' verso) in document order
        self.spacers: set[str] = set()
        # page-art placement: full-page plates and spreads are moved to the end of the page that holds their
        # anchor paragraph (never before it), so the text page before a plate is not left nearly empty.
        self.plate_pos: dict[str, int] = {}       # art id -> index of the block the plate follows
        self.inline_scale: dict[str, float] = {}  # art id -> width factor (<1) for an inline picture that would leave a gap
        self._second_pass = False
        self.fit: dict[str, int] = {}              # section id -> index into FIT_CLASSES (copy-fitting of runt last pages)
        self.fit_round = 0
        self.flow_mode = False                    # True while rendering the text-only "flow" pass
        self.flow_cands: dict[str, tuple[str, int, list[int], int]] = {}
        self.flow_xy: dict[str, tuple[int, float]] = {}
        self._flow_ids: list[str] = []
        self._flow_seen: list[str] = []
        self.out_dir = BUILD / book.slug / "print" / f"{lang}-{edition}"
        self.out_dir.mkdir(parents=True, exist_ok=True)

    def note_pt(self) -> float:
        """Type size of the closing "note on the story": design.note_pt, one number or a {lang: size} map (default 10.4)."""
        v = self.design.get("note_pt", 10.4)
        return float(v.get(self.lang, 10.4) if isinstance(v, dict) else v)

    def orn_svg(self, c: str, k: str) -> str:
        return {"bell": BELL_SVG, "drum": DRUM_SVG}.get(self.design.get("orn"), ORN_SVG).format(c=c, k=k)

    # ---------- helpers ---------------------------------------------------
    def T(self, html: str) -> str:
        return typo.apply(html, self.lang, hyphenate=True)

    def Th(self, html: str) -> str:
        """Headings and contents lines: language typography, never hyphenated."""
        return typo.apply(html, self.lang, hyphenate=False)

    def mark(self, eid: str, parity: str) -> str:
        """Register a parity constraint; emit a blank spacer page before it if the solver asked for one."""
        self.constraints.append((eid, parity))
        return '<div class="spacer"></div>' if eid in self.spacers else ""

    def todo(self, text: str) -> str:
        return f'<span class="todo">{esc(text)}</span>' if self.mode == "proof" else ""

    def author(self) -> str:
        a = self.book.series.get("author", {}).get("name", "")
        return esc(a) if a else self.todo(self.S["placeholder_author"])

    def img_url(self, af) -> str:
        return af.work.resolve().as_uri()

    # ---------- illustrations -------------------------------------------
    def slots_for(self, section_id: str):
        for aid, s in self.book.register["slots"].items():
            if s["kind"] != "cover" and s.get("chapter") == section_id:
                yield aid, s

    def locate(self, sec: Section, aid: str, slot: dict) -> int:
        anchor = typo.norm(slot["anchor"][self.lang])
        for i, b in enumerate(sec.blocks):
            if b.kind == "p" and anchor in typo.norm(b.html):
                return i
        raise SystemExit(
            f"[{self.lang}] anchor for {aid} not found in {sec.id}: “{slot['anchor'][self.lang]}”. "
            "An edit changed the anchor sentence; restore it or update art/register.json.")

    def locate_text(self, sec: Section, aid: str, text: str) -> int:
        a = typo.norm(text)
        for i, b in enumerate(sec.blocks):
            if b.kind == "p" and a in typo.norm(b.html):
                return i
        raise SystemExit(f"[{self.lang}] 'stop' text for {aid} not found in {sec.id}: “{text}”")

    def is_page_art(self, aid: str, slot: dict) -> bool:
        """True when the picture takes whole pages (plate or spread) instead of sitting inline."""
        kind = slot["kind"]
        af = self.art.get(aid)
        if kind not in ("full", "spread", "inset"):
            return False
        if af is None or kind == "inset":
            return True
        return (kind == "spread" and af.aspect > 1.2) or (kind == "full" and af.aspect < 1.0)

    def render_art(self, aid: str, slot: dict) -> str:
        af = self.art.get(aid)
        kind = slot["kind"]
        alt = esc(slot["alt"][self.lang])
        info = {"kind": kind, "mode": None, "pages": 0}
        if af is None:
            self.warnings.append(f"{aid}: no artwork file found (placeholder used)")
            info["mode"] = "placeholder"
            self.placed[aid] = info
            label = f'{aid} · {slot["scene"][self.lang]}'
            if kind == "spread":
                info["pages"] = 2
                return (self.mark(f"fig-{aid}", "v")
                        + f'<div class="plate missing spread-l" id="fig-{aid}"><div>{esc(label)}<br>[spread · left page]</div></div>'
                        f'<div class="plate missing spread-r"><div>{esc(label)}<br>[spread · right page]</div></div>')
            if kind in ("full", "inset"):
                info["pages"] = 1
                return f'<div class="plate missing"><div>{esc(label)}<br>[full page]</div></div>'
            return f'<figure class="inline missing"><div class="ph">{esc(label)}<br>[{kind}]</div></figure>'
        G = self.geo
        url = self.img_url(af)
        if kind == "spread" and af.aspect > 1.2:
            info.update(mode="spread", pages=2)
            total_w = G.tw * 2 + 2 * G.b                    # trim-to-trim + outer bleeds
            img_h = total_w / af.aspect
            if img_h > G.PH:                                # taller than a page: crop centrally
                img_h_css = img_h
                top = -(img_h - G.PH) / 2
            else:
                img_h_css, top = img_h, 0.0
            # left page box starts at s = -b ; right page box starts at s = tw - b_in
            left_off = 0.0
            right_off = -(G.tw + G.b - (G.b_in))            # = -(tw + b - b_in)
            style = lambda off: (f'left:{off:.4f}in;top:{top:.4f}in;width:{total_w:.4f}in;height:{img_h_css:.4f}in;')
            html = (self.mark(f"fig-{aid}", "v")
                    + f'<div class="plate spread-l" id="fig-{aid}"><img src="{url}" alt="{alt}" style="{style(left_off)}"></div>'
                    f'<div class="plate spread-r"><img src="{url}" alt="" style="{style(right_off)}"></div>')
            if img_h < G.PH * 0.9:
                self.warnings.append(f"{aid}: supplied aspect {af.aspect:.2f} is wider than the 4:3 slot; "
                                     f"placed as a top-bleed band ({img_h:.1f} in tall of {G.PH:.2f}). Supply 4:3 for a full spread.")
            self.placed[aid] = info
            return html
        if kind == "inset":
            # a page of its own that keeps the picture whole (the art direction asks for no crop): centred, paper all round
            info.update(mode="inset", pages=1)
            iw = float(slot.get("inset_in") or self.design.get("inset_in", 5.0))
            ih = iw / af.aspect
            room = G.PH - 2 * (G.b + 0.6)
            if ih > room:
                iw, ih = room * af.aspect, room
            style = (f"left:{(G.PW - iw) / 2:.4f}in;top:{(G.PH - ih) / 2 - 0.1:.4f}in;width:{iw:.4f}in;height:{ih:.4f}in;"
                     "border-radius:2.5pt;")
            self.placed[aid] = info
            return f'<div class="plate inset"><img src="{url}" alt="{alt}" style="{style}"></div>'
        if kind in ("full",) and af.aspect < 1.0:
            info.update(mode="plate", pages=1)
            ph = G.PH
            pw = G.PW
            iw, ih = (pw, pw / af.aspect) if (pw / af.aspect) >= ph else (ph * af.aspect, ph)
            ratio_note = abs(af.aspect - 2 / 3)
            if ratio_note > 0.04:
                self.warnings.append(f"{aid}: aspect {af.aspect:.3f} differs from 2:3; cropped to fill the page")
            style = f"left:{(pw - iw) / 2:.4f}in;top:{(ph - ih) / 2:.4f}in;width:{iw:.4f}in;height:{ih:.4f}in;"
            self.placed[aid] = info
            return f'<div class="plate"><img src="{url}" alt="{alt}" style="{style}"></div>'
        # everything else: inline figure at text width
        info.update(mode="inline", pages=0)
        if kind == "full":
            self.warnings.append(f"{aid}: a full-page (2:3) slot received a landscape image ({af.w}x{af.h}); "
                                 "placed inline at text width. Supply a 2:3 version for a full-page plate.")
        if kind == "spread":
            self.warnings.append(f"{aid}: spread slot received a non-landscape image; placed inline")
        want = {"3:2": 1.5, "16:9": 16 / 9, "4:3": 4 / 3}.get(slot.get("ratio"), 1.5)
        if kind == "half" and abs(af.aspect - want) > 0.2:
            self.warnings.append(f"{aid}: aspect {af.aspect:.2f} differs from the registered {slot.get('ratio', '3:2')}; kept uncropped at text width")
        self.placed[aid] = info
        sc = slot.get("scale") or self.inline_scale.get(aid)
        if self.inline_scale.get(aid):
            sc = min(sc, self.inline_scale[aid])
        if sc and sc < 0.995:      # smaller than the text width: the register asks for it, or it fits into the gap at the foot of the previous page
            return f'<figure class="inline"><img src="{url}" alt="{alt}" style="width:{sc * 100:.1f}%;margin:0 auto"></figure>'
        return f'<figure class="inline"><img src="{url}" alt="{alt}"></figure>'

    # ---------- blocks ------------------------------------------------------
    def render_list(self, items, kind, start=1, cls="") -> str:
        tag = "ol" if kind == "ol" else "ul"
        li = "".join(f"<li>{self.T(i)}</li>" for i in items)
        st = f' style="--start:{start - 1}"' if kind == "ol" and cls == "rules" else ""
        if kind == "ol" and cls != "rules" and start != 1:
            st = f' start="{start}"'
        return f'<{tag} class="{cls}"{st}>{li}</{tag}>'

    def render_block(self, b: Block, sec: Section, first_after_plate=False) -> str:
        k = b.kind
        if k == "p":
            cls = ' class="after-plate"' if first_after_plate else ""
            return f"<p{cls}>{self.T(b.html)}</p>"
        if k == "note":
            return f'<p class="note">{self.T(b.html)}</p>'
        if k == "dateline":
            return f'<p class="dateline">{self.T(b.html)}</p>'
        if k == "notice":
            cls = "notice hand" if self.design.get("notice_hand") and sec.kind in ("chapter", "epilogue", "prologue") else "notice"
            return f'<div class="{cls}">{self.T(b.html)}</div>'
        if k == "poster":
            return '<div class="poster">' + "".join(f"<div>{self.T(l)}</div>" for l in b.items) + "</div>"
        if k == "label":
            return f"<p>{self.T(b.html)}</p>"
        if k == "sound":
            return ""                                 # printed inside the chapter opener
        if k == "card":
            title = strip_tags(b.html).strip()
            rules = b.meta.get("list") == "ol" and title.upper() == title
            lst = self.render_list(b.items, b.meta.get("list", "ul"), b.meta.get("start", 1), "rules" if rules else "")
            nb = self.design.get("nb_cards") and b.meta.get("nb")
            cls = "card nb" + (" long" if len(b.items) > 13 else "") if nb else "card"
            return f'<div class="{cls}"><div class="ct">{self.T(b.html)}</div>{lst}</div>'
        if k == "ol":
            return self.render_list(b.items, "ol", b.meta.get("start", 1), "rules")
        if k == "ul":
            cls = "card nb" if self.design.get("nb_cards") and b.meta.get("nb") else "card"
            return f'<div class="{cls}">{self.render_list(b.items, "ul")}</div>'
        if k == "tail":
            return self.render_tail(b, sec)
        if k == "table":
            return self.render_table(b)
        if k == "h3":
            return f"<h3>{self.T(b.html)}</h3>"
        if k == "hr":
            return ""
        return f"<p>{self.T(b.html)}</p>"

    def render_tail(self, tail: Block, sec: Section) -> str:
        sw = self.book.cfg.get("chapter_swatches", {}).get(sec.id)
        out = []
        for i, x in enumerate(tail.items):
            h = self.render_block(x, sec)
            if i == 0 and sw and x.kind == "label" and strip_tags(x.html).lower().startswith(COLOR_LABELS):
                h = h.replace("<p>", f'<p><span class="sw" style="background:{sw}"></span>', 1)
            out.append(h)
        return f'<div class="tail">{"".join(out)}</div>'

    def render_table(self, b: Block) -> str:
        head, rows = b.items
        cols = b.meta.get("cols", 2)
        kv = head is None and cols == 2
        cls = ' class="kv"' if kv else ""
        t = f"<table{cls}>"
        if head:
            t += "<thead><tr>" + "".join(f"<th>{typo.apply(c, self.lang, hyphenate=False)}</th>" for c in head) + "</tr></thead>"
        t += "<tbody>" + "".join("<tr>" + "".join(f"<td>{self.T(c)}</td>" for c in r) + "</tr>" for r in rows) + "</tbody></table>"
        return t

    # ---------- sections -----------------------------------------------------
    def chapter_pagename(self, sec: Section) -> str:
        return {"prologue": "pr", "epilogue": "ep", "glossary": "gl", "note": "nt"}.get(sec.kind, sec.id.replace("-", ""))

    def render_section(self, sec: Section) -> tuple[str, dict]:
        pg = self.chapter_pagename(sec)
        head = {"id": sec.id, "pg": pg, "head_css": css_str(sec.title)}
        label = esc(strip_tags(sec.label)) if sec.label else ""
        title = self.Th(esc(sec.title))
        orn = self.orn_svg(self.book.palette["plaster"], self.book.palette["kesariya"])
        sound = ""
        if sec.blocks and sec.blocks[0].kind == "sound":
            m = sec.blocks[0].meta
            sound = (f'<div class="sound"><span class="k">{self.T(esc(m["label"]))}</span>'
                     f'<span class="t">{self.T(m["text"])}</span></div>')
        if sec.kind == "chapter":
            num = f'<div class="num">{sec.number}</div>' if self.design.get("opener_num", True) else ""
            op = (f'<header class="opener"><div class="lab">{label}</div>{num}'
                  f'<div class="ttl">{title}</div>' + (f'<div class="date">{self.T(esc(sec.date))}</div>' if sec.date else "")
                  + f"{orn}{sound}</header>")
        elif sec.kind in ("prologue", "epilogue", "glossary", "note"):
            op = (f'<header class="opener plain">' + (f'<div class="lab">{label}</div>' if label else "")
                  + f'<div class="ttl">{title}</div>' + (f'<div class="date">{self.T(esc(sec.date))}</div>' if sec.date else "")
                  + f"{orn}{sound}</header>")
        else:
            op = ""
        # where do illustrations go?
        inserts: dict[int, list[str]] = {}
        flow_marks: dict[int, str] = {}
        for aid, slot in self.slots_for(sec.id):
            idx = self.locate(sec, aid, slot)
            if self.is_page_art(aid, slot):
                if self.flow_mode:      # text-only pass: measure where the blocks after the anchor end
                    stop = len(sec.blocks)
                    if self.design.get("plate_stop_at_notebook"):      # a plate never floats past a notebook page
                        stop = next((i for i in range(idx + 1, len(sec.blocks)) if sec.blocks[i].kind in ("card", "ul", "notice", "poster")), stop)
                    if slot.get("stop"):                                # register: the plate must not move past this paragraph
                        stop = min(stop, self.locate_text(sec, aid, slot["stop"][self.lang]))
                    cands = [i for i in range(idx, min(idx + 70, len(sec.blocks))) if sec.blocks[i].kind in ("p", "card", "ul", "notice")]
                    self.flow_cands[aid] = (sec.id, idx, cands, stop)
                    for i in cands:
                        flow_marks[i] = f"fe-{aid}-{i}"
                    if slot.get("early") and idx > 0 and sec.blocks[idx - 1].kind in ("p", "card", "ul", "notice"):
                        flow_marks.setdefault(idx - 1, f"fe-{aid}-{idx - 1}")      # where does the paragraph before the anchor end?
                    continue
                idx = self.plate_pos.get(aid, idx)
            inserts.setdefault(idx, []).append(self.render_art(aid, slot))
            if aid in self.placed:
                self.placed[aid]["after_block"] = idx
        parts, after_plate = [], False
        cls_extra = " glossary" if sec.kind == "glossary" else (" note-page" if sec.kind == "note" else "")
        body, seg_open = [], False
        for i, b in enumerate(sec.blocks):
            blk = self.render_block(b, sec, first_after_plate=after_plate)
            if i in flow_marks:
                mk = f'<a id="{flow_marks[i]}" style="display:inline-block;width:0;height:0"></a>'
                for tail in ("</li></ul></div>", "</p>", "</div>"):          # end of the last line of the block
                    if blk.endswith(tail):
                        blk = blk[:-len(tail)] + mk + tail
                        self._flow_seen.append(flow_marks[i])
                        break
            body.append(blk)
            after_plate = False
            for art_html in inserts.get(i, []):
                is_page = "plate" in art_html.split(">", 1)[0] or 'class="plate' in art_html[:40]
                if is_page:
                    if seg_open:
                        body.append("</div>")
                        seg_open = False
                    body.append(art_html)
                    if i + 1 < len(sec.blocks):          # nothing after the plate: no empty block (it would make a blank page)
                        body.append('<div class="seg">')
                        seg_open = True
                    after_plate = True
                else:
                    body.append(art_html)
        if seg_open:
            body.append("</div>")
        inner = op + "".join(body)
        pre = self.mark(sec.id, "r") if sec.id in self.faces_part else (self.mark(sec.id, None) if False else "")
        fit = FIT_CLASSES[self.fit.get(sec.id, 0)]
        html = pre + f'<section class="chapter{cls_extra}{(" " + fit) if fit else ""}" id="{sec.id}">{inner}</section>'
        return html, head

    def render_part(self, sec: Section, chapters: list[Section]) -> str:
        orn = self.orn_svg(self.book.palette["kesariya"], self.book.palette["ember"])
        nums = [c.number for c in chapters if c.part_index == sec.number]
        rng = self.S["part_chapters"].format(a=min(nums), b=max(nums)) if nums else ""
        per = ""
        if sec.blocks and sec.blocks[0].kind in ("dateline", "note") and self.design.get("part_period"):
            per = f'<div class="per">{self.T(strip_tags(sec.blocks[0].html))}</div>'
        return (self.mark(sec.id, "v") + f'<section class="partpage" id="{sec.id}"><div class="lab">{esc(strip_tags(sec.label))}</div>'
                f'<div class="big">{self.Th(esc(sec.title))}</div>{orn}{per}<div class="rng">{rng}</div></section>')

    # ---------- front matter -------------------------------------------------
    def front_matter(self, toc_html: str) -> str:
        bk, lang, S = self.book, self.lang, self.S
        series = esc(self.series["names"][lang].upper())
        title = esc(bk.title(lang))
        sub = esc(bk.subtitle(lang))
        orn = self.orn_svg(bk.palette["plaster"], bk.palette["kesariya"])
        pub = self.series["publisher"]
        publisher = esc(pub["name"]) if pub["name"] else self.todo(S["placeholder_publisher"])
        holder = esc(pub.get("copyright_holder") or "") or self.author()
        isbn = bk.cfg["isbn"].get("story" if not self.guide_on else "guide", {}).get(lang, "")
        isbn_html = esc(isbn) if isbn else self.todo(S["placeholder_isbn"])
        year = pub.get("copyright_year", bk.cfg.get("year", 2026))
        note_title = next((s.title for s in self.ms.sections if s.kind == "note"), "")
        edition = S["guide_ed"] if self.guide_on else S["story_ed"]
        site = self.series["site"]["url"]
        ht = (self.mark("halftitle", "r") + f'<section class="front halftitle" id="halftitle"><div class="series">{series}</div>'
              f'<div class="ttl">{title}</div></section>')
        blank = ""
        tp = (self.mark("titlepage", "r") + f'<section class="front titlepage" id="titlepage"><div class="series">{series}</div>{orn}'
              f'<div class="ttl">{title}</div><div class="sub">{sub}</div><div class="by">{self.author()}</div>'
              f'<div class="pub">{publisher}</div></section>')
        cp = (self.mark("copyright", "v") + f'<section class="front verso" id="copyright"><div class="copyright"><p>© {year} {holder}. {S["rights"]}</p>'
              f'<p>{esc(S["fiction"].format(note=note_title))}</p>'
              f'<p>{esc(S["printed"].format(year=year))} · {esc(edition)}</p>'
              f'<p>{S["isbn"]} {isbn_html}</p>'
              + (f'<p>{esc(site)}</p>' if site else '')
              + '</div></section>')
        return ht + blank + tp + cp + toc_html + self.anchor_index()

    def toc(self, with_pages: bool) -> str:
        S, rows = self.S, []
        pn = lambda key: (str(self.toc_pages.get(key, "")) if with_pages else "00")

        def row(sec_id, num, title, cls=""):
            n = f'<span class="n">{num}</span>' if num else '<span class="n"></span>'
            return (f'<a class="row {cls}" href="#{sec_id}">{n}<span class="t">{self.Th(esc(title))}</span>'
                    f'<span class="dots"></span><span class="pg">{pn(sec_id)}</span></a>')

        for sec in self.ms.sections:
            if sec.kind == "prologue":
                rows.append(row(sec.id, "", sec.title, "plain"))
            elif sec.kind == "part":
                rows.append(f'<a class="part" href="#{sec.id}">{esc(strip_tags(sec.label))} · {esc(sec.title)}</a>')
            elif sec.kind == "chapter":
                rows.append(row(sec.id, sec.number, sec.title))
            elif sec.kind == "epilogue":
                rows.append('<div class="part">&nbsp;</div>' + row(sec.id, "", sec.title, "plain"))
            elif sec.kind in ("glossary", "note"):
                rows.append(row(sec.id, "", sec.title, "plain"))
        if self.guide_on:
            rows.append(f'<div class="part">&nbsp;</div>' + row("guide", "", S["guide"], "plain"))
        rows.append(row("endpage", "", S["series_page"], "plain"))
        dense = " dense" if len(rows) > 30 else ""
        return self.mark("toc", "r") + f'<section class="toc{dense}" id="toc"><h2>{esc(S["contents"])}</h2>{"".join(rows)}</section>'

    # ---------- guide ---------------------------------------------------------
    def render_guide(self) -> str:
        g = self.guide
        S = self.S
        care = " has-care" if g.before else ""
        out = [self.mark("guide", "r") + f'<section class="guide-title{care}" id="guide"><div class="lab">{esc(self.series["names"][self.lang])}</div>'
               f'<div class="big">{esc(S["guide"])}</div>'
               f'<div class="sub">{self.T(g.intro) if g.intro else ""}</div>'
               f'<div class="warn">{esc(S["spoiler"])}</div>'
               + "".join(f'<div class="care">{self.T(x)}</div>' for x in g.before) + '</section>']
        fit = FIT_CLASSES[self.fit.get("guide", 0)]
        body = [f'<section class="guide{(" " + fit) if fit else ""}">']
        first = True
        for s in g.sections:
            if s.kind == "guide-facts":
                body.append(self.render_table(s.blocks[0]))
                continue
            gn = f'<span class="gn">{s.number}</span>' if s.number else ""
            body.append(f'<h2 class="{"first" if first else ""}">{gn}{self.Th(esc(s.title))}</h2>')
            first = False
            for b in s.blocks:
                if s.title.lower().startswith(("words from", "quelques mots", "les mots", "palabras")) and b.kind == "table":
                    cols = b.meta.get("cols", 3)
                    body.append(self.render_table(b).replace("<table", f'<table class="gloss{" gloss4" if cols == 4 else ""}"', 1))
                elif b.kind in ("ul", "ol"):
                    body.append(show_urls(self.render_list(b.items, b.kind, b.meta.get("start", 1), "src" if not s.number and b.kind == "ul" else "")))
                elif b.kind == "p":
                    html = show_urls(self.T(b.html))
                    cls = ""
                    body.append(f"<p{cls}>{html}</p>")
                else:
                    body.append(self.render_block(b, s))
        body.append("</section>")
        return "".join(out) + "".join(body)

    # ---------- series end page ------------------------------------------------
    def end_page(self) -> str:
        S, lang = self.S, self.lang
        items = []
        for e in load_project().catalog():
            name = f'{e["book"].title(lang)}: {e["book"].subtitle(lang)}' if e["book"] else e["upcoming"]["titles"][lang]
            items.append(f'<div class="it"><em>{esc(name)}</em></div>')
        site = self.series["site"]["url"]
        return (f'<section class="endpage" id="endpage"><h3>{esc(self.series["names"][lang])}</h3>'
                f'<div class="it" style="font-style:italic">{esc(self.series["descriptions"][lang])}</div>'
                + "".join(items)
                + (f'<div class="it"><small>{esc(S["web"])} · {esc(site)}</small></div>' if site else "")
                + "</section>")

    def anchor_index(self) -> str:
        """1px invisible links to every parity-constrained id (Chromium only emits destinations that are linked)."""
        ids = self._all_ids + (self._flow_ids if self.flow_mode else [])
        links = "".join(f'<a href="#{i}" style="display:block;width:1px;height:1px"></a>' for i in ids)
        return f'<div style="position:absolute;left:0;top:0;width:1px;height:{max(1, len(ids))}px;overflow:hidden">{links}</div>'

    # ---------- assemble -------------------------------------------------------
    def build_html(self, with_pages: bool) -> tuple[str, list[dict]]:
        self.constraints = []
        self._flow_ids, self._flow_seen = self._flow_seen, []
        chapters = self.ms.chapters()
        pieces, heads = [], []
        for sec in self.ms.sections:
            if sec.kind == "part":
                pieces.append(self.render_part(sec, chapters))
                continue
            html, head = self.render_section(sec)
            pieces.append(html)
            heads.append(head)
        if self.guide_on:
            pieces.append(self.render_guide())
        pieces.append(self.end_page())
        front = self.front_matter(self.toc(with_pages))  # uses self._all_ids from the previous emission
        env = Environment(loader=FileSystemLoader(str(TEMPLATES)), autoescape=False)
        G = self.geo
        css = env.get_template("print.css.j2").render(
            fonts=patched_fonts_dir().resolve().as_uri(), pal=self.book.palette, body_pt=self.book.cfg["print"]["body_pt"],
            leading=self.book.cfg["print"]["leading"], PW=G.PW, PH=G.PH, text_h=G.text_h,
            m_top=round(G.b + G.top, 4), m_bot=round(G.b + G.bottom, 4),
            m_out_r=round(G.b_out + G.outer, 4), m_in_r=round(G.b_in + G.inner, 4),
            m_in_l=round(G.b_in + G.inner, 4), m_out_l=round(G.b_out + G.outer, 4),
            opener_top=1.25, chapters=heads, book_title_css=css_str(self.book.title(self.lang).upper()),
            design=self.design, hand=self.design.get("hand", True), note_pt=self.note_pt())
        doc = (f'<!doctype html><html lang="{self.lang}"><head><meta charset="utf-8">'
               f'<title>{esc(self.book.title(self.lang))}</title><style>{css}</style></head><body>{front}{"".join(pieces)}</body></html>')
        return doc, heads

    OVERFLOW_JS = """(w) => { const out = [];
        for (const el of document.querySelectorAll('body *')) {
          if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible')
            out.push((el.tagName + '.' + el.className).slice(0, 40) + ' → ' + (el.textContent || '').trim().slice(0, 50));
        }
        return [document.documentElement.scrollWidth, out.slice(0, 6)]; }"""

    def render_pdf(self, html: str, pdf_path: Path) -> None:
        html_path = pdf_path.with_suffix(".html")
        html_path.write_text(html, encoding="utf-8")
        with sync_playwright() as p:
            br = launch(p)
            pw_px = round(self.geo.PW * 96)
            pg = br.new_page(viewport={"width": pw_px, "height": round(self.geo.PH * 96)})
            pg.emulate_media(media="print")
            pg.goto(html_path.resolve().as_uri(), wait_until="load")
            pg.evaluate("document.fonts.ready")
            # Chromium silently shrinks the WHOLE document when any content is wider than the page; never let that happen
            width, offenders = pg.evaluate(self.OVERFLOW_JS, pw_px)
            if width > pw_px + 1:
                raise SystemExit(f"[{self.lang}-{self.edition}] content is {width}px wide on a {pw_px}px page; Chromium would shrink every page. "
                                 "Offending elements:\n  " + "\n  ".join(offenders))
            pg.wait_for_timeout(400)
            pg.pdf(path=str(pdf_path), prefer_css_page_size=True, print_background=True,
                   display_header_footer=False, margin={"top": "0", "right": "0", "bottom": "0", "left": "0"})
            br.close()

    # ---------- page classification, furniture overlay ---------------------------
    @staticmethod
    def read_dests(pdf_path: Path) -> dict[str, int]:
        """Named destinations referenced by the contents links -> 0-based page index."""
        out: dict[str, int] = {}
        doc = fitz.open(pdf_path)
        for page in doc:
            for l in page.get_links():
                name = l.get("nameddest")
                if name and l.get("page", -1) >= 0:
                    out[name] = l["page"]
        doc.close()
        return out

    @staticmethod
    def read_dests_xy(pdf_path: Path) -> dict[str, tuple[int, float]]:
        """Named destinations -> (0-based page, distance of the target from the top of the page in pt)."""
        out: dict[str, tuple[int, float]] = {}
        doc = fitz.open(pdf_path)
        H = doc[0].rect.height
        for page in doc:
            for l in page.get_links():
                name, pg, to = l.get("nameddest"), l.get("page", -1), l.get("to")
                if name and pg >= 0 and to is not None:
                    out[name] = (pg, H - to.y)
        doc.close()
        return out

    def fill_of(self, y_top_pt: float) -> float:
        """How full the text area is, 0..1, when the last line's baseline sits y_top_pt below the page top."""
        G = self.geo
        pr = self.book.cfg["print"]
        line = pr["body_pt"] * pr["leading"]
        top = (G.b + G.top) * 72
        return max(0.0, min(1.0, (y_top_pt - top + 0.3 * line) / (G.text_h * 72)))

    def plate_candidates(self, aid: str) -> list[tuple[int, int, float]]:
        """(block index, end page, fill of that page) for every block the plate could follow."""
        _, _, cands, _ = self.flow_cands[aid]
        out = []
        for i in cands:
            k = self.flow_xy.get(f"fe-{aid}-{i}")
            if k:
                out.append((i, k[0], self.fill_of(k[1])))
        return out

    def pick_on_page(self, aid: str, page: int, near_only: bool = True):
        """Fullest candidate that ends on `page`; near_only keeps the plate before the next notebook page."""
        stop = self.flow_cands[aid][3]
        on = [c for c in self.plate_candidates(aid) if c[1] == page and (c[0] < stop or not near_only)]
        return max(on, key=lambda c: (c[2], c[0])) if on else None

    def plan_plates(self) -> None:
        """Choose, for every plate/spread, the block after which it goes.

        Text is first laid out without them; the plate then follows the last block that still fits on the
        page that ends the anchor paragraph. If that page would stay mostly empty, the next page is used."""
        self.plate_pos = {}
        if not any(self.is_page_art(a, s) for a, s in self.book.register["slots"].items()):
            return
        self.flow_mode, self.flow_cands = True, {}
        self._flow_seen, self._flow_ids = [], []
        self.build_html(False)
        html, _ = self.build_html(False)
        flow = self.out_dir / "flow.pdf"
        self.render_pdf(html, flow)
        self.flow_xy = self.read_dests_xy(flow)
        self.flow_mode = False
        for aid, (_, idx, _, _) in self.flow_cands.items():
            cs = self.plate_candidates(aid)
            if not cs:
                self.plate_pos[aid] = idx
                continue
            pa = cs[0][1]
            slot = self.book.register["slots"][aid]
            prev = self.flow_xy.get(f"fe-{aid}-{idx - 1}") if slot.get("early") else None
            if prev and prev[0] < pa and self.fill_of(prev[1]) >= 0.85:
                self.plate_pos[aid] = idx - 1      # "early": the anchor paragraph starts a page, so the plate stands at the page turn just before it
                continue
            best = self.pick_on_page(aid, pa)
            mf = slot.get("min_fill", 0.70)    # register "min_fill": how full the page before a plate must be (one number or {lang: number})
            mf = float(mf.get(self.lang, 0.70) if isinstance(mf, dict) else mf)
            if best and best[2] >= mf:
                self.plate_pos[aid] = best[0]
                continue
            nxt = self.pick_on_page(aid, pa + 1)
            if nxt and nxt[2] >= 0.82:
                self.plate_pos[aid] = nxt[0]
                continue
            far = self.pick_on_page(aid, pa, near_only=False)   # last resort: float past a notebook page
            if far and (not best or far[2] > best[2] + 0.02):
                self.plate_pos[aid] = far[0]                    # e.g. the chapter's closing notebook page stays before the plate
            else:
                self.plate_pos[aid] = best[0] if best else idx

    def classify(self, doc, dests: dict[str, int]) -> list[dict]:
        N = len(doc)
        opener_ids = {s.id for s in self.ms.sections if s.kind in ("chapter", "prologue", "epilogue", "glossary", "note")}
        first_open = min(dests[k] for k in dests if k in opener_ids)
        order = sorted((p, k) for k, p in dests.items())
        titles = {s.id: s.title for s in self.ms.sections}
        titles["guide"] = self.S["guide"]
        info = []
        cur = None
        starts = {}
        for p, k in order:
            starts.setdefault(p, k)
        for i in range(N):
            if i in starts:
                cur = starts[i]
            page = doc[i]
            txt = page.get_text("text").strip()
            imgs = page.get_image_info()
            area = page.rect.width * page.rect.height
            covers = any(((b["bbox"][2] - b["bbox"][0]) * (b["bbox"][3] - b["bbox"][1])) >= 0.85 * area for b in imgs)
            d = {"i": i, "kind": "body", "sec": cur, "head": None}
            if covers or (imgs and not txt):
                d["kind"] = "plate"
            elif not txt and not imgs:
                d["kind"] = "blank"
            elif i < first_open:
                d["kind"] = "front"
            elif cur and cur.startswith("part-"):
                d["kind"] = "part"
            elif cur == "endpage":
                d["kind"] = "end"
            elif cur == "guide" and starts.get(i) == "guide":
                d["kind"] = "guide-title"
            elif starts.get(i) in opener_ids:
                d["kind"] = "opener"
            d["head"] = titles.get(cur)
            info.append(d)
        return info

    def furniture_html(self, info: list[dict]) -> str:
        G = self.geo
        env = Environment(loader=FileSystemLoader(str(TEMPLATES)), autoescape=False)
        css = env.get_template("print.css.j2").render(
            fonts=patched_fonts_dir().resolve().as_uri(), pal=self.book.palette, body_pt=11, leading=1.5, PW=G.PW, PH=G.PH,
            text_h=G.text_h, m_top=0, m_bot=0, m_out_r=0, m_in_r=0, m_in_l=0, m_out_l=0, opener_top=1, chapters=[],
            book_title_css="", design=self.design, hand=self.design.get("hand", True), note_pt=self.note_pt())
        pages = []
        book_title = esc(self.book.title(self.lang))
        for d in info:
            n = d["i"] + 1
            recto = n % 2 == 1
            left = (G.b_in + G.inner) if recto else (G.b_out + G.outer)
            right = G.PW - ((G.b_out + G.outer) if recto else (G.b_in + G.inner))
            head, folio = "", ""
            if d["kind"] in ("body", "opener"):
                folio = f'<div class="fo" style="{"right" if recto else "left"}:{(G.PW - right) if recto else left:.4f}in">{n}</div>'
            if d["kind"] == "body":
                txt = book_title if not recto else esc(d["head"] or "")
                head = f'<div class="hd" style="{"right" if recto else "left"}:{(G.PW - right) if recto else left:.4f}in">{txt}</div>'
            pages.append(f'<div class="pg">{head}{folio}</div>')
        return (f'<!doctype html><html lang="{self.lang}"><head><meta charset="utf-8"><style>{css}\n'
                f'@page{{size:{G.PW}in {G.PH}in;margin:0}} body{{margin:0}}'
                f'.pg{{position:relative;width:{G.PW}in;height:{G.PH}in;break-after:page;overflow:hidden}}'
                f'.hd{{position:absolute;top:{G.b + 0.36:.3f}in;font:600 7.4pt "Nunito Sans";letter-spacing:.16em;text-transform:uppercase;color:#805F4D;white-space:nowrap}}'
                f'.fo{{position:absolute;bottom:{G.b + 0.36:.3f}in;font:700 8.8pt "Nunito Sans";color:#805F4D}}'
                f'</style></head><body>{"".join(pages)}</body></html>')

    def finish_pdf(self, raw: Path, final: Path, dests: dict[str, int]) -> int:
        doc = fitz.open(raw)
        if len(doc) % 2:
            doc.insert_page(len(doc), width=doc[0].rect.width, height=doc[0].rect.height)
        info = self.classify(doc, dests)
        fh = self.out_dir / "furniture.html"
        fh.write_text(self.furniture_html(info), encoding="utf-8")
        fpdf = self.out_dir / "furniture.pdf"
        self.render_pdf_file(fh, fpdf)
        fd = fitz.open(fpdf)
        if len(fd) < len(doc):
            raise SystemExit(f"furniture overlay has {len(fd)} pages for {len(doc)}")
        for i, page in enumerate(doc):
            if info[i]["kind"] in ("body", "opener"):
                page.show_pdf_page(page.rect, fd, i, overlay=True)
        # metadata + outline
        meta = {"title": f'{self.book.title(self.lang)}: {self.book.subtitle(self.lang)}',
                "author": self.series.get("author", {}).get("name", ""),
                "subject": self.book.cfg["short_descriptions"][self.lang],
                "keywords": ", ".join(self.book.cfg["keywords"][self.lang]), "creator": "My Corner of the World build"}
        doc.set_metadata(meta)
        toc = []
        for s in self.ms.sections:
            if s.id in dests:
                lvl = 2 if s.kind == "chapter" else 1
                lab = (f"{s.number}. " if s.kind == "chapter" else "") + s.title
                if s.kind == "part":
                    lab = f"{strip_tags(s.label)} · {s.title}"
                toc.append([lvl, lab, dests[s.id] + 1])
        if self.guide_on and "guide" in dests:
            toc.append([1, self.S["guide"], dests["guide"] + 1])
        # outline must start at level 1 and never jump levels
        clean, prev = [], 0
        for lvl, t, pg in toc:
            lvl = min(lvl, prev + 1) if prev else 1
            clean.append([lvl, t, pg]); prev = lvl
        doc.set_toc(clean)
        tmp = final.with_suffix(".tmp.pdf")
        doc.save(tmp, garbage=4, deflate=True)
        n = len(doc)
        doc.close()
        shutil.move(tmp, final)
        self.page_info = info
        return n

    def render_pdf_file(self, html_path: Path, pdf_path: Path) -> None:
        with sync_playwright() as p:
            br = launch(p)
            pg = br.new_page()
            pg.goto(html_path.resolve().as_uri(), wait_until="load")
            pg.evaluate("document.fonts.ready")
            pg.wait_for_timeout(300)
            pg.pdf(path=str(pdf_path), prefer_css_page_size=True, print_background=True,
                   display_header_footer=False, margin={"top": "0", "right": "0", "bottom": "0", "left": "0"})
            br.close()

    def solve_spacers(self, dests: dict[str, int]) -> set[str]:
        """Walk the parity constraints in document order; add one blank page wherever parity is wrong.

        Pages between constrained elements never change length when a spacer is added upstream, so a
        single base render is enough: final_page(e) = base_page(e) + spacers_inserted_before(e).
        """
        shift, out = 0, set()
        ordered = sorted((c for c in self.constraints if c[0] in dests), key=lambda c: dests[c[0]])
        for eid, parity in ordered:
            page_no = dests[eid] + 1 + shift          # 1-based, final
            is_recto = page_no % 2 == 1
            if (parity == "r") != is_recto:
                out.add(eid)
                shift += 1
        return out

    def inline_gap_fixes(self, pdf: Path) -> dict[str, float]:
        """Inline pictures that start a page while the previous page ends well short: scale them to fill that gap.

        (An inline picture is never split, so one that does not fit moves whole to the next page.) Only done when the
        picture stays at least 62 % of the text width; otherwise the gap is accepted."""
        inline = [a for a, i in self.placed.items() if i.get("mode") == "inline"]
        order = {a: n for n, a in enumerate(self.book.register["slots"])}
        inline.sort(key=lambda a: order[a])
        G = self.geo
        top_pt = (G.b + G.top) * 72
        bot_pt = (G.b + G.top + G.text_h) * 72
        doc = fitz.open(pdf)
        found = []
        for i, pg in enumerate(doc):
            for im in pg.get_images(full=True):
                for r in pg.get_image_rects(im[0]):
                    if r.width > 0.5 * (G.PW * 72 - 2 * (G.b + G.inner) * 72 + 1) and r.height < 0.6 * pg.rect.height and r.width * r.height < 0.5 * pg.rect.width * pg.rect.height:
                        found.append((i, r))
        found.sort(key=lambda t: (t[0], t[1].y0))
        fixes: dict[str, float] = {}
        if len(found) != len(inline):
            doc.close()
            return fixes
        for aid, (i, r) in zip(inline, found):
            if i == 0 or r.y0 > top_pt + 30:         # does not start a page
                continue
            prev = doc[i - 1]
            body = [w for w in prev.get_text("words") if top_pt - 5 < w[1] < bot_pt]
            if not body:
                continue
            text_bottom = max(w[3] for w in body)
            gap = bot_pt - text_bottom
            h = r.height
            if gap < 0.2 * (bot_pt - top_pt):
                continue
            scale = (gap - 30) / h
            if scale >= 0.62:
                fixes[aid] = min(scale, 0.98)
        doc.close()
        return fixes

    def copyfit(self, raw: Path, dests: dict[str, int], final: bool = False) -> bool:
        """Chapters whose last text page holds only a few lines get their tracking nudged (tighter first, then looser)
        so that the last line(s) are pulled back, or enough lines are pushed over to make a real last page.
        Returns True when some chapter changed level (the book is then laid out again)."""
        doc = fitz.open(raw)
        info = self.classify(doc, dests)
        G = self.geo
        top_pt = (G.b + G.top) * 72
        text_h_pt = G.text_h * 72
        changed = False
        units = [s.id for s in self.ms.sections if s.kind in ("chapter", "prologue", "epilogue", "glossary", "note")] + (["guide"] if self.guide_on else [])
        for sid in units:
            pages = [d["i"] for d in info if d["sec"] == sid and d["kind"] in ("body", "opener", "guide-title")]
            if len(pages) < 2:
                continue
            pg = doc[pages[-1]]
            bottoms = [l["bbox"][3] for b in pg.get_text("dict")["blocks"] if b["type"] == 0 for l in b["lines"]
                       if top_pt - 3 <= l["bbox"][1] <= top_pt + text_h_pt]
            bottoms += [r.y1 for im in pg.get_images(full=True) for r in pg.get_image_rects(im[0]) if r.width < pg.rect.width * 0.95]
            fill = ((max(bottoms) - top_pt) / text_h_pt) if bottoms else 0.0
            if fill < RUNT_FILL:
                lvl = self.fit.get(sid, 0)
                if lvl + 1 < len(FIT_CLASSES) and not final:
                    self.fit[sid] = lvl + 1
                    changed = True
                else:
                    self.warnings.append(f"{sid}: the last text page stays short ({fill:.0%} full) after copy-fitting")
        doc.close()
        return changed

    def build(self) -> dict:
        # base render (no spacers) to learn where every constrained element starts
        self.spacers = set()
        self._all_ids = []
        self.plan_plates()
        html0, _ = self.build_html(with_pages=False)          # first emission fills self.constraints
        self._all_ids = [e for e, _ in self.constraints]
        html0, _ = self.build_html(with_pages=False)          # second emission now carries the anchor index
        base = self.out_dir / "base.pdf"
        self.render_pdf(html0, base)
        d0 = self.read_dests(base)
        self.spacers = self.solve_spacers(d0)
        # a spread that would need a blank page in front of it moves to the next page break instead
        for _ in range(2):
            moved = False
            for aid in [a for a in self.flow_cands if f"fig-{a}" in self.spacers]:
                cs = self.plate_candidates(aid)
                if not cs:
                    continue
                alt = self.pick_on_page(aid, cs[0][1] + 1)
                if alt and alt[0] != self.plate_pos[aid] and alt[2] >= 0.70:
                    self.plate_pos[aid] = alt[0]
                    moved = True
            if not moved:
                break
            self.spacers = set()
            self._all_ids = []
            self.build_html(with_pages=False)
            self._all_ids = [e for e, _ in self.constraints]
            html0, _ = self.build_html(with_pages=False)
            self.render_pdf(html0, base)
            d0 = self.read_dests(base)
            self.spacers = self.solve_spacers(d0)
        html1, _ = self.build_html(with_pages=False)
        pdf1 = self.out_dir / "pass1.pdf"
        self.render_pdf(html1, pdf1)
        d1 = self.read_dests(pdf1)
        self.toc_pages = {k: v + 1 for k, v in d1.items()}
        html2, _ = self.build_html(with_pages=True)
        raw = self.out_dir / "pass2.pdf"
        self.render_pdf(html2, raw)
        d2 = self.read_dests(raw)
        bad = [e for e, par in self.constraints if e in d2 and ((d2[e] + 1) % 2 == 1) != (par == "r")]
        if bad:
            self.warnings.append("parity not satisfied for: " + ", ".join(bad))
        final = self.out_dir / f"{self.book.slug}_{self.lang}_{self.edition}_interior.pdf"
        if self.design.get("copyfit") and self.copyfit(raw, d2, final=self.fit_round >= FIT_ROUNDS):
            self.fit_round += 1
            self.inline_scale, self._second_pass, self.warnings = {}, False, []
            return self.build()
        if not self._second_pass:
            fix = self.inline_gap_fixes(raw)
            if fix:                                   # one more full build with the pictures that left a gap shrunk to fit
                self.inline_scale.update(fix)
                self._second_pass = True
                self.warnings = [w for w in self.warnings]
                return self.build()
        n = self.finish_pdf(raw, final, d2)
        return {"pdf": final, "pages": n, "toc": {k: v + 1 for k, v in d2.items()}, "warnings": sorted(set(self.warnings)),
                "placed": self.placed, "spacers": sorted(self.spacers)}
