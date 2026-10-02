# Status: My Corner of the World

_Handoff note, updated at each commit so nothing lives only in a chat._

## Delivered (all rebuilt from source by `python3 build.py all`)

| | Volume 1 · *Ananya’s Notebook* (`ananya-stolen-flame`) | Volume 2 · *Anastasiya’s Echo* (`anastasiya-echo`) |
|---|---|---|
| Print interiors (EN / FR / ES × story / story + guide) | 156–186 pp | 188–224 pp |
| Cover wraps (print PDF, proof PDF, front PNG), spine from real page count | 6 | 6 |
| EPUB 3, EPUBCheck valid with 0 messages | 6 | 6 |
| Illustrations placed | 15 + 2 covers | 15 + 2 covers |
| Website pages (EN/FR/ES, reader, guide, parents) | in the shared site | in the shared site |

Website: one static site for the whole collection (`public_html/`, zip in `release/`), 189 pages, three languages.
Upload steps for Hostinger are in `README.md`. Reports: `docs/PREFLIGHT.md` (files), `docs/ILLUSTRATION_AUDIT.md` (Volume 1),
`books/anastasiya-echo/docs/ILLUSTRATION_AUDIT.md` (Volume 2), `books/*/docs/EDIT_LOG.md` (every text change).

## Not final until the author supplies (cannot be invented)
author / pen name, publisher or imprint, ISBNs (one per language and format), domain + contact email,
print-master artwork (300 ppi), printer choice (KDP vs IngramSpark: `bleed_mode`, spine factor). Proofs show highlighted
placeholders; `--final` refuses to build with them or with pictures below 250 ppi.

## Decisions to confirm
Volume 1
- Chapter 2 now consistently says **four** lies (FR/ES said three while listing four). Reversible in `edits/`.
- “First volume” everywhere (the validation note calls Ananya the third book).
- Age range 9–13 (the art dossier says 10–14).

Volume 2
- Age 13 and up, shown as “Young Adult / Grands lecteurs / Juvenil” on the back cover and on the site. The collection pages
  therefore no longer say “9 to 13” in general; each book shows its own range.
- The three supplied manuscripts were taken as final text (they are the “corrigé” versions). Only structure was normalized
  (`books/anastasiya-echo/normalize.py`); the only wording changes are three logged one-line clarifications in the guides.
- The French file’s line “Révision éditoriale proposée — 28 septembre 2026” was dropped from the book (it is a working note).
- Volume 2 is also “Grands lecteurs” for the French edition, which matches the French file’s own wording.
- Tagline, blurbs, short descriptions and site copy for Volume 2 are mine; the tagline is Mama’s sentence from the book.

Both volumes
- “Upcoming volumes” cards on the site come from `series.json` (`visible: true`); hide them if those titles are not public yet.

## Open items
- 300 ppi masters in the registered proportions for both volumes; Volume 2’s five continuity problems (audit section 3).
- Volume 1: “43” lettering for AN-I03 / AN-I09 once the final art exists.
- Nobody can guarantee that text passes “all AI detectors”; the line edit on Volume 1 is light and Volume 2 was not touched
  (README, “AI detection and disclosure”). KDP asks for disclosure of AI-generated text, images and translations.
