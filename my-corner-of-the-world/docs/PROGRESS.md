# Status: My Corner of the World

_Handoff note, updated at each commit so nothing lives only in a chat._

## Delivered (all rebuilt from source by `python3 build.py all`)

| | Vol. 1 · *Sokha’s Diary* (`sokha-road-to-the-bell`) | Vol. 2 · *The Drum and the Ball* (`lamine-drum-and-ball`) | Vol. 3 · *Ananya’s Notebook* (`ananya-stolen-flame`) | Vol. 4 · *Anastasiya’s Echo* (`anastasiya-echo`) |
|---|---|---|---|---|
| Print interiors (EN / FR / ES × story / story + guide) | 128–152 pp | 136–162 pp | 152–178 pp | 184–220 pp |
| Cover wraps (print PDF, proof PDF, front PNG), spine from real page count | 6 | 6 | 6 | 6 |
| EPUB 3, EPUBCheck valid with 0 messages | 6 | 6 | 6 | 6 |
| Illustrations placed | 15 + 2 covers | 15 + 2 covers | 15 + 2 covers | 15 + 2 covers |
| Cleared for press | **no**, see `books/sokha-road-to-the-bell/docs/OPEN_ITEMS.md` | **no**, see `books/lamine-drum-and-ball/docs/OPEN_ITEMS.md` | no (proofs) | no (proofs) |

Website: one static site for the whole collection (`public_html/`; `release/my-corner-of-the-world_public_html.zip` plus
`release/my-corner-of-the-world_downloads_1.zip` and `_2.zip` for the EPUBs, three files because GitHub refuses files over 100 MB), 327 pages, three languages.
Upload steps for Hostinger are in `README.md`. Reports: `docs/PREFLIGHT.md` (files), `books/*/docs/ILLUSTRATION_AUDIT.md`
(`docs/ILLUSTRATION_AUDIT.md` is Volume 3), `books/*/docs/OPEN_ITEMS.md` (Volumes 1 and 2), `books/*/docs/EDIT_LOG.md` (every text change).

## Not final until the author supplies (cannot be invented)
author / pen name, publisher or imprint, ISBNs (one per language and format), domain + contact email,
print-master artwork (300 ppi; the covers of Volumes 1 and 2 are 1024 × 1536 px, about 165 ppi; Sokha’s six plates too, Lamine’s interior pictures are fine), printer choice (KDP vs IngramSpark:
`bleed_mode`, spine factor). Proofs show highlighted placeholders; `--final` refuses to build with them or with pictures below 250 ppi.

## Decisions to confirm
Series
- **Volume numbers.** Sokha 1, Lamine 2, Ananya 3, Anastasiya 4, as in the series table of every Discovery Guide (Ananya’s own
  validation note already called it the third book). Earlier builds had Ananya 1 and Anastasiya 2, and the request for Sokha
  called it “the second book”, like Anastasiya. Change `volume` in each `book.json` to use publication order; then
  `python3 build.py cover epub site`.
- The home page features Ananya’s Notebook first (`series.json` → `featured`). There are no “coming soon” cards any more: all four volumes are built.

Volume 1 (Sokha’s Diary)
- Reader age 9–12 (the guide’s suggested independent reading; shared reading from 8; discussion from 13).
- Texts taken as supplied: two logged grammar fixes (English), twelve descriptive source labels per guide (from the review’s own list),
  two structure fixes in the French novel. Blurbs, tagline (the book’s last line), keywords and the parents’ note are mine.
- Not cleared for press: mobility of Maly, mine-risk messages, four narrative connectors, Khmer cultural check, human proofreading.

Volume 2 (The Drum and the Ball)
- Came without any editorial sign-off (no review note): a proof. Reserves I recommend (a reader from Senegal, real people and institutions named, human
  proofreading) and the facts checked on the web are in its `docs/OPEN_ITEMS.md`.
- Reader age 9–12 (the guide’s own; the art direction proposes 9–13 as a design recommendation).
- Texts as supplied; logged: one missing full stop and one duplicated paragraph (EN, FR), two guide phrases aligned with the novel (EN), one capital (ES).
  Blurbs, tagline (*Listen. Pass. Play fair.*), keywords and the parents’ note are mine.
- The pictures arrived coded; the uncoded ones sent earlier were set aside at the author’s request. Interior pictures are print resolution (299–372 ppi),
  the two covers are not (167 ppi). The portrait DB-I10 is a page of its own, kept whole (new slot kind `inset`).

Volume 3 (Ananya’s Notebook)
- Chapter 2 now consistently says **four** lies (FR/ES said three while listing four). Reversible in `edits/`.
- Age range 9–13 (the art dossier says 10–14).

Volume 4 (Anastasiya’s Echo)
- Age 13 and up, shown as “Young Adult / Grands lecteurs / Juvenil” on the back cover and on the site.
- The supplied manuscripts were taken as final text; only structure was normalized, plus three logged one-line clarifications in the guides.
- The French file’s line “Révision éditoriale proposée — 28 septembre 2026” was dropped from the book (it is a working note).
- Tagline, blurbs, short descriptions and site copy are mine; the tagline is Mama’s sentence from the book.

## Open items
- 300 ppi masters for the covers of Volumes 1 and 2 and for the plates of Volume 1, in the registered proportions; Volume 3 and 4 as before; Volume 4’s five continuity problems (its audit, section 3);
  Volume 1’s small points (its audit, section 3).
- Volume 3: “43” lettering for AN-I03 / AN-I09 once the final art exists.
- Nobody can guarantee that text passes “all AI detectors” (README, “AI detection and disclosure”). KDP asks for disclosure of
  AI-generated text, images and translations.
- Layout: every chapter, glossary, note and guide is checked for a runt last page (`design.copyfit`); remaining short last pages
  are listed in each build’s output (a few chapters, mostly in Volume 4, still end on five or six lines; in Volume 2 the shortest are English chapter 14
  and the glossaries, about five lines).
