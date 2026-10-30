<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/helpers.php';
$services = services();
$p = pricing();
$frNames = [
  'live-video-production' => ['Captation vidéo & direct', 'Multi-caméras, régie en direct, diffusion YouTube, Facebook, Zoom et lien privé pour la famille à l’étranger.'],
  'hybrid-conferencing'   => ['Conférences hybrides', 'Zoom, Teams ou Webex avec intervenants à distance, modération et assistance technique.'],
  'audio-sound'           => ['Sonorisation', 'Micros sans fil, console numérique, enceintes : clair pour 50 comme pour 300 invités.'],
  'led-screen-rental'     => ['Écran LED géant', 'Mur LED modulaire 10×6 ou 13×8 pieds, installation et technicien vidéo inclus.'],
  'photo-booth'           => ['Photo booth', 'Reflex Canon, impressions instantanées, GIF et boomerangs, décor et accessoires.'],
  'media-coverage'        => ['Photos & film souvenir', 'Photographe et vidéaste, galerie en 48 h, film 4K en 5 à 7 jours.'],
  'special-events-video'  => ['Mariages & cérémonies', 'Direct et enregistrement de la cérémonie avec lien privé de visionnage.'],
  'printing-branding'     => ['Impression & textile', 'T-shirts, casquettes, étoles de graduation, mugs, bannières et kakémonos.'],
];
$frFaqs = [
  ['Ma famille au Cameroun, en Côte d’Ivoire ou en Haïti peut-elle suivre en direct ?', 'Oui. Nous diffusons sur YouTube, Facebook, Zoom ou via un lien privé protégé, lisible sur n’importe quel téléphone. La vidéo reste disponible en replay après l’événement.'],
  ['Combien de temps à l’avance faut-il réserver ?', 'Idéalement 4 à 6 semaines. Les mois de mai, juin et de septembre à décembre se remplissent vite. Un acompte de 30 % bloque votre date ; le solde est dû 14 jours avant.'],
  ['Avez-vous besoin du Wi-Fi de la salle ?', 'Non. Nous apportons notre propre connexion cellulaire agrégée (AT&T, Verizon, T-Mobile). Nous ne dépendons jamais du réseau de la salle.'],
  ['Êtes-vous assurés ?', 'Oui : responsabilité civile de 2 000 000 $. Nous fournissons gratuitement le certificat d’assurance exigé par les hôtels, églises et salles.'],
  ['Quels sont vos tarifs ?', 'Photo booth à partir de 550 $, captation en direct à partir de 1 850 $, écran LED à partir de 3 000 $, sonorisation à partir de 850 $. Les forfaits complets commencent à 4 450 $. Devis écrit sous 1 jour ouvré.'],
  ['Vous déplacez-vous en dehors de Washington ?', 'Oui. Le déplacement est gratuit dans un rayon de 35 miles autour de Washington, DC (Maryland et Virginie inclus), puis 1,75 $ par mile. Déplacements dans tout le pays sur demande.'],
];
$crumbs = ['Accueil' => '/', 'Communauté francophone' => '/fr'];
page_start([
  'title' => 'Vidéo, direct, écran LED & photo booth pour vos événements | Washington DC',
  'desc'  => 'Mariages, dots, baptêmes, graduations, cultes et galas de la communauté africaine francophone à Washington DC, Maryland et Virginie. Captation en direct pour la famille au pays, écran LED, sonorisation, photo booth.',
  'path'  => '/fr',
  'lang'  => 'fr',
  'alternate' => ['en' => '/', 'fr' => '/fr'],
  'og_image' => image_url('events/cultural'),
  'jsonld' => [ld_breadcrumb($crumbs), ld_faq($frFaqs)],
]);
?>
<section class="hero">
  <div class="hero-media">
    <?= picture('events/cultural', 'Gala de la diaspora africaine à Washington DC avec écran LED et photo booth', ['widths' => [800, 1600], 'sizes' => '100vw', 'loading' => 'eager', 'priority' => true]) ?>
    <video data-src="/assets/video/hero.mp4" muted loop playsinline preload="none" aria-hidden="true" tabindex="-1"></video>
  </div>
  <div class="container">
    <div class="hero-content reveal in">
      <span class="eyebrow">Votre événement. Sublimé.</span>
      <h1>Vos événements filmés, diffusés et sublimés, <span class="gradient-text">en français.</span></h1>
      <p class="lead">Mariages, dots, baptêmes, graduations, cultes, galas d’associations, concerts : une équipe de production qui parle votre langue, et une diffusion en direct pour vos proches restés au pays.</p>
      <div class="hero-ctas">
        <a class="btn btn-primary btn-lg" href="#devis">Demander un devis gratuit <?= icon('arrow') ?></a>
<?php if (wa_href() !== ''): ?>
        <a class="btn btn-lg" href="<?= h(wa_href('Bonjour Nexus Live Media, je souhaite un devis pour un événement.')) ?>" target="_blank" rel="noopener" data-track="whatsapp"><?= icon('whatsapp') ?> WhatsApp</a>
<?php endif; ?>
      </div>
      <div class="trust">
        <span><?= icon('pin') ?> Washington DC · Maryland · Virginie</span>
        <span><?= icon('shield') ?> Assurance 2 M$, certificat gratuit</span>
        <span><?= icon('wifi') ?> Internet cellulaire autonome</span>
        <span><?= icon('globe') ?> Direct visible sur tous les téléphones</span>
        <span><?= icon('layers') ?> Vidéo, LED, son, photo booth et impression : un seul prestataire</span>
      </div>
    </div>
  </div>
</section>

<section class="section">
  <div class="container two-col">
    <div class="prose reveal">
      <span class="eyebrow">Pour la diaspora</span>
      <h2>Ceux qui n’ont pas pu venir seront quand même là.</h2>
      <p>Un mariage à Silver Spring, une graduation à Arlington, un culte d’anniversaire à Hyattsville : la moitié de la famille regarde depuis Douala, Abidjan, Dakar, Kinshasa, Lomé, Cotonou, Bamako ou Port-au-Prince. Nous installons plusieurs caméras, une régie en direct et une diffusion fluide sur YouTube, Facebook, Zoom ou un lien privé réservé à vos invités, lisible sur un simple téléphone, avec le replay disponible juste après.</p>
      <p>Sur place, l’écran LED géant affiche le direct, les photos et les messages ; la sonorisation couvre discours, chorale et DJ ; le photo booth imprime les souvenirs à emporter ; et nos t-shirts, étoles et bannières personnalisés habillent l’événement à vos couleurs. Un seul contrat, une seule équipe, un responsable qui reste avec vous du montage jusqu’au dernier invité.</p>
      <p>Nous intervenons à Washington DC, dans le Maryland (Silver Spring, Hyattsville, Bethesda, Laurel, Bowie, Germantown) et en Virginie (Arlington, Alexandria, Falls Church, Tysons, Woodbridge). Déplacement gratuit dans un rayon de 35 miles.</p>
    </div>
    <aside class="panel sticky reveal">
      <h3>Nos services</h3>
      <ul class="checks">
<?php foreach ($frNames as $slug => [$name, $desc]): ?>
        <li><?= icon('check') ?> <span><b><?= h($name) ?></b><br><small class="muted"><?= h($desc) ?></small></span></li>
<?php endforeach; ?>
      </ul>
      <a class="btn btn-primary btn-block mt" href="#devis">Demander un devis</a>
    </aside>
  </div>
</section>

<section class="section tight">
  <div class="container">
    <div class="section-head reveal">
      <div><span class="eyebrow">Événements</span><h2>Ce que nous produisons le plus souvent</h2></div>
    </div>
    <div class="grid grid-4">
      <div class="feature reveal"><span class="feature-icon"><?= icon('heart') ?></span><div><h3>Mariages, dots et fiançailles</h3><p>Cérémonie traditionnelle et civile filmées, direct pour la famille, photo booth et film souvenir.</p></div></div>
      <div class="feature reveal"><span class="feature-icon"><?= icon('users') ?></span><div><h3>Graduations et remises de diplômes</h3><p>Écran géant pour que chaque nom soit vu, captation multi-caméras, étoles et t-shirts personnalisés.</p></div></div>
      <div class="feature reveal"><span class="feature-icon"><?= icon('mic') ?></span><div><h3>Cultes, veillées et conventions</h3><p>Sonorisation pour chorale et prédication, écrans, diffusion hebdomadaire ou ponctuelle.</p></div></div>
      <div class="feature reveal"><span class="feature-icon"><?= icon('star') ?></span><div><h3>Galas d’associations et soirées culturelles</h3><p>Écran LED, direct, photographe, photo booth VIP avec fond personnalisé et impression sur place.</p></div></div>
    </div>
  </div>
</section>

<section class="section" id="tarifs">
  <div class="container">
    <div class="section-head reveal">
      <div>
        <span class="eyebrow">Tarifs indicatifs 2026–2027</span>
        <h2>Des prix clairs, un devis écrit sous 1 jour ouvré</h2>
        <p>Prix de départ pour une configuration standard. Le devis final dépend de la salle, de la durée et de la complexité.</p>
      </div>
      <a class="btn" href="/pricing">Grille complète (EN) <?= icon('arrow') ?></a>
    </div>
    <div class="ref-grid">
      <div class="ref-item reveal"><b>Photo booth</b><span class="ref-price">550 $ – 1 750 $</span><span>2 à 4 heures · 3 formules</span></div>
      <div class="ref-item reveal"><b>Captation vidéo & direct</b><span class="ref-price">1 850 $ – 2 500 $+</span><span>Jusqu’à 4 h · 3 ou 4 caméras + internet autonome</span></div>
      <div class="ref-item reveal"><b>Écran LED géant</b><span class="ref-price">3 000 $ – 4 300 $</span><span>Installation + technicien inclus</span></div>
      <div class="ref-item reveal"><b>Sonorisation</b><span class="ref-price">850 $ – 1 800 $</span><span>Jusqu’à 300 invités et plus</span></div>
      <div class="ref-item reveal"><b>Photos & film souvenir</b><span class="ref-price">1 250 $ – 2 400 $</span><span>Photos en 48 h · film 4K en 5 à 7 jours</span></div>
      <div class="ref-item reveal"><b>Forfait Gala & Sommet</b><span class="ref-price">7 850 $</span><span>LED + 3 caméras + son + photo booth + photographe · jusqu’à 300 invités</span></div>
      <div class="ref-item reveal"><b>Forfait Hybride Exécutif</b><span class="ref-price">4 450 $</span><span>3 caméras + son + kiosque photo + photographe · jusqu’à 120 invités</span></div>
      <div class="ref-item reveal"><b>Forfait Entreprise 360</b><span class="ref-price">11 500 $+</span><span>4 caméras + LED 13×8 + photo booth VIP + 100 t-shirts/casquettes</span></div>
    </div>
  </div>
</section>

<section class="section tight">
  <div class="container two-col">
    <div class="reveal">
      <span class="eyebrow">Questions fréquentes</span>
      <h2>Ce que l’on nous demande avant de réserver</h2>
      <p class="muted">Une autre question ? Appelez ou écrivez-nous sur WhatsApp au <a href="<?= h(tel_href()) ?>" data-track="call"><b><?= h(PHONE_DISPLAY) ?></b></a>.</p>
    </div>
    <div class="reveal"><?= faq_list($frFaqs) ?></div>
  </div>
</section>

<section class="section" id="devis">
  <div class="container contact-grid">
    <div class="panel reveal">
      <span class="eyebrow">Devis gratuit</span>
      <h2 style="font-size:1.5rem">Parlez-nous de votre événement</h2>
      <p class="muted">Date, lieu, nombre d’invités et ce dont vous avez besoin. Réponse sous 1 jour ouvré, en français.</p>
      <?php $formLang = 'fr'; require __DIR__ . '/includes/quote-form.php'; ?>
    </div>
    <aside class="reveal">
      <div class="cta-band" style="flex-direction:column;align-items:flex-start">
        <div>
          <h3 style="font-size:1.3rem">Vous préférez parler de vive voix ?</h3>
          <p>Appelez-nous ou écrivez sur WhatsApp : nous cadrons votre événement ensemble en quelques minutes.</p>
        </div>
        <div class="actions">
          <a class="btn btn-light" href="<?= h(tel_href()) ?>" data-track="call"><?= icon('phone') ?> <?= h(PHONE_DISPLAY) ?></a>
<?php if (wa_href() !== ''): ?>
          <a class="btn" href="<?= h(wa_href('Bonjour Nexus Live Media, je souhaite un devis pour un événement.')) ?>" target="_blank" rel="noopener" data-track="whatsapp"><?= icon('whatsapp') ?> WhatsApp</a>
<?php endif; ?>
        </div>
      </div>
      <div class="media-rounded mt"><?= picture('brand/sketch', 'Croquis du logo Nexus Live Media avec le slogan Your Event. Elevated.', ['widths' => [800, 1600], 'sizes' => '(max-width: 1024px) 100vw, 40vw']) ?></div>
      <div class="panel mt">
        <h3 style="font-size:1.05rem">Zone d’intervention</h3>
        <p class="muted" style="margin:0">Washington DC, Maryland et Virginie. Déplacement gratuit dans un rayon de 35 miles autour de DC, puis 1,75 $ par mile. Interventions dans tout le pays sur demande.</p>
      </div>
    </aside>
  </div>
</section>
<?php page_end(); ?>
