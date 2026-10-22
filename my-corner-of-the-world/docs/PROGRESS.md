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

Website: one static site for the domain **compasskite.com** (`public_html/`; `release/compasskite.com_public_html.zip` plus
`release/compasskite.com_downloads_N.zip` for the EPUBs, split because GitHub refuses files over 100 MB), three languages. The domain root is a small portal that lists
the hosted projects (`portal/projects.json`); this collection is the project in `/my-corner-of-the-world/`. Upload steps for Hostinger are in `README.md`. Reports: `docs/PREFLIGHT.md` (files), `books/*/docs/ILLUSTRATION_AUDIT.md`
(`docs/ILLUSTRATION_AUDIT.md` is Volume 3), `books/*/docs/OPEN_ITEMS.md` (Volumes 1 and 2), `books/*/docs/EDIT_LOG.md` (every text change).

## Supplied on 2026-10-22
Domain **compasskite.com** (shared with other projects: *Tech Explorer* and one more with three volumes, others later), author **Teddy Nana**, printer leaning
to **Amazon KDP** (not final). The contact e-mail “will be supplied later”.

## Not final until the author supplies (cannot be invented)
publisher or imprint (and address, for the legal page), ISBNs (KDP can assign a free one per paperback; own ISBNs are one per language and edition, plus ebooks sold elsewhere than Kindle), contact e-mail,
print-master artwork (300 ppi; the covers are 1024 × 1536 px or less, about 146–182 ppi; the plates of Volumes 1, 3 and 4 are 143–164 ppi, Lamine’s interior pictures are fine), the
printer’s final choice and the ink type (standard or premium colour). Proofs show highlighted placeholders for the publisher and the ISBN; `--final` refuses to build with the author name empty
or with pictures below 250 ppi.

## Decisions to confirm
KDP and the domain (2026-10-22)
- **Print files are now in Amazon KDP geometry** (`print.bleed_mode: "outside"`, page 6.125 × 9.25 in, TrimBox/BleedBox set), reversible by one value per `book.json` and a rebuild.
  The previous files (bleed on all four sides, cream paper) stay in `release/` as last committed and are **not** the KDP files.
- **White paper, standard colour.** KDP prints colour interiors on white paper only. Standard colour (spine 0.002252 in/page) was chosen over premium colour (0.002347 in/page)
  because KDP’s cost per page makes premium colour unaffordable for books of 128–220 pages at children’s-book prices (see README, “Print and upload notes”). To switch: `print.paper` → `premium_color`, rebuild the covers.
- **One domain, several projects.** This collection moved under `/my-corner-of-the-world/` (`site.base_path`), with a portal at the root. Decide the path once: it is part of every published URL.
  *Tech Explorer* is a hidden entry in `portal/projects.json` (only its name is known). The legal and contact links of the portal point at this project’s pages for now.
- Rebuilt binaries are **not** committed this round (each regeneration adds about 0.5 GB to a repository that is already about 1.7 GB): `release/` holds the earlier build, and the new files travel as zip archives.
  `MCW_RELEASE=<dir> python3 build.py all` rebuilds them anywhere. Moving `release/` to Git LFS or GitHub Releases is still recommended.

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
- 300 ppi masters for the covers of Volumes 1 and 2 and for the plates of Volume 1, in the registered proportions; Volume 3 and 4 as before; Volume 4’s open picture problems (its audit, section 3: camera still raised in AE-I13, the wooden bird’s wings in AE-I09 / AE-C04, two rendering styles; the other three of the first five were fixed by regenerated pictures);
  Volume 1’s small points (its audit, section 3).
- Volume 3: “43” lettering for AN-I03 / AN-I09 once the final art exists.
- Nobody can guarantee that text passes “all AI detectors” (README, “AI detection and disclosure”). KDP asks for disclosure of
  AI-generated text, images and translations.
- Layout: every chapter, glossary, note and guide is checked for a runt last page (`design.copyfit`); remaining short last pages
  are listed in each build’s output (a few chapters, mostly in Volume 4, still end on five or six lines; in Volume 2 the shortest are English chapter 14
  and the glossaries, about five lines).
