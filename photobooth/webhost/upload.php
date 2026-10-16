<?php
/**
 * Nexus Booth upload receiver.
 *
 * Receives ONE file per request from the booth PC and stores it under s/<token>/<name>. The folder s/<token>/ is
 * then the guest's private gallery (index.html + photos). Nothing here lets a visitor list, read or overwrite
 * anything: every request must carry an HMAC signature made with the shared secret in config.php.
 *
 * Request:  POST upload.php?t=<22-char token>&f=<file name>      body = the raw file bytes
 *           POST upload.php?ping=1                               (signed check that URL, secret and folder work)
 * Headers:  X-Booth-Timestamp: <unix seconds>      (must be within 10 minutes of this server's clock)
 *           X-Booth-Signature: hex HMAC-SHA256(secret, timestamp "\n" token "\n" name "\n" sha256(body))
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function fail(int $code, string $message): void
{
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $message]);
    exit;
}

$configFile = __DIR__ . '/config.php';
if (!is_file($configFile)) {
    fail(500, 'config.php is missing: copy config.sample.php to config.php and set a secret');
}
$config = require $configFile;
$secret = is_array($config) && isset($config['secret']) && is_string($config['secret']) ? $config['secret'] : '';
if (strlen($secret) < 16 || strpos($secret, 'CHANGE-ME') !== false) {
    fail(500, 'config.php must set your own secret of at least 16 characters');
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    fail(405, 'POST only');
}

$timestamp = (string) ($_SERVER['HTTP_X_BOOTH_TIMESTAMP'] ?? '');
$signature = strtolower((string) ($_SERVER['HTTP_X_BOOTH_SIGNATURE'] ?? ''));
if ($timestamp === '' || !ctype_digit($timestamp) || abs(time() - (int) $timestamp) > 600) {
    fail(401, 'missing or stale timestamp (check the booth PC clock)');
}

$isPing = (($_GET['ping'] ?? '') === '1');
$token = $isPing ? 'ping' : (string) ($_GET['t'] ?? '');
$name = $isPing ? 'ping' : (string) ($_GET['f'] ?? '');

// Largest accepted body for each kind of file.
$limits = ['index.html' => 300000, 'final.jpg' => 15000000, 'animation.gif' => 25000000, 'ping' => 0];
$limit = $limits[$name] ?? (preg_match('/^shot-[1-8]\.jpg$/', $name) ? 8000000 : -1);
if ($limit < 0) {
    fail(400, 'file name not allowed');
}
if (!$isPing && !preg_match('/^[A-Za-z0-9_-]{22}$/', $token)) {
    fail(400, 'bad token');
}

$body = (string) file_get_contents('php://input');
if (strlen($body) > $limit) {
    fail(413, 'file too large');
}

// Verify the signature BEFORE doing anything else with the request.
$expected = hash_hmac('sha256', $timestamp . "\n" . $token . "\n" . $name . "\n" . hash('sha256', $body), $secret);
if (!hash_equals($expected, $signature)) {
    fail(401, 'bad signature (is the secret the same in config.php and the booth?)');
}

$root = __DIR__ . '/s';
if (!is_dir($root) && !@mkdir($root, 0755, true) && !is_dir($root)) {
    fail(500, 'cannot create the s/ folder - check this folder is writable');
}
// Galleries are plain files: never execute anything there, never list the folder.
$guard = $root . '/.htaccess';
if (!is_file($guard)) {
    @file_put_contents($guard, "Options -Indexes\n<IfModule mod_php.c>\nphp_flag engine off\n</IfModule>\nRemoveHandler .php .phtml .php3 .php4 .php5 .php7 .php8\nAddType text/plain .php .phtml\n<FilesMatch \"^\\.\">\nRequire all denied\n</FilesMatch>\nErrorDocument 404 \"These photos are not ready yet, or the link is wrong. If you just took them, wait a minute and refresh.\"\n");
}

if ($isPing) {
    echo json_encode(['ok' => true, 'ping' => true, 'php' => PHP_VERSION, 'writable' => is_writable($root)]);
    exit;
}

// The content must really be what its name says.
if (substr($name, -4) === '.jpg') {
    $info = @getimagesizefromstring($body);
    if ($info === false || $info[2] !== IMAGETYPE_JPEG) {
        fail(400, 'not a JPEG image');
    }
} elseif ($name === 'animation.gif') {
    $info = @getimagesizefromstring($body);
    if ($info === false || $info[2] !== IMAGETYPE_GIF) {
        fail(400, 'not a GIF image');
    }
} elseif ($name === 'index.html') {
    if (stripos(ltrim($body), '<!doctype html') !== 0 || strpos($body, '<?') !== false) {
        fail(400, 'not a gallery page');
    }
}

$dir = $root . '/' . $token;
if (!is_dir($dir) && !@mkdir($dir, 0755) && !is_dir($dir)) {
    fail(500, 'cannot create the gallery folder');
}
$tmp = $dir . '/.' . $name . '.' . bin2hex(random_bytes(4)) . '.tmp';
if (@file_put_contents($tmp, $body, LOCK_EX) === false || !@rename($tmp, $dir . '/' . $name)) {
    @unlink($tmp);
    fail(500, 'cannot write the file');
}
@chmod($dir . '/' . $name, 0644);

echo json_encode(['ok' => true, 'name' => $name, 'bytes' => strlen($body)]);
