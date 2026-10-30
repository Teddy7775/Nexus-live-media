<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/helpers.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
  require __DIR__ . '/includes/form-handler.php';
  exit;
}

$formService = isset($_GET['service']) ? (string)$_GET['service'] : '';
$wa = wa_href('Hi Nexus Live Media, I would like a quote for an event.');

page_start([
  'title' => 'Request a Quote | Nexus Live Media — Washington DC Event Production',
  'desc'  => 'Tell us about your event and get a clear estimate within 1 business day. Live video, hybrid conferencing, LED walls, audio, photo booths and printing across DC, Maryland and Virginia.',
  'path'  => '/contact',
  'jsonld' => [ld_breadcrumb(['Home' => '/', 'Contact' => '/contact'])],
]);
?>
<section class="page-hero">
  <div class="container">
    <?= breadcrumbs(['Home' => '/', 'Contact' => '/contact']) ?>
    <div class="hero-content">
      <span class="eyebrow">Get a quote</span>
      <h1>Tell us about your event. <span class="gradient-text">We reply within 1 business day.</span></h1>
      <p class="lead">Share your date, venue and what you need. You will get availability, options and a clear estimate, not a sales pitch. Prefer to talk? Call or WhatsApp us directly.</p>
    </div>
  </div>
</section>

<section class="section tight" id="quote">
  <div class="container contact-grid">
    <div class="panel reveal">
      <h2 style="font-size:1.5rem">Event details</h2>
      <?php require __DIR__ . '/includes/quote-form.php'; ?>
    </div>

    <aside class="contact-card reveal">
      <div class="contact-item">
        <span class="feature-icon"><?= icon('phone') ?></span>
        <div><b>Call or text</b><a href="<?= h(tel_href()) ?>" data-track="call"><?= h(PHONE_DISPLAY) ?></a></div>
      </div>
<?php if ($wa !== ''): ?>
      <div class="contact-item">
        <span class="feature-icon"><?= icon('whatsapp') ?></span>
        <div><b>WhatsApp</b><a href="<?= h($wa) ?>" target="_blank" rel="noopener" data-track="whatsapp">Message us on WhatsApp</a></div>
      </div>
<?php endif; ?>
      <div class="contact-item">
        <span class="feature-icon"><?= icon('mail') ?></span>
        <div><b>Email</b><a href="<?= h(mail_href()) ?>" data-track="email"><?= h(EMAIL_TO) ?></a></div>
      </div>
      <div class="contact-item">
        <span class="feature-icon"><?= icon('pin') ?></span>
        <div><b>Service area</b><span><?= h(SERVICE_AREA) ?><br>Free travel within 35 miles of DC · nationwide on request</span></div>
      </div>
      <div class="contact-item">
        <span class="feature-icon"><?= icon('clock') ?></span>
        <div><b>Hours</b><span>7 days a week, 8am – 10pm<br>Event-day support around the clock</span></div>
      </div>
      <div class="panel">
        <h3 style="font-size:1.05rem">What happens next</h3>
        <ol class="checks" style="list-style:none">
          <li><?= icon('check') ?> We confirm your date is available.</li>
          <li><?= icon('check') ?> A producer calls to scope venue, audience and platform.</li>
          <li><?= icon('check') ?> You receive a written estimate and a run-of-show outline.</li>
          <li><?= icon('check') ?> A 30% retainer locks the date. Balance is due 14 days before.</li>
        </ol>
      </div>
    </aside>
  </div>
</section>
<?php page_end(); ?>
