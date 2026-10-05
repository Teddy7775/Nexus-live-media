"""Static website generator for the whole collection (EN / FR / ES).

Everything is derived from series.json, each books/<slug>/book.json, the edited manuscripts and
the Discovery Guides. Adding a volume = add a folder under books/ and list its slug in
series.json; no code changes. Output goes to public_html/ (upload that folder to Hostinger).
"""
from __future__ import annotations

import datetime as dt
import html as _html
import json
import re
import shutil
import zipfile
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from PIL import Image
from playwright.sync_api import sync_playwright

from . import typo
from .art import Art
from .browser import launch
from .core import BUILD, PUBLIC, RELEASE, ROOT, Book, Project, load_json
from .mdparse import Section, strip_tags
from .render_common import Common, esc

SITE = ROOT / "site"
FONTS = ROOT / "assets" / "fonts"
VERSION = dt.date.today().strftime("%Y%m%d")


class SiteBuilder:
    def __init__(self, P: Project, out: Path = PUBLIC):
        self.P, self.out = P, out
        s = P.series["site"]
        self.site_url = (s.get("url") or "").rstrip("/")
        self.base = (s.get("base_path") or "").rstrip("/")
        self.langs = P.langs
        self.tx = {l: P.i18n(l) for l in self.langs}
        self.env = Environment(loader=FileSystemLoader(str(SITE / "templates")),
                               autoescape=select_autoescape(["html", "j2"]))
        self.pages: list[dict] = []        # for the sitemap
        self.warnings: list[str] = []
        pub = P.series["publisher"]
        self.holder = pub.get("copyright_holder") or pub.get("name") or P.series.get("author", {}).get("name") or P.series["names"]["en"]
        self.year = pub.get("copyright_year", dt.date.today().year)

    # ---------------------------------------------------------------- urls
    def seg(self, lang: str, key: str) -> str:
        return self.tx[lang]["seg"][key]

    def sslug(self, lang: str, sid: str) -> str:
        """URL segment of a reader section (chapters keep ch-NN; front/back matter is localised)."""
        return self.tx[lang].get("secslug", {}).get(sid, sid)

    def path(self, lang: str, *parts: str) -> str:
        p = "/".join([lang, *[x for x in parts if x]])
        return f"{self.base}/{p}/"

    def abs(self, path: str) -> str | None:
        return f"{self.site_url}{path}" if self.site_url else None

    def book_slug(self, book: Book, lang: str) -> str:
        return book.cfg["url_slugs"][lang]

    def u_nav(self, lang: str) -> dict:
        return {"home": self.path(lang), "books": self.path(lang, self.seg(lang, "books")),
                "parents": self.path(lang, self.seg(lang, "parents")), "about": self.path(lang, self.seg(lang, "about")),
                "contact": self.path(lang, self.seg(lang, "contact")), "legal": self.path(lang, self.seg(lang, "legal"))}

    # ---------------------------------------------------------------- output helpers
    def write(self, rel: str, content: str | bytes):
        p = self.out / rel.lstrip("/")
        p.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            p.write_bytes(content)
        else:
            p.write_text(content, encoding="utf-8")

    def alts(self, fn) -> tuple[list[dict], str | None]:
        """fn(lang) -> root-relative path of this page in `lang` (or None)."""
        out = []
        for l in self.langs:
            pth = fn(l)
            if pth:
                out.append({"lang": l, "href_rel": pth, "href": self.abs(pth) or pth, "name": self.P.series["language_names"][l]})
        d = next((a["href"] for a in out if a["lang"] == self.P.series["default_language"]), None)
        return out, d

    # per-book colours: every volume brings its palette to its own pages (book page, reader, guide)
    @staticmethod
    def _rgb(h):
        h = h.lstrip("#")
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

    @classmethod
    def _lum(cls, h):
        f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
        r, g, b = (f(v / 255) for v in cls._rgb(h))
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    @classmethod
    def _contrast(cls, a, b):
        la, lb = sorted((cls._lum(a), cls._lum(b)), reverse=True)
        return (la + 0.05) / (lb + 0.05)

    @classmethod
    def _mix(cls, a, b, t):
        ra, rb = cls._rgb(a), cls._rgb(b)
        return "#%02X%02X%02X" % tuple(round(x * (1 - t) + y * t) for x, y in zip(ra, rb))

    @classmethod
    def _ensure(cls, color, bg, minimum, toward):
        """Move `color` toward `toward` (black or white) until it reaches `minimum` contrast on `bg`."""
        for i in range(0, 21):
            c = cls._mix(color, toward, i / 20)
            if cls._contrast(c, bg) >= minimum:
                return c
        return toward

    def write_books_css(self):
        rules = []
        for slug, b in self.P.books.items():
            pal = b.palette
            light_bg, dark_bg = "#FBF6EC", "#16181D"
            kes = pal["kesariya"]
            ink = self._ensure(pal["ember"], light_bg, 6.5, "#000000")
            link = self._ensure(pal["petrol"], light_bg, 5.5, "#000000")
            btn = self._ensure(kes, "#FFFFFF", 5.0, "#000000")
            btn_h = self._mix(btn, "#000000", 0.2)
            pen = self._ensure(pal.get("pen", pal["petrol"]), light_bg, 5.5, "#000000")
            pink = pal.get("pink", kes)
            light = (f"--kes:{kes};--accent:{kes};--accent-ink:{ink};--head:{pal['indigo']};--link:{link};"
                     f"--hand-ink:{link};--pen:{pen};--pink:{pink};--plaster:{pal['plaster']};--btn:{btn};--btn-h:{btn_h}")
            acc_d = self._ensure(self._mix(kes, "#FFFFFF", 0.25), dark_bg, 5.0, "#FFFFFF")
            ink_d = self._ensure(self._mix(kes, "#FFFFFF", 0.5), dark_bg, 7.0, "#FFFFFF")
            link_d = self._ensure(self._mix(pal["petrol"], "#FFFFFF", 0.62), dark_bg, 7.0, "#FFFFFF")
            pen_d = self._ensure(self._mix(pal.get("pen", pal["petrol"]), "#FFFFFF", 0.62), dark_bg, 7.0, "#FFFFFF")
            dark = f"--accent:{acc_d};--accent-ink:{ink_d};--link:{link_d};--hand-ink:{link_d};--pen:{pen_d};--btn:{btn};--btn-h:{btn_h}"
            rules.append(f'html[data-book="{slug}"]{{{light}}}')
            if not b.design.get("hand", True):      # sober italic serif instead of the handwriting face
                sel = f'html[data-book="{slug}"]'
                rules.append(f'{sel} .tagline{{font:italic 400 1.3rem/1.3 var(--serif)}}'
                             f'{sel} .chapter .opener .date,{sel} .prose .dateline{{font:italic 400 1.15rem var(--serif)}}'
                             f'{sel} .prose .note{{font:italic 400 1.05rem/1.5 var(--serif)}}'
                             f'{sel} .toc-list .d{{font:italic 400 1rem var(--serif)}}')
            rules.append(f'html[data-book="{slug}"][data-theme="dark"]{{{dark}}}')
            rules.append(f'@media (prefers-color-scheme:dark){{html[data-book="{slug}"]:not([data-theme]){{{dark}}}}}')
        self.write("assets/css/books.css", "/* generated from each book's palette (books/<slug>/book.json) */\n" + "\n".join(rules) + "\n")

    def page(self, lang: str, template: str, ctx: dict, fn, rel_out: str, title: str, desc: str, nav_current: str = "",
             og_image: str | None = None, jsonld: dict | None = None, og_type: str = "website", noindex: bool = False,
             sitemap: bool = True):
        alts, alts_default = self.alts(fn)
        here = fn(lang)
        page = {"title": title, "description": desc, "canonical": self.abs(here), "og_image": og_image, "og_type": og_type,
                "book": ctx.get("slug"),
                "jsonld": json.dumps(jsonld, ensure_ascii=False) if jsonld else None, "noindex": noindex}
        t = self.tx[lang]
        series = self.P.series
        base_ctx = dict(L=lang, t=t, u=self.u_nav(lang), base=self.base, ver=VERSION, page=page, alts=alts, alts_default=alts_default,
                        locale=series["locales"][lang], series_name=series["names"][lang], nav_current=nav_current,
                        year=self.year, holder=self.holder)
        html = self.env.get_template(template).render(**base_ctx, **ctx)
        self.write(rel_out, html)
        if sitemap and not noindex:
            self.pages.append({"lang": lang, "path": here, "peers": [(a["lang"], a["href"]) for a in alts]})

    # ---------------------------------------------------------------- assets
    def copy_static(self):
        shutil.copytree(SITE / "static", self.out / "assets", dirs_exist_ok=True)
        (self.out / "assets" / "fonts").mkdir(parents=True, exist_ok=True)
        for f in FONTS.glob("*.woff2"):
            shutil.copyfile(f, self.out / "assets" / "fonts" / f.name)
        (self.out / "assets" / "img").mkdir(parents=True, exist_ok=True)
        shutil.copyfile(SITE / "static" / "img" / "favicon.svg", self.out / "assets" / "img" / "favicon.svg")
        # PHP handlers
        api = self.out / "api"
        api.mkdir(parents=True, exist_ok=True)
        for f in ("_lib.php", "subscribe.php", "contact.php", "config.sample.php"):
            shutil.copyfile(SITE / "php" / f, api / f)
        shutil.copyfile(SITE / "php" / "htaccess.api", api / ".htaccess")
        (api / "private").mkdir(exist_ok=True)
        shutil.copyfile(SITE / "php" / "htaccess.private", api / "private" / ".htaccess")
        (api / "private" / "index.html").write_text("", encoding="utf-8")
        self.write_books_css()

    def img_set(self, src: Path, name: str, rel_dir: str, widths=(800, 1400), jpg_w=1400) -> dict:
        d = self.out / "assets" / "img" / rel_dir
        d.mkdir(parents=True, exist_ok=True)
        im = Image.open(src).convert("RGB")
        srcset = []
        for w in widths:
            if im.width < w:
                w2 = im.width
            else:
                w2 = w
            r = im.resize((w2, round(im.height * w2 / im.width)), Image.LANCZOS) if im.width > w2 else im
            r.save(d / f"{name}-{w}.webp", quality=82, method=6)
            srcset.append(f"{self.base}/assets/img/{rel_dir}/{name}-{w}.webp {w2}w")
        jw = min(jpg_w, im.width)
        rj = im.resize((jw, round(im.height * jw / im.width)), Image.LANCZOS) if im.width > jw else im
        rj.save(d / f"{name}.jpg", quality=84, optimize=True, progressive=True)
        return {"webp": ", ".join(srcset), "src": f"{self.base}/assets/img/{rel_dir}/{name}.jpg", "w": rj.width, "h": rj.height,
                "full": f"{self.base}/assets/img/{rel_dir}/{name}.jpg"}

    def cover_png(self, book: Book, lang: str, ed: str = "story") -> Path:
        p = RELEASE / book.slug / "covers" / f"{lang}-{ed}" / f"{book.slug}_{lang}_{ed}_front.png"
        if p.exists():
            return p
        from .render_cover import CoverBuilder
        meta = BUILD / book.slug / "print" / f"{lang}-{ed}" / "meta.json"
        pages = load_json(meta)["pages"] if meta.exists() else 150
        out = BUILD / book.slug / "cover" / f"{lang}-{ed}"
        out.mkdir(parents=True, exist_ok=True)
        CoverBuilder(book, lang, ed, pages).front_png(out / "front.png")
        return out / "front.png"

    def og_card(self, book: Book, lang: str) -> str:
        cover = self.cover_png(book, lang)
        pal = book.palette
        html = f'''<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:L;font-weight:600;src:url("{FONTS.resolve().as_uri()}/literata-latin-600-normal.woff2")}}
@font-face{{font-family:N;font-weight:800;src:url("{FONTS.resolve().as_uri()}/nunito-sans-latin-800-normal.woff2")}}
@font-face{{font-family:C;font-weight:600;src:url("{FONTS.resolve().as_uri()}/caveat-latin-600-normal.woff2")}}
body{{margin:0;width:1200px;height:630px;background:linear-gradient(120deg,{pal["indigo"]},#243049);display:flex;align-items:center;gap:56px;padding:0 70px;box-sizing:border-box;color:#F2E7D2}}
img{{height:520px;border-radius:6px 14px 14px 6px;box-shadow:0 20px 50px #0008}}
.k{{font:800 22px N;letter-spacing:.24em;text-transform:uppercase;color:#E9A877}}.t{{font:600 66px/1.04 L;margin:18px 0 10px}}.s{{font:italic 600 34px L;color:#DDA16C}}.g{{font:600 36px C;margin-top:30px;color:#F2E7D2}}
</style></head><body><img src="{cover.resolve().as_uri()}"><div><div class="k">{esc(self.P.series["names"][lang])}</div><div class="t">{esc(book.title(lang))}</div><div class="s">{esc(book.subtitle(lang))}</div><div class="g">{esc(book.cfg["taglines"][lang])}</div></div></body></html>'''
        tmp = BUILD / book.slug / "og" / f"{lang}.html"
        tmp.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(html, encoding="utf-8")
        d = self.out / "assets" / "img" / book.slug
        d.mkdir(parents=True, exist_ok=True)
        png = tmp.with_suffix(".png")
        with sync_playwright() as p:
            br = launch(p)
            pg = br.new_page(viewport={"width": 1200, "height": 630})
            pg.goto(tmp.resolve().as_uri(), wait_until="load")
            pg.evaluate("document.fonts.ready")
            pg.wait_for_timeout(250)
            pg.screenshot(path=str(png))
            br.close()
        Image.open(png).convert("RGB").save(d / f"og-{lang}.jpg", quality=88, optimize=True)
        return f"{self.base}/assets/img/{book.slug}/og-{lang}.jpg"

    # ---------------------------------------------------------------- data
    def volumes(self, lang: str) -> list[dict]:
        """Every volume in series order (live books and announced titles); live entries carry their slug."""
        suffix = {"en": "", "fr": " ans", "es": " años"}[lang]
        out = []
        for e in self.P.catalog():
            b, u = e["book"], e["upcoming"]
            if b:
                n = b.cfg["narrator"]
                y0, y1 = b.cfg["story_dates"]["from"][:4], b.cfg["story_dates"]["to"][:4]
                out.append({"live": True, "slug": b.slug, "volume": b.cfg["volume"], "title": f'{b.title(lang)}: {b.subtitle(lang)}',
                            "narrator": f'{n.get("short") or n["name"].split()[0]}, {n["age"]}{suffix}',
                            "where": f'{b.cfg["place"][lang]} · {y0 if y0 == y1 else y0 + "–" + y1}',
                            "question": b.cfg["question"][lang], "accent": b.palette["kesariya"], "age_note": b.cfg.get("age_note", {}).get(lang, ""),
                            "url": self.path(lang, self.seg(lang, "books"), self.book_slug(b, lang))})
            else:
                nm = re.sub(r"(\d+)$", lambda m: m.group(1) + suffix, u["narrator"])
                out.append({"live": False, "slug": None, "volume": u.get("volume"), "title": u["titles"][lang], "narrator": nm, "where": u["where"][lang],
                            "question": u["question"][lang], "accent": u["accent"], "age_note": (u.get("age_note") or {}).get(lang, ""), "url": ""})
        return out

    @staticmethod
    def _facts(guide):
        for s in guide.sections:
            if s.kind == "guide-facts":
                return s.blocks[0].items[1]    # rows
        return []

    @staticmethod
    def _characters(guide):
        s1 = next(s for s in guide.sections if s.number == 1)
        tables = [b for b in s1.blocks if b.kind == "table"]
        rows = tables[-1].items[1] if tables else []
        return [{"name": esc(strip_tags(r[0])), "text": r[1]} for r in rows]

    # ---------------------------------------------------------------- build
    def build(self) -> Path:
        if self.out.exists():
            shutil.rmtree(self.out)
        self.out.mkdir(parents=True)
        self.copy_static()
        for book in self.P.books.values():
            self.build_book_assets(book)
        for lang in self.langs:
            self.build_lang(lang)
        self.build_root()
        self.build_support_files()
        return self.make_zip()

    def build_book_assets(self, book: Book):
        art = Art(book)
        self.illus: dict[str, dict] = getattr(self, "illus", {})
        for aid, slot in book.register["slots"].items():
            if slot["kind"] == "cover":
                continue
            af = art.get(aid)
            if not af:
                continue
            self.illus[f"{book.slug}:{aid}"] = {
                **self.img_set(af.web, aid, book.slug), "aspect": af.aspect, "kind": slot["kind"]}
        # downloads
        dl = self.out / "downloads" / book.slug
        dl.mkdir(parents=True, exist_ok=True)
        for f in (RELEASE / book.slug / "epub").glob("*.epub") if (RELEASE / book.slug / "epub").exists() else []:
            shutil.copyfile(f, dl / f.name)

    def fig_fn(self, book: Book, lang: str):
        def fig(aid, slot):
            im = self.illus.get(f"{book.slug}:{aid}")
            if not im:
                return ""
            cls = "spread" if slot["kind"] == "spread" else ("tall" if im["aspect"] < 1 else "")
            sizes = "(min-width: 62rem) 62rem, 100vw" if cls == "spread" else "(min-width: 46rem) 44rem, 100vw"
            return (f'<figure class="illus {cls}"><picture><source type="image/webp" srcset="{im["webp"]}" sizes="{sizes}">'
                    f'<img src="{im["src"]}" width="{im["w"]}" height="{im["h"]}" alt="{esc(slot["alt"][lang])}" loading="lazy" decoding="async"></picture></figure>')
        return fig

    def build_lang(self, lang: str):
        P, t = self.P, self.tx[lang]
        series = P.series
        books = sorted(P.books.values(), key=lambda b: b.cfg["volume"])
        vols = self.volumes(lang)
        feat_book = P.featured
        feat_vol = next(v for v in vols if v["slug"] == feat_book.slug)
        cov = self.img_set(self.cover_png(feat_book, lang), f"cover-{lang}-story", feat_book.slug, widths=(480, 800), jpg_w=800)
        covers = []
        for b in books:
            v = next(v for v in vols if v["slug"] == b.slug)
            c = cov if b is feat_book else self.img_set(self.cover_png(b, lang), f"cover-{lang}-story", b.slug, widths=(480, 800), jpg_w=800)
            covers.append({"cover": c, "url": v["url"], "title": b.title(lang), "subtitle": b.subtitle(lang)})
        og = {b.slug: self.og_card(b, lang) for b in books}
        og_abs = lambda b: (self.site_url + og[b.slug]) if self.site_url else None
        read0 = self.path(lang, self.seg(lang, "books"), self.book_slug(feat_book, lang), self.seg(lang, "read"))
        # ---- home
        self.page(lang, "home.html.j2",
                  {"feat": {"read_url": read0, "url": feat_vol["url"], "title": feat_book.title(lang), "subtitle": feat_book.subtitle(lang), "cover": cov},
                   "covers": covers,
                   "volumes": vols},
                  lambda l: self.path(l), f"{lang}/index.html", series["names"][lang] + " · " + t["home"]["title"], t["home"]["lead"],
                  og_image=og_abs(feat_book),
                  jsonld={"@context": "https://schema.org", "@type": "WebSite", "name": series["names"][lang], "inLanguage": lang,
                          "description": series["descriptions"][lang], **({"url": self.abs(self.path(lang))} if self.site_url else {})})
        # ---- books index
        self.page(lang, "books.html.j2", {"volumes": vols, "series_desc": series["descriptions"][lang]},
                  lambda l: self.path(l, self.seg(l, "books")), f"{lang}/{self.seg(lang, 'books')}/index.html",
                  f'{t["home"]["volumes"]} · {series["names"][lang]}', series["descriptions"][lang], "books", og_image=og_abs(feat_book))
        # ---- about / contact / legal / parents
        self.page(lang, "about.html.j2", {"volumes": vols, "author": series.get("author", {}).get("name", "")},
                  lambda l: self.path(l, self.seg(l, "about")), f"{lang}/{self.seg(lang, 'about')}/index.html",
                  f'{t["about"]["title"]} · {series["names"][lang]}', t["about"]["p1"], "about")
        contact_email = series["site"].get("contact_email", "")
        self.page(lang, "contact.html.j2", {"email": contact_email, "sent": False},
                  lambda l: self.path(l, self.seg(l, "contact")), f"{lang}/{self.seg(lang, 'contact')}/index.html",
                  f'{t["contact"]["title"]} · {series["names"][lang]}', t["contact"]["lead"], "contact")
        pub = series["publisher"]
        self.page(lang, "legal.html.j2", {"publisher": pub.get("name", ""), "address": pub.get("address", ""), "email": contact_email},
                  lambda l: self.path(l, self.seg(l, "legal")), f"{lang}/{self.seg(lang, 'legal')}/index.html",
                  f'{t["legal"]["title"]} · {series["names"][lang]}', t["legal"]["privacy"][:150], "", noindex=False)
        for book in books:
            self.build_book_pages(book, lang, og_abs(book), og[book.slug])
        # parents page: one block per book (its "for teachers and parents" guide section + its own content note)
        pblocks = []
        for b in books:
            g = b.guide(lang)
            Cb = Common(b, lang, lambda *_: "")
            sec = next((x for x in g.sections if x.number and re.search(r"teachers and parents|enseignants|maestros", x.title, re.I)), None)
            note = b.cfg.get("parents_note", {}).get(lang)
            pblocks.append({"title": f"{b.title(lang)}: {b.subtitle(lang)}", "note": note,
                            "html": Cb.guide_section_body(sec) if sec else "",
                            "guide_url": self.path(lang, self.seg(lang, "books"), self.book_slug(b, lang), self.seg(lang, "guide")),
                            "slug": b.slug})
        self.page(lang, "parents.html.j2", {"blocks": pblocks},
                  lambda l: self.path(l, self.seg(l, "parents")), f"{lang}/{self.seg(lang, 'parents')}/index.html",
                  f'{t["parents"]["title"]} · {series["names"][lang]}', t["parents"]["lead"], "parents")

    def build_book_pages(self, book: Book, lang: str, og_abs: str | None, og_rel: str):
        P, t = self.P, self.tx[lang]
        series = P.series
        slug = book.slug
        ms = book.manuscript(lang)
        guide = book.guide(lang)
        bs = lambda l: self.book_slug(book, l)
        book_url = self.path(lang, self.seg(lang, "books"), bs(lang))
        read_url = self.path(lang, self.seg(lang, "books"), bs(lang), self.seg(lang, "read"))
        guide_url = self.path(lang, self.seg(lang, "books"), bs(lang), self.seg(lang, "guide"))
        title, sub = book.title(lang), book.subtitle(lang)
        facts = self._facts(guide)
        place = facts[0][1] if len(facts) > 0 else book.cfg["place"][lang]
        time_range = facts[1][1] if len(facts) > 1 else ""
        form_text = facts[3][1] if len(facts) > 3 else ""
        gallery = []
        for aid in book.cfg.get("site", {}).get("gallery", []):
            im = self.illus.get(f"{slug}:{aid}")
            if not im:
                continue
            slot = book.register["slots"][aid]
            thumb = self.img_set(Path(Art(book).get(aid).web), aid + "-t", slug, widths=(640,), jpg_w=640)
            gallery.append({"full": im["full"], "thumb": thumb["src"], "w": thumb["w"], "h": thumb["h"], "cap": slot["scene"][lang],
                            "alt": slot["alt"][lang]})
        # editions
        dl = lambda ed, l=lang: f"{self.base}/downloads/{slug}/{slug}_{l}_{ed}.epub" if (self.out / "downloads" / slug / f"{slug}_{l}_{ed}.epub").exists() else ""
        buy = book.cfg.get("buy_links", {})
        editions = [
            {"title": t["book"]["ed_story"], "text": t["book"]["ed_story_p"], "epub": dl("story"), "buy": (buy.get("story") or {}).get(lang, "")},
            {"title": t["book"]["ed_guide"], "text": t["book"]["ed_guide_p"], "epub": dl("guide"), "buy": (buy.get("guide") or {}).get(lang, "")},
        ]
        cov = self.img_set(self.cover_png(book, lang), f"cover-{lang}-story", slug, widths=(480, 800), jpg_w=800)
        jsonld = {"@context": "https://schema.org", "@type": "Book", "name": f"{title}: {sub}", "alternateName": sub,
                  "inLanguage": lang, "description": " ".join(book.cfg["blurbs"][lang]), "genre": "Children's fiction",
                  "audience": {"@type": "PeopleAudience", "suggestedMinAge": book.cfg["age_range"][0], "suggestedMaxAge": book.cfg["age_range"][1]},
                  "isPartOf": {"@type": "BookSeries", "name": series["names"][lang]}, "position": book.cfg["volume"],
                  "keywords": ", ".join(book.cfg["keywords"][lang]),
                  "workExample": [{"@type": "Book", "bookFormat": "https://schema.org/EBook", "inLanguage": lang,
                                  **({"isbn": book.cfg["isbn"]["ebook"][lang]} if book.cfg["isbn"]["ebook"].get(lang) else {})},
                                 {"@type": "Book", "bookFormat": "https://schema.org/Paperback", "inLanguage": lang,
                                  **({"isbn": book.cfg["isbn"]["story"][lang]} if book.cfg["isbn"]["story"].get(lang) else {})}]}
        if series.get("author", {}).get("name"):
            jsonld["author"] = {"@type": "Person", "name": series["author"]["name"]}
        if series["publisher"].get("name"):
            jsonld["publisher"] = {"@type": "Organization", "name": series["publisher"]["name"]}
        if self.site_url:
            jsonld["image"] = self.site_url + cov["src"]
            jsonld["url"] = self.abs(book_url)
        ts = ""
        self.page(lang, "book.html.j2",
                  {"slug": slug, "cover": cov, "title": title, "subtitle": sub, "tagline": book.cfg["taglines"][lang],
                   "blurb": book.cfg["blurbs"][lang], "volume": book.cfg["volume"], "read_url": read_url, "guide_url": guide_url,
                   "place": place, "time_range": time_range, "form_text": form_text,
                   "lang_name": series["language_names"][lang], "age_value": book.cfg.get("age_label", {}).get(lang) or t["book"]["age_value"], "characters": self._characters(guide), "gallery": gallery,
                   "editions": editions, "ts": ts},
                  lambda l: self.path(l, self.seg(l, "books"), bs(l)), f"{lang}/{self.seg(lang, 'books')}/{bs(lang)}/index.html",
                  f"{title}: {sub} · {series['names'][lang]}", book.cfg["short_descriptions"][lang], "books", og_image=og_abs,
                  jsonld=jsonld, og_type="book")
        # ---- reader
        C = Common(book, lang, self.fig_fn(book, lang))
        readable = [s for s in ms.sections if s.kind in ("prologue", "chapter", "epilogue", "glossary", "note")]
        access = book.cfg.get("reader", {}).get("access", "full")
        nsample = book.cfg.get("reader", {}).get("sample_chapters", 3)
        allowed = [s for s in readable if access == "full" or s.kind == "prologue" or (s.kind == "chapter" and s.number <= nsample)]
        parts = {s.number: s for s in ms.sections if s.kind == "part"}
        sec_url = lambda l, sid: self.path(l, self.seg(l, "books"), bs(l), self.seg(l, "read"), self.sslug(l, sid))
        items = []
        last_part = None
        for s in ms.sections:
            if s.kind == "part":
                items.append({"part": True, "label": strip_tags(s.label), "title": s.title})
            elif s in readable:
                items.append({"part": False, "num": s.number, "title": s.title, "date": s.date if s.kind in ("chapter", "epilogue") else "",
                              "url": sec_url(lang, s.id), "locked": s not in allowed})
        first_url = sec_url(lang, allowed[0].id)
        self.page(lang, "read_toc.html.j2", {"items": items, "slug": slug, "title": title, "book_url": book_url, "guide_url": guide_url,
                                             "first_url": first_url},
                  lambda l: self.path(l, self.seg(l, "books"), bs(l), self.seg(l, "read")),
                  f"{lang}/{self.seg(lang, 'books')}/{bs(lang)}/{self.seg(lang, 'read')}/index.html",
                  f"{t['reader']['contents']} · {title}", book.cfg["short_descriptions"][lang], "books", og_image=og_abs)
        for i, s in enumerate(allowed):
            prev = allowed[i - 1] if i > 0 else None
            nxt = allowed[i + 1] if i + 1 < len(allowed) else None
            part = parts.get(s.part_index) if s.part_index else None
            body = C.section_body(s)
            sample_end = access != "full" and nxt is None and s != readable[-1]
            desc = re.sub(r"\s+", " ", strip_tags(next((b.html for b in s.blocks if b.kind == "p"), "")))[:155]
            self.page(lang, "chapter.html.j2",
                      {"sec": s, "slug": slug, "sound": C.sound_html(s), "body": body, "toc_url": read_url, "book_url": book_url, "guide_url": guide_url,
                       "part_line": f'{strip_tags(part.label)} · {part.title}' if part else "", "sample_end": sample_end,
                       "prev": {"url": sec_url(lang, prev.id), "title": prev.title} if prev else None,
                       "next": {"url": sec_url(lang, nxt.id), "title": nxt.title} if nxt else None},
                      (lambda sid: (lambda l: sec_url(l, sid)))(s.id),
                      f"{lang}/{self.seg(lang, 'books')}/{bs(lang)}/{self.seg(lang, 'read')}/{self.sslug(lang, s.id)}/index.html",
                      f"{(s.label + ' · ') if s.label else ''}{s.title} · {title}", desc, "books", og_image=og_abs, og_type="article")
        # ---- guide page
        facts_html = ""
        sections = []
        for s in guide.sections:
            if s.kind == "guide-facts":
                facts_html = C.table(s.blocks[0])
                continue
            nav = (f"{s.number}. " if s.number else "") + s.title
            sections.append({"id": s.id, "nav": nav, "html": C.guide_section_body(s)})
        self.page(lang, "guide.html.j2",
                  {"slug": slug, "title": title, "book_url": book_url, "intro": C.T(guide.intro), "before": [C.T(b) for b in guide.before], "facts": facts_html, "sections": sections},
                  lambda l: self.path(l, self.seg(l, "books"), bs(l), self.seg(l, "guide")),
                  f"{lang}/{self.seg(lang, 'books')}/{bs(lang)}/{self.seg(lang, 'guide')}/index.html",
                  f"{t['guide']['title']} · {title}", t["guide"]["spoiler"], "books", og_image=og_abs)

    # ---------------------------------------------------------------- root + support files
    def build_root(self):
        P = self.P
        series = P.series
        book = P.featured
        cover = self.img_set(self.cover_png(book, series["default_language"]), "cover-root", book.slug, widths=(480,), jpg_w=480)
        pic = (f'<picture><source type="image/webp" srcset="{cover["webp"]}"><img src="{cover["src"]}" width="{cover["w"]}" height="{cover["h"]}" '
               f'alt="" style="border-radius:6px 12px 12px 6px"></picture>')
        html = self.env.get_template("root.html.j2").render(
            names=series["names"], desc=series["descriptions"], langs=self.langs, lang_names=series["language_names"], base=self.base,
            ver=VERSION, abs_url=lambda l: self.abs(self.path(l)) or self.path(l), canonical=self.abs(self.path(series["default_language"])),
            cover=pic, choose={l: self.tx[l]["root"]["choose"] for l in self.langs})
        self.write("index.html", html)
        e404 = self.env.get_template("e404.html.j2").render(base=self.base, ver=VERSION, langs=self.langs,
                                                            tx={l: {"title": self.tx[l]["e404"]["title"], "text": self.tx[l]["e404"]["text"]} for l in self.langs})
        self.write("404.html", e404)

    def build_support_files(self):
        site = self.site_url or "https://YOURDOMAIN.com"
        if not self.site_url:
            self.warnings.append("series.json site.url is empty: sitemap.xml uses https://YOURDOMAIN.com (set the real address and rebuild)")
        today = dt.date.today().isoformat()
        urls = []
        for p in self.pages:
            loc = (self.site_url + p["path"]) if self.site_url else site + p["path"]
            alt = "".join(f'<xhtml:link rel="alternate" hreflang="{l}" href="{esc((site + h) if h.startswith("/") else h)}"/>' for l, h in p["peers"])
            urls.append(f"<url><loc>{esc(loc)}</loc><lastmod>{today}</lastmod>{alt}</url>")
        self.write("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
                   'xmlns:xhtml="http://www.w3.org/1999/xhtml">' + "".join(urls) + "</urlset>")
        self.write("robots.txt", f"User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: {site}{self.base}/sitemap.xml\n")
        self.write(".htaccess", self.htaccess())
        self.write("README-DEPLOY.txt",
                   "Upload the CONTENTS of this folder to public_html on Hostinger.\n"
                   "(If you work from the two zip files in release/: extract my-corner-of-the-world_public_html.zip and then\n"
                   " my-corner-of-the-world_downloads.zip into the same folder; the second one holds the EPUB downloads.)\n"
                   "Then copy api/config.sample.php to api/config.php and fill it in (owner email, mail_from).\n"
                   "Full instructions: my-corner-of-the-world/README.md\n")

    def htaccess(self) -> str:
        b = self.base
        return f"""# My Corner of the World: Hostinger / LiteSpeed / Apache
DirectoryIndex index.html index.php
Options -Indexes
ErrorDocument 404 {b}/404.html

<IfModule mod_rewrite.c>
  RewriteEngine On
  # force HTTPS (Hostinger issues free SSL)
  RewriteCond %{{HTTPS}} off
  RewriteCond %{{HTTP:X-Forwarded-Proto}} !https
  RewriteRule ^ https://%{{HTTP_HOST}}%{{REQUEST_URI}} [L,R=301]
</IfModule>

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css application/javascript application/json image/svg+xml application/xml
</IfModule>

<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType font/woff2 "access plus 1 year"
  ExpiresByType image/webp "access plus 1 year"
  ExpiresByType image/jpeg "access plus 1 year"
  ExpiresByType image/png "access plus 1 year"
  ExpiresByType image/svg+xml "access plus 1 year"
  ExpiresByType text/css "access plus 1 month"
  ExpiresByType application/javascript "access plus 1 month"
  ExpiresByType application/epub+zip "access plus 1 week"
  ExpiresByType text/html "access plus 1 hour"
</IfModule>

AddType application/epub+zip .epub
AddType font/woff2 .woff2

<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set X-Frame-Options "SAMEORIGIN"
  Header always set Permissions-Policy "camera=(), microphone=(), geolocation=(), interest-cohort=()"
  Header always set Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self'; form-action 'self'; frame-ancestors 'self'; base-uri 'self'"
  <FilesMatch "\\.(woff2|webp|jpg|png|svg)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
</IfModule>

# never serve server-side config or stored data
<FilesMatch "^(config\\.php|subscribers\\.csv)$">
  Require all denied
</FilesMatch>
"""

    def make_zip(self) -> Path:
        """Two archives, each under GitHub's 100 MB file limit: the site itself, and the EPUB downloads (unzip both into the same folder)."""
        out = RELEASE / f"{self.P.series['id']}_public_html.zip"
        dl = RELEASE / f"{self.P.series['id']}_downloads.zip"
        out.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z, zipfile.ZipFile(dl, "w", zipfile.ZIP_STORED) as zd:
            for p in sorted(self.out.rglob("*")):
                if p.is_file() and p.name != "config.php" and "subscribers.csv" not in p.name:
                    rel = p.relative_to(self.out).as_posix()
                    (zd if rel.startswith("downloads/") else z).write(p, rel)
        self.downloads_zip = dl
        return out


def build_site(P: Project):
    sb = SiteBuilder(P)
    z = sb.build()
    n = sum(1 for _ in sb.out.rglob("*.html"))
    print(f"[site] {n} HTML pages, {len(sb.pages)} in sitemap -> {sb.out}")
    print(f"[site] deploy zip: {z} ({z.stat().st_size // 1024} KB)")
    print(f"[site] downloads zip (EPUBs, extract into the same folder): {sb.downloads_zip} ({sb.downloads_zip.stat().st_size // 1024} KB)")
    for w in sb.warnings:
        print("   !", w)
