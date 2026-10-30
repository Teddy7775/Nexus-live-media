<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/helpers.php';
$crumbs = ['Home' => '/', 'About' => '/about'];
page_start([
  'title' => 'About Nexus Live Media | Event Production Crew in Washington DC',
  'desc'  => 'Nexus Live Media is a Washington DC event production company (US AFRIK MEDIA LLC) delivering live video, hybrid conferencing, LED walls, audio, photo booths and branding across DC, Maryland and Virginia.',
  'path'  => '/about',
  'og_image' => image_url('about/crew'),
  'jsonld' => [ld_breadcrumb($crumbs)],
]);
?>
<section class="page-hero">
  <div class="hero-media"><?= picture('about/crew', 'Nexus Live Media production crew setting up cameras and an LED wall', ['widths' => [800, 1600], 'sizes' => '100vw', 'loading' => 'eager', 'priority' => true]) ?></div>
  <div class="container">
    <?= breadcrumbs($crumbs) ?>
    <div class="hero-content reveal in">
      <span class="eyebrow">About us</span>
      <h1>A production crew that treats every event <span class="gradient-text">like a broadcast.</span></h1>
      <p class="lead">Nexus Live Media is the event production division of US AFRIK MEDIA LLC, based in Washington, DC. We bring the cameras, the LED wall, the audio, the photo booth and the branding, and one producer who owns the whole show.</p>
    </div>
  </div>
</section>

<section class="section">
  <div class="container two-col">
    <div class="prose reveal">
      <span class="eyebrow">What we believe</span>
      <h2>Organizers should only have to worry about their guests.</h2>
      <p>Most event-day stress comes from vendors who do not talk to each other: the AV company blames the venue Wi-Fi, the photo booth arrives during the keynote, the printer missed the sizing chart. We built Nexus Live Media to remove that friction. One contract, one load-in plan, one lead on site, and every department rehearsed against the same run-of-show.</p>
      <p>That is why we carry our own bonded cellular internet instead of relying on venue networks, why we send certificates of insurance to your venue without being asked, and why your recordings, photos and highlight reels arrive on a published schedule instead of “when they are ready.”</p>
      <p>We serve corporate and government teams, universities and schools, churches and faith communities, wedding couples and the cultural associations that make the DMV what it is. Many of our clients are planning an event for a community that spans continents, so we design every stream to be watched easily on a phone, anywhere in the world.</p>
    </div>
    <aside class="reveal">
      <div class="panel">
        <h3>At a glance</h3>
        <ul class="checks">
          <li><?= icon('check') ?> Based in Washington, DC; serving DC, Maryland and Virginia with nationwide travel</li>
          <li><?= icon('check') ?> Live video, hybrid conferencing, audio, LED walls, photo booths, media coverage and printing</li>
          <li><?= icon('check') ?> $2,000,000 general liability; COIs issued free to venues and clients</li>
          <li><?= icon('check') ?> Bonded multi-carrier cellular internet on every stream</li>
          <li><?= icon('check') ?> Photos in 48 h, stream masters in 24–48 h, 4K reels in 5–7 business days</li>
          <li><?= icon('check') ?> English and French-speaking crew</li>
        </ul>
        <a class="btn btn-primary btn-block mt" href="/contact">Work with us</a>
      </div>
    </aside>
  </div>
</section>

<section class="section tight">
  <div class="container">
    <div class="section-head reveal">
      <div><span class="eyebrow">How we work</span><h2>Four commitments on every job</h2></div>
    </div>
    <div class="grid grid-4">
      <div class="feature reveal"><span class="feature-icon"><?= icon('calendar') ?></span><div><h3>Planned, not improvised</h3><p>Technical walkthrough, run-of-show and a timing sheet shared with your venue before show day.</p></div></div>
      <div class="feature reveal"><span class="feature-icon"><?= icon('zap') ?></span><div><h3>Redundant by default</h3><p>Backup recorders, spare cameras and mics, bonded internet and ISO records of every feed.</p></div></div>
      <div class="feature reveal"><span class="feature-icon"><?= icon('users') ?></span><div><h3>One lead on site</h3><p>A producer who knows your agenda, your speakers and your venue contact by name.</p></div></div>
      <div class="feature reveal"><span class="feature-icon"><?= icon('clock') ?></span><div><h3>Delivered on schedule</h3><p>Published turnaround times for every deliverable, in writing, before you book.</p></div></div>
    </div>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="section-head reveal">
      <div><span class="eyebrow">Services</span><h2>What we bring to your event</h2></div>
      <a class="btn" href="/services">All services <?= icon('arrow') ?></a>
    </div>
    <div class="grid grid-4">
<?php foreach (array_slice(services(), 0, 4, true) as $slug => $s): ?>
      <?= service_card($slug, $s) ?>
<?php endforeach; ?>
    </div>
  </div>
</section>

<section class="section tight">
  <div class="container">
    <div class="cta-band reveal">
      <div>
        <h2>Let's talk about your event.</h2>
        <p>Call, WhatsApp or send a few details and we will come back with availability and a clear estimate.</p>
      </div>
      <div class="actions">
        <a class="btn btn-light btn-lg" href="/contact">Request a quote</a>
        <a class="btn btn-lg" href="<?= h(tel_href()) ?>" data-track="call"><?= icon('phone') ?> <?= h(PHONE_DISPLAY) ?></a>
      </div>
    </div>
  </div>
</section>
<?php page_end(); ?>
