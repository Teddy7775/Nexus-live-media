#!/usr/bin/env python3
"""Generate art/register.json for The Drum and the Ball from the supplied dossier (docs/source/Illustration_Register.csv,
Art_Direction_EN.txt, production_manifest.json).

The register gives, for every picture, the chapter and the exact English sentence it follows. The three manuscripts are
aligned paragraph for paragraph (after normalize.py), so each picture lists the block that carries its anchor (the same
index in EN / FR / ES); the anchor text itself is read from that paragraph, so `python3 build.py check` fails if an edit
breaks one. Scene titles and the FR/ES alt texts are written for this project.

Slot kinds: "half" = inline picture at text width (every landscape picture: 3:2, or 16:9 for DB-I07 and DB-I15);
"inset" = a page of its own that keeps the picture whole, no bleed, no crop (the portrait DB-I10, as the art
direction asks: "Use portrait DB-I10 as a full-page inset"); "cover" = front / back cover panel.

Run: python3 books/lamine-drum-and-ball/art/build_register.py
"""
import csv, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))
from mcw.mdparse import parse_manuscript, strip_tags  # noqa: E402
from mcw import typo  # noqa: E402

B = ROOT / "books" / "lamine-drum-and-ball"
OPTS = json.loads((B / "book.json").read_text(encoding="utf-8"))["parser"]
LANGS = ("en", "fr", "es")
MS = {l: parse_manuscript((B / "manuscript" / f"{l}.md").read_text(encoding="utf-8"), l, OPTS) for l in LANGS}

INSET = {"DB-I10"}
# how full the text page before a page-art picture must be (default 0.70, measured by the layout pass at the top of the last line);
# DB-I10 follows the end of the conversation, where the page is 53-60 % full by that measure (Spanish is the shortest, 0.53)
MIN_FILL = {"DB-I10": {"en": 0.58, "fr": 0.58, "es": 0.50}}

# chapter id, story date, block carrying the anchor paragraph (the same index in EN, FR and ES), optional paragraph a page-art picture must not pass
PLACE = {
    "DB-I01": ("ch-01", "2024-02-05", 13, None),
    "DB-I02": ("ch-02", "2024-02-07", 21, None),
    "DB-I03": ("ch-03", "2024-02-10", 35, None),
    "DB-I04": ("ch-04", "2024-02-13", 92, None),
    "DB-I05": ("ch-07", "2024-02-20", 78, None),
    "DB-I06": ("ch-08", "2024-02-22", 105, None),
    "DB-I07": ("ch-10", "2024-02-25", 49, None),
    "DB-I08": ("ch-11", "2024-02-27", 51, None),
    "DB-I09": ("ch-12", "2024-03-02", 32, None),
    "DB-I10": ("ch-13", "2024-03-08", 83, 87),     # the pre-match conversation: the page stands before Lamine goes in to write
    "DB-I11": ("ch-15", "2024-03-09", 23, None),
    "DB-I12": ("ch-16", "2024-03-09", 57, None),
    "DB-I13": ("ch-17", "2024-03-10", 27, None),
    "DB-I14": ("ch-17", "2024-03-10", 108, None),
    "DB-I15": ("epilogue", "2024-03-17", 29, None),
}
RATIO = {"DB-I07": "16:9", "DB-I15": "16:9", "DB-I10": "3:4", "DB-C01": "2:3", "DB-C04": "2:3"}

SCENE = {
 "DB-I01": ("The third seam", "La troisième couture", "La tercera costura"),
 "DB-I02": ("The second trip", "Le deuxième voyage", "El segundo viaje"),
 "DB-I03": ("The rhythm that returns", "Le rythme qui revient", "El ritmo que regresa"),
 "DB-I04": ("Two dark red laces", "Deux lacets rouge sombre", "Dos cordones rojo oscuro"),
 "DB-I05": ("A challenge needs rules", "Un défi a besoin de règles", "Un desafío necesita reglas"),
 "DB-I06": ("Her work has a cost", "Son travail a un prix", "Su trabajo tiene un costo"),
 "DB-I07": ("Learning to wait", "Apprendre à attendre", "Aprender a esperar"),
 "DB-I08": ("The journal is his", "Le journal lui appartient", "El diario es suyo"),
 "DB-I09": ("A field for everyone", "Un terrain pour tout le monde", "Una cancha para todos"),
 "DB-I10": ("What can I hold on to?", "Qu’est-ce que je peux tenir ?", "¿A qué me puedo agarrar?"),
 "DB-I11": ("The red pass", "La passe rouge", "El pase rojo"),
 "DB-I12": ("Idrissa at the far post", "Idrissa au second poteau", "Idrissa en el segundo poste"),
 "DB-I13": ("Keeping his word", "Tenir sa parole", "Cumplir su palabra"),
 "DB-I14": ("The page he chooses", "La page qu’il choisit", "La página que elige"),
 "DB-I15": ("Poc, doum, poc", "Poc, doum, poc", "Poc, dum, poc"),
 "DB-C01": ("Front cover", "Première de couverture", "Portada"),
 "DB-C04": ("Back cover", "Quatrième de couverture", "Contraportada"),
}

ALT = {
 "DB-I01": ("Moussa sits cross-legged in the dust and peels a strip of black tape off the patched ball to show the gray cloth underneath, while Lamine bends over him with his hands on his knees and little Awa walks up behind them carrying two plastic jugs.",
            "Moussa, assis en tailleur dans la poussière, décolle une bande de ruban noir du ballon rafistolé et laisse voir le tissu gris dessous, pendant que Lamine, penché, les mains sur les genoux, l’observe et que la petite Awa approche derrière eux avec deux bidons.",
            "Moussa, sentado con las piernas cruzadas en el polvo, despega una tira de cinta negra del balón remendado y deja ver la tela gris de abajo, mientras Lamine, inclinado con las manos en las rodillas, lo mira y la pequeña Awa se acerca detrás con dos bidones."),
 "DB-I02": ("Lamine carries a yellow basin full of water in both hands along a sunny dirt lane, beside his little sister Awa, who holds a small metal jug and looks straight ahead; neither of them speaks.",
            "Lamine porte à deux mains une bassine jaune pleine d’eau sur un chemin de terre ensoleillé, à côté de sa petite sœur Awa, qui tient un petit pichet en métal et regarde droit devant elle ; ni l’un ni l’autre ne parle.",
            "Lamine lleva con las dos manos una palangana amarilla llena de agua por un camino de tierra soleado, junto a su hermanita Awa, que sostiene una jarrita de metal y mira al frente; ninguno de los dos habla."),
 "DB-I03": ("At the Faty family ceremony, Baba, in a sand-colored boubou, holds his drum between his knees and looks at his son; Lamine, in a blue boubou too big for him, sits beside him with the family-name book open on his lap and his fingers on the page, while Yaye Khady watches from the next chair.",
            "À la cérémonie chez les Faty, Baba, en boubou sable, tient son tambour entre ses genoux et regarde son fils ; Lamine, dans un boubou bleu trop grand pour lui, est assis à côté de lui, le livre des noms de famille ouvert sur les genoux et les doigts posés sur la page, tandis que Yaye Khady les observe depuis la chaise voisine.",
            "En la ceremonia de la familia Faty, Baba, con un bubú color arena, sostiene su tambor entre las rodillas y mira a su hijo; Lamine, con un bubú azul que le queda grande, está sentado a su lado con el libro de los nombres de la familia abierto sobre las piernas y los dedos sobre la página, mientras Yaye Khady los observa desde la silla de al lado."),
 "DB-I04": ("At dusk Moussa squats in front of Lamine and holds out two dark red shoelaces in his open hand; Lamine sits on a low wall with his arms on his knees, looking at the ground, in worn shoes with ordinary laces.",
            "Au crépuscule, Moussa s’accroupit devant Lamine et lui tend, dans sa paume ouverte, deux lacets rouge sombre ; Lamine, assis sur un muret, les bras sur les genoux, regarde le sol, dans des chaussures usées aux lacets ordinaires.",
            "Al anochecer, Moussa se pone en cuclillas frente a Lamine y le extiende en la palma abierta dos cordones rojo oscuro; Lamine, sentado en un muro bajo con los brazos sobre las rodillas, mira al suelo, con zapatos gastados y cordones comunes."),
 "DB-I05": ("On the dusty school field Fatou reads out the rules she has written in her notebook while Lamine, Moussa and the other boys listen; Cheikh, in a blue tracksuit and white cleats, rests a foot on his white-and-blue ball, and Lamine’s patched ball waits on the ground.",
            "Sur le terrain poussiéreux de l’école, Fatou lit à voix haute les règles qu’elle a notées dans son cahier pendant que Lamine, Moussa et les autres garçons écoutent ; Cheikh, en survêtement bleu et crampons blancs, pose un pied sur son ballon blanc et bleu, et le ballon rafistolé de Lamine attend par terre.",
            "En la cancha polvorienta de la escuela, Fatou lee en voz alta las reglas que anotó en su cuaderno mientras Lamine, Moussa y los demás niños escuchan; Cheikh, con pants azul y tacos blancos, apoya un pie sobre su balón blanco y azul, y el balón remendado de Lamine espera en el suelo."),
 "DB-I06": ("At the market Mom, in her green-and-yellow headwrap, counts coins into a customer’s hand beside her open account book and phone, while Lamine bags peanuts next to her and little Awa watches with a blue cup in her hands; baskets of tomatoes and red onions fill the front of the stall.",
            "Au marché, Maman, la tête enveloppée d’un foulard vert et jaune, compte des pièces dans la main d’une cliente, près de son cahier de comptes ouvert et de son téléphone ; Lamine met des arachides en sachets à côté d’elle et la petite Awa regarde, une tasse bleue entre les mains ; des paniers de tomates et d’oignons rouges remplissent le devant de l’étal.",
            "En el mercado, Mamá, con su pañuelo verde y amarillo en la cabeza, cuenta monedas en la mano de una clienta junto a su libreta de cuentas abierta y su teléfono; Lamine embolsa maní a su lado y la pequeña Awa mira con una taza azul entre las manos; canastas de tomates y cebollas moradas llenan el frente del puesto."),
 "DB-I07": ("On a riverbank in morning light Lamine and Baba sit side by side on the roots of a big tree and watch a kingfisher on a branch with a small silver fish in its beak; a water bottle and a bag lean against the roots and a pirogue drifts far off.",
            "Au bord du fleuve, dans la lumière du matin, Lamine et Baba sont assis côte à côte sur les racines d’un grand arbre et regardent un martin-pêcheur perché sur une branche, un petit poisson argenté dans le bec ; une gourde et un sac sont posés contre les racines et une pirogue glisse au loin.",
            "A la orilla del río, con la luz de la mañana, Lamine y Baba están sentados lado a lado sobre las raíces de un árbol grande y miran a un martín pescador posado en una rama con un pececito plateado en el pico; una botella de agua y una bolsa descansan contra las raíces y una piragua se desliza a lo lejos."),
 "DB-I08": ("In the courtyard Baba, seated, speaks to Lamine with his open hands turned up; Lamine stands holding his closed black journal tight against his chest, while Mom, behind a table with a bowl of mangoes, watches and Lamine’s school bag rests on the ground.",
            "Dans la cour, Baba, assis, parle à Lamine les mains ouvertes, paumes vers le haut ; Lamine, debout, serre contre sa poitrine son journal noir fermé, tandis que Maman, derrière une table où se trouve un bol de mangues, les observe et que le sac d’école de Lamine repose par terre.",
            "En el patio, Baba, sentado, le habla a Lamine con las manos abiertas y las palmas hacia arriba; Lamine, de pie, aprieta contra el pecho su diario negro cerrado, mientras Mamá, detrás de una mesa con un plato de mangos, los observa y la mochila de Lamine descansa en el suelo."),
 "DB-I09": ("On the school field the villagers fill the cleaned hole with sand: a boy in a red shirt shovels while Lamine looks at the spot, Baba, Malang and Cheikh talk, Fatou writes in her notebook with little Awa beside her, and Monsieur Diatta, wearing gloves, drops sharp scraps into a blue bucket; a steady wheelbarrow and two sacks of sand wait nearby.",
            "Sur le terrain de l’école, les villageois comblent avec du sable le trou nettoyé : un garçon en tee-shirt rouge manie la pelle pendant que Lamine regarde l’endroit, que Baba, Malang et Cheikh discutent, que Fatou note dans son cahier avec la petite Awa à côté d’elle et que Monsieur Diatta, ganté, jette des débris coupants dans un seau bleu ; une brouette stable et deux sacs de sable attendent tout près.",
            "En la cancha de la escuela, los vecinos rellenan con arena el hoyo ya limpio: un niño de camiseta roja palea mientras Lamine mira el lugar, Baba, Malang y Cheikh conversan, Fatou anota en su cuaderno con la pequeña Awa a su lado, y Monsieur Diatta, con guantes, echa los restos cortantes en un balde azul; una carretilla firme y dos costales de arena esperan cerca."),
 "DB-I10": ("At dusk Baba and Lamine sit cross-legged on a woven mat in front of the house with a small drum between them; Baba speaks with open hands while Lamine, in his cream shirt, looks down at his own hands.",
            "Au crépuscule, Baba et Lamine sont assis en tailleur sur une natte tressée devant la maison, un petit tambour entre eux ; Baba parle les mains ouvertes, tandis que Lamine, en chemise crème, regarde ses propres mains.",
            "Al anochecer, Baba y Lamine están sentados con las piernas cruzadas en una estera tejida frente a la casa, con un tambor pequeño entre los dos; Baba habla con las manos abiertas mientras Lamine, con su camisa crema, mira sus propias manos."),
 "DB-I11": ("In the middle of the match on the dusty field Lamine, in an ivory jersey and shoes with dark red laces, pushes the ball between two defenders in blue toward Moussa in the yellow shirt, who is already running; a crowd watches behind a rope.",
            "En plein match sur le terrain poussiéreux, Lamine, en maillot ivoire et chaussures aux lacets rouge sombre, glisse le ballon entre deux défenseurs en bleu vers Moussa, en tee-shirt jaune, déjà lancé dans sa course ; la foule regarde derrière une corde.",
            "En pleno partido en la cancha polvorienta, Lamine, con camiseta marfil y zapatos de cordones rojo oscuro, manda el balón entre dos defensas de azul hacia Moussa, de camiseta amarilla, que ya va corriendo; la gente mira detrás de una cuerda."),
 "DB-I12": ("At the far post the ball rolls into the net as the goalkeeper in dark gray slides to the ground too late; Idrissa, in an olive-green shirt, watches it go in, while Lamine in his ivory jersey and a blue-shirted opponent look on and the crowd stands behind the rope.",
            "Au second poteau, le ballon roule dans le filet pendant que le gardien en gris foncé glisse au sol, trop tard ; Idrissa, en haut vert olive, regarde le ballon entrer, tandis que Lamine, en maillot ivoire, et un adversaire en bleu regardent aussi et que la foule se tient derrière la corde.",
            "En el segundo poste, el balón rueda hacia la red mientras el portero de gris oscuro se desliza por el suelo, demasiado tarde; Idrissa, con una camiseta verde olivo, ve cómo entra, y Lamine, con su camiseta marfil, y un rival de azul también miran, con la gente detrás de la cuerda."),
 "DB-I13": ("In the Faty family courtyard on the morning after the match, Cheikh, in his blue tracksuit, holds out his white-and-blue ball to Lamine, who opens both hands to take it; Awa, Malang in cap and sunglasses, and Moussa look on, and Cheikh’s sports bag stands open at his feet.",
            "Dans la cour des Faty, le lendemain du match, Cheikh, en survêtement bleu, tend son ballon blanc et bleu à Lamine, qui ouvre les deux mains pour le prendre ; Awa, Malang en casquette et lunettes de soleil, et Moussa regardent, et le sac de sport de Cheikh est ouvert à ses pieds.",
            "En el patio de los Faty, la mañana después del partido, Cheikh, con su pants azul, le tiende su balón blanco y azul a Lamine, que abre las dos manos para recibirlo; Awa, Malang con gorra y lentes de sol, y Moussa los miran, y la mochila deportiva de Cheikh está abierta a sus pies."),
 "DB-I14": ("In the evening by lantern light Lamine sits cross-legged on a woven mat and reads a page aloud from his open black journal, while Baba listens beside him with his hands resting on his knees, without touching the book; a folded cloth lies at his side.",
            "Le soir, à la lueur d’une lanterne, Lamine, assis en tailleur sur une natte tressée, lit à voix haute une page de son journal noir ouvert, tandis que Baba l’écoute à côté de lui, les mains posées sur les genoux, sans toucher au livre ; une étoffe pliée repose à son côté.",
            "Por la noche, a la luz de un farol, Lamine, sentado con las piernas cruzadas en una estera tejida, lee en voz alta una página de su diario negro abierto, mientras Baba lo escucha a su lado, con las manos sobre las rodillas, sin tocar el libro; una tela doblada descansa junto a él."),
 "DB-I15": ("At dusk in the family courtyard Lamine keeps the old patched ball in the air with his knee while Baba beats the drum and Mom, Awa and Yaye Khady watch and smile on a mat beneath a mango tree.",
            "Au crépuscule, dans la cour de la famille, Lamine garde en l’air le vieux ballon rafistolé avec son genou pendant que Baba joue du tambour et que Maman, Awa et Yaye Khady regardent en souriant, assises sur une natte sous un manguier.",
            "Al atardecer, en el patio de la familia, Lamine mantiene en el aire el viejo balón remendado con la rodilla mientras Baba toca el tambor y Mamá, Awa y Yaye Khady miran sonriendo, sentadas en una estera bajo un mango."),
 "DB-C01": ("At sunset on the village field Lamine stands with one foot on the old patched ball, and his father Baba, in an indigo boubou with prayer beads, stands behind him with his drum; a huge tree, village roofs and the river glow under an orange and purple sky.",
            "Au coucher du soleil sur le terrain du village, Lamine pose un pied sur le vieux ballon rafistolé, et son père Baba, en boubou indigo et chapelet autour du cou, se tient derrière lui avec son tambour ; un arbre immense, des toits de village et le fleuve se détachent sous un ciel orange et violet.",
            "Al atardecer, en la cancha del pueblo, Lamine apoya un pie sobre el viejo balón remendado y su papá, Baba, con un bubú índigo y un rosario de cuentas al cuello, está de pie detrás de él con su tambor; un árbol enorme, los techos del pueblo y el río resplandecen bajo un cielo naranja y violeta."),
 "DB-C04": ("A still life at sunset against a plastered clay wall: the old patched ball, a closed black journal and two dark red shoelaces rest on the red earth at the foot of the wall, with a tree and village roofs under an orange sky; the wall leaves a quiet space for text.",
            "Une nature morte au coucher du soleil contre un mur d’argile crépi : le vieux ballon rafistolé, un journal noir fermé et deux lacets rouge sombre reposent sur la terre rouge au pied du mur, avec un arbre et des toits de village sous un ciel orange ; le mur laisse une grande zone calme pour le texte.",
            "Una naturaleza muerta al atardecer junto a un muro de barro enjarrado: el viejo balón remendado, un diario negro cerrado y dos cordones rojo oscuro descansan sobre la tierra roja al pie del muro, con un árbol y los techos del pueblo bajo un cielo naranja; el muro deja una zona tranquila para el texto."),
}

# what the art direction asks to be true in each picture (shortened), as checked on the supplied files
CONTINUITY = {
 "DB-I01": "Black plastic peels to gray cloth; the red laces have not been given yet (plain laces on Lamine’s shoes); Awa carries jugs.",
 "DB-I02": "Lamine carries the yellow basin, Awa the small jug; neither speaks; everyday cream shirt and blue shorts.",
 "DB-I03": "Sand-colored boubou for Baba, oversized boubou for Lamine, family-name book open (distinct from the black private journal); Yaye Khady present.",
 "DB-I04": "Two loose dark red laces held out, not yet threaded; the reconciliation is partial (Lamine looks away).",
 "DB-I05": "Fatou (teal blouse, braids, notebook) reads the rules; Cheikh’s white-and-blue ball distinct from the patched ball; no match team yet.",
 "DB-I06": "Mom’s account book, phone and coins; Lamine helps, Awa holds a cup; everyday market light.",
 "DB-I07": "Morning daylight, never sunset; the kingfisher has a fish in its beak; Baba does not skip stones.",
 "DB-I08": "Closed black journal held by Lamine; Baba’s open hands; no physical threat.",
 "DB-I09": "Adults handle the dangerous debris (Diatta, gloved, bucket); children keep clear; stable wheelbarrow; the cleaned hole is filled by shovel.",
 "DB-I10": "The pre-match conversation, open hands, small drum on the mat; no magical rhythm lesson.",
 "DB-I11": "Lamine passes to Moussa (yellow), who will equalise; Lamine does not score; dark red laces; off-white match ball with dark panels.",
 "DB-I12": "Idrissa (olive green) scores 2-1 after Lamine’s square pass; a borrowed goal with a net, no stone towers; no drum, no Baba.",
 "DB-I13": "The handover is the next morning in the courtyard, not on the field; Cheikh’s white-and-blue ball; dark red laces in Lamine’s shoes.",
 "DB-I14": "Lamine chooses and reads his page; Baba listens without touching the journal; lantern light.",
 "DB-I15": "The OLD ball (black plastic and tape); Baba plays the drum at home only, never at the match.",
}


def section(lang, sid):
    return next(s for s in MS[lang].sections if s.id == sid)


def sentences(html):
    t = strip_tags(html).replace(" ", " ").strip()
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


rows = {r["ID"]: r for r in csv.DictReader((B / "docs" / "source" / "Illustration_Register.csv").open(encoding="utf-8-sig"))}
slots = {}
for aid in SCENE:
    r = rows[aid]
    if aid.startswith("DB-C"):
        slot = {"kind": "cover", "ratio": RATIO[aid], "stem": f"{aid}_v01", "side": "front" if aid == "DB-C01" else "back",
                "chapter": None, "story_date": None}
    else:
        sid, date, idx, stop = PLACE[aid]
        w, h = int(r["Width px"]), int(r["Height px"])
        ratio = RATIO.get(aid, "3:2")
        slot = {"kind": "inset" if aid in INSET else "half", "ratio": ratio, "stem": f"{aid}_v01", "chapter": sid, "story_date": date}
    slot["scene"] = dict(zip(LANGS, SCENE[aid]))
    slot["alt"] = dict(zip(LANGS, ALT[aid]))
    if aid in CONTINUITY:
        slot["continuity"] = CONTINUITY[aid]
    if not aid.startswith("DB-C"):
        slot["anchor"] = {l: anchor_for(l, sid, idx) for l in LANGS}
        if stop is not None:
            slot["stop"] = {l: anchor_for(l, sid, stop) for l in LANGS}
        if aid in MIN_FILL:
            slot["min_fill"] = MIN_FILL[aid]
    slots[aid] = slot

reg = {"version": 1, "book": "lamine-drum-and-ball",
       "note": "Chapters, anchors and covers follow Illustration_Register.csv and Art_Direction_EN.txt (DB-I01..DB-I15, DB-C01, DB-C04). "
               "'stem' is the filename stem; the build looks for art/final/<stem>.* first, then art/source/<stem>.*. 'inset' is a page of its own "
               "that keeps the picture whole (no bleed, no crop); 'stop' (optional) is the paragraph a page-art picture should not move past. "
               "The ten character-sheet prompts, the 19 source images and the reference drafts of the dossier are not part of the book.",
       "slots": slots}
(B / "art" / "register.json").write_text(json.dumps(reg, ensure_ascii=False, indent=2), encoding="utf-8")
print(len(slots), "slots written")
for aid, s in slots.items():
    if s.get("anchor"):
        print(aid, s["chapter"], s["kind"])
        for l in LANGS:
            print("   ", l, s["anchor"][l], ("  | stop: " + s["stop"][l]) if s.get("stop") else "")
