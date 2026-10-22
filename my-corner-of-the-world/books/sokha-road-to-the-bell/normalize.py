"""Structure normalizer for Sokha's Diary (EN / FR / ES).

The supplied manuscripts and guides already use the canonical heading shape (h1 title, h2 contents / prologue /
parts / epilogue / glossary / note, h3 chapters, an italic date line under each chapter). Two structural slips in
the French manuscript are repaired here; no wording is touched:

* the "Market Money" notebook page (chapter 5) is seven plain lines under a bold title in the French file, and a
  bulleted list in English and Spanish: it becomes a titled list so that it is typeset as one notebook card;
* the second list of chapter 2 ("Ce que j’ai gardé") is numbered 4 to 6 in the French file because the word
  processor continued the first list; English and Spanish number both lists 1 to 3, so the French one restarts at 1.

Every wording change stays a logged edit in edits/*.json.
"""
from __future__ import annotations

import re

NOTE = ("structure checked against the canonical layout, no wording changed; French only: the “Argent du marché” notebook page (seven plain lines) "
        "becomes a titled list as in English and Spanish, and the second list of chapter 2 restarts its numbering at 1 as in English and Spanish")

SP = "[ \u00a0\u202f]"
MARKET_TITLE = "**Argent du marché**"
MARKET_LINE = re.compile(rf"^[^\n]{{2,90}}{SP}:{SP}+[\d \u00a0\u202f]+(?:riels)?$")


def _paras(text: str) -> list[str]:
    return [p.strip("\n") for p in re.split(r"\n\s*\n", text.replace("\r\n", "\n")) if p.strip()]


def _fr_market_list(paras: list[str]) -> list[str]:
    i = next((k for k, p in enumerate(paras) if p.strip() == MARKET_TITLE), None)
    if i is None:
        raise SystemExit(f"normalize: {MARKET_TITLE} not found in the French manuscript")
    j = i + 1
    while j < len(paras) and MARKET_LINE.match(paras[j].strip()):
        j += 1
    n = j - i - 1
    if n != 7:
        raise SystemExit(f"normalize: expected 7 market lines after {MARKET_TITLE}, found {n}")
    return paras[:i + 1] + ["\n".join(f"- {p.strip()}" for p in paras[i + 1:j])] + paras[j:]


def _restart_numbering(paras: list[str]) -> list[str]:
    """A tight numbered list that does not start at 1 (word-processor continuation) restarts at 1."""
    out = []
    for p in paras:
        lines = p.split("\n")
        if len(lines) > 1 and all(re.match(r"^\d+\.\s", l) for l in lines) and not lines[0].startswith("1."):
            p = "\n".join(re.sub(r"^\d+\.", f"{k}.", l, count=1) for k, l in enumerate(lines, 1))
        out.append(p)
    return out


def normalize_manuscript(text: str, lang: str) -> str:
    paras = _paras(text)
    if lang == "fr":
        paras = _restart_numbering(_fr_market_list(paras))
    return "\n\n".join(paras) + "\n"


def normalize(text: str, lang: str, which: str = "manuscript") -> str:
    text = text.replace("...", "…")           # typographic ellipsis (no-op when the files already use …)
    return normalize_manuscript(text, lang) if which == "manuscript" else text
