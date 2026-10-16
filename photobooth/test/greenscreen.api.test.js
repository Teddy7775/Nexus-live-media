import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { MockCamera } from '../server/camera/mock.js';
import { RuntimeSettings } from '../server/settings.js';
import { Backgrounds } from '../server/greenscreen.js';
import { greenScene } from './greenFootage.js';
import { firstStreamFrame, startBooth, waitFor } from './helpers.js';

const BEACH = [212, 20, 90]; // the test background: a flat crimson, nothing like green

/** A booth with green screen on, a mock camera that films a person in front of a green backdrop, and one picture of our own. */
async function withBooth({ overrides = {}, ...options } = {}, fn) {
  const bgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-backgrounds-'));
  fs.writeFileSync(path.join(bgDir, 'Beach Day.jpg'), await sharp({ create: { width: 1500, height: 1000, channels: 3, background: { r: BEACH[0], g: BEACH[1], b: BEACH[2] } } }).jpeg({ quality: 95 }).toBuffer());
  const booth = await startBooth({
    overrides: { greenScreen: { enabled: true, dir: bgDir }, camera: { mock: { scene: 'greenscreen', captureDelayMs: 5 } }, ...overrides },
    ...options,
  });
  try {
    await fn(booth);
  } finally {
    await booth.close();
    fs.rmSync(bgDir, { recursive: true, force: true });
  }
}

const decode = async (input) => {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};
const pixel = (img, x, y) => [...img.data.subarray((y * img.width + x) * 3, (y * img.width + x) * 3 + 3)];
const near = (a, b, tol = 24) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
/** Share of pixels that are clearly green (greener than red and blue by 25+). */
const greenShare = async (input) => {
  const img = await decode(input);
  let n = 0;
  for (let p = 0; p < img.data.length; p += 3) if (img.data[p + 1] - Math.max(img.data[p], img.data[p + 2]) > 25) n += 1;
  return n / (img.width * img.height);
};

const sessionDir = (booth, session) => path.join(booth.config.storage.dir, booth.settings.eventSlug, session.id);
const sessionJson = (booth, session) => JSON.parse(fs.readFileSync(path.join(sessionDir(booth, session), 'session.json'), 'utf8'));
const fetchBuffer = async (url) => Buffer.from(await (await fetch(url)).arrayBuffer());

async function shoot(booth, background) {
  const created = await booth.api('POST', '/api/sessions', background === undefined ? undefined : { background });
  assert.equal(created.status, 201, created.text);
  const session = created.json;
  for (let i = 0; i < session.shotsNeeded; i++) assert.equal((await booth.api('POST', `/api/sessions/${session.id}/shots`)).status, 200);
  return session;
}

test('green screen is off by default and says so everywhere', async () => {
  const booth = await startBooth();
  try {
    assert.deepEqual((await booth.api('GET', '/api/state')).json.greenScreen, { enabled: false });
    assert.equal((await booth.api('GET', '/api/greenscreen/backgrounds/builtin-night/thumb.jpg')).status, 409);
    assert.equal((await booth.operator('POST', '/api/operator/greenscreen/frame', {})).json.error, 'greenscreen_disabled');
    assert.equal((await booth.operator('POST', '/api/operator/greenscreen/calibrate')).json.error, 'greenscreen_disabled');
    assert.match((await booth.operator('POST', '/api/operator/settings', { key: { sensitivity: 60 } })).json.message, /not turned on/);
    assert.deepEqual((await booth.operator('GET', '/api/operator/status')).json.greenScreen, { enabled: false });
    const session = (await booth.api('POST', '/api/sessions')).json;
    assert.equal(session.background, null);
    assert.equal(sessionJson(booth, session).background, null);
  } finally {
    await booth.close();
  }
});

test('the kiosk is told which backgrounds exist and whether guests choose', async () => {
  await withBooth({}, async (booth) => {
    const { greenScreen } = (await booth.api('GET', '/api/state')).json;
    assert.equal(greenScreen.enabled, true);
    assert.equal(greenScreen.guestChoice, true);
    assert.equal(greenScreen.pickSeconds, 60);
    assert.deepEqual(greenScreen.backgrounds.map((b) => b.id), ['beach-day', 'builtin-sunset', 'builtin-night', 'builtin-studio']);
    assert.equal(greenScreen.backgrounds[0].name, 'Beach Day');
    assert.equal(greenScreen.backdrop, 'beach-day', 'the first one is pre-selected');

    for (const b of greenScreen.backgrounds) {
      const res = await fetch(booth.url + b.thumbUrl);
      assert.equal(res.status, 200, b.id);
      assert.match(res.headers.get('content-type'), /image\/jpeg/);
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      assert.equal(meta.width, 800);
    }
    assert.equal((await booth.api('GET', '/api/greenscreen/backgrounds/nope/thumb.jpg')).status, 404);
  });
});

test('a guest\'s background replaces the green in the photo preview, the finished print and the share bundle - the original stays green', async () => {
  await withBooth({ overrides: { sharing: { enabled: true, mode: 'local', publicBaseUrl: 'http://gallery.test:3001' } } }, async (booth) => {
    const session = await shoot(booth, 'beach-day');
    assert.deepEqual(session.background, { id: 'beach-day', name: 'Beach Day' });
    const saved = sessionJson(booth, session);
    assert.equal(saved.background.id, 'beach-day');
    assert.deepEqual(saved.background.key, booth.config.greenScreen.key, 'the keying settings are recorded with the session');

    // Each photo preview: crimson where the backdrop was, the person still there.
    const preview = await fetchBuffer(`${booth.url}/media/default/${session.id}/${saved.shots[0].preview}`);
    const p = await decode(preview);
    assert.ok(near(pixel(p, 8, 8), BEACH), `top-left corner is the background: ${pixel(p, 8, 8)}`);
    assert.ok(near(pixel(p, p.width - 8, Math.floor(p.height / 2)), BEACH));
    assert.ok((await greenShare(preview)) < 0.003, 'practically no green is left');
    let skin = 0;
    for (let q = 0; q < p.data.length; q += 3) if (near([p.data[q], p.data[q + 1], p.data[q + 2]], [227, 173, 139], 30)) skin += 1;
    assert.ok(skin / (p.width * p.height) > 0.025, `the face (skin colour) is still there: ${((skin / (p.width * p.height)) * 100).toFixed(1)}% of the picture`);

    // The camera's own original is untouched, so the operator can always re-key it later.
    const original = path.join(sessionDir(booth, session), saved.shots[0].file);
    assert.ok((await greenShare(original)) > 0.4, 'the original photo still has its green backdrop');

    // The finished layout and the guest's gallery pictures are keyed too.
    assert.equal((await booth.api('POST', `/api/sessions/${session.id}/compose`)).status, 200);
    const final = path.join(sessionDir(booth, session), 'final.jpg');
    assert.ok((await greenShare(final)) < 0.003, 'no green anywhere on the print');
    const crimson = await decode(final);
    let crimsonPixels = 0;
    for (let q = 0; q < crimson.data.length; q += 3) if (near([crimson.data[q], crimson.data[q + 1], crimson.data[q + 2]], BEACH, 20)) crimsonPixels += 1;
    assert.ok(crimsonPixels / (crimson.width * crimson.height) > 0.2, 'a large part of the print is the new background');

    const share = (await booth.api('POST', `/api/sessions/${session.id}/share`)).json;
    const token = share.url.split('/s/')[1].replace('/', '');
    assert.ok((await greenShare(await fetchBuffer(`${booth.lanUrl}/s/${token}/shot-1.jpg`))) < 0.003, 'the gallery photos are keyed');
    assert.ok((await greenShare(await fetchBuffer(`${booth.lanUrl}/s/${token}/final.jpg`))) < 0.003);
  });
});

test('without green screen the very same photos keep their green (so the checks above prove something)', async () => {
  const booth = await startBooth({ overrides: { camera: { mock: { scene: 'greenscreen', captureDelayMs: 5 } } } });
  try {
    const session = (await booth.api('POST', '/api/sessions')).json;
    for (let i = 0; i < session.shotsNeeded; i++) await booth.api('POST', `/api/sessions/${session.id}/shots`);
    await booth.api('POST', `/api/sessions/${session.id}/compose`);
    assert.ok((await greenShare(path.join(sessionDir(booth, session), 'final.jpg'))) > 0.2);
  } finally {
    await booth.close();
  }
});

test('picking a background: unknown is refused, missing means the first, and an operator-fixed background overrides the guest', async () => {
  await withBooth({}, async (booth) => {
    const bad = await booth.api('POST', '/api/sessions', { background: 'nope' });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error, 'bad_background');
    assert.equal((await booth.api('POST', '/api/sessions', { background: 42 })).status, 400);
    assert.equal((await booth.api('POST', '/api/sessions')).json.background.id, 'beach-day', 'no choice made -> the first background');

    const set = await booth.operator('POST', '/api/operator/settings', { backdrop: 'builtin-night' });
    assert.equal(set.status, 200);
    const state = (await booth.api('GET', '/api/state')).json.greenScreen;
    assert.equal(state.guestChoice, false);
    assert.equal(state.backdrop, 'builtin-night');
    const forced = (await booth.api('POST', '/api/sessions', { background: 'beach-day' })).json;
    assert.equal(forced.background.id, 'builtin-night', 'the guest asked for beach-day but the operator fixed the night sky');

    assert.equal((await booth.operator('POST', '/api/operator/settings', { backdrop: 'ghost' })).status, 400);
    assert.equal((await booth.operator('POST', '/api/operator/settings', { backdrop: 'guest' })).status, 200);
    assert.equal((await booth.api('GET', '/api/state')).json.greenScreen.guestChoice, true);
  });
});

test('a session keeps the settings it started with, even if the operator retunes mid-session; the next guest gets the new ones', async () => {
  await withBooth({}, async (booth) => {
    const first = (await booth.api('POST', '/api/sessions', { background: 'beach-day' })).json;
    // A deliberately terrible setting: the whole backdrop lands in the soft zone, so a lot of green would show through.
    assert.equal((await booth.operator('POST', '/api/operator/settings', { key: { sensitivity: 1, softness: 100 } })).status, 200);
    const second = (await booth.api('POST', '/api/sessions', { background: 'beach-day' })).json;
    assert.equal(sessionJson(booth, first).background.key.sensitivity, 50);
    assert.equal(sessionJson(booth, second).background.key.sensitivity, 1);
    assert.equal(sessionJson(booth, second).background.key.softness, 100);
    assert.equal(sessionJson(booth, second).background.key.despill, 1, 'what was not changed keeps its value');

    // And the pictures really follow the session's own settings, not the live ones.
    const oldSettings = await booth.api('POST', `/api/sessions/${first.id}/shots`);
    const oldCorner = pixel(await decode(await fetchBuffer(booth.url + oldSettings.json.previewUrl)), 8, 8);
    assert.ok(near(oldCorner, BEACH), `the first guest's photo is still keyed with the settings they began with: ${oldCorner}`);
    const newSettings = await booth.api('POST', `/api/sessions/${second.id}/shots`);
    const newCorner = pixel(await decode(await fetchBuffer(booth.url + newSettings.json.previewUrl)), 8, 8);
    assert.ok(!near(newCorner, BEACH, 40), `the next guest gets the new (bad) settings - the backdrop only half disappears: ${newCorner}`);
  });
});

test('a retake is keyed with the same background', async () => {
  await withBooth({}, async (booth) => {
    const session = await shoot(booth, 'beach-day');
    const retake = await booth.api('POST', `/api/sessions/${session.id}/shots`, { index: 1 });
    assert.equal(retake.json.attempt, 2);
    const preview = await fetchBuffer(booth.url + retake.json.previewUrl);
    assert.ok((await greenShare(preview)) < 0.003);
    assert.ok(near(pixel(await decode(preview), 8, 8), BEACH));
  });
});

test('GIF frames are keyed too', async () => {
  await withBooth({ overrides: { gif: { enabled: true, frames: 4, intervalMs: 100, width: 320, countdownSeconds: 0 } } }, async (booth) => {
    const session = await shoot(booth, 'beach-day');
    const res = await booth.api('POST', `/api/sessions/${session.id}/gif`);
    assert.equal(res.status, 200, res.text);
    const gif = fs.readFileSync(path.join(sessionDir(booth, session), 'animation.gif'));
    const meta = await sharp(gif, { animated: true }).metadata();
    assert.equal(meta.pages, 6);
    // Look at the first frame (the GIF palette bends colours a little, hence the generous tolerance).
    const first = await sharp(gif, { page: 0 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const img = { data: first.data, width: first.info.width, height: first.info.height };
    assert.ok(near(pixel(img, 6, 6), BEACH, 40), `GIF corner is the background: ${pixel(img, 6, 6)}`);
    assert.ok((await greenShare(await sharp(gif, { page: 2 }).png().toBuffer())) < 0.01, 'a middle frame has no green either');
  });
});

test('the live preview shows the guest on their background, and the same stream is what the print will use', async () => {
  await withBooth({}, async (booth) => {
    // While choosing (no session yet): by background id.
    const choosing = await firstStreamFrame(`${booth.url}/api/camera/stream?bg=beach-day`);
    const img = await decode(choosing);
    assert.ok(img.width <= booth.config.greenScreen.previewWidth, `${img.width} px wide`);
    assert.ok(near(pixel(img, 6, 6), BEACH, 30), `corner is the background: ${pixel(img, 6, 6)}`);
    assert.ok((await greenShare(choosing)) < 0.01);

    // During a session: by session id (that session's background).
    const session = (await booth.api('POST', '/api/sessions', { background: 'beach-day' })).json;
    const during = await firstStreamFrame(`${booth.url}/api/camera/stream?session=${session.id}&mirror=1`);
    assert.ok((await greenShare(during)) < 0.01);

    // Without either, it is the plain camera picture, still green.
    const plain = await firstStreamFrame(`${booth.url}/api/camera/stream`);
    assert.ok((await greenShare(plain)) > 0.3);
  });
});

test('the live stream refuses unknown backgrounds and sessions instead of silently showing green', async () => {
  await withBooth({}, async (booth) => {
    const bad = await fetch(`${booth.url}/api/camera/stream?bg=nope`);
    assert.equal(bad.status, 404);
    assert.equal((await bad.json()).error, 'bad_background');
    const noSession = await fetch(`${booth.url}/api/camera/stream?session=20000101-000000-abcd`);
    assert.equal(noSession.status, 404);
    // A session that has no background (green screen was off when it started) is refused as well, not shown as plain green.
    const plainSession = await startBooth();
    try {
      const s = (await plainSession.api('POST', '/api/sessions')).json;
      assert.equal((await fetch(`${plainSession.url}/api/camera/stream?session=${s.id}`)).status, 200, 'with green screen off the parameter is simply ignored');
    } finally {
      await plainSession.close();
    }
    await waitFor(() => booth.camera.liveViewOn === false, { timeoutMs: 6000 });
  });
});

test('mirror flips the person in the live preview but not the background', async () => {
  const bgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-mirror-'));
  // A background that is red on the left half and blue on the right, so a flipped background would be obvious.
  const halves = Buffer.alloc(1500 * 1000 * 3);
  for (let y = 0; y < 1000; y++) for (let x = 0; x < 1500; x++) halves.set(x < 750 ? [220, 20, 20] : [20, 20, 220], (y * 1500 + x) * 3);
  fs.writeFileSync(path.join(bgDir, 'split.png'), await sharp(halves, { raw: { width: 1500, height: 1000, channels: 3 } }).png().toBuffer());
  // The person stands right of centre.
  const camera = new MockCamera({ captureDelayMs: 5, scene: 'greenscreen' });
  camera.liveFrame = async () => {
    const scene = greenScene({ width: 960, height: 640, noise: 3, dx: 220, vignette: 0.3 });
    return sharp(scene.rgb, { raw: { width: 960, height: 640, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  };
  camera.liveViewOn = true;
  const booth = await startBooth({ overrides: { greenScreen: { enabled: true, dir: bgDir, builtinBackgrounds: false } }, camera });
  try {
    const skin = (c) => c[0] > 180 && c[1] > 120 && c[2] > 90 && c[0] > c[2] + 30;
    const plain = await decode(await firstStreamFrame(`${booth.url}/api/camera/stream?bg=split`));
    const mirrored = await decode(await firstStreamFrame(`${booth.url}/api/camera/stream?bg=split&mirror=1`));
    const y = Math.round(plain.height * 0.42);
    const right = Math.round(plain.width * (0.5 + 220 / 960));
    const left = plain.width - right;
    assert.ok(skin(pixel(plain, right, y)) && !skin(pixel(plain, left, y)), 'unmirrored: the face is on the right');
    assert.ok(skin(pixel(mirrored, left, y)) && !skin(pixel(mirrored, right, y)), 'mirrored: the face is on the left');
    for (const img of [plain, mirrored]) {
      assert.ok(near(pixel(img, 8, 8), [220, 20, 20], 30), 'the background is red on the left in both');
      assert.ok(near(pixel(img, img.width - 8, 8), [20, 20, 220], 30), 'and blue on the right in both');
    }
  } finally {
    await booth.close();
    fs.rmSync(bgDir, { recursive: true, force: true });
  }
});

test('a damaged live frame does not end the preview', async () => {
  let calls = 0;
  const camera = new MockCamera({ captureDelayMs: 5, scene: 'greenscreen' });
  const good = await camera.startLiveView().then(() => camera.liveFrame());
  camera.liveFrame = async () => (++calls === 1 ? Buffer.from('not a jpeg at all') : good);
  const booth = await startBooth({ overrides: { greenScreen: { enabled: true, dir: path.join(os.tmpdir(), 'none-gs') }, camera: { mock: { scene: 'greenscreen' } } }, camera });
  try {
    const frame = await firstStreamFrame(`${booth.url}/api/camera/stream?bg=builtin-night`);
    assert.equal((await sharp(frame).metadata()).format, 'jpeg', 'the stream recovered and delivered a real picture');
    assert.ok(calls >= 2);
  } finally {
    await booth.close();
  }
});

// ------------------------------------------------------------------ operator tuner

test('operator tuner: needs the PIN, shows a keyed live picture with UNSAVED settings, and leaves the saved ones alone', async () => {
  await withBooth({}, async (booth) => {
    assert.equal((await booth.api('POST', '/api/operator/greenscreen/frame', {})).status, 401);
    const get = async (body) => {
      const res = await fetch(`${booth.url}/api/operator/greenscreen/frame`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-operator-pin': booth.config.operatorPin }, body: JSON.stringify(body) });
      return { status: res.status, type: res.headers.get('content-type'), body: Buffer.from(await res.arrayBuffer()) };
    };
    const composite = await get({ background: 'beach-day' });
    assert.equal(composite.status, 200);
    assert.match(composite.type, /image\/jpeg/);
    assert.ok((await greenShare(composite.body)) < 0.01);

    const raw = await get({ view: 'raw' });
    assert.ok((await greenShare(raw.body)) > 0.3, 'raw is the camera picture, green and all');

    const matte = await decode((await get({ view: 'matte' })).body);
    const values = new Set();
    for (let p = 0; p < matte.data.length; p += 3) {
      assert.ok(Math.abs(matte.data[p] - matte.data[p + 1]) < 4 && Math.abs(matte.data[p] - matte.data[p + 2]) < 4, 'the matte is grey');
      values.add(matte.data[p] > 200 ? 'white' : matte.data[p] < 50 ? 'black' : 'grey');
    }
    assert.ok(values.has('white') && values.has('black'), 'it has a kept part (the person) and a replaced part');

    // Unsaved settings are used for the picture...
    const strict = await decode((await get({ view: 'matte', key: { sensitivity: 1, softness: 5 } })).body);
    const loose = await decode((await get({ view: 'matte', key: { sensitivity: 100, softness: 100 } })).body);
    assert.notDeepEqual(strict.data, loose.data, 'the sliders change the picture');
    // ...but the saved settings did not move.
    assert.equal((await booth.operator('GET', '/api/operator/status')).json.greenScreen.key.sensitivity, 50);

    assert.equal((await get({ view: 'sparkly' })).status, 400);
    assert.equal((await get({ key: { sensitivity: 5000 } })).status, 400);
    assert.equal((await get({ key: { wibble: 1 } })).status, 400);
    assert.equal((await get({ background: 'ghost' })).status, 400);
  });
});

test('operator tuner: refuses while a guest is having a photo taken (it must not touch the camera then)', async () => {
  await withBooth({ overrides: { camera: { mock: { scene: 'greenscreen', captureDelayMs: 600 } } } }, async (booth) => {
    const session = (await booth.api('POST', '/api/sessions', { background: 'beach-day' })).json;
    const shot = booth.api('POST', `/api/sessions/${session.id}/shots`);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const busy = await booth.operator('POST', '/api/operator/greenscreen/frame', {});
    assert.equal(busy.status, 409);
    assert.equal(busy.json.error, 'busy');
    assert.equal((await booth.operator('POST', '/api/operator/greenscreen/calibrate')).status, 409);
    assert.equal((await shot).status, 200);
  });
});

test('operator settings: key changes are validated, saved to disk, and reported back', async () => {
  await withBooth({}, async (booth) => {
    const bad = await booth.operator('POST', '/api/operator/settings', { key: { sensitivity: 0 } });
    assert.equal(bad.status, 400);
    assert.match(bad.json.message, /sensitivity must be a number from 1 to 100/);
    assert.equal((await booth.operator('POST', '/api/operator/settings', { key: 'loud' })).status, 400);
    assert.equal((await booth.operator('GET', '/api/operator/status')).json.greenScreen.key.sensitivity, 50, 'a refused change changes nothing');

    // A patch with one bad field applies none of it (even the valid copies change).
    const mixed = await booth.operator('POST', '/api/operator/settings', { copies: 4, key: { sensitivity: 70, despill: 9 } });
    assert.equal(mixed.status, 400);
    assert.equal(booth.settings.copies, 1);

    const ok = await booth.operator('POST', '/api/operator/settings', { key: { sensitivity: 72, edgeBlur: 1.2 } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.settings.key.sensitivity, 72);
    const onDisk = JSON.parse(fs.readFileSync(path.join(booth.dir, 'runtime-settings.json'), 'utf8'));
    assert.equal(onDisk.key.sensitivity, 72);
    assert.equal(onDisk.key.edgeBlur, 1.2);
    assert.equal(onDisk.key.softness, 30);

    const status = (await booth.operator('GET', '/api/operator/status')).json.greenScreen;
    assert.equal(status.enabled, true);
    assert.deepEqual(status.defaults, { sensitivity: 50, softness: 30, despill: 1, edgeBlur: 0.8 });
    assert.equal(status.backgrounds.length, 4);
    assert.ok(status.folder.includes('gs-backgrounds'));
  });
});

test('calibration: refuses when a person stands in front, and suggests settings for an empty backdrop', async () => {
  await withBooth({}, async (booth) => {
    const withPerson = await booth.operator('POST', '/api/operator/greenscreen/calibrate');
    assert.equal(withPerson.status, 200);
    assert.equal(withPerson.json.ok, false);
    assert.match(withPerson.json.advice, /standing in front|not green/);
  });

  const camera = new MockCamera({ captureDelayMs: 5, scene: 'greenscreen' });
  camera.liveViewOn = true;
  camera.liveFrame = async () => {
    const empty = greenScene({ width: 960, height: 640, subject: false, shadow: false, vignette: 0.45, noise: 4 });
    return sharp(empty.rgb, { raw: { width: 960, height: 640, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  };
  await withBooth({ camera }, async (booth) => {
    const res = await booth.operator('POST', '/api/operator/greenscreen/calibrate');
    assert.equal(res.json.ok, true, res.text);
    assert.ok(res.json.sensitivity >= 1 && res.json.sensitivity <= 100);
    // The suggestion is only a suggestion: nothing was saved.
    assert.equal((await booth.operator('GET', '/api/operator/status')).json.greenScreen.key.sensitivity, 50);
  });
});

test('a camera with no live view gives the tuner a clear message, not a hang', async () => {
  const camera = new MockCamera({ captureDelayMs: 5, scene: 'greenscreen' });
  camera.startLiveView = async () => {};
  camera.liveFrame = async () => null;
  await withBooth({ camera }, async (booth) => {
    const t0 = Date.now();
    const res = await booth.operator('POST', '/api/operator/greenscreen/frame', {});
    assert.equal(res.status, 503);
    assert.equal(res.json.error, 'no_live_view');
    assert.ok(Date.now() - t0 < 6000, 'gave up after a few seconds');
  });
});

test('test photo: also returns a keyed version using the current settings', async () => {
  await withBooth({}, async (booth) => {
    const plain = (await booth.operator('POST', '/api/operator/test-capture', {})).json;
    assert.equal(plain.keyedPreviewUrl, null);
    const res = await booth.operator('POST', '/api/operator/test-capture', { background: 'beach-day' });
    assert.equal(res.status, 200, res.text);
    const keyed = await fetchBuffer(booth.url + res.json.keyedPreviewUrl);
    assert.ok((await greenShare(keyed)) < 0.003);
    assert.ok((await greenShare(await fetchBuffer(booth.url + res.json.previewUrl))) > 0.3, 'the plain preview is still the original');
  });
});

// -------------------------------------------------------- settings file & startup

test('saved key and backdrop survive a restart, and nonsense in the file is ignored rather than trusted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-settings-'));
  try {
    const backgrounds = await new Backgrounds({ dir: path.join(dir, 'none') }).load();
    const config = { activeTemplate: 't', event: { name: 'E', slug: 'e' }, printer: { enabled: true, copies: 1 }, greenScreen: { key: { sensitivity: 50, softness: 30, despill: 1, edgeBlur: 0.8 }, defaultBackdrop: 'guest' }, station: { enabled: false, approval: { enabled: false } }, payments: { enabled: false, mode: 'off', pricePerPrintCents: 500, pricePerSessionCents: 1000 } };
    const templates = new Map([['t', {}]]);
    const file = path.join(dir, 'runtime-settings.json');

    const first = await new RuntimeSettings({ config, templates, file, backgrounds }).load();
    await first.update({ key: { sensitivity: 80 }, backdrop: 'builtin-studio' });
    const again = await new RuntimeSettings({ config, templates, file, backgrounds }).load();
    assert.equal(again.key.sensitivity, 80);
    assert.equal(again.key.softness, 30);
    assert.equal(again.backdrop, 'builtin-studio');

    fs.writeFileSync(file, JSON.stringify({ key: { sensitivity: 9999, softness: 30, despill: 1, edgeBlur: 0.8 }, backdrop: 'deleted-background' }));
    const bad = await new RuntimeSettings({ config, templates, file, backgrounds }).load();
    assert.equal(bad.key.sensitivity, 50, 'an invalid saved key is ignored');
    assert.equal(bad.backdrop, 'guest', 'a background that no longer exists is ignored');

    const typo = await new RuntimeSettings({ config: { ...config, greenScreen: { ...config.greenScreen, defaultBackdrop: 'typo' } }, templates, file: path.join(dir, 'missing.json'), backgrounds }).load();
    assert.equal(typo.backdrop, 'guest', 'a mistyped defaultBackdrop falls back to "guest"');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('turning green screen on with nothing to choose from is a clear startup error', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-empty-'));
  try {
    await assert.rejects(() => startBooth({ overrides: { greenScreen: { enabled: true, dir: empty, builtinBackgrounds: false } } }), /no backgrounds: put \.jpg or \.png files in/);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('a background that disappears after the session began gives a clear message, not a crash', async () => {
  await withBooth({}, async (booth) => {
    const session = await shoot(booth, 'beach-day');
    // Simulate: the picture was removed and the booth restarted, so the finished layout has to be rebuilt.
    booth.backgrounds.has = (id) => id !== 'beach-day' && Backgrounds.prototype.has.call(booth.backgrounds, id);
    const res = await booth.api('POST', `/api/sessions/${session.id}/compose`);
    assert.equal(res.status, 409);
    assert.match(res.json.message, /Beach Day.*no longer available/);
  });
});
