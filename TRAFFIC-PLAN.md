# Plan de trafic — nexuslivemedia.com

Constat au 30 octobre 2026 : le domaine n'apparaît nulle part sur Google (aucune fiche Google Business, aucun annuaire, aucun réseau social, un seul URL indexable). Vos concurrents (Prime AV, Insane Impact, Pixel Wall, Luxio Photo Booth, Magic Photobooth DMV…) sont présents sur Thumbtack, WeddingWire, Eventective, et ont une page par service.

Le nouveau site règle la partie « site » : 21 pages ciblant chacune un mot-clé local, données structurées, sitemap, vitesse, mobile, formulaire sécurisé, page en français. Le trafic vient maintenant des actions ci-dessous, dans cet ordre.

## Semaine 1 — Les fondations gratuites (≈ 3 heures)

### 1. Google Business Profile (priorité absolue)
C'est la source n°1 de clients pour un prestataire local : c'est la fiche avec carte, avis et bouton « Appeler » qui sort quand quelqu'un tape « LED wall rental near me ».

1. business.google.com → *Gérer* → créer la fiche **Nexus Live Media**.
2. Catégorie principale : **Video production service**. Secondaires : *Audio visual equipment rental service*, *Photo booth rental service*, *Event management company*, *Live streaming service*.
3. Type : **entreprise de services** (zone desservie, sans adresse publique) → zones : Washington DC, Montgomery County MD, Prince George's County MD, Arlington VA, Alexandria VA, Fairfax County VA.
4. Téléphone `+1 202-243-8880`, site `https://nexuslivemedia.com`, horaires 8h–22h 7j/7.
5. **Services** : ajouter les 8 services avec les prix « à partir de » du site.
6. **Photos** : 10 minimum (les visuels du site en attendant de vraies photos d'événements — puis remplacer par les vraies).
7. Description (750 car.) : reprendre le 1er paragraphe de la page À propos.
8. Vérification (courrier/vidéo) → une fois validée, copier le lien « Demander un avis » dans `GOOGLE_BUSINESS_URL` (config.php).
9. Publier un **post Google** chaque semaine (photo + 2 phrases + bouton « Obtenir un devis »).

### 2. Google Search Console
search.google.com/search-console → propriété `nexuslivemedia.com` (déjà vérifiée par DNS) → *Sitemaps* → envoyer `sitemap.xml` → *Inspection d'URL* → demander l'indexation de `/`, `/services`, `/pricing`, `/services/led-screen-rental`, `/services/photo-booth`, `/fr`.

### 3. Google Analytics 4
analytics.google.com → créer la propriété → copier `G-XXXXXXXXXX` dans `GA_MEASUREMENT_ID`. Le site envoie déjà les événements `generate_lead` (formulaire) et `contact_click` (appel / WhatsApp / email). Dans GA4 → *Admin* → *Événements* → marquer `generate_lead` comme conversion.

### 4. Bing Places
bingplaces.com → *Importer depuis Google Business Profile* (2 minutes, trafic Bing + ChatGPT/Copilot).

## Semaine 2 — Être là où vos concurrents sont

Créer un profil complet (mêmes nom, téléphone, site, description, photos partout) sur :

| Plateforme | Pourquoi | Coût |
|---|---|---|
| **Thumbtack** | 1er apporteur de leads pour photo booth / vidéo / AV dans le DMV | paiement au lead |
| **Bark** | leads événementiel, beaucoup de demandes mariage/corporate | paiement au lead |
| **GigSalad** et **The Bash** | photo booth, vidéaste, AV pour fêtes | abonnement léger |
| **Eventective** | planners corporate cherchent des prestataires AV (Pixel Wall y est) | gratuit |
| **WeddingWire** + **The Knot** | photo booth et vidéo mariage (vos concurrents y sont) | gratuit / premium |
| **Yelp** | avis + visibilité « near me » | gratuit |
| **PartySlate** | planners haut de gamme DC | gratuit |
| **Facebook Page**, **Instagram**, **YouTube**, **LinkedIn**, **TikTok** | preuve sociale + liens vers le site ; renseigner `SOCIAL[]` dans config.php | gratuit |
| **Nextdoor Business** | quartiers MD/VA | gratuit |

Règle : le **nom, téléphone et URL doivent être identiques partout** (Google s'en sert pour vous faire confiance).

## Semaine 3 — Les avis

- Après chaque événement, envoyer par SMS/WhatsApp le lien d'avis Google : « Merci pour votre confiance ! Un avis en 30 secondes nous aide énormément : [lien] ».
- Objectif : **10 avis en 60 jours**, puis 2 par mois. Répondre à chaque avis.
- Demander aussi 2–3 avis sur Thumbtack et WeddingWire.
- Dès 5 avis Google, mettre les meilleurs sur le site (section « What organizers say ») à la place des témoignages anonymes.

## Semaine 4 et suivantes — Contenu qui attire

### Vidéo (c'est votre métier : montrez-le)
- Chaîne **YouTube** : 1 vidéo de 30–60 s par événement (highlight). Titres = mots-clés : « LED Wall Rental Washington DC — Gala 300 guests », « Graduation Live Stream Maryland ».
- Les mêmes clips en **Reels Instagram / TikTok / Facebook**, avec le lieu en hashtag (#dcevents #marylandwedding #dmvphotobooth).
- Intégrer 2–3 vidéos YouTube sur le site (page À propos et pages services) : je peux les ajouter dès que vous avez les liens.

### Articles (2 par mois, 600–900 mots, je peux les rédiger)
Sujets qui ont des recherches et peu de concurrence locale :
1. « How much does an LED wall rental cost in Washington DC? » (avec vos prix)
2. « How to live stream a graduation ceremony for families abroad »
3. « Photo booth for an African wedding in Maryland: what to expect »
4. « Hybrid event checklist for DC nonprofits (Zoom + in-room) »
5. « Church live streaming setup: bonded internet vs. venue Wi-Fi »
→ nécessite d'ajouter une section blog au site (une heure de travail).

### Communauté francophone (votre avantage unique)
- Page `/fr` déjà en ligne : la partager dans les **groupes WhatsApp et Facebook** des communautés camerounaise, ivoirienne, sénégalaise, congolaise, togolaise, béninoise, malienne, guinéenne et haïtienne du DMV.
- Contacter les **associations** (amicales, associations d'étudiants à Howard, UMD, GMU, GWU), les **églises** francophones (Silver Spring, Hyattsville, Alexandria) et les **ambassades** (événements culturels, fêtes nationales).
- Partenariats avec **DJs, traiteurs, wedding planners, salles** : 10 % de commission sur toute recommandation qui signe.

## Publicité (quand les fondations sont en place, pas avant)

- **Google Ads Search** : 15–20 $/jour sur « led wall rental washington dc », « photo booth rental maryland », « live streaming services dc », « audio visual rental northern virginia ». Chaque mot-clé a maintenant sa page d'atterrissage.
- **Meta Ads** : 5–10 $/jour, ciblage DMV + intérêts (Afrobeats, mariage, graduation, pays d'origine) vers `/fr`.
- Mesurer avec la conversion `generate_lead` : ne garder que ce qui produit des demandes.

## Suivi mensuel (15 minutes)

| Indicateur | Où | Objectif à 90 jours |
|---|---|---|
| Impressions / clics Google | Search Console | 5 000 impressions, 150 clics / mois |
| Appels + itinéraires + clics site | Google Business Profile → Performances | 30 actions / mois |
| Demandes de devis | GA4 (`generate_lead`) + `submissions.log` | 10 / mois |
| Avis Google | fiche | 10 avis, note ≥ 4,8 |
| Positions | Search Console → Requêtes | top 10 sur « led wall rental dc », « photo booth rental dmv » |

## Ce que je peux faire ensuite

1. Ajouter une section **blog** et rédiger les 5 premiers articles.
2. Intégrer vos **vraies photos/vidéos** dès qu'elles existent (remplacement en 10 minutes).
3. Rédiger les **fiches d'annuaire** (texte prêt à coller pour Thumbtack, Bark, WeddingWire, Eventective).
4. Préparer les **posts Google Business** d'un mois et le **script SMS** de demande d'avis.
