#!/usr/bin/env python3
"""Generate art/register.json from the supplied illustration index (CSV) and art-direction guide.

Anchors: the English anchor comes from the index; the French and Spanish anchors are the same
paragraph (the three manuscripts have the same paragraph structure), cut at the end of its first
sentence. Scene titles and FR/ES alt texts are written for this project.
Run: python3 books/anastasiya-echo/art/build_register.py
"""
import csv, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))
from mcw.mdparse import parse_manuscript, strip_tags  # noqa: E402
from mcw import typo  # noqa: E402

B = ROOT / "books" / "anastasiya-echo"
OPTS = {"tail": False, "sound_lines": True}
MS = {l: parse_manuscript((B / "manuscript" / f"{l}.md").read_text(encoding="utf-8"), l, OPTS) for l in ("en", "fr", "es")}
WORDS = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen",
         "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty", "Twenty-One", "Twenty-Two", "Twenty-Three", "Twenty-Four"]

FULL = {"AE-I01", "AE-I03", "AE-I04", "AE-I06", "AE-I08", "AE-I10", "AE-I12", "AE-I14", "AE-I15"}

SCENE = {
 "AE-I01": ("The silent school bell", "La cloche silencieuse de l’école", "La campana silenciosa de la escuela"),
 "AE-I02": ("The landing library", "La bibliothèque du palier", "La biblioteca del descanso"),
 "AE-I03": ("Two fingers on a cheek", "Deux doigts sur une joue", "Dos dedos en la mejilla"),
 "AE-I04": ("Letting someone else carry her", "Se laisser porter", "Dejar que otra persona la cargue"),
 "AE-I05": ("A hand on Katya’s chin", "Une main sur le menton de Katya", "Una mano en la barbilla de Katya"),
 "AE-I06": ("Listening at the clinic", "Écouter à la clinique", "Escuchar en la clínica"),
 "AE-I07": ("Asking before keeping a voice", "Demander avant de garder une voix", "Preguntar antes de guardar una voz"),
 "AE-I08": ("The recorder under the missing roof", "L’enregistreur sous le toit absent", "La grabadora bajo el techo que falta"),
 "AE-I09": ("Seven seconds of laughter", "Sept secondes de rire", "Siete segundos de risa"),
 "AE-I10": ("A person beyond the word missing", "Une personne au-delà du mot « disparu »", "Una persona más allá de la palabra «desaparecido»"),
 "AE-I11": ("The village makes its own sound", "Le village fait son propre bruit", "El pueblo hace su propio sonido"),
 "AE-I12": ("The living hand", "La main vivante", "La mano viva"),
 "AE-I13": ("Help before the interview", "D’abord aider", "Primero ayudar"),
 "AE-I14": ("A notebook entrusted with conditions", "Un cahier confié, sous conditions", "Un cuaderno confiado con condiciones"),
 "AE-I15": ("The bell and the laugh", "La cloche et le rire", "La campana y la risa"),
 "AE-C01": ("Front cover", "Première de couverture", "Portada"),
 "AE-C04": ("Back cover", "Quatrième de couverture", "Contraportada"),
}
ALT = {
 "AE-I01": ("Katya records the quiet outside a closed school gate as classmates and their parents wait.",
            "Katya enregistre le silence devant la grille fermée de l’école, tandis que ses camarades et leurs parents attendent.",
            "Katya graba el silencio frente a la reja cerrada de la escuela, mientras sus compañeros y sus padres esperan."),
 "AE-I02": ("Solomiya hugs a bear book while Oksana lends books on the apartment landing and Katya watches.",
            "Solomiya serre contre elle un livre d’ours pendant qu’Oksana prête des livres sur le palier et que Katya les observe.",
            "Solomiya abraza un libro de osos mientras Oksana presta libros en el descanso de la escalera y Katya las observa."),
 "AE-I03": ("Oksana touches her newborn daughter’s cheek as Katya holds the baby and Vira stands beside them.",
            "Oksana effleure la joue de sa fille nouveau-née, pendant que Katya tient le bébé et que Vira se tient près d’elles.",
            "Oksana toca la mejilla de su hija recién nacida mientras Katya sostiene a la bebé y Vira está a su lado."),
 "AE-I04": ("Vira carries Anastasiya along the snowy evacuation road while Katya rests her arms and Ihor carries bags.",
            "Vira porte Anastasiya sur la route enneigée de l’évacuation, pendant que Katya repose ses bras et qu’Ihor porte les sacs.",
            "Vira carga a Anastasiya por el camino nevado de la evacuación mientras Katya descansa los brazos e Ihor lleva las bolsas."),
 "AE-I05": ("Anastasiya sleeps against Katya with a hand on her chin as companions share a small dessert.",
            "Anastasiya dort contre Katya, une main sur son menton, tandis que leurs compagnons se partagent un petit dessert.",
            "Anastasiya duerme contra Katya con una mano en su barbilla, mientras los compañeros se reparten un pequeño postre."),
 "AE-I06": ("Nurse Larysa lets Katya listen to Anastasiya’s chest with a stethoscope while Vira watches.",
            "L’infirmière Larysa laisse Katya écouter la poitrine d’Anastasiya avec un stéthoscope, sous le regard de Vira.",
            "La enfermera Larysa deja que Katya escuche el pecho de Anastasiya con un estetoscopio, mientras Vira mira."),
 "AE-I07": ("Katya listens to children describing sounds and asks which pages and voices she may keep.",
            "Katya écoute des enfants décrire des sons et leur demande quelles pages et quelles voix elle a le droit de garder.",
            "Katya escucha a unos niños describir sonidos y les pregunta qué páginas y qué voces puede guardar."),
 "AE-I08": ("Katya and Ihor sit beside each other under the barn’s missing roof with the repaired recorder between them.",
            "Katya et Ihor sont assis côte à côte sous le toit manquant de la grange, avec l’enregistreur réparé entre eux.",
            "Katya e Ihor están sentados uno al lado del otro bajo el techo que falta del granero, con la grabadora reparada entre los dos."),
 "AE-I09": ("Anastasiya laughs as the uneven wooden bird falls from Ihor’s head and Katya records the sound.",
            "Anastasiya rit pendant que l’oiseau de bois à l’aile inégale tombe de la tête d’Ihor et que Katya enregistre le son.",
            "Anastasiya se ríe mientras el pájaro de madera de alas desiguales se cae de la cabeza de Ihor y Katya graba el sonido."),
 "AE-I10": ("Daryna tells Katya details about her missing brother as Katya adds them to the red notebook.",
            "Daryna raconte à Katya des détails sur son frère disparu, et Katya les ajoute dans le cahier rouge.",
            "Daryna le cuenta a Katya detalles de su hermano desaparecido, y Katya los anota en el cuaderno rojo."),
 "AE-I11": ("Anastasiya strikes a pot with a wooden spoon as her companions watch in the school yard.",
            "Anastasiya frappe une casserole avec une cuillère en bois, tandis que ses compagnons la regardent dans la cour de l’école.",
            "Anastasiya golpea una olla con una cuchara de madera mientras sus compañeros miran en el patio de la escuela."),
 "AE-I12": ("Katya takes Pavlo’s hand in the damaged cellar while carrying Anastasiya and leaving the notebook behind.",
            "Dans la cave endommagée, Katya prend la main de Pavlo, Anastasiya contre elle, en laissant le cahier derrière elle.",
            "En el sótano dañado, Katya toma la mano de Pavlo con Anastasiya en brazos y deja el cuaderno atrás."),
 "AE-I13": ("Aïcha and a camera operator speak with Katya, who holds Anastasiya and the red notebook, while medics tend to Vira on a stretcher.",
            "Aïcha et un opérateur parlent à Katya, qui tient Anastasiya et le cahier rouge, pendant que des soignants s’occupent de Vira sur une civière.",
            "Aïcha y un camarógrafo hablan con Katya, que sostiene a Anastasiya y el cuaderno rojo, mientras unos paramédicos atienden a Vira en una camilla."),
 "AE-I14": ("Katya and Aïcha both hold the red notebook for a moment before Katya releases it for copying.",
            "Katya et Aïcha tiennent toutes deux le cahier rouge un instant, avant que Katya le lâche pour qu’il soit copié.",
            "Katya y Aïcha sostienen las dos el cuaderno rojo por un momento, antes de que Katya lo suelte para que lo copien."),
 "AE-I15": ("Katya enters the temporary school with her green notebook as Ihor rings a bicycle bell and Anastasiya laughs.",
            "Katya entre dans l’école provisoire avec son cahier vert, tandis qu’Ihor fait sonner une clochette de vélo et qu’Anastasiya rit.",
            "Katya entra a la escuela provisional con su cuaderno verde mientras Ihor hace sonar un timbre de bicicleta y Anastasiya se ríe."),
 "AE-C01": ("Katya holds her baby sister under an embroidered shawl and carries a red notebook.",
            "Katya tient sa petite sœur sous un châle brodé et porte un cahier rouge.",
            "Katya sostiene a su hermanita bajo un chal bordado y lleva un cuaderno rojo."),
 "AE-C04": ("The red notebook, a wooden bird, a recorder and a folded shawl rest on a worn surface below a clear text area.",
            "Le cahier rouge, un oiseau de bois, un enregistreur et un châle plié reposent sur une surface usée, sous une zone dégagée pour le texte.",
            "El cuaderno rojo, un pájaro de madera, una grabadora y un chal doblado descansan sobre una superficie gastada, debajo de una zona despejada para el texto."),
}
# anchors that are not the first sentence of the indexed paragraph
OVERRIDE_IDX = {"AE-I09": 30}                       # the index says: after "Anastasiya laughed a second time."
MANUAL = {"AE-I13": ("The man lowered the camera. She switched it off in front of me.",
                     "L’homme a abaissé la caméra. Elle l’a éteinte devant moi.",
                     "El hombre bajó la cámara. Ella la apagó delante de mí.")}


def section(lang, key):
    if key == "epilogue":
        return next(s for s in MS[lang].sections if s.kind == "epilogue")
    return next(s for s in MS[lang].sections if s.id == f"ch-{WORDS.index(key) + 1:02d}")


def sentences(html):
    t = strip_tags(html).replace("\u00a0", " ").strip()
    return [x for x in re.split(r"(?<=[.!?…»”])\s+", t) if x]


def anchor_for(lang, key, idx, manual=None):
    """Leading sentences of block idx: at least 40 characters and unique among the chapter's paragraphs."""
    if manual:
        return manual
    sec = section(lang, key)
    ss = sentences(sec.blocks[idx].html)
    for n in range(1, len(ss) + 1):
        a = " ".join(ss[:n])
        if len(a) < 40 and n < len(ss):
            continue
        hits = [i for i, b in enumerate(sec.blocks) if b.kind == "p" and typo.norm(a) in typo.norm(b.html)]
        if hits == [idx]:
            return a
    raise SystemExit(f"no unique anchor for {lang} {key} block {idx}")


MANUAL_LANG = {("AE-I07", "es"): "¿Quieres que la guarde, que te la devuelva o que la copie sin tu nombre?"}


rows = list(csv.DictReader((B / "docs" / "source" / "Anastasiya_Illustration_Index_ID.csv").open(encoding="utf-8-sig")))
slots = {}
for r in rows:
    aid = r["id"]
    if aid not in SCENE:
        continue
    kind = "cover" if aid.startswith("AE-C") else ("full" if aid in FULL else "half")
    slot = {"kind": kind, "ratio": r["ratio"], "stem": f"{aid}_v01", "chapter": None, "story_date": r["date"] or None,
            "scene": dict(zip(("en", "fr", "es"), SCENE[aid])), "alt": dict(zip(("en", "fr", "es"), ALT[aid])),
            "continuity": r["notes"], "image_check": r["notes"]}
    if kind == "cover":
        slot["side"] = "front" if aid == "AE-C01" else "back"
    else:
        m = re.match(r"Chapter (.+?) ", r["chapter"])
        key = "epilogue" if r["chapter"].startswith("Epilogue") else m.group(1)
        slot["chapter"] = "epilogue" if key == "epilogue" else f"ch-{WORDS.index(key) + 1:02d}"
        ex = typo.norm(r["excerpt"])
        idx = next(i for i, b in enumerate(section("en", key).blocks) if b.kind == "p" and ex in typo.norm(b.html))
        idx = OVERRIDE_IDX.get(aid, idx)
        if aid in MANUAL:
            slot["anchor"] = dict(zip(("en", "fr", "es"), MANUAL[aid]))
        else:
            slot["anchor"] = {l: anchor_for(l, key, idx, MANUAL_LANG.get((aid, l))) for l in ("en", "fr", "es")}
    slots[aid] = slot

reg = {"version": 1, "book": "anastasiya-echo",
       "note": "Slot kinds and ratios come from the supplied illustration index and art-direction guide (AE-I01..AE-I15, AE-C01, AE-C04). "
               "'stem' is the filename stem; the build looks for art/final/<stem>.* first, then art/source/<stem>.*. "
               "Alternates kept in art/source: AE-I10_v01_ALT.jpg and AE-I12_v01_ALT.jpg (square, 2000 px).",
       "slots": slots}
(B / "art" / "register.json").write_text(json.dumps(reg, ensure_ascii=False, indent=2), encoding="utf-8")
print(len(slots), "slots written")
for aid, s in slots.items():
    if s.get("anchor"):
        print(aid, s["chapter"]); [print("   ", l, s["anchor"][l]) for l in ("en", "fr", "es")]
