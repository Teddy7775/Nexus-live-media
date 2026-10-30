<?php
// Event-type page template. The calling file sets $slug.
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

$all = events();
if (!isset($slug, $all[$slug])) { require dirname(__DIR__) . '/404.php'; exit; }
$e       = $all[$slug];
$imgBase = preg_replace('/\.jpg$/', '', $e['image']);
$url     = event_url($slug);
$crumbs  = ['Home' => '/', 'Events' => '/events/', $e['name'] => $url];
$services = services();

page_start([
  'title' => $e['meta_title'],
  'desc'  => $e['meta_desc'],
  'path'  => $url,
  'og_image' => image_url($imgBase),
  'jsonld' => [ld_breadcrumb($crumbs), ld_faq($e['faqs'])],
]);
?>
<section class="page-hero">
  <div class="hero-media">
    <?= picture($imgBase, $e['image_alt'], ['widths' => [800, 1600], 'sizes' => '100vw', 'loading' => 'eager', 'priority' => true]) ?>
<?php if ($slug === 'corporate'): ?>
    <video data-src="/assets/video/gala.mp4" muted loop playsinline preload="none" aria-hidden="true" tabindex="-1"></video>
<?php endif; ?>
  </div>
  <div class="container">
    <?= breadcrumbs($crumbs) ?>
    <div class="hero-content reveal in">
      <span class="eyebrow">Event production</span>
      <h1><?= h($e['name']) ?></h1>
      <p class="lead"><?= h($e['tagline']) ?></p>
      <div class="hero-ctas">
        <a class="btn btn-primary btn-lg" href="/contact"><?= h($e['cta']) ?> <?= icon('arrow') ?></a>
        <a class="btn btn-lg" href="/pricing">See pricing</a>
      </div>
    </div>
  </div>
</section>

<section class="section">
  <div class="container two-col">
    <div class="prose reveal">
      <span class="eyebrow">Overview</span>
      <h2><?= h($e['name']) ?> in Washington DC, Maryland and Virginia</h2>
      <p style="color:var(--text);font-weight:600"><?= h($e['summary']) ?></p>
<?php foreach ($e['intro'] as $p): ?>
      <p><?= h($p) ?></p>
<?php endforeach; ?>
    </div>
    <aside class="panel sticky reveal">
      <h3>What we handle</h3>
      <ul class="checks">
<?php foreach ($e['highlights'] as $i): ?>
        <li><?= icon('check') ?> <?= h($i) ?></li>
<?php endforeach; ?>
      </ul>
      <a class="btn btn-primary btn-block mt" href="/contact"><?= h($e['cta']) ?></a>
      <p class="form-note"><?= icon('shield', 'sm') ?> $2M liability, free COIs · bonded cellular internet</p>
    </aside>
  </div>
</section>

<section class="section tight">
  <div class="container">
    <div class="section-head reveal">
      <div><span class="eyebrow">Recommended services</span><h2>What <?= h(mb_strtolower($e['short'])) ?> usually book</h2></div>
      <a class="btn" href="/services/">All services <?= icon('arrow') ?></a>
    </div>
    <div class="grid grid-<?= min(4, max(2, count($e['services']))) ?>">
<?php foreach ($e['services'] as $ss): if (!isset($services[$ss])) continue; ?>
      <?= service_card($ss, $services[$ss]) ?>
<?php endforeach; ?>
    </div>
  </div>
</section>

<section class="section">
  <div class="container two-col">
    <div class="reveal">
      <span class="eyebrow">FAQ</span>
      <h2>Questions from <?= h(mb_strtolower($e['short'])) ?> planners</h2>
      <p class="muted">More answers on the <a href="/faq"><b>FAQ page</b></a>, or call <a href="<?= h(tel_href()) ?>" data-track="call"><b><?= h(PHONE_DISPLAY) ?></b></a>.</p>
    </div>
    <div class="reveal"><?= faq_list($e['faqs']) ?></div>
  </div>
</section>

<section class="section" id="quote">
  <div class="container contact-grid">
    <div class="panel reveal">
      <span class="eyebrow">Get a quote</span>
      <h2 style="font-size:1.5rem"><?= h($e['cta']) ?></h2>
      <p class="muted">Share your date and venue. You will hear back within 1 business day.</p>
      <?php $formCompact = true; require __DIR__ . '/quote-form.php'; ?>
    </div>
    <aside class="reveal">
      <div class="cta-band" style="flex-direction:column;align-items:flex-start">
        <div>
          <h3 style="font-size:1.3rem">Prefer to talk it through?</h3>
          <p>Call or WhatsApp and we will scope your event together in a few minutes.</p>
        </div>
        <div class="actions">
          <a class="btn btn-light" href="<?= h(tel_href()) ?>" data-track="call"><?= icon('phone') ?> <?= h(PHONE_DISPLAY) ?></a>
<?php if (wa_href() !== ''): ?>
          <a class="btn" href="<?= h(wa_href('Hi Nexus Live Media, I am planning a ' . $e['short'] . ' event and would like a quote.')) ?>" target="_blank" rel="noopener" data-track="whatsapp"><?= icon('whatsapp') ?> WhatsApp</a>
<?php endif; ?>
        </div>
      </div>
    </aside>
  </div>
</section>
<?php page_end(); ?>
