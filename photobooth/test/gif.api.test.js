import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MockCamera } from '../server/camera/mock.js';
import { startBooth, waitFor } from './helpers.js';

const gifOverrides = {
  gif: { enabled: true, frames: 4, intervalMs: 100, width: 320, countdownSeconds: 0 },
  sharing: { enabled: true, mode: 'local', publicBaseUrl: 'http://gallery.test:3001' },
};

async function withBooth(options, fn) {
  const booth = await startBooth({ overrides: gifOverrides, ...options });
  try {
    await fn(booth);
  } finally {
    await booth.close();
  }
}

async function shootAll(booth) {
  const session = (await booth.api('POST', '/api/sessions')).json;
  for (let i = 0; i < session.shotsNeeded; i++) assert.equal((await booth.api('POST', `/api/sessions/${session.id}/shots`)).status, 200);
  return session;
}

const sessionDir = (booth, session) => path.join(booth.config.storage.dir, 'default', session.id);
const sessionJson = (booth, session) => JSON.parse(fs.readFileSync(path.join(sessionDir(booth, session), 'session.json'), 'utf8'));

test('a GIF is recorded from the live view, saved with the session, and offered in the guest gallery', async () => {
  await withBooth({}, async (booth) => {
    const state = (await booth.api('GET', '/api/state')).json;
    assert.deepEqual(state.gif, { enabled: true, countdownSeconds: 0, frames: 4, intervalMs: 100 });

    const session = await shootAll(booth);
    const res = await booth.api('POST', `/api/sessions/${session.id}/gif`);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.frames, 4);

    const file = path.join(sessionDir(booth, session), 'animation.gif');
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.subarray(0, 6).toString(), 'GIF89a');
    const meta = await sharp(bytes, { animated: true }).metadata();
    assert.equal(meta.pages, 6, '4 live-view frames, played forwards then backwards');
    assert.deepEqual(meta.delay, Array(6).fill(100));
    assert.equal(sessionJson(booth, session).gif.frames, 4);

    const served = await fetch(`${booth.url}${res.json.url}`);
    assert.equal(served.status, 200);
    assert.match(served.headers.get('content-type'), /image\/gif/);

    // It shows up in the gallery a guest opens from the QR code.
    const share = (await booth.api('POST', `/api/sessions/${session.id}/share`)).json;
    const token = share.url.split('/s/')[1].replace('/', '');
    const page = await (await fetch(`${booth.lanUrl}/s/${token}/`)).text();
    assert.match(page, /Your GIF/);
    const gallery = await fetch(`${booth.lanUrl}/s/${token}/animation.gif`);
    assert.equal(gallery.status, 200);
    assert.match(gallery.headers.get('content-type'), /image\/gif/);
    assert.deepEqual(Buffer.from(await gallery.arrayBuffer()), bytes);
  });
});

test('recording a GIF after the picture was finished makes the old picture and gallery stale, so they are rebuilt with the GIF', async () => {
  await withBooth({}, async (booth) => {
    const session = await shootAll(booth);
    const first = (await booth.api('POST', `/api/sessions/${session.id}/share`)).json;
    assert.equal(first.ready, true);
    const token = first.url.split('/s/')[1].replace('/', '');
    assert.equal((await fetch(`${booth.lanUrl}/s/${token}/animation.gif`)).status, 404, 'no GIF yet');

    assert.equal((await booth.api('POST', `/api/sessions/${session.id}/gif`)).status, 200);
    assert.equal(sessionJson(booth, session).final, null, 'the finished picture was invalidated');
    assert.equal(sessionJson(booth, session).status, 'shooting');

    await booth.api('POST', `/api/sessions/${session.id}/share`); // composes again and rebuilds the gallery
    assert.equal((await fetch(`${booth.lanUrl}/s/${token}/animation.gif`)).status, 200, 'the rebuilt gallery now includes the GIF');
  });
});

test('GIFs switched off: the endpoint says so and no live view is touched', async () => {
  await withBooth({ overrides: { sharing: gifOverrides.sharing } }, async (booth) => {
    const session = await shootAll(booth);
    const res = await booth.api('POST', `/api/sessions/${session.id}/gif`);
    assert.equal(res.status, 409);
    assert.equal(res.json.error, 'gif_disabled');
    assert.equal((await booth.api('GET', '/api/state')).json.gif.enabled, false);
  });
});

test('no live view: a friendly error, nothing saved, the session carries on normally', async () => {
  const camera = new MockCamera({ captureDelayMs: 5 });
  camera.liveFrame = async () => null;
  await withBooth({ camera }, async (booth) => {
    const session = await shootAll(booth);
    const res = await booth.api('POST', `/api/sessions/${session.id}/gif`);
    assert.equal(res.status, 503);
    assert.equal(res.json.error, 'no_live_view');
    assert.equal(res.json.message, 'The GIF could not be recorded.');
    assert.match(res.json.detail, /No live view frames/);
    assert.equal(fs.existsSync(path.join(sessionDir(booth, session), 'animation.gif')), false);
    assert.equal(sessionJson(booth, session).gif, null);
    assert.equal((await booth.api('POST', `/api/sessions/${session.id}/compose`)).status, 200, 'the guest can still finish normally');
  });
});

test('a frozen live view (the same frame forever) does not produce a fake "animation"', async () => {
  const camera = new MockCamera({ captureDelayMs: 5 });
  const frozen = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#808080' } }).jpeg().toBuffer();
  camera.liveFrame = async () => frozen;
  await withBooth({ camera }, async (booth) => {
    const session = await shootAll(booth);
    const res = await booth.api('POST', `/api/sessions/${session.id}/gif`);
    assert.equal(res.status, 503);
    assert.match(res.json.detail, /Only 1 live view frame/);
  });
});

test('a GIF cannot be recorded while a photo is being taken (one camera, one job at a time)', async () => {
  const camera = new MockCamera({ captureDelayMs: 400 });
  await withBooth({ camera }, async (booth) => {
    const session = (await booth.api('POST', '/api/sessions')).json;
    const [shot, gif] = await Promise.all([
      booth.api('POST', `/api/sessions/${session.id}/shots`),
      (async () => {
        await new Promise((r) => setTimeout(r, 80));
        return booth.api('POST', `/api/sessions/${session.id}/gif`);
      })(),
    ]);
    assert.equal(shot.status, 200);
    assert.equal(gif.status, 409);
    assert.equal(gif.json.error, 'busy');
    // ...and the lock is released afterwards.
    assert.equal((await booth.api('POST', `/api/sessions/${session.id}/gif`)).status, 200);
  });
});

test('upload mode: the GIF is sent to the web host before index.html', async () => {
  const uploaded = [];
  const uploader = { uploadFile: async (a) => { uploaded.push(a.name); return { ok: true }; }, check: async () => ({ ok: true, detail: 'fake' }) };
  const overrides = {
    gif: gifOverrides.gif,
    sharing: { enabled: true, mode: 'upload', publicBaseUrl: 'https://photos.example.com/booth', upload: { url: 'https://photos.example.com/booth/upload.php', secret: 'x'.repeat(24) } },
  };
  await withBooth({ overrides, uploader }, async (booth) => {
    const session = await shootAll(booth);
    await booth.api('POST', `/api/sessions/${session.id}/gif`);
    await booth.api('POST', `/api/sessions/${session.id}/share`);
    await waitFor(async () => (await booth.api('GET', `/api/sessions/${session.id}/share`)).json.ready);
    assert.deepEqual(uploaded, ['final.jpg', 'shot-1.jpg', 'shot-2.jpg', 'shot-3.jpg', 'animation.gif', 'index.html']);
  });
});

test('config: GIFs need live view when a real camera is used', async () => {
  const { DEFAULTS, deepMerge, validateConfig } = await import('../server/config.js');
  const problems = (o) => { try { validateConfig(deepMerge(DEFAULTS, o)); return []; } catch (e) { return e.problems; } };
  assert.match(problems({ gif: { enabled: true }, camera: { driver: 'digicamcontrol', digicamcontrol: { liveView: false } } }).join('|'), /gif\.enabled needs live view/);
  assert.deepEqual(problems({ gif: { enabled: true }, camera: { driver: 'digicamcontrol' } }), []);
  assert.deepEqual(problems({ gif: { enabled: true } }), []);
  assert.match(problems({ gif: { frames: 2 } }).join('|'), /gif\.frames/);
  assert.match(problems({ gif: { intervalMs: 50 } }).join('|'), /gif\.intervalMs/);
});
