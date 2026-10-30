<?php
// Local preview router for PHP's built-in server (replaces .htaccess rewrites):
//   php -S 127.0.0.1:8080 -t <repo-root> tools/dev-router.php
declare(strict_types=1);
$root = dirname(__DIR__);
$raw  = (string)(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
$path = rtrim($raw, '/');
if ($path === '') $path = '/';
if (preg_match('~^/(includes|tools)(/|$)~', $path)) { http_response_code(403); exit('Forbidden'); }
if ($path === '/') { require $root . '/index.php'; return true; }
$file = $root . $path;
// Folder with an index.php (services/, events/): behave like Apache's DirectorySlash
if (is_dir($file) && is_file($file . '/index.php')) {
  if (!str_ends_with($raw, '/')) { header('Location: ' . $path . '/', true, 301); return true; }
  require $file . '/index.php';
  return true;
}
if (is_file($file) && !str_ends_with($file, '.php')) return false;          // static asset
if (is_file($file . '.php')) { require $file . '.php'; return true; }       // clean URL
if (is_file($file) && str_ends_with($file, '.php')) { require $file; return true; }
http_response_code(404);
require $root . '/404.php';
return true;
