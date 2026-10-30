<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/helpers.php';
$p = pricing();
$services = services();
$crumbs = ['Home' => '/', 'Pricing' => '/pricing'];
$bookingFaqs = array_values(array_filter(faqs(), fn($f) => in_array($f['cat'], ['booking', 'policies'], true)));
page_start([
  'title' => 'Event Production Pricing & Packages | Nexus Live Media DC',
  'desc'  => 'Transparent 2026–2027 rates for live streaming, LED wall rental, pro audio, photo booths and media coverage in Washington DC, Maryland and Virginia. Bundles from $4,450, standalone services from $550.',
  'path'  => '/pricing',
  'jsonld' => [ld_breadcrumb($crumbs), ld_faq($bookingFaqs)],
]);
?>
<section class="page-hero">
  <div class="hero-media"><?= picture('services/led-wall', 'LED video wall on a ballroom stage', ['widths' => [800, 1600], 'sizes' => '100vw', 'loading' => 'eager', 'priority' => true]) ?></div>
  <div class="container">
    <?= breadcrumbs($crumbs) ?>
    <div class="hero-content reveal in">
      <span class="eyebrow">2026–2027 rate card</span>
      <h1>Clear pricing. <span class="gradient-text">No surprises on show day.</span></h1>
      <p class="lead">Every figure below is a starting rate for a standard configuration. Final quotes depend on venue, duration and complexity, and we put everything in writing before you commit.</p>
      <div class="hero-ctas">
        <a class="btn btn-primary btn-lg" href="/contact">Get an exact quote <?= icon('arrow') ?></a>
        <a class="btn btn-lg" href="#standalone">Standalone services</a>
      </div>
    </div>
  </div>
</section>

<section class="section" id="packages">
  <div class="container">
    <div class="section-head reveal">
      <div>
        <span class="eyebrow">Full-production packages</span>
        <h2>Turnkey bundles at significant savings</h2>
        <p>Our three most-booked combinations. Each one includes a lead producer, load-in, teardown and delivery.</p>
      </div>
    </div>
    <div class="grid grid-3 pricing">
<?php foreach ($p['packages'] as $pk): ?>
      <div class="price-card reveal<?= $pk['featured'] ? ' featured' : '' ?>" id="<?= h($pk['slug']) ?>">
        <div class="price-top"><span class="label"><?= h($pk['label']) ?></span><span class="savings"><?= h($pk['savings']) ?></span></div>
        <h3><?= h($pk['name']) ?></h3>
        <div class="price"><span><?= h($pk['price']) ?></span><small><?= h($pk['price_note']) ?></small></div>
        <span class="guests"><?= h($pk['guests']) ?></span>
        <p class="price-desc"><?= h($pk['desc']) ?></p>
        <ul class="checks">
<?php foreach ($pk['features'] as $f): ?>
          <li><?= icon('check') ?> <?= h($f) ?></li>
<?php endforeach; ?>
        </ul>
        <div class="price-actions">
          <a class="btn btn-primary" href="/contact?service=<?= rawurlencode('Full Package (Recommended)') ?>">Get this package quoted</a>
          <a class="btn" href="<?= h(tel_href()) ?>" data-track="call">Talk to a producer</a>
        </div>
      </div>
<?php endforeach; ?>
    </div>
  </div>
</section>

<section class="section tight" id="standalone">
  <div class="container">
    <div class="section-head reveal">
      <div>
        <span class="eyebrow">Standalone services</span>
        <h2>Book exactly what you need</h2>
        <p>Each service is available on its own. Click through for specs, what's included and service-specific questions.</p>
      </div>
    </div>
    <div class="ref-grid">
<?php foreach ($p['standalone'] as $row): ?>
      <a class="ref-item reveal" href="<?= h(service_url($row['service'])) ?>">
        <b><?= h($row['name']) ?></b>
        <span class="ref-price"><?= h($row['range']) ?></span>
        <span><?= h($row['note']) ?></span>
      </a>
<?php endforeach; ?>
    </div>
  </div>
</section>

<section class="section" id="photo-booth">
  <div class="container">
    <div class="section-head reveal">
      <div>
        <span class="eyebrow">Photo booth tiers</span>
        <h2>Open-air photo booths from $550</h2>
        <p>Canon DSLR capture, professional attendants and a custom overlay on every tier. Prices cover active hours; add idle time if the booth must stay in place during dinner or speeches.</p>
      </div>
      <a class="btn" href="/services/photo-booth">Photo booth details <?= icon('arrow') ?></a>
    </div>
    <div class="grid grid-3">
<?php foreach ($p['booth_tiers'] as $t): ?>
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
    <h3 style="margin-top:28px">À la carte enhancements</h3>
    <div class="addons">
<?php foreach ($p['booth_addons'] as [$name, $price]): ?>
      <div class="addon reveal"><span><?= h($name) ?></span><b><?= h($price) ?></b></div>
<?php endforeach; ?>
    </div>
  </div>
</section>

<section class="section tight" id="policies">
  <div class="container">
    <div class="section-head reveal">
      <div><span class="eyebrow">Good to know</span><h2>Booking, overtime, travel and insurance</h2></div>
    </div>
    <div class="policies">
<?php foreach ($p['policies'] as [$label, $text]): ?>
      <div class="policy reveal"><b><?= h($label) ?></b><p><?= h($text) ?></p></div>
<?php endforeach; ?>
    </div>
  </div>
</section>

<section class="section">
  <div class="container two-col">
    <div class="reveal">
      <span class="eyebrow">FAQ</span>
      <h2>Pricing and policy questions</h2>
      <p class="muted">Everything else is on the <a href="/faq"><b>FAQ page</b></a>.</p>
    </div>
    <div class="reveal"><?= faq_list($bookingFaqs) ?></div>
  </div>
</section>

<section class="section tight">
  <div class="container">
    <div class="cta-band reveal">
      <div>
        <h2>Want an exact number for your event?</h2>
        <p>Send your date, venue and guest count. A written estimate follows within 1 business day.</p>
      </div>
      <div class="actions">
        <a class="btn btn-light btn-lg" href="/contact">Request a quote</a>
        <a class="btn btn-lg" href="<?= h(tel_href()) ?>" data-track="call"><?= icon('phone') ?> <?= h(PHONE_DISPLAY) ?></a>
      </div>
    </div>
  </div>
</section>
<?php page_end(); ?>
