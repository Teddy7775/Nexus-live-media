import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { qrPng, qrSvg } from '../server/qr.js';
import {
  SHARE_FILE,
  SHARE_TOKEN,
  ShareIndex,
  buildShareBundle,
  escapeHtml,
  lanAddress,
  newShareToken,
  renderGalleryHtml,
  shareBaseUrl,
  shareUrl,
} from '../server/share.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'share-test-'));

/** Decodes a QR code from image bytes with an independent reader (jsQR). */
async function decodeQr(input, { upscale = 1 } = {}) {
  let img = sharp(input).ensureAlpha();
  if (upscale !== 1) img = img.resize({ width: Math.round((await sharp(input).metadata()).width * upscale), kernel: 'nearest' });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data ?? null;
}

test('share tokens are 128 random bits, URL-safe, and never repeat', () => {
  const tokens = new Set(Array.from({ length: 2000 }, newShareToken));
  assert.equal(tokens.size, 2000);
  for (const t of tokens) assert.match(t, SHARE_TOKEN);
});

test('QR PNG decodes back to exactly the URL', async () => {
  const url = `https://example.com/booth/s/${newShareToken()}/`;
  assert.equal(await decodeQr(await qrPng(url, { size: 400 })), url);
});

test('QR SVG is valid markup that renders to a scannable code', async () => {
  const url = `http://192.168.1.50:3001/s/${newShareToken()}/`;
  const svg = await qrSvg(url);
  assert.match(svg, /^<\?xml|^<svg/);
  const png = await sharp(Buffer.from(svg), { density: 300 }).resize({ width: 600 }).png().toBuffer();
  assert.equal(await decodeQr(png), url);
});

test('a QR printed small (0.6 inch at 300 dpi) and JPEG-compressed still scans - the real print scenario', async () => {
  const url = `https://nexuslivemedia.example/booth/s/${newShareToken()}/`;
  const size = 180; // 0.6 in at 300 dpi
  const qr = await qrPng(url, { size, margin: 2 });
  // Put it on a white strip footer, JPEG-compress like final.jpg, then scan the result.
  const page = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#ffffff' } })
    .composite([{ input: qr, left: 210, top: 110 }])
    .jpeg({ quality: 95 })
    .toBuffer();
  assert.equal(await decodeQr(page), url);
});

test('gallery URLs: trailing slash so relative links work; local base uses the LAN address and lan.port', () => {
  const token = newShareToken();
  assert.equal(shareUrl('https://example.com/booth', token), `https://example.com/booth/s/${token}/`);
  const config = { sharing: { publicBaseUrl: '' }, lan: { port: 3001 } };
  assert.equal(shareBaseUrl(config, { lanIp: '192.168.1.50' }), 'http://192.168.1.50:3001');
  assert.equal(shareBaseUrl({ ...config, sharing: { publicBaseUrl: 'https://example.com/booth' } }, { lanIp: '192.168.1.50' }), 'https://example.com/booth');
});

test('lanAddress prefers a real LAN address over virtual adapters and ignores loopback', () => {
  const nic = (address, internal = false) => [{ family: 'IPv4', address, internal }];
  assert.equal(
    lanAddress({ lo: nic('127.0.0.1', true), 'vEthernet (WSL)': nic('172.20.0.1'), 'Wi-Fi': nic('192.168.1.50') }),
    '192.168.1.50',
  );
  assert.equal(lanAddress({ lo: nic('127.0.0.1', true) }), null);
});

test('gallery HTML escapes the event name and brand (no markup injection) and only lists what exists', () => {
  const html = renderGalleryHtml({ eventName: '<script>alert(1)</script> & "Co"', brandName: '<b>x</b>', createdAt: '2026-10-16T12:00:00Z', shotCount: 3, hasGif: false });
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;Co&quot;/);
  assert.equal(html.includes('<b>x</b>'), false);
  assert.match(html, /shot-3\.jpg/);
  assert.equal(html.includes('animation.gif'), false, 'no GIF section without a GIF');
  assert.match(html, /noindex/);
  assert.equal(/<script/i.test(html), false, 'the gallery needs no JavaScript');
  assert.match(renderGalleryHtml({ eventName: 'x', createdAt: '2026-10-16T12:00:00Z', shotCount: 1, hasGif: true }), /animation\.gif/);
  assert.equal(escapeHtml(`a&b<c>"d"'e'`), 'a&amp;b&lt;c&gt;&quot;d&quot;&#39;e&#39;');
});

async function makeSession(dir, { gif = false } = {}) {
  fs.mkdirSync(path.join(dir, 'previews'), { recursive: true });
  const colour = ['#ff0000', '#00ff00', '#0000ff'];
  for (const [i, c] of colour.entries()) {
    await sharp({ create: { width: 200, height: 150, channels: 3, background: c } }).jpeg().toFile(path.join(dir, 'previews', `shot-${i + 1}-a1.jpg`));
  }
  await sharp({ create: { width: 300, height: 450, channels: 3, background: '#ffffff' } }).jpeg().toFile(path.join(dir, 'final.jpg'));
  if (gif) fs.writeFileSync(path.join(dir, 'animation-src.gif'), Buffer.from('GIF89a'));
  return {
    eventName: 'Test Event',
    createdAt: '2026-10-16T12:00:00Z',
    final: { file: 'final.jpg', preview: 'final-preview.jpg', version: 1 },
    shots: [0, 1, 2].map((i) => ({ index: i, attempt: 1, file: `originals/shot-${i + 1}-a1.jpg`, preview: path.join('previews', `shot-${i + 1}-a1.jpg`) })),
    gif: gif ? { file: 'animation-src.gif' } : null,
  };
}

test('the share bundle contains exactly the whitelisted files, with index.html last', async () => {
  const dir = tmpDir();
  try {
    const session = await makeSession(dir, { gif: true });
    const bundle = await buildShareBundle({ session, sessionDir: dir, brandName: 'Nexus' });
    assert.deepEqual(bundle.files, ['final.jpg', 'shot-1.jpg', 'shot-2.jpg', 'shot-3.jpg', 'animation.gif', 'index.html']);
    for (const name of bundle.files) {
      assert.match(name, SHARE_FILE);
      assert.ok(fs.existsSync(path.join(bundle.dir, name)), name);
    }
    assert.deepEqual(fs.readdirSync(bundle.dir).sort(), [...bundle.files].sort(), 'nothing else is in the folder (no originals, no PDF)');
    assert.match(fs.readFileSync(path.join(bundle.dir, 'index.html'), 'utf8'), /animation\.gif/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rebuilding the bundle replaces stale files (a retake must not leave the old picture behind)', async () => {
  const dir = tmpDir();
  try {
    const session = await makeSession(dir, { gif: true });
    await buildShareBundle({ session, sessionDir: dir });
    session.gif = null;
    const again = await buildShareBundle({ session, sessionDir: dir });
    assert.equal(again.files.includes('animation.gif'), false);
    assert.equal(fs.existsSync(path.join(dir, 'share', 'animation.gif')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('building a bundle before the picture exists is refused', async () => {
  await assert.rejects(buildShareBundle({ session: { shots: [], final: null }, sessionDir: tmpDir() }), /no finished picture/);
});

test('ShareIndex survives a restart, rejects malformed tokens and never loses concurrent writes', async () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'share-index.json');
    const index = await new ShareIndex({ file }).load();
    const tokens = Array.from({ length: 25 }, newShareToken);
    await Promise.all(tokens.map((t, i) => index.set(t, { eventSlug: 'ev', sessionId: `s${i}` })));
    await index.flush();

    const reloaded = await new ShareIndex({ file }).load();
    for (const [i, t] of tokens.entries()) assert.deepEqual(reloaded.get(t), { eventSlug: 'ev', sessionId: `s${i}` });
    assert.equal(reloaded.get('not-a-token'), null);
    assert.equal(reloaded.get('../../etc/passwd'), null);
    assert.equal(reloaded.get(newShareToken()), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
