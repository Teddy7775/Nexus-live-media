# Illustration audit — Volume 3 (*Ananya’s Notebook: The Stolen Flame*)

Audited against `Ananya_Illustration_Prompts_and_Art_Direction_EN.docx` and
`Ananya_Registre_Illustrations.xlsx` (copies in `books/ananya-stolen-flame/docs/source/`).
Machine-readable register: `books/ananya-stolen-flame/art/register.json`.
Re-run the numeric part at any time with `python3 build.py check`.

**Bottom line.** All 17 slots (15 interior, 2 cover) have an image and every image is placed at its
anchor sentence in all three languages. The supplied files are good enough for a **proof** and for the
**website/EPUB**. They are **not print masters**: they were exported at reduced size, so full-page
plates and the cover land near 165–180 ppi instead of the 300 ppi a printer expects, and seven images
do not have the aspect ratio the register asks for. Details and the fix list are below.

## 1. Resolution and format

| ID | Scene (EN title) | File (px) | Slot | Placement in the book | ≈ppi |
|---|---|---|---|---|---|
| AN-I01 | Two Steps Behind | 1024×1536 | full 2:3 | full-bleed plate, ch. 1 | 164 |
| AN-I02 | The Secret in the Bedroom | 2000×1493 | half 3:2 | inline, ch. 2 | 444 |
| AN-I03 | Square Number 43 | 1024×1536 | full 2:3 | full-bleed plate, ch. 4 | 164 |
| AN-I04 | Six Minutes in the Wind | 1536×1024 | half 3:2 | inline, ch. 6 | 341 |
| AN-I05 | What Farida Knows About Paper | 1536×1024 | **full 2:3 – landscape supplied** | inline, ch. 8 | 341 |
| AN-I06 | The Lesson in Footwork | 2000×1493 | **full 2:3 – landscape supplied** | inline, ch. 9 | 444 |
| AN-I07 | Waiting for the Rescuers | 2000×1493 | half 3:2 (4:3 supplied) | inline, ch. 10 | 444 |
| AN-I08 | Her Hands Are Her Own | 1536×1024 | half 3:2 | inline, ch. 11 | 341 |
| AN-I09 | The Evidence on the Table | 1024×1536 | full 2:3 | full-bleed plate, ch. 12 | 164 |
| AN-I10 | Making Amends Through Work | 2000×1116 | half 3:2 (16:9 supplied) | inline, uncropped, ch. 13 | 444 |
| AN-I11 | Vikram Without His Audience | 2000×1116 | half 3:2 (16:9 supplied) | inline, uncropped, ch. 14 | 444 |
| AN-I12 | A Flame With Permission | 2000×1493 | **full 2:3 – landscape supplied** | inline, ch. 15 | 444 |
| AN-I13 | The Sky for Ma Too | 2000×1116 | spread 4:3 (16:9 supplied) | top-bleed band across a spread, ch. 16 | 163 |
| AN-I14 | The Last Loop | 2000×1116 | spread 4:3 (16:9 supplied) | top-bleed band across a spread, ch. 17 | 163 |
| AN-I15 | Looking at Color Together | 1536×1024 | half 3:2 | inline, epilogue | 341 |
| AN-C01 | Front cover | 1116×2000 (9:16) | cover 2:3 | front panel, cropped from the top | 182 |
| AN-C04 | Back cover | 1024×1536 | cover 2:3 | back panel | 167 |

* Every image was delivered inside the chat, i.e. already downscaled (longest side ≤ 2000 px).
  Nothing in the pipeline can add real detail back, and I did not upscale (it only blurs).
* To reach 300 ppi, a full bleed plate needs **1875×2775 px**, a cover panel ≈ **1913×2775 px**, a
  two-page spread ≈ **3825×2775 px**; inline 3:2 images need ≈ 1500 px across.
* Drop the original generator exports (PNG/TIFF) into `books/ananya-stolen-flame/art/final/` using the
  same file names (`AN-I01_…` etc.) and run `python3 build.py print --final`. `final/` wins over
  `source/`, so nothing else needs editing.
* Colour: files are sRGB. CMYK/PDF-X conversion is left to the printer’s own preflight (KDP converts
  automatically; IngramSpark accepts RGB PDFs with embedded profiles).

## 2. Aspect-ratio mismatches (register vs supplied)

| ID | Asked for | Got | What the layout does |
|---|---|---|---|
| AN-I05, I06, I12 | full-page portrait 2:3 | landscape | placed inline at text width, no crop; the page keeps its place in the story but loses the "full-page" beat |
| AN-I07 | 3:2 | 4:3 | inline, uncropped |
| AN-I10, I11 | 3:2 | 16:9 | inline, uncropped |
| AN-I13, I14 | spread 4:3 | 16:9 | band bleeding off the top of a two-page spread (6.8 in of 9.25 in); the lower edge fades to paper |
| AN-C01 | 2:3 | 9:16 | front panel crops 0.75 in from the top; title sits in the sky |

Re-generating I05, I06, I12 as true 2:3 portraits and I13, I14 as 4:3 is the single most visible
improvement available for the paperback.

## 3. Continuity and art-direction findings

Checked against the “image check” column of the register and the manuscript text.

**Corrected in the pipeline (non-destructive, logged in `art/overrides.json`)**
* AN-I13 / AN-I14: a vertical fold/shadow line and a faint dotted seam ran through the middle of the
  16:9 pictures. Removed by dividing out the shadow estimated from the sky rows and interpolating the
  hairline. The register asked for a neutral area at the fold; this keeps it clean.
* AN-I13 / AN-I14: bottom edge faded into the page so the band does not stop abruptly.

**Not fixable in layout — please review (listed most important first)**
1. **AN-I02 and AN-I06 show a large wooden spinning wheel** (cotton-spinning *charkha*). The story’s
   *charkhi* is the hand-held reel that holds kite line. In I02 the wheel sits in the bedroom, which
   suggests a different object and a different family occupation. Re-generate without it (or replace
   with the plain spool described in chapter 1).
2. **AN-I12 contains baked-in English text (“FLIGHT LOG”).** It is not translated in the FR and ES
   books. Re-generate without lettering; the layout can add text per language.
3. **AN-I13:** the dossier says Ananya wears clear protective glasses at the festival; she has none
   here. The register also says Ma’s kite is green and Agni is out of frame: some kites in the sky read
   as Agni (black with a red flame).
4. **AN-I14:** the spool Ananya holds looks full although the text says the cotton has run out, and
   Meena stands on the vertical centre of the spread, i.e. exactly where the gutter will swallow
   part of her. Both are easy to correct when the image is regenerated.
5. **Kite tails:** several kites have tails; the Discovery Guide states Jaipur patang have none.
   Either fix the pictures or soften the guide sentence (I left it unchanged because it is
   factual content, not style).
6. **Two rendering styles** are mixed (soft watercolour vs. harder ink-line). Faces and costumes are
   consistent enough for identification (Ananya: teal sweater, long braid; Rohan: maroon sweater,
   bandaged right hand; Meena: bob, green sweater) but the two styles are visible side by side
   in the printed book. A single re-generation pass with one style prompt would solve this and
   increase resolution at the same time.
7. **AN-I04 has two variants**; the primary (kite upper-left with bougainvillea) is used. The ALT is
   kept in `art/source/` for the author.
8. **AN-I03 / I09:** the numeral “43” and the text “Redo 43. Do not cut.” that the dossier asks to
   add in layout are **not yet added**: they should be typeset over the pictures only once you
   confirm the final art, because their position depends on the final crop.

## 4. Where pictures sit in the story

Placement rules used: one picture at a scene’s turning point, never in the first or last paragraph
of a chapter, never before a reveal that the picture would spoil. The anchor sentence for each slot
(different in each language) is stored in the register; `python3 build.py check` fails the build if
any anchor stops matching after an edit.

Opening pages with a full-bleed plate: chapters 1, 4, 12 (and the covers). Spreads: chapters 16 and 17
(the two sky scenes). All other pictures are inline.
