<?php
declare(strict_types=1);
$isFr = ($meta['lang'] ?? 'en') === 'fr';
$wa   = wa_href($isFr ? 'Bonjour Nexus Live Media, je souhaite un devis pour un événement.' : 'Hi Nexus Live Media, I would like a quote for an event.');
$socialLabels = ['instagram' => 'Instagram', 'facebook' => 'Facebook', 'youtube' => 'YouTube', 'linkedin' => 'LinkedIn', 'tiktok' => 'TikTok'];
?>
</main>

<footer class="site-footer">
  <div class="container">
    <div class="footer-grid">
      <div class="footer-brand">
        <a class="brand" href="/"><?= logo_svg() ?><span class="brand-text"><b>Nexus Live Media</b></span></a>
        <p><?= $isFr
          ? 'Production vidéo en direct, conférences hybrides, sonorisation, murs LED, photo booths, couverture média et personnalisation d’événements à Washington DC, Maryland et Virginie.'
          : 'Live video production, hybrid conferencing, pro audio, LED walls, open-air photo booths, media coverage and event branding across Washington DC, Maryland and Virginia.' ?></p>
        <div class="social">
<?php foreach (SOCIAL as $k => $url): if ($url === '') continue; ?>
          <a href="<?= h($url) ?>" target="_blank" rel="noopener"><?= h($socialLabels[$k]) ?></a>
<?php endforeach; ?>
<?php if (GOOGLE_BUSINESS_URL !== ''): ?>
          <a href="<?= h(GOOGLE_BUSINESS_URL) ?>" target="_blank" rel="noopener"><?= icon('star', 'sm') ?> <?= $isFr ? 'Avis Google' : 'Google Reviews' ?></a>
<?php endif; ?>
        </div>
      </div>

      <div>
        <h4>Services</h4>
        <ul>
<?php foreach (services() as $slug => $s): ?>
          <li><a href="<?= h(service_url($slug)) ?>"><?= h($s['short']) ?></a></li>
<?php endforeach; ?>
        </ul>
      </div>

      <div>
        <h4><?= $isFr ? 'Événements' : 'Events' ?></h4>
        <ul>
<?php foreach (events() as $slug => $e): ?>
          <li><a href="<?= h(event_url($slug)) ?>"><?= h($e['short']) ?></a></li>
<?php endforeach; ?>
          <li><a href="/fr" lang="fr">Communauté francophone</a></li>
        </ul>
        <h4 class="mt"><?= $isFr ? 'Entreprise' : 'Company' ?></h4>
        <ul>
          <li><a href="/about"><?= $isFr ? 'À propos' : 'About us' ?></a></li>
          <li><a href="/pricing"><?= $isFr ? 'Tarifs' : 'Pricing' ?></a></li>
          <li><a href="/faq">FAQ</a></li>
          <li><a href="/contact">Contact</a></li>
        </ul>
      </div>

      <div class="footer-contact">
        <h4>Contact</h4>
        <a href="<?= h(tel_href()) ?>" data-track="call"><?= icon('phone') ?> <?= h(PHONE_DISPLAY) ?></a>
<?php if ($wa !== ''): ?>
        <a href="<?= h($wa) ?>" target="_blank" rel="noopener" data-track="whatsapp"><?= icon('whatsapp') ?> WhatsApp</a>
<?php endif; ?>
        <a href="<?= h(mail_href()) ?>" data-track="email"><?= icon('mail') ?> <?= h(EMAIL_TO) ?></a>
        <span><?= icon('pin') ?> <?= h(SERVICE_AREA) ?><br><small><?= $isFr ? 'Déplacements dans tout le pays' : 'Nationwide travel available' ?></small></span>
        <span><?= icon('clock') ?> <?= $isFr ? '7j/7 · 8h – 22h' : '7 days a week · 8am – 10pm' ?></span>
      </div>
    </div>

    <div class="footer-bottom">
      <span>© <span id="year"><?= date('Y') ?></span> <?= h(SITE_NAME) ?> · <?= h(LEGAL_NAME) ?>. <?= $isFr ? 'Tous droits réservés.' : 'All rights reserved.' ?></span>
      <a href="#top" class="to-top"><?= $isFr ? 'Haut de page' : 'Back to top' ?> ↑</a>
    </div>
  </div>
</footer>

<div class="mobile-bar" aria-label="Quick actions">
  <a href="<?= h(tel_href()) ?>" data-track="call"><?= icon('phone') ?><span><?= $isFr ? 'Appeler' : 'Call' ?></span></a>
<?php if ($wa !== ''): ?>
  <a href="<?= h($wa) ?>" target="_blank" rel="noopener" data-track="whatsapp"><?= icon('whatsapp') ?><span>WhatsApp</span></a>
<?php endif; ?>
  <a class="primary" href="/contact"><?= icon('zap') ?><span><?= $isFr ? 'Devis' : 'Get a Quote' ?></span></a>
</div>

<script src="<?= h(asset('assets/js/site.js')) ?>" defer></script>
</body>
</html>
