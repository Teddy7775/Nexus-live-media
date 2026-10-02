"""Preflight: structure parity across languages, illustration anchors, artwork fitness for print."""
from __future__ import annotations

import collections
import re

from . import typo
from .art import Art
from .core import Book, Project
from .mdparse import strip_tags


def _paras(sec):
    return [b for b in sec.blocks if b.kind == "p"]


def check_book(P: Project, book: Book) -> tuple[list[str], list[str]]:
    errors, notes = [], []
    mss = {l: book.manuscript(l) for l in P.langs}
    # 1) same section skeleton in every language
    skel = {l: [(s.kind, s.id, bool([b for b in s.blocks if b.kind == "tail"])) for s in ms.sections] for l, ms in mss.items()}
    base = skel["en"]
    for l in P.langs:
        if skel[l] != base:
            diff = [(a, b) for a, b in zip(base, skel[l]) if a != b]
            errors.append(f"[{l}] section/tail skeleton differs from EN: {diff[:3]}")
    # 2) paragraph-count parity (informational; translations vary slightly)
    for sid in [s.id for s in mss["en"].sections if s.kind in ("chapter", "epilogue")]:
        n = {l: len(_paras([s for s in mss[l].sections if s.id == sid][0])) for l in P.langs}
        spread = max(n.values()) - min(n.values())
        if spread > 6:
            notes.append(f"{sid}: paragraph counts differ by {spread} across languages {n}")
    # 3) anchors
    for lang, ms in mss.items():
        for aid, slot in book.register["slots"].items():
            if slot["kind"] == "cover":
                continue
            sec = [s for s in ms.sections if s.id == slot["chapter"]][0]
            a = typo.norm(slot["anchor"][lang])
            if not any(a in typo.norm(b.html) for b in _paras(sec)):
                errors.append(f"[{lang}] anchor for {aid} not found in {slot['chapter']}")
    # 4) key facts that must agree in all three versions (Volume 1: the number of lies in chapter 2)
    for lang, ms in (mss.items() if book.cfg.get("checks", {}).get("lies") else []):
        ch2 = [s for s in ms.sections if s.id == "ch-02"][0]
        first = strip_tags(_paras(ch2)[0].html)
        cnt = sum(1 for b in _paras(ch2) if re.match(r"^(Lie number|Mensonge numéro|Deuxième mensonge|Troisième mensonge|Mentira número)", strip_tags(b.html)))
        notes.append(f"[{lang}] ch-02 opens “{first[:60]}…” and enumerates {cnt + 1} lies (first lie is unnumbered in the text)")
    return errors, notes


def art_report(book: Book, meta_by_edition: dict | None = None) -> list[dict]:
    art = Art(book)
    pr = book.cfg["print"]
    tw = pr["trim_in"][0]
    b = pr["bleed_in"]
    m = pr["margins_in"]
    text_w = tw - m["inner"] - m["outer"]
    rows = []
    for aid, slot in book.register["slots"].items():
        af = art.get(aid)
        if not af:
            rows.append({"id": aid, "scene": slot["scene"]["en"], "status": "MISSING"})
            continue
        kind = slot["kind"]
        if kind == "spread":
            width = tw * 2 + 2 * b
            place = "spread band"
        elif kind == "cover":
            width = tw + b
            place = "cover panel"
        elif kind == "full" and af.aspect < 1:
            width = (tw + 2 * b)
            place = "full-bleed plate"
        else:
            width = text_w
            place = "inline"
        ppi = af.w / width
        want = {"2:3": 2 / 3, "3:2": 1.5, "4:3": 4 / 3}.get(slot["ratio"])
        rows.append({"id": aid, "scene": slot["scene"]["en"], "file": af.src.name, "px": f"{af.w}x{af.h}",
                     "aspect": round(af.aspect, 3), "wanted": slot["ratio"], "slot": kind, "placement": place,
                     "ppi": round(ppi), "ok_aspect": want is None or abs(af.aspect - want) < 0.05,
                     "fixes": af.notes})
    return rows
