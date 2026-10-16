import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MockCamera } from '../server/camera/mock.js';
import { startBooth, waitFor } from './helpers.js';
import { StationHub, PRESENCE_MS } from '../server/station.js';
import { startFakeSmtp } from './fakeSmtp.js';

const PIN = 'station-pin-9';

/** A booth with the station on and prints waiting for approval; `clock` lets a test move time. */
async function withStation({ approval = {}, station = {}, overrides = {}, ...options } = {}, fn) {
  const clock = { t: Date.now() };
  const booth = await startBooth({
    now: () => clock.t,
    ...options,
    overrides: {
      station: { enabled: true, pin: PIN, approval: { enabled: true, timeoutSeconds: 30, ...approval }, ...station },
      sharing: { enabled: true, mode: 'local', publicBaseUrl: 'http://gallery.test:3001' },
      ...overrides,
    },
  });
  try {
    await fn({ booth, clock });
  } finally {
    booth.emailQueue?.stop();
    await booth.close();
  }
}

const login = (booth, pin = PIN, headers = {}) =>
  fetch(`${booth.lanUrl}/station/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ pin }) });

async function signIn(booth) {
  const res = await login(booth);
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

/** Station requests, with the signed-in cookie. */
function client(booth, cookie) {
  const call = async (method, route, body, headers = {}) => {
    const res = await fetch(`${booth.lanUrl}/station${route}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, text, headers: res.headers };
  };
  return { get: (r, h) => call('GET', r, undefined, h), post: (r, b, h) => call('POST', r, b ?? {}, h) };
}

/** Opens the live feed like a station's browser does, collecting the events it sends. */
async function openFeed(booth, cookie) {
  const controller = new AbortController();
  const res = await fetch(`${booth.lanUrl}/station/api/events`, { headers: { cookie }, signal: controller.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const events = [];
  (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        for (let i = buffer.indexOf('\n\n'); i >= 0; i = buffer.indexOf('\n\n')) {
          const block = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const type = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (type) events.push({ type, data: JSON.parse(data) });
        }
      }
    } catch {
      /* closed */
    }
  })();
  return { events, close: () => controller.abort(), find: (predicate) => waitFor(() => events.find(predicate), { timeoutMs: 4000 }) };
}

async function finishSession(booth) {
  const session = (await booth.api('POST', '/api/sessions')).json;
  for (let i = 0; i < session.shotsNeeded; i++) assert.equal((await booth.api('POST', `/api/sessions/${session.id}/shots`)).status, 200);
  return session;
}

const sessionDir = (booth, session) => path.join(booth.config.storage.dir, booth.settings.eventSlug, session.id);

// ===================================================================== access

test('with the station off, the booth\'s network port has no station at all', async () => {
  const booth = await startBooth();
  try {
    for (const route of ['/station/', '/station/api/me', '/station/station.js', '/station/api/login']) {
      assert.equal((await fetch(booth.lanUrl + route)).status, 404, route);
    }
    assert.equal((await booth.api('GET', '/api/state')).json.station.approval, false);
    assert.deepEqual((await booth.operator('GET', '/api/operator/status')).json.station.enabled, false);
  } finally {
    await booth.close();
  }
});

test('the page is public but locked down; every piece of data needs the PIN', async () => {
  await withStation({}, async ({ booth }) => {
    const page = await fetch(`${booth.lanUrl}/station/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Booth station/);
    const csp = page.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(`${booth.lanUrl}/station/station.js`)).status, 200);
    const shared = await fetch(`${booth.lanUrl}/station/email-utils.js`);
    assert.equal(shared.status, 200);
    assert.match(shared.headers.get('content-type'), /javascript/);

    const anon = client(booth, null);
    const session = await finishSession(booth);
    const protectedRoutes = [
      ['get', '/api/me'],
      ['get', '/api/snapshot'],
      ['get', '/api/status'],
      ['get', '/api/events'],
      ['post', '/api/ping'],
      ['post', '/api/approvals/approve-all'],
      ['post', '/api/approvals/abc/approve'],
      ['post', '/api/approvals/abc/reject'],
      ['post', `/api/sessions/${session.id}/share`],
      ['post', `/api/sessions/${session.id}/email`],
      ['post', `/api/sessions/${session.id}/reprint`],
      ['get', `/media/${booth.settings.eventSlug}/${session.id}/previews/shot-1-a1.jpg`],
    ];
    for (const [method, route] of protectedRoutes) {
      const res = await anon[method](route);
      assert.equal(res.status, 401, `${method} ${route}`);
      assert.equal(res.json?.error, 'login_required');
    }
    assert.equal((await anon.get('/api/snapshot')).text.includes(session.id), false, 'and nothing leaks in the refusal');
  });
});

test('the booth\'s own API and operator panel are NOT reachable from the network port', async () => {
  await withStation({}, async ({ booth }) => {
    const cookie = await signIn(booth);
    for (const route of ['/api/state', '/api/operator/status', '/api/camera/stream', '/media/default/x/final.jpg', '/operator.html']) {
      const res = await fetch(booth.lanUrl + route, { headers: { cookie, 'x-operator-pin': booth.config.operatorPin } });
      assert.equal(res.status, 404, route);
    }
  });
});

test('signing in: a wrong PIN is slow and refused; the right one sets a locked-down cookie', async () => {
  await withStation({}, async ({ booth }) => {
    const t0 = Date.now();
    const bad = await login(booth, 'not-the-pin');
    assert.equal(bad.status, 401);
    assert.ok(Date.now() - t0 >= 350, 'a wrong guess is deliberately slowed down');
    assert.equal(bad.headers.get('set-cookie'), null);
    assert.equal((await login(booth, '')).status, 401);
    assert.equal((await fetch(`${booth.lanUrl}/station/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"pin": 123456}' })).status, 401, 'a number is not the PIN');

    const ok = await login(booth);
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\/station/);
    assert.match(cookie, /Max-Age=43200/);
    assert.equal((await client(booth, cookie.split(';')[0]).get('/api/me')).status, 200);
  });
});

test('five wrong PINs lock sign-in for a minute, even for the right PIN', async () => {
  await withStation({}, async ({ booth, clock }) => {
    for (let i = 0; i < 5; i++) assert.equal((await login(booth, `wrong-${i}`)).status, 401);
    const locked = await login(booth);
    assert.equal(locked.status, 429, 'the right PIN is refused while locked');
    assert.match((await locked.json()).message, /Too many wrong PINs/);
    clock.t += 61_000;
    assert.equal((await login(booth)).status, 200, 'and works again after the minute');
  });
});

test('a forged, tampered or expired cookie is refused; signing out revokes it', async () => {
  await withStation({}, async ({ booth, clock }) => {
    const cookie = await signIn(booth);
    const value = cookie.split('=')[1];
    const [expires, nonce, mac] = value.split('.');
    assert.equal((await client(booth, cookie).get('/api/me')).status, 200);
    for (const bad of [`booth_station=${expires}.${nonce}.${mac.slice(0, -2)}xx`, `booth_station=${Number(expires) + 1000}.${nonce}.${mac}`, `booth_station=${expires}.${nonce}.`, `booth_station=${expires}.${mac}`, 'booth_station=garbage', `booth_station=${Date.now() + 1e9}.${nonce}.${mac}`]) {
      assert.equal((await client(booth, bad).get('/api/me')).status, 401, bad);
    }
    const out = await client(booth, cookie).post('/api/logout');
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await client(booth, cookie).get('/api/me')).status, 401, 'the old cookie no longer works, even if someone kept a copy');

    const fresh = await signIn(booth);
    assert.equal((await client(booth, fresh).get('/api/me')).status, 200);
    clock.t += 13 * 3600_000;
    assert.equal((await client(booth, fresh).get('/api/me')).status, 401, 'a sign-in lasts 12 hours');
  });
});

test('changes from another website are refused (cookie + cross-site request)', async () => {
  await withStation({}, async ({ booth }) => {
    const cookie = await signIn(booth);
    const s = client(booth, cookie);
    const evil = await s.post('/api/approvals/approve-all', {}, { origin: 'http://evil.example' });
    assert.equal(evil.status, 403);
    assert.equal(evil.json.error, 'bad_origin');
    assert.equal((await s.post('/api/approvals/approve-all', {}, { origin: 'not a url' })).status, 403);
    const host = new URL(booth.lanUrl).host;
    assert.equal((await s.post('/api/approvals/approve-all', {}, { origin: `http://${host}` })).status, 200, 'the station page itself is fine');
    assert.equal((await login(booth, PIN, { origin: 'http://evil.example' })).status, 403, 'even sign-in from elsewhere is refused');
  });
});

test('the station shows pictures only: never originals, print files or session.json (which holds the share link)', async () => {
  await withStation({}, async ({ booth }) => {
    const s = client(booth, await signIn(booth));
    const session = await finishSession(booth);
    await booth.api('POST', `/api/sessions/${session.id}/compose`);
    await booth.api('POST', `/api/sessions/${session.id}/print`, { copies: 1 });
    const base = `/media/${booth.settings.eventSlug}/${session.id}`;
    const ok = await s.get(`${base}/previews/shot-1-a1.jpg`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type'), /image\/jpeg/);
    assert.equal((await s.get(`${base}/final-preview.jpg`)).status, 200);
    for (const forbidden of ['originals/shot-1-a1.jpg', 'session.json', 'print.pdf', 'final.jpg', 'share/index.html', 'previews/../session.json', 'previews/..%2Fsession.json', '%2e%2e/session.json', 'previews/shot-1-a1.jpg.php', 'previews/.hidden.jpg', 'previews/x/y.jpg']) {
      assert.equal((await s.get(`${base}/${forbidden}`)).status, 404, forbidden);
    }
    assert.equal((await s.get(`/media/${booth.settings.eventSlug}/not-a-session/final-preview.jpg`)).status, 404);
    assert.equal((await s.get(`/media/..%2F..%2Fetc/${session.id}/final-preview.jpg`)).status, 404);
    assert.equal((await s.get(`/media/nope-event/${session.id}/final-preview.jpg`)).status, 404);
  });
});

// ================================================================ live feed

test('the station sees sessions live: starting, each photo, the finished picture, the link, the print', async () => {
  await withStation({ approval: { enabled: false } }, async ({ booth }) => {
    const cookie = await signIn(booth);
    const before = await finishSession(booth);
    const feed = await openFeed(booth, cookie);
    const snapshot = (await feed.find((e) => e.type === 'snapshot')).data;
    assert.equal(snapshot.event.name, booth.settings.eventName);
    assert.deepEqual(snapshot.sessions.map((s) => s.id), [before.id], 'the snapshot starts with what already happened');
    assert.equal(snapshot.sessions[0].shotsTaken, 3);
    assert.deepEqual(snapshot.approval, { required: false, timeoutSeconds: 30, onTimeout: 'cancel', maxCopies: 4 });

    const session = (await booth.api('POST', '/api/sessions')).json;
    const started = await feed.find((e) => e.type === 'session' && e.data.id === session.id);
    assert.equal(started.data.shotsTaken, 0);
    assert.equal(started.data.shotsNeeded, 3);

    await booth.api('POST', `/api/sessions/${session.id}/shots`);
    const oneShot = await feed.find((e) => e.type === 'session' && e.data.id === session.id && e.data.shotsTaken === 1);
    assert.equal(oneShot.data.shots.length, 1);
    assert.match(oneShot.data.shots[0], new RegExp(`^/station/media/default/${session.id}/previews/shot-1-a1\\.jpg$`));
    assert.equal(oneShot.data.finalUrl, null);

    await booth.api('POST', `/api/sessions/${session.id}/shots`);
    await booth.api('POST', `/api/sessions/${session.id}/shots`);
    await booth.api('POST', `/api/sessions/${session.id}/compose`);
    const composed = await feed.find((e) => e.type === 'session' && e.data.id === session.id && e.data.finalUrl);
    assert.match(composed.data.finalUrl, /final-preview\.jpg\?v=\d+$/);
    assert.equal((await client(booth, cookie).get(composed.data.finalUrl.replace(/\?.*/, '').replace('/station', ''))).status, 200, 'and the picture really loads through the station');
    assert.equal(composed.data.share.ready, true, 'local mode: the link is ready as soon as the picture is');

    const printed = (await booth.api('POST', `/api/sessions/${session.id}/print`, { copies: 2 })).json;
    assert.ok(printed.job, 'with approval off the guest prints straight away');
    const done = await feed.find((e) => e.type === 'session' && e.data.id === session.id && e.data.print.state === 'done');
    assert.equal(done.data.print.copies, 2);
    feed.close();
  });
});

test('booth health is one call: camera, printer, failed prints', async () => {
  const failing = {
    mode: 'windows',
    status: async () => ({ ok: true, detail: 'Printer ready' }),
    print: async () => {
      throw new Error('Printer is out of paper');
    },
  };
  await withStation({ approval: { enabled: false }, printer: failing }, async ({ booth }) => {
    const s = client(booth, await signIn(booth));
    const first = (await s.get('/api/status')).json;
    assert.equal(first.camera.connected, true);
    assert.equal(first.printer.ok, true);
    assert.deepEqual(first.prints, { waiting: 0, failed: 0, lastError: null });
    const session = await finishSession(booth);
    await booth.api('POST', `/api/sessions/${session.id}/print`, { copies: 1 });
    await waitFor(async () => (await s.get('/api/status')).json.prints.failed === 1);
    assert.equal((await s.get('/api/status')).json.prints.lastError, 'Printer is out of paper');
  });
});

test('the station leaves the camera alone while a photo is being taken', async () => {
  const camera = new MockCamera({ captureDelayMs: 700 });
  let probes = 0;
  const realStatus = camera.status.bind(camera);
  camera.status = async () => {
    probes += 1;
    return realStatus();
  };
  await withStation({ approval: { enabled: false }, camera }, async ({ booth }) => {
    const s = client(booth, await signIn(booth));
    const session = (await booth.api('POST', '/api/sessions')).json;
    assert.equal((await s.get('/api/status')).json.camera.connected, true);
    assert.equal(probes, 1, 'normally the camera is asked');
    const shot = booth.api('POST', `/api/sessions/${session.id}/shots`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const during = (await s.get('/api/status')).json;
    assert.equal(probes, 1, 'but not in the middle of a photo');
    assert.equal(during.camera.connected, true);
    assert.equal(during.camera.detail, 'Taking a photo');
    assert.equal((await shot).status, 200);
  });
});

// =========================================================== print approval

const pending = (booth, id) => booth.api('GET', `/api/print/approvals/${id}`);

async function connectStation(booth) {
  const cookie = await signIn(booth);
  const feed = await openFeed(booth, cookie);
  await feed.find((e) => e.type === 'snapshot');
  return { cookie, feed, s: client(booth, cookie) };
}

test('a print waits for the attendant, then prints once with the copies they chose', async () => {
  await withStation({}, async ({ booth }) => {
    const { feed, s } = await connectStation(booth);
    const session = await finishSession(booth);

    const asked = (await booth.api('POST', `/api/sessions/${session.id}/print`, { copies: 1 })).json;
    assert.equal(asked.approval.status, 'pending');
    assert.equal(asked.job, undefined, 'no print job exists yet');
    assert.equal(booth.queue.list().length, 0);
    assert.equal((await booth.api('GET', '/api/state')).json.station.approval, true);

    const event = await feed.find((e) => e.type === 'approval' && e.data.status === 'pending');
    assert.equal(event.data.sessionId, session.id);
    const shown = await feed.find((e) => e.type === 'session' && e.data.id === session.id && e.data.print.state === 'awaiting');
    assert.ok(shown.data.finalUrl, 'the attendant can see the finished picture while deciding');
    assert.equal((await s.get('/api/snapshot')).json.approvals.length, 1);
    assert.equal((await pending(booth, asked.approval.id)).json.approval.status, 'pending');

    const approved = await s.post(`/api/approvals/${asked.approval.id}/approve`, { copies: 3 });
    assert.equal(approved.status, 200, approved.text);
    assert.equal(approved.json.approval.status, 'approved');
    assert.equal(booth.queue.list().length, 1, 'exactly one print job');
    assert.equal(booth.queue.list()[0].copies, 3);

    const guest = (await pending(booth, asked.approval.id)).json.approval;
    assert.equal(guest.status, 'approved');
    assert.ok(guest.job.id, 'the guest\'s kiosk gets the job to follow');
    assert.equal(guest.estimatedSeconds, booth.config.printer.estimatedSeconds);
    await waitFor(() => booth.queue.get(guest.job.id).status === 'done');
    await feed.find((e) => e.type === 'session' && e.data.id === session.id && e.data.print.state === 'done');

    assert.equal((await s.post(`/api/approvals/${asked.approval.id}/approve`)).status, 409, 'a second approval changes nothing');
    assert.equal(booth.queue.list().length, 1);
    assert.equal(fs.existsSync(path.join(sessionDir(booth, session), 'print.pdf')), true);
    feed.close();
  });
});

test('copies the attendant asks for are checked', async () => {
  await withStation({ approval: { maxCopies: 3 } }, async ({ booth }) => {
    const { feed, s } = await connectStation(booth);
    const session = await finishSession(booth);
    const asked = (await booth.api('POST', `/api/sessions/${session.id}/print`)).json.approval;
    for (const copies of [0, 4, 2.5, '2', -1]) {
      const res = await s.post(`/api/approvals/${asked.id}/approve`, { copies });
      assert.equal(res.status, 400, `copies ${copies}`);
      assert.equal(res.json.error, 'bad_copies');
    }
    assert.equal(booth.queue.list().length, 0, 'still waiting');
    assert.equal((await s.post(`/api/approvals/${asked.id}/approve`, {})).status, 200, 'without a number the guest\'s own choice is used');
    assert.equal(booth.queue.list()[0].copies, booth.settings.copies);
    feed.close();
  });
});

test('rejecting prints nothing, and the guest\'s kiosk is told', async () => {
  await withStation({}, async ({ booth }) => {
    const { feed, s } = await connectStation(booth);
    const session = await finishSession(booth);
    const asked = (await booth.api('POST', `/api/sessions/${session.id}/print`)).json.approval;
    const rejected = await s.post(`/api/approvals/${asked.id}/reject`, { reason: 'eyes closed' });
    assert.equal(rejected.json.approval.status, 'rejected');
    const guest = (await pending(booth, asked.id)).json.approval;
    assert.equal(guest.status, 'rejected');
    assert.equal(guest.job, undefined);
    assert.equal(booth.queue.list().length, 0, 'nothing was printed');
    const seen = await feed.find((e) => e.type === 'session' && e.data.id === session.id && e.data.print.state === 'rejected');
    assert.equal(seen.data.print.reason, 'eyes closed');
    assert.equal((await s.post(`/api/approvals/${asked.id}/reject`)).status, 409);
    assert.equal((await s.post('/api/approvals/does-not-exist/reject')).status, 409);
    feed.close();
  });
});

test('nobody answering: the request expires without printing (default), and the guest is told', async () => {
  await withStation({ approval: { timeoutSeconds: 1 } }, async ({ booth }) => {
    const { feed } = await connectStation(booth);
    const session = await finishSession(booth);
    const asked = (await booth.api('POST', `/api/sessions/${session.id}/print`)).json.approval;
    assert.equal(asked.timeoutSeconds, 1);
    await waitFor(async () => (await pending(booth, asked.id)).json.approval.status === 'expired', { timeoutMs: 4000 });
    const guest = (await pending(booth, asked.id)).json.approval;
    assert.equal(guest.reason, 'timeout');
    assert.equal(booth.queue.list().length, 0);
    await feed.find((e) => e.type === 'approval' && e.data.id === asked.id && e.data.status === 'expired');
    feed.close();
  });
});

test('onTimeout "print": an unanswered request is printed after all', async () => {
  await withStation({ approval: { timeoutSeconds: 1, onTimeout: 'print' } }, async ({ booth }) => {
    const { feed } = await connectStation(booth);
    const session = await finishSession(booth);
    const asked = (await booth.api('POST', `/api/sessions/${session.id}/print`)).json.approval;
    await waitFor(async () => (await pending(booth, asked.id)).json.approval.status === 'approved', { timeoutMs: 4000 });
    assert.ok((await pending(booth, asked.id)).json.approval.job.id);
    assert.equal(booth.queue.list().length, 1);
    feed.close();
  });
});

test('with no station connected, a print request is settled at once instead of making the guest wait', async () => {
  await withStation({}, async ({ booth, clock }) => {
    const session = await finishSession(booth);
    const asked = (await booth.api('POST', `/api/sessions/${session.id}/print`)).json.approval;
    assert.equal(asked.status, 'expired', 'nobody to ask');
    assert.equal(asked.reason, 'no_station');
    assert.equal(booth.queue.list().length, 0);

    // A station that connects counts as online - until it stops pinging.
    const { cookie, feed, s } = await connectStation(booth);
    assert.equal(booth.hub.online(), true);
    assert.equal((await booth.operator('GET', '/api/operator/status')).json.station.online, true);
    clock.t += 25_000;
    assert.equal(booth.hub.online(), false, 'a frozen tab (open connection, no pings) is not a station');
    assert.equal((await s.post('/api/ping')).json.online, true, 'a ping brings it back');
    feed.close();
    void cookie;
  });

  await withStation({ approval: { onTimeout: 'print' } }, async ({ booth }) => {
    const session = await finishSession(booth);
    const asked = (await booth.api('POST', `/api/sessions/${session.id}/print`, { copies: 2 })).json.approval;
    assert.equal(asked.status, 'approved', 'with onTimeout "print" the guest simply prints');
    assert.equal(booth.queue.list()[0].copies, 2);
  });
});

test('a guest who walks away takes their request off the attendant\'s screen', async () => {
  await withStation({}, async ({ booth }) => {
    const { feed, s } = await connectStation(booth);
    const session = await finishSession(booth);
    const asked = (await booth.api('POST', `/api/sessions/${session.id}/print`)).json.approval;
    assert.equal((await booth.api('DELETE', `/api/print/approvals/${asked.id}`)).status, 200);
    await feed.find((e) => e.type === 'approval' && e.data.id === asked.id && e.data.status === 'cancelled');
    assert.equal((await s.get('/api/snapshot')).json.approvals.length, 0);
    assert.equal((await s.post(`/api/approvals/${asked.id}/approve`)).status, 409, 'approving it now would print for nobody');
    assert.equal(booth.queue.list().length, 0);
    assert.equal((await booth.api('DELETE', '/api/print/approvals/nope')).status, 404);
    assert.equal((await booth.api('GET', '/api/print/approvals/nope')).status, 404);
    feed.close();
  });
});

test('a double tap on "print" is one request', async () => {
  await withStation({}, async ({ booth }) => {
    const { feed, s } = await connectStation(booth);
    const session = await finishSession(booth);
    const [a, b] = await Promise.all([booth.api('POST', `/api/sessions/${session.id}/print`), booth.api('POST', `/api/sessions/${session.id}/print`)]);
    assert.equal(a.json.approval.id, b.json.approval.id);
    assert.equal((await s.get('/api/snapshot')).json.approvals.length, 1);
    feed.close();
  });
});

test('approve all prints every waiting guest', async () => {
  await withStation({}, async ({ booth }) => {
    const { feed, s } = await connectStation(booth);
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const session = await finishSession(booth);
      ids.push((await booth.api('POST', `/api/sessions/${session.id}/print`)).json.approval.id);
    }
    assert.equal((await s.get('/api/snapshot')).json.approvals.length, 3);
    const res = await s.post('/api/approvals/approve-all');
    assert.equal(res.json.approved, 3);
    assert.equal(booth.queue.list().length, 3);
    for (const id of ids) assert.equal((await pending(booth, id)).json.approval.status, 'approved');
    assert.equal((await s.post('/api/approvals/approve-all')).json.approved, 0);
    feed.close();
  });
});

test('the operator can switch approval on and off mid-event; reprints by staff never wait', async () => {
  await withStation({}, async ({ booth }) => {
    const session = await finishSession(booth);
    const off = await booth.operator('POST', '/api/operator/settings', { approvalRequired: false });
    assert.equal(off.status, 200);
    assert.equal((await booth.api('GET', '/api/state')).json.station.approval, false);
    const direct = await booth.api('POST', `/api/sessions/${session.id}/print`, { copies: 1 });
    assert.ok(direct.json.job, 'approval off: straight to the printer');
    assert.equal(direct.json.approval, undefined);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(booth.dir, 'runtime-settings.json'), 'utf8')).approvalRequired, false, 'and it is remembered');

    assert.equal((await booth.operator('POST', '/api/operator/settings', { approvalRequired: true })).status, 200);
    const reprint = await booth.operator('POST', `/api/operator/sessions/${session.id}/reprint`, { copies: 1 });
    assert.ok(reprint.json.job, 'the operator\'s own reprint is not held up by approval');
    assert.equal((await booth.operator('POST', '/api/operator/settings', { approvalRequired: 'yes' })).status, 400);
    const status = (await booth.operator('GET', '/api/operator/status')).json.station;
    assert.equal(status.enabled, true);
    assert.equal(status.approvalRequired, true);
    assert.match(status.url, /^http:\/\/.+:\d+\/station\/$/);
  });
});

test('approval cannot be switched on when there is no station to approve', async () => {
  const booth = await startBooth();
  try {
    const res = await booth.operator('POST', '/api/operator/settings', { approvalRequired: true });
    assert.equal(res.status, 400);
    assert.match(res.json.message, /station is not turned on/);
  } finally {
    await booth.close();
  }
});

test('an attendant\'s reprint prints at once (within the copy limit), and is refused when printing is off', async () => {
  await withStation({ approval: { maxCopies: 3 } }, async ({ booth }) => {
    const s = client(booth, await signIn(booth));
    const unfinished = (await booth.api('POST', '/api/sessions')).json;
    assert.equal((await s.post(`/api/sessions/${unfinished.id}/reprint`)).status, 409, 'a session without all its photos cannot be printed');
    const session = await finishSession(booth);
    const res = await s.post(`/api/sessions/${session.id}/reprint`, { copies: 9 });
    assert.equal(res.status, 200, res.text);
    assert.equal(booth.queue.list()[0].copies, 3, 'copies are capped at the station limit');
    assert.equal((await s.post('/api/sessions/20000101-000000-abcd/reprint')).status, 404);
    await booth.operator('POST', '/api/operator/settings', { printEnabled: false });
    assert.equal((await s.post(`/api/sessions/${session.id}/reprint`)).json.error, 'printing_disabled');
  });
});

// ================================================================ sharing

test('the station can show a guest\'s QR code and the link opens their gallery', async () => {
  await withStation({}, async ({ booth }) => {
    const s = client(booth, await signIn(booth));
    const session = await finishSession(booth);
    const res = await s.post(`/api/sessions/${session.id}/share`);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.ready, true);
    assert.match(res.json.qrSvg, /^<svg/);
    assert.match(res.json.url, /^http:\/\/gallery\.test:3001\/s\/[A-Za-z0-9_-]{22}\/$/);
    const token = res.json.url.split('/s/')[1].replace('/', '');
    assert.equal((await fetch(`${booth.lanUrl}/s/${token}/`)).status, 200, 'the gallery behind the QR code is live');
  });
});

test('the station can email a guest their photos (with the same address checks and limits as the kiosk)', async () => {
  const smtp = await startFakeSmtp();
  try {
    await withStation({ overrides: { email: { enabled: true, from: 'Nexus Booth <booth@test.local>', smtp: smtp.smtp(), maxPerSession: 2, maxPerAddressPerHour: 5 } } }, async ({ booth }) => {
      const s = client(booth, await signIn(booth));
      const session = await finishSession(booth);
      assert.equal((await s.post(`/api/sessions/${session.id}/email`, { email: 'not an address' })).json.error, 'invalid_email');
      const ok = await s.post(`/api/sessions/${session.id}/email`, { email: 'Guest@Example.com' });
      assert.equal(ok.status, 200, ok.text);
      assert.equal(ok.json.masked, 'g***@example.com');
      await waitFor(() => smtp.state.messages.length === 1, { timeoutMs: 8000 });
      assert.equal(smtp.state.messages[0].to.value[0].address, 'guest@example.com');
      assert.equal((await s.post(`/api/sessions/${session.id}/email`, { email: 'second@example.com' })).status, 200);
      const limited = await s.post(`/api/sessions/${session.id}/email`, { email: 'third@example.com' });
      assert.equal(limited.status, 429, 'the per-session limit applies at the station too');
      assert.equal((await s.get('/api/snapshot')).json.email.enabled, true);
    });
  } finally {
    await smtp.close();
  }
});

test('email from the station is refused cleanly when email is off', async () => {
  await withStation({}, async ({ booth }) => {
    const s = client(booth, await signIn(booth));
    const session = await finishSession(booth);
    const res = await s.post(`/api/sessions/${session.id}/email`, { email: 'a@example.com' });
    assert.equal(res.status, 409);
    assert.equal(res.json.error, 'email_disabled');
  });
});

// ======================================================== the hub on its own

/** A stand-in for a browser's open event stream. */
const fakeStream = () => ({ written: [], writableEnded: false, destroyed: false, write(chunk) { this.written.push(chunk); }, end() { this.writableEnded = true; } });
const types = (stream) => stream.written.map((w) => /^event: (.*)$/m.exec(w)?.[1]);

test('a new station gets its snapshot first, then anything that happened while the snapshot was being built', () => {
  const hub = new StationHub();
  const station = fakeStream();
  hub.add(station);
  hub.publish('approval', { id: 'a1' }); // arrives while the snapshot is still being put together
  hub.publish('session', { id: 's1' });
  assert.deepEqual(station.written, [], 'nothing is sent before the snapshot, or it could be overwritten by it');
  hub.start(station, 'snapshot', { sessions: [] });
  assert.deepEqual(types(station), ['snapshot', 'approval', 'session'], 'snapshot first, then the missed changes in order');
  hub.publish('session', { id: 's2' });
  assert.deepEqual(types(station), ['snapshot', 'approval', 'session', 'session'], 'after that, changes go straight out');
});

test('every station is sent every change, and a closed one is simply skipped', () => {
  const hub = new StationHub();
  const a = fakeStream();
  const b = fakeStream();
  for (const s of [a, b]) {
    hub.add(s);
    hub.start(s, 'snapshot', {});
  }
  b.writableEnded = true;
  hub.publish('session', { id: 's1' });
  assert.deepEqual(types(a), ['snapshot', 'session']);
  assert.deepEqual(types(b), ['snapshot']);
});

test('presence: a station must be connected AND recently heard from; leaving or going quiet means offline', () => {
  const clock = { t: 1_000_000 };
  const hub = new StationHub({ now: () => clock.t });
  assert.equal(hub.online(), false, 'nobody connected');
  hub.ping();
  assert.equal(hub.online(), false, 'a ping without an open feed is not a station');
  const station = fakeStream();
  const leave = hub.add(station);
  assert.equal(hub.online(), true);
  clock.t += PRESENCE_MS - 1;
  assert.equal(hub.online(), true);
  clock.t += 2;
  assert.equal(hub.online(), false, 'no ping for too long');
  hub.ping();
  assert.equal(hub.online(), true);
  leave();
  assert.equal(hub.online(), false, 'the feed closed');
  assert.equal(hub.clientCount, 0);
});

test('a session change is described once for a burst of saves, and never throws into the booth', async () => {
  const described = [];
  const hub = new StationHub({ debounceMs: 20 });
  hub.setResolver(async (id) => {
    described.push(id);
    if (id === 'broken') throw new Error('cannot describe');
    return { id };
  });
  const station = fakeStream();
  hub.add(station);
  hub.start(station, 'snapshot', {});
  for (let i = 0; i < 5; i++) hub.touch('s1');
  hub.touch('broken');
  await waitFor(() => described.length >= 2);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(described.sort(), ['broken', 's1'], 'five quick saves became one description');
  assert.deepEqual(types(station), ['snapshot', 'session']);
  const idle = new StationHub({ debounceMs: 10 });
  idle.setResolver(async () => assert.fail('nobody is watching, so nothing should be described'));
  idle.touch('s1');
  await new Promise((resolve) => setTimeout(resolve, 40));
});
