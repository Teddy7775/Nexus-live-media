<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/helpers.php';
http_response_code(404);
page_start([
  'title' => 'Page not found | Nexus Live Media',
  'desc'  => 'That page does not exist. Browse our event production services or request a quote.',
  'path'  => current_path(),
  'noindex' => true,
]);
?>
<section class="simple-page container">
  <div class="panel reveal in">
    <div class="icon-big"><?= icon('film') ?></div>
    <h1 style="font-size:2rem">That page went off air.</h1>
    <p class="muted" style="font-size:1.05rem">The link may be outdated. Here is where most people want to go:</p>
    <div class="hero-ctas" style="justify-content:center;margin-top:20px">
      <a class="btn btn-primary" href="/services">Our services</a>
      <a class="btn" href="/pricing">Pricing</a>
      <a class="btn" href="/contact">Get a quote</a>
    </div>
  </div>
</section>
<?php page_end(); ?>
