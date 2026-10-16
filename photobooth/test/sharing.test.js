import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { startBooth, waitFor } from './helpers.js';

const BASE = 'https://photos.example.com/booth';
const localOverrides = { sharing: { enabled: true, mode: 'local', publicBaseUrl: 'http://gallery.test:3001' } };
const uploadOverrides = {
  sharing: { enabled: true, mode: 'upload', publicBaseUrl: BASE, upload: { url: 'https://photos.example.com/booth/upload.php', secret: 'x'.repeat(24) } },
};

async function withBooth(options, fn) {
  const booth = await startBooth(options);
  try {
    await fn(booth);
  } finally {
    await booth.close();
  }
}

async function finishSession(booth) {
  const session = (await booth.api('POST', '/api/sessions')).json;
  for (let i = 0; i < session.shotsNeeded; i++) assert.equal((await booth.api('POST', `/api/sessions/${session.id}/shots`)).status, 200);
  return session;
}

async function decodeQrFrom(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data ?? null;
}

/** Decodes every QR code printed on the finished picture, one crop per QR box in the layout. */
async function decodePrintedQrs(booth, session) {
  const finalFile = path.join(booth.config.storage.dir, 'default', session.id, 'final.jpg');
  const template = booth.templates.get(session.templateId);
  assert.ok(template.qr?.length > 0, `${session.templateId} reserves room for a QR`);
  const { width, height } = await sharp(finalFile).metadata();
  const results = [];
  for (const q of template.qr) {
    const pad = 24; // a little of the surrounding picture, like a phone camera sees
    const left = Math.max(0, q.x - pad);
    const top = Math.max(0, q.y - pad);
    const crop = await sharp(finalFile).extract({ left, top, width: Math.min(width - left, q.size + 2 * pad), height: Math.min(height - top, q.size + 2 * pad) }).png().toBuffer();
    results.push(await decodeQrFrom(crop));
  }
  return results;
}

function fakeUploader() {
  let gate = null;
  let failure = null;
  const uploaded = [];
  return {
    uploaded,
    hold() {
      let release;
      gate = new Promise((resolve) => (release = resolve));
      gate.release = release;
    },
    release() {
      gate?.release();
      gate = null;
    },
    failWith(err) {
      failure = err;
    },
    async uploadFile({ token, name, buffer }) {
      if (gate) await gate;
      if (failure) throw failure;
      uploaded.push({ token, name, bytes: buffer.length });
      return { ok: true };
    },
    async check() {
      return { ok: true, detail: 'fake web host' };
    },
  };
}

const sessionJson = (booth, id) => JSON.parse(fs.readFileSync(path.join(booth.config.storage.dir, 'default', id, 'session.json'), 'utf8'));

// ----------------------------------------------------------------- local mode

test('local mode: the printed QR decodes to the guest gallery, and the gallery really serves the photos', async () => {
  await withBooth({ overrides: localOverrides }, async (booth) => {
    const session = await finishSession(booth);
    const share = await booth.api('POST', `/api/sessions/${session.id}/share`);
    assert.equal(share.status, 200, share.text);
    assert.equal(share.json.ready, true);
    assert.match(share.json.url, /^http:\/\/gallery\.test:3001\/s\/[A-Za-z0-9_-]{22}\/$/);
    assert.match(share.json.qrSvg, /<svg/);

    // Every QR printed on the picture decodes to exactly this link.
    const finalFile = path.join(booth.config.storage.dir, 'default', session.id, 'final.jpg');
    assert.deepEqual(await decodePrintedQrs(booth, session), [share.json.url, share.json.url], 'scanning either printed QR opens the gallery');

    // Serve it through the real gallery listener (the host name only matters to phones; here we use the test port).
    const token = share.json.url.split('/s/')[1].replace('/', '');
    const page = await fetch(`${booth.lanUrl}/s/${token}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Nexus Photo Booth/);
    const img = await fetch(`${booth.lanUrl}/s/${token}/final.jpg`);
    assert.equal(img.status, 200);
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), fs.readFileSync(finalFile));
    assert.equal((await fetch(`${booth.lanUrl}/s/${token}/shot-3.jpg`)).status, 200);
    assert.equal((await fetch(`${booth.lanUrl}/s/${token}/animation.gif`)).status, 404, 'no GIF was made, so no GIF is offered');
  });
});

test('the network listener serves ONLY galleries - never the camera, printer, operator or session folders', async () => {
  await withBooth({ overrides: localOverrides }, async (booth) => {
    const session = await finishSession(booth);
    const share = (await booth.api('POST', `/api/sessions/${session.id}/share`)).json;
    const token = share.url.split('/s/')[1].replace('/', '');
    const get = (p) => fetch(`${booth.lanUrl}${p}`, { redirect: 'manual' });

    // The booth's own API must not exist here, even with the right PIN.
    for (const p of ['/api/state', '/api/health', '/api/operator/status', '/api/camera/stream', '/operator.html', '/index.html', '/']) {
      assert.equal((await get(p)).status, 404, p);
    }
    assert.equal((await fetch(`${booth.lanUrl}/api/sessions`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${booth.lanUrl}/api/operator/test-print`, { method: 'POST', headers: { 'x-operator-pin': booth.config.operatorPin } })).status, 404);

    // A valid token still only yields the whitelisted files.
    for (const f of ['session.json', 'print.pdf', 'originals/shot-1-a1.jpg', '..%2Fsession.json', '..%2F..%2Fpackage.json', '%2e%2e%2fsession.json', 'index.html%00.jpg', 'share', '.htaccess']) {
      assert.equal((await get(`/s/${token}/${f}`)).status, 404, f);
    }
    // Defence in depth: even a stray file that ends up inside a gallery folder is never served - only the whitelist is.
    const shareDir = path.join(booth.config.storage.dir, 'default', session.id, 'share');
    for (const stray of ['internal-notes.txt', 'shot-9.jpg', 'upload.php', 'config.json']) {
      fs.writeFileSync(path.join(shareDir, stray), 'not for guests');
      assert.equal((await get(`/s/${token}/${stray}`)).status, 404, `stray file ${stray}`);
    }

    // Bad tokens all look identical to unknown ones (no oracle for guessing).
    const unknown = await get(`/s/${'A'.repeat(22)}/`);
    const malformed = await get('/s/short/');
    const traversal = await get('/s/..%2F..%2Fetc/');
    for (const r of [unknown, malformed, traversal]) assert.equal(r.status, 404);
    assert.equal(await unknown.text(), await malformed.text());

    // The slash is added so relative links work; privacy headers are present.
    const noSlash = await get(`/s/${token}`);
    assert.equal(noSlash.status, 301);
    assert.equal(noSlash.headers.get('location'), `/s/${token}/`);
    const ok = await get(`/s/${token}/`);
    assert.match(ok.headers.get('x-robots-tag'), /noindex/);
    assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
  });
});

test('every built-in layout prints a scannable QR (checked by decoding the real composed picture)', async () => {
  for (const templateId of ['strip-2x6-x2', 'single-4x6', 'duo-4x6']) {
    await withBooth({ overrides: { ...localOverrides, activeTemplate: templateId } }, async (booth) => {
      const session = await finishSession(booth);
      const share = (await booth.api('POST', `/api/sessions/${session.id}/share`)).json;
      const decoded = await decodePrintedQrs(booth, session);
      assert.ok(decoded.length >= 1);
      assert.ok(decoded.every((d) => d === share.url), `${templateId}: every printed QR decodes to the gallery link (got ${JSON.stringify(decoded)})`);
    });
  }
});

test('the strip carries a QR on EACH strip, so both halves work after the 2-inch cut', async () => {
  await withBooth({ overrides: localOverrides }, async (booth) => {
    const session = await finishSession(booth);
    const share = (await booth.api('POST', `/api/sessions/${session.id}/share`)).json;
    const finalFile = path.join(booth.config.storage.dir, 'default', session.id, 'final.jpg');
    for (const [name, left] of [['left strip', 0], ['right strip', 600]]) {
      const half = await sharp(finalFile).extract({ left, top: 0, width: 600, height: 1800 }).png().toBuffer();
      assert.equal(await decodeQrFrom(half), share.url, name);
    }
  });
});

// ---------------------------------------------------------------- upload mode

test('upload mode: the link is "preparing" until the web host has everything, then "ready"; index.html goes last', async () => {
  const up = fakeUploader();
  up.hold();
  await withBooth({ overrides: uploadOverrides, uploader: up }, async (booth) => {
    const session = await finishSession(booth);
    const share = await booth.api('POST', `/api/sessions/${session.id}/share`);
    assert.equal(share.status, 200, share.text);
    assert.equal(share.json.state, 'preparing');
    assert.equal(share.json.ready, false);
    assert.match(share.json.url, new RegExp(`^${BASE}/s/[A-Za-z0-9_-]{22}/$`));

    up.release();
    await waitFor(async () => (await booth.api('GET', `/api/sessions/${session.id}/share`)).json.ready);
    assert.deepEqual(up.uploaded.map((u) => u.name), ['final.jpg', 'shot-1.jpg', 'shot-2.jpg', 'shot-3.jpg', 'index.html']);
    assert.equal(new Set(up.uploaded.map((u) => u.token)).size, 1);
    assert.equal(sessionJson(booth, session.id).share.uploadedVersion, sessionJson(booth, session.id).final.version);

    // The QR on the print points at the web host address, not at this PC.
    assert.deepEqual(await decodePrintedQrs(booth, session), [share.json.url, share.json.url]);
  });
});

test('upload mode: a retake makes the old upload stale and the new picture is published again', async () => {
  const up = fakeUploader();
  await withBooth({ overrides: uploadOverrides, uploader: up }, async (booth) => {
    const session = await finishSession(booth);
    await booth.api('POST', `/api/sessions/${session.id}/share`);
    await waitFor(async () => (await booth.api('GET', `/api/sessions/${session.id}/share`)).json.ready);
    const firstRun = up.uploaded.length;

    assert.equal((await booth.api('POST', `/api/sessions/${session.id}/shots`, { index: 1 })).status, 200);
    await booth.api('POST', `/api/sessions/${session.id}/share`);
    // Immediately after the retake the previous upload no longer counts as current...
    await waitFor(async () => (await booth.api('GET', `/api/sessions/${session.id}/share`)).json.ready);
    assert.ok(up.uploaded.length > firstRun, 'the new picture was uploaded again');
    assert.equal(sessionJson(booth, session.id).share.uploadedVersion, sessionJson(booth, session.id).final.version, 'ready refers to the NEW picture');
  });
});

test('upload mode: with autoUpload off nothing is sent until the guest asks to share', async () => {
  const up = fakeUploader();
  await withBooth({ overrides: { sharing: { ...uploadOverrides.sharing, autoUpload: false } }, uploader: up }, async (booth) => {
    const session = await finishSession(booth);
    await booth.api('POST', `/api/sessions/${session.id}/compose`);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(up.uploaded.length, 0, 'composing alone uploads nothing');
    await booth.api('POST', `/api/sessions/${session.id}/share`);
    await waitFor(() => up.uploaded.length > 0);
  });
});

test('upload mode: a rejected upload shows as failed with the reason, and the operator can retry after fixing it', async () => {
  const up = fakeUploader();
  const { UploadError } = await import('../server/uploader.js');
  up.failWith(new UploadError('The web host rejected the upload (401): bad signature', { status: 401, retryable: false }));
  await withBooth({ overrides: uploadOverrides, uploader: up }, async (booth) => {
    const session = await finishSession(booth);
    await booth.api('POST', `/api/sessions/${session.id}/share`);
    const failed = await waitFor(async () => {
      const s = (await booth.api('GET', `/api/sessions/${session.id}/share`)).json;
      return s.state === 'failed' ? s : null;
    });
    assert.match(failed.error, /bad signature/);

    const status = await booth.operator('GET', '/api/operator/status');
    assert.equal(status.json.sharing.uploads[0].status, 'failed');
    assert.equal(JSON.stringify(status.json).includes('x'.repeat(24)), false, 'the upload secret is never sent to the operator panel');

    up.failWith(null);
    assert.equal((await booth.operator('POST', `/api/operator/uploads/${status.json.sharing.uploads[0].id}/retry`)).status, 200);
    await waitFor(async () => (await booth.api('GET', `/api/sessions/${session.id}/share`)).json.ready);
    assert.equal((await booth.operator('POST', '/api/operator/uploads/nope/retry')).status, 404);
  });
});

test('operator "check web host" runs the signed round trip in upload mode, and explains itself otherwise', async () => {
  await withBooth({ overrides: uploadOverrides, uploader: fakeUploader() }, async (booth) => {
    const res = await booth.operator('POST', '/api/operator/check-upload');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true, detail: 'fake web host' });
    assert.equal((await booth.api('POST', '/api/operator/check-upload')).status, 401, 'needs the PIN');
  });
  await withBooth({ overrides: localOverrides }, async (booth) => {
    assert.equal((await booth.operator('POST', '/api/operator/check-upload')).status, 409);
  });
});

// ------------------------------------------------------------------ disabled

test('with sharing off there are no tokens, no QR on the print, and the share endpoints say so', async () => {
  await withBooth({}, async (booth) => {
    const session = await finishSession(booth);
    assert.equal(sessionJson(booth, session.id).share, null);
    assert.equal((await booth.api('POST', `/api/sessions/${session.id}/share`)).status, 409);
    await booth.api('POST', `/api/sessions/${session.id}/compose`);
    const finalFile = path.join(booth.config.storage.dir, 'default', session.id, 'final.jpg');
    assert.equal(await decodeQrFrom(finalFile), null, 'no QR is printed');
    assert.equal((await booth.api('GET', '/api/state')).json.sharing.enabled, false);
  });
});

test('share tokens survive a restart: an older session is still reachable at its link', async () => {
  const first = await startBooth({ overrides: localOverrides });
  try {
    const session = await finishSession(first);
    const share = (await first.api('POST', `/api/sessions/${session.id}/share`)).json;
    const token = share.url.split('/s/')[1].replace('/', '');
    await first.shareIndex.flush();

    const { ShareIndex } = await import('../server/share.js');
    const reloaded = await new ShareIndex({ file: path.join(first.config.storage.dir, '_queues', 'share-index.json') }).load();
    assert.deepEqual(reloaded.get(token), { eventSlug: 'default', sessionId: session.id });
  } finally {
    await first.close();
  }
});
