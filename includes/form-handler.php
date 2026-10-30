<?php
// =============================================================
// Quote form handler — hardened against bots and advertising spam.
// Included by contact.php on POST. Redirects on completion (PRG).
// =============================================================
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

function fh_redirect(string $to): never { header('Location: ' . $to, true, 303); exit; }
function fh_fail(string $msg): never { fh_redirect('/contact?error=' . rawurlencode($msg) . '#quote'); }
function fh_log(string $file, string $line): void {
  @file_put_contents(log_dir() . '/' . $file, $line . "\n", FILE_APPEND | LOCK_EX);
}
function fh_ip(): string { return (string)($_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown'); }
function fh_clean(string $s, int $max): string {
  $s = str_replace(["\r", "\n", "\0"], ' ', $s);         // no header injection, ever
  $s = trim(preg_replace('/\s+/u', ' ', $s) ?? '');
  return mb_substr($s, 0, $max);
}
/** Silent drop: bots see a success page, nothing is sent. */
function fh_drop(string $reason, array $d): never {
  fh_log('blocked-spam.log', sprintf('[%s] %s | ip=%s | %s <%s> | %s', date('c'), $reason, fh_ip(), $d['name'] ?? '', $d['email'] ?? '', mb_substr($d['message'] ?? '', 0, 160)));
  fh_redirect('/thank-you');
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { fh_redirect('/contact'); }

// 1) Same-origin check (Origin or Referer must be our host when present)
$host = parse_url(SITE_URL, PHP_URL_HOST);
foreach (['HTTP_ORIGIN', 'HTTP_REFERER'] as $k) {
  if (!empty($_SERVER[$k])) {
    $h = (string)parse_url((string)$_SERVER[$k], PHP_URL_HOST);
    if ($h !== '' && !in_array($h, [$host, 'www.' . $host, 'localhost', '127.0.0.1'], true)) { fh_fail('Invalid request origin. Please reload the page and try again.'); }
  }
}

// 2) Gather
$d = [
  'name'    => fh_clean((string)($_POST['name'] ?? ''), 80),
  'email'   => mb_strtolower(fh_clean((string)($_POST['email'] ?? ''), 120)),
  'phone'   => fh_clean((string)($_POST['phone'] ?? ''), 40),
  'date'    => fh_clean((string)($_POST['date'] ?? ''), 20),
  'service' => fh_clean((string)($_POST['service'] ?? ''), 60),
  'budget'  => fh_clean((string)($_POST['budget'] ?? ''), 40),
  'guests'  => fh_clean((string)($_POST['guests'] ?? ''), 20),
  'venue'   => fh_clean((string)($_POST['venue'] ?? ''), 120),
  'message' => mb_substr(trim(str_replace("\0", '', (string)($_POST['message'] ?? ''))), 0, 3000),
  'page'    => fh_clean((string)($_POST['page'] ?? ''), 120),
];
$d['name'] = str_replace(['<', '>', '"'], '', $d['name']);

// 3) Validation (human-facing errors)
$errors = [];
if ($d['name'] === '' || mb_strlen($d['name']) < 2) $errors[] = 'Please enter your name.';
if ($d['email'] === '' || !filter_var($d['email'], FILTER_VALIDATE_EMAIL)) $errors[] = 'Please enter a valid email address.';
if ($d['service'] === '') $errors[] = 'Please select a service.';
if (preg_match('~https?://|www\.|\.(com|net|org|io|ru|cn|top|xyz)/~i', $d['message'])) $errors[] = 'Please remove web links from your message. Describe your event instead.';
if ($errors) fh_fail(implode(' ', $errors));

// 4) Signed token: must be at least FORM_MIN_SECONDS old and not expired
$tok = form_token_check((string)($_POST['form_token'] ?? ''));
if ($tok === 'too-fast') fh_drop('too-fast', $d);
if ($tok !== '') fh_fail('Your form session expired. Please reload the page and send again.');

// 5) Honeypot (hidden field a human never fills)
if (!empty($_POST['fax_line'])) fh_drop('honeypot', $d);

// 6) Optional Cloudflare Turnstile
if (TURNSTILE_SECRET !== '') {
  $resp = (string)($_POST['cf-turnstile-response'] ?? '');
  $ok = false;
  if ($resp !== '' && function_exists('curl_init')) {
    $ch = curl_init('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8,
      CURLOPT_POSTFIELDS => http_build_query(['secret' => TURNSTILE_SECRET, 'response' => $resp, 'remoteip' => fh_ip()])]);
    $json = json_decode((string)curl_exec($ch), true);
    curl_close($ch);
    $ok = !empty($json['success']);
  }
  if (!$ok) fh_fail('Please complete the verification and try again.');
}

// 7) Rate limit per IP (file-based, outside web root)
$rlDir = log_dir() . '/ratelimit';
@mkdir($rlDir, 0700, true);
$rlFile = $rlDir . '/' . hash('sha256', fh_ip()) . '.json';
$times = is_file($rlFile) ? (json_decode((string)@file_get_contents($rlFile), true) ?: []) : [];
$now = time();
$times = array_values(array_filter($times, fn($t) => is_int($t) && $t > $now - 86400));
$last15 = count(array_filter($times, fn($t) => $t > $now - 900));
if ($last15 >= RATE_LIMIT_15MIN || count($times) >= RATE_LIMIT_DAY) fh_fail('Too many requests from your connection. Please call us at ' . PHONE_DISPLAY . ' or try again later.');

// 8) Content heuristics: advertising / foreign-script spam is dropped silently
$blob = mb_strtolower($d['name'] . ' ' . $d['message'] . ' ' . $d['venue']);
foreach (SPAM_WORDS as $w) {
  if ($w !== '' && str_contains($blob, mb_strtolower($w))) fh_drop('keyword:' . $w, $d);
}
$letters = preg_match_all('/\p{L}/u', $d['message'] . $d['name']);
$cjk     = preg_match_all('/[\p{Han}\p{Hiragana}\p{Katakana}\p{Hangul}\p{Cyrillic}]/u', $d['message'] . $d['name']);
if ($letters > 0 && $cjk / $letters > 0.3) fh_drop('script-ratio', $d);
if (preg_match('/[A-Za-z]{25,}/', $d['name'])) fh_drop('name-gibberish', $d);
// Email domain must accept mail (catches throwaway bot domains)
$domain = substr(strrchr($d['email'], '@') ?: '', 1);
if ($domain !== '' && function_exists('checkdnsrr') && !checkdnsrr($domain, 'MX') && !checkdnsrr($domain, 'A')) fh_fail('That email domain does not seem to receive mail. Please check your email address.');

// 9) Build and send
$ip = fh_ip();
$ts = date('D, d M Y H:i:s T');
$lines = [
  '==============================================',
  ' NEXUS LIVE MEDIA — New Quote Request',
  '==============================================',
  '',
  'Name:             ' . $d['name'],
  'Email:            ' . $d['email'],
  'Phone:            ' . ($d['phone'] ?: '—'),
  'Event Date:       ' . ($d['date'] ?: '—'),
  'Primary Service:  ' . $d['service'],
  'Est. Budget:      ' . ($d['budget'] ?: '—'),
  'Guests:           ' . ($d['guests'] ?: '—'),
  'Venue / City:     ' . ($d['venue'] ?: '—'),
  '',
  '----------------------------------------------',
  'Event Details:',
  '----------------------------------------------',
  $d['message'] !== '' ? $d['message'] : '(no additional details provided)',
  '',
  '==============================================',
  'Reply directly to this email to contact ' . $d['name'] . '.',
  'Submitted: ' . $ts,
  'From page: ' . ($d['page'] ?: '/'),
  'IP: ' . $ip,
  '==============================================',
];
$subject = SUBJECT_PREFIX . ' (' . $d['service'] . ')';
$headers = implode("\r\n", [
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=UTF-8',
  'From: ' . SITE_NAME . ' <' . MAIL_FROM . '>',
  'Reply-To: ' . $d['name'] . ' <' . $d['email'] . '>',
]);
$body = implode("\n", $lines);
$ok1 = @mail(EMAIL_TO, $subject, $body, $headers, '-f' . MAIL_FROM);
$ok2 = EMAIL_CC !== '' ? @mail(EMAIL_CC, $subject, $body, $headers, '-f' . MAIL_FROM) : false;

if (!($ok1 || $ok2)) {
  fh_log('form-errors.log', sprintf('[%s] mail() failed | ip=%s | %s <%s>', date('c'), $ip, $d['name'], $d['email']));
  fh_fail('Your message could not be sent right now. Please call ' . PHONE_DISPLAY . ' or email ' . EMAIL_TO . '.');
}

// 10) Record, log, auto-reply, redirect
$times[] = $now;
@file_put_contents($rlFile, json_encode($times), LOCK_EX);
fh_log('submissions.log', sprintf('[%s] %s | %s | %s | %s | %s | ip=%s', date('c'), $d['name'], $d['email'], $d['phone'], $d['service'], $d['date'], $ip));

$autoBody = implode("\r\n", [
  'Hi ' . $d['name'] . ',',
  '',
  'Thank you for reaching out to Nexus Live Media.',
  '',
  'We received your quote request for: ' . $d['service'],
  ($d['date'] !== '' ? 'Event date: ' . $d['date'] : ''),
  '',
  'A member of our team will review your details and reply within 1 business day.',
  'Need a faster answer? Call or text ' . PHONE_DISPLAY . '.',
  '',
  '— Nexus Live Media',
  SITE_URL,
]);
@mail($d['email'], 'We received your request — Nexus Live Media', $autoBody,
  implode("\r\n", ['MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'From: ' . SITE_NAME . ' <' . MAIL_FROM . '>']), '-f' . MAIL_FROM);

fh_redirect('/thank-you?s=' . rawurlencode($d['service']));
