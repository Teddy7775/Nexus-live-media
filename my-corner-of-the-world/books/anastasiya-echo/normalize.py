"""Structure normalizer for Anastasiya's Echo (EN / FR / ES).

The supplied manuscripts are word-processor exports whose headings are plain paragraphs
(`PART ONE`, `CHAPTER ONE`, bold titles, italic dates). The build expects the canonical
shape used by Ananya’s Notebook:

    # **Title**                       front matter
    ## Contents                       (ignored, regenerated)
    ## A Note to the Reader           prologue
    ## PART ONE — The Silent Bell     part
    ### CHAPTER ONE — Title           chapter, then an italic date line and an italic "sound" line
    ## EPILOGUE — Title
    ## Words from Katya's Notebook    glossary
    ## A Note on the Story            note

This module only changes structure. Wording is never touched here: every wording change is a
logged edit in edits/*.json. A "notebook page" (a bold title followed by italic lines, or by
bold-led entries) becomes a titled bullet list so that it is typeset as one block.
"""
from __future__ import annotations

import re

LANGS = {
    "en": dict(
        title="Anastasiya’s Echo", subtitle="Katya’s Notebook · Ukraine",
        series="MY CORNER OF THE WORLD", place="Northeast Ukraine", dates="September 2024 to September 2025",
        contents="Contents", part=r"^PART (ONE|TWO|THREE|FOUR)$", chapter=r"^CHAPTER ([A-Z-]+)$",
        epilogue="EPILOGUE", note_reader="A Note to the Reader", glossary="Words from Katya’s Notebook",
        note_story="A Note on the Story",
        part_label=lambda m: f"PART {m.group(1)}", chapter_label=lambda m: f"CHAPTER {m.group(1)}",
        part_titles=None),
    "fr": dict(
        title="L’Écho d’Anastasiya", subtitle="Le cahier de Katya · Ukraine",
        series="MON COIN DU MONDE", place="Nord-est de l’Ukraine", dates="Septembre 2024 à septembre 2025",
        contents="Sommaire", part=r"^PARTIE (I|II|III|IV)$", chapter=r"^CHAPITRE (\d+)$",
        epilogue="ÉPILOGUE", note_reader="Note au lecteur", glossary="Glossaire", note_story="Note documentaire",
        part_label=lambda m: f"Partie {m.group(1)}", chapter_label=lambda m: f"Chapitre {m.group(1)}",
        part_titles={"LA CLOCHE MUETTE": "La cloche muette", "LE SOUFFLE DANS L’HIVER": "Le souffle dans l’hiver",
                     "LES VOIX PERDUES": "Les voix perdues", "CE QUE LE MONDE ENTEND": "Ce que le monde entend"},
        epilogue_titles={"LA CLOCHE ET LE RIRE": "La cloche et le rire"}),
    "es": dict(
        title="El eco de Anastasiya", subtitle="El cuaderno de Katya · Ucrania",
        series="MI RINCÓN DEL MUNDO", place="Noreste de Ucrania", dates="De septiembre de 2024 a septiembre de 2025",
        contents="Índice", part=r"^(PRIMERA|SEGUNDA|TERCERA|CUARTA) PARTE$", chapter=r"^CAPÍTULO ([A-ZÁÉÍÓÚÜÑ-]+)$",
        epilogue="EPÍLOGO", note_reader="Nota para el lector", glossary="Palabras del cuaderno de Katya",
        note_story="Nota sobre la historia",
        part_label=lambda m: f"{m.group(1)} PARTE", chapter_label=lambda m: f"CAPÍTULO {m.group(1)}",
        part_titles=None),
}

NOTE = ("structure normalized to the canonical layout, no wording changed (title block, contents list and the French “Révision éditoriale proposée” "
        "line are replaced by the generated title page and contents; “...” → “…”; notebook pages and timetables become titled lists)")

BOLD_ONLY = re.compile(r"^\*\*([^*\n]+)\*\*\s*$")
ITALIC_ONLY = re.compile(r"^\*(?!\*)([^\n]+?)\*\s*$")
BOLD_LED = re.compile(r"^\*\*[^*\n]+\.\*\*")


def _paras(text: str) -> list[str]:
    return [p.strip("\n") for p in re.split(r"\n\s*\n", text.replace("\r\n", "\n")) if p.strip()]


def _plain_heading(p: str) -> str:
    """'# *The Silent Bell*' / '**LA CLOCHE MUETTE**' -> bare text."""
    p = re.sub(r"^#+\s*", "", p.strip())
    return p.strip("*_ ").strip()


def _is_italic(p: str) -> bool:
    return bool(ITALIC_ONLY.match(p)) and "\n" not in p


TIME_LINE = re.compile(r"^\*\*\d{1,2}(?::| h )\s?\d{2}")


def _schedules(paras: list[str]) -> list[str]:
    """A class timetable ('**9:00: reading.**' x4, or one bold line + a bullet list) -> one bullet list."""
    out, i = [], 0
    while i < len(paras):
        p = paras[i]
        if TIME_LINE.match(p) and BOLD_ONLY.match(p):
            j = i + 1
            items = [p]
            while j < len(paras) and (BOLD_ONLY.match(paras[j]) and TIME_LINE.match(paras[j])):
                items.append(paras[j])
                j += 1
            if j < len(paras) and paras[j].startswith("- **"):
                items += [x[2:] for x in paras[j].split("\n")]
                j += 1
            if len(items) >= 3:
                out.append("\n".join(f"- {x}" for x in items))
                i = j
                continue
        out.append(p)
        i += 1
    return out


def _notebook_pages(paras: list[str]) -> list[str]:
    """Bold title + italic lines (or bold-led entries) -> title + bullet list."""
    paras = _schedules(paras)
    out, i = [], 0
    while i < len(paras):
        p = paras[i]
        if BOLD_ONLY.match(p) and "\n" not in p:
            j = i + 1
            while j < len(paras) and _is_italic(paras[j]):
                j += 1
            if j - i - 1 >= 1:
                out.append(p)
                out.append("\n".join(f"- {x}" for x in paras[i + 1:j]))
                i = j
                continue
            j = i + 1
            while j < len(paras) and BOLD_LED.match(paras[j]) and "\n" not in paras[j]:
                j += 1
            if j - i - 1 >= 2:
                out.append(p)
                out.append("\n".join(f"- {x}" for x in paras[i + 1:j]))
                i = j
                continue
        out.append(p)
        i += 1
    return out


def normalize_manuscript(text: str, lang: str) -> str:
    L = LANGS[lang]
    paras = _paras(text)
    part_re, chap_re = re.compile(L["part"]), re.compile(L["chapter"])
    first_part = next(i for i, p in enumerate(paras) if part_re.match(p.strip()))
    note_marker = f"**{L['note_reader']}**"
    i_note = max(i for i, p in enumerate(paras[:first_part]) if p.strip() == note_marker)

    out = [f"# **{L['title']}**", f"*{L['subtitle']}*", L["series"], L["place"], L["dates"], f"## {L['contents']}",
           f"## {L['note_reader']}"]
    out += paras[i_note + 1:first_part]

    body: list[str] = []
    i = first_part
    gloss_idx = note_idx = None
    while i < len(paras):
        p = paras[i].strip()
        m = part_re.match(p)
        if m:
            title = _plain_heading(paras[i + 1])
            if L.get("part_titles"):
                title = L["part_titles"].get(title, title)
            body.append(f"## {L['part_label'](m)} — {title}")
            body.append(paras[i + 2])      # italic period line, e.g. September to December 2024
            i += 3
            continue
        m = chap_re.match(p)
        if m:
            title = _plain_heading(paras[i + 1])
            body.append(f"### {L['chapter_label'](m)} — {title}")
            body.append(paras[i + 2])      # date
            body.append(paras[i + 3])      # sound line
            assert _is_italic(paras[i + 2]) and _is_italic(paras[i + 3]), (lang, p, paras[i + 2][:40], paras[i + 3][:40])
            i += 4
            continue
        if p == L["epilogue"]:
            title = _plain_heading(paras[i + 1])
            title = L.get("epilogue_titles", {}).get(title, title)
            body.append(f"## {L['epilogue']} — {title}")
            body.append(paras[i + 2])
            body.append(paras[i + 3])
            i += 4
            continue
        if _plain_heading(p) == L["glossary"] and p.startswith(("#", "**")):
            body.append(f"## {L['glossary']}")
            gloss_idx = len(body)
            i += 1
            continue
        if _plain_heading(p) == L["note_story"] and p.startswith(("#", "**")):
            body.append(f"## {L['note_story']}")
            note_idx = len(body)
            i += 1
            continue
        body.append(paras[i])
        i += 1

    # glossary entries: "**Term**  \ndefinition" -> "**Term**: definition"
    if gloss_idx is not None:
        for k in range(gloss_idx, note_idx - 1):
            mm = re.match(r"^\*\*([^*\n]+)\*\*[ \t]*\n(.+)$", body[k], re.S)
            if mm:
                colon = "\u00a0:" if lang == "fr" else ":"          # French: no-break space before the colon
                body[k] = f"**{mm.group(1)}**{colon} {mm.group(2).strip()}"
    # notebook pages (not in the glossary / notes)
    cut = gloss_idx - 1 if gloss_idx else len(body)
    body = _notebook_pages(body[:cut]) + body[cut:]
    out += body
    return "\n\n".join(out) + "\n"


def normalize_guide(text: str, lang: str) -> str:
    """Word-processor export -> the heading levels parse_guide expects (h1 title, h2 sections, h3 sub-sections)."""
    lines, out, seen_title, seen_sub = text.replace("\r\n", "\n").split("\n"), [], False, False
    for ln in lines:
        if ln.startswith("|") and re.search(r"[\u00a0\u202f]?:?-{3,}", ln) and re.fullmatch(r"[|\s\u00a0\u202f:\-]+", ln):
            ln = re.sub(r"[\u00a0\u202f]", " ", ln)    # FR export puts no-break spaces in the table rule row
        if ln.startswith("# "):
            if not seen_title:
                seen_title = True
                out.append(ln)
            else:
                out.append("#" + ln)               # section heading: h1 -> h2
            continue
        if ln.startswith("## "):
            if not seen_sub and ln.startswith("## *"):
                seen_sub = True
                out.append(ln[3:])                 # '## *Discovery Guide*' -> '*Discovery Guide*'
            else:
                out.append("#" + ln)               # sub-section: h2 -> h3
            continue
        out.append(ln)
    return "\n".join(out)


def normalize(text: str, lang: str, which: str = "manuscript") -> str:
    text = text.replace("...", "…")           # typographic ellipsis (28 in the French manuscript)
    return normalize_manuscript(text, lang) if which == "manuscript" else normalize_guide(text, lang)
