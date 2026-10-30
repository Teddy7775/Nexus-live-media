<?php
// Reusable quote form. Optional: $formService (preselect), $formCompact (bool), $formLang ('en'|'fr')
declare(strict_types=1);
$formService = $formService ?? '';
$formCompact = $formCompact ?? false;
$formLang    = $formLang ?? 'en';
$fr = $formLang === 'fr';
$error = isset($_GET['error']) ? (string)$_GET['error'] : '';
$serviceOptions = [
  'Live Video Production', 'Hybrid / Online Conferencing', 'Audio & Sound', 'LED Screen Rental', 'Photo Booth',
  'Media Coverage / Highlight Recap', 'Special Events Video', 'Printing / Branding', 'Full Package (Recommended)',
];
$budgets = ['Not sure yet', 'Under $1,000', '$1,000 – $3,000', '$3,000 – $5,000', '$5,000 – $8,000', '$8,000 – $12,000', '$12,000+'];
$t = $fr ? [
  'name' => 'Nom complet', 'email' => 'Email', 'phone' => 'Téléphone / WhatsApp', 'date' => 'Date de l’événement',
  'service' => 'Service principal', 'budget' => 'Budget estimé', 'guests' => 'Nombre d’invités', 'venue' => 'Lieu / ville',
  'message' => 'Parlez-nous de votre événement', 'ph_msg' => 'Type d’événement, lieu, horaires, nombre d’intervenants, plateforme de diffusion, besoins LED, quantités d’impression…',
  'select' => 'Choisir', 'send' => 'Envoyer ma demande', 'call' => 'Appeler', 'note' => 'Réponse sous 1 jour ouvré. Aucun spam, jamais de revente de vos données.',
] : [
  'name' => 'Full name', 'email' => 'Email', 'phone' => 'Phone / WhatsApp', 'date' => 'Event date',
  'service' => 'Primary service', 'budget' => 'Estimated budget', 'guests' => 'Guest count', 'venue' => 'Venue / city',
  'message' => 'Tell us about the event', 'ph_msg' => 'Event type, venue, start/end time, number of speakers, streaming platform, LED needs, printing quantities…',
  'select' => 'Select one', 'send' => 'Send request', 'call' => 'Call now', 'note' => 'We reply within 1 business day. No spam, and your details are never shared.',
];
?>
<form id="quoteForm" class="quote-form" method="post" action="/contact" novalidate>
  <input type="hidden" name="form_token" value="<?= h(form_token()) ?>">
  <input type="hidden" name="page" value="<?= h(current_path()) ?>">
  <div class="hp" aria-hidden="true">
    <label for="fax_line">Fax</label>
    <input id="fax_line" name="fax_line" type="text" tabindex="-1" autocomplete="off">
  </div>

  <div class="form-grid">
    <div>
      <label for="q-name"><?= $t['name'] ?></label>
      <input id="q-name" name="name" type="text" autocomplete="name" required maxlength="80">
    </div>
    <div>
      <label for="q-email"><?= $t['email'] ?></label>
      <input id="q-email" name="email" type="email" autocomplete="email" required maxlength="120" placeholder="you@company.com">
    </div>
    <div>
      <label for="q-phone"><?= $t['phone'] ?></label>
      <input id="q-phone" name="phone" type="tel" autocomplete="tel" maxlength="40" placeholder="+1 (___) ___-____">
    </div>
    <div>
      <label for="q-date"><?= $t['date'] ?></label>
      <input id="q-date" name="date" type="date">
    </div>
    <div>
      <label for="q-service"><?= $t['service'] ?></label>
      <select id="q-service" name="service" required>
        <option value="" <?= $formService === '' ? 'selected' : '' ?> disabled><?= $t['select'] ?></option>
<?php foreach ($serviceOptions as $opt): ?>
        <option<?= $opt === $formService ? ' selected' : '' ?>><?= h($opt) ?></option>
<?php endforeach; ?>
      </select>
    </div>
    <div>
      <label for="q-budget"><?= $t['budget'] ?></label>
      <select id="q-budget" name="budget">
<?php foreach ($budgets as $i => $b): ?>
        <option value="<?= $i === 0 ? '' : h($b) ?>"><?= h($b) ?></option>
<?php endforeach; ?>
      </select>
    </div>
<?php if (!$formCompact): ?>
    <div>
      <label for="q-guests"><?= $t['guests'] ?></label>
      <input id="q-guests" name="guests" type="text" inputmode="numeric" maxlength="20" placeholder="150">
    </div>
    <div>
      <label for="q-venue"><?= $t['venue'] ?></label>
      <input id="q-venue" name="venue" type="text" maxlength="120" placeholder="<?= $fr ? 'Hôtel, église, salle… et ville' : 'Hotel, church, hall… and city' ?>">
    </div>
<?php endif; ?>
    <div class="full">
      <label for="q-message"><?= $t['message'] ?></label>
      <textarea id="q-message" name="message" maxlength="3000" placeholder="<?= h($t['ph_msg']) ?>"></textarea>
    </div>
  </div>

<?php if (TURNSTILE_SITE_KEY !== ''): ?>
  <div class="cf-turnstile" data-sitekey="<?= h(TURNSTILE_SITE_KEY) ?>" data-theme="dark" style="margin-top:12px"></div>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<?php endif; ?>

  <div class="form-alert<?= $error !== '' ? ' show is-error' : '' ?>" role="alert" aria-live="assertive"><?= h($error) ?></div>

  <div class="form-actions">
    <button class="btn btn-primary btn-lg" type="submit"><?= $t['send'] ?> <?= icon('arrow') ?></button>
    <a class="btn btn-lg" href="<?= h(tel_href()) ?>" data-track="call"><?= icon('phone') ?> <?= $t['call'] ?></a>
  </div>
  <p class="form-note"><?= icon('shield', 'sm') ?> <?= $t['note'] ?></p>
</form>
