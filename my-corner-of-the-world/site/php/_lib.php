<?php
declare(strict_types=1);
/*
 * Shared helpers for the two tiny form handlers (subscribe.php, contact.php).
 * Plain PHP, no dependencies, works on Hostinger shared hosting.
 * Copy config.sample.php to config.php and fill it in; config.php is never committed.
 */
if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === '_lib.php') { http_response_code(404); exit; }

function cfg(): array {
    static $c = null;
    if ($c === null) {
        $f = __DIR__ . '/config.php';
        $c = is_file($f) ? require $f : require __DIR__ . '/config.sample.php';
    }
    return $c;
}

function wants_json(): bool {
    $a = $_SERVER['HTTP_ACCEPT'] ?? '';
    return strpos($a, 'application/json') !== false;
}

function clean(string $s, int $max): string {
    $s = trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', $s) ?? '');
    return mb_substr($s, 0, $max);
}

function client_ip(): string {
    return preg_replace('/[^0-9a-fA-F:.]/', '', $_SERVER['REMOTE_ADDR'] ?? 'unknown') ?: 'unknown';
}

/** Allow at most $max hits per $window seconds per IP and bucket. File-based; no database needed. */
function rate_ok(string $bucket, int $max, int $window): bool {
    $file = sys_get_temp_dir() . '/mcw_rl_' . $bucket . '_' . sha1(client_ip());
    $now = time();
    $hits = [];
    if (is_file($file)) {
        $hits = array_filter(array_map('intval', explode(',', (string)file_get_contents($file))), fn($t) => $t > $now - $window);
    }
    if (count($hits) >= $max) { return false; }
    $hits[] = $now;
    @file_put_contents($file, implode(',', $hits), LOCK_EX);
    return true;
}

function finish(bool $ok, string $lang, string $okPath, string $errPath): void {
    if (wants_json()) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => $ok]);
        exit;
    }
    $c = cfg();
    $lang = in_array($lang, $c['allowed_langs'], true) ? $lang : $c['allowed_langs'][0];
    $base = rtrim($c['base_path'] ?? '', '/');
    $path = str_replace('{lang}', $lang, $ok ? $okPath : $errPath);
    header('Location: ' . $base . $path, true, 303);
    exit;
}

function guard_request(string $bucket, int $max, int $window): array {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        http_response_code(405); header('Allow: POST'); exit;
    }
    $lang = clean((string)($_POST['lang'] ?? ''), 2);
    // honeypot: real people never see this field
    if (clean((string)($_POST['company'] ?? ''), 100) !== '') { finish(true, $lang, '/{lang}/', '/{lang}/'); }
    // time trap: the page script fills in the load time; an instant submission is a bot
    $ts = (int)($_POST['ts'] ?? 0);
    if ($ts > 0 && (time() * 1000 - $ts) < 2500) { finish(false, $lang, '/{lang}/', '/{lang}/?error=1'); }
    if (!rate_ok($bucket, $max, $window)) { http_response_code(429); finish(false, $lang, '/{lang}/', '/{lang}/?error=1'); }
    return ['lang' => $lang];
}

function send_mail(string $to, string $subject, string $body, string $replyTo = ''): bool {
    $c = cfg();
    $headers = [
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'From: ' . mb_encode_mimeheader($c['site_name'], 'UTF-8') . ' <' . $c['mail_from'] . '>',
        'X-Mailer: PHP/' . phpversion(),
    ];
    if ($replyTo !== '' && filter_var($replyTo, FILTER_VALIDATE_EMAIL)) {
        $headers[] = 'Reply-To: ' . $replyTo;
    }
    return @mail($to, mb_encode_mimeheader($subject, 'UTF-8'), $body, implode("\r\n", $headers));
}
