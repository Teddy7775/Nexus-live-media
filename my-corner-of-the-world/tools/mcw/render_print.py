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

COLOR_LABELS = ("color of the day", "couleur du jour", "color del día")


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
        self.guide_on = edition == "guide"
        self.ms: Manuscript = book.manuscript(lang)
        self.guide = book.guide(lang) if self.guide_on else None
        self.art = Art(book)
        self.geo = geometry(book)
        self.S = STR[lang]
        self.series = book.series
        self.warnings: list[str] = []
        self.placed: dict[str, dict] = {}
        self.toc_pages: dict[str, int] = {}
        self.out_dir = BUILD / book.slug / "print" / f"{lang}-{edition}"
        self.out_dir.mkdir(parents=True, exist_ok=True)

    # ---------- helpers ---------------------------------------------------
    def T(self, html: str) -> str:
        return typo.apply(html, self.lang, hyphenate=True)

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
                return (f'<div class="plate missing spread-l"><div>{esc(label)}<br>[spread · left page]</div></div>'
                        f'<div class="plate missing spread-r"><div>{esc(label)}<br>[spread · right page]</div></div>')
            if kind == "full":
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
            html = (f'<div class="plate spread-l"><img src="{url}" alt="{alt}" style="{style(left_off)}"></div>'
                    f'<div class="plate spread-r"><img src="{url}" alt="" style="{style(right_off)}"></div>')
            if img_h < G.PH * 0.9:
                self.warnings.append(f"{aid}: supplied aspect {af.aspect:.2f} is wider than the 4:3 slot; "
                                     f"placed as a top-bleed band ({img_h:.1f} in tall of {G.PH:.2f}). Supply 4:3 for a full spread.")
            self.placed[aid] = info
            return html
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
        if kind == "half" and abs(af.aspect - 1.5) > 0.2:
            self.warnings.append(f"{aid}: aspect {af.aspect:.2f} differs from 3:2; kept uncropped at text width")
        self.placed[aid] = info
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
            return f'<div class="notice">{self.T(b.html)}</div>'
        if k == "poster":
            return '<div class="poster">' + "".join(f"<div>{self.T(l)}</div>" for l in b.items) + "</div>"
        if k == "label":
            return f"<p>{self.T(b.html)}</p>"
        if k == "card":
            title = strip_tags(b.html).strip()
            rules = b.meta.get("list") == "ol" and title.upper() == title
            lst = self.render_list(b.items, b.meta.get("list", "ul"), b.meta.get("start", 1), "rules" if rules else "")
            return f'<div class="card"><div class="ct">{self.T(b.html)}</div>{lst}</div>'
        if k == "ol":
            return self.render_list(b.items, "ol", b.meta.get("start", 1), "rules")
        if k == "ul":
            return f'<div class="card">{self.render_list(b.items, "ul")}</div>'
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
            t += "<thead><tr>" + "".join(f"<th>{self.T(c)}</th>" for c in head) + "</tr></thead>"
        t += "<tbody>" + "".join("<tr>" + "".join(f"<td>{self.T(c)}</td>" for c in r) + "</tr>" for r in rows) + "</tbody></table>"
        return t

    # ---------- sections -----------------------------------------------------
    def chapter_pagename(self, sec: Section) -> str:
        return {"prologue": "pr", "epilogue": "ep", "glossary": "gl", "note": "nt"}.get(sec.kind, sec.id.replace("-", ""))

    def render_section(self, sec: Section) -> tuple[str, dict]:
        pg = self.chapter_pagename(sec)
        head = {"id": sec.id, "pg": pg, "head_css": css_str(sec.title)}
        label = esc(strip_tags(sec.label)) if sec.label else ""
        title = self.T(esc(sec.title))
        orn = ORN_SVG.format(c=self.book.palette["plaster"], k=self.book.palette["kesariya"])
        if sec.kind == "chapter":
            op = (f'<header class="opener"><div class="lab">{label}</div><div class="num">{sec.number}</div>'
                  f'<div class="ttl">{title}</div>' + (f'<div class="date">{esc(sec.date)}</div>' if sec.date else "")
                  + f"{orn}</header>")
        elif sec.kind in ("prologue", "epilogue", "glossary", "note"):
            op = (f'<header class="opener plain">' + (f'<div class="lab">{label}</div>' if label else "")
                  + f'<div class="ttl">{title}</div>' + (f'<div class="date">{esc(sec.date)}</div>' if sec.date else "")
                  + f"{orn}</header>")
        else:
            op = ""
        # where do illustrations go?
        inserts: dict[int, list[str]] = {}
        for aid, slot in self.slots_for(sec.id):
            idx = self.locate(sec, aid, slot)
            inserts.setdefault(idx, []).append(self.render_art(aid, slot))
        parts, after_plate = [], False
        cls_extra = " glossary" if sec.kind == "glossary" else (" note-page" if sec.kind == "note" else "")
        body, seg_open = [], False
        for i, b in enumerate(sec.blocks):
            body.append(self.render_block(b, sec, first_after_plate=after_plate))
            after_plate = False
            for art_html in inserts.get(i, []):
                is_page = "plate" in art_html.split(">", 1)[0] or 'class="plate' in art_html[:40]
                if is_page:
                    if seg_open:
                        body.append("</div>")
                        seg_open = False
                    body.append(art_html)
                    body.append(f'<div class="seg" style="page:{pg}x">')
                    seg_open = True
                    after_plate = True
                else:
                    body.append(art_html)
        if seg_open:
            body.append("</div>")
        inner = op + "".join(body)
        html = f'<section class="chapter{cls_extra}" id="{sec.id}" style="page:{pg}">{inner}</section>'
        return html, head

    def render_part(self, sec: Section, chapters: list[Section]) -> str:
        orn = ORN_SVG.format(c=self.book.palette["kesariya"], k=self.book.palette["ember"])
        nums = [c.number for c in chapters if c.part_index == sec.number]
        rng = self.S["part_chapters"].format(a=min(nums), b=max(nums)) if nums else ""
        return (f'<section class="partpage" id="{sec.id}"><div class="lab">{esc(strip_tags(sec.label))}</div>'
                f'<div class="big">{self.T(esc(sec.title))}</div>{orn}<div class="rng">{rng}</div></section>')

    # ---------- front matter -------------------------------------------------
    def front_matter(self, toc_html: str) -> str:
        bk, lang, S = self.book, self.lang, self.S
        series = esc(self.series["names"][lang].upper())
        title = esc(bk.title(lang))
        sub = esc(bk.subtitle(lang))
        orn = ORN_SVG.format(c=bk.palette["plaster"], k=bk.palette["kesariya"])
        pub = self.series["publisher"]
        publisher = esc(pub["name"]) if pub["name"] else self.todo(S["placeholder_publisher"])
        holder = esc(pub.get("copyright_holder") or "") or self.author()
        isbn = bk.cfg["isbn"].get("story" if not self.guide_on else "guide", {}).get(lang, "")
        isbn_html = esc(isbn) if isbn else self.todo(S["placeholder_isbn"])
        year = pub.get("copyright_year", bk.cfg.get("year", 2026))
        note_title = next((s.title for s in self.ms.sections if s.kind == "note"), "")
        edition = S["guide_ed"] if self.guide_on else S["story_ed"]
        site = self.series["site"]["url"]
        ht = f'<section class="front halftitle"><div class="series">{series}</div><div class="ttl">{title}</div></section>'
        blank = '<section class="front verso" style="page:blank"></section>'
        tp = (f'<section class="front titlepage"><div class="series">{series}</div>{orn}'
              f'<div class="ttl">{title}</div><div class="sub">{sub}</div><div class="by">{self.author()}</div>'
              f'<div class="pub">{publisher}</div></section>')
        cp = (f'<section class="front verso"><div class="copyright"><p>© {year} {holder}. {S["rights"]}</p>'
              f'<p>{esc(S["fiction"].format(note=note_title))}</p>'
              f'<p>{esc(S["printed"].format(year=year))} · {esc(edition)}</p>'
              f'<p>{S["isbn"]} {isbn_html}</p>'
              + (f'<p>{esc(site)}</p>' if site else '')
              + '</div></section>')
        return ht + blank + tp + cp + toc_html

    def toc(self, with_pages: bool) -> str:
        S, rows = self.S, []
        chapters = self.ms.chapters()
        pn = lambda key: (str(self.toc_pages.get(key, "")) if with_pages else "00")
        def row(sec_id, num, title, cls=""):
            n = f'<span class="n">{num}</span>' if num else '<span class="n"></span>'
            return (f'<div class="row {cls}">{n}<span class="t">{self.T(esc(title))}</span><span class="dots"></span>'
                    f'<span class="pg">{pn(sec_id)}</span></div>')
        for sec in self.ms.sections:
            if sec.kind == "prologue":
                rows.append(row(sec.id, "", sec.title, "plain"))
            elif sec.kind == "part":
                rows.append(f'<div class="part">{esc(strip_tags(sec.label))} · {esc(sec.title)}</div>')
            elif sec.kind == "chapter":
                rows.append(row(sec.id, sec.number, sec.title))
            elif sec.kind in ("epilogue",):
                rows.append(f'<div class="part">&nbsp;</div>' + row(sec.id, "", sec.title, "plain"))
            elif sec.kind in ("glossary", "note"):
                rows.append(row(sec.id, "", sec.title, "plain"))
        if self.guide_on:
            rows.append(f'<div class="part">{esc(S["guide"])}</div>')
            rows.append(row("guide", "", S["guide"], "plain"))
        return f'<section class="toc"><h2>{esc(S["contents"])}</h2>{"".join(rows)}</section>'

    # ---------- guide ---------------------------------------------------------
    def render_guide(self) -> str:
        g = self.guide
        S = self.S
        out = [f'<section class="guide-title" id="guide"><div class="lab">{esc(self.series["names"][self.lang])}</div>'
               f'<div class="big">{esc(S["guide"])}</div>'
               f'<div class="sub">{self.T(g.intro) if g.intro else ""}</div>'
               f'<div class="warn">{esc(S["spoiler"])}</div></section>']
        body = ['<section class="guide">']
        first = True
        for s in g.sections:
            if s.kind == "guide-facts":
                body.append(self.render_table(s.blocks[0]))
                continue
            gn = f'<span class="gn">{s.number}</span>' if s.number else ""
            body.append(f'<h2 class="{"first" if first else ""}">{gn}{self.T(esc(s.title))}</h2>')
            first = False
            for b in s.blocks:
                if s.title.lower().startswith(("words from", "quelques mots", "palabras")) and b.kind == "table":
                    body.append(self.render_table(b).replace("<table", '<table class="gloss"', 1))
                elif b.kind in ("ul", "ol"):
                    body.append(self.render_list(b.items, b.kind, b.meta.get("start", 1)))
                elif b.kind == "p":
                    html = self.T(b.html)
                    cls = ""
                    body.append(f"<p{cls}>{html}</p>")
                else:
                    body.append(self.render_block(b, s))
        body.append("</section>")
        return "".join(out) + "".join(body)

    # ---------- series end page ------------------------------------------------
    def end_page(self) -> str:
        S, lang = self.S, self.lang
        items = [f'<div class="it"><em>{esc(self.book.title(lang))}: {esc(self.book.subtitle(lang))}</em></div>']
        for u in self.series["upcoming"]:
            if u.get("visible"):
                items.append(f'<div class="it"><em>{esc(u["titles"][lang])}</em></div>')
        site = self.series["site"]["url"]
        return (f'<section class="endpage"><h3>{esc(self.series["names"][lang])}</h3>'
                f'<div class="it" style="font-style:italic">{esc(self.series["descriptions"][lang])}</div>'
                + "".join(items)
                + (f'<div class="it"><small>{esc(S["web"])} · {esc(site)}</small></div>' if site else "")
                + "</section>")

    # ---------- assemble -------------------------------------------------------
    def build_html(self, with_pages: bool) -> tuple[str, list[dict]]:
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
        front = self.front_matter(self.toc(with_pages))
        env = Environment(loader=FileSystemLoader(str(TEMPLATES)), autoescape=False)
        G = self.geo
        css = env.get_template("print.css.j2").render(
            fonts=FONTS.resolve().as_uri(), pal=self.book.palette, body_pt=self.book.cfg["print"]["body_pt"],
            leading=self.book.cfg["print"]["leading"], PW=G.PW, PH=G.PH, text_h=G.text_h,
            m_top=round(G.b + G.top, 4), m_bot=round(G.b + G.bottom, 4),
            m_out_r=round(G.b_out + G.outer, 4), m_in_r=round(G.b_in + G.inner, 4),
            m_in_l=round(G.b_in + G.inner, 4), m_out_l=round(G.b_out + G.outer, 4),
            opener_top=1.25, chapters=heads, book_title_css=css_str(self.book.title(self.lang).upper()))
        doc = (f'<!doctype html><html lang="{self.lang}"><head><meta charset="utf-8">'
               f'<title>{esc(self.book.title(self.lang))}</title><style>{css}</style></head><body>{front}{"".join(pieces)}</body></html>')
        return doc, heads

    def render_pdf(self, html: str, pdf_path: Path) -> None:
        html_path = pdf_path.with_suffix(".html")
        html_path.write_text(html, encoding="utf-8")
        with sync_playwright() as p:
            br = launch(p)
            pg = br.new_page()
            pg.goto(html_path.resolve().as_uri(), wait_until="load")
            pg.evaluate("document.fonts.ready")
            pg.wait_for_timeout(400)
            pg.pdf(path=str(pdf_path), prefer_css_page_size=True, print_background=True,
                   display_header_footer=False, margin={"top": "0", "right": "0", "bottom": "0", "left": "0"})
            br.close()

    def find_pages(self, pdf_path: Path) -> dict[str, int]:
        doc = fitz.open(pdf_path)
        texts = [doc[i].get_text("text") for i in range(len(doc))]
        # contents page(s): first page after the copyright page that mentions the contents title
        toc_end = 0
        for i, t in enumerate(texts[:10]):
            if self.S["contents"] in t:
                toc_end = i
        toc_end += 1
        # a second contents page holds more rows; skip pages that still look like contents
        while toc_end < len(texts) and texts[toc_end].count("\n") > 10 and re.search(r"\n\d{1,3}\n", texts[toc_end]) and \
                sum(1 for s in self.ms.sections if s.kind == "chapter" and s.title in texts[toc_end]) >= 2:
            toc_end += 1
        found: dict[str, int] = {}
        wants = [(s.id, s.title) for s in self.ms.sections if s.kind in ("chapter", "prologue", "epilogue", "glossary", "note")]
        if self.guide_on:
            wants.append(("guide", self.S["guide"]))
        cur = toc_end
        for sid, title in wants:
            key = re.sub(r"\s+", " ", typo.plain(title)).strip().lower().replace("­", "")
            for i in range(cur, len(texts)):
                tt = re.sub(r"\s+", " ", texts[i].replace("­", "")).lower()
                if key in tt:
                    found[sid] = i + 1
                    cur = i
                    break
        return found

    def build(self) -> dict:
        pdf1 = self.out_dir / "pass1.pdf"
        html1, _ = self.build_html(with_pages=False)
        self.render_pdf(html1, pdf1)
        self.toc_pages = self.find_pages(pdf1)
        html2, _ = self.build_html(with_pages=True)
        final = self.out_dir / f"{self.book.slug}_{self.lang}_{self.edition}_interior.pdf"
        self.render_pdf(html2, final)
        # make the page count even (recto/verso pairs) by appending a blank page when needed
        doc = fitz.open(final)
        n = len(doc)
        if n % 2:
            doc.insert_page(n, width=doc[0].rect.width, height=doc[0].rect.height)
            tmp = final.with_suffix(".tmp.pdf")
            doc.save(tmp, garbage=3, deflate=True)
            doc.close()
            shutil.move(tmp, final)
            n += 1
        else:
            doc.close()
        missing = [k for k in ("prologue",) if k not in self.toc_pages]
        return {"pdf": final, "pages": n, "toc": self.toc_pages, "warnings": self.warnings, "placed": self.placed,
                "toc_complete": len(self.toc_pages)}
