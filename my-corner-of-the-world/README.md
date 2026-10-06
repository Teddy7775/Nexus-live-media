# My Corner of the World

Publishing system and website for the collection **My Corner of the World / Mon coin du monde /
Mi rincón del mundo**.

| Volume | Title | Slug | Readers |
|---|---|---|---|
| 1 | *Sokha’s Diary: The Road to the Bell* (FR *Le Journal de Sokha : Le chemin de la cloche*, ES *El diario de Sokha : El camino de la campana*) | `sokha-road-to-the-bell` | 9–12 |
| 2 | *The Drum and the Ball: Lamine’s Journal* (FR *Le Tambour et le Ballon*, ES *El tambor y el balón*) | `lamine-drum-and-ball` | 9–12 |
| 3 | *Ananya’s Notebook: The Stolen Flame* (FR *Le Vol du Safran Interdit*, ES *El cuaderno de Ananya*) | `ananya-stolen-flame` | 9–13 |
| 4 | *Anastasiya’s Echo: Katya’s Notebook* (FR *L’Écho d’Anastasiya*, ES *El eco de Anastasiya*) | `anastasiya-echo` | 13 and up |

The volume numbers follow the series table printed in the authors’ Discovery Guides (Sokha, Lamine, Ananya, Anastasiya). They
are the `volume` field of each `book.json`; change it and rebuild the covers, ebooks and site if you prefer publication order.

One source of truth per book (Markdown + a few JSON files) produces, for **each of the three
languages** and **each of the two editions** (story only; story + Discovery Guide):

| Output | Where it lands | Notes |
|---|---|---|
| Paperback interior PDF | `release/<book>/print/<lang>-<edition>/…_interior.pdf` | 6 × 9 in, bleed, embedded fonts, even page count, bookmarks, clickable contents |
| Cover wrap PDF (print) + PROOF PDF + front PNG | `release/<book>/covers/<lang>-<edition>/` | spine width computed from the real page count; PROOF shows trim/bleed/spine/safe zone |
| EPUB 3 | `release/<book>/epub/` | reflowable, accessible metadata, embedded fonts, EPUBCheck-valid |
| Website | `public_html/`, `release/my-corner-of-the-world_public_html.zip` and `release/my-corner-of-the-world_downloads_1.zip`, `_2.zip`, … (the EPUB downloads) | static, 3 languages, upload to Hostinger |

The Nexus Live Media site at the repository root (`index.php`) is **not** touched; everything for this
project lives in this folder.

## Quick start

```bash
cd my-corner-of-the-world
pip install markdown-it-py jinja2 playwright pymupdf pillow numpy opencv-python-headless pyphen fonttools brotli epubcheck
python3 build.py check                  # structure, anchors, artwork resolution
python3 build.py print                  # 6 interiors (≈ 2–4 min each)
python3 build.py cover                  # 6 cover wraps (needs the interiors for the spine)
python3 build.py epub                   # 6 EPUBs
python3 build.py site                   # website + deploy zip
python3 build.py all                    # everything
# narrow it down:  --book ananya-stolen-flame  --lang fr  --edition guide
```

Chromium is driven through Playwright. If the browser is not where Playwright expects it, set
`CHROMIUM_PATH=/path/to/chromium` (otherwise `/opt/pw-browsers/chromium` is used when present).

### Proof vs final builds

The default build is a **proof**: a missing author name, publisher or ISBN is shown as a highlighted
placeholder so the layout can be reviewed. `--final` is for the files you upload to a printer. It **stops**,
with a list, if the author name is empty, an illustration is missing, or any picture would print below
250 ppi (`--allow-lowres` overrides the last check; use it only knowingly). Final files omit every placeholder.

## Layout of the repository

```
series.json                  collection-level data: names, languages, site URL, publisher, featured book, announced volumes
books/<slug>/
  book.json                  titles, slugs, blurbs, keywords, palette, print spec, ISBN slots, reader settings
  manuscript/{en,fr,es}.md   EDITED masters (generated from original/ + edits/)
  manuscript/original/       untouched originals, never edited
  guide/…                    same for the Discovery Guides
  edits/*.json               every editorial change, one entry per change (find / replace / reason)
  docs/EDIT_LOG.md           human-readable change log generated from edits/
  art/register.json          17 illustration slots: chapter, ratio, anchor sentence per language, alt text per language
  art/source/                artwork as supplied; art/final/ (if it exists) takes precedence
  art/overrides.json         non-destructive fixes applied at build time (e.g. fold-line removal)
books/_template/             copy this to start a new volume
tools/mcw/                   build code (parser, typography, print / cover / EPUB / site renderers)
tools/apply_edits.py         original + edits → edited master      (python3 tools/apply_edits.py [slug])
tools/audit_style.py         local style-habit report (see "AI detection" below)
site/                        templates, CSS, JS, i18n strings (EN/FR/ES), PHP form handlers
assets/fonts/                self-hosted OFL fonts + licences (Literata, Nunito Sans, Caveat, Noto Sans Devanagari, Noto Sans Khmer)
docs/                        ILLUSTRATION_AUDIT.md, PREFLIGHT.md, PROGRESS.md
release/                     built deliverables
build/                       scratch space (git-ignored)
```

## Adding the next volume

Volumes 2 to 4 were added this way and needed no change to the site templates.

1. `cp -r books/_template books/<new-slug>` and fill `book.json` (including its `volume` number in the series).
2. Add the manuscripts, guides and artwork (see `books/_template/README.md`). If the supplied files are
   word-processor exports (headings as plain paragraphs, as for Anastasiya), add `books/<slug>/normalize.py`
   (see `books/anastasiya-echo/normalize.py`, or the much smaller `books/sokha-road-to-the-bell/normalize.py`): it converts
   structure only; every wording change stays a logged edit. A module-level `NOTE` string is copied into `docs/EDIT_LOG.md`.
3. Add the slug to `books` in `series.json`; remove the matching entry from `upcoming` (announced titles carry their own `volume`
   number and are merged with the real books in series order on the site, in the ebooks and on the last page of each paperback).
4. Register the pictures: `art/register.json` (copy `books/sokha-road-to-the-bell/art/build_register.py`, which generates it
   from the art-direction guide and the illustration index, and fill in chapters, anchors and alt texts).
5. `python3 build.py check --book <new-slug>` then `python3 build.py all --book <new-slug>`.

The collection page, home page (all covers), sitemap (with hreflang), language switcher, reader, parents page
and downloads are generated from the data. Per-volume colours come from `palette` in `book.json` and are turned into
contrast-checked CSS for that volume’s pages; the "coming soon" cards come from `upcoming` in `series.json`; the book shown
first on the home page is `featured` in `series.json` (default: the lowest volume number).

Per-book switches in `book.json` (all optional, defaults reproduce *Ananya’s Notebook*, Volume 3):

| Key | Effect |
|---|---|
| `parser.sound_lines` / `parser.tail` | read the italic "Sound …" line under each chapter date; keep closing notebook blocks as ordinary blocks |
| `design.hand` | `false` = serif italics instead of the handwriting face for dates, notes and lists |
| `design.nb_cards` | notebook pages (lists under a bold title) set as ruled paper with a margin line |
| `design.sound_lines`, `design.opener_num`, `design.part_period`, `design.orn` | chapter-opener layout, part-page period line, ornament (`bell`, `drum`; default a lotus) |
| `parser.prologue` | `false` when the book opens straight on Part One (no prologue section before the first part) |
| `design.note_pt` | type size of the closing note on the story, one number or a `{lang: pt}` map (default 10.4) |
| `design.inset_in` | width in inches of a picture of kind `inset` (default 5.0) |
| `design.guide_flow`, `design.guide_cards_break` | Discovery Guide sections flow one after another instead of each starting a page; question cards may split across pages |
| `design.plate_stop_at_notebook` | a full-page plate stays before the next notebook page when possible |
| `design.notice_hand` | a bold line on its own in a chapter (a line Sokha writes in his notebook) is set in the handwriting face, not as a poster-style notice |
| `design.copyfit` | a chapter whose last page would hold only a few lines gets its tracking nudged (tighter, then looser) until it does not; the book is laid out again |
| `design.text_pretty` | `text-wrap: pretty` on body text (no one-word last lines) |
| `palette.pen`, `palette.pink` | optional extra colours (handwritten lines, the ribbon rule) |
| `cover.*` | cover style (`paper` = dark text on a cream upper area, `night` = light text over a dark upper sky with a soft gradient), title lines, age label, panel fit, barcode box; `cover.back.label` puts the back-cover copy on a paper label, `text_box_in` places it, `foot_right` moves the publisher line above the barcode |
| `age_label`, `age_note`, `parents_note` | text shown on the site (age, reading advice, content note on the parents page) |

Per-picture switches in `art/register.json` (all optional): `stop` (a plate should not move past this paragraph unless its page
would stay mostly empty), `early` (a plate may stand at the page turn before its anchor paragraph when that paragraph starts a page),
`scale` (an inline picture prints narrower than the text width), `min_fill` (how full the page before a page-sized picture must be, default 0.70).
Slot kind `inset` is a picture on a page of its own, kept whole and centred on paper (no bleed, no crop), for a portrait picture that is not
meant to be a full-bleed plate. `art/overrides.json` also takes `print_paper_to_white` (a vignette
painted on a tinted paper ground prints on unprinted paper; the web copy keeps the ground).

## Website

* Pure static HTML/CSS/JS plus two tiny PHP scripts (newsletter + contact form) — works on any Hostinger
  shared plan. No database, no cookies, no third-party requests, no tracking, no ads.
* Three languages with translated URLs (`/en/books/…`, `/fr/livres/…`, `/es/libros/…`), `hreflang`,
  per-page meta/Open Graph/JSON-LD (`Book`), automatic sitemap, `robots.txt`, `.htaccess` (HTTPS, caching,
  security headers, custom 404).
* Reader: the whole novel online with illustrations; text size and light / sepia / dark themes; progress
  bar; "continue where you left off" (stored only in the visitor’s own browser); Discovery Guide page;
  “Parents & teachers” page.
* Set `reader.access` in `book.json` to `"sample"` to publish only the first `sample_chapters`
  chapters online and send readers to the paperback/ebook for the rest. Default: `"full"`.
* Accessibility: semantic landmarks, skip link, visible focus, `lang` attributes (Devanagari words are tagged
  `hi`), alt text for every illustration in each language, reduced-motion support. Body text, links, buttons and
  accent text were checked at ≥ 4.5 : 1 in the light, sepia and dark themes (decorative drop caps excepted).
  This is not a substitute for a full audit with a screen reader.

### Deploying on Hostinger

1. Fill in `series.json`: `site.url` (e.g. `https://mycorneroftheworld.com`, no trailing slash),
   `site.contact_email`, `publisher`, and `author.name` once decided. Rebuild: `python3 build.py site`.
2. In hPanel → **Files → File Manager**, open the document root of the (sub)domain (normally `public_html`) and
   upload **the contents** of the generated `public_html/` (or upload `my-corner-of-the-world_public_html.zip` and then
   every `my-corner-of-the-world_downloads_N.zip`, the EPUB downloads, into the same folder and use *Extract* on each; the downloads are
   split in parts because GitHub refuses files over 100 MB). Make sure `.htaccess` is uploaded (hidden file).
   The site uses root-relative links, so it must sit at the root of a domain or sub-domain, not in a sub-folder.
3. Copy `api/config.sample.php` to `api/config.php` and edit `owner_email` and `mail_from` (create that
   mailbox in hPanel → Emails so mail is delivered). Leave `base_path` empty.
4. hPanel → **Security → SSL** → install/enable the free SSL and “Force HTTPS”.
5. Test: submit the contact form and the newsletter form; subscribers are appended to
   `api/private/subscribers.csv`, which `.htaccess` blocks from the web (download it via File Manager).
6. Optional: connect the domain’s e-mail, add a favicon PNG set, create a Search Console property and submit
   `sitemap.xml`.

If the Nexus Live Media site stays on the main domain, create a sub-domain for this site
(e.g. `corner.yourdomain.com`, hPanel → Domains → Subdomains) and upload there, so the two do not share `.htaccess`.

The newsletter form stores an e-mail address and a consent timestamp. It is written for a general
audience of parents/teachers (the form asks the visitor to confirm they are an adult). Check with the
privacy rules that apply to you (GDPR / CCPA) and complete the legal page, whose publisher fields are
empty on purpose.

## Print and upload notes

* Trim 6 × 9 in, 11.5 pt Literata, 1.5 leading, margins: top 0.78, bottom 0.9, inner 0.85, outer 0.65 in.
* **Amazon KDP**: set `"bleed_mode": "outside"` (page 6.125 × 9.25 in) and rebuild; KDP wants no bleed on the
  spine edge. **IngramSpark / most offset printers**: keep `"all"` (6.25 × 9.25 in).
* Spine = pages × paper factor (cream 0.0025 in/page; white 0.002252; premium colour 0.002347 — KDP figures).
  The cover builder reads the page count of the matching interior, so always rebuild covers after the interior.
  Confirm against the printer’s own template before uploading: factors differ by printer and paper.
* The PRINT cover leaves the barcode box empty (2 × 1.2 in, bottom right of the back cover) — KDP/IngramSpark
  add the ISBN barcode there. The PROOF cover draws all guides and placeholders.
* All fonts are embedded. Colours are RGB; let the printer’s preflight convert to CMYK/PDF-X.
* Page count is always even; recto/verso rules (chapter openers on right-hand pages, blank
  verso where needed) are solved by the layout.

## AI detection and disclosure — read this

* **Nobody can guarantee that text passes “all AI detection tools.”** Detectors disagree with one another,
  routinely flag polished human prose, and none is certified. *Ananya’s Notebook* got a light, logged line edit aimed at what a
  human editor would fix anyway (repeated sentence shapes, stock phrases, over-even rhythm, translationese); *Anastasiya’s Echo*,
  *Sokha’s Diary* and *The Drum and the Ball* were taken as supplied (the corrected versions that came with their reviews, or the
  author’s files), with only structure normalized and a few logged one-line fixes (`books/*/docs/EDIT_LOG.md`). The habits of a text are measured with `tools/audit_style.py`, which
  reports *habits* (sentence-length spread, repeated openers, stock-phrase counts), not a detector score.
* **Disclosure obligations are real.** Amazon KDP requires you to declare AI-generated content
  (text, images and translations) when you upload; other retailers and some schools/libraries ask the
  same. Declare it honestly: it does not block publication.

## Licences

Code in this folder: yours to use. Fonts in `assets/fonts/` are SIL Open Font Licence 1.1 (licence files
included). Illustrations and text belong to the author.
