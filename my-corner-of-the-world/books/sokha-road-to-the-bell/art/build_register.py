#!/usr/bin/env python3
"""Generate art/register.json for Sokha's Diary from the supplied art direction (docs/source/*.docx, *.csv).

Chapters, slot kinds (full 2:3 plate / half 4:3 picture) and the English anchors come from the art-direction
document ("Placement" line of every scene). The three manuscripts do not have identical paragraph counts in every
chapter, so each picture lists the block that carries its anchor in EN / FR / ES (the same paragraph of the story);
the anchor text itself is read from that paragraph, so `python3 build.py check` fails if an edit breaks one.
Scene titles and the FR/ES alt texts are written for this project.

Run: python3 books/sokha-road-to-the-bell/art/build_register.py
"""
import csv, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))
from mcw.mdparse import parse_manuscript, strip_tags  # noqa: E402
from mcw import typo  # noqa: E402

B = ROOT / "books" / "sokha-road-to-the-bell"
OPTS = {"tail": False, "sound_lines": False}
LANGS = ("en", "fr", "es")
MS = {l: parse_manuscript((B / "manuscript" / f"{l}.md").read_text(encoding="utf-8"), l, OPTS) for l in LANGS}

FULL = {"SK-I05", "SK-I06", "SK-I07", "SK-I10", "SK-I12", "SK-I14"}

# chapter id, story date, block carrying the anchor paragraph in (EN, FR, ES), optional block the picture must not pass
PLACE = {
    "SK-I01": ("prologue", "2025-04-13", (11, 11, 11), None),
    "SK-I02": ("ch-02", "2025-04-15", (19, 19, 19), None),
    "SK-I03": ("ch-03", "2025-04-16", (27, 27, 27), None),
    "SK-I04": ("ch-06", "2025-04-21", (21, 21, 21), None),
    "SK-I05": ("ch-08", "2025-04-25", (27, 27, 27), None),
    "SK-I06": ("ch-09", "2025-04-26", (77, 77, 77), None),
    "SK-I07": ("ch-10", "2025-04-27", (26, 26, 26), (33, 33, 33)),   # the picture shows Maly and Sokha alone: it stays before Mae appears
    "SK-I08": ("ch-11", "2025-04-28", (51, 54, 54), None),
    "SK-I09": ("ch-12", "2025-04-30", (27, 27, 27), None),
    "SK-I10": ("ch-13", "2025-05-03", (63, 63, 63), (65, 65, 65)),     # before the outdoor trial ("They went out together.")
    "SK-I11": ("ch-14", "2025-05-05", (79, 79, 79), None),
    "SK-I12": ("ch-15", "2025-05-07", (20, 20, 20), (24, 24, 24)),     # before Sokha seals the bag
    "SK-I13": ("ch-16", "2025-05-09", (61, 61, 61), None),             # after Mae's permitted shoulder rub
    "SK-I14": ("ch-16", "2025-05-09", (133, 133, 133), None),
    "SK-I15": ("epilogue", "2025-05-11", (74, 75, 75), None),
}
# inline pictures that should print smaller than the text width (the epilogue vignette leaves its last words room to breathe)
SCALE = {"SK-I15": 0.8}
# plates that may stand at the page turn just before their anchor paragraph when that paragraph would start a page
# (the picture shows the moment the paragraph opens; it gives nothing away)
EARLY = {"SK-I10"}

SCENE = {
 "SK-I01": ("The ribbon and the stolen corner", "Le ruban et le coin volé", "La cinta y la esquina robada"),
 "SK-I02": ("The ball beyond the playing ground", "Le ballon hors du terrain", "El balón más allá de la cancha"),
 "SK-I03": ("A place inside", "Une place à l’intérieur", "Un lugar adentro"),
 "SK-I04": ("The room holds its breath", "La salle retient son souffle", "El salón contiene el aliento"),
 "SK-I05": ("The fork in the road", "Le croisement", "La bifurcación"),
 "SK-I06": ("The change made without asking", "Le changement fait sans demander", "El cambio hecho sin preguntar"),
 "SK-I07": ("The crooked blue cover", "La housse bleue de travers", "La funda azul torcida"),
 "SK-I08": ("Maly speaks at the meeting", "Maly prend la parole à la réunion", "Maly habla en la reunión"),
 "SK-I09": ("Making the Book of Steps", "Fabriquer le Carnet des pas", "Hacer el Libro de los pasos"),
 "SK-I10": ("The choice belongs to Maly", "Le choix appartient à Maly", "La decisión es de Maly"),
 "SK-I11": ("A room arranged with the children", "Une salle aménagée avec les enfants", "Un salón arreglado con los niños"),
 "SK-I12": ("The notebook handed over closed", "Le cahier remis fermé", "El cuaderno entregado cerrado"),
 "SK-I13": ("A break where one is needed", "Une pause là où il en faut une", "Un descanso donde hace falta"),
 "SK-I14": ("The bell finds everyone", "La cloche trouve tout le monde", "La campana encuentra a todos"),
 "SK-I15": ("A page in two voices", "Une page à deux voix", "Una página a dos voces"),
 "SK-C01": ("Front cover", "Première de couverture", "Portada"),
 "SK-C04": ("Back cover", "Quatrième de couverture", "Contraportada"),
}

ALT = {
 "SK-I01": ("Sokha reads his notebook cross-legged under the stilt house while his sister Maly ties the pink ribbon on her wooden crutch; a hen runs off with a scrap of paper in her beak.",
            "Sokha lit son carnet, assis en tailleur sous la maison sur pilotis, pendant que sa sœur Maly noue le ruban rose de sa béquille en bois ; une poule s’enfuit avec un bout de papier dans le bec.",
            "Sokha lee su cuaderno sentado con las piernas cruzadas bajo la casa sobre pilotes, mientras su hermana Maly ata la cinta rosa de su muleta de madera; una gallina se escapa con un trozo de papel en el pico."),
 "SK-I02": ("Three boys stand still on the dusty playing ground under a tree while a football lies in the tall grass at the edge of the field; one of them holds out an arm to stop the others.",
            "Trois garçons restent immobiles sur le terrain poussiéreux, sous un arbre, tandis qu’un ballon repose dans l’herbe haute au bord du terrain ; l’un d’eux tend le bras pour retenir les autres.",
            "Tres niños se quedan quietos en la cancha polvorienta, bajo un árbol, mientras un balón descansa en la hierba alta a la orilla; uno de ellos extiende el brazo para detener a los demás."),
 "SK-I03": ("In the borrowed classroom, Maly sits down inside the circle of children on the mat while Neak Kru Lina kneels by the blackboard; Maly’s wooden crutch, with its pink ribbon, leans against the wall.",
            "Dans la salle prêtée, Maly s’assoit à l’intérieur du cercle d’enfants sur la natte, pendant que Neak Kru Lina est agenouillée près du tableau ; la béquille en bois de Maly, avec son ruban rose, est appuyée contre le mur.",
            "En el salón prestado, Maly se sienta dentro del círculo de niños sobre la estera, mientras Neak Kru Lina está arrodillada junto al pizarrón; la muleta de madera de Maly, con su cinta rosa, está apoyada en la pared."),
 "SK-I04": ("Schoolchildren sit close together on a mat, listening, while Neak Kru Lina stands in the doorway with the little bicycle bell in her hand.",
            "Des élèves sont serrés les uns contre les autres sur une natte et écoutent, tandis que Neak Kru Lina se tient à la porte, la petite cloche de vélo à la main.",
            "Los alumnos están sentados muy juntos sobre una estera, atentos, mientras Neak Kru Lina está de pie en la puerta con la campanilla de bicicleta en la mano."),
 "SK-I05": ("Sokha, carrying two school bags, and Maly, leaning on her wooden crutch, stand at a fork in the dirt road; a red-and-white rope closes the right-hand path and the left one leads on around the fields.",
            "Sokha, chargé de deux sacs d’école, et Maly, appuyée sur sa béquille en bois, se tiennent à un croisement du chemin de terre ; une corde rouge et blanche ferme le chemin de droite, celui de gauche contourne les champs.",
            "Sokha, con dos mochilas escolares, y Maly, apoyada en su muleta de madera, están en una bifurcación del camino de tierra; una cuerda roja y blanca cierra la vereda de la derecha y la de la izquierda rodea los campos."),
 "SK-I06": ("At night, Sokha kneels beside Maly, who is asleep on a woven mat, after fitting a blue fabric cover on the top of her wooden crutch; moonlight comes through the window.",
            "La nuit, Sokha est agenouillé près de Maly, endormie sur une natte tressée, après avoir enfilé une housse de tissu bleu sur le haut de sa béquille en bois ; la lune éclaire la fenêtre.",
            "De noche, Sokha está arrodillado junto a Maly, que duerme sobre una estera tejida, después de ponerle una funda de tela azul a la parte de arriba de su muleta de madera; la luna entra por la ventana."),
 "SK-I07": ("In the yard, Maly leans against a wooden post on her own while her crutch lies on the ground with the blue cover crooked and the pink ribbon still tied; Sokha stands a few steps away.",
            "Dans la cour, Maly s’appuie seule contre un poteau en bois, sa béquille posée par terre avec la housse bleue de travers et le ruban rose toujours noué ; Sokha se tient à quelques pas.",
            "En el patio, Maly se apoya sola contra un poste de madera mientras su muleta yace en el suelo con la funda azul torcida y la cinta rosa todavía atada; Sokha está de pie a unos pasos."),
 "SK-I08": ("At the village meeting under the big tree, Maly reads from her open notebook to the circle of neighbors, with Mae, Sokha and Vannak beside her and her wooden crutch resting against a tree root.",
            "À la réunion du village sous le grand arbre, Maly lit dans son cahier ouvert devant le cercle de voisins, avec Mae, Sokha et Vannak à ses côtés et sa béquille en bois posée contre une racine.",
            "En la reunión del pueblo bajo el árbol grande, Maly lee de su cuaderno abierto ante el círculo de vecinos, con Mae, Sokha y Vannak a su lado y su muleta de madera apoyada en una raíz."),
 "SK-I09": ("Neighbors and children sit on a woven mat under a stilt house, bent over a hand-drawn map of the road; Maly writes in her notebook beside her wooden crutch while the others point out the stops.",
            "Sous une maison sur pilotis, voisins et enfants sont assis sur une natte autour d’un plan du chemin dessiné à la main ; Maly écrit dans son carnet près de sa béquille en bois pendant que les autres montrent les haltes.",
            "Bajo una casa sobre pilotes, vecinos y niños se sientan en una estera alrededor de un mapa del camino dibujado a mano; Maly escribe en su cuaderno junto a su muleta de madera mientras los demás señalan las paradas."),
 "SK-I10": ("In the health center, Ms. Sreyneang asks Maly what she thinks of the new adjustable metal crutch; Maly stands with it while Mae and Sokha listen, and the pink ribbon waits on the table.",
            "Au centre de santé, Madame Sreyneang demande à Maly ce qu’elle pense de la nouvelle béquille en métal réglable ; Maly se tient debout avec elle, Mae et Sokha écoutent, et le ruban rose attend sur la table.",
            "En el centro de salud, la señora Sreyneang le pregunta a Maly qué piensa de la nueva muleta de metal ajustable; Maly está de pie con ella, Mae y Sokha escuchan, y la cinta rosa espera sobre la mesa."),
 "SK-I11": ("In Uncle Sarath’s house, Sokha and Vannak unroll mats for the new classroom with Neak Kru Lina while Maly, on her metal crutch, stands by the doorpost where the little bell is clamped and Sarath looks on.",
            "Dans la maison de l’oncle Sarath, Sokha et Vannak déroulent des nattes pour la nouvelle classe avec Neak Kru Lina, tandis que Maly, sur sa béquille en métal, se tient près du poteau de la porte où la petite cloche est fixée et que Sarath les regarde.",
            "En la casa del tío Sarath, Sokha y Vannak extienden las esteras del salón nuevo con Neak Kru Lina, mientras Maly, con su muleta de metal, está junto al poste de la puerta donde está sujeta la campanilla y Sarath los mira."),
 "SK-I12": ("During the rainstorm in the old classroom, Maly hands her closed notebook to Sokha, who holds a plastic bag to keep both notebooks dry; basins catch the water dripping through the roof.",
            "Pendant l’orage dans l’ancienne salle, Maly tend son cahier fermé à Sokha, qui tient un sac en plastique pour garder les deux cahiers au sec ; des bassines recueillent l’eau qui passe à travers le toit.",
            "Durante la tormenta en el salón viejo, Maly le entrega su cuaderno cerrado a Sokha, que sostiene una bolsa de plástico para mantener secos los dos cuadernos; unas palanganas recogen el agua que gotea del techo."),
 "SK-I13": ("On the muddy road to the new classroom, Maly sits on an upturned bucket for a break while Mae rubs her shoulder and the other children wait; a little boy draws squares in the mud with a stick.",
            "Sur la route boueuse vers la nouvelle salle, Maly s’assoit sur un seau retourné pour faire une pause, tandis que Mae lui masse l’épaule et que les autres enfants attendent ; un petit dessine des carrés dans la boue avec un bâton.",
            "En el camino lodoso hacia el salón nuevo, Maly se sienta en un balde boca abajo para descansar mientras Mae le soba el hombro y los demás niños esperan; un chiquito dibuja cuadros en el lodo con un palo."),
 "SK-I14": ("In the new classroom, Maly rings the little bell on the doorpost with her free hand, her metal crutch under her arm and her pink ribbon tied, while the children and families behind her smile.",
            "Dans la nouvelle salle, Maly fait sonner de sa main libre la petite cloche fixée au poteau de la porte, sa béquille en métal sous le bras et son ruban rose noué, tandis que les enfants et les familles derrière elle sourient.",
            "En el salón nuevo, Maly hace sonar con la mano libre la campanilla del poste de la puerta, con su muleta de metal bajo el brazo y su cinta rosa atada, mientras los niños y las familias sonríen detrás de ella."),
 "SK-I15": ("While it rains, Sokha and Maly sit side by side on the steps under the stilt house; Maly writes in the notebook with the blue pen, Mae sorts beans behind them and Maly’s crutch rests beside her.",
            "Pendant que la pluie tombe, Sokha et Maly sont assis côte à côte sur les marches de la maison sur pilotis ; Maly écrit dans le carnet avec le stylo bleu, Mae trie des haricots derrière eux et la béquille de Maly est posée à côté d’elle.",
            "Mientras llueve, Sokha y Maly están sentados lado a lado en los escalones de la casa sobre pilotes; Maly escribe en el cuaderno con el bolígrafo azul, Mae selecciona frijoles detrás de ellos y la muleta de Maly descansa a su lado."),
 "SK-C01": ("Sokha, with his school bag, and Maly, with her metal crutch and pink ribbon, walk side by side on a village road and exchange a smile.",
            "Sokha, son cartable à l’épaule, et Maly, avec sa béquille en métal et son ruban rose, marchent côte à côte sur un chemin du village en échangeant un sourire.",
            "Sokha, con su mochila, y Maly, con su muleta de metal y su cinta rosa, caminan lado a lado por un camino del pueblo y se sonríen."),
 "SK-C04": ("Two closed notebooks, a blue pen and a small red feather rest on a wooden step beside a clay jar, with rain-washed greenery beyond and quiet paper above.",
            "Deux cahiers fermés, un stylo bleu et une petite plume rouge reposent sur une marche en bois près d’une jarre en terre, avec une verdure détrempée par la pluie au fond et une zone de papier dégagée au-dessus.",
            "Dos cuadernos cerrados, un bolígrafo azul y una pequeña pluma roja descansan sobre un escalón de madera junto a una tinaja de barro, con vegetación bañada por la lluvia al fondo y papel despejado arriba."),
}

# what the art-direction guide asks to be true in each picture (its "Continuity" line, shortened) and what was checked here
CONTINUITY = {
 "SK-I01": "Wooden crutch stored on Maly’s right, pink ribbon tied, Maly ties it herself; no blue pen yet, no metal crutch.",
 "SK-I02": "Maly outside the frame, no crutch; every child stays on the known playing ground; no visible ordnance, no invented barrier.",
 "SK-I03": "Wooden crutch stored on the right, pink ribbon tied; the borrowed old room, no bell on the doorpost yet.",
 "SK-I04": "Maly absent, no crutch; small portable bicycle bell, never a temple bell; no visible explosion.",
 "SK-I05": "Wooden crutch in use on the right, pink ribbon tied; left branch approved, right branch closed, nobody crosses; Sokha carries the bags.",
 "SK-I06": "Night; wooden crutch on the right of sleeping Maly, pink ribbon plus the blue cover (first appearance, not a clinical adaptation).",
 "SK-I07": "Wooden crutch on the ground on the right, pink ribbon still tied, blue cover crooked; Maly already stable at the post; Mae not in frame.",
 "SK-I08": "Wooden crutch stored on the right, no ribbon visible, no blue cover; Maly inside the circle; no podium, applause or rescue pose.",
 "SK-I09": "Wooden crutch stored on the right, ribbon not yet retied, no blue cover; map labels would be added by the designer.",
 "SK-I10": "Metal crutch in use on the right, ribbon detached on the table; exactly one visible crutch; no prosthesis, no promised cure.",
 "SK-I11": "Metal crutch in use on the right, pink ribbon retied; bell clamped, not rung; teal shirt, no blue hair strip yet.",
 "SK-I12": "Metal crutch in use on the right, pink ribbon tied; Maly passes the book with her LEFT hand; old room, no bicycle bell there.",
 "SK-I13": "Metal crutch stored on the right while Maly sits; pink ribbon tied; yellow shirt and blue hair strip begin here; Sarath absent; no carrying.",
 "SK-I14": "Metal crutch in use on the right, LEFT hand rings the bell, pink ribbon tied; crutch viewer-left, bell viewer-right; one intact leg, one crutch.",
 "SK-I15": "Metal crutch stored on the right, pink ribbon attached; Maly writes by choice; no miraculous recovery.",
}


def section(lang, sid):
    return next(s for s in MS[lang].sections if s.id == sid)


def sentences(html):
    t = strip_tags(html).replace(" ", " ").strip()
    return [x for x in re.split(r"(?<=[.!?…»”])\s+", t) if x]


LEAD = re.compile(r"^[—–\-\s«“\"]+")


def anchor_for(lang, sid, idx):
    """Leading sentence(s) of block idx: at least 40 characters (or the whole paragraph) and unique among the chapter's paragraphs."""
    sec = section(lang, sid)
    blk = sec.blocks[idx]
    if blk.kind != "p":
        raise SystemExit(f"{lang} {sid} block {idx} is a {blk.kind}, not a paragraph")
    ss = sentences(blk.html)
    for n in range(1, len(ss) + 1):
        a = LEAD.sub("", " ".join(ss[:n]))
        if len(a) < 40 and n < len(ss):
            continue
        hits = [i for i, b in enumerate(sec.blocks) if b.kind == "p" and typo.norm(a) in typo.norm(b.html)]
        if hits == [idx]:
            return a
    raise SystemExit(f"no unique anchor for {lang} {sid} block {idx}: {strip_tags(blk.html)[:80]}")


rows = {r["id"]: r for r in csv.DictReader((B / "docs" / "source" / "Sokha_Illustration_Index.csv").open(encoding="utf-8-sig"))}
slots = {}
for aid in SCENE:
    r = rows[aid]
    ratio = r["aspect_ratio"]
    if aid.startswith("SK-C"):
        slot = {"kind": "cover", "ratio": ratio, "stem": f"{aid}_v01", "side": "front" if aid == "SK-C01" else "back",
                "chapter": None, "story_date": None}
    else:
        sid, date, idxs, stop = PLACE[aid]
        kind = "full" if aid in FULL else "half"
        want = "2:3" if kind == "full" else "4:3"
        if ratio != want:
            raise SystemExit(f"{aid}: index says {ratio}, the art direction asks for {want}")
        slot = {"kind": kind, "ratio": ratio, "stem": f"{aid}_v01", "chapter": sid, "story_date": date}
    slot["scene"] = dict(zip(LANGS, SCENE[aid]))
    slot["alt"] = dict(zip(LANGS, ALT[aid]))
    if aid in CONTINUITY:
        slot["continuity"] = CONTINUITY[aid]
    if not aid.startswith("SK-C"):
        slot["anchor"] = {l: anchor_for(l, sid, i) for l, i in zip(LANGS, idxs)}
        if stop:
            slot["stop"] = {l: anchor_for(l, sid, i) for l, i in zip(LANGS, stop)}
        if aid in SCALE:
            slot["scale"] = SCALE[aid]
        if aid in EARLY:
            slot["early"] = True
    slots[aid] = slot

reg = {"version": 1, "book": "sokha-road-to-the-bell",
       "note": "Slot kinds, chapters and anchors follow Sokha_Art_Direction_and_Scene_Plan_EN.docx and Sokha_Illustration_Index.csv "
               "(SK-I01..SK-I15, SK-C01, SK-C04). 'stem' is the filename stem; the build looks for art/final/<stem>.* first, then "
               "art/source/<stem>.*. 'stop' (optional) is the paragraph a full-page plate should not move past unless its page "
               "would otherwise stay mostly empty; 'early' (optional) lets a plate stand at the page turn just before its anchor "
               "paragraph when that paragraph starts a page; 'scale' (optional) shrinks an inline picture. The four character sheets, the earlier cover option and the file catalogue were not "
               "supplied as files and are not part of the book.",
       "slots": slots}
(B / "art" / "register.json").write_text(json.dumps(reg, ensure_ascii=False, indent=2), encoding="utf-8")
print(len(slots), "slots written")
for aid, s in slots.items():
    if s.get("anchor"):
        print(aid, s["chapter"])
        for l in LANGS:
            print("   ", l, s["anchor"][l], ("  | stop: " + s["stop"][l]) if s.get("stop") else "")
