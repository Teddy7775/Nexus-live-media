<?php
declare(strict_types=1);
require __DIR__ . '/_lib.php';
$c = cfg();
$g = guard_request('contact', 3, 3600);
$lang = $g['lang'];
$name = clean((string)($_POST['name'] ?? ''), 120);
$email = clean((string)($_POST['email'] ?? ''), 254);
$msg = clean((string)($_POST['message'] ?? ''), 4000);
$ok = $name !== '' && $msg !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) && ($_POST['consent'] ?? '') === '1';
if (!$ok || empty($c['owner_email'])) { finish(false, $lang, '/{lang}/', '/{lang}/?error=1'); }
$sent = send_mail($c['owner_email'], '[' . $c['site_name'] . '] Message from ' . preg_replace('/[\r\n]+/', ' ', $name),
    "Name: $name\nEmail: $email\nLanguage: $lang\n\n$msg\n", $email);
finish($sent, $lang, '/{lang}/' . ($c['contact_path'][$lang] ?? 'contact') . '/?sent=1', '/{lang}/?error=1');
