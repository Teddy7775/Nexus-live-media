"""EPUB 3 generator (reflowable, accessible metadata, embedded open fonts, stable UUID identifiers)."""
from __future__ import annotations

import datetime as dt
import shutil
import uuid
import zipfile
from pathlib import Path

from PIL import Image

from .art import Art
from .core import BUILD, RELEASE, ROOT, Book, Project
from .mdparse import strip_tags
from .render_common import Common, esc
from .render_print import STR as PSTR

FONTS = ROOT / "assets" / "fonts"
EPUB_FONTS = ["literata-latin-400-normal.woff2", "literata-latin-400-italic.woff2", "literata-latin-600-normal.woff2",
              "nunito-sans-latin-700-normal.woff2", "caveat-latin-600-normal.woff2",
              "noto-sans-devanagari-devanagari-400-normal.woff2"]

A11Y = {
    "en": "Reflowable text with alternative text for every illustration, a linked table of contents and logical reading order.",
    "fr": "Texte redimensionnable avec texte alternatif pour chaque illustration, table des matières cliquable et ordre de lecture logique.",
    "es": "Texto ajustable con texto alternativo para cada ilustración, índice con enlaces y orden de lectura lógico.",
}

CSS = """
@font-face{font-family:"Literata";font-weight:400;font-style:normal;src:url("../fonts/literata-latin-400-normal.woff2")}
@font-face{font-family:"Literata";font-weight:400;font-style:italic;src:url("../fonts/literata-latin-400-italic.woff2")}
@font-face{font-family:"Literata";font-weight:600;font-style:normal;src:url("../fonts/literata-latin-600-normal.woff2")}
@font-face{font-family:"Nunito Sans";font-weight:700;src:url("../fonts/nunito-sans-latin-700-normal.woff2")}
@font-face{font-family:"Caveat";font-weight:600;src:url("../fonts/caveat-latin-600-normal.woff2")}
@font-face{font-family:"Noto Sans Devanagari";font-weight:400;src:url("../fonts/noto-sans-devanagari-devanagari-400-normal.woff2")}
html{font-family:"Literata",Georgia,serif}
body{margin:0;padding:0 .2em;line-height:1.55;color:#241f1c}
p{margin:0;text-indent:1.3em;text-align:justify;hyphens:auto;-epub-hyphens:auto;orphans:2;widows:2}
h1,h2,h3{font-weight:600;line-height:1.15;color:#35445D;page-break-after:avoid;break-after:avoid}
.deva{font-family:"Noto Sans Devanagari",sans-serif;font-size:.92em}
.opener{text-align:center;margin:3em 0 2em;page-break-before:always}
.opener .lab{font:700 .7em "Nunito Sans",sans-serif;letter-spacing:.28em;text-transform:uppercase;color:#C66B32}
.opener .num{font-size:2.6em;color:#C88E82;line-height:1;margin:.15em 0}
.opener h1{font-size:1.5em;margin:.2em 0}
.opener .date{font:600 1.15em "Caveat",cursive;color:#315768;margin-top:.5em}
.partpage{text-align:center;margin-top:30%}
.partpage .lab{font:700 .75em "Nunito Sans",sans-serif;letter-spacing:.3em;text-transform:uppercase;color:#C66B32}
.partpage h1{font-size:1.9em;margin:.4em 0}
.opener + p,.partpage + p{text-indent:0}
.notice{text-indent:0;text-align:center;margin:1em .5em;padding:.5em;border-top:1px solid #DDA16C;border-bottom:1px solid #DDA16C;font:700 .78em "Nunito Sans",sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#35445D}
.poster{margin:1em .5em;padding:.6em;border:2px double #35445D;text-align:center}
.poster p{text-indent:0;text-align:center;font:700 .82em "Nunito Sans",sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#35445D;margin:.15em 0}
.card{margin:1em .3em;padding:.5em .9em;background:#f8f1e4;border-left:3px solid #C66B32;page-break-inside:avoid}
.card .ct{text-indent:0;text-align:left;font:700 .75em "Nunito Sans",sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#C66B32;margin:0 0 .3em}
.card ul,.card ol{margin:.2em 0;padding-left:1.3em;font:600 1.1em "Caveat",cursive}
ol.rules{padding-left:1.6em;font:600 1.05em "Caveat",cursive}
.note{text-indent:0;margin:.7em 1em;padding-left:.8em;border-left:2px solid #DDA16C;font:600 1.1em "Caveat",cursive;color:#315768;text-align:left}
.dateline{text-indent:0;text-align:center;font:600 1.15em "Caveat",cursive;color:#315768;margin:1.2em 0 .6em}
.tail{margin:1.4em .2em 0;padding:.5em .9em;border:1px dashed #C88E82;background:#fbf5ea;page-break-inside:avoid}
.tail p{text-indent:0;text-align:left;font:600 1.1em "Caveat",cursive;margin:.15em 0}
.tail p strong{font:700 .62em "Nunito Sans",sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#C66B32;margin-right:.3em}
.sw{display:inline-block;width:.75em;height:.75em;border-radius:50%;border:1px solid #0003;margin-right:.4em}
figure.illus{margin:1.2em 0;text-align:center;page-break-inside:avoid}
figure.illus img{max-width:100%;height:auto;border-radius:3px}
.titlepage{text-align:center;margin-top:20%}
.titlepage .series{font:700 .7em "Nunito Sans",sans-serif;letter-spacing:.28em;text-transform:uppercase;color:#C66B32}
.titlepage h1{font-size:2.1em;margin:.5em 0 .2em}
.titlepage .sub{font-style:italic;color:#315768;font-size:1.1em}
.titlepage .by{margin-top:3em;font:700 .85em "Nunito Sans",sans-serif;letter-spacing:.2em;text-transform:uppercase}
.copyright p{text-indent:0;text-align:left;font-size:.8em;margin:.5em 0}
.glossary p{text-indent:0;text-align:left;margin:.5em 0;font-size:.95em}
.cover{text-align:center;margin:0;padding:0}.cover img{max-width:100%;max-height:100%}
nav ol{list-style:none;padding-left:0}nav ol ol{padding-left:1.2em}nav li{margin:.35em 0;text-indent:0}nav a{color:inherit;text-decoration:none}
table{width:100%;border-collapse:collapse;font-size:.85em;margin:.6em 0}th,td{text-align:left;vertical-align:top;padding:.3em .4em;border-bottom:1px solid #e2d4bc}th{background:#315768;color:#fff;font:700 .8em "Nunito Sans",sans-serif;letter-spacing:.05em}
.guide p{text-indent:0;text-align:left;margin:.5em 0}.guide h2{font-size:1.35em;margin:1.4em 0 .5em}.guide h3{font:700 .8em "Nunito Sans",sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#315768;margin:1.2em 0 .4em}
.warn{border:1px solid #DDA16C;background:#fbf5ea;padding:.6em .9em;font:600 .85em "Nunito Sans",sans-serif;color:#A13F30;margin:1.4em 0;text-indent:0}
a{color:#315768}
"""


def x(s):  # XML-safe text
    return esc(s)


class EpubBuilder:
    def __init__(self, P: Project, book: Book, lang: str, edition: str):
        self.P, self.book, self.lang, self.ed = P, book, lang, edition
        self.guide_on = edition == "guide"
        self.ms = book.manuscript(lang)
        self.guide = book.guide(lang) if self.guide_on else None
        self.art = Art(book)
        self.S = PSTR[lang]
        self.root = BUILD / book.slug / "epub" / f"{lang}-{edition}"
        if self.root.exists():
            shutil.rmtree(self.root)
        (self.root / "OEBPS" / "css").mkdir(parents=True)
        (self.root / "OEBPS" / "fonts").mkdir()
        (self.root / "OEBPS" / "images").mkdir()
        (self.root / "META-INF").mkdir()
        self.items: list[dict] = []     # manifest
        self.spine: list[str] = []
        self.toc: list[tuple] = []      # (level, title, href)

    # ---- helpers ----------------------------------------------------------
    def doc(self, title: str, body: str, etype: str = "bodymatter") -> str:
        return (f'<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n'
                f'<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="{self.lang}" xml:lang="{self.lang}">'
                f'<head><meta charset="utf-8"/><title>{x(title)}</title><link rel="stylesheet" type="text/css" href="css/style.css"/></head>'
                f'<body epub:type="{etype}">{body}</body></html>')

    def add(self, fid: str, href: str, media: str, props: str = "", spine: bool = False, linear: bool = True):
        self.items.append({"id": fid, "href": href, "media": media, "props": props})
        if spine:
            self.spine.append((fid, linear))

    def write(self, href: str, content: str):
        (self.root / "OEBPS" / href).write_text(content, encoding="utf-8")

    def image(self, aid: str, af) -> str:
        out = self.root / "OEBPS" / "images" / f"{aid}.jpg"
        im = Image.open(af.web).convert("RGB")
        if im.width > 1400:
            im = im.resize((1400, round(im.height * 1400 / im.width)), Image.LANCZOS)
        im.save(out, quality=84, optimize=True, progressive=True)
        self.add(f"img-{aid}", f"images/{aid}.jpg", "image/jpeg")
        return f"images/{aid}.jpg"

    # ---- build ------------------------------------------------------------
    def build(self) -> Path:
        bk, lang, S = self.book, self.lang, self.S
        pal = bk.palette
        series = self.book.series
        title, sub = bk.title(lang), bk.subtitle(lang)
        used_imgs = {}

        def fig(aid, slot):
            af = self.art.get(aid)
            if not af:
                return ""
            href = self.image(aid, af)
            return (f'<figure class="illus" epub:type="figure"><img src="{href}" alt="{x(slot["alt"][lang])}"/></figure>')

        C = Common(bk, lang, fig)

        # css + fonts
        self.write("css/style.css", CSS)
        self.add("css", "css/style.css", "text/css")
        for f in EPUB_FONTS:
            shutil.copyfile(FONTS / f, self.root / "OEBPS" / "fonts" / f)
            self.add("font-" + f.split(".")[0], f"fonts/{f}", "font/woff2")

        # cover
        cover_src = RELEASE / bk.slug / "covers" / f"{lang}-{self.ed}" / f"{bk.slug}_{lang}_{self.ed}_front.png"
        if not cover_src.exists():
            from .render_cover import CoverBuilder
            cb = CoverBuilder(bk, lang, self.ed, 150)
            tmp = BUILD / bk.slug / "cover" / f"{lang}-{self.ed}"
            tmp.mkdir(parents=True, exist_ok=True)
            cover_src = tmp / "front.png"
            cb.front_png(cover_src, 1000)
        cim = Image.open(cover_src).convert("RGB")
        cim.thumbnail((1200, 1800))
        cim.save(self.root / "OEBPS" / "images" / "cover.jpg", quality=88, optimize=True)
        self.add("cover-image", "images/cover.jpg", "image/jpeg", props="cover-image")
        self.write("cover.xhtml", self.doc(title, f'<section class="cover" epub:type="cover"><img src="images/cover.jpg" alt="{x(title + ": " + sub)}"/></section>', "cover"))
        self.add("cover", "cover.xhtml", "application/xhtml+xml", spine=True)

        # title page
        author = series.get("author", {}).get("name", "")
        tp = (f'<section class="titlepage" epub:type="titlepage"><div class="series">{x(series["names"][lang].upper())}</div>'
              f'<h1 epub:type="title">{x(title)}</h1><div class="sub">{x(sub)}</div>'
              + (f'<div class="by">{x(author)}</div>' if author else "") + "</section>")
        self.write("title.xhtml", self.doc(title, tp, "titlepage"))
        self.add("title", "title.xhtml", "application/xhtml+xml", spine=True)

        # copyright
        pub = series["publisher"]
        year = pub.get("copyright_year", bk.cfg.get("year", 2026))
        holder = pub.get("copyright_holder") or author
        note_title = next((s.title for s in self.ms.sections if s.kind == "note"), "")
        isbn = bk.cfg["isbn"].get("ebook", {}).get(lang, "")
        cp = ('<section class="copyright" epub:type="copyright-page">'
              + (f"<p>© {year} {x(holder)}. {x(S['rights'])}</p>" if holder else f"<p>© {year}. {x(S['rights'])}</p>")
              + f"<p>{x(S['fiction'].format(note=note_title))}</p>"
              + (f"<p>ISBN {x(isbn)}</p>" if isbn else "") + "</section>")
        self.write("copyright.xhtml", self.doc(title, cp, "copyright-page"))
        self.add("copyright", "copyright.xhtml", "application/xhtml+xml", spine=True)

        # nav placeholder in spine (visible contents)
        self.add("nav", "nav.xhtml", "application/xhtml+xml", props="nav", spine=True)

        # sections
        part_open = None
        for sec in self.ms.sections:
            fn = f"{sec.id}.xhtml"
            if sec.kind == "part":
                body = (f'<section epub:type="part" class="partpage"><div class="lab">{x(strip_tags(sec.label))}</div>'
                        f'<h1>{x(sec.title)}</h1></section>')
                self.write(fn, self.doc(sec.title, body, "part"))
                self.toc.append((1, f"{strip_tags(sec.label)} · {sec.title}", fn))
                self.add(sec.id, fn, "application/xhtml+xml", spine=True)
                continue
            if sec.kind == "chapter":
                head = (f'<header class="opener"><div class="lab">{x(strip_tags(sec.label))}</div><div class="num">{sec.number}</div>'
                        f'<h1>{x(sec.title)}</h1>' + (f'<div class="date">{x(sec.date)}</div>' if sec.date else "") + "</header>")
                etype = "chapter"
                lvl = 2
            else:
                head = (f'<header class="opener">' + (f'<div class="lab">{x(strip_tags(sec.label))}</div>' if sec.label else "")
                        + f'<h1>{x(sec.title)}</h1>' + (f'<div class="date">{x(sec.date)}</div>' if sec.date else "") + "</header>")
                etype = {"prologue": "prologue", "epilogue": "epilogue", "glossary": "glossary", "note": "afterword"}[sec.kind]
                lvl = 1
            cls = " glossary" if sec.kind == "glossary" else ""
            body = f'<section epub:type="{etype}" class="{cls.strip()}">{head}{C.section_body(sec)}</section>'
            self.write(fn, self.doc(sec.title, body, "bodymatter" if sec.kind != "note" else "backmatter"))
            self.toc.append((lvl, (f"{sec.number}. " if sec.kind == "chapter" else "") + sec.title, fn))
            self.add(sec.id, fn, "application/xhtml+xml", spine=True)

        # guide
        if self.guide_on:
            g = self.guide
            intro = (f'<section epub:type="bodymatter" class="guide"><header class="opener"><div class="lab">{x(series["names"][lang])}</div>'
                     f'<h1>{x(S["guide"])}</h1></header>'
                     + (f'<p class="noind"><em>{C.T(g.intro)}</em></p>' if g.intro else "")
                     + f'<p class="warn">{x(S["spoiler"])}</p></section>')
            self.write("guide.xhtml", self.doc(S["guide"], intro))
            self.toc.append((1, S["guide"], "guide.xhtml"))
            self.add("guide", "guide.xhtml", "application/xhtml+xml", spine=True)
            facts = ""
            for s in g.sections:
                if s.kind == "guide-facts":
                    facts = C.table(s.blocks[0])
                    # facts table lives on the guide title page
                    p = self.root / "OEBPS" / "guide.xhtml"
                    p.write_text(p.read_text(encoding="utf-8").replace("</section></body>", facts + "</section></body>"), encoding="utf-8")
                    continue
                fn = f"guide-{s.number or 'sources'}.xhtml"
                body = (f'<section epub:type="bodymatter" class="guide"><h2>{(str(s.number) + ". ") if s.number else ""}{x(s.title)}</h2>'
                        f"{C.guide_section_body(s)}</section>")
                self.write(fn, self.doc(s.title, body))
                self.toc.append((2, (f"{s.number}. " if s.number else "") + s.title, fn))
                self.add(fn.replace(".xhtml", ""), fn, "application/xhtml+xml", spine=True)

        # series page
        items = [f'<p style="text-indent:0;text-align:center"><em>{x(bk.title(lang))}: {x(bk.subtitle(lang))}</em></p>']
        for u in series["upcoming"]:
            if u.get("visible"):
                items.append(f'<p style="text-indent:0;text-align:center"><em>{x(u["titles"][lang])}</em></p>')
        sp = (f'<section epub:type="backmatter"><header class="opener"><h1>{x(S["series_page"])}</h1></header>'
              f'<p style="text-indent:0;text-align:center">{x(series["descriptions"][lang])}</p>' + "".join(items) + "</section>")
        self.write("series.xhtml", self.doc(S["series_page"], sp, "backmatter"))
        self.toc.append((1, S["series_page"], "series.xhtml"))
        self.add("series", "series.xhtml", "application/xhtml+xml", spine=True)

        self.write_nav(title)
        self.write_ncx(title)
        self.write_opf(title, sub, author)
        (self.root / "META-INF" / "container.xml").write_text(
            '<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        return self.zip()

    def write_nav(self, title: str):
        S = self.S
        li, stack = [], 0
        # group chapters under parts
        out = ["<ol>"]
        open_part = False
        for lvl, t, href in self.toc:
            if lvl == 1 and open_part:
                out.append("</ol></li>")
                open_part = False
            if lvl == 1 and "·" in t:           # part
                out.append(f'<li><a href="{href}">{x(t)}</a><ol>')
                open_part = True
            elif lvl == 1:
                out.append(f'<li><a href="{href}">{x(t)}</a></li>')
            else:
                out.append(f'<li><a href="{href}">{x(t)}</a></li>')
        if open_part:
            out.append("</ol></li>")
        out.append("</ol>")
        first_body = next((h for l, t, h in self.toc if h.startswith(("prologue", "ch-"))), self.toc[0][2])
        nav = (f'<nav epub:type="toc" id="toc"><h1>{x(S["contents"])}</h1>{"".join(out)}</nav>'
               f'<nav epub:type="landmarks" hidden="hidden"><h2>Landmarks</h2><ol>'
               f'<li><a epub:type="cover" href="cover.xhtml">Cover</a></li>'
               f'<li><a epub:type="toc" href="nav.xhtml">{x(S["contents"])}</a></li>'
               f'<li><a epub:type="bodymatter" href="{first_body}">Start</a></li></ol></nav>')
        self.write("nav.xhtml", self.doc(S["contents"], nav, "frontmatter"))

    def write_ncx(self, title: str):
        pts = "".join(
            f'<navPoint id="n{i}" playOrder="{i + 1}"><navLabel><text>{x(t)}</text></navLabel><content src="{h}"/></navPoint>'
            for i, (l, t, h) in enumerate(self.toc))
        self.write("toc.ncx",
                   f'<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">'
                   f'<head><meta name="dtb:uid" content="{self.uid}"/></head><docTitle><text>{x(title)}</text></docTitle><navMap>{pts}</navMap></ncx>')
        self.add("ncx", "toc.ncx", "application/x-dtbncx+xml")

    @property
    def uid(self) -> str:
        isbn = self.book.cfg["isbn"].get("ebook", {}).get(self.lang, "")
        if isbn:
            return "urn:isbn:" + isbn.replace("-", "")
        return "urn:uuid:" + str(uuid.uuid5(uuid.NAMESPACE_URL, f"mcw/{self.book.slug}/{self.lang}/{self.ed}/epub"))

    def write_opf(self, title: str, sub: str, author: str):
        bk, lang = self.book, self.lang
        series = bk.series
        pub = series["publisher"]["name"]
        now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        meta = [f'<dc:identifier id="uid">{x(self.uid)}</dc:identifier>',
                f'<dc:title id="t1">{x(title)}</dc:title><meta refines="#t1" property="title-type">main</meta>',
                f'<dc:title id="t2">{x(sub)}</dc:title><meta refines="#t2" property="title-type">subtitle</meta>',
                f'<dc:language>{lang}</dc:language>',
                f'<dc:description>{x(bk.cfg["short_descriptions"][lang])}</dc:description>',
                f'<dc:date>{now[:10]}</dc:date>']
        if author:
            meta.append(f'<dc:creator id="a1">{x(author)}</dc:creator><meta refines="#a1" property="role" scheme="marc:relators">aut</meta>')
        if pub:
            meta.append(f'<dc:publisher>{x(pub)}</dc:publisher>')
        for k in bk.cfg["keywords"][lang]:
            meta.append(f"<dc:subject>{x(k)}</dc:subject>")
        meta += [f'<meta property="belongs-to-collection" id="c1">{x(series["names"][lang])}</meta>',
                 '<meta refines="#c1" property="collection-type">series</meta>',
                 f'<meta refines="#c1" property="group-position">{bk.cfg["volume"]}</meta>',
                 f'<meta property="dcterms:modified">{now}</meta>',
                 '<meta property="schema:accessMode">textual</meta><meta property="schema:accessMode">visual</meta>',
                 '<meta property="schema:accessModeSufficient">textual</meta>',
                 '<meta property="schema:accessibilityFeature">alternativeText</meta>',
                 '<meta property="schema:accessibilityFeature">tableOfContents</meta>',
                 '<meta property="schema:accessibilityFeature">readingOrder</meta>',
                 '<meta property="schema:accessibilityHazard">none</meta>',
                 f'<meta property="schema:accessibilitySummary">{x(A11Y[lang])}</meta>',
                 '<meta name="cover" content="cover-image"/>']
        man = "".join(
            f'<item id="{i["id"]}" href="{i["href"]}" media-type="{i["media"]}"' + (f' properties="{i["props"]}"' if i["props"] else "") + "/>"
            for i in self.items)
        spine = "".join(f'<itemref idref="{i}"/>' for i, _ in self.spine)
        self.write("content.opf",
                   '<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" '
                   f'xml:lang="{lang}" prefix="schema: http://schema.org/"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">{"".join(meta)}</metadata>'
                   f'<manifest>{man}</manifest><spine toc="ncx">{spine}</spine></package>')

    def zip(self) -> Path:
        out_dir = RELEASE / self.book.slug / "epub"
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / f"{self.book.slug}_{self.lang}_{self.ed}.epub"
        with zipfile.ZipFile(out, "w") as z:
            z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
            for p in sorted(self.root.rglob("*")):
                if p.is_file():
                    z.write(p, p.relative_to(self.root).as_posix(), compress_type=zipfile.ZIP_DEFLATED)
        return out


def build_epub(P: Project, book: Book, lang: str, ed: str):
    out = EpubBuilder(P, book, lang, ed).build()
    print(f"[epub] {lang}-{ed}: {out.stat().st_size // 1024} KB -> {out}")
    return out
