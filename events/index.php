<?php
declare(strict_types=1);
require_once __DIR__ . '/../includes/helpers.php';
$crumbs = ['Home' => '/', 'Events' => '/events/'];
page_start([
  'title' => 'Event Types We Produce in DC, Maryland & Virginia | Nexus Live Media',
  'desc'  => 'Corporate and government meetings, graduations, weddings, church services and cultural celebrations. See how we plan live video, LED, audio and photo booths for each kind of event.',
  'path'  => '/events/',
  'jsonld' => [ld_breadcrumb($crumbs)],
]);
?>
<section class="page-hero">
  <div class="hero-media"><?= picture('events/corporate', 'Corporate gala with LED wall and broadcast cameras', ['widths' => [800, 1600], 'sizes' => '100vw', 'loading' => 'eager', 'priority' => true]) ?></div>
  <div class="container">
    <?= breadcrumbs($crumbs) ?>
    <div class="hero-content reveal in">
      <span class="eyebrow">Who we serve</span>
      <h1>Every event has its own run-of-show. <span class="gradient-text">We plan for yours.</span></h1>
      <p class="lead">From a 2,000-seat commencement to an intimate wedding streamed to family abroad, pick your event type to see what we recommend and what it costs.</p>
    </div>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="grid grid-5">
<?php foreach (events() as $slug => $e): ?>
      <?= event_card($slug, $e) ?>
<?php endforeach; ?>
    </div>
  </div>
</section>

<section class="section tight">
  <div class="container two-col">
    <div class="panel reveal" lang="fr">
      <span class="eyebrow">Communauté francophone</span>
      <h2 style="font-size:1.5rem">Mariages, dots, graduations et galas en français</h2>
      <p class="muted">Une équipe qui parle votre langue à Washington DC, dans le Maryland et en Virginie, et une diffusion en direct pour vos proches restés au pays.</p>
      <a class="btn btn-primary" href="/fr" hreflang="fr">Voir la page en français <?= icon('arrow') ?></a>
    </div>
    <div class="cta-band reveal" style="flex-direction:column;align-items:flex-start">
      <div>
        <h2 style="font-size:1.5rem">Don't see your event?</h2>
        <p>Concerts, product launches, press conferences, award nights, sports banquets and more. Tell us what you are producing.</p>
      </div>
      <div class="actions"><a class="btn btn-light" href="/contact">Request a quote</a></div>
    </div>
  </div>
</section>
<?php page_end(); ?>
