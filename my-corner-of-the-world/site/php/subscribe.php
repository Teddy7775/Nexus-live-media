<?php
declare(strict_types=1);
require __DIR__ . '/_lib.php';
$c = cfg();
$g = guard_request('sub', 5, 3600);
$lang = $g['lang'];
$email = clean((string)($_POST['email'] ?? ''), 254);
$ok = filter_var($email, FILTER_VALIDATE_EMAIL) && ($_POST['consent'] ?? '') === '1';
if (!$ok) { finish(false, $lang, '/{lang}/', '/{lang}/?error=1'); }

$dir = $c['data_dir'] ?? (__DIR__ . '/private');
if (!is_dir($dir)) { @mkdir($dir, 0750, true); }
$file = $dir . '/subscribers.csv';
$exists = false;
if (is_file($file)) {
    $h = fopen($file, 'r');
    while ($h && ($row = fgetcsv($h)) !== false) { if (strcasecmp($row[1] ?? '', $email) === 0) { $exists = true; break; } }
    if ($h) fclose($h);
}
if (!$exists) {
    $safe = preg_match('/^[=+\-@]/', $email) ? "'" . $email : $email;   // spreadsheet formula injection guard
    $h = fopen($file, 'a');
    if ($h) { flock($h, LOCK_EX); fputcsv($h, [gmdate('c'), $safe, $lang, 'consent=1']); flock($h, LOCK_UN); fclose($h); }
    if (!empty($c['owner_email'])) {
        send_mail($c['owner_email'], '[' . $c['site_name'] . '] New subscriber', "Email: $email\nLanguage: $lang\nTime (UTC): " . gmdate('c') . "\n");
    }
}
finish(true, $lang, '/{lang}/?subscribed=1', '/{lang}/?error=1');
