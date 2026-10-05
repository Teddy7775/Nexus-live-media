"""Language-aware typography applied to rendered HTML (text nodes only).

* fr: non-breaking / narrow non-breaking spaces before ; ! ? : and inside « »,
      after dialogue dashes.
* en: no line break after Mr./Mrs./Ms./Dr., or inside initials like "A. S."
* es: protects the dialogue dash (— at paragraph start) and inverted marks.
* all: Devanagari runs are wrapped in <span class="deva" lang="hi"> and Khmer runs in
       <span class="khmer" lang="km"> so a font with the right glyphs is applied; optional soft hyphens for print.
"""
from __future__ import annotations

import re
from functools import lru_cache

import pyphen

NBSP = "\u00a0"
NNBSP = "\u00a0"  # narrow nbsp (U+202F) is missing from the bundled fonts; use the regular nbsp
SHY = "\u00ad"
TAG_SPLIT = re.compile(r"(<[^>]+>)")
DEVA = re.compile(r"([\u0900-\u097F]+(?:[\s\u00a0]+[\u0900-\u097F]+)*)")
KHMER = re.compile(r"([\u1780-\u17FF\u19E0-\u19FF]+(?:[\s\u00a0]+[\u1780-\u17FF\u19E0-\u19FF]+)*)")

_PYPHEN_LANG = {"en": "en_US", "fr": "fr", "es": "es"}


@lru_cache(maxsize=None)
def _dic(lang: str):
    return pyphen.Pyphen(lang=_PYPHEN_LANG.get(lang, "en_US"), left=3, right=3)


def _fr(t: str) -> str:
    t = re.sub(r"(&(?:#\d+|#x[0-9a-fA-F]+|[A-Za-z]+));", "\\1\x01", t)      # mask the ; that ends an HTML entity (&amp;)
    t = _fr_rules(t)
    return t.replace("\x01", ";")


def _fr_rules(t: str) -> str:
    # « text »  ->  «<nbsp>text<nbsp>»
    t = re.sub(r"«\s*", "«" + NBSP, t)
    t = re.sub(r"\s*»", NBSP + "»", t)
    # ; ! ?  -> narrow nbsp before (but not after an ellipsis or another mark)
    t = re.sub(r"(?<=[^\s;!?:…«])\s*([;!?])", NNBSP + r"\1", t)
    # :  -> nbsp before, except inside times/ratios (6:10) and URLs (https://)
    t = re.sub(r"(?<=[^\s:\d/])\s*:(?!//)", NBSP + ":", t)
    t = re.sub(r"(?<=\d)\s+:(?=\s)", NBSP + ":", t)
    # dialogue dash at the start of a text node: — Hello  ->  —<nbsp>Hello
    t = re.sub(r"^—\s+", "—" + NBSP, t)
    t = re.sub(r"(\d)\s+(h)\b", r"\1" + NBSP + r"\2", t)
    return t


def _en(t: str) -> str:
    t = re.sub(r"\b(Mr|Mrs|Ms|Dr)\.\s+(?=[A-Z])", lambda m: m.group(1) + "." + NBSP, t)
    t = re.sub(r"\b([A-Z])\.\s+(?=[A-Z]\.)", lambda m: m.group(1) + "." + NBSP, t)
    return t


def _es(t: str) -> str:
    t = re.sub(r"^—\s+", "—", t)
    return t


_LANG_FN = {"fr": _fr, "en": _en, "es": _es}


def _hyphenate(t: str, lang: str) -> str:
    d = _dic(lang)

    def rep(m: re.Match) -> str:
        w = m.group(0)
        if len(w) < 7 or w[0].isupper() and w.isupper():
            return w
        return d.inserted(w, hyphen=SHY)

    return re.sub(r"[A-Za-zÀ-ÖØ-öø-ÿŒœ]{7,}", rep, t)


def apply(html: str, lang: str, hyphenate: bool = False) -> str:
    """Apply typographic rules to every text node of an HTML fragment."""
    fn = _LANG_FN.get(lang, lambda x: x)
    parts = TAG_SPLIT.split(html)
    out = []
    in_skip = 0  # inside <a>/<code>: leave URLs alone
    for p in parts:
        if p.startswith("<"):
            low = p.lower()
            if low.startswith("<a ") or low.startswith("<code"):
                in_skip += 1
            elif low.startswith("</a") or low.startswith("</code"):
                in_skip = max(0, in_skip - 1)
            out.append(p)
            continue
        if in_skip:
            out.append(p)
            continue
        t = fn(p)
        if hyphenate:
            t = _hyphenate(t, lang)
        t = DEVA.sub(r'<span class="deva" lang="hi">\1</span>', t)
        t = KHMER.sub(r'<span class="khmer" lang="km">\1</span>', t)
        out.append(t)
    return "".join(out)


def plain(html: str) -> str:
    t = re.sub(r"<[^>]+>", "", html)
    return t.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace(SHY, "")


def norm(s: str) -> str:
    """Normalise for anchor matching: unify quotes, spaces, drop soft hyphens and markup."""
    s = plain(s).replace(SHY, "")
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = s.replace(NBSP, " ").replace(NNBSP, " ").replace("«", '"').replace("»", '"')
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s
