# Status: My Corner of the World

_Handoff note, updated at each commit so nothing lives only in a chat._

## Delivered (all rebuilt from source by `python3 build.py all`)

| | Vol. 1 · *Sokha’s Diary* (`sokha-road-to-the-bell`) | Vol. 3 · *Ananya’s Notebook* (`ananya-stolen-flame`) | Vol. 4 · *Anastasiya’s Echo* (`anastasiya-echo`) |
|---|---|---|---|
| Print interiors (EN / FR / ES × story / story + guide) | 128–152 pp | 152–178 pp | 184–220 pp |
| Cover wraps (print PDF, proof PDF, front PNG), spine from real page count | 6 | 6 | 6 |
| EPUB 3, EPUBCheck valid with 0 messages | 6 | 6 | 6 |
| Illustrations placed | 15 + 2 covers | 15 + 2 covers | 15 + 2 covers |
| Cleared for press | **no**, see `books/sokha-road-to-the-bell/docs/OPEN_ITEMS.md` | no (proofs) | no (proofs) |

Volume 2 (*The Drum and the Ball: Lamine’s Journal*) is announced on the site and on the last page of each paperback; it is not built.

Website: one static site for the whole collection (`public_html/`; `release/my-corner-of-the-world_public_html.zip` plus
`release/my-corner-of-the-world_downloads.zip` for the EPUBs, two files because GitHub refuses files over 100 MB), 258 pages, three languages.
Upload steps for Hostinger are in `README.md`. Reports: `docs/PREFLIGHT.md` (files), `books/*/docs/ILLUSTRATION_AUDIT.md`
(`docs/ILLUSTRATION_AUDIT.md` is Volume 3), `books/sokha-road-to-the-bell/docs/OPEN_ITEMS.md`, `books/*/docs/EDIT_LOG.md` (every text change).

## Not final until the author supplies (cannot be invented)
author / pen name, publisher or imprint, ISBNs (one per language and format), domain + contact email,
print-master artwork (300 ppi; Sokha’s plates and covers are 1024 × 1536 px, about 165 ppi), printer choice (KDP vs IngramSpark:
`bleed_mode`, spine factor). Proofs show highlighted placeholders; `--final` refuses to build with them or with pictures below 250 ppi.

## Decisions to confirm
Series
- **Volume numbers.** Sokha 1, Lamine 2, Ananya 3, Anastasiya 4, as in the series table of every Discovery Guide (Ananya’s own
  validation note already called it the third book). Earlier builds had Ananya 1 and Anastasiya 2, and the request for Sokha
  called it “the second book”, like Anastasiya. Change `volume` in each `book.json` to use publication order; then
  `python3 build.py cover epub site`.
- The home page features Ananya’s Notebook first (`series.json` → `featured`).
- “Coming soon” cards (Lamine) come from `series.json` (`visible: true`); hide them if that title is not public yet.

Volume 1 (Sokha’s Diary)
- Reader age 9–12 (the guide’s suggested independent reading; shared reading from 8; discussion from 13).
- Texts taken as supplied: two logged grammar fixes (English), twelve descriptive source labels per guide (from the review’s own list),
  two structure fixes in the French novel. Blurbs, tagline (the book’s last line), keywords and the parents’ note are mine.
- Not cleared for press: mobility of Maly, mine-risk messages, four narrative connectors, Khmer cultural check, human proofreading.

Volume 3 (Ananya’s Notebook)
- Chapter 2 now consistently says **four** lies (FR/ES said three while listing four). Reversible in `edits/`.
- Age range 9–13 (the art dossier says 10–14).

Volume 4 (Anastasiya’s Echo)
- Age 13 and up, shown as “Young Adult / Grands lecteurs / Juvenil” on the back cover and on the site.
- The supplied manuscripts were taken as final text; only structure was normalized, plus three logged one-line clarifications in the guides.
- The French file’s line “Révision éditoriale proposée — 28 septembre 2026” was dropped from the book (it is a working note).
- Tagline, blurbs, short descriptions and site copy are mine; the tagline is Mama’s sentence from the book.

## Open items
- 300 ppi masters in the registered proportions for all three volumes; Volume 4’s five continuity problems (its audit, section 3);
  Volume 1’s small points (its audit, section 3).
- Volume 3: “43” lettering for AN-I03 / AN-I09 once the final art exists.
- Nobody can guarantee that text passes “all AI detectors” (README, “AI detection and disclosure”). KDP asks for disclosure of
  AI-generated text, images and translations.
- Layout: every chapter, glossary, note and guide is checked for a runt last page (`design.copyfit`); remaining short last pages
  are listed in each build’s output (a few chapters, mostly in Volume 4, still end on five or six lines).
