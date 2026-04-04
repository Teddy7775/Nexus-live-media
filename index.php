<?php
// =========================
// Nexus Live Media - Single file site with PHP contact form
// File: public_html/index.php
// =========================

declare(strict_types=1);

// Session settings applied in PHP (works with Apache mod_php AND PHP-FPM)
// Note: cookie_secure is intentionally OFF here — the .htaccess 301 redirect
// ensures the user is always on HTTPS before the form loads; forcing secure
// cookies at session_start would break sessions on initial HTTP access.
session_start([
  'cookie_httponly' => true,
  'use_strict_mode' => true,
]);

// ---- CONFIG ----
$SITE_URL       = "https://nexuslivemedia.com/";
$BUSINESS_EMAIL = "executive@nexuslivemedia.com";
$CC_EMAIL       = "theonana@nexuslivemedia.com";
$BUSINESS_PHONE = "+1 (202) 243-8880";
$MAIL_FROM      = "no-reply@nexuslivemedia.com";
$SUBJECT_PREFIX = "Quote Request — Nexus Live Media";

// ---- Helper ----
function h(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
function clean(string $s): string { return trim(preg_replace('/\s+/', ' ', $s)); }

// ---- CSRF token generation ----
if (empty($_SESSION['csrf_token'])) {
  $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

// ---- Form handling (POST -> send email -> redirect) ----
if ($_SERVER['REQUEST_METHOD'] === 'POST') {

  // CSRF validation — only blocks if a session token actually exists AND mismatches.
  // If the session is empty (e.g. first load, cookie issue), we fall through safely;
  // the honeypot and server-side validation still protect the endpoint.
  $csrfPost = $_POST['csrf_token'] ?? '';
  $csrfSess = $_SESSION['csrf_token'] ?? '';
  if ($csrfSess !== '' && !hash_equals($csrfSess, $csrfPost)) {
    $err = rawurlencode("Invalid security token. Please refresh the page and try again.");
    header("Location: {$SITE_URL}?error={$err}#contact");
    exit;
  }

  // Rate limiting (session-based): max 3 submissions per 10 minutes
  $_SESSION['submit_times'] = array_values(array_filter(
    $_SESSION['submit_times'] ?? [],
    fn($t) => $t > (time() - 600)
  ));
  if (count($_SESSION['submit_times']) >= 3) {
    $err = rawurlencode("Too many requests. Please wait a few minutes before trying again.");
    header("Location: {$SITE_URL}?error={$err}#contact");
    exit;
  }

  // Basic anti-bot honeypot
  $company = $_POST['company'] ?? '';
  if (!empty($company)) {
    header("Location: {$SITE_URL}?sent=1#contact");
    exit;
  }

  // Gather + validate
  $name    = clean((string)($_POST['name'] ?? ''));
  $email   = clean((string)($_POST['email'] ?? ''));
  $phone   = clean((string)($_POST['phone'] ?? ''));
  $date    = clean((string)($_POST['date'] ?? ''));
  $service = clean((string)($_POST['service'] ?? ''));
  $budget  = clean((string)($_POST['budget'] ?? ''));
  $message = trim((string)($_POST['message'] ?? ''));

  $errors = [];
  if ($name === '') $errors[] = "Please enter your name.";
  if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) $errors[] = "Please enter a valid email.";
  if ($service === '') $errors[] = "Please select a service.";

  if (!empty($errors)) {
    $err = rawurlencode(implode(' ', $errors));
    header("Location: {$SITE_URL}?error={$err}#contact");
    exit;
  }

  // ── Build HTML email body (simple HTML — no multipart, no quoted-printable)
  // Using plain HTML is the most reliable approach with PHP mail() on shared hosting.
  $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
  $ts = date('D, d M Y H:i:s T');

  $htmlFields = [
    ['Name',              h($name)],
    ['Email',             '<a href="mailto:' . h($email) . '" style="color:#7C3AED">' . h($email) . '</a>'],
    ['Phone',             h($phone ?: '—')],
    ['Event Date',        h($date ?: '—')],
    ['Primary Service',   '<strong>' . h($service) . '</strong>'],
    ['Estimated Budget',  h($budget ?: '—')],
  ];
  $tableRows = '';
  foreach ($htmlFields as [$label, $value]) {
    $tableRows .= "<tr>"
      . "<td style='padding:10px 16px;background:#f0f4ff;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#7C3AED;white-space:nowrap;vertical-align:top;border-bottom:1px solid #e2e8f0'>{$label}</td>"
      . "<td style='padding:10px 16px;font-size:14px;color:#1e293b;border-bottom:1px solid #e2e8f0'>{$value}</td>"
      . "</tr>\n";
  }
  $msgText = nl2br(h($message !== '' ? $message : '(no additional details provided)'));
  $replyLink = 'mailto:' . rawurlencode($name) . ' <' . rawurlencode($email) . '>';

  $htmlBody = "<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'>"
    . "<title>Quote Request</title></head>"
    . "<body style='margin:0;padding:0;background:#f8faff;font-family:Arial,sans-serif'>"
    . "<table width='100%' cellpadding='0' cellspacing='0' style='background:#f8faff;padding:24px 0'>"
    . "<tr><td align='center'>"
    . "<table width='600' cellpadding='0' cellspacing='0' style='max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)'>"
    . "<tr><td style='background:linear-gradient(135deg,#7C3AED,#22D3EE);padding:24px 28px'>"
    . "<p style='margin:0;color:rgba(255,255,255,.8);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px'>Nexus Live Media</p>"
    . "<h1 style='margin:6px 0 4px;color:#fff;font-size:20px;font-weight:900'>New Quote Request</h1>"
    . "<p style='margin:0;color:rgba(255,255,255,.8);font-size:13px'>Service: <strong style='color:#fff'>" . h($service) . "</strong></p>"
    . "</td></tr>"
    . "<tr><td style='padding:24px 28px'>"
    . "<table width='100%' cellpadding='0' cellspacing='0' style='border-radius:8px;overflow:hidden;border:1px solid #e2e8f0'>"
    . $tableRows
    . "</table>"
    . "<p style='margin:18px 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#7C3AED'>Event Details</p>"
    . "<div style='background:#f8faff;border-left:3px solid #7C3AED;padding:12px 16px;border-radius:0 6px 6px 0;font-size:14px;color:#334155;line-height:1.65'>{$msgText}</div>"
    . "<p style='margin:20px 0 0'><a href='mailto:" . h($email) . "' style='display:inline-block;background:linear-gradient(135deg,#7C3AED,#22D3EE);color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:700;font-size:14px'>Reply to " . h($name) . " →</a></p>"
    . "</td></tr>"
    . "<tr><td style='background:#f8faff;padding:12px 28px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8'>"
    . "Submitted: {$ts} &nbsp;·&nbsp; IP: {$ip} &nbsp;·&nbsp; nexuslivemedia.com"
    . "</td></tr>"
    . "</table></td></tr></table></body></html>";

  $subject = "{$SUBJECT_PREFIX} ({$service})";

  // ── Send to business (HTML only — reliable on shared hosting) ──────────
  $headers = implode("\r\n", [
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "From: Nexus Live Media <{$MAIL_FROM}>",
    "Reply-To: {$name} <{$email}>",
    "Cc: {$CC_EMAIL}",
    "X-Mailer: PHP/" . phpversion(),
  ]);

  $ok = @mail($BUSINESS_EMAIL, $subject, $htmlBody, $headers);

  if ($ok) {
    // Record submission time for rate limiting
    $_SESSION['submit_times'][] = time();
    // Regenerate CSRF token after successful use
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));

    // ── Auto-reply to the client ──────────────────────────────────────────
    $autoSubject = "We received your request — Nexus Live Media";
    $autoBody    = implode("\r\n", [
      "Hi {$name},",
      "",
      "Thank you for reaching out to Nexus Live Media!",
      "",
      "We received your quote request for: {$service}",
      "",
      "A member of our team will review your details and get back to you",
      "within 1 business day.",
      "",
      "In the meantime, feel free to call us at +1 (202) 243-8880.",
      "",
      "— Nexus Live Media Team",
      "nexuslivemedia.com",
    ]);
    $autoHeaders = implode("\r\n", [
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "From: Nexus Live Media <{$MAIL_FROM}>",
      "X-Mailer: PHP/" . phpversion(),
    ]);
    @mail($email, $autoSubject, $autoBody, $autoHeaders);
    // ─────────────────────────────────────────────────────────────────────

    // Submission log — stored one level ABOVE public_html (never web-accessible).
    // dirname(__DIR__) = parent of the folder containing this file.
    // On Hostinger: /home/u123456789/public_html/index.php
    //   __DIR__        = /home/u123456789/public_html
    //   dirname(__DIR__)= /home/u123456789          ← outside web root
    $logPath = dirname(__DIR__) . '/submissions.log';
    $logLine = sprintf(
      "[%s] %s | %s | %s | %s | %s\n",
      date('c'),
      $name,
      $email,
      $service,
      $budget,
      $ip
    );
    try {
      file_put_contents($logPath, $logLine, FILE_APPEND | LOCK_EX);
    } catch (\Throwable $e) {
      // Log failure is non-fatal — form still succeeds
    }

    header("Location: {$SITE_URL}?sent=1#contact");
    exit;
  } else {
    $err = rawurlencode("Message could not be sent (server mail not configured).");
    header("Location: {$SITE_URL}?error={$err}#contact");
    exit;
  }
}

// Read any status from redirect (PRG pattern)
$sent  = isset($_GET['sent']) && $_GET['sent'] === '1';
$error = isset($_GET['error']) ? (string)$_GET['error'] : '';
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Nexus Live Media — Live Video Production • Hybrid Events • LED Screen Rental</title>
  <meta name="description" content="Professional live video production, hybrid & online conferencing, audio conferencing, LED screen rental, special events coverage, and event printing & branding." />
  <meta name="theme-color" content="#0B1020" />

  <!-- Canonical / Social (EDIT SITE URL + OG IMAGE) -->
  <link rel="canonical" href="<?=h($SITE_URL)?>" />
  <meta property="og:title" content="Nexus Live Media — Live Video • Hybrid Events • LED Screens" />
  <meta property="og:description" content="Broadcast-quality live event production and hybrid conferencing. LED video walls. Professional audio. Event printing & branding." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="<?=h($SITE_URL)?>" />
  <meta property="og:image" content="<?=h($SITE_URL)?>og.jpg" />
  <meta name="twitter:card" content="summary_large_image" />

  <link rel="icon" href="/favicon.ico">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">

  <style>
    :root{
      --bg: #070A16;
      --bg2:#0B1020;
      --text:#EAF0FF;
      --muted:#A9B5DD;
      --line:rgba(255,255,255,.10);
      --shadow: 0 20px 60px rgba(0,0,0,.45);
      --shadow2: 0 12px 30px rgba(0,0,0,.35);

      --accent1:#7C3AED;
      --accent2:#22D3EE;
      --accent3:#F59E0B;
      --accent4:#34D399;

      --radius: 18px;
      --radius2: 26px;
      --max: 1160px;
      --ease: cubic-bezier(.2,.9,.2,1);

      --topbar-h: 54px;
      --header-gap: 10px;
    }
    *{box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{
      margin:0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Apple Color Emoji","Segoe UI Emoji";
      color:var(--text);
      background:
        radial-gradient(1200px 700px at 20% -10%, rgba(124,58,237,.40), transparent 55%),
        radial-gradient(900px 600px at 90% 0%, rgba(34,211,238,.25), transparent 52%),
        radial-gradient(900px 700px at 70% 90%, rgba(245,158,11,.18), transparent 50%),
        linear-gradient(180deg, var(--bg), var(--bg2));
      overflow-x:hidden;
    }
    a{color:inherit;text-decoration:none}
    img{max-width:100%;display:block}
    .container{width:min(var(--max), 92vw); margin:0 auto}

    .skip{
      position:absolute; left:-999px; top:10px;
      background:rgba(11,16,32,.95);
      border:1px solid rgba(255,255,255,.18);
      color:var(--text);
      padding:10px 12px;
      border-radius:12px;
      font-weight:900;
      z-index: 10000;
    }
    .skip:focus{left:10px}

    .topbar{
      position:sticky; top:0; z-index:9999;
      height: var(--topbar-h);
      display:flex; align-items:center;
      backdrop-filter:saturate(160%) blur(14px);
      background: rgba(7,10,22,.55);
      border-bottom:1px solid var(--line);
    }
    .topbar-inner{
      display:flex; align-items:center; justify-content:space-between;
      gap:14px; width:100%;
      font-size:14px; color:var(--muted);
    }
    .pill{
      display:inline-flex; align-items:center; gap:8px;
      border:1px solid var(--line);
      padding:6px 10px; border-radius:999px;
      background:rgba(255,255,255,.03);
    }
    .dot{
      width:10px;height:10px;border-radius:50%;
      background: linear-gradient(135deg, var(--accent2), var(--accent1));
      box-shadow:0 0 0 3px rgba(34,211,238,.15);
    }

    header{
      position:sticky;
      top: calc(var(--topbar-h) + var(--header-gap));
      z-index:9998
    }
    .nav{
      margin:10px auto 0;
      border:1px solid var(--line);
      background: rgba(11,16,32,.55);
      backdrop-filter:saturate(160%) blur(14px);
      border-radius:999px;
      box-shadow: 0 10px 40px rgba(0,0,0,.35);
    }
    .nav-inner{
      display:flex; align-items:center; justify-content:space-between;
      gap:10px; padding:10px 14px;
    }
    .brand{display:flex; align-items:center; gap:10px; padding:6px 10px; border-radius:999px;}
    .logo{
      width:34px;height:34px;border-radius:12px;
      background:
        radial-gradient(10px 10px at 30% 30%, rgba(255,255,255,.65), transparent 60%),
        linear-gradient(135deg, var(--accent1), var(--accent2));
      box-shadow: 0 14px 30px rgba(124,58,237,.22), 0 10px 22px rgba(34,211,238,.18);
    }
    .brand b{letter-spacing:.3px}
    .nav-links{display:flex; align-items:center; gap:8px; flex-wrap:wrap;}
    .nav-links a{
      padding:9px 12px; border-radius:999px;
      color:var(--muted); border:1px solid transparent;
      transition: .2s var(--ease);
      font-weight:600; font-size:14px;
    }
    .nav-links a:hover{color:var(--text); border-color:rgba(255,255,255,.14); background:rgba(255,255,255,.03);}
    .actions{display:flex; align-items:center; gap:10px;}
    .btn{
      display:inline-flex; align-items:center; justify-content:center; gap:10px;
      padding:10px 14px; border-radius:999px;
      border:1px solid rgba(255,255,255,.14);
      background:rgba(255,255,255,.03);
      color:var(--text);
      font-weight:700; font-size:14px;
      transition:.25s var(--ease);
      cursor:pointer; user-select:none; white-space:nowrap;
    }
    .btn:hover{transform:translateY(-1px); background:rgba(255,255,255,.06)}
    .btn.primary{
      border:none;
      background: linear-gradient(135deg, var(--accent1), var(--accent2));
      box-shadow: 0 14px 30px rgba(124,58,237,.22), 0 10px 22px rgba(34,211,238,.18);
    }
    .btn.primary:hover{filter:brightness(1.03)}
    .btn.small{padding:8px 11px;font-size:13px}
    .hamburger{display:none}

    .hero{padding:84px 0 38px; position:relative;}
    .hero-grid{display:grid; grid-template-columns: 1.2fr .8fr; gap:28px; align-items:stretch;}
    .kicker{display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:16px;}
    .kicker .tag{
      display:inline-flex; align-items:center; gap:8px;
      padding:8px 12px; border-radius:999px;
      background:rgba(255,255,255,.04);
      border:1px solid rgba(255,255,255,.12);
      color:var(--muted);
      font-weight:700; font-size:13px;
    }
    .hero h1{
      font-size: clamp(34px, 4.2vw, 56px);
      line-height: 1.02;
      margin:0 0 14px;
      letter-spacing:-.7px;
    }
    .gradient-text{
      background: linear-gradient(135deg, #ffffff 0%, #c7d2fe 35%, rgba(34,211,238,.95) 65%, rgba(124,58,237,.95) 100%);
      -webkit-background-clip:text;background-clip:text;color:transparent;
    }
    .hero p{color:var(--muted); font-size:16px; line-height:1.6; margin:0 0 22px; max-width:58ch;}
    .hero-ctas{display:flex; gap:12px; flex-wrap:wrap; margin-bottom:18px;}
    .hero-badges{display:flex; gap:10px; flex-wrap:wrap; margin-top:8px; color:var(--muted); font-size:13px;}
    .badge{display:inline-flex; gap:8px; align-items:center; padding:8px 10px; border-radius:999px; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.03);}

    .hero-card{
      border-radius: var(--radius2);
      border:1px solid rgba(255,255,255,.12);
      background:
        radial-gradient(700px 320px at 20% 20%, rgba(34,211,238,.18), transparent 60%),
        radial-gradient(700px 420px at 80% 30%, rgba(124,58,237,.22), transparent 60%),
        linear-gradient(180deg, rgba(15,23,51,.65), rgba(15,23,51,.35));
      box-shadow: var(--shadow);
      padding:18px;
      display:flex; flex-direction:column; gap:14px;
      overflow:hidden;
      position:relative;
    }
    .hero-card::before{
      content:"";
      position:absolute; inset:-2px;
      background: linear-gradient(135deg, rgba(34,211,238,.45), rgba(124,58,237,.35), rgba(245,158,11,.25));
      filter: blur(18px);
      opacity:.25; z-index:0;
    }
    .hero-card > *{position:relative; z-index:1}
    .stat-grid{display:grid; grid-template-columns: repeat(2,1fr); gap:12px;}
    .stat{
      padding:14px; border-radius:16px;
      border:1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.03);
      box-shadow: var(--shadow2);
    }
    .stat b{font-size:20px}
    .stat span{display:block; color:var(--muted); font-size:12px; margin-top:6px}
    .mini-list{
      display:grid; gap:10px;
      padding:14px; border-radius:16px;
      border:1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.03);
    }
    .mini-item{display:flex; align-items:flex-start; gap:10px; color:var(--muted); font-size:13px; line-height:1.45;}
    .check{
      width:18px; height:18px; border-radius:6px;
      background: linear-gradient(135deg, var(--accent4), var(--accent2));
      display:inline-flex; align-items:center; justify-content:center;
      flex:0 0 auto;
      margin-top:1px;
    }
    .check svg{width:12px;height:12px}

    section{padding:46px 0}
    .section-head{
      display:flex; align-items:flex-end; justify-content:space-between;
      gap:16px; flex-wrap:wrap;
      margin-bottom:18px;
    }
    .section-head h2{margin:0; font-size: clamp(24px, 2.4vw, 34px); letter-spacing:-.4px;}
    .section-head p{margin:0; color:var(--muted); max-width:62ch; line-height:1.55; font-size:14px;}

    .grid{display:grid; grid-template-columns: repeat(12, 1fr); gap:14px;}
    .card{
      grid-column: span 4;
      border-radius: var(--radius);
      border:1px solid rgba(255,255,255,.12);
      background: linear-gradient(180deg, rgba(16,27,63,.70), rgba(16,27,63,.35));
      box-shadow: var(--shadow2);
      padding:16px;
      overflow:hidden;
      position:relative;
      transition: .25s var(--ease);
    }
    .card:hover{transform: translateY(-3px)}
    .card::after{
      content:"";
      position:absolute; inset:-1px;
      background: radial-gradient(600px 200px at 20% 0%, rgba(34,211,238,.18), transparent 60%),
                  radial-gradient(600px 200px at 80% 20%, rgba(124,58,237,.18), transparent 60%);
      opacity:.7; z-index:0; pointer-events:none;
    }
    .card > *{position:relative; z-index:1}
    .icon{
      width:44px;height:44px;border-radius:16px;
      display:flex;align-items:center;justify-content:center;
      background: rgba(255,255,255,.06);
      border:1px solid rgba(255,255,255,.12);
      margin-bottom:12px;
    }
    .icon svg{width:22px;height:22px}
    .card h3{margin:0 0 8px; font-size:16px; letter-spacing:-.2px}
    .card p{margin:0 0 14px; color:var(--muted); font-size:13px; line-height:1.55}
    .card a.more{
      display:inline-flex; align-items:center; gap:8px;
      color:#DDE6FF;
      font-weight:800; font-size:13px;
      padding:8px 10px;
      border-radius:999px;
      border:1px solid rgba(255,255,255,.12);
      background:rgba(255,255,255,.03);
    }
    .card a.more:hover{background:rgba(255,255,255,.06)}
    .card ul{margin:0; padding-left:16px; color:var(--muted); font-size:13px; line-height:1.55;}

    .split{display:grid; grid-template-columns: 1fr 1fr; gap:18px; align-items:stretch;}
    .panel{
      border-radius: var(--radius2);
      border:1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.03);
      box-shadow: var(--shadow2);
      padding:18px;
      position:relative;
      overflow:hidden;
    }
    .panel::before{
      content:"";
      position:absolute; inset:-2px;
      background: radial-gradient(800px 350px at 20% 10%, rgba(245,158,11,.16), transparent 60%),
                  radial-gradient(700px 350px at 80% 10%, rgba(34,211,238,.16), transparent 60%);
      z-index:0; opacity:.8;
    }
    .panel > *{position:relative; z-index:1}
    .panel h3{margin:0 0 8px; font-size:18px}
    .panel p{margin:0 0 14px; color:var(--muted); line-height:1.6; font-size:14px}
    .bullets{display:grid; gap:10px; margin-top:14px;}
    .bullet{display:flex; gap:10px; align-items:flex-start; color:var(--muted); font-size:13px; line-height:1.55;}
    .bullet .spark{
      width:18px;height:18px;border-radius:7px;
      background: linear-gradient(135deg, var(--accent3), var(--accent1));
      flex:0 0 auto; margin-top:1px;
    }

    .pricing{align-items:stretch}
    .price-card{
      grid-column: span 4;
      border-radius: var(--radius2);
      border:1px solid rgba(255,255,255,.12);
      background: linear-gradient(180deg, rgba(15,23,51,.70), rgba(15,23,51,.35));
      box-shadow: var(--shadow);
      padding:18px;
      position:relative;
      overflow:hidden;
      display:flex; flex-direction:column; gap:12px;
      transition:.25s var(--ease);
    }
    .price-card:hover{transform: translateY(-3px)}
    .price-card.featured{
      border-color: rgba(34,211,238,.45);
      box-shadow: 0 18px 70px rgba(34,211,238,.18), 0 18px 70px rgba(124,58,237,.14);
      background:
        radial-gradient(600px 260px at 20% 0%, rgba(34,211,238,.16), transparent 60%),
        radial-gradient(700px 300px at 80% 0%, rgba(124,58,237,.20), transparent 60%),
        linear-gradient(180deg, rgba(16,27,63,.75), rgba(16,27,63,.35));
    }
    .price-top{display:flex; align-items:center; justify-content:space-between; gap:10px}
    .price-top .label{
      display:inline-flex; align-items:center; gap:8px;
      padding:6px 10px;border-radius:999px;
      border:1px solid rgba(255,255,255,.14);
      background:rgba(255,255,255,.03);
      color:var(--muted);
      font-weight:800;font-size:12px;
    }
    .price{font-size:34px; letter-spacing:-.5px; margin:0;}
    .price small{font-size:12px; color: var(--muted); font-weight:800}
    .price-desc{color:var(--muted); margin:0; line-height:1.6; font-size:14px}
    .features{display:grid; gap:10px; margin:6px 0 0; padding:0; list-style:none}
    .features li{display:flex; gap:10px; align-items:flex-start; color:var(--muted); font-size:13px; line-height:1.5}
    .features li .tick{
      width:18px;height:18px;border-radius:7px;
      background: rgba(255,255,255,.06);
      border:1px solid rgba(255,255,255,.12);
      display:flex; align-items:center; justify-content:center;
      flex:0 0 auto; margin-top:1px;
    }
    .features li .tick svg{width:12px;height:12px}
    .price-actions{margin-top:auto; display:flex; gap:10px; flex-wrap:wrap}

    .quote{grid-column: span 4; border-radius: var(--radius2); border:1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.03); box-shadow: var(--shadow2); padding:18px;}
    .quote p{margin:0 0 14px; color:var(--text); line-height:1.65}
    .quote .who{display:flex; align-items:center; gap:12px; color:var(--muted); font-size:13px}
    .avatar{width:42px;height:42px;border-radius:16px; background: linear-gradient(135deg, rgba(34,211,238,.55), rgba(124,58,237,.55)); border:1px solid rgba(255,255,255,.18);}

    .faq{display:grid; gap:10px;}
    details{border-radius: 16px; border:1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.03); padding: 12px 14px; box-shadow: var(--shadow2);}
    summary{cursor:pointer; list-style:none; display:flex; align-items:center; justify-content:space-between; gap:10px; font-weight:900; letter-spacing:-.2px;}
    summary::-webkit-details-marker{display:none}
    details p{color:var(--muted); line-height:1.65; margin:10px 0 0; font-size:14px;}
    .chev{width:34px;height:34px;border-radius:14px; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.03); display:flex; align-items:center; justify-content:center; transition:.2s var(--ease); flex:0 0 auto;}
    details[open] .chev{transform:rotate(180deg); background:rgba(255,255,255,.06)}

    .contact{display:grid; grid-template-columns: 1.05fr .95fr; gap:18px; align-items:stretch;}
    form{display:grid; gap:12px;}
    label{font-size:12px; color:var(--muted); font-weight:900; letter-spacing:.5px; text-transform:uppercase}
    input, select, textarea{
      width:100%; padding:12px 12px; border-radius:14px;
      border:1px solid rgba(255,255,255,.14);
      background: rgba(7,10,22,.45);
      color: var(--text);
      outline:none; transition:.2s var(--ease);
      font-size:14px;
    }
    input:focus, select:focus, textarea:focus{border-color: rgba(34,211,238,.55); box-shadow: 0 0 0 4px rgba(34,211,238,.12);}
    textarea{min-height:120px; resize:vertical}
    .form-row{display:grid; grid-template-columns: 1fr 1fr; gap:12px;}
    .note{color:var(--muted); font-size:13px; line-height:1.6; margin-top: 10px;}
    .contact-card{display:grid; gap:10px;}
    .contact-item{
      display:flex; gap:12px; align-items:flex-start;
      padding:14px; border-radius:16px;
      border:1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.03);
      box-shadow: var(--shadow2);
    }
    .contact-item b{display:block}
    .contact-item span{color:var(--muted); font-size:13px; line-height:1.5}
    .mini-icon{
      width:40px;height:40px;border-radius:16px;
      border:1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.05);
      display:flex; align-items:center; justify-content:center;
      flex:0 0 auto;
    }
    .mini-icon svg{width:18px;height:18px}

    footer{padding:40px 0 50px; border-top:1px solid var(--line); margin-top: 30px; background: rgba(0,0,0,.08);}
    .foot{display:grid; gap:16px; grid-template-columns: 1.3fr .7fr .7fr; align-items:start;}
    .foot p{color:var(--muted); line-height:1.6; margin:10px 0 0; max-width:58ch}
    .foot h4{margin:0 0 10px}
    .foot a{color:var(--muted); display:block; padding:6px 0; font-weight:700}
    .foot a:hover{color:var(--text)}
    .copy{
      margin-top: 18px; color: var(--muted); font-size: 12px;
      display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px;
      border-top:1px solid rgba(255,255,255,.08); padding-top:14px;
    }

    .float-cta{position:fixed; right:18px; bottom:18px; z-index:9999; display:flex; flex-direction:column; gap:10px;}
    .float-cta .btn{box-shadow: var(--shadow2)}
    .toast{
      position:fixed; left:50%; bottom:18px; transform: translateX(-50%);
      background: rgba(11,16,32,.75);
      border:1px solid rgba(255,255,255,.14);
      padding:10px 12px; border-radius:14px;
      backdrop-filter: blur(12px);
      box-shadow: var(--shadow2);
      color:var(--text); font-weight:800; font-size:13px;
      opacity:0; pointer-events:none;
      transition:.25s var(--ease);
      z-index: 9999;
    }
    .toast.show{opacity:1; transform: translateX(-50%) translateY(-6px)}

    .reveal{opacity:0; transform: translateY(16px); transition: .7s var(--ease);}
    .reveal.show{opacity:1; transform:none;}

    @media (prefers-reduced-motion: reduce){
      html{scroll-behavior:auto}
      .reveal{transition:none; transform:none; opacity:1;}
      .btn{transition:none}
    }
    @supports not (backdrop-filter: blur(1px)){
      .topbar, .nav, .toast{ background: rgba(11,16,32,.92); }
    }
    @media (max-width: 980px){
      .hero-grid{grid-template-columns: 1fr; }
      .contact{grid-template-columns: 1fr}
      .split{grid-template-columns: 1fr}
      .card{grid-column: span 6}
      .pricing .price-card{grid-column: span 6}
      .quote{grid-column: span 6}
    }
    @media (max-width: 640px){
      .nav{border-radius: 22px}
      .nav-inner{flex-wrap:wrap}
      .nav-links{display:none; width:100%}
      .nav-links.open{display:flex}
      .hamburger{display:inline-flex}
      .card{grid-column: span 12}
      .pricing .price-card{grid-column: span 12}
      .quote{grid-column: span 12}
      .form-row{grid-template-columns: 1fr}
      .foot{grid-template-columns: 1fr}
      .topbar-inner .pill:last-child{display:none;}
      :root{ --topbar-h: 52px; }
    }
  </style>

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": "Nexus Live Media",
    "description": "Live video production, hybrid & online conferencing, audio conferencing, LED screen rental, special events video, and printing & event branding services.",
    "areaServed": "DMV Area (DC, Maryland, Virginia)",
    "url": "<?=h($SITE_URL)?>",
    "telephone": "<?=h($BUSINESS_PHONE)?>",
    "email": "<?=h($BUSINESS_EMAIL)?>",
    "priceRange": "$$",
    "image": "<?=h($SITE_URL)?>logo.png",
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "Washington",
      "addressRegion": "DC",
      "addressCountry": "US"
    }
  }
  </script>
</head>

<body>
  <a href="#home" class="skip">Skip to content</a>

  <div class="topbar" role="region" aria-label="Announcement">
    <div class="container topbar-inner">
      <div class="pill"><span class="dot"></span><b style="color:var(--text)">Now booking</b>&nbsp;— Live • Hybrid • LED • Print</div>
      <div class="pill">📍 DMV Area • Nationwide travel available</div>
    </div>
  </div>

  <header class="container">
    <nav class="nav" aria-label="Primary navigation">
      <div class="nav-inner">
        <a class="brand" href="#home" aria-label="Go to top">
          <span class="logo" aria-hidden="true"></span>
          <div>
            <b>Nexus Live Media</b><br/>
            <span style="color:var(--muted); font-size:12px; font-weight:800;">Live • Hybrid • Broadcast</span>
          </div>
        </a>

        <button class="btn small hamburger" id="hamburger" aria-label="Open menu" aria-expanded="false" aria-controls="navlinks">☰ Menu</button>

        <div class="nav-links" id="navlinks">
          <a href="#services">Services</a>
          <a href="#packages">Packages</a>
          <a href="#why">Why Us</a>
          <a href="#work">Use Cases</a>
          <a href="#faq">FAQ</a>
          <a href="#contact">Contact</a>
        </div>

        <div class="actions">
          <a class="btn" href="#contact">Request a Quote</a>
          <a class="btn primary" href="#contact">Book a Consultation</a>
        </div>
      </div>
    </nav>
  </header>

  <main id="home" class="hero">
    <div class="container hero-grid">
      <div class="reveal">
        <div class="kicker">
          <span class="tag">🎥 Broadcast-quality production</span>
          <span class="tag">🌐 Hybrid + Online conferencing</span>
          <span class="tag">🖥️ Giant LED screens</span>
          <span class="tag">🖨️ Printing & branding</span>
        </div>

        <h1>
          Live events that look <span class="gradient-text">premium</span>, feel effortless, and reach the world.
        </h1>

        <p>
          We design, produce, and broadcast high-impact events with professional video, audio, LED display, and branding.
          From conferences and graduations to worship services and celebrations—your audience gets a smooth, polished experience.
        </p>

        <div class="hero-ctas">
          <a class="btn primary" href="#contact">Get a Fast Quote</a>
          <a class="btn" href="#services">Explore Services</a>
        </div>

        <div class="hero-badges">
          <span class="badge">✅ Multi-camera • Live switching</span>
          <span class="badge">✅ Zoom/Teams/Webex production</span>
          <span class="badge">✅ LED wall + stage visuals</span>
          <span class="badge">✅ Branded merch & signage</span>
        </div>
      </div>

      <aside class="hero-card reveal" style="transition-delay:.08s" aria-label="Highlights">
        <div class="stat-grid">
          <div class="stat"><b>Live + Hybrid</b><span>In-room energy + online reach</span></div>
          <div class="stat"><b>Broadcast Quality</b><span>Polished visuals & clean audio</span></div>
          <div class="stat"><b>LED + Visuals</b><span>Big impact on any stage</span></div>
          <div class="stat"><b>Branding</b><span>Print + merch for full experience</span></div>
        </div>

        <div class="mini-list">
          <div class="mini-item">
            <span class="check" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            Redundancy-minded setups for reliable streaming.
          </div>
          <div class="mini-item">
            <span class="check" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            Clear pre-event planning, run-of-show support, and on-site coordination.
          </div>
          <div class="mini-item">
            <span class="check" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            One vendor for video, audio, LED, and event branding.
          </div>
        </div>

        <a class="btn primary" href="#contact" style="width:100%">Check Availability</a>
      </aside>
    </div>
  </main>

  <!-- SERVICES -->
  <section id="services">
    <div class="container">
      <div class="section-head reveal">
        <div>
          <h2>Services built for modern events</h2>
          <p>Pick exactly what you need—or let us bundle everything into a complete production.</p>
        </div>
        <a class="btn" href="#packages">See Packages →</a>
      </div>

      <div class="grid">
        <article class="card reveal">
          <div class="icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M4 7h10a2 2 0 0 1 2 2v8H6a2 2 0 0 1-2-2V7Z" stroke="white" stroke-width="2" opacity=".9"/>
              <path d="M16 10l4-2v8l-4-2v-4Z" fill="white" opacity=".85"/>
            </svg>
          </div>
          <h3>Live Video Production</h3>
          <p>Multi-camera coverage, live switching, directing, and professional recording for events of any size.</p>
          <ul>
            <li>Multi-cam + live switching</li>
            <li>Streaming + recording</li>
            <li>Graphics & lower-thirds</li>
          </ul>
          <div style="margin-top:12px"><a class="more" href="#contact">Request quote →</a></div>
        </article>

        <article class="card reveal" style="transition-delay:.05s">
          <div class="icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M8 12h8" stroke="white" stroke-width="2" stroke-linecap="round"/>
              <path d="M12 8v8" stroke="white" stroke-width="2" stroke-linecap="round"/>
              <path d="M4 6h16v12H4z" stroke="white" stroke-width="2" opacity=".9"/>
            </svg>
          </div>
          <h3>Hybrid & Online Conferencing</h3>
          <p>Zoom/Teams/Webex production with remote speakers, moderation, screen share, and secure access.</p>
          <ul>
            <li>Virtual event hosting</li>
            <li>Remote speaker integration</li>
            <li>Tech support for attendees</li>
          </ul>
          <div style="margin-top:12px"><a class="more" href="#contact">Book consult →</a></div>
        </article>

        <article class="card reveal" style="transition-delay:.10s">
          <div class="icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" stroke="white" stroke-width="2"/>
              <path d="M7 11a5 5 0 0 0 10 0" stroke="white" stroke-width="2" stroke-linecap="round"/>
              <path d="M12 16v5" stroke="white" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </div>
          <h3>Audio Conferencing & Sound</h3>
          <p>Clear microphones, mixers, and conference sound—perfect for panels, forums, and multilingual events.</p>
          <ul>
            <li>Wireless mic systems</li>
            <li>Mixing + monitoring</li>
            <li>Interpretation-ready setup</li>
          </ul>
          <div style="margin-top:12px"><a class="more" href="#contact">Ask about audio →</a></div>
        </article>

        <article class="card reveal">
          <div class="icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M4 6h16v12H4z" stroke="white" stroke-width="2"/>
              <path d="M7 9h10v6H7z" fill="white" opacity=".15"/>
              <path d="M2 18h20" stroke="white" stroke-width="2" opacity=".7"/>
            </svg>
          </div>
          <h3>Giant LED Screen Rental</h3>
          <p>Indoor/outdoor LED video walls for stage backdrops, presentations, and live feed display.</p>
          <ul>
            <li>Install + operation</li>
            <li>Live feed + slides</li>
            <li>Brand visuals</li>
          </ul>
          <div style="margin-top:12px"><a class="more" href="#contact">LED pricing →</a></div>
        </article>

        <article class="card reveal" style="transition-delay:.05s">
          <div class="icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M21 8v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8" stroke="white" stroke-width="2"/>
              <path d="M7 8l5-5 5 5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <h3>Special Events Video</h3>
          <p>Weddings, graduations, ceremonies, and celebrations—live and recorded with care and precision.</p>
          <ul>
            <li>Live stream + recording</li>
            <li>Highlight edits</li>
            <li>Private links available</li>
          </ul>
          <div style="margin-top:12px"><a class="more" href="#contact">Check date →</a></div>
        </article>

        <article class="card reveal" style="transition-delay:.10s">
          <div class="icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M6 9V4h12v5" stroke="white" stroke-width="2" opacity=".9"/>
              <path d="M6 18h12v2H6z" fill="white" opacity=".15"/>
              <path d="M7 10h10l1 8H6l1-8Z" stroke="white" stroke-width="2"/>
            </svg>
          </div>
          <h3>Printing & Event Branding</h3>
          <p>Custom apparel, cups, graduation stoles, badges, banners, and signage to complete your event.</p>
          <ul>
            <li>T-shirts, polos, hoodies</li>
            <li>Mugs/cups, merch</li>
            <li>Stoles + event signage</li>
          </ul>
          <div style="margin-top:12px"><a class="more" href="#contact">Get print quote →</a></div>
        </article>
      </div>
    </div>
  </section>

  <!-- WHY / VALUE -->
  <section id="why">
    <div class="container">
      <div class="section-head reveal">
        <div>
          <h2>Why clients choose Nexus Live Media</h2>
          <p>We don’t just “stream.” We run your event like a production—with planning, professionalism, and reliable execution.</p>
        </div>
      </div>

      <div class="split">
        <div class="panel reveal">
          <h3>Broadcast-level quality</h3>
          <p>Clean audio, stable video, professional camera work, and consistent visuals—so your brand looks sharp on every screen.</p>
          <div class="bullets">
            <div class="bullet"><span class="spark"></span>Multi-camera setups with live switching</div>
            <div class="bullet"><span class="spark"></span>Graphics, titles, and presentation integration</div>
            <div class="bullet"><span class="spark"></span>Recording + post-event delivery options</div>
          </div>
        </div>

        <div class="panel reveal" style="transition-delay:.06s">
          <h3>Reliable, end-to-end support</h3>
          <p>We provide the crew, the gear, and the run-of-show coordination—reducing stress for organizers and speakers.</p>
          <div class="bullets">
            <div class="bullet"><span class="spark"></span>Pre-event planning + technical rehearsal</div>
            <div class="bullet"><span class="spark"></span>On-site and online attendee support</div>
            <div class="bullet"><span class="spark"></span>LED walls + audio + printing under one vendor</div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- USE CASES -->
  <section id="work">
    <div class="container">
      <div class="section-head reveal">
        <div>
          <h2>Perfect for these events</h2>
          <p>Conferences. Graduations. Worship services. Corporate meetings. Weddings. Cultural celebrations.</p>
        </div>
        <a class="btn" href="#contact">Tell us about your event →</a>
      </div>

      <div class="grid">
        <div class="card reveal">
          <h3>Corporate & Government</h3>
          <p>Meetings, press events, trainings, town halls, hybrid summits.</p>
          <a class="more" href="#contact">Plan corporate event →</a>
        </div>
        <div class="card reveal" style="transition-delay:.05s">
          <h3>Education</h3>
          <p>Graduations, commencements, lectures, school ceremonies, sports banquets.</p>
          <a class="more" href="#contact">Plan graduation →</a>
        </div>
        <div class="card reveal" style="transition-delay:.10s">
          <h3>Faith & Community</h3>
          <p>Services, conferences, conventions, community forums, cultural nights.</p>
          <a class="more" href="#contact">Plan community event →</a>
        </div>
      </div>
    </div>
  </section>

  <!-- PACKAGES / PRICING -->
  <section id="packages">
    <div class="container">
      <div class="section-head reveal">
        <div>
          <h2>Packages that fit your event</h2>
          <p>Transparent starting points. Custom quotes available for large-scale productions and LED wall builds.</p>
        </div>
      </div>

      <div class="grid pricing">
        <div class="price-card reveal">
          <div class="price-top">
            <span class="label">Basic Live</span>
            <span class="label">Best for small events</span>
          </div>
          <h3 style="margin:0">Basic Live Package</h3>
          <p class="price"><span>$1,200</span> <small>starting</small></p>
          <p class="price-desc">Professional live stream with clean audio and reliable delivery.</p>
          <ul class="features">
            <li><span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span> 1–2 cameras</li>
            <li><span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span> Live streaming setup</li>
            <li><span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span> Basic audio support</li>
          </ul>
          <div class="price-actions">
            <a class="btn primary" href="#contact">Get quote</a>
            <a class="btn" href="#contact">Ask availability</a>
          </div>
        </div>

        <div class="price-card featured reveal" style="transition-delay:.06s">
          <div class="price-top">
            <span class="label">Most Popular</span>
            <span class="label">Hybrid-ready</span>
          </div>
          <h3 style="margin:0">Professional Hybrid Package</h3>
          <p class="price"><span>$2,800</span> <small>starting</small></p>
          <p class="price-desc">Multi-camera production with streaming + recording + professional conferencing.</p>
          <ul class="features">
            <li><span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span> Multi-camera live switching</li>
            <li><span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span> Zoom/Teams/Webex production</li>
            <li><span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span> Recording + clean audio</li>
            <li><span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span> Titles/graphics</li>
          </ul>
          <div class="price-actions">
            <a class="btn primary" href="#contact">Book consult</a>
            <a class="btn" href="#contact">Get package quote</a>
          </div>
        </div>

        <div class="price-card reveal" style="transition-delay:.12s">
          <div class="price-top">
            <span class="label">Premium</span>
            <span class="label">Big stage impact</span>
          </div>
          <h3 style="margin:0">Signature Event Package</h3>
          <p class="price"><span>$5,500</span> <small>starting</small></p>
          <p class="price-desc">Full production + LED screen + branding options for high-end events.</p>
          <ul class="features">
            <li><span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span> Full broadcast production</li>
            <li><span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span> Giant LED screen rental</li>
            <li><span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span> Pro audio + redundancy plan</li>
            <li><span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span> Branding/printing starter pack</li>
          </ul>
          <div class="price-actions">
            <a class="btn primary" href="#contact">Request premium quote</a>
            <a class="btn" href="#contact">Talk to producer</a>
          </div>
        </div>
      </div>

      <p class="note reveal" style="margin-top:14px">
        <b style="color:var(--text)">Add-ons:</b> Extra cameras, highlight edits, private streaming links, LED screen sizing, additional sound reinforcement, and custom printing quantities.
        <br/><b style="color:var(--text)">Pricing note:</b> Packages are starting estimates. Final quote depends on venue, duration, crew size, equipment needs, and event complexity.
      </p>
    </div>
  </section>

  <!-- TESTIMONIALS -->
  <section aria-label="Testimonials">
    <div class="container">
      <div class="section-head reveal">
        <div>
          <h2>What clients say</h2>
          <p>Trusted by event organizers across the DMV area.</p>
        </div>
      </div>

      <div class="grid">
        <div class="quote reveal">
          <p>“The production was smooth, the stream looked amazing, and the sound was crystal clear. Our remote guests felt like they were in the room.”</p>
          <div class="who"><span class="avatar" aria-hidden="true"></span> <div><b>Conference Organizer</b><br/>Corporate Event</div></div>
        </div>
        <div class="quote reveal" style="transition-delay:.06s">
          <p>“They handled everything—from cameras to online platform setup. It was professional and stress-free from start to finish.”</p>
          <div class="who"><span class="avatar" aria-hidden="true"></span> <div><b>Program Director</b><br/>Hybrid Training</div></div>
        </div>
        <div class="quote reveal" style="transition-delay:.12s">
          <p>“The LED screen transformed the stage. The visuals were sharp and the team stayed on top of every transition.”</p>
          <div class="who"><span class="avatar" aria-hidden="true"></span> <div><b>Event Planner</b><br/>Large Celebration</div></div>
        </div>
      </div>
    </div>
  </section>

  <!-- FAQ -->
  <section id="faq">
    <div class="container">
      <div class="section-head reveal">
        <div>
          <h2>FAQ</h2>
          <p>Common questions organizers ask before booking live production, conferencing, LED walls, and printing.</p>
        </div>
      </div>

      <div class="faq">
        <details class="reveal">
          <summary>
            How far in advance should we book?
            <span class="chev" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
          </summary>
          <p>For best availability, book 2–6 weeks ahead. Large events (LED walls, multiple rooms, multi-day conferences) should be booked earlier.</p>
        </details>

        <details class="reveal" style="transition-delay:.06s">
          <summary>
            Can you stream privately (not public on YouTube/Facebook)?
            <span class="chev" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
          </summary>
          <p>Yes—private links, password-protected streams, and restricted access options are available depending on platform and requirements.</p>
        </details>

        <details class="reveal" style="transition-delay:.12s">
          <summary>
            Do you provide microphones and sound reinforcement?
            <span class="chev" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
          </summary>
          <p>Yes. We can supply wireless microphones, mixers, speakers, and operator support. We also integrate with venue systems.</p>
        </details>

        <details class="reveal">
          <summary>
            What information do you need for a quote?
            <span class="chev" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
          </summary>
          <p>Event date/time, venue location, audience size (in-person + online), services needed (video/audio/LED/printing), and whether you want recording or highlight edits.</p>
        </details>
      </div>
    </div>
  </section>

  <!-- CONTACT -->
  <section id="contact">
    <div class="container">
      <div class="section-head reveal">
        <div>
          <h2>Request a quote</h2>
          <p>Tell us what you’re producing. We’ll respond with availability, options, and a clear estimate.</p>
        </div>
      </div>

      <div class="contact">
        <div class="panel reveal">
          <h3 style="margin-top:0">Event details</h3>

          <form id="quoteForm" method="post" action="#contact" novalidate>
            <!-- Honeypot (bots fill this; humans never see it) -->
            <div style="position:absolute; left:-9999px; height:0; overflow:hidden;">
              <label for="company">Company</label>
              <input id="company" name="company" autocomplete="off" tabindex="-1" />
            </div>

            <div class="form-row">
              <div>
                <label for="name">Full Name</label>
                <input id="name" name="name" placeholder="Your name" autocomplete="name" required />
              </div>
              <div>
                <label for="email">Email</label>
                <input id="email" name="email" type="email" placeholder="you@company.com" autocomplete="email" required />
              </div>
            </div>

            <div class="form-row">
              <div>
                <label for="phone">Phone</label>
                <input id="phone" name="phone" placeholder="+1 (___) ___-____" autocomplete="tel" />
              </div>
              <div>
                <label for="date">Event Date</label>
                <input id="date" name="date" type="date" />
              </div>
            </div>

            <div class="form-row">
              <div>
                <label for="service">Primary Service</label>
                <select id="service" name="service" required>
                  <option value="" selected disabled>Select one</option>
                  <option>Live Video Production</option>
                  <option>Hybrid / Online Conferencing</option>
                  <option>Audio Conferencing / Sound</option>
                  <option>LED Screen Rental</option>
                  <option>Special Events Video</option>
                  <option>Printing / Branding</option>
                  <option>Full Package (Recommended)</option>
                </select>
              </div>
              <div>
                <label for="budget">Estimated Budget</label>
                <select id="budget" name="budget">
                  <option value="" selected>Not sure yet</option>
                  <option>$1,000 – $2,500</option>
                  <option>$2,500 – $5,000</option>
                  <option>$5,000 – $10,000</option>
                  <option>$10,000+</option>
                </select>
              </div>
            </div>

            <div>
              <label for="message">Tell us about the event</label>
              <textarea id="message" name="message" placeholder="Venue, audience size, start/end time, number of speakers, streaming platform, LED needs, printing quantities, etc."></textarea>
            </div>

            <input type="hidden" name="csrf_token" value="<?=h($_SESSION['csrf_token']??'')?>" />

            <div style="display:flex; gap:10px; flex-wrap:wrap">
              <button class="btn primary" type="submit">Send Request</button>
              <a class="btn" href="tel:<?=h(preg_replace('/\D+/', '', $BUSINESS_PHONE))?>">Call Now</a>
            </div>

          </form>
        </div>

        <div class="contact-card reveal" style="transition-delay:.06s">
          <div class="contact-item">
            <div class="mini-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M22 16.9v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.18 2 2 0 0 1 4.08 2h3a2 2 0 0 1 2 1.72c.12.86.31 1.7.57 2.5a2 2 0 0 1-.45 2.11L8.1 9.9a16 16 0 0 0 6 6l1.57-1.1a2 2 0 0 1 2.11-.45c.8.26 1.64.45 2.5.57A2 2 0 0 1 22 16.9Z" stroke="white" stroke-width="2" opacity=".9"/>
              </svg>
            </div>
            <div>
              <b>Phone</b>
              <span><a href="tel:<?=h(preg_replace('/\D+/', '', $BUSINESS_PHONE))?>"><?=h($BUSINESS_PHONE)?></a></span>
            </div>
          </div>

          <div class="contact-item">
            <div class="mini-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M4 4h16v16H4z" stroke="white" stroke-width="2" opacity=".9"/>
                <path d="M4 8l8 6 8-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div>
              <b>Email</b>
              <span><a href="mailto:<?=h($BUSINESS_EMAIL)?>"><?=h($BUSINESS_EMAIL)?></a></span>
            </div>
          </div>

          <div class="contact-item">
            <div class="mini-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 21s7-4.4 7-11a7 7 0 0 0-14 0c0 6.6 7 11 7 11Z" stroke="white" stroke-width="2"/>
                <path d="M12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" fill="white" opacity=".2"/>
              </svg>
            </div>
            <div>
              <b>Service Area</b>
              <span>Washington, DC • Maryland • Virginia<br/>Travel available</span>
            </div>
          </div>

          <div class="panel" style="padding:16px">
            <h3 style="margin-top:0">Quick CTA</h3>
            <p style="margin-bottom:12px">Need fast turnaround? Tell us your date + venue and we’ll reply with options.</p>
            <a class="btn primary" href="#name" style="width:100%" onclick="setTimeout(()=>document.getElementById(‘name’).focus(),80)">Get a Fast Quote</a>
          </div>
        </div>
      </div>
    </div>
  </section>

  <footer>
    <div class="container">
      <div class="foot">
        <div>
          <div style="display:flex; align-items:center; gap:12px">
            <span class="logo" aria-hidden="true"></span>
            <div>
              <b style="font-size:16px">Nexus Live Media</b><br/>
              <span style="color:var(--muted); font-weight:800; font-size:12px">Live Video • Hybrid Events • Broadcast Solutions</span>
            </div>
          </div>
          <p>Professional live event production and conferencing solutions: video, audio, LED screens, special events coverage, plus printing and branding.</p>
        </div>

        <div>
          <h4>Quick Links</h4>
          <a href="#services">Services</a>
          <a href="#packages">Packages</a>
          <a href="#faq">FAQ</a>
          <a href="#contact">Contact</a>
        </div>

        <div>
          <h4>Services</h4>
          <a href="#services">Live Video Production</a>
          <a href="#services">Hybrid & Online Conferencing</a>
          <a href="#services">LED Screen Rental</a>
          <a href="#services">Printing & Branding</a>
        </div>
      </div>

      <div class="copy">
        <span>© <span id="year"></span> Nexus Live Media. All rights reserved.</span>
        <span><a href="#home" style="color:var(--muted);font-weight:900">Back to top ↑</a></span>
      </div>
    </div>
  </footer>

  <div class="float-cta" aria-label="Quick actions">
    <a class="btn primary" href="#contact">Get Quote</a>
    <a class="btn" href="tel:<?=h(preg_replace('/\D+/', '', $BUSINESS_PHONE))?>">Call</a>
  </div>

  <div class="toast" id="toast" role="status" aria-live="polite"></div>

  <script>
    // ===== Mobile menu (with ARIA) =====
    const hamburger = document.getElementById('hamburger');
    const navlinks = document.getElementById('navlinks');

    function setMenuState(open){
      if (!navlinks || !hamburger) return;
      navlinks.classList.toggle('open', open);
      hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    if (hamburger && navlinks) {
      hamburger.addEventListener('click', () => {
        const open = !navlinks.classList.contains('open');
        setMenuState(open);
      });

      navlinks.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', () => setMenuState(false));
      });
    }

    // ===== Reveal on scroll =====
    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const revealEls = Array.from(document.querySelectorAll('.reveal'));
    if (prefersReducedMotion) {
      revealEls.forEach(el => el.classList.add('show'));
    } else {
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) e.target.classList.add('show');
        }
      }, { threshold: 0.12 });
      revealEls.forEach(el => io.observe(el));
    }

    // ===== Footer year =====
    document.getElementById('year').textContent = new Date().getFullYear();

    // ===== Toast from PHP redirect params =====
    const toast = document.getElementById('toast');
    function showToast(msg){
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3200);
    }

    const url = new URL(window.location.href);
    const sent = url.searchParams.get('sent');
    const error = url.searchParams.get('error');

    if (sent === '1') {
      showToast("✅ Request sent! We’ll contact you shortly.");
      // clean URL without refreshing
      url.searchParams.delete('sent');
      window.history.replaceState({}, '', url.toString());
    }
    if (error) {
      showToast("⚠️ " + decodeURIComponent(error));
      url.searchParams.delete('error');
      window.history.replaceState({}, '', url.toString());
    }
  </script>
</body>
</html>
