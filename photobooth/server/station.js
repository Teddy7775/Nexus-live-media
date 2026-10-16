import crypto from 'node:crypto';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import express from 'express';
import { HttpError } from './http-error.js';
import { SESSION_ID } from './store.js';
import { qrSvg } from './qr.js';

/**
 * The attendant's station: a second screen on the same network that shows sessions live, approves prints before they
 * reach the printer, and shares a guest's photos (QR / email) from there. It is served by the booth's network listener
 * under /station/ and is the only part of the booth, besides guest galleries, that other devices can reach.
 *
 * Everything except the page itself needs the station PIN. The PIN is exchanged for a signed cookie (HttpOnly,
 * SameSite=Strict) because a browser cannot attach a header to the live event stream.
 */

const COOKIE = 'booth_station';
const LOGIN_HOURS = 12;
export const PRESENCE_MS = 20_000; // a station that has not pinged for this long counts as gone
const MEDIA_FILE = /^(previews\/[A-Za-z0-9._-]+\.jpg|final-preview\.jpg|animation\.gif)$/;

/** The open live-event connections, and whether anybody is actually there. */
export class StationHub {
  #clients = new Map(); // res -> { ready, queue }: a station is "ready" once it has been sent its snapshot
  #timers = new Map();
  #resolver = null;
  #lastPing = 0;

  constructor({ now = Date.now, logger, debounceMs = 60 } = {}) {
    this.now = now;
    this.log = logger;
    this.debounceMs = debounceMs;
  }

  setResolver(fn) {
    this.#resolver = fn;
  }

  /** At least one station has the live feed open AND its page has pinged recently (a frozen tab does not count). */
  online() {
    return this.#clients.size > 0 && this.now() - this.#lastPing < PRESENCE_MS;
  }

  get clientCount() {
    return this.#clients.size;
  }

  ping() {
    this.#lastPing = this.now();
  }

  add(res) {
    this.#clients.set(res, { ready: false, queue: [] });
    this.ping();
    return () => this.#clients.delete(res);
  }

  /**
   * Sends a new station its first message (the snapshot), then whatever happened while the snapshot was being put together.
   * Without this, a change arriving in that moment could be overwritten by an older snapshot and the screen would stay wrong.
   */
  start(res, type, data) {
    const client = this.#clients.get(res);
    if (!client) return;
    this.send(res, type, data);
    client.ready = true;
    for (const [t, d] of client.queue.splice(0)) this.send(res, t, d);
  }

  send(res, type, data) {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  publish(type, data) {
    for (const [res, client] of this.#clients) {
      if (client.ready) this.send(res, type, data);
      else client.queue.push([type, data]);
    }
  }

  /** "This session changed": after a short pause (changes arrive in bursts) its fresh summary is sent to every station. */
  touch(sessionId) {
    if (this.#clients.size === 0 || this.#timers.has(sessionId)) return;
    const timer = setTimeout(async () => {
      this.#timers.delete(sessionId);
      try {
        const summary = await this.#resolver?.(sessionId);
        if (summary) this.publish('session', summary);
      } catch (err) {
        this.log?.warn?.(`station: could not describe session ${sessionId}: ${err.message}`);
      }
    }, this.debounceMs);
    timer.unref?.();
    this.#timers.set(sessionId, timer);
  }

  closeAll() {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    for (const res of this.#clients.keys()) res.end();
    this.#clients.clear();
  }
}

const sha = (value) => crypto.createHash('sha256').update(String(value)).digest();

function readCookie(req, name) {
  for (const part of String(req.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function createStationRouter({ config, hub, approvals, actions, store, queue, camera, printer, settings, emailQueue, uploadQueue, publicDir, uiDir, logger, secret = crypto.randomBytes(32), now = Date.now }) {
  const router = express.Router();
  const pinHash = sha(config.station.pin);
  const sign = (expires) => crypto.createHmac('sha256', secret).update(String(expires)).digest('base64url');

  const revoked = new Map(); // signed-out tokens -> when they would have expired anyway
  const validCookie = (req) => {
    const token = readCookie(req, COOKIE);
    if (!token || revoked.has(token)) return false;
    const [expires, nonce, mac] = token.split('.');
    if (!nonce || !mac || !(Number(expires) > now())) return false;
    const expected = Buffer.from(sign(`${expires}.${nonce}`));
    const given = Buffer.from(mac);
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  };

  // ------------------------------------------------------------------ describing sessions

  const media = (session, rel) => `/station/media/${encodeURIComponent(session.eventSlug)}/${session.id}/${rel}`;

  function printState(session) {
    const approval = approvals?.forSession(session.id) ?? null;
    const last = session.prints.at(-1) ?? null;
    if (approval?.status === 'pending' || approval?.status === 'approving') return { state: 'awaiting', approvalId: approval.id, expiresAt: approval.expiresAt, copies: approval.copies };
    // A refusal that is newer than the last print is what the guest last saw.
    if (approval && ['rejected', 'expired', 'cancelled', 'error'].includes(approval.status) && (!last || approval.createdAt > last.at)) {
      return { state: approval.status === 'error' ? 'error' : approval.status, reason: approval.reason, error: approval.error ?? null };
    }
    if (last) {
      const job = queue.get(last.jobId);
      return { state: job ? job.status : 'queued', copies: last.copies, error: job?.error ?? null, prints: session.prints.length };
    }
    return { state: 'none' };
  }

  function summarize(session) {
    const share = actions.shareState(session);
    const shots = [...session.shots].sort((a, b) => a.index - b.index);
    return {
      id: session.id,
      createdAt: session.createdAt,
      eventName: session.eventName,
      status: session.status,
      shotsTaken: session.shots.length,
      shotsNeeded: session.shotsNeeded,
      background: session.background?.name ?? null,
      shots: shots.map((s) => media(session, s.preview)),
      finalUrl: session.final ? `${media(session, session.final.preview)}?v=${session.final.version}` : null,
      gifUrl: session.gif ? `${media(session, session.gif.file)}?v=${session.gif.version}` : null,
      print: printState(session),
      share: share.enabled ? { ready: share.ready, state: share.state, url: share.url } : null,
    };
  }

  hub.setResolver(async (id) => {
    const session = await store.find(id);
    return session ? summarize(session) : null;
  });

  async function snapshot() {
    const sessions = await store.list({ eventSlug: settings.eventSlug, limit: config.station.recentSessions });
    const pending = approvals?.pending() ?? [];
    // A waiting guest's session is always included, even if it somehow is not among the recent ones.
    const known = new Set(sessions.map((s) => s.id));
    for (const p of pending) {
      if (known.has(p.sessionId)) continue;
      const s = await store.find(p.sessionId);
      if (s) sessions.unshift(s);
    }
    return {
      event: { name: settings.eventName, slug: settings.eventSlug },
      sessions: sessions.map(summarize),
      approvals: pending,
      approval: { required: settings.approvalRequired, timeoutSeconds: config.station.approval.timeoutSeconds, onTimeout: config.station.approval.onTimeout, maxCopies: config.station.approval.maxCopies },
      printEnabled: settings.printEnabled,
      email: { enabled: Boolean(emailQueue), marketingOptIn: config.email.marketingOptIn },
      serverTime: new Date(now()).toISOString(),
    };
  }

  // ------------------------------------------------------------------ plumbing

  router.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' });
    next();
  });

  // The page: nothing secret in it, so it is served to anybody; its data is not.
  router.use(
    (req, res, next) => {
      if (req.path === '/' || req.path.endsWith('.html')) {
        res.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      }
      next();
    },
    express.static(uiDir, { index: 'index.html', dotfiles: 'deny' }),
  );
  router.get('/email-utils.js', (req, res) => res.type('js').sendFile('email-utils.js', { root: publicDir }));

  router.use(express.json({ limit: '10kb' }));

  // Browsers attach cookies to cross-site form posts: refuse any change whose Origin is not this very host.
  router.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && req.method !== 'GET' && req.method !== 'HEAD') {
      let host = null;
      try {
        host = new URL(origin).host;
      } catch {
        /* malformed origin: refused below */
      }
      if (host !== req.get('host')) return next(new HttpError(403, 'bad_origin', 'Request refused'));
    }
    return next();
  });

  const attempts = new Map(); // ip -> { count, lockedUntil }
  router.post('/api/login', async (req, res, next) => {
    try {
      const ip = req.ip ?? 'unknown';
      const entry = attempts.get(ip) ?? { count: 0, lockedUntil: 0 };
      if (entry.lockedUntil > now()) throw new HttpError(429, 'locked', `Too many wrong PINs. Try again in ${Math.ceil((entry.lockedUntil - now()) / 1000)} seconds.`);
      const given = sha(typeof req.body?.pin === 'string' ? req.body.pin : '');
      if (!crypto.timingSafeEqual(given, pinHash)) {
        entry.count += 1;
        if (entry.count >= 5) {
          entry.lockedUntil = now() + 60_000;
          entry.count = 0;
        }
        attempts.set(ip, entry);
        logger.warn(`station: wrong PIN from ${ip}`);
        await sleep(400);
        throw new HttpError(401, 'bad_pin', 'Wrong PIN');
      }
      attempts.delete(ip);
      const expires = now() + LOGIN_HOURS * 3600_000;
      const nonce = crypto.randomBytes(9).toString('base64url'); // every sign-in gets its own token, so signing one out never affects another
      res.append('Set-Cookie', `${COOKIE}=${expires}.${nonce}.${sign(`${expires}.${nonce}`)}; HttpOnly; SameSite=Strict; Path=/station; Max-Age=${LOGIN_HOURS * 3600}`);
      logger.info(`station: signed in from ${ip}`);
      return res.json({ ok: true });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/api/logout', (req, res) => {
    // Clearing the cookie only helps this browser: also remember the token as signed out, in case a copy exists elsewhere.
    const token = readCookie(req, COOKIE);
    if (token) {
      for (const [t, expires] of revoked) if (expires < now()) revoked.delete(t);
      revoked.set(token, Number(token.split('.')[0]) || now() + LOGIN_HOURS * 3600_000);
    }
    res.append('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/station; Max-Age=0`);
    res.json({ ok: true });
  });

  // Everything below needs the cookie.
  const guard = (req, res, next) => (validCookie(req) ? next() : next(new HttpError(401, 'login_required', 'Sign in with the station PIN')));
  router.use('/api', guard);
  router.use('/media', guard);

  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

  // ------------------------------------------------------------------ live feed

  router.get('/api/me', (req, res) => res.json({ ok: true, event: settings.eventName }));

  router.post('/api/ping', (req, res) => {
    hub.ping();
    res.json({ ok: true, online: hub.online() });
  });

  router.get(
    '/api/snapshot',
    wrap(async (req, res) => {
      res.json(await snapshot());
    }),
  );

  router.get('/api/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    const remove = hub.add(res);
    const keepalive = setInterval(() => res.write(': keepalive\n\n'), 5000);
    keepalive.unref?.();
    req.on('close', () => {
      clearInterval(keepalive);
      remove();
    });
    snapshot()
      .then((data) => hub.start(res, 'snapshot', data))
      .catch((err) => {
        logger.warn(`station: snapshot failed: ${err.message}`);
        res.end(); // the page reconnects and tries again
      });
  });

  /** What the attendant needs to know about the booth itself, in one place. */
  router.get(
    '/api/status',
    wrap(async (req, res) => {
      // While a photo is being taken the camera is left alone: asking it things at that moment is not worth the risk.
      const cameraStatus = actions.isCapturing() ? Promise.resolve({ connected: true, detail: 'Taking a photo' }) : camera.status().catch((e) => ({ connected: false, detail: e.message }));
      const [cam, prn] = await Promise.all([cameraStatus, printer.status().catch((e) => ({ ok: false, detail: e.message }))]);
      const jobs = queue.list();
      res.json({
        camera: { connected: Boolean(cam.connected), detail: cam.detail },
        printer: { mode: printer.mode, ok: Boolean(prn.ok), detail: prn.detail },
        prints: { waiting: queue.pending(), failed: jobs.filter((j) => j.status === 'error').length, lastError: jobs.find((j) => j.status === 'error')?.error ?? null },
        email: { failed: emailQueue ? emailQueue.list().filter((i) => i.status === 'failed').length : 0 },
        uploads: { failed: uploadQueue ? uploadQueue.list().filter((i) => i.status === 'failed').length : 0 },
      });
    }),
  );

  // ------------------------------------------------------------------ print approval

  router.post(
    '/api/approvals/approve-all',
    wrap(async (req, res) => {
      if (!approvals) throw new HttpError(409, 'approval_disabled', 'Print approval is not turned on');
      const approved = await approvals.approveAll();
      logger.info(`station: approved all waiting prints (${approved})`);
      res.json({ approved });
    }),
  );

  router.post(
    '/api/approvals/:id/approve',
    wrap(async (req, res) => {
      if (!approvals) throw new HttpError(409, 'approval_disabled', 'Print approval is not turned on');
      const copies = req.body?.copies;
      if (copies !== undefined && !(Number.isInteger(copies) && copies >= 1 && copies <= config.station.approval.maxCopies)) {
        throw new HttpError(400, 'bad_copies', `Copies must be a whole number from 1 to ${config.station.approval.maxCopies}`);
      }
      const item = await approvals.approve(req.params.id, { copies });
      if (!item) throw new HttpError(409, 'not_pending', 'That request was already answered (or the guest left)');
      logger.info(`station: approved print ${item.id} for session ${item.sessionId} (${item.copies} copies)`);
      res.json({ approval: item });
    }),
  );

  router.post(
    '/api/approvals/:id/reject',
    wrap(async (req, res) => {
      if (!approvals) throw new HttpError(409, 'approval_disabled', 'Print approval is not turned on');
      const item = approvals.reject(req.params.id, req.body?.reason);
      if (!item) throw new HttpError(409, 'not_pending', 'That request was already answered (or the guest left)');
      logger.info(`station: rejected print ${item.id} for session ${item.sessionId}`);
      res.json({ approval: item });
    }),
  );

  // ------------------------------------------------------------------ share / email / reprint

  router.post(
    '/api/sessions/:id/share',
    wrap(async (req, res) => {
      const session = await actions.requireSession(req.params.id);
      await actions.ensureComposed(session);
      await actions.ensureShareBundle(session, { upload: true });
      const state = actions.shareState(session);
      if (!state.enabled) throw new HttpError(409, 'sharing_disabled', 'Sharing is turned off');
      res.json({ ...state, qrSvg: await qrSvg(state.url) });
    }),
  );

  router.post(
    '/api/sessions/:id/email',
    wrap(async (req, res) => {
      const session = await actions.requireSession(req.params.id);
      res.json(await actions.queueEmail(session, req.body ?? {}));
    }),
  );

  router.post(
    '/api/sessions/:id/reprint',
    wrap(async (req, res) => {
      if (!settings.printEnabled) throw new HttpError(409, 'printing_disabled', 'Printing is turned off');
      const session = await actions.requireSession(req.params.id);
      if (session.shots.length < session.shotsNeeded) throw new HttpError(409, 'not_ready', 'That session did not finish taking its photos');
      const copies = Math.min(config.station.approval.maxCopies, Math.max(1, Number.isInteger(req.body?.copies) ? req.body.copies : 1));
      const job = await actions.printSession(session, copies, 'reprint');
      logger.info(`station: reprint of ${session.id} (${copies} copies)`);
      res.json({ job });
    }),
  );

  // ------------------------------------------------------------------ pictures

  /** Only the screen-size pictures: never the camera originals, the print file or session.json (which holds the share link). */
  router.get('/media/:event/:session/*', (req, res, next) => {
    const rel = req.params[0];
    if (!SESSION_ID.test(req.params.session) || !MEDIA_FILE.test(rel)) return next(new HttpError(404, 'not_found', 'Not found'));
    let dir;
    try {
      dir = path.join(store.eventDir(req.params.event), req.params.session);
    } catch {
      return next(new HttpError(404, 'not_found', 'Not found'));
    }
    return res.sendFile(rel, { root: dir, dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) next(new HttpError(404, 'not_found', 'Not found'));
    });
  });

  router.use((req, res, next) => next(new HttpError(404, 'not_found', 'Not found')));

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'Invalid request' });
    logger.error(`station ${req.method} ${req.originalUrl}: ${err?.stack ?? err}`);
    return res.status(500).json({ error: 'internal', message: 'Something went wrong' });
  });

  return router;
}
