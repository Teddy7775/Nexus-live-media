<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/helpers.php';
$all = faqs();
$cats = ['booking' => 'Booking & payment', 'production' => 'Production & technical', 'photo-booth' => 'Photo booth', 'delivery' => 'Delivery', 'policies' => 'Policies'];
$crumbs = ['Home' => '/', 'FAQ' => '/faq'];
page_start([
  'title' => 'Event Production FAQ | Nexus Live Media, Washington DC',
  'desc'  => 'Answers on booking terms, setup time, insurance and COIs, internet for live streaming, overtime, delivery times, weather policy, travel and custom merchandise deadlines.',
  'path'  => '/faq',
  'jsonld' => [ld_breadcrumb($crumbs), ld_faq($all)],
]);
?>
<section class="page-hero">
  <div class="container">
    <?= breadcrumbs($crumbs) ?>
    <div class="hero-content reveal in">
      <span class="eyebrow">FAQ</span>
      <h1>Questions planners ask <span class="gradient-text">before they book.</span></h1>
      <p class="lead">Plain answers on terms, timing, insurance, internet and delivery. If yours is not here, call <a href="<?= h(tel_href()) ?>" data-track="call"><b><?= h(PHONE_DISPLAY) ?></b></a>.</p>
    </div>
  </div>
</section>

<section class="section tight">
  <div class="container">
    <div class="faq-cats reveal">
<?php foreach ($cats as $k => $label): ?>
      <a class="btn btn-sm" href="#<?= h($k) ?>"><?= h($label) ?></a>
<?php endforeach; ?>
    </div>
<?php foreach ($cats as $k => $label): $items = array_values(array_filter($all, fn($f) => $f['cat'] === $k)); if (!$items) continue; ?>
    <div class="reveal" id="<?= h($k) ?>" style="margin-bottom:36px">
      <h2 style="font-size:1.4rem"><?= h($label) ?></h2>
      <?= faq_list($items) ?>
    </div>
<?php endforeach; ?>
  </div>
</section>

<section class="section tight">
  <div class="container">
    <div class="cta-band reveal">
      <div>
        <h2>Still have a question?</h2>
        <p>A producer will answer in minutes by phone or WhatsApp, or within 1 business day by email.</p>
      </div>
      <div class="actions">
        <a class="btn btn-light btn-lg" href="/contact">Ask us</a>
        <a class="btn btn-lg" href="<?= h(tel_href()) ?>" data-track="call"><?= icon('phone') ?> <?= h(PHONE_DISPLAY) ?></a>
      </div>
    </div>
  </div>
</section>
<?php page_end(); ?>
