"""Parse the manuscripts and discovery guides (Markdown) into a structured model.

The three language versions share one structure, so a single language-agnostic
parser serves all of them:

    h1  front title
    h2  Contents (skipped) | prologue | PART heading | epilogue | glossary | note
    h3  chapter heading ("CHAPTER ONE — Other People's Roofs")

Everything is decided by position and by Markdown shape, never by the literal
words "chapter"/"chapitre"/"capítulo", so adding a fourth language needs no code.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from markdown_it import MarkdownIt

YEAR_RE = re.compile(r"\b20\d{2}\b")


def looks_like_date(txt: str) -> bool:
    """Short italic line with a digit and no sentence punctuation: 'Samedi 28 décembre'."""
    t = txt.strip().strip("*_ ")
    return len(t) <= 52 and bool(re.search(r"\d", t)) and not re.search(r"[.!?…»\"”]$", t)
HEAD_SPLIT = re.compile(r"\s+[—–]\s+")


def make_md() -> MarkdownIt:
    # commonmark + tables; no typographer (the manuscripts already carry curly quotes)
    return MarkdownIt("commonmark", {"html": False, "typographer": False}).enable("table")


@dataclass
class Block:
    kind: str  # p | note | dateline | notice | poster | rule | ul | ol | card | table | h3 | h4 | tail
    html: str = ""
    items: list = field(default_factory=list)  # for lists / poster lines / card children
    meta: dict = field(default_factory=dict)

    def text(self) -> str:
        return strip_tags(self.html) if self.html else " ".join(
            strip_tags(i) if isinstance(i, str) else "" for i in self.items
        )


@dataclass
class Section:
    kind: str  # prologue | part | chapter | epilogue | glossary | note | guide-section
    id: str
    label: str = ""
    title: str = ""
    number: int | None = None
    date: str = ""
    blocks: list[Block] = field(default_factory=list)
    part_index: int | None = None


@dataclass
class Manuscript:
    lang: str
    title: str
    subtitle: str
    meta_lines: list[str]  # series name / place / dates lines, as written
    sections: list[Section]

    def chapters(self):
        return [s for s in self.sections if s.kind == "chapter"]


def strip_tags(html: str) -> str:
    t = re.sub(r"<[^>]+>", "", html)
    return (
        t.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        .replace("&quot;", '"').replace("&#39;", "'")
    )


def _slice_blocks(tokens):
    """Group the flat token stream into top-level blocks (list of token lists)."""
    blocks, cur, depth = [], [], 0
    for t in tokens:
        cur.append(t)
        depth += t.nesting
        if depth == 0:
            blocks.append(cur)
            cur = []
    if cur:
        blocks.append(cur)
    return blocks


def _clean(tok):
    """markdown-it leaves empty leading text tokens next to emphasis; drop them."""
    if tok.children:
        tok.children = [c for c in tok.children if not (c.type == "text" and c.content == "")]
    return tok


def _inline_html(md: MarkdownIt, tok) -> str:
    _clean(tok)
    return md.renderer.renderInline(tok.children or [], md.options, {})


def _block_to_html(md, btoks) -> str:
    return md.renderer.render(btoks, md.options, {})


def _only_child_tag(tok) -> str | None:
    """If an inline token is wholly wrapped in one <strong> or <em>, return which."""
    ch = tok.children or []
    if len(ch) >= 3 and ch[0].type in ("strong_open", "em_open") and ch[-1].type in ("strong_close", "em_close"):
        kind = ch[0].type.split("_")[0]
        # make sure the opening tag closes only at the very end
        depth = 0
        for i, c in enumerate(ch):
            if c.type == ch[0].type:
                depth += 1
            elif c.type == ch[-1].type:
                depth -= 1
                if depth == 0 and i != len(ch) - 1:
                    return None
        return kind
    return None


def _starts_with_label(tok) -> bool:
    """`**Label:** rest` — a strong whose text ends with a colon, at the start."""
    ch = tok.children or []
    if len(ch) >= 3 and ch[0].type == "strong_open":
        # find close
        for i in range(1, len(ch)):
            if ch[i].type == "strong_close":
                inner = "".join(c.content for c in ch[1:i])
                return inner.rstrip().endswith(":") or inner.rstrip().endswith("：")
    return False


def _starts_with_rule_number(tok) -> bool:
    ch = tok.children or []
    if len(ch) >= 3 and ch[0].type == "strong_open":
        inner = ch[1].content.strip() if len(ch) > 1 else ""
        return bool(re.fullmatch(r"\d+\.?", inner))
    return False


def _classify_block(md, btoks) -> Block:
    first = btoks[0]
    if first.type == "paragraph_open":
        inline = btoks[1]
        html = _inline_html(md, inline)
        tag = _only_child_tag(inline)
        txt = inline.content.strip()
        if tag == "strong":
            return Block("notice", html)
        if _starts_with_rule_number(inline):
            # "**1\.**\tPlain cotton only."  ->  number + text
            ch = inline.children
            num = ch[1].content.strip().rstrip(".")
            rest_html = md.renderer.renderInline(ch[3:], md.options, {}).lstrip(" \t ")
            return Block("rule", rest_html, meta={"num": num})
        if tag == "em":
            if looks_like_date(txt):
                return Block("dateline", html)
            return Block("note", html)
        if _starts_with_label(inline):
            return Block("label", html)
        return Block("p", html)
    if first.type in ("bullet_list_open", "ordered_list_open"):
        kind = "ul" if first.type == "bullet_list_open" else "ol"
        items, i = [], 0
        while i < len(btoks):
            if btoks[i].type == "list_item_open":
                depth, j, inner = 1, i + 1, []
                while j < len(btoks) and depth:
                    if btoks[j].type == "list_item_open":
                        depth += 1
                    elif btoks[j].type == "list_item_close":
                        depth -= 1
                        if depth == 0:
                            break
                    inner.append(btoks[j])
                    j += 1
                html = "".join(_inline_html(md, t) for t in inner if t.type == "inline")
                items.append(html.strip())
                i = j
            i += 1
        start = first.attrGet("start") if kind == "ol" else None
        return Block(kind, items=items, meta={"start": int(start) if start else 1})
    if first.type == "table_open":
        return _table_block(md, btoks)
    if first.type == "heading_open":
        lvl = int(first.tag[1])
        return Block(f"h{lvl}", _inline_html(md, btoks[1]))
    if first.type == "hr":
        return Block("hr")
    return Block("p", _block_to_html(md, btoks))


def _table_block(md, btoks) -> Block:
    rows, cur, in_head, head = [], None, False, []
    for t in btoks:
        if t.type == "thead_open":
            in_head = True
        elif t.type == "thead_close":
            in_head = False
        elif t.type == "tr_open":
            cur = []
        elif t.type == "tr_close":
            (head if in_head else rows).append(cur)
        elif t.type == "inline":
            cur.append(_inline_html(md, t))
    # A "header" row whose cells read like data (long text) means a key/value table
    header_is_data = bool(head) and any(len(strip_tags(c)) > 42 for c in head[0][1:])
    if header_is_data or (head and len(head[0]) == 2 and not any("<strong>" in c for c in head[0])
                          and all(len(strip_tags(c)) > 0 for c in head[0]) and not rows[:1] == []
                          and len(strip_tags(head[0][1])) > 25):
        rows = head + rows
        head = []
    return Block("table", items=[head[0] if head else None, rows],
                 meta={"cols": len((head or rows)[0])})


def _merge_blocks(blocks: list[Block]) -> list[Block]:
    """Merge consecutive notices into posters, label+list into cards, numbered rules into lists."""
    # 1) consecutive numbered rule paragraphs -> one ordered list (keeps the first number)
    pre: list[Block] = []
    i = 0
    while i < len(blocks):
        b = blocks[i]
        if b.kind == "rule":
            run = [b]
            j = i + 1
            while j < len(blocks) and blocks[j].kind == "rule":
                run.append(blocks[j])
                j += 1
            pre.append(Block("ol", items=[r.html for r in run], meta={"start": int(run[0].meta["num"])}))
            i = j
        else:
            pre.append(b)
            i += 1
    blocks = pre

    out: list[Block] = []
    i = 0
    while i < len(blocks):
        b = blocks[i]
        if b.kind == "notice":
            lines = [b.html]
            j = i + 1
            while j < len(blocks) and blocks[j].kind == "notice":
                lines.append(blocks[j].html)
                j += 1
            if j < len(blocks) and blocks[j].kind in ("ul", "ol") and len(lines) == 1:
                out.append(Block("card", lines[0], items=blocks[j].items,
                                 meta={"list": blocks[j].kind, "start": blocks[j].meta.get("start", 1)}))
                i = j + 1
                continue
            if len(lines) > 1:
                out.append(Block("poster", items=lines))
            else:
                out.append(Block("notice", lines[0]))
            i = j
            continue
        out.append(b)
        i += 1
    return out


def _is_label_card(b: Block) -> bool:
    t = strip_tags(b.html).strip().replace("\u00a0", " ")
    return b.kind == "card" and t.endswith(":")


def _split_tail(blocks: list[Block]) -> tuple[list[Block], list[Block]]:
    """Split a chapter into (prose, notebook-tail).

    The tail is the closing notebook-style block ('Color of the Day: ...',
    'What I Didn't Say Today:' + list, 'Wind Report' + bullets, ...). It starts at the
    first block, within the last nine, that is a `**Label:**` paragraph or a
    labelled card; a card with no colon only counts if it is among the last two blocks.
    """
    n = len(blocks)
    start = None
    for idx in range(max(0, n - 9), n):
        b = blocks[idx]
        if b.kind == "label" or _is_label_card(b):
            start = idx
            break
        if b.kind == "card" and idx >= n - 2:
            start = idx
            break
    if start is None:
        return blocks, []
    return blocks[:start], blocks[start:]


def parse_manuscript(text: str, lang: str) -> Manuscript:
    md = make_md()
    toks = md.parse(text)
    top = _slice_blocks(toks)

    title = subtitle = ""
    meta_lines: list[str] = []
    sections: list[Section] = []
    h2_seen = 0
    cur: Section | None = None
    part_count = 0
    chap_count = 0
    seen_h1 = False
    pending: list[Block] = []

    def flush():
        nonlocal cur, pending
        if cur is not None:
            blocks = _merge_blocks(pending)
            if cur.kind == "chapter" or cur.kind == "epilogue":
                if blocks and blocks[0].kind == "dateline":
                    cur.date = strip_tags(blocks[0].html)
                    blocks = blocks[1:]
                prose, tail = _split_tail(blocks)
                cur.blocks = prose + ([Block("tail", items=tail)] if tail else [])
            else:
                cur.blocks = blocks
            sections.append(cur)
        cur, pending = None, []

    for btoks in top:
        first = btoks[0]
        if first.type == "heading_open":
            lvl = int(first.tag[1])
            raw = btoks[1].content.strip()
            html = _inline_html(md, btoks[1])
            if lvl == 1:
                title = strip_tags(html)
                seen_h1 = True
                continue
            if lvl == 2:
                flush()
                h2_seen += 1
                if h2_seen == 1:  # Contents/Sommaire/Índice: regenerated, never copied
                    cur = Section("skip", "contents")
                    continue
                parts = HEAD_SPLIT.split(strip_tags(html), maxsplit=1)
                cur = Section("section", f"s{h2_seen}", label=parts[0] if len(parts) == 2 else "",
                              title=parts[1] if len(parts) == 2 else parts[0])
                cur.kind = "h2"  # resolved after the loop
                continue
            if lvl == 3:
                flush()
                parts = HEAD_SPLIT.split(strip_tags(html), maxsplit=1)
                chap_count += 1
                cur = Section("chapter", f"ch-{chap_count:02d}", label=parts[0] if len(parts) == 2 else "",
                              title=parts[1] if len(parts) == 2 else parts[0], number=chap_count)
                continue
        # front matter (before first h2): title block
        if cur is None:
            if first.type == "paragraph_open":
                inline = btoks[1]
                tag = _only_child_tag(inline)
                html = _inline_html(md, inline)
                if tag == "em" and not subtitle:
                    subtitle = strip_tags(html)
                else:
                    meta_lines.append(strip_tags(html))
            continue
        if cur.kind == "skip":
            continue
        pending.append(_classify_block(md, btoks))
    flush()

    # --- resolve h2 sections by position -------------------------------------
    h2s = [s for s in sections if s.kind == "h2"]
    # layout: prologue, parts..., epilogue, glossary, note
    prologue = h2s[0]
    epilogue, glossary, note = h2s[-3], h2s[-2], h2s[-1]
    prologue.kind, prologue.id = "prologue", "prologue"
    epilogue.kind, epilogue.id = "epilogue", "epilogue"
    glossary.kind, glossary.id = "glossary", "glossary"
    note.kind, note.id = "note", "note"
    pi = 0
    for s in h2s[1:-3]:
        pi += 1
        s.kind, s.id, s.number = "part", f"part-{pi}", pi
    # chapters inherit part index
    pi = 0
    for s in sections:
        if s.kind == "part":
            pi = s.number
        elif s.kind == "chapter":
            s.part_index = pi

    # the epilogue was captured as h2 but its date/tail need the chapter treatment
    ep_blocks = _merge_blocks(epilogue.blocks) if epilogue.blocks else []
    if ep_blocks and ep_blocks[0].kind == "dateline":
        epilogue.date = strip_tags(ep_blocks[0].html)
        ep_blocks = ep_blocks[1:]
    epilogue.blocks = ep_blocks

    sections = [s for s in sections if s.kind != "skip"]
    # order matters only for h2/h3 interleave: sections were appended in document order
    return Manuscript(lang, title, subtitle, meta_lines, sections)


# ----------------------------------------------------------------------------
# Discovery guide
# ----------------------------------------------------------------------------

@dataclass
class Guide:
    lang: str
    title: str
    subtitle: str
    intro: str
    sections: list[Section]


def parse_guide(text: str, lang: str) -> Guide:
    md = make_md()
    top = _slice_blocks(md.parse(text))
    title = subtitle = intro = ""
    sections: list[Section] = []
    cur: Section | None = None
    h2n = 0
    em_seen = 0
    for btoks in top:
        first = btoks[0]
        if first.type == "heading_open":
            lvl = int(first.tag[1])
            html = _inline_html(md, btoks[1])
            if lvl == 1:
                title = strip_tags(html)
                continue
            if lvl == 2:
                h2n += 1
                if h2n == 1:  # contents list: regenerated
                    cur = Section("skip", "contents")
                    continue
                txt = strip_tags(html)
                m = re.match(r"^(\d+)\.\s*(.*)$", txt)
                num = int(m.group(1)) if m else None
                cur = Section("guide-section", f"g{num}" if num else "g-sources",
                              label=str(num) if num else "", title=m.group(2) if m else txt, number=num)
                sections.append(cur)
                continue
            if lvl == 3 and cur is not None:
                cur.blocks.append(Block("h3", html))
                continue
        if cur is None:
            if first.type == "paragraph_open":
                inline = btoks[1]
                tag = _only_child_tag(inline)
                if tag == "em":
                    em_seen += 1
                    if em_seen == 1:
                        subtitle = strip_tags(_inline_html(md, inline))
                    else:
                        intro = _inline_html(md, inline)
            elif first.type == "table_open":
                sections.append(Section("guide-facts", "facts", blocks=[_classify_block(md, btoks)]))
            continue
        if cur.kind == "skip":
            continue
        cur.blocks.append(_classify_block(md, btoks))
    for s in sections:
        if s.kind in ("guide-section",):
            s.blocks = _merge_blocks(s.blocks)
    sections = [s for s in sections if s.kind != "skip"]
    return Guide(lang, title, subtitle, intro, sections)
