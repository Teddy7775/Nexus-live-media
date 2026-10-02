#!/usr/bin/env python3
"""Local style audit: objective, language-aware pattern counts for a manuscript.

It reports *measurable habits*, not a verdict. No AI-detector is run and none is claimed:
detectors disagree with each other, produce false positives on polished human prose, and
cannot be certified. What this tool does is show whether a revision reduced repetitive
constructions and widened sentence-length variation, which are things a human editor would
also look at.
"""
import json
import re
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mcw.mdparse import parse_manuscript, strip_tags  # noqa: E402

PATTERNS = {
    "en": {
        "contrast: 'It wasn't X. It was Y'": r"(?:wasn’t|isn’t|weren’t|didn’t|don’t|doesn’t|wouldn’t|couldn’t)[^.!?]{0,90}[.;]\s+(?:It|That|He|She|I|They|We)\s+(?:was|were|is|did|had|just)\b",
        "contrast: sentence starting 'Not …'": r"(?:^|[.!?]\s+)Not\s",
        "explaining: 'I understood/realized/knew that'": r"\bI\s+(?:understood|realized|realised|knew|saw|felt)\s+(?:that|how|why)\b",
        "narrator hedges: 'Maybe …'": r"\bMaybe\b",
        "aphoristic 'That was why/what …'": r"(?:^|[.!?]\s+)(?:That|This)\s+(?:was|is)\s+(?:why|what|how|the)\b",
        "foreshadow tic: 'I didn't know yet'": r"\b(?:didn’t|did not)\s+know\s+yet\b|\bshould have (?:understood|realized)\b",
        "em dashes": r"—",
    },
    "fr": {
        "contrast: 'Ce n'était pas X. C'était Y'": r"(?:n’était pas|n’est pas|ne sont pas|n’étaient pas|ne l’était pas)[^.!?]{0,90}[.;]\s+(?:C’était|C’est|Il|Elle|Je|Ils|Nous|On)\s",
        "contrast: sentence starting 'Pas …'": r"(?:^|[.!?]\s+)(?:Pas|Non pas)\s",
        "explaining: 'J'ai compris/réalisé que'": r"\bj’ai\s+(?:compris|réalisé|su|vu|senti)\s+(?:que|comment|pourquoi)\b",
        "narrator hedges: 'Peut-être …'": r"\b[Pp]eut-être\b",
        "aphoristic 'C'est pour ça/C'était cela'": r"(?:^|[.!?]\s+)(?:C’est|C’était)\s+(?:pour|pourquoi|ce qui|ce que|cela|ça)\b",
        "foreshadow tic: 'Je ne savais pas encore'": r"\bne savais pas encore\b|\baurais dû (?:comprendre|voir)\b",
        "em dashes (outside dialogue)": r"(?<!^)(?<=\w)\s—\s",
    },
    "es": {
        "contrast: 'No era X. Era Y'": r"(?:no era|no es|no fue|no eran|no estaba)[^.!?]{0,90}[.;]\s+(?:Era|Es|Fue|Él|Ella|Yo|Ellos|Nosotros)\s",
        "contrast: sentence starting 'No …' (fragment)": r"(?:^|[.!?]\s+)No\s+(?:todavía|aún|como|por|de)\b",
        "explaining: 'Entendí/me di cuenta de que'": r"\b(?:entendí|comprendí|me di cuenta de|supe|sentí)\s+que\b",
        "narrator hedges: 'Quizá/Tal vez …'": r"\b(?:[Qq]uizá|[Qq]uizás|[Tt]al vez)\b",
        "aphoristic 'Por eso/Eso fue lo que'": r"(?:^|[.!?]\s+)(?:Por eso|Eso fue|Eso era|Esto es)\b",
        "foreshadow tic: 'Todavía no sabía'": r"\b[Tt]odavía no sabía\b|\bdebí (?:entender|darme cuenta)\b",
        "em dashes (outside dialogue)": r"(?<=\w)\s—\s(?=\w)",
    },
}

SPLIT = re.compile(r"(?<=[.!?…])[”»\"’)]*\s+(?=[“«\"‘—A-ZÀ-ÖØ-Þ¿¡0-9])")


def sentences(text):
    out = []
    for para in text.split("\n"):
        para = para.strip()
        if not para:
            continue
        for s in SPLIT.split(para):
            s = s.strip()
            if len(re.findall(r"\w+", s)) >= 1:
                out.append(s)
    return out


def prose_paragraphs(ms):
    paras = []
    for s in ms.sections:
        if s.kind not in ("chapter", "epilogue", "prologue"):
            continue
        for b in s.blocks:
            if b.kind == "p":
                paras.append((s.id, strip_tags(b.html)))
    return paras


def audit(path: Path, lang: str):
    ms = parse_manuscript(path.read_text(encoding="utf-8"), lang)
    paras = prose_paragraphs(ms)
    text = "\n".join(p for _, p in paras)
    sents = sentences(text)
    lens = [len(re.findall(r"[\w’'-]+", s)) for s in sents]
    words = sum(lens)
    mean = statistics.mean(lens)
    sd = statistics.pstdev(lens)
    pat = {k: len(re.findall(v, text, flags=re.M)) for k, v in PATTERNS[lang].items()}
    one_liners = sum(1 for _, p in paras if len(re.findall(r"\w+", p)) <= 8)
    # chapter closers: last prose paragraph of each chapter, length
    closers = {}
    for s in ms.sections:
        if s.kind in ("chapter", "epilogue"):
            ps = [strip_tags(b.html) for b in s.blocks if b.kind == "p"]
            if ps:
                closers[s.id] = len(re.findall(r"\w+", ps[-1]))
    short_closers = sum(1 for n in closers.values() if n <= 14)
    # exact repeated 4-grams (3+ times) as a repetition signal
    toks = re.findall(r"[\w’'-]+", text.lower())
    grams = {}
    for i in range(len(toks) - 3):
        g = " ".join(toks[i:i + 4])
        grams[g] = grams.get(g, 0) + 1
    rep4 = sum(1 for g, c in grams.items() if c >= 4 and not re.search(r"^(i|he|she|and|the|a|to) ", g))
    return {
        "words": words, "sentences": len(sents), "mean_len": round(mean, 2), "stdev_len": round(sd, 2),
        "variation(stdev/mean)": round(sd / mean, 3),
        "share_<=5_words": round(sum(1 for n in lens if n <= 5) / len(lens), 3),
        "share_>=25_words": round(sum(1 for n in lens if n >= 25) / len(lens), 3),
        "paragraphs": len(paras), "one_liner_paragraph_share": round(one_liners / len(paras), 3),
        "chapter_closers_<=14_words": f"{short_closers}/{len(closers)}",
        "repeated_4grams(>=4x)": rep4,
        "patterns": pat,
    }


def main():
    slug = next((a for a in sys.argv[1:] if not a.startswith("--")), "ananya-stolen-flame")
    base = Path(__file__).resolve().parents[1] / "books" / slug / "manuscript"
    rows = {}
    for lang in ("en", "fr", "es"):
        edited = base / f"{lang}.md"
        try:
            before = audit(base / "original" / f"{lang}.md", lang)
        except IndexError:          # raw word-processor export (Volume 2): only the normalized master is parseable
            before = audit(edited, lang)
        after = audit(edited, lang) if edited.exists() else None
        rows[lang] = {"before": before, "after": after}
    if "--json" in sys.argv:
        print(json.dumps(rows, ensure_ascii=False, indent=1))
        return
    for lang, r in rows.items():
        print(f"\n=== {lang.upper()} ===")
        keys = [k for k in r["before"] if k != "patterns"]
        for k in keys:
            a = r["after"][k] if r["after"] else "—"
            print(f"  {k:32} {str(r['before'][k]):>10}   {str(a):>10}")
        for k in r["before"]["patterns"]:
            a = r["after"]["patterns"][k] if r["after"] else "—"
            print(f"  {k:46} {r['before']['patterns'][k]:>4}   {a:>4}")


if __name__ == "__main__":
    main()
