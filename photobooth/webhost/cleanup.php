<?php
/**
 * Deletes galleries older than N days (default 30). Run from a cron job, never from the web:
 *     php /path/to/booth/cleanup.php 30
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('Run from the command line.');
}

$days = isset($argv[1]) ? (int) $argv[1] : 30;
if ($days < 1) {
    fwrite(STDERR, "Usage: php cleanup.php <days >= 1>\n");
    exit(1);
}
$cutoff = time() - $days * 86400;
$removed = 0;

foreach (glob(__DIR__ . '/s/*', GLOB_ONLYDIR) ?: [] as $dir) {
    if (!preg_match('/^[A-Za-z0-9_-]{22}$/', basename($dir)) || filemtime($dir) >= $cutoff) {
        continue;
    }
    foreach (glob($dir . '/{,.}*', GLOB_BRACE) ?: [] as $file) {
        if (is_file($file)) {
            @unlink($file);
        }
    }
    if (@rmdir($dir)) {
        $removed++;
        echo 'removed ' . basename($dir) . "\n";
    }
}
echo "done: $removed gallery folder(s) older than $days day(s) removed\n";
