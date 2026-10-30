<?php
// Service page template. The calling file sets $slug.
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

$all = services();
if (!isset($slug, $all[$slug])) { require dirname(__DIR__) . '/404.php'; exit; }
$s       = $all[$slug];
$imgBase = preg_replace('/\.jpg$/', '', $s['image']);
$url     = service_url($slug);
$crumbs  = ['Home' => '/', 'Services' => '/services/', $s['name'] => $url];
$relatedEvents = array_filter(events(), fn($e) => in_array($slug, $e['services'], true));
$pricing = pricing();
// Brand clips that play behind the page hero on wide screens
$heroVideos = ['live-video-production' => '/assets/video/switcher.mp4', 'media-coverage' => '/assets/video/gala.mp4', 'photo-booth' => '/assets/video/photo-booth.mp4'];
$heroVideo = $heroVideos[$slug] ?? '';

page_start([
  'title' => $s['meta_title'],
  'desc'  => $s['meta_desc'],
  'path'  => $url,
  'og_image' => image_url($imgBase),
  'jsonld' => [ld_service($s, $slug), ld_breadcrumb($crumbs), ld_faq($s['faqs'])],
]);
?>
<section class="page-hero">
  <div class="hero-media">
    <?= picture($imgBase, $s['image_alt'], ['widths' => [800, 1600], 'sizes' => '100vw', 'loading' => 'eager', 'priority' => true]) ?>
<?php if ($heroVideo !== ''): ?>
    <video data-src="<?= h($heroVideo) ?>" muted loop playsinline preload="none" aria-hidden="true" tabindex="-1"></video>
<?php endif; ?>
  </div>
  <div class="container">
    <?= breadcrumbs($crumbs) ?>
    <div class="hero-content reveal in">
      <span class="eyebrow">Service</span>
      <h1><?= h($s['name']) ?></h1>
      <p class="lead"><?= h($s['tagline']) ?></p>
      <div class="price-tag"><span>From</span><b><?= h($s['price_from']) ?></b><span>· <?= h($s['price_note']) ?></span></div>
      <div class="hero-ctas">
        <a class="btn btn-primary btn-lg" href="<?= h(quote_url($slug)) ?>"><?= h($s['cta']) ?> <?= icon('arrow') ?></a>
        <a class="btn btn-lg" href="<?= h(tel_href()) ?>" data-track="call"><?= icon('phone') ?> <?= h(PHONE_DISPLAY) ?></a>
      </div>
    </div>
  </div>
</section>

<section class="section">
  <div class="container two-col">
    <div class="prose reveal">
      <span class="eyebrow">Overview</span>
      <h2><?= h($s['name']) ?> in Washington DC, Maryland and Virginia</h2>
<?php foreach ($s['intro'] as $p): ?>
      <p><?= h($p) ?></p>
<?php endforeach; ?>
      <h3>Ideal for</h3>
      <ul class="chips">
<?php foreach ($s['ideal_for'] as $i): ?>
        <li><?= h($i) ?></li>
<?php endforeach; ?>
      </ul>
    </div>
    <aside class="panel sticky reveal">
      <h3>What's included</h3>
      <ul class="checks">
<?php foreach ($s['includes'] as $i): ?>
        <li><?= icon('check') ?> <?= h($i) ?></li>
<?php endforeach; ?>
      </ul>
      <a class="btn btn-primary btn-block mt" href="<?= h(quote_url($slug)) ?>"><?= h($s['cta']) ?></a>
      <p class="form-note"><?= icon('shield', 'sm') ?> $2M liability, free COIs · 30% retainer locks your date</p>
    </aside>
  </div>
</section>

<?php if ($slug === 'photo-booth'): ?>
<section class="section tight" id="tiers">
  <div class="container">
    <div class="gallery reveal" style="margin-bottom:34px">
      <figure><?= picture('gallery/booth-guests', 'Guests laughing at the open-air photo booth tower', ['widths' => [800], 'sizes' => '(max-width: 768px) 50vw, 25vw']) ?><figcaption>Open-air booth tower</figcaption></figure>
      <figure><?= picture('gallery/booth-print', 'Guests holding their instant print next to the DNP dye-sub printer', ['widths' => [800], 'sizes' => '(max-width: 768px) 50vw, 25vw']) ?><figcaption>Instant dye-sub prints</figcaption></figure>
      <figure><?= picture('gallery/booth-video', 'Two guests smiling for the booth camera at a gala', ['widths' => [800], 'sizes' => '(max-width: 768px) 50vw, 25vw']) ?><figcaption>Gala activation</figcaption></figure>
      <figure><?= picture('gallery/booth-portrait', 'Guest dancing inside the photo booth frame', ['widths' => [500], 'sizes' => '(max-width: 768px) 50vw, 25vw']) ?><figcaption>GIFs and boomerangs</figcaption></figure>
    </div>
    <div class="section-head reveal">
      <div>
        <span class="eyebrow">Three tiers</span>
        <h2>Pick the experience that fits your event</h2>
        <p>All tiers include Canon DSLR capture, a professional attendant, a custom overlay and an online gallery. Prices are for active hours; idle time is billed separately.</p>
      </div>
    </div>
    <div class="grid grid-3">
<?php foreach ($pricing['booth_tiers'] as $t): ?>
      <div class="tier reveal<?= $t['featured'] ? ' featured' : '' ?>">
        <span class="label"><?= h($t['label']) ?></span>
        <h3><?= h($t['name']) ?></h3>
        <div class="price"><span><?= h($t['price']) ?></span><small>/ <?= h($t['hours']) ?></small></div>
        <p class="desc"><?= h($t['desc']) ?></p>
        <ul class="checks">
<?php foreach ($t['features'] as $f): ?>
          <li><?= icon('check') ?> <?= h($f) ?></li>
<?php endforeach; ?>
        </ul>
        <a class="btn <?= $t['featured'] ? 'btn-primary' : '' ?> btn-block" href="/contact?service=Photo%20Booth">Reserve <?= h($t['name']) ?></a>
      </div>
<?php endforeach; ?>
    </div>
    <h3 class="mt" style="margin-top:28px">À la carte enhancements</h3>
    <div class="addons">
<?php foreach ($pricing['booth_addons'] as [$name, $price]): ?>
      <div class="addon reveal"><span><?= h($name) ?></span><b><?= h($price) ?></b></div>
<?php endforeach; ?>
    </div>
  </div>
</section>
<?php endif; ?>

<?php if (!empty($s['specs']) || !empty($s['process'])): ?>
<section class="section tight">
  <div class="container grid grid-2" style="align-items:start">
<?php if (!empty($s['specs'])): ?>
    <div class="panel reveal">
      <span class="eyebrow">Specifications</span>
      <h3>What we bring</h3>
      <table class="specs">
<?php foreach ($s['specs'] as [$label, $value]): ?>
        <tr><th><?= h($label) ?></th><td><?= h($value) ?></td></tr>
<?php endforeach; ?>
      </table>
    </div>
<?php endif; ?>
<?php if (!empty($s['process'])): ?>
    <div class="reveal">
      <span class="eyebrow">How it works</span>
      <h3>From booking to delivery</h3>
      <div class="steps" style="grid-template-columns:1fr">
<?php foreach ($s['process'] as [$title, $text]): ?>
        <div class="step"><h3><?= h($title) ?></h3><p><?= h($text) ?></p></div>
<?php endforeach; ?>
      </div>
    </div>
<?php endif; ?>
  </div>
</section>
<?php endif; ?>

<section class="section">
  <div class="container two-col">
    <div class="reveal">
      <span class="eyebrow">FAQ</span>
      <h2><?= h($s['short']) ?>: common questions</h2>
      <p class="muted">Still unsure? <a href="<?= h(tel_href()) ?>" data-track="call"><b>Call <?= h(PHONE_DISPLAY) ?></b></a> and a producer will answer in minutes.</p>
    </div>
    <div class="reveal"><?= faq_list($s['faqs']) ?></div>
  </div>
</section>

<?php if ($relatedEvents): ?>
<section class="section tight">
  <div class="container">
    <div class="section-head reveal">
      <div><span class="eyebrow">Popular for</span><h2>Events that book this service</h2></div>
      <a class="btn" href="/events/">All event types <?= icon('arrow') ?></a>
    </div>
    <div class="grid grid-<?= min(5, max(2, count($relatedEvents))) ?>">
<?php foreach ($relatedEvents as $es => $e): ?>
      <?= event_card($es, $e) ?>
<?php endforeach; ?>
    </div>
  </div>
</section>
<?php endif; ?>

<section class="section tight">
  <div class="container">
    <div class="section-head reveal">
      <div><span class="eyebrow">Pairs well with</span><h2>Related services</h2></div>
    </div>
    <div class="grid grid-3">
<?php foreach ($s['related'] as $rs): if (!isset($all[$rs])) continue; ?>
      <?= service_card($rs, $all[$rs]) ?>
<?php endforeach; ?>
    </div>
  </div>
</section>

<section class="section" id="quote">
  <div class="container contact-grid">
    <div class="panel reveal">
      <span class="eyebrow">Get a quote</span>
      <h2 style="font-size:1.5rem"><?= h($s['cta']) ?></h2>
      <p class="muted">Share your date and venue. You will hear back within 1 business day.</p>
      <?php $formCompact = true; $formService = service_form_label($slug); require __DIR__ . '/quote-form.php'; ?>
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
          <a class="btn" href="<?= h(wa_href('Hi Nexus Live Media, I would like a quote for ' . $s['name'] . '.')) ?>" target="_blank" rel="noopener" data-track="whatsapp"><?= icon('whatsapp') ?> WhatsApp</a>
<?php endif; ?>
        </div>
      </div>
    </aside>
  </div>
</section>
<?php page_end(); ?>
