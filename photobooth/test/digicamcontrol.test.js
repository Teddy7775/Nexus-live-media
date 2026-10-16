import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DigiCamControlCamera, toCameraPath } from '../server/camera/digicamcontrol.js';
import { CameraError } from '../server/camera/errors.js';
import { startFakeDigiCamControl } from './fakeDigiCamControl.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dcc-test-'));
const cfgFor = (baseUrl, extra = {}) => ({
  baseUrl,
  captureTimeoutMs: 3000,
  requestTimeoutMs: 1000,
  fileWaitMs: 800,
  liveView: true,
  stopLiveViewForCapture: true,
  ...extra,
});

async function withCamera(fakeOverrides, cfgExtra, fn) {
  const fake = await startFakeDigiCamControl(fakeOverrides);
  const camera = new DigiCamControlCamera(cfgFor(fake.baseUrl, cfgExtra), { platform: 'linux' });
  const dir = tmp();
  try {
    await fn({ fake, camera, dir });
  } finally {
    await fake.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('toCameraPath sends a full Windows path without an extension, and a plain path elsewhere', () => {
  assert.equal(toCameraPath('C:\\booth\\events\\s1\\originals', 'shot-1-a1', 'win32'), 'C:\\booth\\events\\s1\\originals\\shot-1-a1');
  assert.equal(toCameraPath('/data/s1', 'shot-1-a1', 'linux'), path.join('/data/s1', 'shot-1-a1'));
});

test('status: connected camera is reported with its serial number', async () => {
  await withCamera({}, {}, async ({ camera }) => {
    const status = await camera.status();
    assert.equal(status.connected, true);
    assert.deepEqual(status.cameras, ['TESTSERIAL1']);
  });
});

test('status: the bare reply "OK" means zero cameras, not a camera called OK', async () => {
  await withCamera({ cameras: [] }, {}, async ({ camera }) => {
    const status = await camera.status();
    assert.equal(status.connected, false);
    assert.deepEqual(status.cameras, []);
    assert.match(status.detail, /no camera is connected/i);
  });
});

test('status: an error message from digiCamControl is not mistaken for a serial number', async () => {
  await withCamera({ cameras: ['Object reference not set to an instance of an object'] }, {}, async ({ camera }) => {
    const status = await camera.status();
    assert.equal(status.connected, false);
    assert.match(status.detail, /Object reference/);
  });
});

test('status: web page instead of a reply means "allow web server actions" is off', async () => {
  await withCamera({ actionsEnabled: false }, {}, async ({ camera }) => {
    const status = await camera.status();
    assert.equal(status.connected, false);
    assert.match(status.detail, /Allow web server actions/i);
  });
});

test('status: digiCamControl not running is reported clearly, not thrown', async () => {
  const camera = new DigiCamControlCamera(cfgFor('http://127.0.0.1:1', { requestTimeoutMs: 500 }), { platform: 'linux' });
  const status = await camera.status();
  assert.equal(status.connected, false);
  assert.equal(status.code, 'unavailable');
  assert.match(status.detail, /Cannot reach digiCamControl/);
});

test('capture: asks for the exact target path and returns the saved JPEG', async () => {
  await withCamera({}, {}, async ({ fake, camera, dir }) => {
    const { file } = await camera.capture({ dir, baseName: 'shot-1-a1' });
    assert.equal(file, path.join(dir, 'shot-1-a1.jpg'));
    assert.ok(fs.statSync(file).size > 0);
    const capture = fake.state.commands.find(([slc]) => slc === 'capture');
    assert.equal(capture[1], path.join(dir, 'shot-1-a1'));
  });
});

test('capture: an error text with HTTP 200 is treated as a failure', async () => {
  await withCamera({ captureReply: 'No connected camera' }, {}, async ({ camera, dir }) => {
    await assert.rejects(camera.capture({ dir, baseName: 'x' }), (err) => err instanceof CameraError && err.code === 'capture_failed' && /No connected camera/.test(err.message));
  });
});

test('capture: RAW-only output gives an actionable message', async () => {
  await withCamera({ extension: 'cr2' }, {}, async ({ camera, dir }) => {
    await assert.rejects(camera.capture({ dir, baseName: 'x' }), (err) => err.code === 'capture_failed' && /JPEG/.test(err.message));
  });
});

test('capture: a photo saved under the camera\'s own file name is found quickly via lastcaptured', async () => {
  await withCamera({ writeAs: 'IMG_0042.JPG' }, { fileWaitMs: 4000 }, async ({ fake, camera, dir }) => {
    const started = Date.now();
    const { file } = await camera.capture({ dir, baseName: 'shot-1-a1' });
    assert.equal(file, path.join(dir, 'IMG_0042.JPG'));
    assert.deepEqual(fs.readFileSync(file), fake.jpeg);
    assert.ok(Date.now() - started < 3500, 'recovered well before the full wait time');
  });
});

test('capture: if the file never appears locally, a NEW photo is fetched over HTTP via lastcaptured', async () => {
  const fake = await startFakeDigiCamControl({ writeFile: false, lastCapturedAfter: 'IMG_0001.jpg' });
  const camera = new DigiCamControlCamera(cfgFor(fake.baseUrl, { fileWaitMs: 1500 }), { platform: 'linux' });
  const dir = tmp();
  try {
    fake.state.images.set('IMG_0001.jpg', fake.jpeg);
    const { file } = await camera.capture({ dir, baseName: 'shot-2-a1' });
    assert.equal(file, path.join(dir, 'shot-2-a1.jpg'));
    assert.deepEqual(fs.readFileSync(file), fake.jpeg);
  } finally {
    await fake.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('capture: a STALE lastcaptured (nothing new was shot) is never handed to the guest as their photo', async () => {
  // The previous guest's photo is still what digiCamControl reports, and it is even available over HTTP.
  await withCamera({ writeFile: false, lastCaptured: 'PREVIOUS_GUEST.jpg' }, { fileWaitMs: 1500 }, async ({ fake, camera, dir }) => {
    fake.state.images.set('PREVIOUS_GUEST.jpg', fake.jpeg);
    await assert.rejects(camera.capture({ dir, baseName: 'shot-1-a1' }), (err) => err instanceof CameraError && err.code === 'file_missing');
    assert.equal(fs.existsSync(path.join(dir, 'shot-1-a1.jpg')), false, 'no photo file may be fabricated from the stale name');
  });
});

test('capture: an OLD file in the folder that merely shares the reported name is refused (mtime guard)', async () => {
  await withCamera({ writeFile: false, lastCapturedAfter: 'IMG_0002.jpg' }, { fileWaitMs: 1500 }, async ({ fake, camera, dir }) => {
    const old = path.join(dir, 'IMG_0002.jpg');
    fs.writeFileSync(old, fake.jpeg);
    const minuteAgo = new Date(Date.now() - 60_000);
    fs.utimesSync(old, minuteAgo, minuteAgo);
    await assert.rejects(camera.capture({ dir, baseName: 'shot-1-a1' }), (err) => err.code === 'file_missing');
  });
});

test('capture: success reply but no file anywhere -> file_missing', async () => {
  await withCamera({ writeFile: false }, { fileWaitMs: 400 }, async ({ camera, dir }) => {
    await assert.rejects(camera.capture({ dir, baseName: 'x' }), (err) => err.code === 'file_missing');
  });
});

test('capture: a camera that never answers times out instead of hanging the booth', async () => {
  await withCamera({ hangCapture: true }, { captureTimeoutMs: 300 }, async ({ camera, dir }) => {
    await assert.rejects(camera.capture({ dir, baseName: 'x' }), (err) => err.code === 'timeout');
  });
});

test('commands are serialised: two simultaneous captures never overlap on the camera', async () => {
  await withCamera({ captureDelayMs: 60 }, {}, async ({ fake, camera, dir }) => {
    await Promise.all([camera.capture({ dir, baseName: 'a' }), camera.capture({ dir, baseName: 'b' })]);
    assert.equal(fake.state.maxConcurrent, 1);
    assert.ok(fs.existsSync(path.join(dir, 'a.jpg')) && fs.existsSync(path.join(dir, 'b.jpg')));
  });
});

test('live view: start sends Show then Minimize, frames come back as JPEG, stop sends Hide', async () => {
  await withCamera({}, {}, async ({ fake, camera }) => {
    await camera.startLiveView();
    const names = fake.state.commands.map(([, p1]) => p1);
    assert.deepEqual(names.slice(0, 2), ['LiveViewWnd_Show', 'All_Minimize']);
    const frame = await camera.liveFrame();
    assert.ok(frame && frame[0] === 0xff && frame[1] === 0xd8, 'expected a JPEG');
    await camera.stopLiveView();
    assert.equal(fake.state.commands.at(-1)[1], 'LiveViewWnd_Hide');
    assert.equal(await camera.liveFrame(), null, 'no frames once live view is stopped');
  });
});

test('live view: a non-JPEG answer (live view not running yet) yields null, never an exception', async () => {
  await withCamera({ liveFrame: null }, {}, async ({ camera }) => {
    await camera.startLiveView();
    assert.equal(await camera.liveFrame(), null);
  });
});

test('capture pauses live view, takes the photo, then resumes live view', async () => {
  await withCamera({}, {}, async ({ fake, camera, dir }) => {
    await camera.startLiveView();
    fake.state.commands.length = 0;
    await camera.capture({ dir, baseName: 'shot-1-a1' });
    await camera.stopLiveView(); // queued behind the background resume, so the sequence below is complete
    const sequence = fake.state.commands.map(([slc, p1]) => (slc === 'capture' ? 'capture' : p1));
    // Hide live view -> note what was last captured (so a stale answer can be recognised) -> shoot -> resume live view.
    assert.deepEqual(sequence.slice(0, 4), ['LiveViewWnd_Hide', 'lastcaptured', 'capture', 'LiveViewWnd_Show']);
  });
});
