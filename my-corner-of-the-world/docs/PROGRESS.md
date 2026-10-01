# Work in progress: My Corner of the World, Volume 1 (Ananya's Notebook)

_This file is the handoff note. It is updated at every commit so nothing lives only in a chat._

## Done so far
- Repo skeleton under `my-corner-of-the-world/` (the existing Nexus `index.php` at the repo root is untouched).
- Sources preserved verbatim: `books/ananya-stolen-flame/manuscript/original/{en,fr,es}.md`, `guide/original/{en,fr,es}.md`, dossier + register under `docs/source/`.
- All 17 illustrations recovered from the chat session and filed under their register names in `art/source/` (+ one alternate of AN-I04). They are the chat-resized copies (max 2000 px), **not print masters**.
- `art/register.json`: 17 slots, EN/FR/ES alt text and scene titles, per-language anchor sentences.
- `series.json`, `book.json` (titles, blurbs, palette, print spec, editions: story / story+guide).
- Parser (`tools/mcw/mdparse.py`) for manuscripts + guides, typography (`typo.py`), art loader with fold-line removal (`art.py`).
- Print interior renderer (`render_print.py` + `templates/print.css.j2`), first EN render = 156 pages.

## Known issues being fixed next
- Running heads/folios: Chromium `@page :first` is unreliable, so heads/folios will be drawn as a vector overlay after layout (contents links give page targets).
- FR/ES masters need markup normalisation (bullets, italic notes) to match EN.

## Still to do
1. Editorial pass EN/FR/ES (human-voice line edit, keep the 15 anchor sentences, log every change).
2. Cover wrap per language/edition (spine from real page count), front-cover typography.
3. EPUB3 (6 files).
4. Website (EN/FR/ES), PHP handlers, Hostinger README.
5. QA + preflight report.

## Inputs only the author can supply (cannot be invented)
author/pen name, publisher/imprint, ISBNs, domain + contact email, printer (spine/bleed template), print-master artwork.
