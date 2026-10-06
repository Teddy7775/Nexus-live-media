# The Drum and the Ball — open items before this book can go to press

**Status: layout, covers, ebooks and website pages are built and checked. This volume came without any editorial sign-off, so it
is a proof, not a print-ready file.** The dossier holds the three novels, the three Discovery Guides, the art direction, the
register and the pictures. It holds no review note of the kind the Sokha volume came with, and nobody other than the author has
read these texts as an editor, a proofreader or a reader from the region they describe. “Ready to publish” depends on the
items below, not on the build.

## 1. What was checked here, and what was not

Done (automated or by me, none of it a human sign-off):

* the three novels share one structure (17 chapters in four parts, epilogue, glossary, note), paragraph for paragraph; chapter
  dates, times and scores agree across the languages (the French writes 15 h 47 where English writes 3:47);
* every sentence the guides quote from the novel was found in the novel, in each language, except four that cannot be verbatim by
  construction: Baba’s genealogy line (twice, it is split by a dialogue tag in the novel), Mom’s “A dream takes time” sentence
  (two sentences joined across a tag) and the guide’s own debate motion;
* the guides’ chapter, part and date references match the novels;
* EPUBCheck: no messages on all six ebooks; fonts embedded in every PDF; body text 11.5 pt in all six PDFs; parity of part and
  chapter pages; the closing note fits on one page in every language (French at 10.0 pt, see section 4); every chapter, glossary and
  note was checked for a runt last page, and the shortest remaining last pages are about five lines (English chapter 14 at 16 %,
  the English and Spanish glossaries at 15 %, the French glossary at 18 %);
* pictures: every file identified by its scene and compared with the art direction (`ILLUSTRATION_AUDIT.md`).

**Facts, checked on the web on 6 October 2026** (sources open in a browser; this is a spot check, not a fact-check of the book):

* Diambars was founded in 2003 by Bernard Lama, Patrick Vieira, Jimmy Adjovi-Boco and Saer Seck (the guide says “a group that
  included Patrick Vieira”): confirmed. [southafrica.info](https://www.southafrica.info/2010/diambars-110707), [au-senegal.com](https://au-senegal.com/institut-diambars,3486.html)
* The Senegambia Bridge opened on 21 January 2019, inaugurated by Presidents Sall and Barrow: confirmed.
  [Wikipedia](https://en.wikipedia.org/wiki/Senegambia_bridge), [Africanews](https://www.africanews.com/2019/01/22/bridge-to-connect-gambia-senegal-opens/)
* The Bambali municipal stadium with a synthetic pitch was inaugurated in early January 2024 and Mané financed a hospital there:
  confirmed by press reports. [Sidwaya](https://www.sidwaya.info/senegal-sadio-mane-annonce-la-construction-dun-stade-a-bambaly-au-senegal-son-village-natal/), [SenePlus](https://www.seneplus.com/index%2Ephp/article/legende-du-football-africain-et-bienfaiteur-de-bambali-sadio-mane-un-genie-sur-la-pelouse)
* 1,000 CFA francs is about 1.52 euros at the fixed parity of 655.957 francs to the euro: arithmetic checked (1.5245).
* *Le Ballon d’or*, Yves Pinguilly, Rageot, 1994, from Cheik Doukouré’s film, a boy from a Guinean village: confirmed.
  *Sunyata o la epopeya mandinga* exists at Edicions Bellaterra (year not confirmed).

**Not verified** (the guide cites its own sources for most of these, and I did not re-check them): the 2023 census figure, the
Africa Cup of Nations and World Cup results and dates, Mané’s clubs and awards, the dates Ramadan began in Senegal in 2024, the
description of the Casamance, griot vocabulary and instruments, and the English (*Booked*, *Sundiata*, *Akissi*) and French
(*Akissi*, *Soundjata*) reading-list entries. One Spanish entry is doubtful: *Luna de Senegal* by Agustín Fernández Paz is given as
published by Anaya, about a girl who leaves Senegal to join her father in Vigo; the search found the Galician original (*Lúa do
Senegal*, Xerais, 2009) and a Catalan edition (Barcanova, 2010), describing a girl who arrives in Galicia with her mother and sister.
Please check that entry (publisher, edition, summary) before printing.

## 2. Reserves I recommend (mine, not from a reviewer)

| | Reserve | Who has to act |
|---|---|---|
| A | **A reader from Senegal, ideally Casamance.** Names and forms of address (Baba, Yaye Khady, “Auntie”, Madame / Monsieur), the choice not to name the family’s language or group, the ceremony, the market, Ramadan details (Awa fasting “at least until breakfast”), clothing and village in the pictures. The art direction itself says its architecture and landscape are story illustrations, not documentary evidence. | The author, with a competent reader |
| B | **Real people and institutions.** The guide and the note name Sadio Mané (hospital, stadium, awards), Patrick Vieira, Diambars, Génération Foot and clubs. The novel invents Cheikh without surname, logo or club. Whether naming living people needs a rights or legal read is the author’s or the publisher’s call. | The author or publisher |
| C | **Human proofreading of the composed pages** in each language, on paper and on an e-reader (hyphenation, widows and orphans, dialogue, French and Spanish punctuation, contents, links). | A proofreader per language |
| D | **Duplicate paragraph** in the note (see section 4): I removed it and logged it; the author may prefer the other wording. | The author |

## 3. Things only the author can supply (they are placeholders in every proof)

* author or pen name, publisher or imprint, **nine ISBNs** (three languages × story, guide, ebook), domain and contact address;
* the printer (KDP or IngramSpark: `bleed_mode`, spine factor) and its own cover template;
* **300 ppi masters of the two covers** (1875 × 2775 px or more; the interior pictures are already at 299–372 ppi). The `--final`
  build refuses to run below 250 ppi, with the author name empty, or with a picture missing.

## 4. Decisions I made that you should confirm

1. **Volume number 2.** The series table in every Discovery Guide lists Sokha, Lamine, Ananya, Anastasiya, so Lamine is Volume 2
   and the earlier books are 3 and 4. You called this one “the last book of the series”, as you called Sokha and Anastasiya “the
   second book”: you count in the order the files reach me, the guides count in series order. I follow the guides. If you prefer
   delivery order, change `volume` in each `books/<slug>/book.json`, then `python3 build.py cover epub site`.
2. **Reader age 9–12** (the guide’s own: independent reading 9–12, shared reading from 8, discussion from 13). The art direction
   proposes 9–13 and says that is a design recommendation, not metadata.
3. **Texts I wrote:** blurbs, the tagline (*Listen. Pass. Play fair.*, the three promises of chapter 13 and the way the book keeps
   its distance from a promise of stardom), short descriptions, keywords and the note for parents. Please read them as the author.
4. **Logged wording changes to the supplied files** (all in `docs/EDIT_LOG.md`):
   * English novel: a missing full stop in the glossary entry “Madame, Monsieur”; the last paragraph of the note, which repeats
     the one before it with two words changed (the dossier flags it; the Spanish file does not have it);
   * French novel: the same duplicate paragraph removed;
   * English guide: two phrases about “garbage” aligned with the novel and with the French and Spanish guides;
   * Spanish guide: “Ramadán” in lower case in running text, as everywhere else in that guide.
   Structure only, no wording: contents heading in English and Spanish, ten `---` rules dropped in French, the French glossary set one
   entry per line like the others, the three promises of chapter 13 as a list in English as in French and Spanish, “Pagne” before
   “Pirogue” in the English glossary and in the English guide’s table. Nothing else in any of the six texts was touched.
5. **Design choices for this book:** a goblet-drum ornament; a night-sky cover with ivory title and a paper label for the back-cover
   copy; the picture DB-I10 on a page of its own, kept whole (the art direction asks for that); a smaller type for the French note
   (10.0 pt instead of 10.4) so that it does not spill three lines onto a page of its own. The palette comes from the art direction’s
   working swatches.
6. **Home page.** Still features Ananya’s Notebook (`series.json` → `featured`); the “coming soon” card for this title is gone now
   that it is built.

## 5. Disclosure, and what the style audit says

Nobody can guarantee a text “passes all AI detectors”, and this build does not claim it (README, “AI detection and disclosure”).
Amazon KDP and some retailers and libraries ask for disclosure of AI-generated text, images and translations at upload. The
illustrations of this book are generated images (the dossier says so); declare them.

`python3 tools/audit_style.py lamine-drum-and-ball` measures habits, not origin. For this book (EN / FR / ES): mean sentence length
6.7 / 6.8 / 6.5 words with a wide spread (standard deviation 4.5 / 4.4 / 4.6), no em dashes outside dialogue, 64 / 61 / 68 % of
paragraphs are one line, 16 / 16 / 17 of the 18 chapters and epilogue end on a closing line of 14 words or fewer, the “It wasn’t X.
It was Y” contrast occurs 8 / 13 / 3 times and sentences opening with “Not …” 33 / 41 / 5 times, and the narrator opens a thought
with “Maybe …” 25 / 38 / 6 times. These are the voice of the book; a human editor may still want to vary a few of them. Nothing was
changed for the audit.
