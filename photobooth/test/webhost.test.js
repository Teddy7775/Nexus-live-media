import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { UploadQueue, WebHostUploader, signUpload } from '../server/uploader.js';
import { encodeGif } from '../server/gif.js';
import { newShareToken } from '../server/share.js';
import { waitFor } from './helpers.js';

// These run the REAL webhost/upload.php under PHP's built-in web server. Skipped (not faked) when PHP is missing.
const phpAvailable = spawnSync('php', ['-v']).status === 0;
const SECRET = 'a-long-secret-shared-by-booth-and-host';
const WEBHOST = new URL('../webhost/', import.meta.url).pathname;

let dir;
let server;
let base;

async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

before(async () => {
  if (!phpAvailable) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webhost-test-'));
  for (const f of ['upload.php', 'cleanup.php']) fs.copyFileSync(path.join(WEBHOST, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'config.php'), `<?php return ['secret' => '${SECRET}'];`);
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', dir], { stdio: 'ignore', env: { ...process.env, PHP_CLI_SERVER_WORKERS: '4' } });
  await waitFor(async () => fetch(`${base}/upload.php`).then(() => true, () => false), { timeoutMs: 8000, intervalMs: 100 });
});

after(() => {
  server?.kill();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

const opts = { skip: !phpAvailable && 'php is not installed' };
const uploader = (extra = {}) => new WebHostUploader({ url: `${base}/upload.php`, secret: SECRET, timeoutMs: 5000, ...extra });
const jpeg = () => sharp({ create: { width: 80, height: 60, channels: 3, background: '#336699' } }).jpeg().toBuffer();

/** A hand-built request, for testing what a hostile client could send. */
async function raw({ method = 'POST', query, token = 'x', name = 'x', body = Buffer.alloc(0), timestamp = String(Math.floor(Date.now() / 1000)), secret = SECRET, signature }) {
  const sig = signature ?? signUpload({ secret, timestamp, token, name, body });
  const res = await fetch(`${base}/upload.php?${query}`, { method, headers: { 'x-booth-timestamp': timestamp, 'x-booth-signature': sig }, body: method === 'POST' ? body : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
}

test('a signed upload is stored byte-for-byte under s/<token>/<name>', opts, async () => {
  const token = newShareToken();
  const bytes = await jpeg();
  const data = await uploader().uploadFile({ token, name: 'final.jpg', buffer: bytes });
  assert.equal(data.ok, true);
  assert.deepEqual(fs.readFileSync(path.join(dir, 's', token, 'final.jpg')), bytes);
  assert.ok(fs.existsSync(path.join(dir, 's', '.htaccess')), 'the s/ folder is locked down with an .htaccess on first use');
});

test('check(): reports a working host, and a wrong secret as a clear message', opts, async () => {
  const good = await uploader().check();
  assert.equal(good.ok, true);
  assert.match(good.detail, /Web host reachable \(PHP 8/);
  const bad = await uploader({ secret: 'the-wrong-secret-entirely-xxxxx' }).check();
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /401.*secret/i);
  const nowhere = await new WebHostUploader({ url: 'http://127.0.0.1:1/upload.php', secret: SECRET, timeoutMs: 800 }).check();
  assert.equal(nowhere.ok, false);
  assert.match(nowhere.detail, /Cannot reach the web host/);
});

test('requests that are not properly signed are refused and write nothing', opts, async () => {
  const token = newShareToken();
  const body = await jpeg();
  const q = `t=${token}&f=final.jpg`;
  const wrongSecret = await raw({ query: q, token, name: 'final.jpg', body, secret: 'not-the-secret-not-the-secret' });
  assert.equal(wrongSecret.status, 401);

  const tampered = await raw({ query: q, token, name: 'final.jpg', body, signature: signUpload({ secret: SECRET, timestamp: String(Math.floor(Date.now() / 1000)), token, name: 'final.jpg', body: Buffer.from('different') }) });
  assert.equal(tampered.status, 401, 'a body altered after signing is rejected');

  const stale = await raw({ query: q, token, name: 'final.jpg', body, timestamp: String(Math.floor(Date.now() / 1000) - 3600) });
  assert.equal(stale.status, 401);
  assert.match(stale.json.error, /clock/);

  const noHeaders = await fetch(`${base}/upload.php?${q}`, { method: 'POST', body });
  assert.equal(noHeaders.status, 401);

  const wrongMethod = await raw({ method: 'GET', query: q, token, name: 'final.jpg' });
  assert.equal(wrongMethod.status, 405);

  assert.equal(fs.existsSync(path.join(dir, 's', token)), false, 'nothing was written by any of the refused requests');
});

test('even with a valid signature, names, tokens and content are strictly validated', opts, async () => {
  const body = await jpeg();
  const token = newShareToken();
  const signed = (name, b = body, t = token) => raw({ query: `t=${t}&f=${encodeURIComponent(name)}`, token: t, name, body: b });

  assert.equal((await signed('../upload.php')).status, 400, 'path traversal');
  assert.equal((await signed('..%2Fx.jpg')).status, 400);
  assert.equal((await signed('evil.php', Buffer.from('<?php system($_GET[0]);'))).status, 400, 'a script name');
  assert.equal((await signed('shot-9.jpg')).status, 400, 'a shot number out of range');
  assert.equal((await signed('final.jpg', body, '../../etc/passwd')).status, 400, 'a malformed token');
  assert.equal((await signed('final.jpg', body, 'short')).status, 400);

  const phpAsJpg = await signed('final.jpg', Buffer.from('<?php echo "owned"; ?>'));
  assert.equal(phpAsJpg.status, 400);
  assert.match(phpAsJpg.json.error, /not a JPEG/);
  assert.equal((await signed('animation.gif', body)).status, 400, 'a JPEG pretending to be a GIF');

  assert.equal((await signed('index.html', Buffer.from('<?php echo 1;'))).status, 400, 'a page that is not a gallery');
  assert.equal((await signed('index.html', Buffer.from('<!doctype html><?php echo 1; ?>'))).status, 400, 'PHP tags inside a page');
  assert.equal((await signed('index.html', Buffer.alloc(400_000, 'a'))).status, 413, 'oversized page');

  assert.equal(fs.existsSync(path.join(dir, 's', token)), false);
  assert.equal((await signed('index.html', Buffer.from('<!doctype html><html><body>ok</body></html>'))).status, 200, 'a well-formed page is accepted');
});

test('end to end: the real queue + real uploader deliver a whole gallery, index.html last', opts, async () => {
  const token = newShareToken();
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  try {
    const files = ['final.jpg', 'shot-1.jpg', 'shot-2.jpg', 'index.html'];
    const image = await jpeg();
    for (const f of files) fs.writeFileSync(path.join(src, f), f === 'index.html' ? '<!doctype html><html><body>gallery</body></html>' : image);

    const order = [];
    const real = uploader();
    const recording = { uploadFile: async (args) => { order.push(args.name); return real.uploadFile(args); } };
    const uploaded = [];
    const queue = new UploadQueue({ uploader: recording, file: path.join(src, 'q.json'), onUploaded: async (id, v) => uploaded.push([id, v]) });
    queue.enqueue({ sessionId: 's1', token, dir: src, files, version: 7 });
    await waitFor(() => uploaded.length === 1);

    assert.deepEqual(order, files, 'files are sent in order with index.html last');
    assert.deepEqual(uploaded, [['s1', 7]]);
    assert.deepEqual(fs.readdirSync(path.join(dir, 's', token)).sort(), [...files].sort());
    queue.stop();
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
  }
});

test('cleanup.php removes galleries older than N days, keeps newer ones, and refuses to run from the web', opts, async () => {
  const oldToken = newShareToken();
  const newToken = newShareToken();
  const body = await jpeg();
  await uploader().uploadFile({ token: oldToken, name: 'final.jpg', buffer: body });
  await uploader().uploadFile({ token: newToken, name: 'final.jpg', buffer: body });
  const fortyDaysAgo = new Date(Date.now() - 40 * 86400_000);
  fs.utimesSync(path.join(dir, 's', oldToken), fortyDaysAgo, fortyDaysAgo);

  const web = await fetch(`${base}/cleanup.php?30`);
  assert.equal(web.status, 403, 'not runnable through the web server');
  assert.ok(fs.existsSync(path.join(dir, 's', oldToken)), 'the web request deleted nothing');

  const cli = spawnSync('php', [path.join(dir, 'cleanup.php'), '30'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, new RegExp(`removed ${oldToken}`));
  assert.equal(fs.existsSync(path.join(dir, 's', oldToken)), false);
  assert.ok(fs.existsSync(path.join(dir, 's', newToken, 'final.jpg')), 'recent gallery untouched');
  assert.equal(spawnSync('php', [path.join(dir, 'cleanup.php'), '0']).status, 1, 'refuses a nonsensical age');
});

test('a host without config.php (or with the sample secret) refuses to accept uploads', opts, async () => {
  const configFile = path.join(dir, 'config.php');
  const original = fs.readFileSync(configFile, 'utf8');
  try {
    fs.writeFileSync(configFile, "<?php return ['secret' => 'CHANGE-ME-to-a-long-random-string-of-letters-and-digits'];");
    const sample = await raw({ query: 'ping=1', token: 'ping', name: 'ping' });
    assert.equal(sample.status, 500);
    assert.match(sample.json.error, /your own secret/);
    fs.rmSync(configFile);
    const missing = await raw({ query: 'ping=1', token: 'ping', name: 'ping' });
    assert.equal(missing.status, 500);
    assert.match(missing.json.error, /config\.php is missing/);
  } finally {
    fs.writeFileSync(configFile, original);
  }
});

test('a GIF produced by this booth passes the receiver\'s own image validation, byte for byte', opts, async () => {
  const token = newShareToken();
  const frames = await Promise.all(['#ff0000', '#00c800', '#0000ff', '#ffdc00'].map((c) => sharp({ create: { width: 320, height: 240, channels: 3, background: c } }).jpeg().toBuffer()));
  const gif = await encodeGif({ frames, width: 320, delayMs: 250, boomerang: true });
  const res = await uploader().uploadFile({ token, name: 'animation.gif', buffer: gif });
  assert.equal(res.ok, true);
  assert.deepEqual(fs.readFileSync(path.join(dir, 's', token, 'animation.gif')), gif);
});
