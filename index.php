<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/helpers.php';

$services = services();
$events   = events();
$pricing  = pricing();
$homeFaqs = array_slice(array_values(array_filter(faqs(), fn($f) => in_array($f['cat'], ['booking', 'production'], true))), 0, 5);

page_start([
  'title' => 'Live Event Production in Washington DC | Nexus Live Media',
  'desc'  => 'Broadcast-quality live streaming, hybrid conferencing, pro audio, LED wall rental, open-air photo booths and event branding for conferences, graduations, churches and weddings across DC, Maryland and Virginia.',
  'path'  => '/',
  'alternate' => ['en' => '/', 'fr' => '/fr'],
  'jsonld' => [ld_faq($homeFaqs)],
  'body_class' => 'home',
]);
?>
<!-- HERO -->
<section class="hero">
  <div class="hero-media"><?= picture('hero', 'Live event production in a Washington DC ballroom: LED video wall, PTZ broadcast cameras and a video switcher', ['widths' => [800, 1280, 1920], 'sizes' => '100vw', 'loading' => 'eager', 'priority' => true]) ?></div>
  <div class="container">
    <div class="hero-content reveal in">
      <span class="eyebrow">Washington DC · Maryland · Virginia</span>
      <h1>Live events that look <span class="gradient-text">premium</span>, run smoothly, and reach every screen.</h1>
      <p class="lead">Multi-camera live streaming, hybrid conferencing, pro audio, LED video walls, open-air photo booths and event branding, delivered by one crew under one contract.</p>
      <div class="hero-ctas">
        <a class="btn btn-primary btn-lg" href="/contact">Get a free quote <?= icon('arrow') ?></a>
        <a class="btn btn-lg" href="/pricing">See packages &amp; pricing</a>
      </div>
      <div class="trust">
        <span><?= icon('shield') ?> $2M liability, free COIs</span>
        <span><?= icon('wifi') ?> Bonded cellular, never venue Wi-Fi</span>
        <span><?= icon('clock') ?> Photos in 48 h, reels in 5–7 days</span>
        <span><?= icon('layers') ?> One vendor for video, LED, audio, booth &amp; print</span>
      </div>
    </div>
  </div>
</section>

<!-- SERVICES -->
<section class="section" id="services">
  <div class="container">
    <div class="section-head reveal">
      <div>
        <span class="eyebrow">Services</span>
        <h2>Everything your event needs, from one crew</h2>
        <p>Book a single service or bundle them into a complete production. Every line below has a dedicated page with specs, pricing and answers.</p>
      </div>
      <a class="btn" href="/services">All services <?= icon('arrow') ?></a>
    </div>
    <div class="grid grid-4">
<?php foreach ($services as $slug => $s): ?>
      <?= service_card($slug, $s) ?>
<?php endforeach; ?>
    </div>
  </div>
</section>

<!-- EVENTS -->
<section class="section tight" id="events">
  <div class="container">
    <div class="section-head reveal">
      <div>
        <span class="eyebrow">Who we serve</span>
        <h2>Built for your kind of event</h2>
        <p>Corporate town halls, commencements, worship services, weddings and cultural galas each need a different run-of-show. We plan for yours.</p>
      </div>
      <a class="btn" href="/events">Browse event types <?= icon('arrow') ?></a>
    </div>
    <div class="grid grid-5">
<?php foreach ($events as $slug => $e): ?>
      <?= event_card($slug, $e) ?>
<?php endforeach; ?>
    </div>
  </div>
</section>

<!-- WHY -->
<section class="section" id="why">
  <div class="container two-col">
    <div class="reveal">
      <span class="eyebrow">Why Nexus Live Media</span>
      <h2>We run your event like a broadcast, not like a webcam.</h2>
      <p class="muted" style="font-size:1.05rem">Clean audio, stable video and a crew that has planned every transition before doors open. Organizers get one point of contact; audiences in the room and online get the same polished experience.</p>
      <div class="grid" style="gap:18px;margin-top:26px">
        <div class="feature">
          <span class="feature-icon"><?= icon('camera') ?></span>
          <div><h3>Broadcast-level quality</h3><p>Multi-camera switching, lower-thirds, slides and remote speakers integrated live. Recordings and ISOs delivered within 24–48 hours.</p></div>
        </div>
        <div class="feature">
          <span class="feature-icon"><?= icon('wifi') ?></span>
          <div><h3>Redundancy you can count on</h3><p>Bonded multi-carrier cellular internet, backup recorders and spare gear on site. We never depend on venue Wi-Fi.</p></div>
        </div>
        <div class="feature">
          <span class="feature-icon"><?= icon('users') ?></span>
          <div><h3>Planning and on-site coordination</h3><p>Pre-event technical walkthrough, run-of-show support and a lead producer who stays with you from load-in to the last cue.</p></div>
        </div>
        <div class="feature">
          <span class="feature-icon"><?= icon('shield') ?></span>
          <div><h3>Venue-ready paperwork</h3><p>$2,000,000 general liability with certificates of insurance naming your venue, issued at no charge.</p></div>
        </div>
      </div>
    </div>
    <div class="media-rounded reveal"><?= picture('about/crew', 'Nexus Live Media crew setting up an LED wall and cabling before a conference', ['widths' => [800, 1600], 'sizes' => '(max-width: 1024px) 100vw, 45vw']) ?></div>
  </div>
</section>

<!-- PACKAGES -->
<section class="section" id="packages">
  <div class="container">
    <div class="section-head reveal">
      <div>
        <span class="eyebrow">Packages</span>
        <h2>Turnkey productions at bundle pricing</h2>
        <p>Our most-booked combinations, priced below the sum of their parts. 2026–2027 rates. Every package is a starting point; final quotes depend on venue, duration and complexity.</p>
      </div>
      <a class="btn" href="/pricing">Full rate card <?= icon('arrow') ?></a>
    </div>
    <div class="grid grid-3 pricing">
<?php foreach ($pricing['packages'] as $p): ?>
      <div class="price-card reveal<?= $p['featured'] ? ' featured' : '' ?>">
        <div class="price-top"><span class="label"><?= h($p['label']) ?></span><span class="savings"><?= h($p['savings']) ?></span></div>
        <h3><?= h($p['name']) ?></h3>
        <div class="price"><span><?= h($p['price']) ?></span><small><?= h($p['price_note']) ?></small></div>
        <span class="guests"><?= h($p['guests']) ?></span>
        <p class="price-desc"><?= h($p['desc']) ?></p>
        <ul class="checks">
<?php foreach ($p['features'] as $f): ?>
          <li><?= icon('check') ?> <?= h($f) ?></li>
<?php endforeach; ?>
        </ul>
        <div class="price-actions">
          <a class="btn btn-primary" href="/contact?service=<?= rawurlencode('Full Package (Recommended)') ?>">Get this package quoted</a>
          <a class="btn" href="/pricing#<?= h($p['slug']) ?>">What's included</a>
        </div>
      </div>
<?php endforeach; ?>
    </div>
  </div>
</section>

<!-- PHOTO BOOTH -->
<section class="section tight" id="photo-booth">
  <div class="container">
    <div class="section-head reveal">
      <div>
        <span class="eyebrow">Photo booth experiences</span>
        <h2>Open-air photo booths from $550</h2>
        <p>Canon DSLR hardware, instant dye-sub prints, GIFs and boomerangs, custom overlays and attendants who keep the line moving.</p>
      </div>
      <a class="btn" href="/services/photo-booth">Photo booth details <?= icon('arrow') ?></a>
    </div>
    <div class="grid grid-3">
<?php foreach ($pricing['booth_tiers'] as $t): ?>
      <div class="tier reveal<?= $t['featured'] ? ' featured' : '' ?>">
        <span class="label"><?= h($t['label']) ?></span>
        <h3><?= h($t['name']) ?></h3>
        <div class="price"><span><?= h($t['price']) ?></span><small>/ <?= h($t['hours']) ?></small></div>
        <p class="desc"><?= h($t['desc']) ?></p>
        <ul class="checks">
<?php foreach (array_slice($t['features'], 0, 4) as $f): ?>
          <li><?= icon('check') ?> <?= h($f) ?></li>
<?php endforeach; ?>
        </ul>
        <a class="btn <?= $t['featured'] ? 'btn-primary' : '' ?> btn-block" href="/contact?service=Photo%20Booth">Reserve <?= h($t['name']) ?></a>
      </div>
<?php endforeach; ?>
    </div>
  </div>
</section>

<!-- PROCESS -->
<section class="section" id="process">
  <div class="container">
    <div class="section-head center reveal">
      <div>
        <span class="eyebrow">How it works</span>
        <h2>From first call to final delivery</h2>
        <p>A clear, four-step process so you always know what happens next.</p>
      </div>
    </div>
    <div class="steps">
      <div class="step reveal"><h3>Tell us about the event</h3><p>Date, venue, audience size and what you need. We confirm availability within 1 business day.</p></div>
      <div class="step reveal"><h3>Scope and estimate</h3><p>A producer walks through the venue plan, platform and run-of-show, then sends a written estimate.</p></div>
      <div class="step reveal"><h3>Lock the date</h3><p>A 30% retainer secures the crew and gear. We handle COIs, tech rehearsals and timing with your venue.</p></div>
      <div class="step reveal"><h3>Show day and delivery</h3><p>We load in 3–4 hours before doors, run the show, and deliver recordings, photos and reels on schedule.</p></div>
    </div>
  </div>
</section>

<!-- TESTIMONIALS -->
<section class="section tight" aria-label="Client feedback">
  <div class="container">
    <div class="section-head reveal">
      <div>
        <span class="eyebrow">Client feedback</span>
        <h2>What organizers say</h2>
      </div>
    </div>
    <div class="grid grid-3">
<?php foreach (testimonials() as $t): ?>
      <div class="quote reveal">
        <div class="stars" aria-label="5 out of 5"><?= str_repeat(icon('star'), 5) ?></div>
        <p>“<?= h($t['quote']) ?>”</p>
        <div class="who"><span class="avatar" aria-hidden="true"></span><div><b><?= h($t['who']) ?></b><?= h($t['event']) ?></div></div>
      </div>
<?php endforeach; ?>
    </div>
  </div>
</section>

<!-- FAQ -->
<section class="section" id="faq">
  <div class="container two-col">
    <div class="reveal">
      <span class="eyebrow">FAQ</span>
      <h2>Questions planners ask before booking</h2>
      <p class="muted">Booking terms, setup times, insurance, internet and delivery, answered plainly.</p>
      <a class="btn mt" href="/faq">Read all answers <?= icon('arrow') ?></a>
    </div>
    <div class="reveal"><?= faq_list($homeFaqs) ?></div>
  </div>
</section>

<!-- CTA + FORM -->
<section class="section" id="quote">
  <div class="container">
    <div class="cta-band reveal" style="margin-bottom:24px">
      <div>
        <h2>Ready to plan your event?</h2>
        <p>Send the basics below and get availability, options and a clear estimate within 1 business day. Prefer to talk? Call or WhatsApp <?= h(PHONE_DISPLAY) ?>.</p>
      </div>
      <div class="actions">
        <a class="btn btn-light btn-lg" href="<?= h(tel_href()) ?>" data-track="call"><?= icon('phone') ?> Call now</a>
<?php if (wa_href() !== ''): ?>
        <a class="btn btn-lg" href="<?= h(wa_href('Hi Nexus Live Media, I would like a quote for an event.')) ?>" target="_blank" rel="noopener" data-track="whatsapp"><?= icon('whatsapp') ?> WhatsApp</a>
<?php endif; ?>
      </div>
    </div>
    <div class="contact-grid">
      <div class="panel reveal">
        <h3 style="font-size:1.4rem">Request a quote</h3>
        <?php $formCompact = true; require __DIR__ . '/includes/quote-form.php'; ?>
      </div>
      <aside class="reveal">
        <div class="panel" lang="fr">
          <span class="eyebrow">Communauté francophone</span>
          <h3>Vous parlez français ?</h3>
          <p class="muted">Mariages, dots, graduations, cultes, galas d’associations : une équipe qui parle votre langue à Washington DC, dans le Maryland et en Virginie. Vos proches restés au pays suivent en direct.</p>
          <a class="btn btn-primary" href="/fr" hreflang="fr">Voir la page en français <?= icon('arrow') ?></a>
        </div>
        <div class="panel mt">
          <h3 style="font-size:1.05rem">Service area</h3>
          <p class="muted" style="margin:0">Washington DC, Maryland and Virginia, including Arlington, Alexandria, Bethesda, Silver Spring, Tysons and National Harbor. Free travel within 35 miles of DC; nationwide on request.</p>
        </div>
      </aside>
    </div>
  </div>
</section>
<?php page_end(); ?>
