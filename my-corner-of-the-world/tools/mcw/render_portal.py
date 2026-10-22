"""The portal at the domain root: a short list of the projects hosted on the domain, in EN / FR / ES.

Each project is a self-contained folder of the domain (<docroot>/<path>/) with its own pages, assets and form scripts, and
is built by its own generator (render_site.py builds this collection). The portal only knows what portal/projects.json
tells it, plus, for this collection, the names, descriptions and covers it already has. Adding a project = one entry in
portal/projects.json and its folder on the server; the other projects and their URLs do not change.
"""
from __future__ import annotations

import datetime as dt
import html as _html
import json
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from PIL import Image

from .core import PUBLIC, ROOT, Project, load_json
from .render_site import VERSION, SiteBuilder, make_htaccess

SITE = ROOT / "site"
PORTAL = ROOT / "portal"


def esc(s: str) -> str:
    return _html.escape(s, quote=True)


class PortalBuilder:
    def __init__(self, P: Project, sb: SiteBuilder, out: Path = PUBLIC):
        self.P, self.sb, self.out = P, sb, out
        self.reg = load_json(PORTAL / "projects.json")
        self.name = self.reg["name"]
        self.langs = P.langs
        self.site_url = sb.site_url
        self.tx = {}
        for l in self.langs:
            base = P.i18n(l)
            self.tx[l] = {k: base[k] for k in ("nav", "foot", "root", "e404")}
            self.tx[l]["portal"] = load_json(PORTAL / "i18n" / f"{l}.json")
        self.env = Environment(loader=FileSystemLoader([str(PORTAL / "templates"), str(SITE / "templates")]),
                               autoescape=select_autoescape(["html", "j2"]))
        self.pages: list[dict] = []
        self.warnings: list[str] = []

    # ---------------------------------------------------------------- helpers
    def abs(self, path: str) -> str | None:
        return f"{self.site_url}{path}" if self.site_url else None

    def write(self, rel: str, content: str):
        p = self.out / rel.lstrip("/")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")

    def home(self, lang: str) -> str:
        return f"/{lang}/"

    def project_covers(self, p: dict, lang: str) -> list[dict]:
        """The cover pictures this collection already published under its own folder (no copy: same pass, same files)."""
        out = []
        for b in sorted(self.P.books.values(), key=lambda b: b.cfg["volume"]):
            d = self.out / p["path"].strip("/") / "assets" / "img" / b.slug
            webp, jpg = d / f"cover-{lang}-story-480.webp", d / f"cover-{lang}-story.jpg"
            if not (webp.exists() and jpg.exists()):
                self.warnings.append(f"portal: cover of {b.slug} ({lang}) not found under {p['path']}; build the site in one pass")
                continue
            w, h = Image.open(jpg).size
            pre = f"{p['path']}/assets/img/{b.slug}/cover-{lang}-story"
            out.append({"url": self.sb.path(lang, self.sb.seg(lang, "books"), self.sb.book_slug(b, lang)),
                        "webp": f"{pre}-480.webp 480w", "src": f"{pre}.jpg", "w": w, "h": h,
                        "alt": f"{b.title(lang)}: {b.subtitle(lang)}"})
        return out

    def cards(self, lang: str) -> list[dict]:
        cards = []
        for p in self.reg["projects"]:
            if not p.get("visible"):
                continue
            live = p.get("status") == "live"
            if p.get("from_series"):
                s = self.P.series
                name, desc = s["names"][lang], s["descriptions"][lang]
                n = len(self.P.books)
                meta = f'{self.tx[lang]["portal"]["volumes"].format(n=n)} · {self.tx[lang]["portal"]["languages"]}'
                covers = self.project_covers(p, lang) if live else []
            else:
                names, descs = p.get("names", {}), p.get("descriptions", {})
                name = names.get(lang) or names.get("en") or p["id"]
                desc = descs.get(lang) or descs.get("en") or ""
                meta, covers = "", []
            cards.append({"name": name, "desc": desc, "meta": meta, "live": live, "covers": covers,
                          "href": f'{p["path"]}/{lang}/' if live else "", "first": not cards})
        return cards

    def page(self, lang: str, template: str, ctx: dict, cards: list[dict], rel_out: str, title: str, desc: str, jsonld: dict | None = None):
        alts = []
        for l in self.langs:
            pth = self.home(l)
            alts.append({"lang": l, "href_rel": pth, "href": self.abs(pth) or pth, "name": self.P.series["language_names"][l]})
        default = next((a["href"] for a in alts if a["lang"] == self.P.series["default_language"]), None)
        page = {"title": title, "description": desc, "canonical": self.abs(self.home(lang)),
                "jsonld": json.dumps(jsonld, ensure_ascii=False) if jsonld else None}
        nav = [{"name": c["name"], "href": c["href"]} for c in cards if c["live"]]
        u = {"home": self.home(lang), **{k: self.sb.u_nav(lang)[k] for k in ("contact", "legal")}}
        html = self.env.get_template(template).render(
            L=lang, t=self.tx[lang], u=u, ver=VERSION, page=page, alts=alts, alts_default=default,
            locale=self.P.series["locales"][lang], site_name=self.name, year=self.sb.year, holder=self.sb.holder,
            tagline=(self.reg.get("taglines") or {}).get(lang, ""), nav_projects=nav, **ctx)
        self.write(rel_out, html)
        self.pages.append({"lang": lang, "path": self.home(lang), "peers": [(a["lang"], a["href"]) for a in alts]})

    # ---------------------------------------------------------------- build
    def build(self) -> Path:
        s = self.P.series
        # shared look: same stylesheet, fonts, script and mark as the projects, served from the root
        import shutil
        shutil.copytree(SITE / "static", self.out / "assets", dirs_exist_ok=True)
        (self.out / "assets" / "fonts").mkdir(parents=True, exist_ok=True)
        for f in (ROOT / "assets" / "fonts").glob("*.woff2"):
            shutil.copyfile(f, self.out / "assets" / "fonts" / f.name)
        live = [p for p in self.reg["projects"] if p.get("visible") and p.get("status") == "live"]
        for lang in self.langs:
            cards = self.cards(lang)
            first = next((c for c in cards if c["live"]), None)
            lead = f'{first["name"]}: {first["desc"]}' if first and first["desc"] else self.name
            title = f'{self.name} · {self.tx[lang]["portal"]["title"]}'
            jsonld = {"@context": "https://schema.org", "@type": "WebSite", "name": self.name, "inLanguage": lang,
                      **({"url": self.abs(self.home(lang))} if self.site_url else {})}
            self.page(lang, "home.html.j2", {"projects": cards}, cards, f"{lang}/index.html", title, f"{self.name} · {lead}"[:300], jsonld)
        # language chooser at the root
        names = [s["names"][l] for l in self.langs] if live else []
        desc = f'{self.name} · ' + " · ".join(names) if names else self.name
        html = self.env.get_template("root.html.j2").render(
            site_name=self.name, desc=desc, langs=self.langs, lang_names=s["language_names"], ver=VERSION,
            abs_url=lambda l: self.abs(self.home(l)) or self.home(l), canonical=self.abs(self.home(s["default_language"])),
            choose={l: self.tx[l]["root"]["choose"] for l in self.langs})
        self.write("index.html", html)
        e404 = self.env.get_template("e404.html.j2").render(
            base="", ver=VERSION, langs=self.langs,
            tx={l: {"title": self.tx[l]["e404"]["title"], "text": self.tx[l]["e404"]["text"]} for l in self.langs})
        self.write("404.html", e404)
        self.support_files(live)
        return self.out

    def support_files(self, live: list[dict]):
        site = self.site_url or "https://YOURDOMAIN.com"
        if not self.site_url:
            self.warnings.append("series.json site.url is empty: sitemap.xml and robots.txt use https://YOURDOMAIN.com")
        today = dt.date.today().isoformat()
        urls = []
        for p in self.pages:
            alt = "".join(f'<xhtml:link rel="alternate" hreflang="{l}" href="{esc((site + h) if h.startswith("/") else h)}"/>' for l, h in p["peers"])
            urls.append(f"<url><loc>{esc(site + p['path'])}</loc><lastmod>{today}</lastmod>{alt}</url>")
        self.write("sitemap-portal.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
                   'xmlns:xhtml="http://www.w3.org/1999/xhtml">' + "".join(urls) + "</urlset>")
        maps = ["/sitemap-portal.xml"] + [f'{p["path"]}/sitemap.xml' for p in live if (self.out / p["path"].strip("/") / "sitemap.xml").exists()]
        self.write("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                   + "".join(f"<sitemap><loc>{esc(site + m)}</loc><lastmod>{today}</lastmod></sitemap>" for m in maps) + "</sitemapindex>")
        disallow = "".join(f"Disallow: {p['path']}/api/\n" for p in self.reg["projects"] if p.get("status") == "live")
        self.write("robots.txt", f"User-agent: *\nAllow: /\nDisallow: /api/\n{disallow}\nSitemap: {site}/sitemap.xml\n")
        self.write(".htaccess", make_htaccess("", self.name))
