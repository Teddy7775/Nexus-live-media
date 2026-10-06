# Sokha’s Diary — open items before this book can go to press

**Status: layout, covers, ebooks and website pages are built and checked. The book is not cleared for printing.**
The editorial review that came with the texts (`docs/source/Note_de_validation_editoriale_Le_Journal_de_Sokha.md`, 28 September 2026)
says it in its own words: *avis favorable sous réserves; bon à tirer non accordé*. That note is an AI-assisted editorial review, not a
certification by a medical expert, a demining organisation or a printer. Nothing below has been signed off by a person who holds
that expertise, and nothing in the build can replace them.

## 1. Reserves from the editorial review (A–D) and what is done about them

| | Reserve | Who has to act | State |
|---|---|---|---|
| A | **Maly’s mobility.** Level of amputation, weight bearing and crutch technique are not described enough to validate the scenes of chapters 3, 10, 13 and 16 (supports, distances, fatigue, stairs, fitting, use of the aid). | A qualified paediatric-rehabilitation professional, ideally familiar with the local context | **Open.** The text still has one crutch and no prosthesis (nothing invented). The pictures follow the art-direction convention (one underarm crutch on Maly’s right, wood then metal); the guide calls this a visual convention, not clinical instruction, and the same reviewer should look at it. |
| B | **Mine messages for children.** The guide no longer says “retrace your steps” in general, but someone competent in explosive-ordnance risk education must validate the messages as a whole and their fit with Cambodia. Kosal is an educator, not a deminer who can declare ground safe; an adults’ look at a path after rain checks its condition, not that it is free of explosives. No alert numbers or services were invented. | A person competent in explosive-ordnance risk education, with local validation of service names and numbers | **Open.** |
| C | **Four narrative connectors** written into all three languages (room to be vacated on **7 May**; relative position of the old and new rooms; the 18 April closure concerns a farm passage and is **extended on 21 April** to the school route; Maly’s arrival with Mae after the explosion is explained by her earlier absence because of pain). **Cultural check:** Khmer usages, forms of address, romanisation and the Khmer script shown for eleven entries of the guide’s glossary table. Chhouk Ksant stays a fictional village in Banteay Meanchey. | The author for the connectors; a competent Khmer reader for the check | **Open.** The connectors are in the texts as supplied. The Khmer words render correctly in the proof (Noto Sans Khmer, embedded); their spelling has not been checked by a Khmer reader. |
| D | **Composed proofs.** Contents and navigation, hyphenation, widows and orphans, page breaks, dialogue, non-breaking spaces, fonts and Khmer rendering, special characters, links, e-reader reading order, front matter. | A human proofreader per language, on paper and on an e-reader | **Automated and visual checks done, human proofreading not done.** Done: structure parity across the three languages, every picture anchor found in every language, EPUBCheck with 0 messages on all six ebooks, fonts embedded in every PDF, part pages on left-hand pages facing a right-hand first chapter, body text at the intended 11.5 pt in all six PDFs (the build stops if Chromium would shrink a page), no chapter, glossary, note or guide ending on fewer than five lines, contents page numbers read back from the PDF. |

Other points the review leaves to the author: the Latin-American Spanish is kept as supplied (*pizarrón*, *hule*, *cobija* are not
errors); the publisher may fix a priority market and vocabulary policy. The review flagged that Maly sometimes states the ethical meaning
of a scene with near-perfect clarity and suggests one last read aloud to loosen a few lines; that is an editorial choice, not made here.

## 2. Things only the author can supply (they are placeholders in every proof)

* author or pen name, publisher or imprint, **nine ISBNs** (three languages × story, guide, ebook), domain and contact address;
* the printer (KDP or IngramSpark: `bleed_mode`, spine factor) and its own cover template;
* **300 ppi masters** for the six plates and two covers (1875 × 2775 px or more; see `ILLUSTRATION_AUDIT.md`). The `--final` build
  refuses to run below 250 ppi, with the author name empty, or with a picture missing.

## 3. Decisions I made that you should confirm

1. **Volume numbers.** The series table in all your guides lists the books Sokha, Lamine, Ananya, Anastasiya; I numbered them
   that way: Sokha 1, Lamine 2, Ananya 3, Anastasiya 4. This contradicts what I did earlier (Ananya was “Volume 1”, Anastasiya
   “Volume 2”) and your own wording, which called both Anastasiya and Sokha “the second book”. Change the `volume` number in
   each `books/<slug>/book.json` if you prefer publication order, then `python3 build.py cover` and `python3 build.py site`.
   The ebooks also carry the number (`group-position`), so rebuild them too.
2. **Reader age.** 9–12 (the guide’s suggested independent reading; shared reading from 8; discussion from 13). Ananya shows 9–13.
3. **Home page.** The site still features Ananya’s Notebook first (`series.json` → `featured`; remove the key to feature the
   lowest volume number). The collection page lists all volumes in series order.
4. **Texts I wrote:** blurbs, tagline (the book’s own last line: *Next time, I’ll ask first.*), short descriptions, keywords,
   the age note and the note on difficult content for parents. Please read them as the author.
5. **Two logged wording changes to the supplied files, plus the source labels.** “a assessment day” → “an assessment day” (once in
   the English novel, once in the English guide), and the one-word labels of the guide’s twelve documentary sources (“ICRC”,
   “Convention”, …) became the descriptions the review gives for the same addresses, so a reader of the printed book can tell them
   apart. All in `docs/EDIT_LOG.md`; the French and Spanish novels are otherwise untouched.
6. **The French file’s second list in chapter 2** was numbered 4–6 (the word processor continued the first list); it restarts at 1,
   as in English and Spanish. The French “Argent du marché” page became a titled list as in the other languages (structure only).

## 4. Disclosure, and what the style audit says

Nobody can guarantee a text “passes all AI detectors”, and this build does not claim it (see README, “AI detection and
disclosure”). Amazon KDP and some retailers and libraries ask for disclosure of AI-generated text, images and translations at
upload. The illustrations in this book are generated images; declare them.

`python3 tools/audit_style.py sokha-road-to-the-bell` measures habits, not origin. For this book (EN / FR / ES): mean sentence
length 7.6 / 7.6 / 7.4 words with a healthy spread (standard deviation 5.1 / 5.0 / 5.2), no em dashes outside dialogue, 54–60 % of
paragraphs are one line (dialogue), **all 17 chapters end on a closing line of 14 words or fewer**, and the “It wasn’t X. It was Y”
contrast and sentences opening with “Not …” recur 11 and 18 times in English (9 and 22 in French). These are the voice of the book
and the review chose to keep them; a human editor may still want to vary a few chapter endings. Nothing was changed for the audit.
