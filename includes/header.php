<?php
// Expects $meta from page_start(): title, desc, path, [og_image], [lang], [alternate], [noindex], [jsonld], [body_class]
declare(strict_types=1);
$lang      = $meta['lang'] ?? 'en';
$title     = $meta['title'];
$desc      = $meta['desc'];
$path      = $meta['path'] ?? current_path();
$canonical = site_url($path === '/' ? '' : ltrim($path, '/'));
$ogImage   = $meta['og_image'] ?? site_url('assets/img/og.jpg');
$noindex   = !empty($meta['noindex']);
$bodyClass = $meta['body_class'] ?? '';
$alternate = $meta['alternate'] ?? [];
$jsonlds   = $meta['jsonld'] ?? [];
$isFr      = $lang === 'fr';
$wa        = wa_href($isFr ? 'Bonjour Nexus Live Media, je souhaite un devis pour un événement.' : 'Hi Nexus Live Media, I would like a quote for an event.');
?>
<!doctype html>
<html lang="<?= h($lang) ?>">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title><?= h($title) ?></title>
  <meta name="description" content="<?= h($desc) ?>">
  <link rel="canonical" href="<?= h($canonical) ?>">
<?php if ($noindex): ?>
  <meta name="robots" content="noindex, nofollow">
<?php endif; ?>
<?php foreach ($alternate as $l => $p): ?>
  <link rel="alternate" hreflang="<?= h($l) ?>" href="<?= h(site_url($p === '/' ? '' : ltrim($p, '/'))) ?>">
<?php endforeach; ?>
<?php if ($alternate): ?>
  <link rel="alternate" hreflang="x-default" href="<?= h(site_url()) ?>">
<?php endif; ?>
  <meta name="theme-color" content="#070A16">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="<?= h(SITE_NAME) ?>">
  <meta property="og:locale" content="<?= $isFr ? 'fr_FR' : 'en_US' ?>">
  <meta property="og:title" content="<?= h($title) ?>">
  <meta property="og:description" content="<?= h($desc) ?>">
  <meta property="og:url" content="<?= h($canonical) ?>">
  <meta property="og:image" content="<?= h($ogImage) ?>">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="<?= h($title) ?>">
  <meta name="twitter:description" content="<?= h($desc) ?>">
  <meta name="twitter:image" content="<?= h($ogImage) ?>">
<?php if (GSC_VERIFICATION !== ''): ?>
  <meta name="google-site-verification" content="<?= h(GSC_VERIFICATION) ?>">
<?php endif; ?>
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="icon" href="/assets/img/favicon-192.png" type="image/png" sizes="192x192">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=swap">
  <link rel="stylesheet" href="<?= h(asset('assets/css/site.css')) ?>">
<?php if (GA_MEASUREMENT_ID !== ''): ?>
  <script async src="https://www.googletagmanager.com/gtag/js?id=<?= h(GA_MEASUREMENT_ID) ?>"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','<?= h(GA_MEASUREMENT_ID) ?>');</script>
<?php endif; ?>
  <?= jsonld(ld_localbusiness()) ?>
<?php foreach ($jsonlds as $ld): ?>
  <?= jsonld($ld) ?>
<?php endforeach; ?>
</head>
<body class="<?= h($bodyClass) ?>">
<a class="skip" href="#main"><?= $isFr ? 'Aller au contenu' : 'Skip to content' ?></a>

<header class="site-header" id="top">
  <div class="container header-inner">
    <a class="brand" href="/" aria-label="<?= h(SITE_NAME) ?> — home">
      <?= logo_svg() ?>
      <span class="brand-text"><b>Nexus Live Media</b><small><?= $isFr ? 'Votre événement. Sublimé.' : 'Your Event. Elevated.' ?></small></span>
    </a>

    <nav class="nav" id="nav" aria-label="Primary">
      <ul class="nav-list">
        <li class="has-sub<?= is_active('/services') ? ' active' : '' ?>">
          <a href="/services">Services</a>
          <button class="sub-toggle" type="button" aria-expanded="false" aria-label="Show services"><?= icon('chevron') ?></button>
          <ul class="sub">
<?php foreach (services() as $slug => $s): ?>
            <li><a href="<?= h(service_url($slug)) ?>"><?= icon($s['icon']) ?><span><?= h($s['short']) ?></span></a></li>
<?php endforeach; ?>
          </ul>
        </li>
        <li class="has-sub<?= is_active('/events') ? ' active' : '' ?>">
          <a href="/events">Events</a>
          <button class="sub-toggle" type="button" aria-expanded="false" aria-label="Show event types"><?= icon('chevron') ?></button>
          <ul class="sub">
<?php foreach (events() as $slug => $e): ?>
            <li><a href="<?= h(event_url($slug)) ?>"><span><?= h($e['short']) ?></span></a></li>
<?php endforeach; ?>
          </ul>
        </li>
        <li<?= is_active('/pricing') ? ' class="active"' : '' ?>><a href="/pricing">Pricing</a></li>
        <li<?= is_active('/about') ? ' class="active"' : '' ?>><a href="/about">About</a></li>
        <li<?= is_active('/faq') ? ' class="active"' : '' ?>><a href="/faq">FAQ</a></li>
        <li class="nav-fr<?= is_active('/fr') ? ' active' : '' ?>"><a href="/fr" lang="fr" hreflang="fr">Français</a></li>
        <li class="nav-mobile-only"><a class="btn btn-primary" href="/contact">Get a Quote</a></li>
        <li class="nav-mobile-only"><a class="btn btn-ghost" href="<?= h(tel_href()) ?>"><?= icon('phone') ?> <?= h(PHONE_DISPLAY) ?></a></li>
      </ul>
    </nav>

    <div class="header-actions">
      <a class="header-phone" href="<?= h(tel_href()) ?>" data-track="call"><?= icon('phone') ?><span><?= h(PHONE_DISPLAY) ?></span></a>
      <a class="btn btn-primary btn-sm" href="/contact"><?= $isFr ? 'Devis gratuit' : 'Get a Quote' ?></a>
      <button class="menu-toggle" type="button" aria-controls="nav" aria-expanded="false" aria-label="Open menu">
        <span class="ico-open"><?= icon('menu') ?></span><span class="ico-close"><?= icon('close') ?></span>
      </button>
    </div>
  </div>
</header>

<main id="main">
