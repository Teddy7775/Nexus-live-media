<?php
declare(strict_types=1);
require_once __DIR__ . '/../includes/helpers.php';
$crumbs = ['Home' => '/', 'Services' => '/services/'];
page_start([
  'title' => 'Event Production Services in Washington DC | Nexus Live Media',
  'desc'  => 'Live video production, hybrid conferencing, pro audio, LED wall rental, open-air photo booths, media coverage, special events video and event branding. Book one service or a full production.',
  'path'  => '/services/',
  'jsonld' => [ld_breadcrumb($crumbs)],
]);
?>
<section class="page-hero">
  <div class="hero-media"><?= picture('services/live-video', 'Live video production switcher and multiview monitor at an event', ['widths' => [800, 1600], 'sizes' => '100vw', 'loading' => 'eager', 'priority' => true]) ?></div>
  <div class="container">
    <?= breadcrumbs($crumbs) ?>
    <div class="hero-content reveal in">
      <span class="eyebrow">Services</span>
      <h1>Eight services. One crew. <span class="gradient-text">One contract.</span></h1>
      <p class="lead">Pick exactly what your event needs, or let us bundle video, LED, audio, photo booth and branding into a complete production with a single on-site lead.</p>
      <div class="hero-ctas">
        <a class="btn btn-primary btn-lg" href="/contact">Get a free quote <?= icon('arrow') ?></a>
        <a class="btn btn-lg" href="/pricing">See pricing</a>
      </div>
    </div>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="grid grid-4">
<?php foreach (services() as $slug => $s): ?>
      <?= service_card($slug, $s) ?>
<?php endforeach; ?>
    </div>
  </div>
</section>

<section class="section tight">
  <div class="container">
    <div class="cta-band reveal">
      <div>
        <h2>Not sure what you need?</h2>
        <p>Tell us about the event and a producer will recommend the right combination, with a clear estimate, within 1 business day.</p>
      </div>
      <div class="actions">
        <a class="btn btn-light btn-lg" href="/contact">Request a quote</a>
        <a class="btn btn-lg" href="<?= h(tel_href()) ?>" data-track="call"><?= icon('phone') ?> <?= h(PHONE_DISPLAY) ?></a>
      </div>
    </div>
  </div>
</section>
<?php page_end(); ?>
