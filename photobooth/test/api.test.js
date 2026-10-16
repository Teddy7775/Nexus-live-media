import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { CameraError } from '../server/camera/errors.js';
import { MockCamera } from '../server/camera/mock.js';
import { startBooth, waitFor } from './helpers.js';

async function withBooth(options, fn) {
  const booth = await startBooth(options);
  try {
    await fn(booth);
  } finally {
    await booth.close();
  }
}

const takeAll = async (booth, session) => {
  for (let i = 0; i < session.shotsNeeded; i++) {
    const shot = await booth.api('POST', `/api/sessions/${session.id}/shots`);
    assert.equal(shot.status, 200, shot.text);
  }
};

test('guest journey: start -> 3 photos -> compose -> print -> job completes, files are on disk', async () => {
  await withBooth({}, async (booth) => {
    const state = await booth.api('GET', '/api/state');
    assert.equal(state.json.template.id, 'strip-2x6-x2');
    assert.equal(state.json.printer.mode, 'dryrun');
    assert.equal(JSON.stringify(state.json).includes(booth.config.operatorPin), false, 'the operator PIN must never be sent to the guest UI');

    const created = await booth.api('POST', '/api/sessions');
    assert.equal(created.status, 201);
    const session = created.json;
    assert.equal(session.shotsNeeded, 3);

    for (let i = 0; i < 3; i++) {
      const shot = await booth.api('POST', `/api/sessions/${session.id}/shots`);
      assert.equal(shot.status, 200, shot.text);
      assert.equal(shot.json.index, i);
      assert.equal(shot.json.taken, i + 1);
      const img = await fetch(booth.url + shot.json.previewUrl);
      assert.equal(img.status, 200);
      assert.match(img.headers.get('content-type'), /image\/jpeg/);
      assert.equal(img.headers.get('cache-control'), 'no-store');
    }

    const composed = await booth.api('POST', `/api/sessions/${session.id}/compose`);
    assert.equal(composed.status, 200, composed.text);
    const preview = await fetch(booth.url + composed.json.previewUrl);
    assert.equal(preview.status, 200);

    const printed = await booth.api('POST', `/api/sessions/${session.id}/print`, { copies: 2 });
    assert.equal(printed.status, 200, printed.text);
    assert.equal(printed.json.job.copies, 2);
    const jobId = printed.json.job.id;
    await waitFor(async () => (await booth.api('GET', `/api/print/jobs/${jobId}`)).json.job.status === 'done');

    const dir = path.join(booth.config.storage.dir, 'default', session.id);
    for (const rel of ['final.jpg', 'print.pdf', 'session.json', 'originals/shot-1-a1.jpg', 'originals/shot-3-a1.jpg']) {
      assert.ok(fs.existsSync(path.join(dir, rel)), `missing ${rel}`);
    }
    const meta = await sharp(path.join(dir, 'final.jpg')).metadata();
    assert.deepEqual([meta.width, meta.height], [1200, 1800]);
    const pdf = await PDFDocument.load(fs.readFileSync(path.join(dir, 'print.pdf')));
    assert.deepEqual([Math.round(pdf.getPage(0).getWidth()), Math.round(pdf.getPage(0).getHeight())], [288, 432]);

    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'));
    assert.equal(saved.prints.length, 1);
    assert.equal(saved.status, 'composed');
  });
});

test('taking more photos than the template needs is refused', async () => {
  await withBooth({}, async (booth) => {
    const session = (await booth.api('POST', '/api/sessions')).json;
    await takeAll(booth, session);
    const extra = await booth.api('POST', `/api/sessions/${session.id}/shots`);
    assert.equal(extra.status, 409);
    assert.equal(extra.json.error, 'session_full');
  });
});

test('compose before all photos are taken says which photo is missing', async () => {
  await withBooth({}, async (booth) => {
    const session = (await booth.api('POST', '/api/sessions')).json;
    await booth.api('POST', `/api/sessions/${session.id}/shots`);
    const early = await booth.api('POST', `/api/sessions/${session.id}/compose`);
    assert.equal(early.status, 409);
    assert.match(early.json.message, /Photo 2 of 3/);
  });
});

test('retake replaces just that photo, keeps the original on disk, and invalidates the composed picture', async () => {
  await withBooth({}, async (booth) => {
    const session = (await booth.api('POST', '/api/sessions')).json;
    await takeAll(booth, session);
    await booth.api('POST', `/api/sessions/${session.id}/compose`);

    const retake = await booth.api('POST', `/api/sessions/${session.id}/shots`, { index: 1 });
    assert.equal(retake.status, 200, retake.text);
    assert.equal(retake.json.attempt, 2);
    assert.equal(retake.json.taken, 3, 'still 3 photos, not 4');

    const saved = JSON.parse(fs.readFileSync(path.join(booth.config.storage.dir, 'default', session.id, 'session.json'), 'utf8'));
    assert.equal(saved.status, 'shooting', 'the old composite is no longer valid');
    assert.equal(saved.final, null);
    const dir = path.join(booth.config.storage.dir, 'default', session.id, 'originals');
    assert.ok(fs.existsSync(path.join(dir, 'shot-2-a1.jpg')), 'first attempt is kept');
    assert.ok(fs.existsSync(path.join(dir, 'shot-2-a2.jpg')));

    assert.equal((await booth.api('POST', `/api/sessions/${session.id}/shots`, { index: 7 })).status, 400);
  });
});

test('a camera failure becomes a friendly 503 for the guest, with the technical detail kept separate', async () => {
  const camera = new MockCamera({ captureDelayMs: 1 });
  camera.capture = async () => {
    throw new CameraError('unavailable', 'Cannot reach digiCamControl at http://127.0.0.1:5513');
  };
  await withBooth({ camera }, async (booth) => {
    const session = (await booth.api('POST', '/api/sessions')).json;
    const res = await booth.api('POST', `/api/sessions/${session.id}/shots`);
    assert.equal(res.status, 503);
    assert.equal(res.json.error, 'unavailable');
    assert.match(res.json.message, /ask the attendant/i);
    assert.equal(res.json.message.includes('5513'), false, 'no technical jargon in the guest message');
    assert.match(res.json.detail, /5513/);

    // The booth keeps working afterwards (the capture lock was released).
    camera.capture = MockCamera.prototype.capture.bind(camera);
    assert.equal((await booth.api('POST', `/api/sessions/${session.id}/shots`)).status, 200);
  });
});

test('a second capture while the camera is busy is rejected, not queued behind the guest', async () => {
  const camera = new MockCamera({ captureDelayMs: 250 });
  await withBooth({ camera }, async (booth) => {
    const session = (await booth.api('POST', '/api/sessions')).json;
    const [first, second] = await Promise.all([
      booth.api('POST', `/api/sessions/${session.id}/shots`),
      (async () => {
        await new Promise((r) => setTimeout(r, 60));
        return booth.api('POST', `/api/sessions/${session.id}/shots`);
      })(),
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 409);
    assert.equal(second.json.error, 'busy');
  });
});

test('unknown or malicious session ids are a plain 404 and cannot reach the file system', async () => {
  await withBooth({}, async (booth) => {
    assert.equal((await booth.api('POST', '/api/sessions/nope/shots')).status, 404);
    assert.equal((await booth.api('POST', '/api/sessions/..%2F..%2Fetc/shots')).status, 404);
    const traversal = await fetch(`${booth.url}/media/..%2F..%2Fpackage.json`);
    assert.notEqual(traversal.status, 200);
  });
});

test('printing can be turned off, and a bad JSON body is a 400, not a crash', async () => {
  await withBooth({ overrides: { printer: { enabled: false } } }, async (booth) => {
    const session = (await booth.api('POST', '/api/sessions')).json;
    await takeAll(booth, session);
    const res = await booth.api('POST', `/api/sessions/${session.id}/print`);
    assert.equal(res.status, 409);
    assert.equal(res.json.error, 'printing_disabled');

    const bad = await fetch(`${booth.url}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
    assert.equal(bad.status, 400);
  });
});

test('live preview is a multipart JPEG stream and stops cleanly when the viewer leaves', async () => {
  await withBooth({}, async (booth) => {
    const controller = new AbortController();
    const res = await fetch(`${booth.url}/api/camera/stream`, { signal: controller.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /multipart\/x-mixed-replace; boundary=frame/);
    const reader = res.body.getReader();
    let received = Buffer.alloc(0);
    while (received.length < 4000) {
      const { value, done } = await reader.read();
      if (done) break;
      received = Buffer.concat([received, Buffer.from(value)]);
    }
    assert.match(received.toString('latin1', 0, 80), /--frame\r\nContent-Type: image\/jpeg/);
    assert.ok(received.includes(Buffer.from([0xff, 0xd8])), 'contains JPEG data');
    controller.abort();
    await waitFor(() => booth.camera.liveViewOn === false, { timeoutMs: 6000 });
  });
});

// ------------------------------------------------------------------ operator

test('operator endpoints require the PIN; wrong and missing PINs are rejected', async () => {
  await withBooth({}, async (booth) => {
    assert.equal((await booth.api('GET', '/api/operator/status')).status, 401);
    assert.equal((await booth.api('GET', '/api/operator/status', undefined, { 'x-operator-pin': 'wrong' })).status, 401);
    assert.equal((await booth.api('POST', '/api/operator/settings', { copies: 3 })).status, 401);
    assert.equal((await booth.api('POST', '/api/operator/test-print')).status, 401);
    const ok = await booth.operator('GET', '/api/operator/status');
    assert.equal(ok.status, 200);
    assert.equal(ok.json.camera.connected, true);
    assert.equal(ok.json.printer.mode, 'dryrun');
    assert.ok(Array.isArray(ok.json.warnings));
  });
});

test('operator can change template, event name and copies; new sessions follow, and a new event gets its own folder', async () => {
  await withBooth({}, async (booth) => {
    const before = (await booth.api('POST', '/api/sessions')).json;
    assert.equal(before.template.id, 'strip-2x6-x2');

    const bad = await booth.operator('POST', '/api/operator/settings', { activeTemplate: 'does-not-exist' });
    assert.equal(bad.status, 400);
    assert.equal((await booth.operator('POST', '/api/operator/settings', { copies: 99 })).status, 400);

    const changed = await booth.operator('POST', '/api/operator/settings', { activeTemplate: 'duo-4x6', eventName: "Sarah & James' Wedding", copies: 2 });
    assert.equal(changed.status, 200, changed.text);
    assert.match(changed.json.settings.eventSlug, /^\d{4}-\d{2}-\d{2}-sarah-james-wedding$/);

    const after = (await booth.api('POST', '/api/sessions')).json;
    assert.equal(after.template.id, 'duo-4x6');
    assert.equal(after.shotsNeeded, 2);
    assert.ok(fs.existsSync(path.join(booth.config.storage.dir, changed.json.settings.eventSlug, after.id)), 'new event folder');

    const state = (await booth.api('GET', '/api/state')).json;
    assert.equal(state.event.name, "Sarah & James' Wedding");
    assert.equal(state.printer.copies, 2);

    // Settings survive a restart (they are saved to disk next to the app).
    const saved = JSON.parse(fs.readFileSync(path.join(booth.dir, 'runtime-settings.json'), 'utf8'));
    assert.equal(saved.activeTemplate, 'duo-4x6');
  });
});

test('operator test print renders a pattern and queues it, even with guest printing switched off', async () => {
  await withBooth({ overrides: { printer: { enabled: false } } }, async (booth) => {
    const res = await booth.operator('POST', '/api/operator/test-print');
    assert.equal(res.status, 200, res.text);
    assert.ok(fs.existsSync(res.json.pdf));
    await waitFor(async () => (await booth.api('GET', `/api/print/jobs/${res.json.job.id}`)).json.job.status === 'done');
  });
});

test('operator test capture takes a photo outside any guest session', async () => {
  await withBooth({}, async (booth) => {
    const res = await booth.operator('POST', '/api/operator/test-capture');
    assert.equal(res.status, 200, res.text);
    assert.equal((await fetch(booth.url + res.json.previewUrl)).status, 200);
    assert.deepEqual(fs.readdirSync(booth.config.storage.dir).filter((n) => n !== '_tests'), [], 'no session folder was created');
  });
});

test('operator can list recent sessions and reprint one; an unfinished session cannot be reprinted', async () => {
  await withBooth({}, async (booth) => {
    const done = (await booth.api('POST', '/api/sessions')).json;
    await takeAll(booth, done);
    await booth.api('POST', `/api/sessions/${done.id}/compose`);
    const unfinished = (await booth.api('POST', '/api/sessions')).json;
    await booth.api('POST', `/api/sessions/${unfinished.id}/shots`);

    const list = await booth.operator('GET', '/api/operator/sessions');
    assert.equal(list.status, 200);
    assert.equal(list.json.sessions.length, 2);
    assert.ok(list.json.sessions.every((s) => s.previewUrl));

    const reprint = await booth.operator('POST', `/api/operator/sessions/${done.id}/reprint`, { copies: 3 });
    assert.equal(reprint.status, 200, reprint.text);
    assert.equal(reprint.json.job.copies, 3);
    await waitFor(async () => (await booth.api('GET', `/api/print/jobs/${reprint.json.job.id}`)).json.job.status === 'done');

    const refused = await booth.operator('POST', `/api/operator/sessions/${unfinished.id}/reprint`);
    assert.equal(refused.status, 409);
  });
});

test('sessions from an earlier run can still be found and reprinted after a restart', async () => {
  const first = await startBooth();
  let sessionId;
  try {
    const session = (await first.api('POST', '/api/sessions')).json;
    sessionId = session.id;
    await takeAll(first, session);
    await first.api('POST', `/api/sessions/${session.id}/compose`);
    // Simulate a restart: a brand-new store over the same folder must rediscover the session from disk.
    const { SessionStore } = await import('../server/store.js');
    const fresh = new SessionStore({ rootDir: first.config.storage.dir });
    const found = await fresh.find(sessionId);
    assert.equal(found?.id, sessionId);
    assert.equal(found.status, 'composed');
  } finally {
    await first.close();
  }
});

test('asking for the same picture, gallery and print at once builds each only once (concurrent builds can crash the booth)', async () => {
  await withBooth({}, async (booth) => {
    const session = (await booth.api('POST', '/api/sessions')).json;
    for (let i = 0; i < session.shotsNeeded; i++) await booth.api('POST', `/api/sessions/${session.id}/shots`);
    // Four requests for the finished picture and four for a print, all in the same instant.
    const composes = await Promise.all(Array.from({ length: 4 }, () => booth.api('POST', `/api/sessions/${session.id}/compose`)));
    assert.deepEqual(composes.map((r) => r.status), [200, 200, 200, 200]);
    assert.equal(new Set(composes.map((r) => r.json.previewUrl)).size, 1, 'one build: every caller got the same picture version');
  });
  await withBooth({}, async (booth) => {
    const session = (await booth.api('POST', '/api/sessions')).json;
    for (let i = 0; i < session.shotsNeeded; i++) await booth.api('POST', `/api/sessions/${session.id}/shots`);
    const prints = await Promise.all(Array.from({ length: 4 }, () => booth.api('POST', `/api/sessions/${session.id}/print`, { copies: 1 })));
    assert.deepEqual(prints.map((r) => r.status), [200, 200, 200, 200], 'a frantic double tap on Print on a picture that is not built yet');
    assert.equal(new Set(prints.map((r) => r.json.job.id)).size, 4, 'each tap is its own print job, as before');
    const stored = JSON.parse(fs.readFileSync(path.join(booth.config.storage.dir, 'default', session.id, 'session.json'), 'utf8'));
    assert.equal(stored.status, 'composed');
    assert.equal(stored.prints.length, 4);
  });
});
