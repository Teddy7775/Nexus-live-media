<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/helpers.php';
$service = isset($_GET['s']) ? mb_substr((string)$_GET['s'], 0, 60) : '';
page_start([
  'title' => 'Request received | Nexus Live Media',
  'desc'  => 'Thank you. We received your quote request and will reply within 1 business day.',
  'path'  => '/thank-you',
  'noindex' => true,
]);
?>
<section class="simple-page container">
  <div class="panel reveal in">
    <div class="icon-big"><?= icon('check') ?></div>
    <h1 style="font-size:2rem">Thank you. Your request is in.</h1>
    <p class="muted" style="font-size:1.05rem">
      <?= $service !== '' ? 'We received your request for <b>' . h($service) . '</b>. ' : 'We received your request. ' ?>
      A producer will reply within 1 business day with availability, options and a clear estimate. A confirmation email is on its way to you.
    </p>
    <p class="muted">Need something faster? Call or text <a href="<?= h(tel_href()) ?>" data-track="call"><b><?= h(PHONE_DISPLAY) ?></b></a>.</p>
    <div class="hero-ctas" style="justify-content:center;margin-top:20px">
      <a class="btn btn-primary" href="/pricing">See packages &amp; pricing</a>
      <a class="btn" href="/">Back to home</a>
    </div>
  </div>
</section>
<?php if (GA_MEASUREMENT_ID !== ''): ?>
<script>window.addEventListener('load',function(){if(typeof gtag==='function'){gtag('event','generate_lead',{method:'quote_form',service:<?= json_encode($service) ?>});}});</script>
<?php endif; ?>
<?php page_end(); ?>
