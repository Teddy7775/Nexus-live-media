"""Cover wrap (back | spine | front) as print-ready PDF, a proof PDF with guides, and a front-cover PNG.

Geometry (inches): width = bleed + trim + spine + trim + bleed, height = trim_h + 2*bleed.
Spine thickness = page count x paper factor (KDP figures; confirm with your printer's template).
"""
from __future__ import annotations

import html as _html
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

from .art import Art
from .browser import launch
from .core import BUILD, RELEASE, ROOT, Book

FONTS = ROOT / "assets" / "fonts"
PAPER = {"white": 0.002252, "cream": 0.0025, "premium_color": 0.002347}

STR = {
    "en": {"ages": "Ages 9–13", "guide_pill": "Includes the Discovery Guide", "series": "My Corner of the World",
           "ph_author": "[AUTHOR NAME]", "ph_pub": "[PUBLISHER]"},
    "fr": {"ages": "Pour les 9–13 ans", "guide_pill": "Avec le guide de découverte", "series": "Mon coin du monde",
           "ph_author": "[NOM DE L’AUTEUR]", "ph_pub": "[ÉDITEUR]"},
    "es": {"ages": "Para lectores de 9 a 13 años", "guide_pill": "Con guía de descubrimiento", "series": "Mi rincón del mundo",
           "ph_author": "[NOMBRE DEL AUTOR]", "ph_pub": "[EDITORIAL]"},
}


VOL = {"en": "Volume {n}", "fr": "Tome {n}", "es": "Volumen {n}"}


def esc(s):
    return _html.escape(s, quote=True)


def spine_in(pages: int, paper: str) -> float:
    return round(pages * PAPER[paper], 4)


class CoverBuilder:
    def __init__(self, book: Book, lang: str, edition: str, pages: int, mode: str = "proof"):
        self.book, self.lang, self.edition, self.pages, self.mode = book, lang, edition, pages, mode
        self.S = STR[lang]
        self.art = Art(book)
        pr = book.cfg["print"]
        self.tw, self.th = pr["trim_in"]
        self.b = pr["bleed_in"]
        self.spine = spine_in(pages, pr["paper"])
        self.W = round(self.b * 2 + self.tw * 2 + self.spine, 4)
        self.H = round(self.th + 2 * self.b, 4)
        self.cfg = book.cfg.get("cover", {})
        self.paper = self.cfg.get("style") == "paper"          # dark text on a cream upper area, no dark shade
        self.out = BUILD / book.slug / "cover" / f"{lang}-{edition}"
        self.out.mkdir(parents=True, exist_ok=True)
        self.warnings: list[str] = []

    # ---------------------------------------------------------------------
    def art_id(self, side: str) -> str:
        """Register id of the front/back cover image ('side' key, or the C01 / C04 naming of Volume 1)."""
        slots = self.book.register["slots"]
        for aid, sl in slots.items():
            if sl["kind"] == "cover" and sl.get("side") == side:
                return aid
        return next(a for a in slots if a.endswith("C01" if side == "front" else "C04"))

    def back_opt(self, key: str, default):
        """cover.back option; may be one value or a {lang: value} map (translations differ in length)."""
        v = self.cfg.get("back", {}).get(key, default)
        return v.get(self.lang, default) if isinstance(v, dict) else v

    def vol_label(self) -> str:
        if self.cfg.get("show_volume", True) is False:
            return ""
        return VOL[self.lang].format(n=self.book.cfg["volume"])

    def age_label(self) -> str:
        return self.cfg.get("age", {}).get(self.lang) or self.S["ages"]

    def front_html(self, proof: bool) -> str:
        bk, lang, S = self.book, self.lang, self.S
        pal = bk.palette
        fid = self.art_id("front")
        af = self.art.get(fid)
        crop_top = self.cfg.get("front_crop_top_in", 0.75)
        fw = self.tw + self.b           # front panel width incl. outer bleed
        if af and self.cfg.get("front", {}).get("fit") == "width":
            f, _, _ = self.art.panel_fit(fid, fw, self.H, self.cfg["front"].get("anchor", "bottom"))
            img = (f'<img src="{f.resolve().as_uri()}" style="position:absolute;left:0;top:0;width:{fw:.3f}in;height:{self.H:.3f}in" alt="">')
        elif af:
            img_h = fw / af.aspect
            img = (f'<img src="{af.web.resolve().as_uri()}" style="position:absolute;left:0;top:{-crop_top:.3f}in;'
                   f'width:{fw:.3f}in;height:{img_h:.3f}in" alt="">')
            if img_h - crop_top < self.H - 0.01:
                self.warnings.append("front art too short for the cover height; adjust cover.front_crop_top_in")
        else:
            img = f'<div style="position:absolute;inset:0;background:{pal["paper"]}"></div>'
            self.warnings.append(f"{fid} artwork missing")
        title = esc(bk.title(lang))
        sub = esc(bk.cfg.get("descriptors", {}).get(lang) or bk.subtitle(lang))
        tparts = bk.cfg.get("cover", {}).get("title_lines", {}).get(lang)
        title_html = "<br>".join(esc(x) for x in tparts) if tparts else title
        author = self.book.series.get("author", {}).get("name", "")
        author_html = esc(author) if author else (f'<span class="todo">{esc(S["ph_author"])}</span>' if proof else "")
        pill_txt = esc(S["guide_pill"])
        tsize = self.cfg.get("title_pt", {}).get(lang, 40)
        if self.paper:       # the guide badge sits under the descriptor, inside the quiet upper area
            pill = f'<div class="pill in-flow">{pill_txt}</div>' if self.edition == "guide" else ""
            shade, pill_abs = "", ""
        else:
            pill, shade = "", '<div class="shade"></div>'
            pill_abs = f'<div class="pill">{pill_txt}</div>' if self.edition == "guide" else ""
        return f'''<div class="front" style="left:{self.b + self.tw + self.spine:.4f}in;width:{fw:.4f}in">
  {img}
  {shade}
  <div class="ftxt" style="padding-left:{0.5:.2f}in;padding-right:{self.b + 0.5:.3f}in">
    <div class="series">{esc(S["series"].upper())}</div>
    <div class="title" style="font-size:{tsize}pt">{title_html}</div>
    <div class="sub">{sub}</div>
    {pill}
  </div>
  {pill_abs}
  <div class="author" style="padding-right:{self.b:.3f}in">{author_html}</div>
</div>'''

    def spine_html(self, proof: bool) -> str:
        bk, lang = self.book, self.lang
        author = self.book.series.get("author", {}).get("name", "")
        a = esc(author) if author else (f'<span class="todo">{esc(self.S["ph_author"])}</span>' if proof else "")
        x = self.b + self.tw
        text = ""
        if self.spine >= 0.25:
            text = (f'<div class="sp-t"><span class="sp-title">{esc(bk.title(lang))}</span>'
                    f'<span class="sp-by">{a}</span></div>')
        orn = ('<svg class="sp-orn" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M10 1 L17 10 L10 19 L3 10 Z" '
               f'fill="none" stroke="{bk.palette["pale"]}" stroke-width="1.2"/><path d="M10 1V19M3 10H17" stroke="{bk.palette["pale"]}" stroke-width=".7"/></svg>') if self.spine >= 0.25 else ""
        return f'<div class="spine" style="left:{x:.4f}in;width:{self.spine:.4f}in">{text}{orn}</div>'

    def back_html(self, proof: bool) -> str:
        bk, lang, S = self.book, self.lang, self.S
        bid = self.art_id("back")
        af = self.art.get(bid)
        bw = self.b + self.tw
        bcfg = self.cfg.get("back", {})
        if af and bcfg.get("fit") == "width":
            f, _, _ = self.art.panel_fit(bid, bw, self.H, bcfg.get("anchor", "bottom"), tuple(bcfg.get("crop", (0, 0))))
            img = (f'<img src="{f.resolve().as_uri()}" style="position:absolute;left:0;top:0;width:{bw:.3f}in;height:{self.H:.3f}in" alt="">')
        elif af:
            iw = max(bw, self.H * af.aspect)          # cover-fit: never leave a strip of paper at an edge
            ih = iw / af.aspect
            top = -(max(ih - self.H, 0)) / 2
            img = (f'<img src="{af.web.resolve().as_uri()}" style="position:absolute;left:0;top:{top:.3f}in;'
                   f'width:{iw:.3f}in;height:{ih:.3f}in" alt="">')
        else:
            img = f'<div style="position:absolute;inset:0;background:{bk.palette["paper"]}"></div>'
            self.warnings.append(f"{bid} artwork missing")
        blurb = bk.cfg["blurbs"][lang]
        tag = esc(bk.cfg["taglines"][lang])
        paras = "".join(f"<p>{esc(p)}</p>" for p in blurb)
        pub = self.book.series["publisher"]["name"]
        site = self.book.series["site"]["url"]
        pubtxt = esc(pub) if pub else (f'<span class="todo">{esc(S["ph_pub"])}</span>' if proof else "")
        sitetxt = esc(site.replace("https://", "").replace("http://", "")) if site else ""
        barcode_lbl = '<div class="bc-lbl">BARCODE / ISBN AREA 2.0 × 1.2 in</div>' if proof else ""
        publine = f'<div class="bpub">{pubtxt}{(" · " + sitetxt) if (pub or sitetxt) and sitetxt else ""}</div>'
        if bcfg.get("barcode_in_art"):       # the artwork already carries the quiet box for the barcode
            bb = bcfg["barcode_box_in"]
            foot = (f'<div class="bfoot r" style="right:{bb["right"]}in;bottom:{bb["bottom"] + bb["h"] + 0.14:.3f}in">{publine}</div>')
            barcode = (f'<div class="bcbox" style="right:{bb["right"]}in;bottom:{bb["bottom"]}in;width:{bb["w"]}in;height:{bb["h"]}in">{barcode_lbl}</div>' if proof else "")
        else:
            foot = f'<div class="bfoot" style="left:{self.b + 0.55:.3f}in;bottom:{self.b + 0.5:.3f}in">{publine}</div>'
            barcode = f'<div class="barcode" style="right:{0.55:.3f}in;bottom:{self.b + 0.5:.3f}in">{barcode_lbl}</div>'
        return f'''<div class="back" style="width:{bw:.4f}in">
  {img}
  <div class="btxt" style="left:{self.b + 0.55:.3f}in;right:0.55in;top:{self.b + 0.55:.3f}in">
    <div class="bser">{esc(S["series"].upper())}{(" · " + esc(self.vol_label().upper())) if self.vol_label() else ""}</div>
    <div class="btag">{tag}</div>
    {paras}
    <div class="bages">{esc(self.age_label())}</div>
  </div>
  {foot}
  {barcode}
</div>'''

    def guides_html(self) -> str:
        b, W, H, tw, sp = self.b, self.W, self.H, self.tw, self.spine
        L = []
        def vline(x, color, label=""):
            L.append(f'<div class="gl v" style="left:{x:.4f}in;background:{color}"></div>')
        def hline(y, color):
            L.append(f'<div class="gl h" style="top:{y:.4f}in;background:{color}"></div>')
        for x in (b, W - b, b + tw, b + tw + sp):
            vline(x, "#e6007e")
        for y in (b, H - b):
            hline(y, "#e6007e")
        # safe zones (0.25 in inside trim)
        for x in (b + 0.25, W - b - 0.25):
            vline(x, "#00a0e0")
        for y in (b + 0.25, H - b - 0.25):
            hline(y, "#00a0e0")
        L.append(f'<div class="gtxt" style="left:{b + tw + 0.04:.3f}in;top:0.03in">SPINE {sp:.3f} in · {self.pages} pp</div>')
        L.append(f'<div class="gtxt" style="left:0.06in;top:0.03in">magenta = trim · cyan = 0.25 in safe zone · bleed {b} in</div>')
        return "".join(L)

    def paper_css(self) -> str:
        pal = self.book.palette
        css = f'.bfoot.r{{left:auto;text-align:right}} .bcbox{{position:absolute;outline:.5pt dashed #e6007e}}'
        if self.paper:
            css += (f'.title,.sub{{text-shadow:none}} .author{{color:{pal["indigo"]};bottom:{self.b + 0.32:.3f}in;font-size:10.5pt}}'
                    f'.pill.in-flow{{position:static;display:inline-block;margin-top:.26in}}'
                    f'.bfoot,.bpub{{color:{pal["indigo"]};text-shadow:none}}')
        return css

    def html(self, proof: bool, guides: bool) -> str:
        bk, pal = self.book, self.book.palette
        f = FONTS.resolve().as_uri()
        css = f'''
@font-face{{font-family:"Literata";font-weight:400;font-style:normal;src:url("{f}/literata-latin-400-normal.woff2")}}
@font-face{{font-family:"Literata";font-weight:400;font-style:italic;src:url("{f}/literata-latin-400-italic.woff2")}}
@font-face{{font-family:"Literata";font-weight:600;font-style:normal;src:url("{f}/literata-latin-600-normal.woff2")}}
@font-face{{font-family:"Literata";font-weight:700;font-style:normal;src:url("{f}/literata-latin-700-normal.woff2")}}
@font-face{{font-family:"Nunito Sans";font-weight:700;src:url("{f}/nunito-sans-latin-700-normal.woff2")}}
@font-face{{font-family:"Nunito Sans";font-weight:800;src:url("{f}/nunito-sans-latin-800-normal.woff2")}}
@font-face{{font-family:"Nunito Sans";font-weight:600;src:url("{f}/nunito-sans-latin-600-normal.woff2")}}
@page{{size:{self.W}in {self.H}in;margin:0}}
*{{box-sizing:border-box}} html,body{{margin:0;padding:0}} body{{width:{self.W}in;height:{self.H}in;position:relative;overflow:hidden;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
.front,.back,.spine{{position:absolute;top:0;height:{self.H}in;overflow:hidden}} .back{{left:0}}
.shade{{position:absolute;left:0;right:0;bottom:0;height:2.1in;background:linear-gradient(to top,rgba(36,46,66,.82),rgba(36,46,66,.0))}}
.ftxt{{position:absolute;left:0;right:0;top:{self.b + 0.42:.3f}in;color:{pal["indigo"]};text-align:left}}
.series{{font:800 8pt "Nunito Sans";letter-spacing:.3em;color:{pal["ember"]};margin-bottom:.1in}}
.title{{font:600 40pt/0.98 "Literata";letter-spacing:-.01em;text-shadow:0 0 .22in rgba(255,255,255,.55),0 0 .08in rgba(255,255,255,.5)}}
.sub{{font:italic 400 15.5pt/1.2 "Literata";margin-top:.12in;color:{pal["petrol"]};text-shadow:0 0 .14in rgba(255,255,255,.7)}}
.pill{{position:absolute;left:.5in;bottom:{self.b + 0.88:.3f}in;background:{pal["paper"]};color:{pal["indigo"]};font:700 7.4pt "Nunito Sans";letter-spacing:.12em;text-transform:uppercase;padding:.055in .15in;border-radius:.2in}}
.author{{position:absolute;left:.5in;right:0;bottom:{self.b + 0.42:.3f}in;font:700 12pt "Nunito Sans";letter-spacing:.24em;text-transform:uppercase;color:#fff}}
.spine{{background:{pal[self.cfg.get("spine_color", "indigo")]};color:{pal["paper"]}}}
.sp-t{{position:absolute;left:0;right:0;top:.55in;bottom:1in;display:flex;align-items:center;justify-content:space-between;writing-mode:vertical-rl;padding:0 0}}
.sp-title{{font:600 13.5pt "Literata";white-space:nowrap}} .sp-by{{font:700 8pt "Nunito Sans";letter-spacing:.24em;text-transform:uppercase;white-space:nowrap;color:{pal["pale"]}}}
.sp-orn{{position:absolute;left:50%;margin-left:-.1in;bottom:.5in;width:.2in;height:.2in}}
.btxt{{position:absolute;color:{pal["indigo"]}}}
.btag{{font:italic 400 15pt/1.25 "Literata";color:{pal["ember"]};margin-bottom:.22in}}
.btxt p{{margin:0 0 .13in;font:400 {self.back_opt("text_pt", 10.6)}pt/{self.back_opt("leading", 1.5)} "Literata";color:#2b2a35}}
.bages{{margin-top:.2in;font:800 7.8pt "Nunito Sans";letter-spacing:.2em;text-transform:uppercase;color:{pal["petrol"]}}}
.bfoot{{position:absolute;color:#fff}} .bser{{font:800 7.4pt "Nunito Sans";letter-spacing:.2em;color:{pal["ember"]};margin-bottom:.16in}} .bpub{{font:700 7.8pt "Nunito Sans";letter-spacing:.06em;color:#fff;text-shadow:0 0 .08in rgba(0,0,0,.6)}}
.barcode{{position:absolute;width:2in;height:1.2in;background:#fff}}
{self.paper_css()}
.todo{{background:#ffe9a8;color:#7a3b00;padding:0 .06in;border-radius:2px}}
.gl{{position:absolute;pointer-events:none;z-index:50}} .gl.v{{top:0;bottom:0;width:.4pt}} .gl.h{{left:0;right:0;height:.4pt}}
.gtxt{{position:absolute;z-index:60;font:600 6.5pt "Nunito Sans";color:#e6007e;background:rgba(255,255,255,.8);padding:0 .04in}}
.bc-lbl{{font:600 6.5pt "Nunito Sans";color:#e6007e;padding:.05in}}
'''
        body = self.back_html(proof=guides) + self.spine_html(proof=guides) + self.front_html(proof=guides)
        if guides:
            body += self.guides_html()
        return f'<!doctype html><html lang="{self.lang}"><head><meta charset="utf-8"><style>{css}</style></head><body>{body}</body></html>'

    # ---------------------------------------------------------------------
    def _pdf(self, html: str, path: Path):
        hp = path.with_suffix(".html")
        hp.write_text(html, encoding="utf-8")
        with sync_playwright() as p:
            br = launch(p)
            pg = br.new_page()
            pg.goto(hp.resolve().as_uri(), wait_until="load")
            pg.evaluate("document.fonts.ready")
            pg.wait_for_timeout(300)
            pg.pdf(path=str(path), prefer_css_page_size=True, print_background=True)
            br.close()

    def front_png(self, path: Path, width_px: int = 1200):
        """Trimmed front cover (6 x 9 in) as PNG for the web, EPUB and social cards."""
        bk = self.book
        html = self.html(proof=False, guides=False)
        # crop: show only the front panel without bleed -> use clip in a screenshot
        dpi = 96
        hp = path.with_suffix(".html")
        hp.write_text(html, encoding="utf-8")
        scale = width_px / (self.tw * dpi)
        with sync_playwright() as p:
            br = launch(p)
            pg = br.new_page(viewport={"width": int(self.W * dpi) + 2, "height": int(self.H * dpi) + 2}, device_scale_factor=scale)
            pg.goto(hp.resolve().as_uri(), wait_until="load")
            pg.evaluate("document.fonts.ready")
            pg.wait_for_timeout(300)
            x0 = (self.b + self.tw + self.spine) * dpi
            pg.screenshot(path=str(path), clip={"x": x0, "y": self.b * dpi, "width": self.tw * dpi, "height": self.th * dpi})
            br.close()

    def build(self) -> dict:
        slug = f"{self.book.slug}_{self.lang}_{self.edition}"
        pr = self.out / f"{slug}_cover_wrap_PRINT.pdf"
        pf = self.out / f"{slug}_cover_wrap_PROOF.pdf"
        self._pdf(self.html(proof=False, guides=False), pr)
        self._pdf(self.html(proof=True, guides=True), pf)
        png = self.out / f"{slug}_front.png"
        self.front_png(png)
        return {"print": pr, "proof": pf, "front_png": png, "spine_in": self.spine, "size_in": (self.W, self.H),
                "warnings": self.warnings}
