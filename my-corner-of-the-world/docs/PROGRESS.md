# Status: My Corner of the World, Volume 1 (Ananya’s Notebook)

_Handoff note, updated at each commit so nothing lives only in a chat._

## Delivered (all rebuilt from source by `python3 build.py all`)
- **Print interiors, 6**: EN / FR / ES × story / story + Discovery Guide, 6 × 9 in with bleed, 156–186 pages, fonts embedded, bookmarks, clickable contents, even page count.
  Full-page plates and spreads sit at the end of the page that holds their anchor paragraph, so no text page before a picture is left nearly empty.
- **Cover wraps, 6** (print PDF, proof PDF with guides, front PNG): spine computed from each interior’s real page count.
- **EPUB 3, 6**: EPUBCheck valid, 0 messages (`docs/PREFLIGHT.md`).
- **Website** (`public_html/`, zip in `release/`): EN/FR/ES, reader, Discovery Guide, parents page, forms (PHP), sitemap/hreflang/JSON-LD, README-DEPLOY for Hostinger. 96 pages.
- **Editorial pass**: 85 logged edits (`books/ananya-stolen-flame/docs/EDIT_LOG.md`), originals preserved verbatim.
- **Docs**: `README.md`, `docs/ILLUSTRATION_AUDIT.md`, `docs/PREFLIGHT.md`, `books/_template/README.md`.

## Not final until the author supplies (cannot be invented)
author / pen name, publisher or imprint, ISBNs (one per language and format), domain + contact email,
print-master artwork (300 ppi, see `docs/ILLUSTRATION_AUDIT.md`), printer choice (KDP vs IngramSpark:
`bleed_mode`, spine factor). Proof files show highlighted placeholders for the missing items; `--final` refuses to build with them.

## Decisions to confirm
- Lie count: the manuscripts and guides now consistently say **four** lies in chapter 2 (the original FR/ES text said “three” while listing four). Reversible in `edits/`.
- Ananya’s volume number: “first volume” everywhere (the validation note called it the third book).
- Age range 9–13 (the art dossier says 10–14).
- Tagline, blurbs, short descriptions and site copy are proposals written in this project.
- “Upcoming volumes” cards on the site come from `series.json` (`visible: true`); hide them if the other titles are not public yet.

## Open items / ideas
- Replace the supplied pictures with 300 ppi masters in the registered aspect ratios (five slots need re-generation: see audit) and run `python3 build.py all --final`.
- Add “43” / “Redo 43. Do not cut.” lettering to AN-I03 and AN-I09 once the final art exists.
- A deeper line edit is possible but changes the author’s text; measured effect of the current pass is small (see README, “AI detection and disclosure”).
